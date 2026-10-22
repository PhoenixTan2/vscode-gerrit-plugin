'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const commands = new Map(); const executed = []; const created = []; const panels = []; const settings = {};
  const controller = { dispose() {}, createCommentThread(uri, range, comments) { const thread = { uri, range, comments, dispose() { this.disposed = true; } }; created.push(thread); return thread; } };
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; this.isEmpty = a === c && b === d; } }
  const api = {
    comments: { createCommentController: () => controller }, Range,
    StatusBarAlignment: { Left: 1 }, CommentMode: { Preview: 0 }, CommentThreadState: { Resolved: 1, Unresolved: 0 }, CommentThreadCollapsibleState: { Expanded: 1, Collapsed: 0 },
    window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }), registerWebviewViewProvider() {},
      createTextEditorDecorationType: options => ({ options, dispose() {} }), onDidChangeVisibleTextEditors() {}, visibleTextEditors: [], setStatusBarMessage() {}, showInformationMessage() {},
      createWebviewPanel: (...args) => { const panel = { webview: { postMessage() {} }, onDidDispose() {}, reveal: column => { panel.revealed = column; } }; panels.push({ args, panel }); return panel; }
    },
    Uri: { joinPath: (_, ...segments) => ({ path: segments.join('/') }), from: value => ({ ...value, toString: () => `${value.scheme}://${value.authority}${value.path}` }), parse: value => ({ toString: () => value }) },
    ThemeColor: class { constructor(id) { this.id = id; } }, OverviewRulerLane: { Full: 7 },
    Selection: class extends Range { constructor(...args) { super(...args); this.active = this.end; } }, TextEditorRevealType: { InCenter: 0 },
    env: { asExternalUri: async uri => uri },
    ViewColumn: { Beside: -2, Active: -1 },
    MarkdownString: class { constructor() { this.value = ''; } appendText(text) { this.value += text; } },
    Hover: class { constructor(contents) { this.contents = contents; } },
    languages: { registerHoverProvider() {} },
    workspace: { getConfiguration: () => ({ get: (key, value) => settings[key] ?? value }), onDidChangeConfiguration() {}, registerTextDocumentContentProvider() {} },
    commands: { registerCommand(name, handler) { commands.set(name, handler); }, executeCommand: async (...args) => executed.push(args), getCommands: async () => ['workbench.action.browser.open'] }
  };
  const context = { subscriptions: [] };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/extension'), 'utf8'), {
    module, Buffer, URL, AbortController, require: name => name === 'vscode' ? api : name.startsWith('./') ? require('../src/' + name.slice(2)) : require(name)
  });
  module.exports.activate(context);
  const app = context.subscriptions[0];
  const sent = [];
  app.api = { bytes: async (...args) => Buffer.from(await app.api.content(...args)), review: async (...args) => sent.push(args) };
  app.selected = { id: 'p~main~I1', rev: 'abc', change: { permitted_labels: { 'Code-Review': ['-1', ' 0', '+1'] } }, comments: {} };
  return { app, sent, controller, commands, Range, executed, created, panels, settings, vscode: api };
}
test('registers all visible commands and binds permitted review values', async () => {
  const { app, sent, commands } = fixture();
  assert.ok(commands.has('gerrit.comment')); assert.ok(commands.has('gerrit.push'));
  app.load = async () => {};
  await app.handle({ type: 'review', id: 'p~main~I1', rev: 'abc', message: 'LGTM', labels: { 'Code-Review': 1 } });
  assert.equal(sent[0][1], 'abc'); assert.equal(sent[0][2].labels['Code-Review'], 1);
  await assert.rejects(app.handle({ type: 'review', id: 'p~main~I1', rev: 'abc', labels: { 'Code-Review': 2 } }), /权限/);
  await assert.rejects(app.handle({ type: 'review', id: 'p~main~I1', rev: 'old', message: 'wrong patch' }), /页面已更新/);
  assert.equal(sent.length, 1);
});
test('parent-side multi-line comments retain exact range and revision', async () => {
  const { app, sent } = fixture();
  await app.postComment({ path: 'src/a.js', side: 'PARENT', line: 7, range: { start_line: 5, start_character: 1, end_line: 7, end_character: 3 } }, 'check boundary');
  const comment = sent[0][2].comments['src/a.js'][0];
  assert.equal(sent[0][1], 'abc'); assert.equal(comment.side, 'PARENT'); assert.equal(comment.range.start_line, 5); assert.equal(comment.line, 7);
});
test('native inline reply uses parent ID and keeps resolved state', async () => {
  const { app, sent } = fixture();
  app.load = async () => {};
  const thread = { uri: { toString: () => 'gerrit:test' } };
  app.threads.set(thread, { id: 'p~main~I1', rev: 'abc', path: 'a.js', side: 'PARENT', parent: { id: 'comment-1', line: 3, unresolved: false } });
  await app.reply({ thread, text: 'fixed' });
  const comment = sent[0][2].comments['a.js'][0];
  assert.equal(comment.in_reply_to, 'comment-1'); assert.equal(comment.unresolved, false); assert.equal(comment.side, 'PARENT'); assert.equal(comment.line, 3);
  app.selected.rev = 'new-patch';
  await assert.rejects(app.reply({ thread, text: 'stale' }), /旧变更/);
  assert.equal(sent.length, 1);
});
test('native new comment translates zero-based multiline ranges', async () => {
  const { app, sent, Range } = fixture(); app.load = async () => {};
  const uri = { toString: () => 'gerrit:current' }; let disposed = false;
  app.documents.set(uri.toString(), { id: 'p~main~I1', rev: 'abc', path: 'a.js', side: 'REVISION' });
  await app.reply({ thread: { uri, range: new Range(1, 2, 4, 5), dispose() { disposed = true; } }, text: 'test' });
  const c = sent[0][2].comments['a.js'][0];
  assert.equal(c.range.start_line, 2); assert.equal(c.range.end_line, 5); assert.equal(c.range.end_character, 5); assert.equal(c.line, 5); assert.equal(disposed, true);
});
test('commenting provider rejects old snapshots and unknown documents', () => {
  const { app, controller } = fixture();
  const document = { uri: { toString: () => 'gerrit:old' }, lineCount: 10 };
  assert.equal(controller.commentingRangeProvider.provideCommentingRanges(document), undefined);
  app.documents.set('gerrit:old', { id: 'p~main~I1', rev: 'old' });
  assert.equal(controller.commentingRangeProvider.provideCommentingRanges(document), undefined);
  app.documents.set('gerrit:old', { id: 'p~main~I1', rev: 'abc' });
  assert.equal(controller.commentingRangeProvider.provideCommentingRanges(document)[0].end.line, 9);
  app.selected = null;
  assert.equal(controller.commentingRangeProvider.provideCommentingRanges({ uri: { toString: () => 'file:ordinary' }, lineCount: 1 }), undefined);
});
test('historical patch comments publish to their own revision and hover shows only matching version', async () => {
  const { app, sent } = fixture();
  app.selected.change.revisions = { old: { _number: 1 }, abc: { _number: 3 } };
  app.selected.comments = { 'a.js': [
    { id: 'c1', patch_set: 1, line: 4, message: 'old discussion', author: { name: 'Alice' } },
    { id: 'c2', patch_set: 3, line: 4, message: 'latest discussion' }
  ] };
  const info = { id: app.selected.id, rev: 'old', path: 'a.js', side: 'REVISION', label: 'PS 1' };
  app.documents.set('gerrit:old', info);
  const hover = app.commentHover({ uri: { toString: () => 'gerrit:old' } }, { line: 3 });
  assert.ok(hover.contents.value.includes('old discussion'));
  assert.ok(!hover.contents.value.includes('latest discussion'));
  await app.postComment(info, 'reply to PS1');
  assert.equal(sent[0][1], 'old');
});
test('diff reads selected patch snapshots and tracks renamed left paths accurately', async () => {
  const { app, executed } = fixture(); const calls = [];
  app.api.url = 'https://review.example'; app.api.content = async (...args) => { calls.push(args); return 'code'; };
  app.selected.change.revisions = { old: { _number: 1 }, abc: { _number: 3 } };
  app.selected.comparison = { left: 'old', right: 'abc', revision: 'abc', base: 'old' };
  app.selected.files = { 'new.js': { status: 'R', old_path: 'old.js' } };
  app.attach = async () => {};
  await app.openDiff('new.js');
  assert.equal(calls[0][1], 'old'); assert.equal(calls[0][2], 'old.js'); assert.equal(calls[0][3], false);
  assert.equal(calls[1][1], 'abc'); assert.equal(calls[1][2], 'new.js');
  assert.equal(executed[0][0], 'vscode.diff');
  assert.ok(executed[0][3].includes('PS 1 ↔ PS 3'));
  assert.equal([...app.documents.values()][0].rev, 'old');
});
test('reverse Base diff loads parent on right and disables commenting on absent files', async () => {
  const { app, controller } = fixture(); const calls = [];
  app.api.url = 'https://review.example'; app.api.content = async (...args) => { calls.push(args); return 'parent'; };
  app.selected.change.revisions = { abc: { _number: 3 } };
  app.selected.comparison = { left: 'abc', right: 'base', revision: 'abc', reverse: true };
  app.selected.files = { 'deleted.js': { status: 'A' } }; app.attach = async () => {};
  await app.openDiff('deleted.js');
  assert.equal(calls.length, 1); assert.equal(calls[0][3], true);
  const [uri, info] = [...app.documents][0]; assert.equal(info.empty, true);
  assert.equal(controller.commentingRangeProvider.provideCommentingRanges({ uri: { toString: () => uri }, lineCount: 1 }), undefined);
});
test('right-click creates inline multiline input without posting immediately', async () => {
  const { app, created, sent, Range, vscode } = fixture();
  const uri = { toString: () => 'gerrit:current' };
  app.documents.set(uri.toString(), { id: app.selected.id, rev: 'abc', path: 'a.js', side: 'REVISION' });
  vscode.window.activeTextEditor = { document: { uri }, selection: new Range(2, 0, 4, 3) };
  await app.addComment();
  assert.equal(created.length, 1); assert.equal(created[0].range.start.line, 2); assert.equal(created[0].collapsibleState, 1);
  assert.equal(created[0].comments.length, 0); assert.equal(sent.length, 0);
});
test('Gerrit pages use the authenticated gateway in VS Code integrated browser', async () => {
  const { app, executed } = fixture(); app.api.url = 'https://review.example'; app.selected.change._number = 42;
  app.gateway = { entry: path => { assert.equal(path, '/c/42'); return 'http://127.0.0.1:3333/one-time-ticket'; } };
  await app.openBrowser();
  assert.equal(executed[0][0], 'workbench.action.browser.open'); assert.equal(executed[0][1], 'http://127.0.0.1:3333/one-time-ticket');
});
test('discussion creates and reuses a tab in the active editor group', () => {
  const { app, panels } = fixture(); app.setupWebview = () => {}; app.selected.change._number = 42;
  app.openDiscussion(); assert.equal(panels[0].args[2], -1);
  app.openDiscussion(); assert.equal(panels.length, 1); assert.equal(panels[0].panel.revealed, -1);
});
test('a reloaded sidebar receives initial state while another action is busy', () => {
  const { app } = fixture(); const messages = [];
  const webview = { postMessage: message => messages.push(message) };
  app.view = { webview }; app.busy = true;
  app.receiveMessage(webview, { type: 'init' });
  assert.ok(messages.some(m => m.type === 'state'));
  assert.ok(messages.some(m => m.type === 'busy' && m.value === true));
  app.receiveMessage(webview, { type: 'rendered', surface: 'sidebar' });
  assert.equal(app.sidebarReady, true);
});
test('single patch file opens a normal code editor, not a diff', async () => {
  const { app, executed, vscode } = fixture(); app.api.url = 'https://review.example';
  app.selected.change.revisions = { old: { _number: 1 }, abc: { _number: 3 } };
  const calls = []; app.api.content = async (...args) => { calls.push(args); return 'full snapshot'; };
  vscode.workspace.openTextDocument = async uri => ({ uri, lineCount: 1 });
  let opened; vscode.window.showTextDocument = async (document, options) => { opened = { document, options }; return { document }; };
  await app.openSingle('a.js', 'old');
  assert.equal(calls[0][1], 'old'); assert.equal(opened.options.viewColumn, -1);
  assert.equal(app.provideTextDocumentContent(opened.document.uri), 'full snapshot');
  assert.equal(executed.length, 0);
});
test('comment navigation visits distinct marked lines and wraps in both directions', async () => {
  const { app, vscode } = fixture();
  const uri = { toString: () => 'gerrit:marked' };
  app.documents.set(uri.toString(), { id: app.selected.id, rev: 'abc', path: 'a.js', side: 'REVISION' });
  app.selected.comments = { 'a.js': [{ id: 'a', line: 3, message: 'a' }, { id: 'reply', line: 3, message: 'reply' }, { id: 'b', line: 9, message: 'b' }] };
  const editor = { document: { uri, lineCount: 20 }, selection: new vscode.Selection(0, 0, 0, 0), revealRange() {} };
  vscode.window.activeTextEditor = editor;
  await app.navigateComment(1); assert.equal(editor.selection.active.line, 2);
  await app.navigateComment(1); assert.equal(editor.selection.active.line, 8);
  await app.navigateComment(1); assert.equal(editor.selection.active.line, 2);
  await app.navigateComment(-1); assert.equal(editor.selection.active.line, 8);
});
test('comment decorations use public VS Code gutter/overview API without MinimapPosition', () => {
  const { app, vscode } = fixture(); const uri = { toString: () => 'gerrit:marks' };
  app.documents.set(uri.toString(), { id: app.selected.id, rev: 'abc', path: 'a.js', side: 'REVISION' });
  app.selected.comments = { 'a.js': [{ id: 'a', line: 3, message: 'a' }, { id: 'b', line: 3, message: 'b' }] };
  let marks; vscode.window.visibleTextEditors = [{ document: { uri, lineCount: 10, lineAt: () => ({ text: 'source code' }) }, setDecorations: (_, value) => { marks = value; } }];
  app.updateDecorations(); assert.equal(marks.length, 1); assert.ok(marks[0].renderOptions.after.contentText.includes('2'));
  assert.equal(app.commentDecoration.options.overviewRulerColor.id, 'gerrit.commentMarker');
  assert.equal(vscode.MinimapPosition, undefined);
  assert.equal(app.commentDecoration.options.minimap, undefined);
  assert.ok(app.commentDecoration.options.gutterIconPath);
});
test('changes are displayed newest update first and Commit expansion follows settings', async () => {
  const { app, settings } = fixture(); app.selected = null;
  app.api.list = async () => [{ id: 'old', updated: '2026-01-01 12:00:00' }, { id: 'new', updated: '2026-02-01 12:00:00' }];
  settings['commitInfo.defaultExpanded'] = true;
  await app.refresh(); assert.equal(app.model.changes[0].id, 'new'); assert.equal(app.model.commitInfoExpanded, true);
});

