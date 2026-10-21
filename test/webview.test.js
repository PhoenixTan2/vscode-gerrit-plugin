'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('webview escapes server content and sends pinned change/revision with actions', () => {
  const events = {}; const messages = [];
  const app = { innerHTML: '', querySelectorAll: () => [], setAttribute() {}, addEventListener(name, fn) { events[name] = fn; } };
  const elements = { app, notice: {}, account: {} }; let onMessage;
  const sandbox = { markdownit: require('../media/vendor/markdown-it.min.js'), acquireVsCodeApi: () => ({ postMessage: m => messages.push(m), getState: () => ({}), setState() {} }), document: { getElementById: id => elements[id] }, window: { addEventListener: (_, fn) => { onMessage = fn; } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/main.js'), 'utf8'), sandbox);
  assert.equal(messages[0].type, 'init');
  onMessage({ data: { type: 'state', model: { connected: true, detail: { id: 'p~main~Iabc', subject: '<script>alert(1)</script>', current_revision: 'abc123', revisions: { abc123: { _number: 3 } }, labels: {}, files: {}, comments: {} } } } });
  assert.ok(!app.innerHTML.includes('<script>alert'));
  assert.ok(app.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'file', path: 'src/a.js' } }) } });
  assert.equal(messages.at(-1).id, 'p~main~Iabc');
  assert.equal(messages.at(-1).rev, 'abc123');
  assert.equal(messages.at(-1).path, 'src/a.js');
  assert.equal(messages.at(-1).type, 'file');
});
function surfaceFixture() {
  const events = {}; const messages = []; let onMessage;
  const elements = { notice: {}, account: {} };
  const app = { innerHTML: '', querySelectorAll: () => [], setAttribute() {}, addEventListener: (name, fn) => { events[name] = fn; } };
  elements.app = app;
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/main.js'), 'utf8'), {
    markdownit: require('../media/vendor/markdown-it.min.js'), acquireVsCodeApi: () => ({ postMessage: m => messages.push(m), getState: () => ({}), setState() {} }),
    document: { getElementById: id => elements[id] }, window: { addEventListener: (_, fn) => { onMessage = fn; } }
  });
  return { app, events, elements, messages, message: data => onMessage({ data }), update: model => onMessage({ data: { type: 'state', model } }) };
}
test('sidebar exposes presets and page size without duplicate settings/log buttons', () => {
  const f = surfaceFixture(); f.update({ connected: true, query: 'is:open', changes: [], pageSize: 25, start: 25 });
  for (const text of ['Open', 'Merged', '与我相关', '每页最多 25 条', '第 2 页']) assert.ok(f.app.innerHTML.includes(text));
  for (const text of ['data-action="settings"', 'data-action="logs"']) assert.ok(!f.app.innerHTML.includes(text));
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'preset', query: 'is:merged' } }) } });
  assert.equal(f.messages.at(-1).query, 'is:merged');
  assert.equal(f.messages.at(-1).unreviewed, false);
});
test('discussion lives in its own surface, groups replies and escapes untrusted comment text', () => {
  const f = surfaceFixture();
  const model = { connected: true, surface: 'sidebar', detail: {
    id: 'change', _number: 42, current_revision: 'rev', revisions: { rev: { _number: 2 } },
    comments: { 'a.js': [
      { id: 'root', patch_set: 1, line: 3, updated: '2026-01-01', message: '<img src=x onerror=alert(1)>', unresolved: true },
      { id: 'reply', in_reply_to: 'root', patch_set: 1, line: 3, updated: '2026-01-02', message: 'reply text', unresolved: true }
    ] }
  } };
  f.update(model);
  assert.ok(!f.app.innerHTML.includes('reply text')); assert.ok(f.app.innerHTML.includes('打开评审讨论'));
  f.update({ ...model, surface: 'discussion' });
  assert.ok(f.app.innerHTML.includes('reply text'));
  assert.ok(!f.app.innerHTML.includes('<img src=x'));
  assert.ok(f.app.innerHTML.includes('&lt;img src=x'));
  assert.equal((f.app.innerHTML.match(/data-form="reply"/g) || []).length, 1);
  assert.ok(f.app.innerHTML.includes('定位到代码'));
});
test('compare form and reply form retain current change identity and exact targets', () => {
  const f = surfaceFixture();
  f.update({ connected: true, detail: { id: 'change', current_revision: 'latest', revisions: { latest: { _number: 3 } } } });
  f.elements['compare-left'] = { value: 'old' }; f.elements['compare-right'] = { value: 'latest' };
  f.events.change({ target: { id: 'compare-left' } });
  assert.equal(f.messages.at(-1).left, 'old'); assert.equal(f.messages.at(-1).right, 'latest'); assert.equal(f.messages.at(-1).id, 'change');
  f.events.submit({ preventDefault() {}, target: { dataset: { form: 'reply', path: 'a.js', comment: 'root' }, querySelector: () => ({ value: 'reply on old patch' }) } });
  assert.equal(f.messages.at(-1).type, 'reply'); assert.equal(f.messages.at(-1).comment, 'root'); assert.equal(f.messages.at(-1).message, 'reply on old patch');
});
test('review hub aligns creation/update dates and hosts Commit, single Patch and download controls', () => {
  const f = surfaceFixture(); const detail = { id: 'change', _number: 42, current_revision: 'rev', subject: 'test', created: '2026-01-01 00:00:00', updated: '2026-02-01 00:00:00', revisions: { rev: { _number: 2, commit: { message: 'Commit body', committer: { date: '2026-01-02' } } } }, patchView: { rev: 'rev', files: ['src/a.js'] } };
  f.update({ connected: true, commitInfoExpanded: true, detail });
  assert.ok(f.app.innerHTML.includes('class="commit-info" open'));
  assert.ok(!f.app.innerHTML.includes('data-action="download"'));
  assert.ok(!f.app.innerHTML.includes('data-action="single"'));
  f.update({ connected: true, surface: 'discussion', commitInfoExpanded: true, detail });
  assert.ok(f.app.innerHTML.includes('Commit body'));
  assert.ok(f.app.innerHTML.includes('class="timestamps"'));
  assert.ok(f.app.innerHTML.indexOf('创建时间') < f.app.innerHTML.indexOf('最后更新'));
  assert.ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(f.app.innerHTML));
  for (const text of ['提交时间', '上传时间', '2026-01-02']) assert.ok(!f.app.innerHTML.includes(text));
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'tabCode' } }) } });
  for (const text of ['data-action="single"', 'data-patch-rev="rev"', '下载到本地', 'SSH', 'change-42']) assert.ok(f.app.innerHTML.includes(text));
  f.elements['patch-revision'] = { value: 'rev' };
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'download' } }) } });
  assert.equal(f.messages.at(-1).patchRev, 'rev');
  f.update({ connected: true, surface: 'discussion', commitInfoExpanded: false, detail });
  assert.ok(!f.app.innerHTML.includes('class="commit-info" open'));
});
test('download progress updates only task region and preserves review input', () => {
  const f = surfaceFixture();
  f.update({ connected: true, surface: 'discussion', detail: { id: 'change', current_revision: 'rev' } });
  f.elements['download-status'] = { innerHTML: '' };
  const before = f.app.innerHTML;
  f.message({ type: 'downloadState', downloads: [{ changeId: 'change', status: 'completed', stage: '下载完成', patch: 2, directory: '<local>', branch: 'change-42' }] });
  assert.equal(f.app.innerHTML, before);
  assert.ok(f.elements['download-status'].innerHTML.includes('下载完成'));
  assert.ok(f.elements['download-status'].innerHTML.includes('&lt;local&gt;'));
});

