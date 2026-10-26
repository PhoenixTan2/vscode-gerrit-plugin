'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {lineMap,mappedPosition,historicalComments}=require('../src/historical-comments');
test('only unchanged shared/skip spans map exact lines and multiline columns',()=>{
 const mapping=lineMap({content:[{ab:['a']},{b:['inserted']},{skip:2},{a:['old'],b:['new']},{ab:['last']}]});
 assert.equal(mappedPosition({line:2},mapping).line,3);
 assert.deepEqual(mappedPosition({line:3,range:{start_line:2,start_character:1,end_line:3,end_character:2}},mapping).range,{start_line:3,start_character:1,end_line:4,end_character:2});
 assert.equal(mappedPosition({line:4},mapping),undefined);assert.equal(mappedPosition({range:{start_line:3,end_line:5}},mapping),undefined);
 assert.equal(mappedPosition({line:5},mapping,4),undefined);
});
function fixture(side='REVISION'){
 const selected={id:'c',rev:'new',files:{'renamed.c':{status:'R',old_path:'old.c'}},change:{project:'p',revisions:{old:{_number:1,files:{'old.c':{}},commit:{parents:[{commit:'parent'}]}},middle:{_number:2},new:{_number:3,commit:{parents:[{commit:'parent'}]}}}},comments:{'old.c':[{id:'old',patch_set:1,side,line:2,message:'Old'}],'renamed.c':[{id:'mid',patch_set:2,side,line:1},{id:'new',patch_set:3,side,line:1}]}};
 const app={selected,user:{_account_id:1},api:{url:'https://review.example.invalid',diff:async()=>({meta_a:{name:'old.c'},meta_b:{name:'renamed.c'},content:[{b:['new']},{ab:['a','b','c']}]})}};
 const info={id:'c',rev:'new',path:'renamed.c',contentPath:'renamed.c',side,content:'new\na\nb\nc\n',historyTarget:true,historyExcluded:[3]};
 return {app,info};
}
test('historical rename comments map to target lines, keep original data and exclude displayed/newer PS',async()=>{
 const {app,info}=fixture();const comments=await historicalComments(app,info);assert.equal(comments.length,2);
 const old=comments.find(comment=>comment.id==='old');assert.equal(old.line,3);assert.equal(old._origin.comment.line,2);assert.equal(old._origin.patch,1);assert.equal(old._origin.path,'old.c');
 const unmapped=comments.find(comment=>comment.id==='mid');assert.equal(unmapped.line,undefined);assert.equal(unmapped._origin.unmapped,true);
 info.historyExcluded=[1,3];assert.equal((await historicalComments(app,info)).length,1);
});
test('parent comments share identical Base lines or use commit-to-commit mapping after rebases',async()=>{
 const {app,info}=fixture('PARENT');info.contentPath='old.c';
 let comments=await historicalComments(app,info);assert.equal(comments.find(comment=>comment.id==='old').line,2);
 app.selected.change.revisions.new.commit.parents[0].commit='new-parent';let call;
 app.api.commitDiff=async(...args)=>{call=args;return{meta_a:{name:'old.c'},meta_b:{name:'old.c'},content:[{b:['added']},{ab:['a','b','c']}]};};
 comments=await historicalComments(app,info);assert.equal(comments.find(comment=>comment.id==='old').line,3);assert.equal(call[0],'p');assert.equal(call[1],'new-parent');assert.equal(call[3],'parent');
});
test('unsupported diffs retain old comments at file level, with cancellation and immutable caching',async()=>{
 const {app,info}=fixture();let calls=0;app.api.diff=async()=>{calls++;throw Error('not supported');};
 const comments=await historicalComments(app,info);assert.equal(comments.length,2);assert.ok(comments.every(comment=>comment.line===undefined));
 const controller=new AbortController();controller.abort();await assert.rejects(historicalComments(app,info,{signal:controller.signal}),{name:'AbortError'});
 app.api.diff=async()=>{calls++;return{meta_a:{name:'old.c'},meta_b:{name:'renamed.c'},content:[{ab:['a','b']}]};};
 await historicalComments(app,info);const before=calls;await historicalComments(app,info);assert.equal(calls,before);
});