test('background download releases global busy state, pins target and completes without awaiting notification', async () => {
  const { app, vscode } = fixture(); let finishFetch;
  const fetchGate = new Promise(resolve => { finishFetch = resolve; }); const calls = [];
  const sha = 'a'.repeat(40);
  app.selected.change = { _number: 142, project: 'team/project', revisions: { abc: { _number: 3, ref: 'refs/changes/42/142/3', fetch: { ssh: { url: 'ssh://alice@example/team/project' } } } } };
  app.selected.rev = sha; app.selected.change.revisions[sha] = app.selected.change.revisions.abc;
  app.model.detail = {}; app.user = { username: 'alice' }; app.localRepository = async () => '/repo';
  vscode.ProgressLocation = { Notification: 15 };
  vscode.window.withProgress = (_, fn) => fn({ report() {} });
  vscode.window.showInformationMessage = () => new Promise(() => {});
  vscode.window.showOpenDialog = () => { throw new Error('Must not choose a new folder'); };
  vscode.window.showErrorMessage = () => {};
  app.runGit = async (_, args) => { calls.push(args); if (args[0] === 'fetch') await fetchGate; return args[0] === 'rev-parse' ? sha : ''; };
  await app.run(() => app.download());
  assert.equal(app.busy, false);
  const job = [...app.downloadJobs.values()][0]; assert.equal(job.status, 'running');
  await assert.rejects(app.download(), /已有下载/);
  app.selected = null; // Navigating away must not change the task target.
  finishFetch(); await job.promise;
  assert.equal(job.status, 'completed'); assert.equal(job.branch, 'change-142');
  assert.ok(calls.at(-1).includes(sha));
  assert.equal(app.model.downloads[0].status, 'completed');
});
test('background failures settle the task and allow retry', async () => {
  const { app, vscode } = fixture(); const sha = 'a'.repeat(40);
  app.selected.rev = sha; app.selected.change = { _number: 1, project: 'p', revisions: { [sha]: { _number: 1, ref: 'refs/changes/01/1/1', fetch: { ssh: { url: 'ssh://u@example/p' } } } } };
  app.model.detail = {}; app.user = {}; app.localRepository = async () => '/repo';
  vscode.ProgressLocation = { Notification: 15 }; vscode.window.withProgress = (_, fn) => fn({ report() {} }); vscode.window.showErrorMessage = () => {};
  app.runGit = async () => { throw new Error('test failure'); };
  await app.download(); const first = [...app.downloadJobs.values()][0]; await first.promise;
  assert.equal(first.status, 'failed'); assert.equal(first.stage, 'test failure');
  await app.download(); const second = [...app.downloadJobs.values()][0]; await second.promise;
  assert.notEqual(second.id, first.id);
});
test('local repository selection discovers Git roots and only matches the Gerrit project', async () => {
  const { app, vscode } = fixture();
  vscode.workspace.isTrusted = true;
  vscode.extensions = { getExtension: () => ({ isActive: true, exports: { getAPI: () => ({ repositories: [{ rootUri: { fsPath: '/other' } }, { rootUri: { fsPath: '/repo' } }] }) } }) };
  app.runGit = async (cwd, args) => args[0] === 'rev-parse' ? cwd : args[0] === 'remote' && args.length === 1 ? 'origin' : cwd === '/repo' ? 'user@host:team/project.git' : 'https://host/other';
  assert.equal(await app.localRepository('team/project'), '/repo');
  await assert.rejects(app.localRepository('missing'), /请先在 VS Code/);
});

