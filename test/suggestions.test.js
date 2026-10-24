'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pickSuggestion, chooseBranch, remoteBranches} = require('../src/suggestions');
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
test('cancelling remote branch loading aborts Git and never opens an upload picker', async () => {
  const f=fixture(); let cancel;
  f.vscode.window.withProgress=async(_,fn)=>fn({}, {onCancellationRequested:handler=>{cancel=handler;return {dispose(){}};}});
  const result=chooseBranch(f.vscode,async(_,args,options)=>{
    assert.equal(args[0],'ls-remote');
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  },'.','origin');
  cancel();assert.equal(await result,undefined);assert.equal(f.events.ChangeValue,undefined);
});