test('participated filter keeps complete threads where the current account wrote any message', () => {
  const f = surfaceFixture();
  const detail = { id: 'change', current_revision: 'rev', revisions: { rev: { _number: 1 } }, comments: {
    'a.js': [
      { id: 'root', message: 'someone started this', author: { _account_id: 1 } },
      { id: 'reply', in_reply_to: 'root', message: 'I participated here', author: { _account_id: 7 } },
      { id: 'other', message: 'unrelated thread', author: { _account_id: 2 } }
    ]
  } };
  f.update({ connected: true, surface: 'discussion', accountId: 7, detail });
  assert.ok(f.app.innerHTML.includes('unrelated thread'));
  f.events.change({ target: { id: 'participated-only', checked: true } });
  assert.ok(!f.app.innerHTML.includes('unrelated thread'));
  assert.ok(f.app.innerHTML.includes('someone started this')); assert.ok(f.app.innerHTML.includes('I participated here'));
});

test('sidebar places Commit immediately after timestamps and owns comparison controls exclusively', () => {
  const f = surfaceFixture(); const detail = { id: 'c', current_revision: 'r', revisions: { r: { _number: 1 } }, files: { 'file.c': {} } };
  f.update({ connected: true, detail });
  assert.ok(f.app.innerHTML.indexOf('class="timestamps"') < f.app.innerHTML.indexOf('class="commit-info"'));
  assert.ok(f.app.innerHTML.indexOf('class="commit-info"') < f.app.innerHTML.indexOf('class="review-entry"'));
  assert.ok(f.app.innerHTML.includes('id="compare"')); assert.ok(!f.app.innerHTML.includes('data-action="showFiles"'));
  assert.ok(!f.app.innerHTML.includes('data-action="file"'));
  f.update({ connected: true, surface: 'discussion', detail });
  assert.ok(f.app.innerHTML.indexOf('class="ratings"') < f.app.innerHTML.indexOf('class="card composer"'));
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'tabCode' } }) } });
  assert.ok(!f.app.innerHTML.includes('id="compare"'));
});
test('file panel lists every changed file, filters literal paths and retains exact diff identity', () => {
  const f = surfaceFixture();
  const files = Object.fromEntries(Array.from({ length: 350 }, (_, i) => [`src/file-${i}.c`, { lines_inserted: 2 }]));
  files['<unsafe>.c'] = { status: 'R', old_path: '<old>.c' }; files['/COMMIT_MSG'] = {};
  const detail = { id: 'change', _number: 5, current_revision: 'new', revisions: { new: { _number: 2 }, old: { _number: 1 } }, comparison: { left: 'old', right: 'new' }, files };
  f.update({ connected: true, surface: 'files', detail });
  assert.equal((f.app.innerHTML.match(/data-action="file"/g) || []).length, 351);
  assert.ok(!f.app.innerHTML.includes('/COMMIT_MSG')); assert.ok(f.app.innerHTML.includes('&lt;unsafe&gt;.c'));
  assert.ok(f.app.innerHTML.includes('PS 1 → PS 2'));
  f.elements['file-results'] = { innerHTML: '' };
  f.events.input({ target: { id: 'file-filter', value: 'FILE-349' } });
  assert.equal((f.elements['file-results'].innerHTML.match(/data-action="file"/g) || []).length, 1);
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'file', path: 'src/file-349.c' } }) } });
  assert.equal(f.messages.at(-1).compareLeft, 'old'); assert.equal(f.messages.at(-1).compareRight, 'new');
  f.update({ connected: true, surface: 'files', detail: { ...detail, id: 'other' } });
  assert.equal((f.app.innerHTML.match(/data-action="file"/g) || []).length, 351);
});
test('relation nodes distinguish historical PS and escape subjects without linking anonymous commits', () => {
  const f = surfaceFixture();
  f.update({ connected: true, detail: { id: 'c', current_revision: 'current', related: { changes: [
    { _change_number: 5, _revision_number: 1, _current_revision_number: 2, status: 'NEW', commit: { commit: 'oldsha', subject: '<dependency>', parents: [{ commit: 'base' }] } },
    { commit: { commit: 'base', subject: 'plain commit' } }
  ] } } });
  assert.ok(f.app.innerHTML.includes('旧 PS · 最新为 2')); assert.ok(f.app.innerHTML.includes('&lt;dependency&gt;'));
  assert.equal((f.app.innerHTML.match(/data-action="relatedOpen"/g) || []).length, 1);
  assert.ok(f.app.innerHTML.includes('父提交 ← base'));
});
test('Open cards translate NEW and distinguish personal review state, with filters sent to host', () => {
  const f = surfaceFixture();
  f.update({ connected: true, branch: 'main', unreviewed: true, branchOptions: ['main'], changes: [
    { id: 'one', status: 'NEW', subject: 'one', reviewed: true }, { id: 'two', status: 'NEW', subject: 'two' }
  ] });
  for (const text of ['评审中', '我已评审', '我未评审', '仅我未评审', 'id="branch-filter"']) assert.ok(f.app.innerHTML.includes(text));
  assert.ok(!f.app.innerHTML.includes('· NEW'));
  f.elements['branch-filter'] = { value: 'release/1' }; f.elements.query = { value: 'is:open' }; f.elements['unreviewed-only'] = { checked: true };
  f.events.change({ target: { id: 'unreviewed-only', checked: true } });
  assert.equal(f.messages.at(-1).type, 'search'); assert.equal(f.messages.at(-1).branch, 'release/1');
  f.events.submit({ preventDefault() {}, target: { id: 'search' } });
  assert.equal(f.messages.at(-1).unreviewed, true); assert.equal(f.messages.at(-1).query, 'is:open');
});

