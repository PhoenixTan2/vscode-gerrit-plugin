'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { git } = require('./git');
function sshUrl(fetch = {}, username) {
  if (!fetch.ssh?.url) throw new Error('服务器未提供 SSH 下载地址，请确认 Gerrit 已启用 SSH 下载');
  const url = new URL(fetch.ssh.url);
  if (url.protocol !== 'ssh:' || !url.hostname || url.password || url.search || url.hash) throw new Error('服务器返回的 SSH 下载地址无效');
  if (!url.username && username) url.username = username;
  if (!url.username) throw new Error('SSH 下载地址缺少用户名');
  return url.toString();
}
async function downloadBranch({ parent, name, url, branch, ref, revision }, run = git) {
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name)) throw new Error('下载目录名称无效');
  const directory = path.resolve(parent, name);
  if (path.dirname(directory) !== path.resolve(parent)) throw new Error('下载目录必须位于所选目录内');
  try { await fs.lstat(directory); throw new Error('下载目录已存在，请选择其他目录，不会覆盖已有文件'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await run(parent, ['check-ref-format', `refs/heads/${branch}`]);
  const remote = new URL(url);
  if (remote.protocol !== 'ssh:' || !remote.username || remote.password || remote.search || remote.hash) throw new Error('下载必须使用不含密码的 SSH 地址');
  if (ref && (!/^refs\/changes\/\d{2}\/\d+\/\d+$/.test(ref) || !/^[a-f0-9]{40,64}$/.test(revision || ''))) throw new Error('Patch set 下载引用无效');
  const options = { sshNonInteractive: true, timeout: 600000 };
  await run(parent, ['clone', '--quiet', '--config', 'core.longpaths=true', ...(ref ? ['--no-checkout'] : []), '--depth=1', '--single-branch', '--branch', branch, '--', remote.toString(), directory], options);
  if (ref) {
    await run(directory, ['fetch', '--quiet', '--depth=1', '--', 'origin', ref], options);
    const head = await run(directory, ['rev-parse', 'FETCH_HEAD']);
    if (head !== revision) throw new Error('下载的 Patch set SHA 与页面不一致，已保留目录供检查');
    await run(directory, ['checkout', '--quiet', '-b', `review/${ref.split('/').slice(-2).join('-')}`, revision], { timeout: 600000 });
  }
  return directory;
}
module.exports = { sshUrl, downloadBranch };
