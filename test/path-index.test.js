'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { git } = require('../src/git');
const { PathIndex } = require('../src/path-index');
const info = { server: 'https://review.example.invalid', account: 1, project: 'p', url: 'ssh://user@review.example/p', ref: 'refs/changes/22/322/10', revision: 'a'.repeat(40) };

test('independent indexes share requests, serialize each repository and isolate accounts', async () => {
  const objects = new Set(), fetches = [], active = new Map();
  const index = new PathIndex(async (cwd, args) => {
    if (args[0] === 'ls-tree') {
      if (!objects.has(cwd + args.at(-2))) throw new Error('missing');
      return 'Include/Unmodified.h\0Source/Main.c\0';
    }
    if (args[0] === 'fetch') {
      assert.equal(active.get(cwd) || 0, 0); active.set(cwd, 1);
      fetches.push({ cwd, args });
      await new Promise(resolve => setImmediate(resolve));
      objects.add(cwd + (args.at(-1).endsWith('/11') ? 'b'.repeat(40) : info.revision));
      active.set(cwd, 0);
    }
    return '';
  });
  try {
    const first = index.read(info); assert.equal(first, index.read(info));
    const otherRevision = index.read({ ...info, revision: 'b'.repeat(40), ref: 'refs/changes/22/322/11' });
    assert.deepEqual(await first, ['Include/Unmodified.h', 'Source/Main.c']); await otherRevision;
    await index.read({ ...info, account: 2 });
    assert.equal(fetches.length, 3); assert.equal(fetches[0].cwd, fetches[1].cwd); assert.notEqual(fetches[0].cwd, fetches[2].cwd);
    assert.ok(fetches.every(({ args }) => args.includes('--filter=blob:none') && args.includes('--depth=1')));
  } finally { await index.dispose(); }
});

test('real Git lists unchanged headers in an isolated bare cache without checking out a repository', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'gerrit-index-source-'));
  const operations = [];
  const index = new PathIndex((cwd, args, options) => {
    operations.push({ cwd, args });
    return git(cwd, args.map(value => value === info.url ? source : value), options);
  });
  try {
    await git(source, ['init', '-b', 'main']); await git(source, ['config', 'user.name', 'Test']);
    await git(source, ['config', 'user.email', 'test@example.invalid']); await git(source, ['config', 'commit.gpgsign', 'false']);
    await fs.mkdir(path.join(source, 'Include')); await fs.writeFile(path.join(source, 'Include', 'Unmodified.h'), 'header\n');
    await fs.writeFile(path.join(source, 'Main.c'), 'before\n'); await git(source, ['add', '.']); await git(source, ['commit', '-m', 'base']);
    await fs.writeFile(path.join(source, 'Main.c'), 'after\n'); await git(source, ['commit', '-am', 'patch']);
    const revision = await git(source, ['rev-parse', 'HEAD']); await git(source, ['update-ref', info.ref, revision]);
    const files = await index.read({ ...info, revision });
    assert.ok(files.includes('Include/Unmodified.h'));
    const root = await index.rootPromise, directory = operations.find(call => call.args[0] === 'init').cwd;
    assert.equal(await git(directory, ['rev-parse', '--is-bare-repository']), 'true');
    await assert.rejects(fs.access(path.join(directory, 'Include', 'Unmodified.h')));
    assert.ok(!operations.some(({ args }) => args.includes('checkout') || args.includes('clone')));
    assert.equal(await git(source, ['rev-parse', 'HEAD']), revision);
    assert.equal(await git(source, ['status', '--porcelain']), '');
    await index.dispose(); await assert.rejects(fs.access(root));
    await assert.rejects(index.read({ ...info, revision }), /会话已结束/);
  } finally {
    await index.dispose();
    if (path.dirname(path.resolve(source)) !== path.resolve(os.tmpdir()) || !path.basename(source).startsWith('gerrit-index-source-')) throw new Error('Unsafe test cleanup target');
    await fs.rm(source, { recursive: true, force: true });
  }
});

test('disposing an index aborts pending fetch before removing its temporary cache', async () => {
  let started; const fetching = new Promise(resolve => { started = resolve; });
  const index = new PathIndex(async (cwd, args, options) => {
    if (args[0] === 'ls-tree') throw new Error('missing');
    if (args[0] === 'fetch') {
      started(); await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    return '';
  });
  const pending = index.read(info), rejected = assert.rejects(pending, /abort/i);
  await fetching; const root = await index.rootPromise;
  await index.dispose(); await rejected; await assert.rejects(fs.access(root));
});

test('invalid remote metadata never creates a cache and failed fetches can be retried', async () => {
  let tries = 0, available = false;
  const index = new PathIndex(async (cwd, args) => {
    if (args[0] === 'ls-tree') { if (!available) throw new Error('missing'); return 'Header.h\0'; }
    if (args[0] === 'fetch') { if (++tries === 1) throw new Error('temporary SSH failure'); available = true; }
    return '';
  });
  try {
    for (const invalid of [{ url: 'https://review.example/p' }, { ref: '--unsafe' }, { revision: 'HEAD' }]) await assert.rejects(index.read({ ...info, ...invalid }), /无效/);
    assert.equal(index.rootPromise, undefined);
    await assert.rejects(index.read(info), /temporary SSH failure/);
    assert.deepEqual(await index.read(info), ['Header.h']); assert.equal(tries, 2);
  } finally { await index.dispose(); }
});