test('friendly search submits four fields and background progress does not replace unsent input', () => {
  const f=surfaceFixture(); f.update({connected:true,query:'is:open',changes:[]});
  for(const id of ['message-filter','repo-filter','branch-filter','owner-filter']) assert.ok(f.app.innerHTML.includes('id="'+id+'"'));
  Object.assign(f.elements,{'message-filter':{value:'test'},'repo-filter':{value:'team/repo'},'branch-filter':{value:'main'},'owner-filter':{value:'self'},query:{value:'is:open'},'unreviewed-only':{checked:false},'search-status':{innerHTML:''}});
  f.events.submit({preventDefault(){},target:{id:'search'}});
  const sent=f.messages.at(-1); assert.equal(sent.message,'test');assert.equal(sent.repo,'team/repo');assert.equal(sent.branch,'main');assert.equal(sent.owner,'self');
  const before=f.app.innerHTML; f.message({type:'searchProgress',searchStatus:{status:'running',scanned:100,matches:12}});
  assert.equal(f.app.innerHTML,before); assert.ok(f.elements['search-status'].innerHTML.includes('已检查 100'));
  f.events.click({target:{closest:()=>({dataset:{action:'resetSearch'}})}});
  const reset=f.messages.at(-1); assert.equal(reset.message,'');assert.equal(reset.repo,'');assert.equal(reset.branch,'');assert.equal(reset.owner,'');
});

