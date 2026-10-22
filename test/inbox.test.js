'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inboxQuery } = require('../src/inbox');
test('inbox filters scope the whole OR query before server pagination', () => {
  assert.equal(inboxQuery('is:open'), 'is:open');
  assert.equal(inboxQuery('owner:self OR reviewer:self', { branch: 'release/1.0', unreviewed: true }), '(owner:self OR reviewer:self) branch:"release/1.0" is:open -reviewedby:self');
  assert.equal(inboxQuery('is:merged', { branch: 'main' }), '(is:merged) branch:"main"');
  assert.equal(inboxQuery('is:open', { branch: 'x" OR is:merged OR "y' }), '(is:open) branch:"x\\" OR is:merged OR \\"y"');
  assert.throws(() => inboxQuery('is:open', { branch: 'main\nOR is:merged' }), /分支/);
});

const { searchPlan, fuzzyPattern, scanChanges } = require('../src/inbox');
test('friendly fields quote scopes and generate literal case-insensitive substring regex', () => {
  const plan = searchPlan('is:open', { message: 'Test2 (A+B)', repo: 'team/repo', branch: 'main', owner: 'self' });
  assert.equal(plan.scope, '(is:open) project:"team/repo" branch:"main" owner:"self"');
  assert.ok(plan.commitQuery.includes('message:'));
  const pattern = new RegExp(fuzzyPattern('Test2 (A+B)'));
  assert.ok(pattern.test('prefix tEST2 (a+b) suffix')); assert.ok(!pattern.test('Test2 AAAB'));
  assert.throws(() => searchPlan('is:open', { message: 'a'.repeat(201) }), /message/);
});
test('search merges native regex with all scoped pages, historical commits and partial inline comments', async () => {
  const plan = searchPlan('is:open', { message: 'test' });
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i, subject: 'ordinary', updated: String(i).padStart(2, '0') }));
  rows[1].subject = 'a TEST2 title';
  rows[2].revisions = { old: { commit: { message: 'historical TeSt2 body' } } };
  rows[3].messages = [{ message: 'overall review TEST2' }];
  const calls = []; let concurrent = 0, peak = 0, final;
  const api = {
    list: async (query, start = 0, options) => {
      calls.push({ query, start, options });
      if (query === plan.commitQuery) return [{ ...rows[0] }];
      const page = rows.slice(start, start + 5).map(c => ({ ...c }));
      if (start === 0) page.at(-1)._more_changes = true;
      return page;
    },
    allComments: async id => { peak = Math.max(peak, ++concurrent); await new Promise(resolve => setImmediate(resolve)); concurrent--; return id === 'c9' ? { 'code.c': [{ message: 'prefixTEST2suffix', patch_set: 1 }] } : {}; }
  };
  const results = await scanChanges(api, plan, { progress: value => { final = value; } });
  assert.deepEqual(results.map(c => c.id), ['c9','c3','c2','c1','c0']);
  assert.equal(final.scanned, 10); assert.equal(final.matches, 5); assert.ok(peak <= 4);
  assert.deepEqual(calls.filter(c => c.options?.search).map(c => c.start), [0,5]);
});
test('stopped or failed comment scans never return apparently complete partial results', async () => {
  const plan = searchPlan('is:open', { message: 'test' }); let cancelled = false;
  const api = { list: async query => query === plan.commitQuery ? [] : [{ id: 'one', subject: 'ordinary' }], allComments: async () => { cancelled = true; return { a: [{ message: 'test' }] }; } };
  assert.equal(await scanChanges(api, plan, { cancelled: () => cancelled }), null);
  cancelled = false; api.allComments = async () => { throw new Error('server failure'); };
  await assert.rejects(scanChanges(api, plan), /server failure/);
});

test('native matches stream before the remaining scan and cancellation reaches every request', async () => {
  const plan = searchPlan('is:open', { message: 'needle' }), controller = new AbortController(), hits = [];
  let release; const gate = new Promise(resolve => { release = resolve; });
  const api = {
    list: async (query, start, options) => {
      assert.equal(options.signal, controller.signal);
      if (query === plan.commitQuery) return [{ id: 'first', subject: 'needle' }];
      await gate; return [{ id: 'second', subject: 'ordinary' }];
    },
    allComments: async (id, options) => { assert.equal(options.signal, controller.signal); return { a: [{ message: 'needle' }] }; }
  };
  const pending = scanChanges(api, plan, { signal: controller.signal, onMatch: row => hits.push(row.id) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(hits, ['first']);
  release(); assert.deepEqual((await pending).map(row => row.id).sort(), ['first', 'second']);
});


test('change number is exact and file filter uses literal case-insensitive containment', () => {
  const plan = searchPlan('is:open', { changeNumber: '#322', file: 'Include/A+B.h', message: 'fix' });
  assert.ok(plan.scope.includes('change:322')); assert.ok(plan.commitQuery.includes('change:322'));
  const value = JSON.parse(plan.scope.slice(plan.scope.indexOf('file:') + 5));
  assert.ok(new RegExp(value).test('prefix/include/a+b.H'));
  assert.ok(!new RegExp(value).test('Include/AAAB.h'));
  for (const changeNumber of ['322 OR is:merged','0','-1']) assert.throws(() => searchPlan('is:open', { changeNumber }), /Gerrit 号/);
});
