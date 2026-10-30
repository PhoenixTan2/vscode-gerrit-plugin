"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {GerritApi}=require('../src/api');
async function fixture(run){
 const state={logins:0,self:0,writes:0,effects:0,reads:0,valid:'',rejectWrite:false,anonymousSelf:false,self403:false,csrf403:false,denyIdentity:false};
 const server=http.createServer((req,res)=>{
  req.resume();req.on('end',()=>{
   const json=value=>res.end(")]}'\n"+JSON.stringify(value));
   if(req.url==='/login/'){
    state.logins++;state.valid='session-'+state.logins;
    res.setHeader('Set-Cookie',['GerritAccount='+state.valid+'; HttpOnly; Path=/','XSRF_TOKEN=csrf-'+state.logins+'; Path=/']);res.end('Login');return;
   }
   const valid=!!state.valid&&req.headers.cookie?.split('; ').includes('GerritAccount='+state.valid);
   if(req.url==='/accounts/self'){
    state.self++;if(valid&&!state.denyIdentity)return json({_account_id:7});
    if(state.anonymousSelf)return json({});res.writeHead(state.self403||state.denyIdentity?403:401);res.end();return;
   }
   if(req.url==='/late-cookie'&&!valid){
    setTimeout(()=>{res.writeHead(401,{'Set-Cookie':'GerritAccount=; Max-Age=0; Path=/'});res.end();},35);return;
   }
   if(req.url.startsWith('/changes/'))return json(valid?{permitted_labels:{'Code-Review':['-1','0','+1']}}:{});
   if(req.url==='/denied'){state.reads++;res.writeHead(403);res.end();return;}
   if(req.url==='/always-401'){state.reads++;res.writeHead(401);res.end();return;}
   if(req.url==='/offline'){state.writes++;req.socket.destroy();return;}
   if(req.method==='POST'){
    state.writes++;if(state.rejectWrite){state.rejectWrite=false;state.valid='expired';res.writeHead(401);res.end();return;}
    if(!valid){res.writeHead(403);res.end();return;}
    if(state.csrf403){state.csrf403=false;res.writeHead(403);res.end('Invalid XSRF token');return;}
    assert.equal(req.headers['x-gerrit-auth'],'csrf-'+state.logins);state.effects++;return json({ok:true});
   }
   if(!valid){state.reads++;res.writeHead(401);setTimeout(()=>res.end(),5);return;}
   state.reads++;json({ok:true});
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const api=new GerritApi('http://127.0.0.1:'+server.address().port,'fixture-user','fixture-password',{authMode:'webPassword'});
 try{await run(api,state);}finally{await new Promise(resolve=>server.close(resolve));}
}
test('expired concurrent requests share one new login and reject stale sessions only once',()=>fixture(async(api,state)=>{
 await api.self();state.valid='expired';
 await Promise.all([api.request('/read'),api.request('/read'),api.request('/read')]);
 assert.equal(state.logins,2);assert.equal(api.sessionReady,true);
}));
test('detail checks authenticated identity before public reads can silently lose scores',()=>fixture(async(api,state)=>{
 await api.self();state.valid='expired';
 assert.deepEqual((await api.detail('1')).permitted_labels,{'Code-Review':['-1','0','+1']});assert.equal(state.logins,2);
}));
test('a successful anonymous self response also triggers a bounded login recovery',()=>fixture(async(api,state)=>{
 await api.self();state.valid='expired';state.anonymousSelf=true;
 assert.equal((await api.self())._account_id,7);assert.equal(state.logins,2);
}));
test('writes preflight identity and only replay an authentication rejection with fresh CSRF',()=>fixture(async(api,state)=>{
 await api.self();state.valid='expired';await api.request('/post','POST',{message:'fixture'});
 assert.equal(state.logins,2);assert.equal(state.writes,1);assert.equal(state.effects,1);
 state.rejectWrite=true;await api.request('/post','POST',{});
 assert.equal(state.logins,3);assert.equal(state.writes,3);assert.equal(state.effects,2);
}));
test('persistent 403 reauthenticates once then reports permission failure without a loop',()=>fixture(async(api,state)=>{
 await api.self();await assert.rejects(api.request('/denied'),error=>error.statusCode===403&&error.message.includes('已自动重新登录'));
 assert.equal(state.logins,2);assert.equal(state.reads,2);
 state.valid='expired';await assert.rejects(api.request('/denied'),{statusCode:403});assert.equal(state.logins,3);assert.equal(state.reads,4);
}));
test('persistent authentication failure is retried once instead of looping',()=>fixture(async(api,state)=>{
 await api.self();await assert.rejects(api.request('/always-401'),{statusCode:401});assert.equal(state.reads,2);assert.equal(state.logins,2);
}));
test('a dropped write connection is never replayed automatically',()=>fixture(async(api,state)=>{
 await api.self();await assert.rejects(api.request('/offline','POST',{}));assert.equal(state.writes,1);assert.equal(state.logins,1);
}));
test('cancelled operations do not start recovery or issue an application request',()=>fixture(async(api,state)=>{
 await api.self();const controller=new AbortController();controller.abort();
 await assert.rejects(api.request('/read','GET',undefined,false,{signal:controller.signal}),{name:'AbortError'});assert.equal(state.logins,1);assert.equal(state.reads,0);
}));

test('late expired-cookie responses cannot erase a renewed concurrent session',()=>fixture(async(api,state)=>{
 await api.self();state.valid='expired';await Promise.all([api.request('/late-cookie'),api.request('/read')]);
 assert.equal(state.logins,2);assert.equal(api.cookies.get('GerritAccount'),'session-2');
}));
test('403 recovery also handles an identity endpoint returning anonymous JSON',()=>fixture(async(api,state)=>{
 await api.self();state.valid='expired';state.anonymousSelf=true;
 await assert.rejects(api.request('/denied'),{statusCode:403});assert.equal(state.logins,2);
}));

test('an identity endpoint returning 403 after expiration automatically signs in again',()=>fixture(async(api,state)=>{
 await api.self();state.valid='expired';state.self403=true;
 assert.deepEqual((await api.detail('1')).permitted_labels,{'Code-Review':['-1','0','+1']});
 assert.equal(state.logins,2);
}));
test('stale CSRF is renewed after 403 even when identity remains authenticated',()=>fixture(async(api,state)=>{
 await api.self();state.csrf403=true;
 await api.request('/post','POST',{message:'fixture'});
 assert.equal(state.logins,2);assert.equal(state.writes,2);assert.equal(state.effects,1);
}));
test('missing or malformed CSRF is renewed without a manually reconnected client',()=>fixture(async(api,state)=>{
 await api.self();api.cookies.delete('XSRF_TOKEN');await api.request('/post','POST',{});
 assert.equal(state.logins,2);assert.equal(state.effects,1);
 api.cookies.set('XSRF_TOKEN','%invalid');await api.request('/post','POST',{});
 assert.equal(state.logins,3);assert.equal(state.effects,2);assert.equal(state.writes,2);
}));
test('a persistent 403 on identity is bounded and does not ask to reconnect',()=>fixture(async(api,state)=>{
 await api.self();state.denyIdentity=true;
 await assert.rejects(api.self(),error=>error.statusCode===403&&error.message.includes('已自动重新登录')&&!error.message.includes('重新连接'));
 assert.equal(state.logins,2);assert.equal(state.self,3);
}));
test('concurrent identity 403 responses share one automatic login',()=>fixture(async(api,state)=>{
 await api.self();state.valid='expired';state.self403=true;
 await Promise.all([api.self(),api.self(),api.self()]);assert.equal(state.logins,2);
}));
test('HTTP Key failures never switch to website login automatically',()=>fixture(async(api,state)=>{
 api.authMode='httpKey';await assert.rejects(api.request('/read'),{statusCode:401});
 assert.equal(state.logins,0);assert.equal(state.reads,1);
}));
test('the final permission error is localized and recovery logs omit request content',()=>fixture(async(api,state)=>{
 const {setLanguage}=require('../src/i18n');const logs=[];api.log=(level,message)=>logs.push(message);
 setLanguage('en');
 try{
  await api.self();await assert.rejects(api.request('/denied','POST',{message:'private-fixture-text'}),error=>error.statusCode===403&&error.message.includes('Signed in again automatically')&&!/[\u3400-\u9fff]/.test(error.message));
  assert.ok(logs.some(line=>line.includes('Signing in to Gerrit again automatically')));
  assert.ok(logs.every(line=>!line.includes('private-fixture-text')&&!line.includes('fixture-password')&&!line.includes('GerritAccount=')));
 }finally{setLanguage('zh-CN');}
}));
