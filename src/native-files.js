'use strict';
const {tr} = require('./i18n');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
// Cache byte-identical originals and delegate all file viewing to VS Code.
class NativeFiles {
  constructor(vscode) { this.vscode = vscode; this.files = new Map(); this.snapshots = new Map(); }
  cache(bytes, info) {
    if (this.disposed) return Promise.reject(new Error(tr('原文件会话已结束，请重新打开')));
    const role = ['old','new'].includes(info.role) ? info.role : 'single';
    const key = crypto.createHash('sha256').update(bytes).update(JSON.stringify([info.path,info.label,!!info.empty,role])).digest('hex');
    if (!this.snapshots.has(key)) {
      const pending = this.store(bytes, { ...info, role });
      this.snapshots.set(key, pending);
      pending.catch(() => this.snapshots.delete(key));
    }
    return this.snapshots.get(key);
  }
  async store(bytes, info) {
    if (this.disposed) throw new Error(tr('原文件会话已结束，请重新打开'));
    if (!this.rootPromise) this.rootPromise = fs.mkdtemp(path.join(os.tmpdir(), 'gerrit-workbench-files-'));
    const root = await this.rootPromise;
    if (this.disposed) throw new Error(tr('原文件会话已结束，请重新打开'));
    const key = crypto.createHash('sha256').update(bytes).update(String(info.label)).update(String(info.path)).update(String(info.empty)).digest('hex');
    const role = ['old','new'].includes(info.role) ? info.role : 'single';
    const revision = String(info.label).match(/PS\s*(\d+)/)?.[1];
    const folder = role + (revision ? '-PS' + revision : '') + (info.side === 'PARENT' || String(info.label).includes('Base') ? '-Base' : '');
    const directory = path.join(root, key, folder);
    await fs.mkdir(directory, { recursive: true });
    let basename = path.posix.basename(info.path).replace(/[<>:"\\|?*\x00-\x1f]/g, '_') || 'file';
    if (basename === '.' || basename === '..') basename = 'file';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename)) basename = '_' + basename;
    basename = basename.replace(/[. ]+$/, '_');
    const file = path.join(directory, info.empty ? 'missing-' + basename + '.txt' : basename);
    if (!this.files.has(file)) {
      await fs.writeFile(file, info.empty ? Buffer.from(tr('此版本不存在该文件\n')) : bytes, { flag: 'wx' });
      await fs.chmod(file, 0o444);
      this.files.set(file, this.vscode.Uri.file(file));
    }
    return this.files.get(file);
  }
  async open(bytes, info, column, preview = false) {
    const uri = await this.cache(bytes, info);
    if (this.disposed) throw new Error(tr('原文件会话已结束，请重新打开'));
    await this.vscode.commands.executeCommand('vscode.open', uri, { viewColumn: column ?? this.vscode.ViewColumn.Active, preview });
    return uri;
  }
  async openPair(snapshots) {
    const v = this.vscode, groups = v.window.tabGroups?.all || [];
    const previous = this.pairColumns && groups.some(group => group.viewColumn === this.pairColumns.left) && groups.some(group => group.viewColumn === this.pairColumns.right) ? this.pairColumns : undefined;
    const left = previous?.left || groups.find(group => group.isActive)?.viewColumn || v.ViewColumn.One || 1;
    const right = previous?.right || groups.find(group => group.viewColumn === left + 1)?.viewColumn || v.ViewColumn.Beside;
    const errors = [];
    for (let i = 0; i < snapshots.length; i++) {
      try { await this.open(snapshots[i].bytes, { ...snapshots[i], role: i ? 'new' : 'old' }, i ? right : left, true); }
      catch (error) { errors.push((i ? tr('新版：') : tr('旧版：')) + error.message); }
    }
    this.pairColumns = { left, right: right === v.ViewColumn.Beside ? left + 1 : right };
    if (errors.length) throw new Error(tr('已尝试交给 VS Code 打开原文件；是否可预览取决于已安装的文件扩展。') + errors.join('；'));
  }
  dispose() {
    if (!this.cleanupPromise) this.cleanupPromise = this.cleanup();
    return this.cleanupPromise;
  }
  async cleanup() {
    this.disposed = true;
    await Promise.allSettled([...this.snapshots.values()]);
    if (!this.rootPromise) return;
    const root = path.resolve(await this.rootPromise);
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('gerrit-workbench-files-') || (await fs.lstat(root)).isSymbolicLink()) throw new Error('Invalid snapshot cleanup path');
    for (const file of this.files.keys()) {
      if (!path.resolve(file).startsWith(root + path.sep)) throw new Error('Invalid snapshot path');
      await fs.chmod(file, 0o600).catch(() => {});
    }
    this.files.clear(); await fs.rm(root, { recursive: true, force: true });
  }
}
module.exports = { NativeFiles };
