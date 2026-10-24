'use strict';
const assert = require('node:assert/strict');
const vscode = require('vscode');
const path = require('node:path');
async function run(extension) {
  const {ChangeEdits} = require(path.join(extension.extensionPath, 'src/change-edit.js'));
  const baseScheme='gerrit-edit-fixture-base', editScheme='gerrit-edit-fixture';
  const base=vscode.Uri.parse(baseScheme+':/base.c'), original=vscode.Uri.parse(baseScheme+':/ps.c');
  const immutable='const value = 1;\n';
  const baseProvider=vscode.workspace.registerTextDocumentContentProvider(baseScheme,{provideTextDocumentContent:()=>immutable});
  const rev='a'.repeat(40), next='b'.repeat(40);
  const change={id:'fixture~main~I1',_number:1,status:'NEW',owner:{_account_id:7},current_revision:rev};
  let remoteEdit, uploaded=0, published=0, discarded=0; const remoteFiles=new Map();
  const api={url:'https://review.example.invalid',detail:async()=>({...change}),edit:async()=>remoteEdit,
    bytes:async()=>Buffer.from(immutable),editBytes:async(_,file)=>remoteFiles.get(file)||Buffer.from(immutable),
    putEditFile:async(id,file,bytes)=>{assert.equal(id,change.id);assert.ok(['code.c','other.c'].includes(file));remoteFiles.set(file,Buffer.from(bytes));remoteEdit={base_revision:change.current_revision,commit:{commit:String(++uploaded)}};},
    publishEdit:async()=>{published++;change.current_revision=next;remoteEdit=undefined;},discardEdit:async()=>{discarded++;remoteEdit=undefined;remoteFiles.clear();}};
  const app={api,user:{_account_id:7},selected:{id:change.id,rev},documents:new Map([[original.toString(),{id:change.id,rev,path:'code.c',side:'REVISION'}]]),
    updateEditContext(){},loadChangeStatus(){},load:async()=>{app.selected.rev=next;}};
  const edits=new ChangeEdits(app,vscode,{scheme:editScheme});
  const registration=vscode.workspace.registerFileSystemProvider(editScheme,edits,{isCaseSensitive:true});
  try {
    await vscode.commands.executeCommand('vscode.diff',base,original,'Readonly PS fixture',{preview:true});
    await edits.start();
    const input=vscode.window.tabGroups.activeTabGroup.activeTab.input;
    assert.ok(input instanceof vscode.TabInputTextDiff);
    assert.equal(input.original.toString(),base.toString());assert.equal(input.modified.scheme,editScheme);
    const doc=await vscode.workspace.openTextDocument(input.modified);
    assert.equal(vscode.workspace.fs.isWritableFileSystem(editScheme),true);
    assert.notEqual(vscode.workspace.fs.isWritableFileSystem(baseScheme),true);
    const edit=new vscode.WorkspaceEdit();edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),'const value = 2;\n');
    assert.equal(await vscode.workspace.applyEdit(edit),true);assert.equal(doc.isDirty,true);
    assert.equal((await vscode.workspace.openTextDocument(base)).getText(),immutable,'Base must remain unchanged');
    assert.equal(await doc.save(),true);assert.equal(uploaded,1);assert.equal(remoteFiles.get('code.c').toString(),'const value = 2;\n');
    // A second dirty file must join the same server draft; one publish creates one PS.
    const otherOriginal=vscode.Uri.parse(baseScheme+':/other.c');
    app.documents.set(otherOriginal.toString(),{id:change.id,rev,path:'other.c',side:'REVISION'});
    await vscode.commands.executeCommand('vscode.diff',base,otherOriginal,'Second file',{preview:true});
    await edits.start();
    const otherUri=vscode.window.tabGroups.activeTabGroup.activeTab.input.modified;
    const otherDoc=await vscode.workspace.openTextDocument(otherUri);
    const otherEdit=new vscode.WorkspaceEdit();otherEdit.replace(otherUri,new vscode.Range(otherDoc.positionAt(0),otherDoc.positionAt(otherDoc.getText().length)),'const value = 3;\n');
    assert.equal(await vscode.workspace.applyEdit(otherEdit),true);assert.equal(otherDoc.isDirty,true);
    assert.equal(uploaded,1);assert.equal(published,0);
    await edits.publish(change.id);assert.equal(uploaded,2);assert.equal(published,1);assert.equal(change.current_revision,next);
    assert.equal(remoteFiles.get('other.c').toString(),'const value = 3;\n');
    assert.equal((await vscode.workspace.fs.stat(doc.uri)).permissions,vscode.FilePermission.Readonly);
    assert.equal((await vscode.workspace.openTextDocument(base)).getText(),immutable);
    const latestOriginal=vscode.Uri.parse(baseScheme+':/latest.c');
    app.documents.set(latestOriginal.toString(),{id:change.id,rev:next,path:'code.c',side:'REVISION'});
    await vscode.commands.executeCommand('vscode.diff',base,latestOriginal,'Latest PS',{preview:true});await edits.start();
    const draftUri=vscode.window.tabGroups.activeTabGroup.activeTab.input.modified,draftDoc=await vscode.workspace.openTextDocument(draftUri);
    const draftChange=new vscode.WorkspaceEdit();draftChange.replace(draftUri,new vscode.Range(draftDoc.positionAt(0),draftDoc.positionAt(draftDoc.getText().length)),'draft to discard\n');
    assert.equal(await vscode.workspace.applyEdit(draftChange),true);assert.equal(await draftDoc.save(),true);
    await edits.discard(change.id);assert.equal(discarded,1);assert.equal(published,1);
    await vscode.commands.executeCommand('vscode.diff',base,latestOriginal,'Latest PS again',{preview:true});await edits.start();
    assert.notEqual((await vscode.workspace.fs.stat(draftUri)).permissions,vscode.FilePermission.Readonly);
    const retryChange=new vscode.WorkspaceEdit();retryChange.replace(draftUri,new vscode.Range(draftDoc.positionAt(0),draftDoc.positionAt(draftDoc.getText().length)),'fresh draft after discard\n');
    assert.equal(await vscode.workspace.applyEdit(retryChange),true);assert.equal(await draftDoc.save(),true);assert.equal(published,1);
    console.log('Edit integration OK: native diff right-side editing, multi-file draft saved/published once, immutable Base, discarded draft and fresh writable session');
  } finally {
    const tabs=vscode.window.tabGroups.all.flatMap(group=>group.tabs.filter(tab=>[tab.input?.original?.scheme,tab.input?.modified?.scheme,tab.input?.uri?.scheme].some(scheme=>scheme===baseScheme||scheme===editScheme)));
    await vscode.window.tabGroups.close(tabs);registration.dispose();baseProvider.dispose();edits.dispose();
  }
}
module.exports={run};
