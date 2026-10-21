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
