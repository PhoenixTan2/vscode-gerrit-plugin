'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('webview escapes server content and sends pinned change/revision with actions', () => {
  const events = {}; const messages = [];
  const app = { innerHTML: '', querySelectorAll: () => [], setAttribute() {}, addEventListener(name, fn) { events[name] = fn; } };
  const elements = { app, notice: {}, account: {} }; let onMessage;
  const sandbox = { acquireVsCodeApi: () => ({ postMessage: m => messages.push(m), getState: () => ({}), setState() {} }), document: { getElementById: id => elements[id] }, window: { addEventListener: (_, fn) => { onMessage = fn; } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/main.js'), 'utf8'), sandbox);
  assert.equal(messages[0].type, 'init');
  onMessage({ data: { type: 'state', model: { connected: true, detail: { id: 'p~main~Iabc', subject: '<script>alert(1)</script>', current_revision: 'abc123', revisions: { abc123: { _number: 3 } }, labels: {}, files: {}, comments: {} } } } });
  assert.ok(!app.innerHTML.includes('<script>alert'));
  assert.ok(app.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  events.click({ target: { closest: () => ({ dataset: { action: 'file', path: 'src/a.js' } }) } });
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
    acquireVsCodeApi: () => ({ postMessage: m => messages.push(m), getState: () => ({}), setState() {} }),
    document: { getElementById: id => elements[id] }, window: { addEventListener: (_, fn) => { onMessage = fn; } }
  });
  return { app, events, elements, messages, update: model => onMessage({ data: { type: 'state', model } }) };
}
test('sidebar exposes presets and page size without duplicate settings/log buttons', () => {
  const f = surfaceFixture(); f.update({ connected: true, query: 'is:open', changes: [], pageSize: 25, start: 25 });
  for (const text of ['Open', 'Merged', '与我相关', '每页最多 25 条', '第 2 页']) assert.ok(f.app.innerHTML.includes(text));
  for (const text of ['data-action="settings"', 'data-action="logs"']) assert.ok(!f.app.innerHTML.includes(text));
  f.events.click({ target: { closest: () => ({ dataset: { action: 'preset', query: 'is:merged' } }) } });
  assert.equal(f.messages.at(-1).query, 'is:merged');
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
  f.events.submit({ preventDefault() {}, target: { id: 'compare' } });
  assert.equal(f.messages.at(-1).left, 'old'); assert.equal(f.messages.at(-1).right, 'latest'); assert.equal(f.messages.at(-1).id, 'change');
  f.events.submit({ preventDefault() {}, target: { dataset: { form: 'reply', path: 'a.js', comment: 'root' }, querySelector: () => ({ value: 'reply on old patch' }) } });
  assert.equal(f.messages.at(-1).type, 'reply'); assert.equal(f.messages.at(-1).comment, 'root'); assert.equal(f.messages.at(-1).message, 'reply on old patch');
});
test('Commit expansion, update/submission timestamps and single patch file actions are visible', () => {
  const f = surfaceFixture(); const detail = { id: 'change', current_revision: 'rev', subject: 'test', created: '2026-01-01 00:00:00', updated: '2026-02-01 00:00:00', revisions: { rev: { _number: 2, created: '2026-01-02 00:00:00' } }, patchView: { rev: 'rev', files: ['src/a.js'] } };
  f.update({ connected: true, commitInfoExpanded: true, detail });
  assert.ok(f.app.innerHTML.includes('<details open><summary>Commit 信息'));
  for (const text of ['最后更新：', '提交时间：', '上传时间：', 'data-action="single"', 'data-patch-rev="rev"', '下载到本地']) assert.ok(f.app.innerHTML.includes(text));
  assert.ok(!f.app.innerHTML.includes('比较结果 · 文件'));
  f.update({ connected: true, commitInfoExpanded: false, detail });
  assert.ok(!f.app.innerHTML.includes('<details open><summary>Commit 信息'));
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
