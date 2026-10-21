'use strict';
const { execFile } = require('node:child_process');
function git(cwd, args, { sshNonInteractive = false, timeout = 120000, raw = false, signal } = {}) {
  return new Promise((resolve, reject) => execFile('git', args, { cwd, windowsHide: true, timeout, signal, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(sshNonInteractive ? { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4', GIT_SSH_VARIANT: 'ssh' } : {}) } }, (error, stdout, stderr) => {
    if (error) reject(new Error((stderr || error.message).trim())); else resolve(raw ? stdout : stdout.trim());
  }));
}
function pushRef(branch, wip) {
  if (!branch || branch.startsWith('-') || /[\s~^:?*\[\\%\x00-\x1f]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch.endsWith('/') || branch.endsWith('.')) throw new Error('目标分支名称无效');
  return `HEAD:refs/for/${branch}${wip ? '%wip' : ''}`;
}
module.exports = { git, pushRef };