test('branch and personal review filters apply to every page and reset pagination', async () => {
  const { app } = fixture(); app.selected = null; const requests = [];
  app.api.list = async (query, start) => { requests.push({ query, start }); return [{ id: 'one', branch: 'release/1', updated: '2026-01-01', _more_changes: true }]; };
  app.model.query = 'owner:self OR reviewer:self'; app.model.start = 100;
  await app.handle({ type: 'filters', branch: 'release/1', unreviewed: true });
  assert.equal(requests[0].query, '(owner:self OR reviewer:self) branch:"release/1" is:open -reviewedby:self');
  assert.equal(requests[0].start, 0);
  await app.handle({ type: 'page', next: true });
  assert.equal(requests[1].query, requests[0].query); assert.equal(requests[1].start, 50);
  assert.equal(app.model.branchOptions[0], 'release/1');
  await app.handle({ type: 'search', query: 'is:open' });
  assert.ok(requests.at(-1).query.includes('branch:"release/1"'));
  const count = requests.length;
  await assert.rejects(app.handle({ type: 'filters', branch: 'bad\nbranch' }), /分支/);
  assert.equal(requests.length, count);
});
test('relation chain is loaded for a pinned revision and only known numbered nodes can be opened', async () => {
  const { app } = fixture(); const calls = []; app.model.detail = {};
  app.api.related = async (...args) => { calls.push(args); return { changes: [{ _change_number: 7, commit: { commit: 'dependency' } }, { commit: { commit: 'base' } }] }; };
  await app.handle({ type: 'related', id: app.selected.id, rev: app.selected.rev });
  assert.equal(calls[0][0], 'p~main~I1'); assert.equal(calls[0][1], 'abc');
  app.load = async id => calls.push(id);
  await app.handle({ type: 'relatedOpen', id: app.selected.id, rev: 'abc', number: '7' });
  assert.equal(calls.at(-1), '7');
  await assert.rejects(app.handle({ type: 'relatedOpen', id: app.selected.id, rev: 'abc', number: '8' }), /节点/);
  await assert.rejects(app.handle({ type: 'relatedOpen', id: app.selected.id, rev: 'old', number: '7' }), /页面已更新/);
});
test('file view resolves independently and stale comparison rows cannot open a new comparison', async () => {
  const { app, executed } = fixture(); const fileMessages = []; const sidebar = { webview: { postMessage() {} } };
  app.view = sidebar; app.setupWebview = () => {};
  const files = { webview: { postMessage: message => fileMessages.push(message) }, show: preserve => { files.preserve = preserve; } };
  await app.resolveFilesView(files);
  app.render(); assert.equal(app.view, sidebar); assert.equal(fileMessages.at(-1).model.surface, 'files');
  await app.showFiles(); assert.equal(files.preserve, true);
  app.receiveMessage(files.webview, { type: 'rendered' }); assert.equal(app.filesReady, true); assert.equal(app.sidebarReady, undefined);
  app.selected.comparison = { left: 'old', right: 'abc' }; app.openDiff = async path => executed.push(path);
  await assert.rejects(app.handle({ type: 'file', id: app.selected.id, rev: 'abc', compareLeft: 'base', compareRight: 'abc', path: 'a.c' }), /比较版本/);
  await app.handle({ type: 'file', id: app.selected.id, rev: 'abc', compareLeft: 'old', compareRight: 'abc', path: 'a.c' });
  assert.equal(executed.at(-1), 'a.c');
});

