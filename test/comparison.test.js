'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { comparisonPlan, comparisonFiles } = require('../src/comparison');
const revisions = { a: { _number: 1 }, b: { _number: 2 }, c: { _number: 3 } };
test('arbitrary patch comparisons use the selected left as base, including reverse order', () => {
  assert.deepEqual(comparisonPlan(revisions, 'a', 'c'), { left: 'a', right: 'c', revision: 'c', base: 'a', reverse: false });
  assert.deepEqual(comparisonPlan(revisions, 'c', 'a'), { left: 'c', right: 'a', revision: 'a', base: 'c', reverse: false });
});
test('Base uses opposite patch first parent and supports both directions', () => {
  assert.equal(comparisonPlan(revisions, 'base', 'b').revision, 'b');
  assert.equal(comparisonPlan(revisions, 'b', 'base').reverse, true);
  for (const [a, b] of [['base', 'base'], ['a', 'a'], ['x', 'b'], ['base', 'unknown']]) assert.throws(() => comparisonPlan(revisions, a, b), /有效/);
});
test('reverse Base comparison inverts additions, deletions, rename paths and line counts', () => {
  const files = {
    'new.js': { status: 'A', lines_inserted: 10 },
    'deleted.js': { status: 'D', lines_deleted: 4 },
    'renamed.js': { status: 'R', old_path: 'old.js', lines_inserted: 3, lines_deleted: 1 }
  };
  const result = comparisonFiles(files, true);
  assert.equal(result['new.js'].status, 'D'); assert.equal(result['new.js'].lines_deleted, 10);
  assert.equal(result['deleted.js'].status, 'A'); assert.equal(result['deleted.js'].lines_inserted, 4);
  assert.equal(result['old.js'].old_path, 'renamed.js'); assert.equal(result['old.js'].lines_inserted, 1);
  assert.equal(files['new.js'].status, 'A');
});


test('Edit compares to any PS or its Base in either direction, always using the edit as canonical right revision',()=>{
 const edit={commit:{commit:'edit-sha'},base_revision:'new'},revisions={old:{_number:1},new:{_number:2}};
 for(const other of ['old','new','base'])for(const pair of [[other,'edit'],['edit',other]]){
  const plan=comparisonPlan(revisions,...pair,edit);assert.equal(plan.revision,'edit');assert.equal(plan.base,other==='base'?undefined:other);assert.equal(plan.reverse,pair[0]==='edit');assert.equal(plan.editHead,'edit-sha');
 }
 assert.throws(()=>comparisonPlan(revisions,'old','edit'),/有效/);assert.throws(()=>comparisonPlan(revisions,'edit','edit',edit),/有效/);
});
