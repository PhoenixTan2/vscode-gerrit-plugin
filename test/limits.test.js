'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RESPONSE_LIMIT, fileLimitReason } = require('../src/limits');
const { comparisonFiles } = require('../src/comparison');
test('Base64 response budget checks both sides, including deleted and reversed renamed files', () => {
  const exact = RESPONSE_LIMIT / 4 * 3;
  assert.equal(fileLimitReason({size:exact,size_delta:0}), '');
  assert.match(fileLimitReason({size:exact+1}), /32MB/);
  assert.match(fileLimitReason({status:'D',size:0,size_delta:-(exact+1)}), /32MB/);
  const files = {'new.bin':{status:'R',old_path:'old.bin',size:1,size_delta:-exact}};
  const reverse = comparisonFiles(files,true)['old.bin'];
  assert.match(reverse.blockedReason,/32MB/); assert.equal(reverse.size,exact+1);
  assert.equal(fileLimitReason({}), ''); assert.equal(fileLimitReason({size:1,size_delta:-exact},false), '');
});