test('files marked binary by Gerrit still receive a native diff when original bytes are UTF16 text', async () => {
  const { app, executed } = fixture();
  app.api.url = 'https://review.example'; app.api.bytes = async () => Buffer.concat([Buffer.from([255,254]), Buffer.from('text\nnext','utf16le')]);
  app.selected.change._number = 1; app.selected.change.revisions = { old:{_number:1}, abc:{_number:2} };
  app.selected.comparison = { left:'old',right:'abc',revision:'abc',base:'old' };
  app.selected.files = { 'utf16.txt': { binary:true } }; app.attach=async()=>{};
  await app.openDiff('utf16.txt');
  assert.equal(executed[0][0], 'vscode.diff');
  assert.ok([...app.documents.values()].every(doc=>doc.content==='text\nnext'));
});
test('binary PDF comparisons preserve rename paths and represent a missing side without fetching it', async () => {
  const { app, executed } = fixture(); const pdfFixture = () => Buffer.from('%PDF-1.4 original bytes'); const calls=[]; let snapshots;
  app.selected.change.revisions={old:{_number:1},abc:{_number:2}};
  app.selected.comparison={left:'old',right:'abc',revision:'abc',base:'old'};
  app.selected.files={'new.pdf':{binary:true,status:'R',old_path:'old.pdf'}};
  app.api.bytes=async(...args)=>{calls.push(args);return pdfFixture();};
  app.nativeFiles.openPair=async value=>{snapshots=value;};
  await app.openDiff('new.pdf');
  assert.equal(calls[0][2],'old.pdf');assert.equal(calls[1][2],'new.pdf');
  assert.equal(snapshots[0].rev,'old'); assert.equal(snapshots[1].rev,'abc');
  assert.equal(executed.length,0);
  calls.length=0; app.selected.files['new.pdf']={binary:true,status:'A'};
  await app.openDiff('new.pdf');
  assert.equal(calls.length,1); assert.equal(snapshots[0].empty,true); assert.equal(snapshots[0].bytes.length,0);
});
test('message searches release global busy state and old searches cannot replace newer results', async () => {
  const { app }=fixture(); app.selected=null; let release;
  const gate=new Promise(resolve=>{release=resolve;});
  app.api.list=async(query,start,options)=>{if(options?.search)await gate;return options?.search?[{id:'one',subject:'test2'}]:[];};
  await app.run(()=>app.handle({type:'search',query:'is:open',message:'test',repo:'p',branch:'main',owner:'self'}));
  assert.equal(app.busy,false); const first=app.searchJob;
  assert.equal(first.status,'running');
  await app.handle({type:'search',query:'is:open',message:''}); release(); await first.promise;
  assert.equal(first.cancelled,true); assert.equal(app.model.message,''); assert.equal(app.searchResults,undefined);
});

