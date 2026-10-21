'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
async function run() {
  try {
    const extension = vscode.extensions.getExtension('local-tools.gerrit-workbench');
    assert.ok(extension, 'Development extension must be discovered');
    const icon = fs.readFileSync(require('node:path').join(extension.extensionPath, extension.packageJSON.icon));
    assert.equal(icon.subarray(1,4).toString(), 'PNG'); assert.equal(icon.readUInt32BE(16),256); assert.equal(icon.readUInt32BE(20),256);
    await extension.activate();
    assert.equal(extension.isActive, true, 'Extension must activate with the real VS Code API');
    assert.ok(extension.packageJSON.contributes.views.gerritWorkbench, 'Workbench must use its own view container');
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('workbench.view.extension.gerrit'), 'Legacy Gerrit container fixture must be present');
    assert.ok(commands.includes('workbench.view.extension.gerritWorkbench'), 'Our container must remain separate');
    for (const id of ['gerrit.connect', 'gerrit.refresh', 'gerrit.logs', 'gerrit.comment', 'gerrit.fileComments']) assert.ok(commands.includes(id), `${id} must be registered`);
    await vscode.commands.executeCommand('workbench.view.extension.gerritWorkbench');
    await vscode.commands.executeCommand('gerrit.dashboard.focus');
    const deadline = Date.now() + 20000;
    let health;
    do {
      health = await vscode.commands.executeCommand('gerrit._viewStatus');
      if (health.error) throw new Error(health.error);
      if (health.ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(health?.ready, 'Sidebar client script must execute and render content');


    assert.ok(extension.packageJSON.contributes.viewsContainers.panel.some(container => container.id === 'gerritChanges'), 'Files must default to the bottom Panel');
    await vscode.commands.executeCommand('gerrit.showFiles');
    const filesDeadline = Date.now() + 20000;
    do {
      health = await vscode.commands.executeCommand('gerrit._viewStatus');
      if (health.filesError) throw new Error(health.filesError);
      if (health.filesReady) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < filesDeadline);
    assert.ok(health?.filesReady, 'Bottom files Webview must execute and render');

    // Render a representative review with the shipped script inside a real Webview.
    const fixture = {
      connected: true, surface: 'discussion', commitInfoExpanded: true, user: 'Reviewer', server: 'https://review.example.invalid',
      detail: { id: 'fixture', _number: 142, subject: 'Improve boot device initialization', status: 'NEW', project: 'team/firmware', branch: 'main',
        owner: { name: 'Alex' }, current_revision: 'a'.repeat(40), change_id: 'Ifixture',
        created: '2026-10-20 01:02:03', updated: '2026-10-21 07:08:09',
        revisions: { ['a'.repeat(40)]: { _number: 3, commit: { message: 'Improve boot device initialization\n\nKeep initialization deterministic.', author: { name: 'Alex', email: 'alex@example.invalid' }, committer: { name: 'Alex' } } } },
        labels: { 'Code-Review': { all: [{ name: 'Sam', value: 1 }] } }, permitted_labels: { 'Code-Review': ['-1', ' 0', '+1'] },
        comparison: { left: 'base', right: 'a'.repeat(40) },
        related: { rev: 'a'.repeat(40), changes: [{ _change_number: 141, _revision_number: 1, _current_revision_number: 2, status: 'NEW', commit: { commit: 'b'.repeat(40), subject: 'Dependency', parents: [] } }] },
        patchView: { rev: 'a'.repeat(40), files: ['Boot/Device.c'] }, files: { 'Boot/Device.c': { lines_inserted: 12, lines_deleted: 3 }, 'Library/Init.c': { lines_inserted: 3 } },
        comments: { 'Boot/Device.c': [{ id: 'root', patch_set: 3, line: 42, updated: '2026-10-21 06:30:01', unresolved: true, author: { name: 'Sam' }, message: 'Could we check the device state before initializing?' }] }, messages: []
      }
    };
    const panel = vscode.window.createWebviewPanel('gerrit.smoke.review', 'Review UI smoke', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [extension.extensionUri] });
    const nonce = require('node:crypto').randomBytes(16).toString('hex');
    const media = name => panel.webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'media', name));
    let fileAction, searchAction;
    const reviewResult = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Review Webview fixture did not render')), 15000);
      panel.webview.onDidReceiveMessage(message => {
        if (message.type === 'file') fileAction = message;
        if (message.type === 'search') searchAction = message;
        if (message.type === 'smokeResult') { clearTimeout(timeout); message.ok ? resolve() : reject(new Error(message.error)); }
        if (message.type === 'clientError') { clearTimeout(timeout); reject(new Error(message.message)); }
      });
    });
    const fixtureScript = `
      try {
        window.dispatchEvent(new MessageEvent('message', {data:{type:'state',model:${JSON.stringify(fixture)}}}));
        if (!document.querySelector('.discussion-layout') || !document.querySelector('#review') || !document.querySelector('.thread')) throw new Error('Review sections missing');
        if (document.getElementById('app').textContent.includes('提交时间')) throw new Error('Obsolete timestamp');

        const ratings = document.querySelector('.ratings'); const composer = document.querySelector('.composer');
        if (getComputedStyle(composer).position !== 'static' || ratings.getBoundingClientRect().bottom > composer.getBoundingClientRect().top) throw new Error('Composer overlaps current votes');
        window.scrollTo(0, document.body.scrollHeight);
        if (ratings.getBoundingClientRect().bottom > composer.getBoundingClientRect().top) throw new Error('Scrolling overlaps current votes');
        if (!document.querySelector('.chain-node') || !document.getElementById('app').textContent.includes('旧 PS')) throw new Error('Relation chain missing');

        document.querySelector('[data-action="tabCode"]').click();
        if (document.querySelector('#compare')) throw new Error('Discussion must not have comparison controls');
        if (!document.querySelector('[data-action="single"]') || !document.querySelector('[data-action="download"]')) throw new Error('Patch tools missing');
        document.querySelector('[data-action="tabDiscussion"]').click();
        const input = document.getElementById('review-message'); input.value='Unsent draft'; input.dispatchEvent(new Event('input',{bubbles:true}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'downloadState',downloads:[]}}));
        if (document.getElementById('review-message').value!=='Unsent draft') throw new Error('Draft replaced by download update');

        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,surface:'sidebar'}}}));
        if (!document.querySelector('.timestamps').nextElementSibling.matches('.commit-info')) throw new Error('Commit ordering');
        if (!document.querySelector('#compare') || document.querySelector('[data-action="file"]')) throw new Error('Sidebar comparison/file placement');
        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,surface:'files'}}}));
        const filter=document.getElementById('file-filter');
        filter.value='Device'; filter.dispatchEvent(new Event('input',{bubbles:true}));
        if (document.querySelectorAll('.file-row').length!==1) throw new Error('File path filtering');
        document.querySelector('.file-row').click();


        window.dispatchEvent(new MessageEvent('message',{data:{type:'state',model:{...model,detail:undefined,surface:'sidebar',query:'is:open'}}}));
        for (const [name, value] of Object.entries({message:'test',repo:'team/firmware',branch:'main',owner:'self'})) {
          const input=document.getElementById(name+'-filter'); if(!input) throw new Error('Missing search field '+name); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        document.getElementById('search').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));

        post('smokeResult',{ok:true});
      } catch(error) { post('smokeResult',{ok:false,error:error.stack}); }
    `;
    panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${media('style.css')}"></head><body><header><div id="account"></div></header><div id="notice"></div><main id="app"></main><script nonce="${nonce}" src="${media('main.js')}"></script><script nonce="${nonce}">${fixtureScript}</script></body></html>`;
    await reviewResult;
    assert.equal(fileAction?.id, 'fixture'); assert.equal(fileAction?.rev, 'a'.repeat(40));
    assert.equal(fileAction?.compareLeft, 'base'); assert.equal(fileAction?.compareRight, 'a'.repeat(40));
    assert.equal(fileAction?.path, 'Boot/Device.c');
    assert.equal(searchAction?.message, 'test'); assert.equal(searchAction?.repo, 'team/firmware');
    assert.equal(searchAction?.branch, 'main'); assert.equal(searchAction?.owner, 'self'); panel.dispose();


    const { NativeFiles } = require(require('node:path').join(extension.extensionPath, 'src', 'native-files.js'));
    const originals = new NativeFiles(vscode);
    const oldBytes = Buffer.from([0,255,80,75,3,4,1]), newBytes = Buffer.from([0,255,80,75,3,4,2]);
    await originals.openPair([
      {bytes:oldBytes,path:'workbook.xlsx',label:'PS 1'},
      {bytes:newBytes,path:'workbook.xlsx',label:'PS 2'}
    ]);
    const uris = [...originals.files.values()];
    assert.equal(uris.length,2); assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(uris[0])),oldBytes);
    assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(uris[1])),newBytes);
    const tabs = vscode.window.tabGroups.all.flatMap(group=>group.tabs.filter(tab=>uris.some(uri=>tab.input?.uri?.toString()===uri.toString())).map(tab=>({tab,column:group.viewColumn})));
    assert.equal(tabs.length,2); assert.notEqual(tabs[0].column,tabs[1].column,'Originals must open in two native groups');
    await vscode.window.tabGroups.close(tabs.map(item=>item.tab));
    await originals.dispose();

    await vscode.commands.executeCommand('gerrit.logs');
    fs.writeFileSync(process.env.GERRIT_HOST_SMOKE_RESULT, JSON.stringify({ ok: true, vscode: vscode.version, extension: extension.packageJSON.version }));
    console.log('Real Extension Host activation and sidebar smoke test passed');
  } catch (error) {
    fs.writeFileSync(process.env.GERRIT_HOST_SMOKE_RESULT, JSON.stringify({ ok: false, message: error.stack || error.message }));
    throw error;
  }
}
module.exports = { run };