test('incremental cards preserve search form and stop works while another action is busy', () => {
  const f = surfaceFixture();
  f.update({ connected: true, query: 'is:open', changes: [], start: 0, pageSize: 50 });
  assert.ok(f.app.innerHTML.includes('Abandoned')); assert.ok(!f.app.innerHTML.includes('待我评审'));
  const form = f.app.innerHTML;
  f.elements['inbox-results'] = { innerHTML: '' };
  f.message({ type: 'inboxResults', changes: [{ id: 'first', subject: '<first>', status: 'NEW', work_in_progress: true }], start: 0, more: false });
  assert.equal(f.app.innerHTML, form);
  assert.ok(f.elements['inbox-results'].innerHTML.includes('&lt;first&gt;'));
  assert.ok(f.elements['inbox-results'].innerHTML.includes('WIP'));
  f.message({ type: 'busy', value: true });
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'cancelSearch' } }) } });
  assert.equal(f.messages.at(-1).type, 'cancelSearch');
});

test('single Patch selection loads files immediately and has no browse button', () => {
  const f = surfaceFixture();
  f.update({ connected: true, surface: 'discussion', detail: { id: 'change', current_revision: 'rev', revisions: { rev: { _number: 1 } }, patchView: { rev: 'rev', files: ['code.c'] } } });
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'tabCode' } }) } });
  assert.ok(!f.app.innerHTML.includes('浏览此 Patch'));
  assert.ok(f.app.innerHTML.includes('code.c'));
  f.events.change({ target: { id: 'patch-revision', value: 'older' } });
  assert.equal(f.messages.at(-1).type, 'patch'); assert.equal(f.messages.at(-1).patchRev, 'older');
});