test('partial searches survive detail navigation and stop bypasses global busy', async () => {
  const { app } = fixture(); app.selected = null;
  let release, entered; const gate = new Promise(resolve => { release = resolve; });
  const scanning = new Promise(resolve => { entered = resolve; });
  const messages = []; app.send = message => messages.push(message);
  app.api.list = async (query, start, options) => {
    if (!options?.search) return [{ id: 'one', subject: 'test2', updated: '2026-01-01' }];
    entered(); await gate; return [{ id: 'two', subject: 'test3', updated: '2026-01-02' }];
  };
  await app.handle({ type: 'search', query: 'is:open', message: 'test' });
  await scanning;
  assert.equal(app.model.changes[0].id, 'one');
  app.selected = { id: 'one' }; app.model.detail = { id: 'one' };
  await app.handle({ type: 'back' });
  assert.equal(app.searchJob.status, 'running');
  assert.equal(app.model.changes[0].id, 'one');
  app.busy = true;
  app.receiveMessage({}, { type: 'cancelSearch' });
  assert.equal(app.searchJob.status, 'cancelled');
  assert.equal(app.searchJob.controller.signal.aborted, true);
  assert.equal(app.searchResults.rows[0].id, 'one');
  release(); await app.searchJob.promise;
  assert.equal(app.model.changes.length, 1);
  assert.ok(messages.some(message => message.type === 'inboxResults'));
});

test('returning from detail never requests cached ordinary results again', async () => {
  const { app } = fixture(); let calls = 0;
  app.api.list = async () => { calls++; return []; };
  app.model.changes = [{ id: 'cached', subject: 'previous result' }];
  app.model.detail = { id: 'cached' };
  await app.handle({ type: 'back' });
  assert.equal(calls, 0); assert.equal(app.model.changes[0].id, 'cached');
});

test('search finishes in background while detail remains open and cached pages require no server requests', async () => {
  const { app } = fixture(); app.selected = null; app.model.pageSize = 1;
  let release, entered, calls = 0; const gate = new Promise(resolve => { release = resolve; });
  const scanning = new Promise(resolve => { entered = resolve; });
  app.api.list = async (query, start, options) => {
    calls++;
    if (!options?.search) return [{ id: 'one', subject: 'test1', updated: '2026-01-01' }];
    entered(); await gate; return [{ id: 'two', subject: 'test2', updated: '2026-01-02' }];
  };
  await app.handle({ type: 'search', query: 'is:open', message: 'test' }); await scanning;
  app.selected = { id: 'one' }; app.model.detail = { id: 'one' };
  let renders = 0; app.render = () => { renders++; };
  release(); await app.searchJob.promise;
  assert.equal(app.searchJob.status, 'completed');
  assert.equal(app.model.detail.id, 'one'); assert.equal(renders, 0);
  const requests = calls;
  await app.handle({ type: 'back' }); assert.equal(calls, requests);
  assert.equal(app.model.changes[0].id, 'two');
  await app.handle({ type: 'page', next: true });
  assert.equal(calls, requests); assert.equal(app.model.changes[0].id, 'one');
});

test('Patch path search ignores case, reuses its index and does not hold global busy', async () => {
  const { app } = fixture(); const rev = 'a'.repeat(40);
  app.selected.rev = rev; app.selected.change = { project: 'p', revisions: { [rev]: { _number: 1, ref: 'refs/changes/01/1/1', fetch: { ssh: { url: 'ssh://user@review.example/p' } } } } };
  app.model.detail = { id: app.selected.id, current_revision: rev };
  app.user = { username: 'user' }; app.localRepository = async () => { throw new Error('File lookup must not access workspace'); };
  let release, calls = 0; const gate = new Promise(resolve => { release = resolve; });
  app.pathIndex.read = async info => { calls++; assert.equal(info.revision, rev); await gate; return ['Boot/DeVice.c', 'Library/Init.c']; };
  await app.run(() => app.selectPatch(rev, 'device'));
  assert.equal(app.busy, false); assert.equal(app.model.detail.patchView.loading, true);
  release(); await app.patchQueryJob.promise;
  assert.deepEqual(Array.from(app.model.detail.patchView.files), ['Boot/DeVice.c']);
  await app.selectPatch(rev, 'DEVICE'); await app.patchQueryJob.promise;
  assert.equal(calls, 1); assert.equal(app.model.detail.patchView.files[0], 'Boot/DeVice.c');
  let finish; app.patchPaths = () => new Promise(resolve => { finish = resolve; });
  await app.selectPatch(rev, 'init'); const job = app.patchQueryJob;
  app.selected = null; app.model.detail = { id: 'different' }; finish(['Library/Init.c']); await job.promise;
  assert.equal(app.model.detail.id, 'different'); assert.equal(app.model.detail.patchView, undefined);
});

test('metadata links reset old filters and search the selected commit identity across statuses', async () => {
  for (const kind of ['author', 'committer', 'repo', 'branch', 'owner']) {
    const { app, executed } = fixture();
    app.selected.change = { project: 'team/p', branch: 'release', owner: { username: 'owner-user' }, revisions: { abc: { commit: { author: { name: 'Author', email: 'author@example.invalid' }, committer: { email: 'committer@example.invalid' }, parents: [{ commit: 'a'.repeat(40) }] } } } };
    Object.assign(app.model, { message: 'old', repo: 'old', branch: 'old', unreviewed: true, start: 50, detail: {} });
    let searched = false; app.refresh = async () => { searched = true; };
    await app.handle({ type: 'metadata', id: app.selected.id, rev: 'abc', kind, value: 'a'.repeat(40) });
    assert.equal(searched, true); assert.equal(app.selected, null); assert.equal(app.model.detail, undefined);
    assert.equal(app.model.message, ''); assert.equal(app.model.unreviewed, false); assert.equal(app.model.start, 0);
    assert.ok(executed.some(args => args[0] === 'gerrit.dashboard.focus'));
    if (kind === 'author') assert.equal(app.model.query, 'author:"author@example.invalid"');
    if (kind === 'committer') assert.equal(app.model.query, 'committer:"committer@example.invalid"');
    if (kind === 'repo' || kind === 'branch') assert.equal(app.model.repo, 'team/p');
    if (kind === 'branch') assert.equal(app.model.branch, 'release');
    if (kind === 'owner') assert.equal(app.model.owner, 'owner-user');
  }
  const { app } = fixture();
  await assert.rejects(app.handle({ type: 'metadata', id: app.selected.id, rev: 'old', kind: 'repo' }), /页面已更新/);
  await assert.rejects(app.searchMetadata('parent', 'b'.repeat(40)), /不支持/);
});

