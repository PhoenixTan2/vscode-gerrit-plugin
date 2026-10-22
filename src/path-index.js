'use strict';
const {tr} = require('./i18n');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { git } = require('./git');
const { readPatchPaths } = require('./download');
// Session-owned bare repositories: never use or check out the user's workspace.
class PathIndex {
  constructor(run = git) {
    this.run = run; this.repositories = new Map(); this.paths = new Map(); this.queues = new Map();
    this.controller = new AbortController();
  }
  read(info, { signal, progress = () => {} } = {}) {
    if (this.disposed) return Promise.reject(new Error(tr('文件查找会话已结束，请重新连接')));
    let remote;
    try { remote = new URL(info.url); } catch { return Promise.reject(new Error(tr('无法读取版本文件清单：SSH 地址无效'))); }
    if (remote.protocol !== 'ssh:' || !remote.username || remote.password || remote.search || remote.hash ||
        !/^[a-f0-9]{40,64}$/.test(info.revision || '') || !/^refs\/changes\/\d{2}\/\d+\/\d+$/.test(info.ref || '')) {
      return Promise.reject(new Error(tr('无法读取版本文件清单：SSH 地址或 Patch 引用无效')));
    }
    const repoKey = crypto.createHash('sha256').update(JSON.stringify([info.server, info.account, info.project, remote.toString(), info.revision.length])).digest('hex');
    const key = repoKey + ':' + info.revision;
    if (!this.paths.has(key)) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason || this.controller.signal.reason);
      this.controller.signal.addEventListener('abort', abort, { once: true });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const previous = this.queues.get(repoKey) || Promise.resolve();
      const pending = previous.catch(() => {}).then(async () => {
        if (this.disposed) throw new Error(tr('文件查找会话已结束'));
        controller.signal.throwIfAborted(); progress(tr('准备路径缓存'));
        const directory = await this.repository(repoKey, info.revision.length);
        controller.signal.throwIfAborted();
        return readPatchPaths({ directory, revision: info.revision, ref: info.ref, url: remote.toString(), lightweight: true },
          (cwd, args, options) => {
            progress(args[0] === 'fetch' ? tr('SSH 获取版本路径') : tr('读取文件路径'));
            return this.run(cwd, args, { ...options, signal: controller.signal });
          });
      }).catch(error => { if (controller.signal.aborted) throw controller.signal.reason; throw error; }).finally(() => {
        this.controller.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort);
      });
      this.paths.set(key, pending); this.queues.set(repoKey, pending);
      pending.catch(() => { if (this.paths.get(key) === pending) this.paths.delete(key); });
    }
    return this.paths.get(key);
  }
  repository(key, hashLength) {
    if (!this.repositories.has(key)) {
      const pending = (async () => {
        if (!this.rootPromise) this.rootPromise = fs.mkdtemp(path.join(os.tmpdir(), 'gerrit-workbench-index-'));
        const root = await this.rootPromise;
        if (this.disposed) throw new Error(tr('文件查找会话已结束'));
        const directory = path.join(root, key);
        await fs.mkdir(directory, { recursive: true });
        await this.run(directory, ['init', '--bare', '--quiet', '--template=', ...(hashLength === 64 ? ['--object-format=sha256'] : [])], { signal: this.controller.signal });
        return directory;
      })();
      this.repositories.set(key, pending);
      pending.catch(() => { if (this.repositories.get(key) === pending) this.repositories.delete(key); });
    }
    return this.repositories.get(key);
  }
  dispose() {
    if (!this.cleanupPromise) {
      this.disposed = true; this.controller.abort();
      this.cleanupPromise = this.cleanup();
    }
    return this.cleanupPromise;
  }
  async cleanup() {
    await Promise.allSettled([...this.queues.values(), ...this.repositories.values()]);
    if (!this.rootPromise) return;
    const root = path.resolve(await this.rootPromise);
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('gerrit-workbench-index-') || (await fs.lstat(root)).isSymbolicLink()) throw new Error('Invalid path index cleanup target');
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    this.paths.clear(); this.repositories.clear(); this.queues.clear();
  }
}
module.exports = { PathIndex };
