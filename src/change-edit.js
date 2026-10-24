'use strict';
const crypto = require('node:crypto');
const {tr} = require('./i18n');
const {classifyFile} = require('./files');
// Only the modified side uses this writable provider. Every Base remains on the
// existing read-only gerrit: content provider. Saves go to Gerrit's private edit.
class ChangeEdits {
  constructor(app, vscode, {scheme = 'gerrit-edit'} = {}) {
    this.app = app; this.v = vscode; this.scheme = scheme; this.entries = new Map(); this.sessions = new Map();
    this.events = new vscode.EventEmitter(); this.onDidChangeFile = this.events.event;
  }
  identity() { return crypto.createHash('sha256').update(JSON.stringify([this.app.api?.url, this.app.user?._account_id])).digest('hex').slice(0, 20); }
  async owned(id) {
    const api = this.app.api, account = this.app.user?._account_id;
    if (!api || !Number.isInteger(account)) throw new Error(tr('请先连接 Gerrit'));
    const change = await api.detail(id);
    if (this.app.api !== api || this.app.user?._account_id !== account) throw new Error(tr('连接已更改，请重新打开 Edit'));
    if (change.owner?._account_id !== account || change.status !== 'NEW') throw new Error(tr('只能编辑自己的未关闭提交'));
    return {api, change, account};
  }
  async session(id, rev) {
    const owned = await this.owned(id);
    if (owned.change.current_revision !== rev) throw new Error(tr('最新 PS 已更新，请重新打开 Edit'));
    const key = this.identity() + ':' + id;
    let session = this.sessions.get(key);
    if (session && session.rev !== rev) throw new Error(tr('存在其他 PS 的 Edit，请先处理后重新打开'));
    if (!session) {
      const edit = await owned.api.edit(id);
      if (edit?.base_revision && edit.base_revision !== rev) throw new Error(tr('Edit 基于旧 PS，请先 Rebase Edit 到最新 PS'));
      const existing = this.sessions.get(key);
      if (existing) return existing;
      session = {...owned, id, rev, head: edit?.commit?.commit, key, queue: Promise.resolve()}; this.sessions.set(key, session);
    }
    return session;
  }
  async entry(uri) {
    const cached = this.entries.get(uri.toString()); if (cached) return cached;
    // Rehydrate saved editor URIs after a restart; VS Code retains unsaved buffers
    // in its own editor backups. Never recover across a different server/account.
    if (uri.scheme !== this.scheme || uri.authority !== this.identity()) throw this.v.FileSystemError.NoPermissions();
    const id = new URLSearchParams(uri.query).get('change');
    const parts = uri.path.split('/'); const rev = parts[2], path = parts.slice(3).join('/');
    if (!id || !/^[0-9a-f]{40,64}$/.test(rev || '') || !path || path.startsWith('/')) throw this.v.FileSystemError.FileNotFound(uri);
    const session = await this.session(id, rev);
    const edit = await session.api.edit(id);
    const bytes = edit ? await session.api.editBytes(id, path) : await session.api.bytes(id, rev, path);
    if (classifyFile(bytes, path).kind !== 'text') throw new Error(tr('Edit 仅支持文本文件'));
    const entry = {session, path, bytes, uri, mtime: Date.now()}; this.entries.set(uri.toString(), entry); return entry;
  }
  async stat(uri) {
    const entry = await this.entry(uri);
    return {type: this.v.FileType.File, ctime: 0, mtime: entry.mtime, size: entry.bytes.length, ...(entry.session.retired ? {permissions: this.v.FilePermission.Readonly} : {})};
  }
  async readFile(uri) { return Buffer.from((await this.entry(uri)).bytes); }
  async validate(session) {
    if (session.retired || this.app.api !== session.api || this.app.user?._account_id !== session.account) throw new Error(tr('Edit 会话已失效，请重新打开'));
    const {change} = await this.owned(session.id);
    if (change.current_revision !== session.rev) throw new Error(tr('最新 PS 已更新，请先处理旧 Edit，未保存内容仍保留在编辑器中'));
    const edit = await session.api.edit(session.id);
    if ((edit?.base_revision && edit.base_revision !== session.rev) || edit?.commit?.commit !== session.head) throw new Error(tr('服务器 Edit 已发生变化，请重新打开后处理，避免覆盖其他编辑'));
    return edit;
  }
  async writeFile(uri, content) {
    const entry = await this.entry(uri), session = entry.session, bytes = Buffer.from(content);
    session.queue = session.queue.catch(() => {}).then(async () => {
      await this.validate(session);
      if (bytes.equals(entry.bytes)) return;
      await session.api.putEditFile(session.id, entry.path, bytes);
      // Mark the uploaded bytes before querying the new edit head. A failed follow-up
      // cannot cause a subsequent save to silently overwrite an unknown server edit.
      entry.bytes = bytes; entry.mtime = Date.now();
      const edit = await session.api.edit(session.id); session.head = edit?.commit?.commit;
      this.events.fire([{type: this.v.FileChangeType.Changed, uri}]);
      this.app.loadChangeStatus?.();
    });
    return session.queue;
  }
  watch() { return new this.v.Disposable(() => {}); }
  readDirectory() { return []; }
  createDirectory() { throw this.v.FileSystemError.NoPermissions(); }
  delete() { throw this.v.FileSystemError.NoPermissions(); }
  rename() { throw this.v.FileSystemError.NoPermissions(); }
  active() {
    const input = this.v.window.tabGroups?.activeTabGroup?.activeTab?.input;
    const uri = input?.modified?.scheme === this.scheme ? input.modified : this.v.window.activeTextEditor?.document.uri;
    return uri?.scheme === this.scheme ? this.entries.get(uri.toString()) : undefined;
  }
  hasDirty(id) { return (this.v.workspace.textDocuments || []).some(doc => doc.isDirty && this.entries.get(doc.uri.toString())?.session.id === id); }
  async start() {
    const app = this.app, input = this.v.window.tabGroups?.activeTabGroup?.activeTab?.input;
    const info = input?.modified && app.documents.get(input.modified.toString());
    if (!input?.original || !info || info.empty || info.side !== 'REVISION' || info.rev !== app.selected?.rev || info.id !== app.selected.id) throw new Error(tr('请打开自己最新 PS 的文本 diff，再点击 Edit'));
    const session = await this.session(info.id, info.rev);
    // Reopening clean tabs refreshes a draft changed on the web. Dirty buffers
    // retain their old head and must be reconciled, never silently replaced.
    if (!this.hasDirty(info.id)) {
      const current = await session.api.edit(info.id);
      if (current?.base_revision && current.base_revision !== session.rev) throw new Error(tr('Edit 基于旧 PS，请先 Rebase Edit 到最新 PS'));
      if (current?.commit?.commit !== session.head) {
        const updates = await Promise.all([...this.entries.values()].filter(entry => entry.session === session).map(async entry => ({entry, bytes: current ? await session.api.editBytes(info.id, entry.path) : await session.api.bytes(info.id, info.rev, entry.path)})));
        const latest = await session.api.edit(info.id);
        if (this.hasDirty(info.id) || latest?.commit?.commit !== current?.commit?.commit) throw new Error(tr('服务器 Edit 已发生变化，请重新打开后处理，避免覆盖其他编辑'));
        session.head = current?.commit?.commit;
        for (const {entry, bytes} of updates) {entry.bytes = bytes; entry.mtime = Date.now(); this.events.fire([{type:this.v.FileChangeType.Changed, uri:entry.uri}]);}
      }
    }
    const uri = this.v.Uri.from({scheme: this.scheme, authority: this.identity(), path: `/${session.change._number}/${info.rev}/${info.contentPath || info.path}`, query: 'change=' + encodeURIComponent(info.id)});
    if (!this.entries.has(uri.toString())) {
      const edit = await session.api.edit(info.id);
      const bytes = edit ? await session.api.editBytes(info.id, info.contentPath || info.path) : await session.api.bytes(info.id, info.rev, info.contentPath || info.path);
      if (classifyFile(bytes, info.path).kind !== 'text') throw new Error(tr('Edit 仅支持文本文件'));
      this.entries.set(uri.toString(), {session, path: info.contentPath || info.path, bytes, uri, mtime: Date.now()});
    }
    await this.v.commands.executeCommand('vscode.diff', input.original, uri, tr`${info.path} · Base / PS ↔ Edit（仅右侧可编辑）`, {preview: true});
    app.updateEditContext();
  }
  async save() {
    const entry = this.active(); if (!entry) throw new Error(tr('请先打开 Edit diff'));
    const doc = await this.v.workspace.openTextDocument(entry.uri);
    if (!await doc.save()) throw new Error(tr('Edit 保存失败，内容仍保留在编辑器中'));
  }
  async publish(id = this.active()?.session.id) {
    if (!id) throw new Error(tr('请先打开 Edit diff'));
    const origin = this.active();
    for (const doc of this.v.workspace.textDocuments || []) if (doc.isDirty && this.entries.get(doc.uri.toString())?.session.id === id) {
      if (!await doc.save()) throw new Error(tr('Edit 保存失败，内容仍保留在编辑器中'));
    }
    if (this.hasDirty(id)) throw new Error(tr('仍有未保存的 Edit，请保存后发布'));
    const {api, change} = await this.owned(id);
    const sessions = [...this.sessions.values()].filter(session => session.api === api && session.id === id && !session.retired);
    for (const session of sessions) { await session.queue; await this.validate(session); }
    const edit = await api.edit(id);
    if (!edit) throw new Error(tr('没有可发布的 Edit，请先修改并保存'));
    if (edit.base_revision && edit.base_revision !== change.current_revision) throw new Error(tr('Edit 基于旧 PS，请先 Rebase Edit 到最新 PS'));
    if (this.hasDirty(id)) throw new Error(tr('仍有未保存的 Edit，请保存后发布'));
    await api.publishEdit(id);
    for (const session of sessions) { session.retired = true; this.sessions.delete(session.key); }
    for (const entry of this.entries.values()) if (sessions.includes(entry.session)) this.events.fire([{type:this.v.FileChangeType.Changed, uri:entry.uri}]);
    if (this.app.api === api) await this.app.load(id);
    this.app.updateEditContext();
    if (origin && origin.session.id === id && !this.hasDirty(id) && this.active() === origin && this.app.selected?.id === id && this.app.selected.files?.[origin.path]) await this.app.openDiff(origin.path);
  }
  async rebase(id) {
    if (this.hasDirty(id)) throw new Error(tr('请先保存 Edit，再 Rebase Edit'));
    const {api} = await this.owned(id);
    for (const session of this.sessions.values()) if (session.api === api && session.id === id) await session.queue;
    if (this.hasDirty(id)) throw new Error(tr('请先保存 Edit，再 Rebase Edit'));
    await api.rebaseEdit(id);
    for (const [key, session] of this.sessions) if (session.api === api && session.id === id) { session.retired = true; this.sessions.delete(key); }
    if (this.app.api === api) await this.app.load(id);
    this.app.updateEditContext();
  }
  dispose() { this.events.dispose(); this.sessions.clear(); this.entries.clear(); }
}
module.exports = {ChangeEdits};