test('result navigation follows full cached message order, crosses pages and never searches again', async () => {
  const { app } = fixture();
  Object.assign(app.model, { query: 'is:open', message: 'test', pageSize: 1, start: 0, changes: [{ id: 'a' }] });
  const plan = require('../src/inbox').searchPlan(app.model.query, app.model);
  app.searchResults = { key: JSON.stringify(plan), rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  app.selected = { id: 'a', rev: 'abc' };
  app.api.list = async () => { throw new Error('must use cache'); };
  const opened = []; app.load = async id => { opened.push(id); app.selected = { id, rev: 'abc' }; };
  await app.handle({ type: 'navigate', id: 'a', rev: 'abc', direction: 1 });
  assert.equal(opened[0], 'b'); assert.equal(app.model.start, 1);
  assert.equal(app.resultNavigation().index, 2);
  await app.navigateResult(1); assert.equal(opened.at(-1), 'c'); assert.equal(app.resultNavigation().next, false);
  await app.navigateResult(-1); assert.equal(opened.at(-1), 'b');
  await assert.rejects(app.navigateResult(4), /方向/);
});

test('ordinary navigation fetches each result page once and reuses pages in both directions', async () => {
  const { app } = fixture(); app.selected = null; const requested = [];
  Object.assign(app.model, { query: 'is:open', pageSize: 2, start: 0 });
  app.api.list = async (query, start) => { requested.push(start); return start === 0 ? [{ id: 'a', updated: '2' }, { id: 'b', updated: '1', _more_changes: true }] : [{ id: 'c', updated: '0' }]; };
  await app.refresh();
  app.selected = { id: 'b', rev: 'r' };
  app.load = async id => { app.selected = { id, rev: 'r' }; };
  await app.navigateResult(1); assert.equal(app.selected.id, 'c'); assert.equal(app.resultNavigation().next, false);
  await app.navigateResult(-1); assert.equal(app.selected.id, 'b'); assert.equal(app.model.start, 0);
  await app.navigateResult(1); assert.deepEqual(requested, [0, 2]);
});

test('relation default expansion is supplied by settings and loading only updates its own region', async () => {
  const { app, settings } = fixture(); const sent = [];
  settings['relationChain.defaultExpanded'] = true; app.render(); assert.equal(app.model.relationChainExpanded, true);
  app.model.detail = {}; app.api.related = async () => ({ changes: [] }); app.send = message => sent.push(message);
  app.render = () => { throw new Error('must preserve active editor'); };
  await app.loadRelated(); assert.equal(sent[0].type, 'relatedState');
});

function familyFixture() {
  const f = fixture(), { app } = f;
  const childSha = 'c'.repeat(40), oldChild = 'b'.repeat(40), parentSha = 'a'.repeat(40), latestParent = 'd'.repeat(40), grandSha = 'e'.repeat(40);
  const changes = {
    child: { id: 'child', _number: 3, project: 'p', branch: 'main', subject: 'Child', owner: {}, current_revision: childSha, revisions: { [oldChild]: { _number: 1, commit: { message: 'Old child', parents: [] } }, [childSha]: { _number: 2, commit: { message: 'Child', parents: [{ commit: parentSha }] } } } },
    parent: { id: 'parent', _number: 2, project: 'p', branch: 'main', subject: 'Latest parent', owner: {}, current_revision: latestParent, revisions: { [parentSha]: { _number: 1, commit: { message: 'Exact parent', parents: [{ commit: grandSha }] } }, [latestParent]: { _number: 2, commit: { message: 'Latest parent', parents: [] } } } },
    grand: { id: 'grand', _number: 1, project: 'p', branch: 'main', subject: 'Grand', owner: {}, current_revision: grandSha, revisions: { [grandSha]: { _number: 1, commit: { message: 'Grand', parents: [] } } } }
  };
  app.selected = null; app.user = { _account_id: 1 }; app.showFiles = async () => {};
  app.api.url = 'https://review.example.invalid';
  app.api.detail = async id => changes[id];
  app.api.files = async () => ({ 'code.c': {} }); app.api.allComments = async () => ({});
  app.api.related = async (id, rev) => ({ changes: [{ commit: { commit: rev } }] });
  const queries = []; app.api.list = async query => {
    queries.push(query);
    return query.endsWith(parentSha) ? [changes.parent] : query.endsWith(grandSha) ? [changes.grand] : [];
  };
  app.model.changes = [{ id: 'child', updated: 'today' }];
  return { ...f, changes, queries, childSha, oldChild, parentSha, latestParent, grandSha };
}
test('context preloads while collapsed without holding busy and ignores superseded responses', async () => {
  const { app, settings } = familyFixture(); settings['relationChain.defaultExpanded'] = false; let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  app.api.related = async (id, rev) => { if (id === 'child') await gate; return { changes: [{ commit: { commit: rev } }] }; };
  const messages = []; app.send = message => messages.push(message);
  await app.run(() => app.load('child'));
  assert.equal(app.busy, false); assert.equal(app.model.relationChainExpanded, false);
  assert.equal(app.model.detail.related.status, 'loading');
  const oldJob = app.contextJob;
  await app.load('parent'); await app.contextJob; finish(); await oldJob;
  assert.equal(app.selected.id, 'parent'); assert.equal(app.model.detail.related.status, 'completed');
  assert.ok(!messages.some(message => message.type === 'relatedState' && message.id === 'child'));
});

test('parent navigation pins exact historical Patch, returns through ancestors and restores child comparison', async () => {
  const { app, childSha, oldChild, parentSha, latestParent, grandSha, queries } = familyFixture();
  await app.load('child'); await app.contextJob;
  assert.equal(app.model.detail.parentTargets[parentSha].status, 'found');
  await app.compare(oldChild, childSha);
  app.model.detail.patchView = { rev: oldChild, query: '', files: ['code.c'] };
  await app.openParent(parentSha); await app.contextJob;
  assert.equal(app.selected.id, 'parent'); assert.equal(app.selected.rev, latestParent);
  assert.equal(app.model.detail.viewRevision, parentSha); assert.equal(app.selected.comparison.right, parentSha);
  assert.equal(app.model.detail.patchView.rev, parentSha); assert.equal(app.model.parentNavigation.number, 3);
  await assert.rejects(app.navigateResult(1), /返回子提交/);
  await assert.rejects(app.handle({ type: 'review', id: 'parent', rev: latestParent, message: 'wrong PS' }), /历史 PS/);
  await app.openParent(grandSha); assert.equal(app.parentTrail.length, 2);
  await app.returnChild(); assert.equal(app.selected.id, 'parent'); assert.equal(app.model.detail.viewRevision, parentSha);
  await app.returnChild();
  assert.equal(app.selected.id, 'child'); assert.equal(app.parentTrail.length, 0);
  assert.equal(app.selected.comparison.left, oldChild); assert.equal(app.selected.comparison.right, childSha);
  assert.equal(app.model.detail.patchView.rev, oldChild); assert.equal(app.model.parentNavigation, undefined);
  assert.ok(queries.every(query => query.startsWith('project:')));
});

test('missing parent has no navigation target and failed jumps retain their return context', async () => {
  const { app, parentSha } = familyFixture();
  app.api.list = async () => [];
  await app.load('child'); await app.contextJob;
  assert.equal(app.model.detail.parentTargets[parentSha].status, 'missing');
  await assert.rejects(app.openParent(parentSha), /没有已确认/);
  app.model.detail.parentTargets[parentSha] = { status: 'found', changes: [{ id: 'unavailable', number: 2 }] };
  app.api.detail = async () => { throw new Error('network failure'); };
  await assert.rejects(app.openParent(parentSha), /network failure/);
  assert.equal(app.parentTrail.length, 0); assert.equal(app.selected.id, 'child');
});

test('switching a historical parent to latest permits review there while retaining return-to-child navigation', async () => {
  const { app, parentSha, latestParent } = familyFixture();
  await app.load('child'); await app.contextJob; await app.openParent(parentSha);
  await app.handle({ type: 'openLatest', id: 'parent', rev: latestParent });
  assert.equal(app.model.detail.viewRevision, latestParent);
  assert.equal(app.parentTrail.length, 1); assert.equal(app.model.parentNavigation.number, 3);
});

test('parent resolution prefers the current branch across query pages and ambiguous selection can be cancelled', async () => {
  const { app, vscode, parentSha, changes } = familyFixture();
  const offsets = [];
  app.api.list = async (query, start, options) => {
    assert.equal(options.search, true); offsets.push(start);
    return start === 0 ? [{ ...changes.parent, id: 'other-branch', branch: 'release', _more_changes: true }] : [changes.parent];
  };
  await app.load('child'); await app.contextJob;
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(app.model.detail.parentTargets[parentSha].changes[0].id, 'parent');
  app.model.detail.parentTargets[parentSha].changes.push({ id: 'another', number: 9, branch: 'main', subject: 'Another', patch: 1 });
  app.selected.change.project = 'p';
  app.model.detail.parentTargets[parentSha].changes[0].subject = 'Parent';
  vscode.window.showQuickPick = async () => undefined;
  await app.openParent(parentSha);
  assert.equal(app.selected.id, 'child'); assert.equal(app.parentTrail.length, 0);
});
test('preload failures leave the detail usable and never manufacture parent links', async () => {
  const { app, parentSha } = familyFixture();
  app.api.related = async () => { throw new Error('relation unavailable'); };
  app.api.list = async () => { throw new Error('query unavailable'); };
  await app.run(() => app.load('child')); await app.contextJob;
  assert.equal(app.busy, false); assert.equal(app.selected.id, 'child');
  assert.equal(app.model.detail.related.status, 'failed');
  assert.equal(app.model.detail.parentTargets[parentSha].status, 'failed');
  await assert.rejects(app.openParent(parentSha), /没有已确认/);
});

test('normal refresh follows new latest PS while explicit parent SHA remains pinned', async () => {
  const { app, changes, childSha } = familyFixture();
  await app.load('child'); await app.contextJob;
  const newer = 'f'.repeat(40);
  changes.child.revisions[newer] = { _number: 3, commit: { message: 'New child', parents: [] } };
  changes.child.current_revision = newer;
  await app.load('child');
  assert.equal(app.model.detail.viewRevision, newer);
  assert.equal(app.model.detail.comparison.right, newer); assert.equal(app.model.detail.patchView.rev, newer);
  await app.load('child', true, { revision: childSha });
  await app.load('child');
  assert.equal(app.model.detail.viewRevision, childSha); assert.equal(app.model.detail.viewPinned, true);
  assert.equal(app.model.detail.comparison.right, childSha);
});

test('version file lookup opens an unchanged header from Gerrit with an unrelated workspace', async () => {
  const { app, vscode } = fixture(); const rev = 'a'.repeat(40), id = app.selected.id;
  app.selected.rev = rev; app.selected.change = { project: 'remote/project', revisions: { [rev]: { _number: 1, ref: 'refs/changes/01/1/1', fetch: { ssh: { url: 'ssh://user@review.example/project' } } } } };
  app.user = { username: 'user' }; app.model.detail = { id, current_revision: rev };
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: 'D:/unrelated-project' } }];
  app.localRepository = async () => { throw new Error('must not inspect workspace'); };
  app.pathIndex.read = async () => ['Include/Unmodified.h', 'Source/Main.c'];
  app.api.url = 'https://review.example.invalid';
  const reads = []; app.api.bytes = async (...args) => { reads.push(args); return Buffer.from('#define HEADER 1\n'); };
  vscode.workspace.openTextDocument = async uri => ({ uri });
  vscode.window.showTextDocument = async document => ({ document }); app.attach = async () => {};
  await app.selectPatch(rev, 'UNMODIFIED'); await app.patchQueryJob.promise;
  await app.handle({ type: 'single', id, rev, patchRev: rev, path: 'Include/Unmodified.h' });
  assert.deepEqual(reads[0].slice(0, 3), [id, rev, 'Include/Unmodified.h']);
});

