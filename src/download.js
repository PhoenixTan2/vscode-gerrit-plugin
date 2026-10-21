'use strict';
const { git } = require('./git');
function sshUrl(fetch = {}, username) {
  if (!fetch.ssh?.url) throw new Error('服务器未提供 SSH 下载地址，请确认 Gerrit 已启用 SSH 下载');
  const url = new URL(fetch.ssh.url);
  if (url.protocol !== 'ssh:' || !url.hostname || url.password || url.search || url.hash) throw new Error('服务器返回的 SSH 下载地址无效');
  if (!url.username && username) url.username = username;
  if (!url.username) throw new Error('SSH 下载地址缺少用户名');
  return url.toString();
}
function projectPath(remote) {
  try { return decodeURIComponent(new URL(remote).pathname).replace(/^\/+|\/+$/g, '').replace(/\.git$/, ''); }
  catch { return remote.replace(/^[^:]+:/, '').replace(/^\/+|\/+$/g, '').replace(/\.git$/, ''); }
}
async function downloadBranch({ directory, url, branch, ref, revision, stage = () => {}, checkWorkspace = () => {} }, run = git) {
  const remote = new URL(url);
  if (remote.protocol !== 'ssh:' || !remote.username || remote.password || remote.search || remote.hash) throw new Error('下载必须使用不含密码的 SSH 地址');
  if (!/^refs\/changes\/\d{2}\/\d+\/\d+$/.test(ref || '') || !/^[a-f0-9]{40,64}$/.test(revision || '')) throw new Error('Patch set 下载引用无效');
  await run(directory, ['check-ref-format', `refs/heads/${branch}`]);
  const clean = async () => {
    await checkWorkspace();
    if (await run(directory, ['status', '--porcelain'])) throw new Error('本地仓库有未提交修改，请先提交或暂存到 stash 后重试下载');
    if (await run(directory, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`])) throw new Error(`本地分支 ${branch} 已存在；请先重命名或删除该分支后重试，不会覆盖已有分支`);
  };
  stage('检查本地仓库'); await clean();
  stage('SSH fetch');
  await run(directory, ['fetch', '--quiet', '--', remote.toString(), ref], { sshNonInteractive: true, timeout: 600000 });
  const head = await run(directory, ['rev-parse', 'FETCH_HEAD']);
  if (head !== revision) throw new Error('下载的 Patch set SHA 与页面不一致，未切换本地分支');
  // Fetch may take minutes: do not carry edits made during that time into a checkout.
  await clean();
  stage('Git checkout');
  await run(directory, ['-c', 'core.longpaths=true', 'checkout', '--quiet', '-b', branch, revision], { timeout: 600000 });
  return directory;
}

async function readPatchPaths({ directory, revision, ref, url, lightweight = false }, run = git) {
  if (!/^[a-f0-9]{40,64}$/.test(revision || '')) throw new Error('Patch set SHA 无效');
  const read = (optional = false) => run(directory, ['ls-tree', '-r', '--full-tree', '--name-only', '-z', revision, '--'], { raw: true, optional });
  let paths;
  try { paths = await read(true); }
  catch {
    if (!url) throw new Error('本地缺少此 Patch，且服务器未提供 SSH 地址');
    const remote = new URL(url);
    if (remote.protocol !== 'ssh:' || !remote.username || remote.password || remote.search || remote.hash || !/^refs\/changes\/\d{2}\/\d+\/\d+$/.test(ref || '')) throw new Error('Patch set SSH 引用无效');
    // Fetch objects only: leave the index, worktree, branches and FETCH_HEAD untouched.
    await run(directory, ['fetch', '--quiet', ...(lightweight ? ['--depth=1', '--filter=blob:none'] : []), '--no-tags', '--no-write-fetch-head', '--', remote.toString(), ref], { sshNonInteractive: true, timeout: 600000 });
    paths = await read();
  }
  return paths.split('\0').filter(Boolean);
}

module.exports = { sshUrl, projectPath, downloadBranch, readPatchPaths };
