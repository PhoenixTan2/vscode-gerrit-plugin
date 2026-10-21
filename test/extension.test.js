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
