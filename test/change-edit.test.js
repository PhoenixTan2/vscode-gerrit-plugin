'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ChangeEdits} = require('../src/change-edit');
function fixture() {
  const rev='a'.repeat(40), next='b'.repeat(40), calls=[];
  const change={id:'p~main~I1',_number:1,current_revision:rev,status:'NEW',owner:{_account_id:7}};
  const uri=value=>({...value,toString:()=>`${value.scheme}://${value.authority||''}${value.path}?${value.query||''}`});
  const base=uri({scheme:'gerrit',path:'/base/code.c'}), right=uri({scheme:'gerrit',path:'/ps/code.c'});
  let edit, head=0; const contents=new Map([['src/code.c',Buffer.from('old\n')]]);
  const api={url:'https://review.example.invalid',detail:async()=>structuredClone(change),edit:async()=>edit&&structuredClone(edit),
    bytes:async(_,__,path)=>contents.get(path),editBytes:async(_,path)=>contents.get(path),
    putEditFile:async(id,path,bytes)=>{calls.push(['put',id,path,bytes.toString()]);contents.set(path,bytes);edit={base_revision:rev,commit:{commit:'edit-'+ ++head}};},
    publishEdit:async id=>{calls.push(['publish',id]);change.current_revision=next;edit=undefined;},rebaseEdit:async()=>{edit={base_revision:change.current_revision,commit:{commit:'rebased'}};}};
  const v={EventEmitter:class {constructor(){this.event=()=>({dispose(){}});}fire(){}dispose(){}},Disposable:class{},
    FileType:{File:1},FilePermission:{Readonly:1},FileChangeType:{Changed:1},
    FileSystemError:{NoPermissions:()=>new Error('NoPermissions'),FileNotFound:()=>new Error('NotFound')},Uri:{from:uri},
    workspace:{textDocuments:[]},window:{tabGroups:{activeTabGroup:{activeTab:{input:{original:base,modified:right}}}}},
    commands:{executeCommand:async(...args)=>calls.push(args)}};
  const app={api,user:{_account_id:7},selected:{id:change.id,rev},documents:new Map([[right.toString(),{id:change.id,rev,path:'src/code.c',side:'REVISION'}]]),
    load:async id=>calls.push(['load',id]),updateEditContext(){},loadChangeStatus(){}};
  const edits=new ChangeEdits(app,v);
  return {edits,app,v,calls,rev,next,change,base,right,contents,setEdit:value=>{edit=value;},getEdit:()=>edit};
}
test('Edit uses a writable modified-side URI and the original immutable Base; save and publish produce a new PS', async()=>{
  const f=fixture();await f.edits.start();
  const open=f.calls.find(call=>call[0]==='vscode.diff');assert.equal(open[1],f.base);assert.equal(open[2].scheme,'gerrit-edit');assert.equal(open[4].preview,true);
  const uri=open[2];assert.equal((await f.edits.readFile(uri)).toString(),'old\n');
  await f.edits.writeFile(uri,Buffer.from('edited\n'));
  assert.deepEqual(f.calls.find(call=>call[0]==='put').slice(0,3),['put',f.change.id,'src/code.c']);
  await f.edits.publish(f.change.id);assert.equal(f.change.current_revision,f.next);
  assert.equal((await f.edits.stat(uri)).permissions,1);
  await assert.rejects(f.edits.writeFile(uri,Buffer.from('overwrite')),/会话已失效/);
  await assert.rejects(f.edits.writeFile(f.base,Buffer.from('base write')),/NoPermissions/);
});
test('foreign owners, historical patches and changed connections cannot start or save an edit',async()=>{
  const f=fixture();f.change.owner._account_id=9;await assert.rejects(f.edits.start(),/自己的/);
  f.change.owner._account_id=7;f.change.current_revision=f.next;await assert.rejects(f.edits.start(),/最新 PS/);
  f.change.current_revision=f.rev;await f.edits.start();const uri=f.calls.at(-1)[2];
  f.app.api={...f.app.api};await assert.rejects(f.edits.writeFile(uri,Buffer.from('changed')),/会话已失效/);assert.equal(f.calls.filter(c=>c[0]==='put').length,0);
});
test('server edit changes and a new PS are detected before uploading; editor bytes are retained',async()=>{
  const f=fixture();await f.edits.start();const uri=f.calls.at(-1)[2];
  f.setEdit({base_revision:f.rev,commit:{commit:'another-window'}});
  await assert.rejects(f.edits.writeFile(uri,Buffer.from('ours')),/服务器 Edit/);
  assert.equal((await f.edits.readFile(uri)).toString(),'old\n');assert.equal(f.calls.filter(c=>c[0]==='put').length,0);
  f.setEdit(undefined);f.change.current_revision=f.next;
  await assert.rejects(f.edits.writeFile(uri,Buffer.from('ours')),/最新 PS/);
});
test('old server drafts require Rebase Edit and a failed save prevents publishing',async()=>{
  const f=fixture();f.setEdit({base_revision:f.next,commit:{commit:'old-edit'}});await assert.rejects(f.edits.start(),/基于旧 PS/);
  f.setEdit(undefined);await f.edits.start();const uri=f.calls.at(-1)[2];
  f.app.api.putEditFile=async()=>{throw new Error('server denied');};
  await assert.rejects(f.edits.writeFile(uri,Buffer.from('ours')),/server denied/);
  await assert.rejects(f.edits.publish(f.change.id),/server denied/);
  assert.ok(!f.calls.some(c=>c[0]==='publish'));
});
test('publication saves all dirty files and refuses to publish if any save fails',async()=>{
  const f=fixture();await f.edits.start();const uri=f.calls.at(-1)[2];let saves=0;
  const doc={uri,isDirty:true,save:async()=>{saves++;return false;}};f.v.workspace.textDocuments=[doc];
  await assert.rejects(f.edits.publish(f.change.id),/保存失败/);assert.equal(saves,1);assert.ok(!f.calls.some(c=>c[0]==='publish'));
  doc.save=async()=>{await f.edits.writeFile(uri,Buffer.from('saved'));doc.isDirty=false;return true;};
  await f.edits.publish(f.change.id);assert.ok(f.calls.some(c=>c[0]==='publish'));
});
test('saved Edit URIs can be recovered after restart, but not on another server/account',async()=>{
  const f=fixture();await f.edits.start();const uri=f.calls.at(-1)[2];await f.edits.writeFile(uri,Buffer.from('saved'));
  const recovered=new ChangeEdits(f.app,f.v);assert.equal((await recovered.readFile(uri)).toString(),'saved');
  const other=new ChangeEdits({...f.app,user:{_account_id:8}},f.v);await assert.rejects(other.readFile(uri),/NoPermissions/);
});
test('multiple file saves serialize edit-head updates and preserve an existing draft',async()=>{
  const f=fixture();f.setEdit({base_revision:f.rev,commit:{commit:'draft'}});f.contents.set('src/other.c',Buffer.from('second'));
  await f.edits.start();const first=f.calls.at(-1)[2];
  f.app.documents.get(f.right.toString()).path='src/other.c';await f.edits.start();const second=f.calls.at(-1)[2];
  await Promise.all([f.edits.writeFile(first,Buffer.from('first edit')),f.edits.writeFile(second,Buffer.from('second edit'))]);
  assert.equal(f.contents.get('src/code.c').toString(),'first edit');assert.equal(f.contents.get('src/other.c').toString(),'second edit');
  await f.edits.publish(f.change.id);assert.equal(f.calls.filter(c=>c[0]==='put').length,2);
});


test('reopening clean Edit tabs refreshes a changed remote draft without silently replacing dirty buffers',async()=>{
  const f=fixture();await f.edits.start();const uri=f.calls.at(-1)[2];
  f.setEdit({base_revision:f.rev,commit:{commit:'web-edit'}});f.contents.set('src/code.c',Buffer.from('web version'));
  await f.edits.start();assert.equal((await f.edits.readFile(uri)).toString(),'web version');
  f.v.workspace.textDocuments=[{uri,isDirty:true}];
  f.setEdit({base_revision:f.rev,commit:{commit:'newer-web-edit'}});f.contents.set('src/code.c',Buffer.from('new web version'));
  await f.edits.start();assert.equal((await f.edits.readFile(uri)).toString(),'web version');
  await assert.rejects(f.edits.writeFile(uri,Buffer.from('local dirty')),/服务器 Edit/);
});
