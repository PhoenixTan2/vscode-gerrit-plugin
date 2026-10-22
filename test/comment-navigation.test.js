'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {nativeCommentTarget}=require('../src/comment-navigation');
test('native navigation requires an exact known thread range and a plain active resource',()=>{
 const uri={toString:()=> 'gerrit:x'},point={line:2,character:0},range={start:point,end:point};
 const tab={input:{uri}},v={TextEditorSelectionChangeKind:{Command:3},window:{tabGroups:{activeTabGroup:{activeTab:tab}}}};
 const event={kind:3,textEditor:{document:{uri}},selections:[range]},info={path:'x.c',commentIds:['root']},thread={uri,range,comments:[{}]};
 const threads=new Map([[thread,info]]);assert.equal(nativeCommentTarget(v,event,threads).commentId,'root');
 assert.equal(nativeCommentTarget(v,{...event,kind:1},threads),undefined);assert.equal(nativeCommentTarget(v,{...event,kind:undefined},threads),undefined);
 assert.equal(nativeCommentTarget(v,{...event,selections:[{start:{line:3,character:0},end:{line:3,character:0}}]},threads),undefined);
 info.path='/PATCHSET_LEVEL';assert.equal(nativeCommentTarget(v,event,threads),undefined);info.path='x.c';
 tab.input={original:uri,modified:uri};assert.equal(nativeCommentTarget(v,event,threads),undefined);
});
