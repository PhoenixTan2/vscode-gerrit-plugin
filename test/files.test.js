'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyFile, textContent } = require('../src/files');
test('actual bytes distinguish UTF-8/UTF-16 text from binary without trusting Gerrit metadata', () => {
  const text = 'Hello UTF16 中文\nnext';
  assert.equal(classifyFile(Buffer.from(text)).text, text);
  assert.equal(classifyFile(Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')])).text, text);
  assert.equal(classifyFile(Buffer.from('plain text\nnext','utf16le')).text, 'plain text\nnext');
  const big = Buffer.from(text,'utf16le').swap16();
  assert.equal(textContent(Buffer.concat([Buffer.from([254,255]),big])).text, text);
  assert.equal(classifyFile(Buffer.from([0,255,1,7,254])).kind, 'binary');
  assert.equal(classifyFile(Buffer.from('%PDF-1.4')).kind, 'binary');
});

test('opaque originals are cached byte-for-byte and delegated to two native VS Code groups', async () => {
  const { NativeFiles } = require('../src/native-files'); const fs = require('node:fs/promises'); const calls = [];
  const v = { Uri:{file:fsPath=>({fsPath,toString:()=>fsPath})},ViewColumn:{Active:-1,Beside:-2,One:1},window:{tabGroups:{all:[{isActive:true,viewColumn:1}]}},commands:{executeCommand:async(...args)=>{calls.push(args);}} };
  const originals = new NativeFiles(v); const left=Buffer.from([0,255,80,75,1]), right=Buffer.from([0,255,80,75,2]);
  try {
    await originals.openPair([{bytes:left,path:'dir/file.xlsx',label:'PS 1'},{bytes:right,path:'dir/file.xlsx',label:'PS 2'}]);
    assert.equal(calls[0][0],'vscode.open'); assert.equal(calls[1][0],'vscode.open');
    assert.equal(calls[0][2].viewColumn,1); assert.equal(calls[1][2].viewColumn,-2);
    assert.ok(calls.every(args=>args[1].fsPath.endsWith('file.xlsx')));
    assert.deepEqual(await fs.readFile(calls[0][1].fsPath),left); assert.deepEqual(await fs.readFile(calls[1][1].fsPath),right);
    assert.ok(((await fs.stat(calls[0][1].fsPath)).mode & 0o200)===0);
  } finally { await originals.dispose(); }
});
test('native opener still attempts new side when old-side association fails and represents missing files honestly', async () => {
  const { NativeFiles } = require('../src/native-files'); const fs = require('node:fs/promises'); const calls=[];
  const v={Uri:{file:fsPath=>({fsPath})},ViewColumn:{Active:-1,Beside:-2,One:1},window:{},commands:{executeCommand:async(...args)=>{calls.push(args);if(calls.length===1)throw new Error('no editor');}}};
  const originals=new NativeFiles(v);
  try {
    await assert.rejects(originals.openPair([{bytes:Buffer.alloc(0),path:'../manual.pdf',label:'PS 1',empty:true},{bytes:Buffer.from('%PDF raw bytes'),path:'manual.pdf',label:'PS 2'}]),/已尝试/);
    assert.equal(calls.length,2); assert.ok(calls[0][1].fsPath.endsWith('.txt'));
    assert.ok((await fs.readFile(calls[0][1].fsPath,'utf8')).includes('不存在'));
    assert.deepEqual(await fs.readFile(calls[1][1].fsPath),Buffer.from('%PDF raw bytes'));
  } finally {await originals.dispose();}
});

test('concurrent cache requests share the same original and shutdown drains pending writes before cleanup', async () => {
  const { NativeFiles } = require('../src/native-files'); const fs=require('node:fs/promises');
  const v={Uri:{file:fsPath=>({fsPath})}}, originals=new NativeFiles(v), bytes=Buffer.from([0,255,8]);
  const one=originals.cache(bytes,{path:'CON.xlsx',label:'PS 1'}), two=originals.cache(bytes,{path:'CON.xlsx',label:'PS 1'});
  assert.equal(one,two);
  const uri=await one; assert.deepEqual(await fs.readFile(uri.fsPath),bytes); assert.ok(uri.fsPath.endsWith('_CON.xlsx'));
  const root=await originals.rootPromise; await Promise.all([originals.dispose(),originals.dispose()]);
  await assert.rejects(fs.stat(root),{code:'ENOENT'});
  const pendingFiles=new NativeFiles(v), pending=pendingFiles.cache(bytes,{path:'file.bin',label:'PS 1'});
  const cleanup=pendingFiles.dispose(); await Promise.allSettled([pending]); await cleanup;
  await assert.rejects(fs.stat(await pendingFiles.rootPromise),{code:'ENOENT'});
});
