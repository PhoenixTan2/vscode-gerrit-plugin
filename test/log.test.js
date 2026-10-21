'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Logger } = require('../src/log');
test('debug output redacts registered credentials, authorization, cookies and URL secrets', () => {
  const lines = []; const log = new Logger({ appendLine: line => lines.push(line) }, 'debug');
  log.protect('private-password'); log.protect('encoded-auth');
  log.write('error', 'private-password encoded-auth https://user:pwd@example.com/path?token=secret&x=1');
  log.write('debug', 'Authorization: Basic dXNlcjpwYXNz\nCookie: GerritAccount=secret; XSRF_TOKEN=csrf\nX-Gerrit-Auth: csrf');
  const text = lines.join('\n');
  for (const value of ['private-password', 'encoded-auth', 'user:pwd', 'token=secret', 'dXNlcjpwYXNz', 'GerritAccount=secret', 'X-Gerrit-Auth: csrf']) assert.ok(!text.includes(value));
  assert.ok(text.includes('[REDACTED]'));
});
test('log level filters debug and disables all output when off', () => {
  const lines = []; const log = new Logger({ appendLine: line => lines.push(line) }, 'error');
  log.write('debug', 'hidden'); log.write('info', 'hidden'); log.write('error', 'visible');
  assert.equal(lines.length, 1); log.level = 'off'; log.write('error', 'hidden'); assert.equal(lines.length, 1);
});
