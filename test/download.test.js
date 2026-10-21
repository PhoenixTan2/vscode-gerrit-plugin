'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { git } = require('../src/git');
const { sshUrl, projectPath, downloadBranch } = require('../src/download');
const options = { directory: '/repo', url: 'ssh://alice@example:29418/team/project', branch: 'change-142', ref: 'refs/changes/42/142/3', revision: 'a'.repeat(40) };

test('SSH URLs preserve advertised identity and match both SSH and HTTP project remotes', () => {
  assert.equal(sshUrl({ ssh: { url: 'ssh://alice@git.example:29418/team/repo' } }, 'bob'), 'ssh://alice@git.example:29418/team/repo');
  assert.equal(sshUrl({ ssh: { url: 'ssh://git.example:29418/team/repo' } }, 'bob'), 'ssh://bob@git.example:29418/team/repo');
  assert.throws(() => sshUrl({ http: { url: 'http://example/repo' } }), /SSH/);
  assert.throws(() => sshUrl({ ssh: { url: 'ssh://u:password@example/repo' } }), /无效/);
  assert.equal(projectPath('alice@example:team/project.git'), 'team/project');
  assert.equal(projectPath('https://example/team/project.git'), 'team/project');
});
test('download fetches directly in current repository and checks out pinned SHA without clone or force', async () => {
  const calls = []; const stages = [];
  const run = async (cwd, args, opts) => { calls.push({ cwd, args, opts }); return args[0] === 'rev-parse' ? options.revision : ''; };
  assert.equal(await downloadBranch({ ...options, stage: value => stages.push(value) }, run), '/repo');
  const fetch = calls.find(c => c.args[0] === 'fetch');
  assert.deepEqual(fetch.args, ['fetch', '--quiet', '--', options.url, options.ref]); assert.equal(fetch.opts.sshNonInteractive, true);
  assert.deepEqual(calls.at(-1).args, ['-c', 'core.longpaths=true', 'checkout', '--quiet', '-b', 'change-142', options.revision]);
  assert.equal(calls.filter(c => c.args[0] === 'status').length, 2);
  assert.deepEqual(stages, ['检查本地仓库', 'SSH fetch', 'Git checkout']);
  assert.ok(calls.every(c => c.cwd === '/repo' && !c.args.includes('clone') && !c.args.includes('--force')));
});
test('download rejects dirty repositories, existing branches, invalid references and mismatched SHA', async () => {
  for (const scenario of ['dirty', 'branch', 'sha', 'editedDuringFetch']) {
    const calls = []; let statuses = 0;
    await assert.rejects(downloadBranch(options, async (_, args) => {
      calls.push(args);
      if (args[0] === 'status') return scenario === 'dirty' || (scenario === 'editedDuringFetch' && ++statuses === 2) ? ' M file' : '';
      if (args[0] === 'for-each-ref') return scenario === 'branch' ? 'refs/heads/change-142' : '';
      if (args[0] === 'rev-parse') return scenario === 'sha' ? 'b'.repeat(40) : options.revision;
      return '';
    }), /修改|已存在|SHA/);
    assert.ok(!calls.some(args => args.includes('checkout')));
    if (scenario === 'dirty' || scenario === 'branch') assert.ok(!calls.some(args => args[0] === 'fetch'));
  }
  await assert.rejects(downloadBranch({ ...options, ref: '--bad' }), /引用/);
  await assert.rejects(downloadBranch({ ...options, url: 'http://example/repo' }), /SSH/);
});
test('real Git downloads into an existing repository, preserves dirty files and refuses branch overwrite', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'gerrit-current-repo-'));
  const source = path.join(parent, 'source'); const local = path.join(parent, 'local');
  try {
    await fs.mkdir(source); await fs.mkdir(local);
    await git(source, ['init', '-b', 'main']); await git(source, ['config', 'user.name', 'Test']); await git(source, ['config', 'user.email', 'test@example.invalid']);
    await git(source, ['config', 'commit.gpgsign', 'false']);
    await fs.writeFile(path.join(source, 'code.txt'), 'original\n');
    await git(source, ['add', '.']); await git(source, ['commit', '-m', 'base']);
    await git(local, ['clone', '--', source, '.']);
    await fs.writeFile(path.join(source, 'code.txt'), 'patch\n');
    await git(source, ['commit', '-am', 'patch']);
    const revision = await git(source, ['rev-parse', 'HEAD']);
    await git(source, ['update-ref', options.ref, revision]);
    const run = (cwd, args, opts) => git(cwd, args.map(arg => arg === options.url ? source : arg), opts);
    const settings = { ...options, directory: local, revision };
    const originalHead = await git(local, ['rev-parse', 'HEAD']);
    const fetchHead = await fs.readFile(path.join(local, '.git', 'FETCH_HEAD'), 'utf8').catch(() => undefined);
    const indexPaths = await readPatchPaths({ directory: local, revision, ref: options.ref, url: options.url }, run);
    assert.ok(indexPaths.includes('code.txt'));
    assert.equal(await git(local, ['rev-parse', 'HEAD']), originalHead);
    assert.equal(await git(local, ['branch', '--show-current']), 'main');
    assert.equal(await fs.readFile(path.join(local, '.git', 'FETCH_HEAD'), 'utf8').catch(() => undefined), fetchHead);
    await fs.writeFile(path.join(local, 'code.txt'), 'my edits\n');
    await assert.rejects(downloadBranch(settings, run), /未提交/);
    assert.equal(await fs.readFile(path.join(local, 'code.txt'), 'utf8'), 'my edits\n');
    await git(local, ['restore', 'code.txt']);
    await downloadBranch(settings, run);
    assert.equal(await git(local, ['branch', '--show-current']), 'change-142');
    assert.equal(await git(local, ['rev-parse', 'HEAD']), revision);
    assert.equal((await fs.readFile(path.join(local, 'code.txt'), 'utf8')).trim(), 'patch');
    await assert.rejects(downloadBranch(settings, run), /已存在/);
  } finally {
    const resolved = path.resolve(parent);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('gerrit-current-repo-')) throw new Error('Unsafe cleanup target');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('unsaved editor changes made during fetch prevent checkout', async () => {
  let checks = 0; const calls = [];
  await assert.rejects(downloadBranch({ ...options, checkWorkspace: () => { if (++checks === 2) throw new Error('unsaved editor'); } }, async (_, args) => {
    calls.push(args); return args[0] === 'rev-parse' ? options.revision : '';
  }), /unsaved editor/);
  assert.ok(calls.some(args => args[0] === 'fetch'));
  assert.ok(!calls.some(args => args.includes('checkout')));
});