test('comparison selectors exclude the opposite selection and changes automatically request diff', () => {
  const f = surfaceFixture();
  f.update({ connected: true, detail: { id: 'c', current_revision: 'new', revisions: { old: { _number: 1 }, new: { _number: 2 } }, comparison: { left: 'base', right: 'new' } } });
  const leftHtml = f.app.innerHTML.match(/id="compare-left"[^>]*>(.*?)<\/select>/s)[1];
  const rightHtml = f.app.innerHTML.match(/id="compare-right"[^>]*>(.*?)<\/select>/s)[1];
  assert.ok(!leftHtml.includes('value="new"')); assert.ok(!rightHtml.includes('value="base"'));
  assert.ok(!f.app.innerHTML.includes('type="submit">比较'));
  f.elements['compare-left'] = { value: 'old' }; f.elements['compare-right'] = { value: 'new' };
  f.events.change({ target: { id: 'compare-left' } });
  assert.equal(f.messages.at(-1).type, 'compare'); assert.equal(f.messages.at(-1).left, 'old');
  assert.ok(!f.elements['compare-right'].innerHTML.includes('value="old"'));
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? null : ({ dataset: { action: 'swap' } }) } });
  assert.equal(f.messages.at(-1).left, 'new'); assert.equal(f.messages.at(-1).right, 'old');
});

test('comments render Markdown without raw HTML, unsafe links or remote image requests and fold to first lines', () => {
  const f = surfaceFixture();
  f.update({ connected: true, surface: 'discussion', detail: { id: 'c', current_revision: 'r', revisions: { r: { _number: 1 } }, comments: {
    'a.c': [{ id: 'first', message: '**First line**\n\n- one\n- two\n\n`code`\n\n[bad](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![image](https://example.invalid/x.png)' }]
  }, messages: [{ message: 'Activity first\nActivity second' }] } });
  assert.ok(f.app.innerHTML.includes('<strong>First line</strong>'));
  assert.ok(f.app.innerHTML.includes('<ul>')); assert.ok(f.app.innerHTML.includes('<code>code</code>'));
  assert.ok(!f.app.innerHTML.includes('<img')); assert.ok(!f.app.innerHTML.includes('href="javascript:'));
  assert.ok(f.app.innerHTML.includes('class="thread-summary"')); assert.ok(f.app.innerHTML.includes('class="activity-snippet" title="Activity first"'));
  assert.ok(f.app.innerHTML.includes('markdown-preview'));
  f.events.toggle({ target: { dataset: { threadKey: 'thread-one' }, open: false } });
});

test('Markdown editor switches to text on focus and preview on blur without losing draft value', () => {
  const f = surfaceFixture(); f.update({ connected: true });
  const hint = {}, input = { value: '**draft**', hidden: true, focus() { this.focused = true; } };
  const preview = { hidden: false, closest: () => editor };
  const editor = { querySelector: selector => selector === 'textarea' ? input : selector === '.markdown-preview' ? preview : hint };
  input.closest = () => editor; input.matches = () => true;
  f.events.click({ target: { closest: selector => selector === '.markdown-preview' ? preview : null } });
  assert.equal(input.hidden, false); assert.equal(input.focused, true); assert.equal(preview.hidden, true);
  f.events.focusout({ target: input });
  assert.equal(input.hidden, true); assert.equal(preview.hidden, false); assert.ok(preview.innerHTML.includes('<strong>draft</strong>'));
  assert.equal(input.value, '**draft**');
});

test('collapsed thread state survives a page redraw and publishing does not shift its click target', () => {
  const f = surfaceFixture();
  const model = { connected: true, surface: 'discussion', detail: { id: 'c', current_revision: 'r', comments: { 'a.c': [{ id: 'root', message: 'First line\nSecond line' }] } } };
  f.update(model);
  const threadKey = f.app.innerHTML.match(/data-thread-key="([^"]+)"/)[1];
  f.events.toggle({ target: { dataset: { threadKey }, open: false } });
  f.update(model);
  assert.ok(!new RegExp('data-thread-key="' + threadKey + '" open').test(f.app.innerHTML));
  let touched = false;
  f.events.focusout({ relatedTarget: { matches: () => true }, target: { matches: () => true, closest: () => { touched = true; } } });
  assert.equal(touched, false);
});
