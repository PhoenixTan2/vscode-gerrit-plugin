'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pickSuggestion, chooseBranch, remoteBranches} = require('../src/suggestions');
const {manageReviewers, reviewerSuggestion} = require('../src/reviewers');
function fixture() {
  const events = {};
  const picker = {items: [], selectedItems: [], show() {}, dispose() {this.disposed = true;}};
  for (const name of ['ChangeValue', 'Accept', 'Hide']) picker['onDid' + name] = handler => {events[name] = handler; return {dispose() {delete events[name];}};};
  return {picker, events, vscode: {ProgressLocation:{Notification:15},window: {createQuickPick: () => picker, withProgress: async (_, fn) => fn({}, {onCancellationRequested:()=>({dispose(){}})})}}};
}
const until = async predicate => { for (let i=0; i<100; i++) {if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,5));} throw new Error('Timed out'); };
test('branch picker defaults only to a remote branch and filters case-insensitively', async () => {
  for (const local of ['release/Main', 'local-only', '']) {
    const f = fixture(), calls = [];
    const runGit = async (cwd,args) => {calls.push(args); return args[0] === 'ls-remote' ? 'abc123\trefs/heads/release/Main\nabc123\trefs/heads/develop\n' : local;};
    const selected = chooseBranch(f.vscode, runGit, '.', 'origin');
    await until(()=>f.picker.items.length === (local === 'release/Main' ? 1 : 2));
    assert.equal(f.picker.value, local === 'release/Main' ? local : '');
    assert.deepEqual(calls[0], ['ls-remote', '--heads', '--', 'origin']);
    f.events.ChangeValue('RELEASE/ma'); await until(()=>!f.picker.busy);
    assert.deepEqual(f.picker.items.map(item=>item.label), ['release/Main']);
    f.picker.selectedItems = f.picker.items; f.events.Accept(); assert.equal(await selected,'release/Main');
  }
  assert.deepEqual(remoteBranches('ref: refs/heads/main\tHEAD\nabc\trefs/tags/v1\nabc\trefs/heads/main'), ['main']);
});
test('suggestions discard stale results, abort on typing and cancel without accepting arbitrary input', async () => {
  const f = fixture(), pending = [];
  const result = pickSuggestion(f.vscode, {load:(query,signal)=>new Promise(resolve=>pending.push({query,signal,resolve})), debounce:0});
  await until(()=>pending.length===1);
  f.events.ChangeValue('new'); await until(()=>pending.length===2);
  assert.equal(pending[0].signal.aborted,true);
  pending[1].resolve([{label:'New',value:'new'}]); await until(()=>!f.picker.busy);
  pending[0].resolve([{label:'Stale',value:'stale'}]); await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.picker.items[0].value,'new');
  f.events.ChangeValue('unknown'); f.events.Accept(); f.events.Hide();
  assert.equal(await result,undefined); assert.equal(pending[1].signal.aborted,true); assert.equal(f.picker.disposed,true);
});
function reviewerFixture() {
  const f = fixture(), changes = [];
  const app = {selected:{id:'c',rev:'rev',change:{status:'NEW',owner:{_account_id:1}}},user:{_account_id:1},model:{detail:{}},
    api:{suggestReviewers:async()=>[{group:{id:'g',name:'Team'},count:12}],addReviewer:async(...args)=>{changes.push(args);return {}; }},
    load:async id=>changes.push(['load',id]),confirm:async()=>true};
  f.vscode.window.showQuickPick=async()=>({value:'add'});
  return {...f,app,changes};
}
test('reviewer management adds groups with server-driven confirmation and refreshes only the change', async () => {
  const f=reviewerFixture(); let calls=0;
  f.app.api.addReviewer=async(...args)=>{f.changes.push(args);return ++calls===1?{confirm:true,error:'Confirm group'}:{};};
  const done=manageReviewers(f.app,f.vscode); await until(()=>f.events.ChangeValue);
  f.events.ChangeValue('Team'); await until(()=>f.picker.items.length===1);
  assert.ok(f.picker.items[0].label.includes('Team'));
  f.picker.selectedItems=f.picker.items;f.events.Accept();await done;
  assert.deepEqual(f.changes,[['c','g',false],['c','g',true],['load','c']]);
});
test('server-required group confirmation is automatic; foreign owners and stale pages never mutate reviewers', async () => {
  const f=reviewerFixture();f.app.api.suggestReviewers=async()=>[{group:{id:'g',name:'Team'},confirm:true}];
  f.app.confirm=async()=>{throw new Error('No confirmation popup');};
  const done=manageReviewers(f.app,f.vscode);await until(()=>f.events.ChangeValue);
  f.events.ChangeValue('Team');await until(()=>f.picker.items.length===1);f.picker.selectedItems=f.picker.items;f.events.Accept();await done;
  assert.deepEqual(f.changes,[['c','g',true],['load','c']]); f.changes.length=0;
  f.app.user._account_id=2;await assert.rejects(manageReviewers(f.app,f.vscode),/自己的/);
  f.app.user._account_id=1;f.app.model.detail.viewRevision='old';await assert.rejects(manageReviewers(f.app,f.vscode),/历史/);
  delete f.app.model.detail.viewRevision;
  f.vscode.window.showQuickPick=async()=>{f.app.selected={};return {value:'add'};};
  await assert.rejects(manageReviewers(f.app,f.vscode),/页面已更新/);assert.deepEqual(f.changes,[]);
});
test('individual removal uses server reviewer IDs without a confirmation popup', async () => {
  const f=reviewerFixture(); let step=0;
  f.vscode.window.showQuickPick=async items=>++step===1?{value:'remove'}:items[0];
  f.app.api.reviewers=async()=>[{_account_id:42,name:'Reviewer',approvals:{'Code-Review':'+1',Verified:'0'}}];
  f.app.confirm=async()=>{throw new Error('No confirmation popup');};
  f.app.api.removeReviewer=async(...args)=>f.changes.push(args);
  await manageReviewers(f.app,f.vscode);assert.deepEqual(f.changes,[['c',42],['load','c']]);
  assert.equal(reviewerSuggestion({account:{_account_id:2,name:'A'}}).value.reviewer,'2');
});


test('cancelling remote branch loading aborts Git and never opens an upload picker', async () => {
  const f=fixture(); let cancel;
  f.vscode.window.withProgress=async(_,fn)=>fn({}, {onCancellationRequested:handler=>{cancel=handler;return {dispose(){}};}});
  const result=chooseBranch(f.vscode,async(_,args,options)=>{
    assert.equal(args[0],'ls-remote');
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  },'.','origin');
  cancel();assert.equal(await result,undefined);assert.equal(f.events.ChangeValue,undefined);
});
