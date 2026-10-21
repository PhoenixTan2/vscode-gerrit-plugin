'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReviewProgress } = require('../src/review-progress');
function storage() { const data = new Map(); return { get: (k,d) => data.get(k) || d, update: async (k,v) => { data.set(k, JSON.parse(JSON.stringify(v))); } }; }
test('file reads persist by account and revision and only unchanged paths inherit to a new PS', async () => {
  const m = storage(), p = new ReviewProgress(m), key = p.key('server', 1, 'change');
  p.prepare(key, 'a', undefined);
  await p.mark(key, 'a', 'same.h', true); await p.mark(key, 'a', 'changed.c', true); await p.mark(key, 'a', 'renamed.h', true);
  const revisions = { a: { _number: 1 }, b: { _number: 2 } };
  assert.equal(p.baseline(key, revisions, 'b'), 'a');
  p.prepare(key, 'b', 'a', { 'changed.c': {}, 'new.h': { status: 'R', old_path: 'renamed.h' } });
  await p.saving;
  const restored = new ReviewProgress(m);
  assert.deepEqual(restored.ensure(key, 'b').read, ['same.h']);
  assert.ok(restored.ensure(key, 'b').changed.includes('renamed.h'));
  assert.deepEqual(restored.ensure(restored.key('server', 2, 'change'), 'a').read, []);
});
test('manual unread choices made during PS comparison are not overridden by inheritance', async () => {
  const p = new ReviewProgress(storage()), key = p.key('server',1,'c');
  p.prepare(key,'a'); await p.mark(key,'a','header.h',true);
  await p.mark(key,'b','header.h',false); await p.mark(key,'b','other.c',true);
  p.prepare(key,'b','a',{});
  assert.deepEqual(p.ensure(key,'b').read,['other.c']);
});
