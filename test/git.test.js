'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { git, pushRef } = require('../src/git');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('push destination explicitly targets Gerrit refs/for', () => {
  assert.equal(pushRef('main', false), 'HEAD:refs/for/main');
  assert.equal(pushRef('release/1.0', true), 'HEAD:refs/for/release/1.0%wip');
});
test('rejects refspec injection and invalid branch input before launching git', () => {
  for (const input of ['', '-main', 'main:refs/heads/main', 'main%submit', 'main\nother', 'main..test', 'main@{1}', 'main*', 'main?']) assert.throws(() => pushRef(input, false));
});
test('real Git fetch and refs/for push preserve target branch and workspace edits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gerrit-workbench-test-'));
  const local = path.join(root, 'local'); const remote = path.join(root, 'remote.git');
  try {
    await fs.mkdir(local);
    await git(root, ['init', '--bare', remote]);
    await git(local, ['init', '-b', 'main']);
    await git(local, ['config', 'user.name', 'Test User']);
    await git(local, ['config', 'user.email', 'test@example.invalid']);
    await git(local, ['config', 'commit.gpgsign', 'false']);
    await git(local, ['-c', 'core.hooksPath=', 'commit', '--allow-empty', '-m', 'base']);
    await git(local, ['remote', 'add', 'origin', remote]);
    await git(local, ['push', '--', 'origin', 'HEAD:refs/heads/main']);
    const base = await git(local, ['rev-parse', 'HEAD']);
    await git(local, ['-c', 'core.hooksPath=', 'commit', '--allow-empty', '-m', 'review\n\nChange-Id: I1234567890123456789012345678901234567890']);
    await fs.writeFile(path.join(local, 'untouched.txt'), 'uncommitted');
    await git(local, ['fetch', '--no-tags', '--', 'origin', 'refs/heads/main']);
    const outgoing = await git(local, ['rev-list', '--reverse', 'FETCH_HEAD..HEAD']);
    assert.equal(outgoing.split('\n').length, 1);
    await git(local, ['push', '--', 'origin', pushRef('main', false)]);
    assert.equal(await git(remote, ['rev-parse', 'refs/for/main']), outgoing);
    assert.equal(await git(remote, ['rev-parse', 'refs/heads/main']), base);
    assert.equal(await fs.readFile(path.join(local, 'untouched.txt'), 'utf8'), 'uncommitted');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