test('new matches remain pending after opening a result until explicitly merged', async () => {
  const { app } = fixture(); app.selected = null;
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), scanning = new Promise(resolve => { entered = resolve; });
  app.api.list = async (query,start,options) => {
    if (!options?.search) return [{id:'first',subject:'test',updated:'1'}];
    entered(); await gate; return [{id:'second',subject:'test',updated:'2'}];
  };
  await app.handle({type:'search',query:'is:open',message:'test'}); await scanning;
  app.load = async id => { app.selected = {id,rev:'r'}; };
  await app.handle({type:'open',id:'first'});
  release(); await app.searchJob.promise;
  assert.deepEqual(Array.from(app.searchResults.rows, x=>x.id), ['first']);
  assert.equal(app.model.searchUpdates.pending,1); assert.equal(app.resultNavigation().next,false);
  app.applySearchUpdates();
  assert.deepEqual(Array.from(app.searchResults.rows,x=>x.id),['second','first']); assert.equal(app.model.searchUpdates.pending,0);
  assert.equal(app.resultNavigation().index,2);
});
test('detail refresh does not rerun list or Message search and preserves parent path', async () => {
  const { app } = fixture(); const calls=[];
  app.parentTrail=[{id:'origin',number:9}]; app.load=async id=>calls.push(id); app.refresh=async()=>{throw new Error('must not search');};
  await app.handle({type:'refresh'}); assert.deepEqual(calls,['p~main~I1']); assert.equal(app.parentTrail.length,1);
});
test('breadcrumbs return directly to any ancestor and failed navigation restores the full path', async () => {
  const { app, parentSha, grandSha } = familyFixture();
  await app.load('child'); await app.contextJob; await app.openParent(parentSha); await app.contextJob; await app.openParent(grandSha);
  assert.deepEqual(Array.from(app.model.breadcrumbs,x=>x.number),[3,2]);
  const detail = app.api.detail; app.api.detail = async()=>{throw new Error('offline');};
  await assert.rejects(app.returnChild(0),/offline/); assert.equal(app.parentTrail.length,2);
  app.api.detail=detail; await app.returnChild(0); assert.equal(app.selected.id,'child'); assert.equal(app.parentTrail.length,0);
});
test('task controls bypass busy state, retry failed work and never serialize API credentials', async () => {
  const { app } = fixture(); app.api.auth='PRIVATE_AUTH'; app.busy=true;
  let attempts=0; const job={status:'running',controller:new AbortController()};
  app.registerTask('index','Index',job,async()=>{attempts++;});
  app.receiveMessage({}, {type:'taskCancel',taskId:job.taskId});
  assert.equal(job.controller.signal.aborted,true); assert.equal(job.status,'cancelled');
  job.settled=true; await app.receiveMessage({}, {type:'taskRetry',taskId:job.taskId}); assert.equal(attempts,1);
  assert.ok(!JSON.stringify(app.taskSnapshot()).includes('PRIVATE_AUTH'));
  app.downloadJobs.set('x',{...job,id:'x',api:app.api}); assert.ok(!JSON.stringify(app.downloadSnapshot()).includes('PRIVATE_AUTH'));
  const checkout={status:'running',canCancel:false,controller:new AbortController()};
  app.registerTask('download','Checkout',checkout,async()=>{}); app.cancelTask(checkout.taskId); assert.equal(checkout.controller.signal.aborted,false);
});
test('new PS resets changed file reads, carries unchanged reads and persists manual markers', async () => {
  const { app, changes, oldChild, childSha } = familyFixture();
  const key=app.reviewProgress.key(app.api.url,1,'child');
  app.reviewProgress.prepare(key,oldChild); await app.reviewProgress.mark(key,oldChild,'same.h',true); await app.reviewProgress.mark(key,oldChild,'code.c',true);
  app.api.files=async(id,rev,base)=>base===oldChild?{'code.c':{}}:{'code.c':{},'same.h':{}};
  await app.load('child'); await app.progressPromise;
  assert.deepEqual(Array.from(app.model.detail.fileProgress.read),['same.h']); assert.ok(app.model.detail.fileProgress.changed.includes('code.c'));
  await app.handle({type:'fileRead',id:'child',rev:childSha,fileRev:childSha,path:'code.c',read:true}); await app.progressPromise;
  assert.ok(app.model.detail.fileProgress.read.includes('code.c'));
  await assert.rejects(app.markFileRead('other.h',childSha,true),/文件或比较版本/);
});