const { readPatchPaths } = require('../src/download');
test('Patch path index reads exact NUL-separated names locally without fetch when objects exist', async () => {
  const calls = [];
  const paths = await readPatchPaths({ directory: '/repo', revision: 'a'.repeat(40) }, async (cwd, args, options) => {
    calls.push({ cwd, args, options }); return 'src/MixedCase.c\0 space file.txt\0line\nbreak.txt\0';
  });
  assert.deepEqual(paths, ['src/MixedCase.c', ' space file.txt', 'line\nbreak.txt']);
  assert.equal(calls.length, 1); assert.equal(calls[0].options.raw, true);
  await assert.rejects(readPatchPaths({ revision: '--bad' }), /SHA/);
});

test('missing Patch path index fetches only objects over SSH without checkout or changing FETCH_HEAD', async () => {
  const calls = []; let reads = 0;
  const paths = await readPatchPaths({ directory: '/repo', revision: 'b'.repeat(40), ref: 'refs/changes/22/322/10', url: 'ssh://user@review.example/project' }, async (cwd, args) => {
    calls.push(args);
    if (args[0] === 'ls-tree' && reads++ === 0) throw new Error('missing object');
    return args[0] === 'ls-tree' ? 'Boot/Device.c\0' : '';
  });
  assert.deepEqual(paths, ['Boot/Device.c']);
  assert.ok(calls[1].includes('--no-write-fetch-head'));
  assert.ok(!calls.some(args => args.includes('checkout') || args.includes('reset')));
  await assert.rejects(readPatchPaths({ directory: '/repo', revision: 'b'.repeat(40), ref: 'refs/heads/main', url: 'http://review.example/p' }, async () => { throw new Error('missing'); }), /SSH/);
});
