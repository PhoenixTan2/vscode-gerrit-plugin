'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { sshUrl, downloadBranch } = require('../src/download');
test('SSH download preserves Gerrit advertised user, port and project and rejects HTTP/passwords', () => {
  assert.equal(sshUrl({ ssh: { url: 'ssh://alice@git.example:29418/team/repo' } }, 'bob'), 'ssh://alice@git.example:29418/team/repo');
  assert.equal(sshUrl({ ssh: { url: 'ssh://git.example:29418/team/repo' } }, 'bob'), 'ssh://bob@git.example:29418/team/repo');
  assert.throws(() => sshUrl({ http: { url: 'http://example/repo' } }), /SSH/);
  assert.throws(() => sshUrl({ ssh: { url: 'ssh://u:password@example/repo' } }), /无效/);
});
test('SSH patch download clones target branch, fetches pinned patch ref and checks out independent branch', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'gerrit-download-'));
  try {
    const calls = []; const revision = 'a'.repeat(40);
    const run = async (cwd, args, options) => { calls.push({ cwd, args, options }); return args[0] === 'rev-parse' ? revision : ''; };
    const directory = await downloadBranch({ parent, name: 'code', url: 'ssh://alice@example:29418/project', branch: 'main', ref: 'refs/changes/42/142/3', revision }, run);
    assert.equal(directory, path.join(parent, 'code'));
    assert.deepEqual(calls.map(c => c.args[0]), ['check-ref-format', 'clone', 'fetch', 'rev-parse', 'checkout']);
    assert.equal(calls[1].options.sshNonInteractive, true); assert.equal(calls[2].options.sshNonInteractive, true);
    assert.ok(calls[2].args.includes('refs/changes/42/142/3'));
    assert.deepEqual(calls[4].args, ['checkout', '--quiet', '-b', 'review/142-3', revision]);
    assert.ok(calls[1].args.includes('core.longpaths=true')); assert.ok(calls[1].args.includes('--no-checkout'));
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
test('download never overwrites existing directories and stops on mismatched patch SHA', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'gerrit-download-'));
  try {
    await fs.mkdir(path.join(parent, 'existing')); let calls = 0;
    const options = { parent, name: 'existing', url: 'ssh://alice@example/project', branch: 'main' };
    await assert.rejects(downloadBranch(options, async () => { calls++; }), /已存在/); assert.equal(calls, 0);
    await assert.rejects(downloadBranch({ ...options, name: '../outside' }, async () => {}), /目录/);
    await assert.rejects(downloadBranch({ ...options, name: 'fresh', ref: 'refs/changes/42/142/1', revision: 'a'.repeat(40) }, async (_, args) => args[0] === 'rev-parse' ? 'b'.repeat(40) : ''), /SHA/);
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
