'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create,messages} = require('../media/i18n');
test('language translates only static literals and preserves interpolated user content',()=>{
  let language='zh-CN'; const tr=create(()=>language), user='用户原文 <script> : 汉字';
  const before=tr`搜索 ${user} 个文件`;
  assert.equal(before,`搜索 ${user} 个文件`); language='en';
  assert.equal(tr.current(before),`Search ${user} files`);
  assert.equal(tr('返回评审讨论'),'Back to discussion');
  assert.equal(tr('请先连接 Gerrit'),'Connect to Gerrit first');
  assert.equal(tr`${user}`,user);
  assert.ok(Object.values(messages).every(value=>!/[\u3400-\u9fff]/.test(value)));
});
test('English NLS contributions cover every declaration and native actions have safe scope',()=>{
  const p=require('../package.json'),base=require('../package.nls.json'),zh=require('../package.nls.zh-cn.json');
  assert.deepEqual(Object.keys(base).sort(),Object.keys(zh).sort());
  for(const match of JSON.stringify(p).matchAll(/%([^%]+)%/g)) assert.ok(match[1] in base);
  assert.ok(Object.values(base).every(value=>!/[\u3400-\u9fff]/.test(value)));
  assert.ok(!p.contributes.menus['editor/context'].some(item=>item.command==='gerrit.openThisFile'));
  assert.ok(p.contributes.menus['editor/title'].some(item=>item.command==='gerrit.openThisFile'));
  const key=p.contributes.keybindings.find(item=>item.command==='gerrit.comment');
  assert.equal(key.key,'c');assert.ok(!key.when.includes('editorHasSelection'));
  for(const condition of ['editorTextFocus','editorReadonly','isInDiffEditor','resourceScheme == gerrit']) assert.ok(key.when.includes(condition));
});
