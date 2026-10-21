'use strict';
const vscode = require('vscode');
const crypto = require('node:crypto');
const { GerritApi, normalizeUrl } = require('./api');
const { git, pushRef } = require('./git');
const { comparisonPlan, comparisonFiles } = require('./comparison');
const { Logger } = require('./log');
const { BrowserGateway } = require('./browser');
const { sshUrl, downloadBranch } = require('./download');

function activate(context) {
  const app = new Workbench(context);
  context.subscriptions.push(app,
    vscode.window.registerWebviewViewProvider('gerrit.dashboard', app),
    vscode.workspace.registerTextDocumentContentProvider('gerrit', app),
    vscode.commands.registerCommand('gerrit.connect', () => app.run(() => app.connect())),
    vscode.commands.registerCommand('gerrit.refresh', () => app.run(() => app.refresh())),
    vscode.commands.registerCommand('gerrit.push', () => app.run(() => app.push())),
    vscode.commands.registerCommand('gerrit.comment', () => app.run(() => app.addComment())),
    vscode.commands.registerCommand('gerrit.reply', reply => app.run(() => app.reply(reply))),
    vscode.commands.registerCommand('gerrit.settings', () => app.openSettings()),
    vscode.commands.registerCommand('gerrit.logs', () => app.output.show(true)),
    vscode.commands.registerCommand('gerrit.discussion', () => app.run(() => app.openDiscussion())),
    vscode.commands.registerCommand('gerrit.nextComment', () => app.run(() => app.navigateComment(1))),
    vscode.commands.registerCommand('gerrit.previousComment', () => app.run(() => app.navigateComment(-1))),
    vscode.commands.registerCommand('gerrit.fileComments', () => app.run(() => app.navigateComment(0))),
    vscode.commands.registerCommand('gerrit._viewStatus', () => ({ resolved: !!app.view, ready: !!app.sidebarReady, error: app.sidebarError || null })),
    vscode.window.onDidChangeVisibleTextEditors(() => app.updateDecorations()),
    vscode.languages.registerHoverProvider({ scheme: 'gerrit' }, { provideHover: (document, position) => app.commentHover(document, position) }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('gerrit')) app.run(async () => {
      app.configure();
      if (event.affectsConfiguration('gerrit.defaultQuery')) app.model.query = app.setting('defaultQuery', 'is:open');
      if (event.affectsConfiguration('gerrit.comments.expandThreads')) for (const [thread] of app.threads) {
        if (thread.comments.length) thread.collapsibleState = app.setting('comments.expandThreads', false) ? vscode.CommentThreadCollapsibleState.Expanded : vscode.CommentThreadCollapsibleState.Collapsed;
      }
      if (event.affectsConfiguration('gerrit.pageSize') || event.affectsConfiguration('gerrit.defaultQuery')) {
        app.model.start = 0; if (app.api) await app.refresh();
      }
    }); })
  );
}
class Workbench {
  constructor(context) {
    this.context = context;
    this.output = vscode.window.createOutputChannel('Gerrit Workbench');
    this.logger = new Logger(this.output);
    this.model = { connected: false, changes: [], query: this.setting('defaultQuery', 'is:open'), start: 0 };
    this.configure();
    this.documents = new Map(); this.threads = new Map(); this.selected = null; this.busy = false;
    this.commentDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'comment.svg'), gutterIconSize: 'contain',
      overviewRulerColor: new vscode.ThemeColor('gerrit.commentMarker'), overviewRulerLane: vscode.OverviewRulerLane.Full
    });
    this.controller = vscode.comments.createCommentController('gerrit', 'Gerrit');
    this.controller.commentingRangeProvider = { provideCommentingRanges: document => {
      const info = this.documents.get(document.uri.toString());
      return this.validInfo(info) && !info.empty ? [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)] : undefined;
    } };
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
    this.status.text = '$(git-pull-request) Gerrit'; this.status.command = 'gerrit.dashboard.focus'; this.status.tooltip = '打开 Gerrit 工作台'; this.status.show();
  }
  setting(key, fallback) { return vscode.workspace.getConfiguration('gerrit').get(key, fallback); }
  configure() {
    this.logger.level = this.setting('logLevel', 'info');
    this.model.pageSize = this.setting('pageSize', 50);
    this.model.commitInfoExpanded = this.setting('commitInfo.defaultExpanded', false);
    if (this.api) { this.api.pageSize = this.model.pageSize; this.api.timeout = this.setting('requestTimeout', 30000); }
    this.render();
  }
  createApi(url, username, password, authMode) {
    this.logger.protect(password); this.logger.protect(Buffer.from(`${username}:${password}`).toString('base64'));
    return new GerritApi(url, username, password, { authMode, pageSize: this.model.pageSize, timeout: this.setting('requestTimeout', 30000), log: (level, message) => this.logger.write(level, message) });
  }
  openSettings() { return vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local-tools.gerrit-workbench'); }
  validInfo(info) { return !!(info && this.selected && info.id === this.selected.id && (this.selected.change.revisions ? this.selected.change.revisions[info.rev] : info.rev === this.selected.rev)); }
  dispose() { this.gateway?.dispose(); this.discussion?.dispose(); this.clearThreads(); this.controller.dispose(); this.commentDecoration.dispose(); this.status.dispose(); this.output.dispose(); }
  clearThreads() { for (const thread of this.threads.keys()) thread.dispose(); this.threads.clear(); }
  async run(fn) {
    if (this.busy) return;
    this.busy = true; this.send({ type: 'busy', value: true });
    try { await fn(); } catch (error) { this.logger.write('error', error.logMessage || error.message); this.send({ type: 'error', message: error.message }); vscode.window.showErrorMessage(`Gerrit: ${error.message}`); }
    finally { this.busy = false; this.send({ type: 'busy', value: false }); }
  }
  send(message) { this.view?.webview.postMessage(message); this.discussion?.webview.postMessage(message); }
  render() {
    this.model.commitInfoExpanded = this.setting('commitInfo.defaultExpanded', false);
    this.model.accountId = this.user?._account_id;
    this.model.username = this.user?.username;
    this.updateDecorations();
    this.view?.webview.postMessage({ type: 'state', model: { ...this.model, surface: 'sidebar' } });
    this.discussion?.webview.postMessage({ type: 'state', model: { ...this.model, surface: 'discussion' } });
  }
  async resolveWebviewView(view) {
    this.view = view;
    this.sidebarReady = false; this.sidebarError = undefined;
    this.setupWebview(view.webview);
  }
  receiveMessage(webview, message) {
    if (message?.type === 'init') {
      // A newly loaded page must receive state even while another action is busy.
      this.render(); webview.postMessage({ type: 'busy', value: this.busy });
      if (!this.api && !this.busy) return this.run(() => this.restore());
      return;
    }
    if (message?.type === 'rendered') {
      if (webview === this.view?.webview) { this.sidebarReady = true; this.sidebarError = undefined; }
      return;
    }
    if (message?.type === 'clientError') {
      const text = String(message.message || '工作台页面加载失败').slice(0, 500);
      if (webview === this.view?.webview) this.sidebarError = text;
      this.logger.write('error', `Webview: ${text}`);
      vscode.window.showErrorMessage(`Gerrit 工作台页面加载失败：${text}`); return;
    }
    return this.run(() => this.handle(message));
  }
  setupWebview(webview) {
    const root = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    webview.options = { enableScripts: true, localResourceRoots: [root] };
    const nonce = crypto.randomBytes(18).toString('hex');
    const fs = require('node:fs');
    webview.onDidReceiveMessage(message => this.receiveMessage(webview, message), undefined, this.context.subscriptions);
    webview.html = fs.readFileSync(vscode.Uri.joinPath(root, 'index.html').fsPath, 'utf8')
      .replaceAll('{{csp}}', webview.cspSource).replaceAll('{{nonce}}', nonce)
      .replace('{{css}}', webview.asWebviewUri(vscode.Uri.joinPath(root, 'style.css')).toString())
      .replace('{{js}}', webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js')).toString());
  }
  openDiscussion() {
    if (!this.selected) throw new Error('请先打开一笔变更');
    if (!this.discussion) {
      const panel = vscode.window.createWebviewPanel('gerrit.discussion', 'Gerrit 评审讨论', vscode.ViewColumn.Active, { retainContextWhenHidden: true });
      this.discussion = panel;
      panel.onDidDispose(() => { if (this.discussion === panel) this.discussion = undefined; }, undefined, this.context.subscriptions);
      this.setupWebview(panel.webview);
    } else this.discussion.reveal(vscode.ViewColumn.Active);
    this.discussion.title = `#${this.selected.change._number} · 评审讨论`;
    this.render();
  }
  async openBrowser() {
    const path = `${new URL(this.api.url).pathname.replace(/\/$/, '')}/c/${this.selected.change._number}`;
    if (!this.gateway) {
      let api = this.api;
      if (api.authMode !== 'webPassword') {
        const password = await vscode.window.showInputBox({ title: '内置浏览器：网页登录密码', prompt: '网页反向代理需要网页登录密码（不会替换当前 HTTP Key，也不会写入网址）', password: true, ignoreFocusOut: true });
        if (!password) return;
        api = this.createApi(this.api.url, this.user.username, password, 'webPassword');
        await api.self();
      }
      const gateway = new BrowserGateway(api);
      try { await gateway.start(); this.gateway = gateway; } catch (error) { gateway.dispose(); throw error; }
    }
    const entry = this.gateway.entry(path);
    const local = await vscode.env.asExternalUri(vscode.Uri.parse(entry));
    const url = local.toString();
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('workbench.action.browser.open')) return vscode.commands.executeCommand('workbench.action.browser.open', url);
    throw new Error('此 VS Code 版本未提供集成浏览器，请升级 VS Code 后使用认证网页入口；原生代码查看和评审功能可继续使用');
  }
  async restore() {
    const saved = this.context.globalState.get('connection');
    if (!saved) return;
    const secret = await this.context.secrets.get(`gerrit:${saved.url}:${saved.username}`);
    if (!secret) return;
    const api = this.createApi(saved.url, saved.username, secret, saved.authMode || 'httpKey');
    const user = await api.self(); this.api = api; this.user = user;
    this.model.connected = true; this.model.server = api.url; this.model.user = user.name || user.username;
    this.render();
    await this.refresh();
  }
  async connect() {
    const old = this.context.globalState.get('connection', {});
    const urlInput = await vscode.window.showInputBox({ title: '连接 Gerrit · 1/4', prompt: '服务器地址（支持 /gerrit 子路径，也可粘贴 /dashboard/self 网页地址）', value: old.url || 'https://', ignoreFocusOut: true, validateInput: text => { try { normalizeUrl(text); } catch (e) { return e.message; } } });
    if (!urlInput) return;
    const url = normalizeUrl(urlInput);
    if (url.startsWith('http:') && !await this.confirm('HTTP 连接会以明文传输凭据。仍要连接此服务器？', '继续连接')) return;
    const modes = [
      { label: 'HTTP Key / HTTP 密码', description: '使用 Gerrit 生成的 Key，通过 /a/ API 认证', authMode: 'httpKey' },
      { label: '网页登录密码（HTTP 反向代理）', description: '使用 /login/ 建立会话，通过不带 /a/ 的 API 访问', authMode: 'webPassword' }
    ];
    if (old.authMode === 'webPassword') modes.reverse();
    const mode = await vscode.window.showQuickPick(modes, { title: '连接 Gerrit · 2/4：选择认证方式', ignoreFocusOut: true });
    if (!mode) return;
    const username = await vscode.window.showInputBox({ title: '连接 Gerrit · 3/4', prompt: 'Gerrit 用户名', value: old.username, ignoreFocusOut: true, validateInput: s => !s.trim() || s.includes(':') ? '请输入有效用户名' : undefined });
    if (!username) return;
    const keyInput = await vscode.window.showInputBox({ title: `连接 Gerrit · 4/4：${mode.authMode === 'webPassword' ? '网页登录密码' : 'HTTP Key'}`, prompt: mode.authMode === 'webPassword' ? '输入平时网页登录使用的密码，插件会建立独立登录会话' : '输入 Gerrit HTTP Key / HTTP 密码（Settings → HTTP Credentials），不是网页登录密码', password: true, ignoreFocusOut: true });
    const password = mode.authMode === 'webPassword' ? keyInput : keyInput?.trim();
    if (!password) return;
    const api = this.createApi(url, username.trim(), password, mode.authMode); const user = await api.self();
    await this.context.secrets.store(`gerrit:${url}:${username.trim()}`, password);
    await this.context.globalState.update('connection', { url, username: username.trim(), authMode: mode.authMode });
    if (old.url && (old.url !== url || old.username !== username.trim())) await this.context.secrets.delete(`gerrit:${old.url}:${old.username}`);
    this.gateway?.dispose(); this.gateway = undefined;
    this.clearThreads(); this.documents.clear(); this.selected = null; this.api = api; this.user = user;
    this.model = { connected: true, server: url, user: user.name || user.username, changes: [], query: this.setting('defaultQuery', 'is:open'), start: 0, pageSize: this.setting('pageSize', 50) };
    this.render();
    await this.refresh();
    vscode.window.showInformationMessage(`Gerrit 已连接：${user.name || user.username} · ${url}`);
  }
  needConnection() { if (!this.api) throw new Error('请先点击“连接服务器”'); }
  async refresh() {
    this.needConnection();
    this.model.changes = (await this.api.list(this.model.query, this.model.start)).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    this.model.more = Boolean(this.model.changes.at(-1)?._more_changes);
    if (this.selected) await this.load(this.selected.id, false);
    this.render();
  }
  async load(id, render = true) {
    const change = await this.api.detail(id); const rev = change.current_revision;
    let plan = comparisonPlan(change.revisions, 'base', rev);
    if (this.selected?.id === change.id && this.selected.comparison) {
      try { plan = comparisonPlan(change.revisions, this.selected.comparison.left, this.selected.comparison.right); } catch { /* A removed patch set resets comparison. */ }
    }
    const [rawFiles, comments] = await Promise.all([this.api.files(id, plan.revision, plan.base), this.api.allComments(id)]);
    const files = comparisonFiles(rawFiles, plan.reverse);
    const patchView = this.selected?.id === change.id ? this.model.detail?.patchView : undefined;
    this.clearThreads(); this.selected = { id: change.id, rev, change, files, comments, comparison: plan };
    this.model.detail = { ...change, files, comments, comparison: plan, patchView, mine: change.owner?._account_id === this.user._account_id };
    if (this.discussion) this.discussion.title = `#${change._number} · 评审讨论`;
    // Reattach comments in any already-open snapshot for this exact patch set.
    for (const [uri, info] of this.documents) if (this.validInfo(info)) await this.attach(vscode.Uri.parse(uri), info);
    if (render) this.render();
  }
  async compare(left, right) {
    const s = this.selected; const plan = comparisonPlan(s.change.revisions, left, right);
    const files = comparisonFiles(await this.api.files(s.id, plan.revision, plan.base), plan.reverse);
    s.files = files; s.comparison = plan;
    this.model.detail.files = files; this.model.detail.comparison = plan; delete this.model.detail.patchView; this.render();
  }
  async selectPatch(rev, query = '') {
    const s = this.selected;
    if (!s.change.revisions[rev]) throw new Error('Patch set 不存在');
    const files = await this.api.treeFiles(s.id, rev, query);
    if (!Array.isArray(files)) throw new Error('服务器未返回此 Patch set 的文件清单');
    this.model.detail.patchView = { rev, query, files: files.filter(p => typeof p === 'string').sort() }; this.render();
  }
  async openSingle(path, rev, side = 'REVISION') {
    const s = this.selected;
    if (!s.change.revisions[rev]) throw new Error('Patch set 不存在');
    let contentPath = path;
    if (side === 'PARENT') contentPath = (await this.api.files(s.id, rev))[path]?.old_path || path;
    const content = await this.api.content(s.id, rev, contentPath, side === 'PARENT');
    const uri = vscode.Uri.from({ scheme: 'gerrit', authority: crypto.createHash('sha256').update(this.api.url).digest('hex').slice(0, 12), path: `/${s.change._number}/${rev}/${side}/${path}` });
    this.documents.set(uri.toString(), { id: s.id, rev, path, content, side, label: `PS ${s.change.revisions[rev]._number}${side === 'PARENT' ? ' Base' : ''}` });
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Active, preview: false });
    await this.attach(uri, this.documents.get(uri.toString())); return editor;
  }
  async download() {
    const s = this.selected; const rev = this.model.detail.patchView?.rev || s.rev; const revision = s.change.revisions[rev];
    const choice = await vscode.window.showQuickPick([
      { label: `下载 PS ${revision._number} 到本地独立分支`, patch: true },
      { label: `下载目标分支 ${s.change.branch}`, patch: false }
    ], { title: 'SSH 下载（使用本机 SSH key / agent）', ignoreFocusOut: true });
    if (!choice) return;
    const folders = await vscode.window.showOpenDialog({ title: '选择下载目录的父文件夹', canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
    if (!folders?.length) return;
    const basename = s.change.project.split('/').at(-1).replace(/[^a-zA-Z0-9._-]/g, '_');
    const name = await vscode.window.showInputBox({ title: '新建下载目录名称', value: `${basename}-${choice.patch ? `change-${s.change._number}-ps${revision._number}` : s.change.branch.replace(/[^a-zA-Z0-9._-]/g, '_')}`, ignoreFocusOut: true });
    if (!name) return;
    const url = sshUrl(revision.fetch, this.user.username);
    let directory;
    try {
      directory = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'SSH 下载代码…' }, () => downloadBranch({ parent: folders[0].fsPath, name, url, branch: s.change.branch, ref: choice.patch ? revision.ref : undefined, revision: rev }, (cwd, args, options) => this.runGit(cwd, args, options)));
    } catch (error) {
      if (/Permission denied|publickey|Host key verification failed|Could not resolve hostname|Connection refused|Could not read from remote repository/i.test(error.message)) throw new Error('SSH 下载失败：请检查本机 SSH key / agent、公钥是否已添加到 Gerrit、SSH 端口及 known_hosts。可先在终端连接 Gerrit SSH 确认主机指纹后重试。');
      throw error;
    }
    const open = await vscode.window.showInformationMessage(`代码已下载到 ${directory}`, '在新窗口打开');
    if (open) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(directory), true);
  }
  async handle(m) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'init') { this.render(); if (!this.api) await this.restore(); return; }
    if (m.type === 'connect') return this.connect();
    if (m.type === 'settings') return this.openSettings();
    if (m.type === 'logs') return this.output.show(true);
    if (m.type === 'disconnect') {
      const saved = this.context.globalState.get('connection');
      if (saved) await this.context.secrets.delete(`gerrit:${saved.url}:${saved.username}`);
      await this.context.globalState.update('connection', undefined); this.gateway?.dispose(); this.gateway = undefined; this.api = null; this.selected = null; this.clearThreads(); this.documents.clear();
      this.model = { connected: false, changes: [], query: this.setting('defaultQuery', 'is:open'), start: 0, pageSize: this.setting('pageSize', 50) }; this.render(); return;
    }
    if (m.type === 'push') return this.push();
    this.needConnection();
    if (m.type === 'search') { this.model.query = String(m.query || 'is:open'); this.model.start = 0; return this.refresh(); }
    if (m.type === 'page') { this.model.start = Math.max(0, this.model.start + (m.next ? this.model.pageSize : -this.model.pageSize)); return this.refresh(); }
    if (m.type === 'refresh') return this.refresh();
    if (m.type === 'open') return this.load(String(m.id));
    if (m.type === 'back') { this.selected = null; delete this.model.detail; this.clearThreads(); this.render(); return; }
    const s = this.selected; if (!s || m.id !== s.id || m.rev !== s.rev) throw new Error('页面已更新，请重新选择变更后操作');
    if (m.type === 'file') {
      if (m.compareLeft && (m.compareLeft !== s.comparison?.left || m.compareRight !== s.comparison?.right)) throw new Error('比较版本已更新，请重新点击文件');
      return this.openDiff(String(m.path));
    }
    if (m.type === 'locate') return this.locateComment(m.path, m.comment);
    if (m.type === 'patch') return this.selectPatch(String(m.patchRev || s.rev));
    if (m.type === 'patchSearch') return this.selectPatch(String(m.patchRev), String(m.query || '').trim());
    if (m.type === 'single') {
      if (this.model.detail.patchView?.rev !== m.patchRev || !this.model.detail.patchView.files.includes(m.path)) throw new Error('文件版本已更新，请重新选择');
      return this.openSingle(String(m.path), String(m.patchRev));
    }
    if (m.type === 'download') return this.download();
    if (m.type === 'compare') return this.compare(String(m.left), String(m.right));
    if (m.type === 'discussion') return this.openDiscussion();
    if (m.type === 'browser') return this.openBrowser();
    if (m.type === 'review') {
      const labels = {};
      for (const [name, value] of Object.entries(m.labels || {})) {
        if (!(s.change.permitted_labels?.[name] || []).some(v => Number(v) === Number(value))) throw new Error('评分超出当前权限，请刷新');
        labels[name] = Number(value);
      }
      const message = String(m.message || '').trim();
      if (!message && !Object.keys(labels).length) throw new Error('请输入评论或选择评分');
      await this.api.review(s.id, s.rev, { message, labels });
      this.send({ type: 'reviewSent' }); await this.load(s.id); return;
    }
    if (m.type === 'reply') {
      const parent = s.comments[m.path]?.find(c => c.id === m.comment);
      if (!parent) throw new Error('评论不存在，请刷新');
      const text = String(m.message || '').trim(); if (!text) throw new Error('请输入回复内容');
      const rev = Object.keys(s.change.revisions).find(key => s.change.revisions[key]._number === parent.patch_set) || s.rev;
      await this.postComment({ ...parent, rev, path: m.path }, text, parent.id); this.send({ type: 'replySent', comment: parent.id }); await this.load(s.id); return;
    }
    if (m.type === 'action') {
      const action = String(m.action); const titles = { ready: '发布为待评审', abandon: '废弃变更', submit: '合入目标分支' };
      if (!titles[action] || !s.change.actions?.[action]?.enabled) throw new Error('当前状态或权限不允许此操作，请刷新');
      if (['ready', 'abandon'].includes(action) && !this.model.detail.mine) throw new Error('此入口仅操作自己的提交');
      if (!await this.confirm(`${titles[action]}：#${s.change._number} ${s.change.subject}`, titles[action])) return;
      let message;
      if (action === 'abandon') { message = await vscode.window.showInputBox({ title: '废弃原因（可留空，Esc 取消）', ignoreFocusOut: true }); if (message === undefined) return; }
      await this.api.action(s.id, action, message ? { message } : {}); await this.refresh();
    }
  }
  async confirm(message, button) { return await vscode.window.showWarningMessage(message, { modal: true }, button) === button; }
  provideTextDocumentContent(uri) { const doc = this.documents.get(uri.toString()); if (!doc) throw new Error('此 Gerrit 快照已失效，请从工作台重新打开文件'); return doc.content; }
  async openDiff(path) {
    const s = this.selected; const file = s.files[path]; if (!file) throw new Error('文件不存在');
    if (file.binary) throw new Error('二进制文件请点击“内置浏览器”查看');
    const plan = s.comparison || comparisonPlan(s.change.revisions, 'base', s.rev);
    const sides = [plan.left, plan.right].map((value, index) => {
      const rev = value === 'base' ? plan.revision : value;
      const contentPath = index === 0 ? file.old_path || path : path;
      // Parent comments are keyed by the filename in their patch set, including renames.
      const commentPath = value === 'base' ? (plan.reverse ? file.old_path || path : path) : contentPath;
      return { id: s.id, rev, side: value === 'base' ? 'PARENT' : 'REVISION', path: commentPath, contentPath,
        label: value === 'base' ? `Base (PS ${s.change.revisions[rev]._number} 的第一父提交)` : `PS ${s.change.revisions[rev]._number}`,
        empty: index === 0 ? file.status === 'A' : file.status === 'D' };
    });
    const contents = await Promise.all(sides.map(info => info.empty ? '' : this.api.content(s.id, info.rev, info.contentPath, info.side === 'PARENT')));
    const uris = sides.map((info, index) => {
      const uri = vscode.Uri.from({ scheme: 'gerrit', authority: crypto.createHash('sha256').update(this.api.url).digest('hex').slice(0, 12), path: `/${s.change._number}/${info.rev}/${info.side}/${info.empty ? 'empty/' : ''}${info.path}` });
      this.documents.set(uri.toString(), { ...info, content: contents[index] }); return uri;
    });
    await vscode.commands.executeCommand('vscode.diff', uris[0], uris[1], `${path} · ${sides[0].label} ↔ ${sides[1].label}`, { preview: false, viewColumn: this.setting('diff.openBeside', false) ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active });
    for (const uri of uris) await this.attach(uri, this.documents.get(uri.toString()));
  }
  commentsFor(info) {
    if (!this.validInfo(info) || info.empty) return [];
    const number = this.selected.change.revisions?.[info.rev]?._number;
    return (this.selected.comments[info.path] || []).filter(c => (c.side || 'REVISION') === info.side && (c.patch_set === undefined ? info.rev === this.selected.rev : c.patch_set === number));
  }
  commentHover(document, position) {
    const info = this.documents.get(document.uri.toString());
    const comments = this.commentsFor(info).filter(c => c.line && position.line + 1 >= (c.range?.start_line || c.line) && position.line + 1 <= (c.range?.end_line || c.line));
    if (!comments.length) return undefined;
    const body = new vscode.MarkdownString();
    body.appendText(`此处有 ${comments.length} 条 Gerrit 评论（${info.label || info.side}）\n点击行号旁的评论图标展开并回复。\n\n`);
    for (const c of comments.slice(-5)) body.appendText(`${c.author?.name || c.author?.username || 'Gerrit 用户'}：${c.message.slice(0, 600)}\n\n`);
    return new vscode.Hover(body);
  }
  async locateComment(path, id) {
    const s = this.selected; const comment = s.comments[path]?.find(c => c.id === id);
    if (!comment) throw new Error('评论已不存在，请刷新');
    const rev = Object.keys(s.change.revisions).find(key => s.change.revisions[key]._number === comment.patch_set) || s.rev;
    const editor = await this.openSingle(path, rev, comment.side || 'REVISION');
    const document = editor.document;
    const line = Math.max(0, Math.min(document.lineCount - 1, (comment.range?.start_line || comment.line || 1) - 1));
    editor.selection = new vscode.Selection(line, 0, line, 0);
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
    for (const [thread, info] of this.threads) if (thread.uri.toString() === document.uri.toString() && info.commentIds?.includes(id)) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  }
  async attach(uri, info) {
    for (const [thread] of this.threads) if (thread.uri.toString() === uri.toString()) { thread.dispose(); this.threads.delete(thread); }
    const comments = this.commentsFor(info);
    const ids = new Map(comments.map(c => [c.id, c])); const groups = new Map();
    for (const c of comments) {
      let root = c; const visited = new Set();
      while (root.in_reply_to && ids.has(root.in_reply_to) && !visited.has(root.id)) { visited.add(root.id); root = ids.get(root.in_reply_to); }
      const group = groups.get(root.id) || []; group.push(c); groups.set(root.id, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => String(a.updated).localeCompare(String(b.updated)));
      const c = group[0];
      const range = c.range ? new vscode.Range(c.range.start_line - 1, c.range.start_character, c.range.end_line - 1, c.range.end_character) : c.line ? new vscode.Range(c.line - 1, 0, c.line - 1, 0) : undefined;
      const thread = this.controller.createCommentThread(uri, range, group.map(item => ({ body: item.message, mode: vscode.CommentMode.Preview, author: { name: item.author?.name || item.author?.username || 'Gerrit 用户' } })));
      thread.label = `${info.label || info.side} · 回复将立即发布`;
      thread.collapsibleState = this.setting('comments.expandThreads', false) ? vscode.CommentThreadCollapsibleState.Expanded : vscode.CommentThreadCollapsibleState.Collapsed;
      thread.state = group.at(-1).unresolved ? vscode.CommentThreadState.Unresolved : vscode.CommentThreadState.Resolved;
      this.threads.set(thread, { ...info, parent: group.at(-1), commentIds: group.map(item => item.id) });
    }
    this.updateDecorations();
  }
  commentPoints(info) {
    const points = new Map();
    for (const comment of this.commentsFor(info)) {
      const line = Math.max(0, (comment.range?.start_line || comment.line || 1) - 1);
      const group = points.get(line) || []; group.push(comment); points.set(line, group);
    }
    return [...points].sort((a, b) => a[0] - b[0]);
  }
  updateDecorations() {
    if (!this.documents || !this.commentDecoration) return;
    for (const editor of vscode.window.visibleTextEditors || []) {
      const info = this.documents.get(editor.document.uri.toString());
      const marks = this.commentPoints(info).filter(([line]) => line < editor.document.lineCount).map(([line, comments]) => ({
        range: new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length),
        hoverMessage: `${comments.length} 条 Gerrit 评论；使用编辑器右上角“本文件评论”查看位置和跳转。`,
        renderOptions: { after: { contentText: `  💬 ${comments.length}`, color: new vscode.ThemeColor('gerrit.commentMarker'), margin: '0 0 0 1em' } }
      }));
      editor.setDecorations(this.commentDecoration, marks);
    }
  }
  async navigateComment(direction) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const points = this.commentPoints(this.documents.get(editor.document.uri.toString()));
    if (!points.length) { vscode.window.showInformationMessage('当前文件版本没有评论'); return; }
    let point;
    if (!direction) {
      const picked = await vscode.window.showQuickPick(points.map(([line, comments]) => ({ label: `行 ${line + 1} · ${comments.length} 条评论`, description: comments.map(c => `${c.author?.name || c.author?.username || '用户'}: ${c.message}`).join(' | ').replace(/\s+/g, ' ').slice(0, 250), point: [line, comments] })), { title: '本文件评论位置', matchOnDescription: true });
      point = picked?.point;
    } else {
      const current = editor.selection.active?.line ?? editor.selection.end.line;
      point = direction > 0 ? points.find(([line]) => line > current) || points[0] : points.slice().reverse().find(([line]) => line < current) || points.at(-1);
    }
    if (!point) return;
    const line = Math.min(editor.document.lineCount - 1, point[0]);
    editor.selection = new vscode.Selection(line, 0, line, 0); editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
    for (const [thread, info] of this.threads) if (thread.uri.toString() === editor.document.uri.toString() && info.commentIds?.some(id => point[1].some(c => c.id === id))) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    vscode.window.setStatusBarMessage(`Gerrit 评论 ${points.indexOf(point) + 1 || points.findIndex(p => p[0] === point[0]) + 1}/${points.length} · 行 ${line + 1}`, 5000);
  }
  async addComment() {
    const editor = vscode.window.activeTextEditor; if (!editor) return;
    const info = this.documents.get(editor.document.uri.toString());
    if (!this.validInfo(info) || info.empty) throw new Error('请从当前变更详情打开非空的文件版本');
    const thread = this.controller.createCommentThread(editor.document.uri, editor.selection, []);
    thread.label = `新建评论 · ${info.label || info.side} · 发布后立即可见`;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.threads.set(thread, { ...info });
  }
  async reply(reply) {
    if (!reply?.thread || !reply.text?.trim()) return;
    const thread = reply.thread;
    const info = this.threads.get(thread) || this.documents.get(thread.uri.toString());
    if (!this.validInfo(info) || info.empty) throw new Error('此评论属于旧变更，请重新打开');
    const r = thread.range;
    const range = !info.parent && r && !r.isEmpty ? { start_line: r.start.line + 1, start_character: r.start.character, end_line: r.end.line + 1, end_character: r.end.character } : info.parent?.range;
    await this.postComment({ ...info, ...(info.parent || {}), path: info.path, side: info.side, range, line: info.parent?.line || (r ? r.end.line + 1 : undefined) }, reply.text.trim(), info.parent?.id);
    if (!this.threads.has(thread)) thread.dispose();
    await this.load(info.id);
  }
  async postComment(info, message, parent) {
    const s = this.selected;
    const c = { message, side: info.side || 'REVISION', unresolved: true };
    if (info.line) c.line = info.line;
    if (info.range) c.range = info.range;
    if (parent) { c.in_reply_to = parent; c.unresolved = info.unresolved ?? true; }
    const revision = info.rev || s.rev;
    if (!this.validInfo({ ...info, id: s.id, rev: revision })) throw new Error('评论版本已失效，请重新打开文件');
    await this.api.review(s.id, revision, { comments: { [info.path]: [c] } });
  }
  async runGit(cwd, args, options) {
    const started = Date.now(); const operation = args[0];
    this.logger.write('debug', `Git ${operation} 开始`);
    try { const result = await git(cwd, args, options); this.logger.write('info', `Git ${operation} 成功 (${Date.now() - started} ms)`); return result; }
    catch (error) { error.logMessage = `Git ${operation} 失败 (${Date.now() - started} ms)`; this.logger.write('error', error.logMessage); throw error; }
  }
  async push() {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任此工作区');
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error('请先打开本地 Git 仓库');
    const folder = folders.length === 1 ? folders[0] : (await vscode.window.showQuickPick(folders.map(f => ({ label: f.name, folder: f })), { title: '选择要提交的仓库' }))?.folder;
    if (!folder) return;
    const cwd = folder.uri.fsPath;
    await this.runGit(cwd, ['rev-parse', '--show-toplevel']);
    if (await this.runGit(cwd, ['status', '--porcelain'])) {
      const choice = await vscode.window.showQuickPick([
        { label: '提交已暂存文件，再推送 HEAD', commit: true },
        { label: '仅推送已有 HEAD（保留未提交修改）', commit: false }
      ], { title: '工作区存在未提交修改', ignoreFocusOut: true });
      if (!choice) return;
      if (choice.commit) {
        if (!await this.runGit(cwd, ['diff', '--cached', '--name-only'])) throw new Error('没有已暂存文件，请在源代码管理面板中暂存需要提交的文件');
        const message = await vscode.window.showInputBox({ title: 'Commit 信息（使用仓库的 commit-msg hook 生成 Change-Id）', ignoreFocusOut: true, validateInput: t => t.trim() ? undefined : '请输入提交信息' });
        if (!message) return;
        await this.runGit(cwd, ['commit', '-m', message]);
      }
    }
    const remotes = (await this.runGit(cwd, ['remote'])).split('\n').filter(Boolean);
    const remote = await vscode.window.showQuickPick(remotes, { title: '选择 Gerrit Git remote', ignoreFocusOut: true }); if (!remote) return;
    const branch = await vscode.window.showInputBox({ title: '目标分支（例如 main / master）', value: await this.runGit(cwd, ['branch', '--show-current']), ignoreFocusOut: true }); if (!branch) return;
    const mode = await vscode.window.showQuickPick([{ label: '发布为待评审', wip: false }, { label: '上传为 WIP，稍后发布', wip: true }], { title: '上传方式', ignoreFocusOut: true }); if (!mode) return;
    const ref = pushRef(branch, mode.wip);
    await this.runGit(cwd, ['check-ref-format', `refs/heads/${branch}`]);
    // Fetch the target into FETCH_HEAD to inspect the entire outgoing commit stack.
    await this.runGit(cwd, ['fetch', '--no-tags', '--', remote, `refs/heads/${branch}`]);
    const commits = (await this.runGit(cwd, ['rev-list', '--reverse', 'FETCH_HEAD..HEAD'])).split('\n').filter(Boolean);
    if (!commits.length) throw new Error('没有需要上传到该目标分支的新 commit');
    const summaries = [];
    for (const hash of commits) {
      const message = await this.runGit(cwd, ['show', '-s', '--format=%B', hash]);
      if (!/^Change-Id: I[0-9a-f]{40}\s*$/m.test(message)) throw new Error(`Commit ${hash.slice(0, 8)} 缺少有效 Change-Id。请安装 Gerrit commit-msg hook 并 amend 对应 commit 后重试（README 有说明）`);
      summaries.push(`${hash.slice(0, 8)} ${message.split('\n')[0]}`);
    }
    const remoteUrl = await this.runGit(cwd, ['remote', 'get-url', '--push', remote]);
    const safeUrl = remoteUrl.replace(/(https?:\/\/)[^/@]+@/i, '$1***@');
    if (!await this.confirm(`上传 ${commits.length} 个 commit 到 ${safeUrl}\n${ref}\n\n${summaries.join('\n')}`, '上传评审')) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '上传 Gerrit 评审…' }, () => this.runGit(cwd, ['push', '--', remote, ref]));
    vscode.window.showInformationMessage('Gerrit 上传成功'); if (this.api) await this.refresh();
  }
}
module.exports = { activate, deactivate() {} };