test('connection defaults to web password, documents exclusive modes and skips HTTP confirmation', async () => {
  const { app, vscode } = fixture(), inputs = [], picks = [];
  const values = ['http://192.0.2.10', 'tester', 'test-only-password'];
  app.context.globalState = { get: () => ({}), update: async () => {} };
  app.context.secrets = { store: async () => {} }; app.refresh = async () => {};
  app.confirm = async () => { throw new Error('unexpected HTTP warning'); };
  vscode.window.showInputBox = async options => { inputs.push(options); return values.shift(); };
  vscode.window.showQuickPick = async (modes, options) => { picks.push({ modes, options }); return modes[0]; };
  let chosen; app.createApi = (url, user, secret, mode) => { chosen = mode; return { self: async () => ({ username: user }) }; };
  await app.connect();
  assert.equal(chosen, 'webPassword'); assert.ok(inputs[0].prompt.includes('http://192.168.1.10'));
  assert.ok(picks[0].options.title.includes('二选一')); assert.equal(app.model.commitInfoExpanded, true); assert.equal(app.model.relationChainExpanded, true);
});

test('oversized comparisons reject before content fetch and return-to-comparison focuses the sidebar', async () => {
  const { app, executed } = fixture(); let fetched = false; const sent = [];
  app.selected.files = { 'huge.bin': { size: 25 * 1024 * 1024, size_delta: 0 } };
  app.api.bytes = async () => { fetched = true; }; app.view = { webview: { postMessage: data => sent.push(data) } };
  await assert.rejects(app.openDiff('huge.bin'), /32MB/); assert.equal(fetched, false);
  await app.handle({ type: 'returnComparison', id: app.selected.id, rev: app.selected.rev });
  assert.equal(executed.at(-1)[0], 'gerrit.dashboard.focus'); assert.equal(sent.at(-1).type, 'focusComparison');
});

test('number and file filters persist across paging and metadata navigation clears both', async () => {
  const { app } = familyFixture(), queries = [];
  app.selected = null; app.api.list = async query => { queries.push(query); return []; };
  await app.handle({ type: 'search', query: 'is:open', changeNumber: '#322', file: 'Header.H' });
  assert.ok(queries[0].includes('change:322')); assert.ok(queries[0].includes('file:'));
  await app.handle({ type: 'page', next: true }); assert.equal(queries[1], queries[0]);
  await app.load('child'); await app.searchMetadata('repo', '');
  assert.equal(app.model.changeNumber, ''); assert.equal(app.model.file, '');
});
