'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
async function run() {
  try {
    const extension = vscode.extensions.getExtension('local-tools.gerrit-workbench');
    assert.ok(extension, 'Development extension must be discovered');
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
    await vscode.commands.executeCommand('gerrit.logs');
    fs.writeFileSync(process.env.GERRIT_HOST_SMOKE_RESULT, JSON.stringify({ ok: true, vscode: vscode.version, extension: extension.packageJSON.version }));
    console.log('Real Extension Host activation and sidebar smoke test passed');
  } catch (error) {
    fs.writeFileSync(process.env.GERRIT_HOST_SMOKE_RESULT, JSON.stringify({ ok: false, message: error.stack || error.message }));
    throw error;
  }
}
module.exports = { run };
