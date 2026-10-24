'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {suggestReviewers,addReviewer,removeReviewer}=require('../src/reviewers');
function fixture(){
 const calls=[],sent=[],selected={id:'c',rev:'rev',change:{status:'NEW',owner:{_account_id:1}}};
 const change={id:'c',current_revision:'rev',reviewers:{REVIEWER:[{_account_id:2,name:'Dev'}]},labels:{'Code-Review':{all:[{value:-1}]}},permitted_labels:{'Code-Review':['-1','0','1']}};
 const api={suggestReviewers:async()=>[{account:{_account_id:2,name:'Dev',email:'dev@example.invalid'}},{group:{id:'group-uuid',name:'Team'},count:10}],
  addReviewer:async(...args)=>{calls.push(['add',...args]);return{};},reviewers:async()=>[{_account_id:2}],removeReviewer:async(...args)=>calls.push(['remove',...args]),detail:async()=>structuredClone(change)};
 const app={api,selected,user:{_account_id:1},model:{detail:{},changes:[{id:'c'}]},send:message=>sent.push(message),load:async()=>{throw Error('No full-page refresh');}};
 const message={id:'c',rev:'rev',query:'dev',requestId:1,clientId:'discussion'};return{app,api,calls,sent,message,change};
}
test('inline suggestions support accounts/groups; add confirms server groups automatically and updates only reviewer/rating regions',async()=>{
 const f=fixture();const response=await suggestReviewers(f.app,f.message);assert.equal(response.items[1].kind,'group');assert.equal(response.items[1].count,10);
 let n=0;f.api.addReviewer=async(...args)=>{f.calls.push(['add',...args]);return ++n===1?{confirm:true,error:'confirm group'}:{};};
 await addReviewer(f.app,{requestId:1,clientId:'discussion',index:1});assert.deepEqual(f.calls,[['add','c','group-uuid',false],['add','c','group-uuid',true]]);
 assert.equal(f.sent[0].type,'reviewersState');assert.equal(f.app.model.changes[0].labels['Code-Review'].all[0].value,-1);
});
test('stale, forged or cross-window selections cannot add a different reviewer',async()=>{
 const f=fixture();await suggestReviewers(f.app,f.message);
 for(const message of [{requestId:2,index:0,clientId:'discussion'},{requestId:1,index:0,clientId:'sidebar'},{requestId:1,index:99,clientId:'discussion'}])await assert.rejects(addReviewer(f.app,message),/候选/);
 f.app.selected={...f.app.selected};await assert.rejects(addReviewer(f.app,{requestId:1,index:0,clientId:'discussion'}),/候选/);assert.equal(f.calls.length,0);
});
test('inline deletion checks server membership and ownership without showing a picker',async()=>{
 const f=fixture();await removeReviewer(f.app,{accountId:'2'});assert.deepEqual(f.calls,[['remove','c',2]]);
 await assert.rejects(removeReviewer(f.app,{accountId:3}),/已更新/);f.app.user._account_id=3;await assert.rejects(removeReviewer(f.app,{accountId:2}),/自己的/);
});
test('typing cancels pending suggestions and late results are ignored',async()=>{
 const f=fixture(),pending=[];f.api.suggestReviewers=(_,query,{signal})=>new Promise(resolve=>pending.push({resolve,signal,query}));
 const old=suggestReviewers(f.app,f.message);const fresh=suggestReviewers(f.app,{...f.message,requestId:2,query:'new'});
 assert.equal(pending[0].signal.aborted,true);pending[1].resolve([{account:{_account_id:3,name:'New'}}]);assert.equal((await fresh).items[0].id,'3');pending[0].resolve([{account:{_account_id:2,name:'Old'}}]);assert.equal(await old,undefined);
 assert.equal(f.app.reviewerSuggestionClients.get('discussion').items[0].id,'3');
});


test('sidebar and discussion suggestions with matching request numbers stay independent',async()=>{
 const f=fixture(), pending=[];f.api.suggestReviewers=(_,query,{signal})=>new Promise(resolve=>pending.push({resolve,signal,query}));
 const discussion=suggestReviewers(f.app,{...f.message,query:'person'}), sidebar=suggestReviewers(f.app,{...f.message,query:'group',clientId:'sidebar'});
 assert.equal(pending[0].signal.aborted,false);pending[0].resolve([{account:{_account_id:2,name:'Person'}}]);pending[1].resolve([{group:{id:'g',name:'Group'}}]);await Promise.all([discussion,sidebar]);
 await addReviewer(f.app,{index:0,requestId:1,clientId:'discussion'});assert.equal(f.calls[0][2],'2');
 await addReviewer(f.app,{index:0,requestId:1,clientId:'sidebar'});assert.equal(f.calls[1][2],'g');
});
