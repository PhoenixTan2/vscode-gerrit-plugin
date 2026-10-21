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
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['gerrit.connect', 'gerrit.refresh', 'gerrit.logs', 'gerrit.comment', 'gerrit.fileComments']) assert.ok(commands.includes(id), `${id} must be registered`);
    await vscode.commands.executeCommand('gerrit.dashboard.focus');
    await vscode.commands.executeCommand('gerrit.logs');
    fs.writeFileSync(process.env.GERRIT_HOST_SMOKE_RESULT, JSON.stringify({ ok: true, vscode: vscode.version, extension: extension.packageJSON.version }));
    console.log('Real Extension Host activation and sidebar smoke test passed');
  } catch (error) {
    fs.writeFileSync(process.env.GERRIT_HOST_SMOKE_RESULT, JSON.stringify({ ok: false, message: error.stack || error.message }));
    throw error;
  }
}
module.exports = { run };
