'use strict';
const {tr, setLanguage} = require('./i18n');
const vscode = require('vscode');
const crypto = require('node:crypto');
const { GerritApi, normalizeUrl } = require('./api');
const { inboxQuery, searchPlan, scanChanges } = require('./inbox');
const { fileLimitReason } = require('./limits');
const { classifyFile } = require('./files');
const { NativeFiles } = require('./native-files');
const { PathIndex } = require('./path-index');
const { ReviewProgress } = require('./review-progress');
const { git, pushRef } = require('./git');
const { comparisonPlan, comparisonFiles } = require('./comparison');
const { Logger } = require('./log');
const { BrowserGateway } = require('./browser');
const { sshUrl, projectPath, downloadBranch } = require('./download');

let activeWorkbench;
function activate(context) {
  const app = new Workbench(context); activeWorkbench = app;
  context.subscriptions.push(app,
    vscode.window.registerWebviewViewProvider('gerrit.dashboard', app),
    vscode.window.registerWebviewViewProvider('gerrit.changedFiles', { resolveWebviewView: view => app.resolveFilesView(view) }),
    vscode.commands.registerCommand('gerrit.openLeftFile', () => app.run(() => app.openDiffSide('left'))),
    vscode.commands.registerCommand('gerrit.openRightFile', () => app.run(() => app.openDiffSide('right'))),
    vscode.commands.registerCommand('gerrit.openThisFile', uri => app.run(() => app.openSnapshot(uri || vscode.window.activeTextEditor?.document.uri))),
    vscode.commands.registerCommand('gerrit.showFiles', () => app.showFiles()),
    vscode.workspace.registerTextDocumentContentProvider('gerrit', app),
    vscode.commands.registerCommand('gerrit.connect', () => app.run(() => app.connect())),
    vscode.commands.registerCommand('gerrit.refresh', () => app.run(() => app.refreshCurrent())),
    vscode.commands.registerCommand('gerrit.push', () => app.run(() => app.push())),
    vscode.commands.registerCommand('gerrit.comment', () => app.run(() => app.addComment())),
    vscode.commands.registerCommand('gerrit.reply', reply => app.run(() => app.reply(reply))),
    vscode.commands.registerCommand('gerrit.tasks', () => app.openTasks()),
    vscode.commands.registerCommand('gerrit.settings', () => app.openSettings()),
    vscode.commands.registerCommand('gerrit.logs', () => app.output.show(true)),
    vscode.commands.registerCommand('gerrit.discussion', () => app.run(() => app.openDiscussion())),
    vscode.commands.registerCommand('gerrit.nextComment', () => app.run(() => app.navigateComment(1))),
    vscode.commands.registerCommand('gerrit.previousComment', () => app.run(() => app.navigateComment(-1))),
    vscode.commands.registerCommand('gerrit.fileComments', () => app.run(() => app.navigateComment(0))),
    vscode.commands.registerCommand('gerrit._viewStatus', () => ({ resolved: !!app.view, ready: !!app.sidebarReady, error: app.sidebarError || null, filesReady: !!app.filesReady, filesError: app.filesError || null })),
    vscode.window.onDidChangeVisibleTextEditors(() => app.updateDecorations()),
    vscode.languages.registerHoverProvider({ scheme: 'gerrit' }, { provideHover: (document, position) => app.commentHover(document, position) }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('gerrit')) app.run(async () => {
      app.configure();
      if (event.affectsConfiguration('gerrit.defaultQuery')) app.model.query = app.setting('defaultQuery', 'is:open');
      if (event.affectsConfiguration('gerrit.comments.expandThreads')) for (const [thread] of app.threads) {
        if (thread.comments.length) thread.collapsibleState = app.setting('comments.expandThreads', true) ? vscode.CommentThreadCollapsibleState.Expanded : vscode.CommentThreadCollapsibleState.Collapsed;
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
    this.patchDeltaCache = new Map(); this.backgroundJobs = new Map(); this.reviewProgress = new ReviewProgress(context.globalState); this.parentTrail = []; this.inboxPages = new Map(); this.patchPathCache = new Map(); this.downloadJobs = new Map(); this.nativeFiles = new NativeFiles(vscode); this.pathIndex = new PathIndex((...args) => this.runGit(...args));
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
    this.status.text = '$(git-pull-request) Gerrit'; this.status.command = 'gerrit.dashboard.focus'; this.status.tooltip = tr('打开 Gerrit 工作台'); this.status.show();
  }
  setting(key, fallback) { return vscode.workspace.getConfiguration('gerrit').get(key, fallback); }
  configure() {
    this.model.language = this.setting('language', 'zh-CN'); setLanguage(this.model.language);
    this.logger.level = this.setting('logLevel', 'info');
    this.model.pageSize = this.setting('pageSize', 50);
    this.model.commitInfoExpanded = this.setting('commitInfo.defaultExpanded', true);
    this.model.relationChainExpanded = this.setting('relationChain.defaultExpanded', true);
    if (this.api) { this.api.pageSize = this.model.pageSize; this.api.timeout = this.setting('requestTimeout', 30000); }
    this.render();
  }
  createApi(url, username, password, authMode) {
    this.logger.protect(password); this.logger.protect(Buffer.from(`${username}:${password}`).toString('base64'));
    return new GerritApi(url, username, password, { authMode, pageSize: this.model.pageSize, timeout: this.setting('requestTimeout', 30000), log: (level, message) => this.logger.write(level, message) });
  }
  openSettings() { return vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local-tools.gerrit-workbench'); }
  validInfo(info) { return !!(info && this.selected && info.id === this.selected.id && (this.selected.change.revisions ? this.selected.change.revisions[info.rev] : info.rev === this.selected.rev)); }
  dispose() {
    if (this.disposal) return this.disposal;
    this.disposed = true; this.contextController?.abort(); this.cancelSearch();
    for (const job of this.backgroundJobs.values()) this.cancelTask(job.taskId);
    this.tasksView?.dispose();
    this.disposal = Promise.allSettled([this.nativeFiles.dispose(), this.pathIndex.dispose(), this.reviewProgress.saving]);
    this.gateway?.dispose(); this.discussion?.dispose(); this.clearThreads(); this.controller.dispose();
    this.commentDecoration.dispose(); this.status.dispose(); this.output.dispose();
    return this.disposal;
  }
  clearThreads() { for (const thread of this.threads.keys()) thread.dispose(); this.threads.clear(); }
  async run(fn) {
    if (this.busy) return;
    this.busy = true; this.send({ type: 'busy', value: true });
    try { await fn(); } catch (error) { this.logger.write('error', error.logMessage || error.message); this.send({ type: 'error', message: error.message }); vscode.window.showErrorMessage(`Gerrit: ${error.message}`); }
    finally { this.busy = false; this.send({ type: 'busy', value: false }); }
  }
  send(message) { this.view?.webview.postMessage(message); this.discussion?.webview.postMessage(message); this.filesView?.webview.postMessage(message); this.tasksView?.webview.postMessage(message); }
  render() {
    this.model.language = this.setting('language', 'zh-CN');
    if (this.status) this.status.tooltip = tr('打开 Gerrit 工作台');
    for (const file of Object.values(this.model.detail?.files || {})) if (file.blockedReason) file.blockedReason = tr.current(file.blockedReason);
    this.model.commitInfoExpanded = this.setting('commitInfo.defaultExpanded', true);
    this.model.relationChainExpanded = this.setting('relationChain.defaultExpanded', true);
    this.model.downloads = this.downloadSnapshot();
    this.model.backgroundTasks = this.taskSnapshot();
    this.model.breadcrumbs = this.parentTrail.map((item, index) => ({ index, number: item.number }));
    this.model.accountId = this.user?._account_id;
    this.model.username = this.user?.username;
    this.model.parentNavigation = this.parentTrail?.length ? { number: this.parentTrail.at(-1).number } : undefined;
    this.model.resultNavigation = this.selected ? this.resultNavigation() : undefined;
    if (this.discussion && this.selected) this.discussion.title = tr`#${this.selected.change._number} · 评审讨论`;
    if (this.tasksView) this.tasksView.title = tr('Gerrit 后台任务');
    this.updateDecorations();
    this.view?.webview.postMessage({ type: 'state', model: { ...this.model, surface: 'sidebar' } });
    this.discussion?.webview.postMessage({ type: 'state', model: { ...this.model, surface: 'discussion' } });
    this.filesView?.webview.postMessage({ type: 'state', model: { ...this.model, surface: 'files' } });
    this.tasksView?.webview.postMessage({ type: 'state', model: { ...this.model, surface: 'tasks' } });
  }
  async resolveWebviewView(view) {
    this.view = view;
    this.sidebarReady = false; this.sidebarError = undefined;
    this.setupWebview(view.webview);
  }
  async resolveFilesView(view) {
    this.filesView = view; this.filesReady = false; this.filesError = undefined;
    this.setupWebview(view.webview);
    view.onDidDispose?.(() => { if (this.filesView === view) { this.filesView = undefined; this.filesReady = false; } }, undefined, this.context.subscriptions);
  }
  async showFiles() {
    if (this.filesView) this.filesView.show(true);
    else await vscode.commands.executeCommand('gerrit.changedFiles.focus');
  }

  async searchMetadata(kind, value) {
    const change = this.selected.change, commit = change.revisions?.[this.model.detail?.viewRevision || this.selected.rev]?.commit || {};
    const filters = { query: 'is:visible', message: '', repo: '', branch: '', owner: '', changeNumber: '', file: '', unreviewed: false };
    if (kind === 'repo') filters.repo = change.project;
    else if (kind === 'branch') { filters.repo = change.project; filters.branch = change.branch; }
    else if (kind === 'owner') filters.owner = String(change.owner?.username || change.owner?.email || change.owner?._account_id || '');
    else if (kind === 'author' || kind === 'committer') {
      const identity = commit[kind]?.email || commit[kind]?.name;
      if (!identity) throw new Error(tr('此提交没有可检索的身份信息'));
      filters.query = kind + ':' + JSON.stringify(identity);
    } else throw new Error(tr('不支持的检索字段'));
    searchPlan(filters.query, filters);
    this.cancelSearch(); this.searchResults = undefined;
    this.parentTrail = []; this.contextController?.abort();
    this.selected = null; this.clearThreads(); delete this.model.detail; delete this.model.searchStatus;
    Object.assign(this.model, filters, { changes: [], start: 0, more: false });
    this.send({ type: 'searchNavigation' }); this.render();
    await vscode.commands.executeCommand('gerrit.dashboard.focus');
    return this.refresh();
  }


  async loadRelated() {
    const s = this.selected, detail = this.model.detail, api = this.api;
    const focus = detail?.viewRevision || s.rev;
    const related = await api.related(s.id, focus, { signal: this.contextController?.signal });
    if (!Array.isArray(related?.changes)) throw new Error(tr('服务器未返回有效的 Relation chain'));
    if (this.model.detail !== detail || this.api !== api || this.disposed) return;
    detail.related = { rev: focus, status: 'completed', changes: related.changes };
    this.send({ type: 'relatedState', id: s.id, rev: s.rev, focusRevision: focus, related: detail.related });
  }
  preloadContext() {
    this.contextController?.abort();
    const controller = new AbortController(); this.contextController = controller;
    const s = this.selected, detail = this.model.detail, api = this.api;
    const focus = detail.viewRevision || s.rev;
    const active = () => this.model.detail === detail && this.api === api && !controller.signal.aborted && !this.disposed;
    const work = [];
    if (typeof api.related === 'function') {
      detail.related = { rev: focus, status: 'loading', changes: [] };
      work.push(this.loadRelated().catch(error => {
        if (!active()) return;
        detail.related = { rev: focus, status: 'failed', changes: [], error: this.logger.redact(error.name === 'AbortError' ? tr('查找已取消，可在后台任务中重试') : error.message) };
        this.logger.write('error', error.logMessage || tr('关系链预加载失败'));
        this.send({ type: 'relatedState', id: s.id, rev: s.rev, focusRevision: focus, related: detail.related });
      }));
    }
    const parents = detail.revisions?.[focus]?.commit?.parents || [];
    detail.parentTargets = {};
    if (typeof api.list === 'function') for (const parent of parents) {
      const sha = parent.commit;
      if (!/^[a-f0-9]{40,64}$/.test(sha || '')) continue;
      detail.parentTargets[sha] = { status: 'loading', changes: [] };
      work.push((async () => {
        const changes = new Map();
        for (let start = 0; active();) {
          const rows = await api.list('project:' + JSON.stringify(s.change.project) + ' commit:' + sha, start, { search: true, signal: controller.signal });
          if (!active()) return;
          for (const row of rows) if (row.revisions?.[sha]) changes.set(row.id, { id: row.id, number: row._number, branch: row.branch, subject: row.subject, patch: row.revisions[sha]._number });
          if (!rows.length || !rows.at(-1)._more_changes) break;
          start += rows.length;
        }
        if (!active()) return;
        const all = [...changes.values()], sameBranch = all.filter(item => item.branch === s.change.branch);
        detail.parentTargets[sha] = { status: all.length ? 'found' : 'missing', changes: sameBranch.length ? sameBranch : all };
      })().catch(error => {
        if (!active()) return;
        detail.parentTargets[sha] = { status: 'failed', changes: [] };
        this.logger.write('error', error.logMessage || tr('父提交关联查询失败'));
      }).then(() => {
        if (active()) this.send({ type: 'parentState', id: s.id, rev: s.rev, focusRevision: focus, parentTargets: detail.parentTargets });
      }));
    }
    this.contextJob = Promise.allSettled(work);
  }
  preloadPatchChanges() {
    const s = this.selected, detail = this.model.detail, api = this.api, signal = this.contextController?.signal;
    const versions = Object.entries(s.change.revisions).sort((a,b) => a[1]._number - b[1]._number);
    const active = () => this.selected === s && this.model.detail === detail && this.api === api && !signal?.aborted && !this.disposed;
    let next = 1;
    this.patchChangesJob = Promise.allSettled(Array.from({ length: Math.min(3, versions.length - 1) }, async () => {
      while (next < versions.length && active()) {
        const index = next++, [rev, item] = versions[index], [previous, older] = versions[index - 1];
        const key = JSON.stringify([api.url, this.user?._account_id ?? this.user?.username, s.id, previous, rev]);
        try {
          let unchanged = this.patchDeltaCache.get(key);
          if (unchanged === undefined) {
            const files = await api.files(s.id, rev, previous, { signal });
            if (!active()) return;
            unchanged = !Object.keys(files).some(path => !path.startsWith('/'));
            this.patchDeltaCache.set(key, unchanged);
          }
          if (!active()) return;
          item.previousPatch = { number: older._number, unchanged };
          detail.revisions[rev].previousPatch = item.previousPatch;
          this.send({ type: 'patchComparisons', id: s.id, rev: s.rev, patches: { [rev]: item.previousPatch } });
        } catch { /* Unknown is not the same as unchanged. Refresh can retry. */ }
      }
    }));
  }
  async openParent(sha) {
    const s = this.selected, detail = this.model.detail;
    const focus = detail.viewRevision || s.rev;
    if (!(s.change.revisions?.[focus]?.commit?.parents || []).some(item => item.commit === sha)) throw new Error(tr('父提交已更新，请重新打开变更'));
    const target = detail.parentTargets?.[sha];
    if (target?.status !== 'found' || !target.changes.length) throw new Error(tr('此父提交没有已确认的可见 Gerrit 变更'));
    let change = target.changes[0];
    if (target.changes.length > 1) {
      change = await vscode.window.showQuickPick(target.changes.map(item => ({ ...item, label: '#' + item.number + ' · ' + item.subject, description: item.branch })), { title: tr('选择父提交对应的 Gerrit 变更'), ignoreFocusOut: true });
      if (!change) return;
    }
    const snapshot = { id: s.id, number: s.change._number, revision: focus, comparison: s.comparison, patchView: detail.patchView, pinned: detail.viewPinned, start: this.model.start };
    this.parentTrail.push(snapshot);
    try { await this.load(change.id, true, { revision: sha }); }
    catch (error) { this.parentTrail.pop(); this.render(); throw error; }
  }
  async returnChild(index = this.parentTrail.length - 1) {
    if (!Number.isInteger(index) || index < 0 || index >= this.parentTrail.length) throw new Error(tr('导航路径已更新'));
    const trail = [...this.parentTrail], snapshot = trail[index];
    this.parentTrail = trail.slice(0, index);
    if (!snapshot) throw new Error(tr('没有可返回的子提交'));
    try {
      await this.load(snapshot.id, true, { revision: snapshot.revision, comparison: snapshot.comparison, patchView: snapshot.patchView, pinned: snapshot.pinned });
      this.model.start = snapshot.start; this.render();
    } catch (error) { this.parentTrail = trail; this.render(); throw error; }
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
      if (webview === this.filesView?.webview) { this.filesReady = true; this.filesError = undefined; }
      return;
    }
    if (message?.type === 'clientError') {
      const text = String(message.message || tr('工作台页面加载失败')).slice(0, 500);
      if (webview === this.view?.webview) this.sidebarError = text;
      if (webview === this.filesView?.webview) this.filesError = text;
      this.logger.write('error', `Webview: ${text}`);
      vscode.window.showErrorMessage(tr`Gerrit 工作台页面加载失败：${text}`); return;
    }
    if (message?.type === 'openLink') return this.openLink(message.url).catch(error => this.send({ type: 'error', message: error.message }));
    if (message?.type === 'taskCancel') { this.cancelTask(String(message.taskId)); return; }
    if (message?.type === 'taskRetry') return this.retryTask(String(message.taskId)).catch(error => this.send({ type: 'error', message: error.message }));
    if (message?.type === 'tasks') return this.openTasks();
    if (message?.type === 'lockSearch') { this.lockSearch(); return; }
    if (message?.type === 'cancelSearch') { this.cancelSearch(); return; }
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
      .replace('{{i18n}}', webview.asWebviewUri(vscode.Uri.joinPath(root, 'i18n.js')).toString())
      .replace('{{css}}', webview.asWebviewUri(vscode.Uri.joinPath(root, 'style.css')).toString())
      .replace('{{markdown}}', webview.asWebviewUri(vscode.Uri.joinPath(root, 'vendor', 'markdown-it.min.js')).toString())
      .replace('{{js}}', webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js')).toString());
  }
  openDiscussion() {
    if (!this.selected) throw new Error(tr('请先打开一笔变更'));
    if (!this.discussion) {
      const panel = vscode.window.createWebviewPanel('gerrit.discussion', tr('Gerrit 评审讨论'), vscode.ViewColumn.Active, { retainContextWhenHidden: true });
      this.discussion = panel;
      panel.onDidDispose(() => { if (this.discussion === panel) this.discussion = undefined; }, undefined, this.context.subscriptions);
      this.setupWebview(panel.webview);
    } else this.discussion.reveal(vscode.ViewColumn.Active);
    this.discussion.title = tr`#${this.selected.change._number} · 评审讨论`;
    this.render();
  }
  async openBrowser(targetPath) {
    const path = targetPath || `${new URL(this.api.url).pathname.replace(/\/$/, '')}/c/${this.selected.change._number}`;
    if (!this.gateway) {
      let api = this.api;
      if (api.authMode !== 'webPassword') {
        const password = await vscode.window.showInputBox({ title: tr('内置浏览器：网页登录密码'), prompt: tr('网页反向代理需要网页登录密码（不会替换当前 HTTP Key，也不会写入网址）'), password: true, ignoreFocusOut: true });
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
    throw new Error(tr('此 VS Code 版本未提供集成浏览器，请升级 VS Code 后使用认证网页入口；原生代码查看和评审功能可继续使用'));
  }
  async openLink(value) {
    let url;
    try { url = new URL(String(value), this.api ? this.api.url + '/' : undefined); }
    catch { throw new Error(tr('链接地址无效')); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(tr('只支持 HTTP(S) 链接'));
    if (this.api && url.origin === new URL(this.api.url).origin) return this.openBrowser(url.pathname + url.search + url.hash);
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('workbench.action.browser.open')) return vscode.commands.executeCommand('workbench.action.browser.open', url.toString());
    if (commands.includes('simpleBrowser.show')) return vscode.commands.executeCommand('simpleBrowser.show', url.toString());
    throw new Error(tr('此 VS Code 版本未提供集成浏览器，请升级 VS Code'));
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
    const urlInput = await vscode.window.showInputBox({ title: tr('连接 Gerrit · 1/4'), prompt: tr('输入服务器根地址，例如 http://192.168.1.10 或 https://review.example.com:8443；无需添加 /gerrit 或 /dashboard/self'), value: old.url || 'https://', ignoreFocusOut: true, validateInput: text => { try { normalizeUrl(text); } catch (e) { return e.message; } } });
    if (!urlInput) return;
    const url = normalizeUrl(urlInput);
    const modes = [
      { label: tr('网页登录密码'), description: tr('默认推荐；使用平时网页登录的密码，适用于 HTTP 反向代理登录'), authMode: 'webPassword' },
      { label: tr('HTTP Key / HTTP 密码'), description: tr('使用 Gerrit 生成的 Key，通过 /a/ API 认证'), authMode: 'httpKey' }
    ];
    if (old.authMode === 'httpKey') modes.reverse();
    const mode = await vscode.window.showQuickPick(modes, { title: tr('连接 Gerrit · 2/4：认证方式二选一，不同时使用'), placeHolder: tr('取决于服务器支持方式；网页登录密码与 HTTP Key 不可混用'), ignoreFocusOut: true });
    if (!mode) return;
    const username = await vscode.window.showInputBox({ title: tr('连接 Gerrit · 3/4'), prompt: tr('Gerrit 用户名'), value: old.username, ignoreFocusOut: true, validateInput: s => !s.trim() || s.includes(':') ? tr('请输入有效用户名') : undefined });
    if (!username) return;
    const keyInput = await vscode.window.showInputBox({ title: tr`连接 Gerrit · 4/4：${mode.authMode === 'webPassword' ? tr('网页登录密码') : 'HTTP Key'}`, prompt: mode.authMode === 'webPassword' ? tr('输入平时网页登录使用的密码，插件会建立独立登录会话') : tr('输入 Gerrit HTTP Key / HTTP 密码（Settings → HTTP Credentials），不是网页登录密码'), password: true, ignoreFocusOut: true });
    const password = mode.authMode === 'webPassword' ? keyInput : keyInput?.trim();
    if (!password) return;
    const api = this.createApi(url, username.trim(), password, mode.authMode); const user = await api.self();
    this.cancelSearch(); this.searchResults = undefined; this.patchDeltaCache.clear();
    await this.context.secrets.store(`gerrit:${url}:${username.trim()}`, password);
    await this.context.globalState.update('connection', { url, username: username.trim(), authMode: mode.authMode });
    if (old.url && (old.url !== url || old.username !== username.trim())) await this.context.secrets.delete(`gerrit:${old.url}:${old.username}`);
    this.gateway?.dispose(); this.gateway = undefined;
    this.clearThreads(); this.documents.clear(); this.selected = null; this.api = api; this.user = user;
    this.model = { connected: true, server: url, user: user.name || user.username, changes: [], query: this.setting('defaultQuery', 'is:open'), start: 0, pageSize: this.setting('pageSize', 50) };
    this.render();
    await this.refresh();
    vscode.window.showInformationMessage(tr`Gerrit 已连接：${user.name || user.username} · ${url}`);
  }
  needConnection() { if (!this.api) throw new Error(tr('请先点击“连接服务器”')); }
  cancelSearch() {
    if (this.searchJob?.status === 'running') {
      this.searchJob.cancelled = true; this.searchJob.status = 'cancelled';
      this.searchJob.controller?.abort();
      this.searchProgress(this.searchJob);
    }
  }
  searchProgress(job) {
    if (this.searchJob !== job) return;
    this.model.searchStatus = { status: job.status, scanned: job.scanned || 0, matches: job.matches || 0, error: job.error };
    this.send({ type: 'searchProgress', searchStatus: this.model.searchStatus }); this.taskState();
  }
  showSearchPage(render = true) {
    const rows = this.searchResults.rows;
    this.model.searchUpdates = { pending: this.searchResults.pending?.size || 0 };
    const start = Math.min(this.model.start || 0, Math.max(0, Math.floor((rows.length - 1) / this.model.pageSize) * this.model.pageSize));
    this.model.start = start;
    this.model.changes = rows.slice(start, start + this.model.pageSize);
    this.model.more = start + this.model.pageSize < rows.length;
    if (render) this.render();
    else this.send({ type: 'inboxResults', changes: this.model.changes, start, more: this.model.more, navigation: this.selected ? this.resultNavigation() : undefined, updates: this.model.searchUpdates });
  }

  startTextSearch(plan) {
    this.cancelSearch();
    const api = this.api, job = { status: 'running', scanned: 0, matches: 0, controller: new AbortController() };
    const fields = Object.fromEntries(['query','message','repo','branch','owner','changeNumber','file','unreviewed'].map(name => [name, this.model[name]]));
    const cache = { key: JSON.stringify(plan), rows: [], pending: new Map(), locked: false };
    this.searchJob = job; this.searchResults = cache;
    this.registerTask('search', tr('Message 检索 · ') + plan.message.slice(0, 60), job, () => this.retrySearch(fields));
    this.model.changes = []; this.model.more = false;
    this.searchProgress(job); this.render();
    const active = () => !job.cancelled && this.searchJob === job && this.api === api && !this.disposed;
    const receive = change => {
      if (!active()) return;
      const index = cache.rows.findIndex(row => row.id === change.id);
      if (index >= 0) cache.rows[index] = { ...cache.rows[index], ...change };
      else if (cache.locked) cache.pending.set(change.id, change);
      else cache.rows.push(change);
      this.showSearchPage(false);
    };
    job.promise = scanChanges(api, plan, {
      signal: job.controller.signal, cancelled: () => !active(), onMatch: receive,
      progress: update => { if (active()) { Object.assign(job, update); this.searchProgress(job); } }
    }).then(rows => {
      if (!rows || !active()) return;
      job.status = 'completed';
      if (!cache.locked) cache.rows.sort((a,b) => String(b.updated || '').localeCompare(String(a.updated || '')) || String(a.id).localeCompare(String(b.id)));
      this.model.branchOptions = [...new Set([...(this.model.branchOptions || []), ...rows.map(c => c.branch).filter(Boolean)])].sort();
      this.searchProgress(job); this.showSearchPage(false);
    }).catch(error => {
      if (!active()) return;
      job.controller.abort(); job.status = 'failed'; job.error = tr('搜索未完成：') + error.message;
      this.searchProgress(job); this.logger.write('error', error.logMessage || tr('评论搜索请求失败'));
    }).finally(() => { job.settled = true; this.taskState(); });
  }

  resultNavigation() {
    const cache = this.searchResults?.key === JSON.stringify(searchPlan(this.model.query, this.model)) ? this.searchResults : undefined;
    const rows = cache?.rows || this.model.changes;
    const index = rows.findIndex(item => item.id === this.selected?.id);
    const offset = cache ? 0 : this.model.start || 0;
    return { previous: index >= 0 && (index > 0 || (!cache && offset > 0)), next: index >= 0 && (index + 1 < rows.length || (!cache && !!this.model.more)), index: index < 0 ? 0 : offset + index + 1, total: offset + rows.length, more: cache ? this.searchJob?.status === 'running' : !!this.model.more };
  }
  async inboxPage(plan, start) {
    const key = JSON.stringify([plan, start]);
    let page = this.inboxPages.get(key);
    if (!page) {
      const rows = await this.api.list(plan.scope, start);
      const more = Boolean(rows.at(-1)?._more_changes);
      page = { rows: rows.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))), more };
      this.inboxPages.set(key, page);
    }
    return page;
  }
  async navigateResult(direction) {
    if (this.parentTrail.length) throw new Error(tr('请先返回子提交，再按检索结果切换'));
    if (direction !== 1 && direction !== -1) throw new Error(tr('无效的导航方向'));
    const cache = this.searchResults?.key === JSON.stringify(searchPlan(this.model.query, this.model)) ? this.searchResults : undefined;
    const rows = cache?.rows || this.model.changes, index = rows.findIndex(item => item.id === this.selected.id);
    if (index < 0) throw new Error(tr('当前变更不在检索结果中，请返回列表选择'));
    this.lockSearch();
    const target = rows[index + direction];
    if (target) {
      if (cache) {
        this.model.start = Math.floor((index + direction) / this.model.pageSize) * this.model.pageSize;
        this.showSearchPage(false);
      }
      return this.load(target.id);
    }
    if (cache || (direction < 0 && !this.model.start) || (direction > 0 && !this.model.more)) return;
    const start = Math.max(0, this.model.start + direction * this.model.pageSize);
    const page = await this.inboxPage(searchPlan(this.model.query, this.model), start);
    if (!page.rows.length) { if (direction > 0) this.model.more = false; this.render(); return; }
    Object.assign(this.model, { start, changes: page.rows, more: page.more });
    return this.load(direction > 0 ? page.rows[0].id : page.rows.at(-1).id);
  }

  async refresh(useCachedPage = false) {
    if (!useCachedPage) this.inboxPages.clear();
    this.needConnection();
    const plan = searchPlan(this.model.query, this.model);
    this.model.searchPlan = plan;
    if (plan.message) { if (this.selected) await this.load(this.selected.id, false); this.startTextSearch(plan); return; }
    this.cancelSearch(); this.searchResults = undefined; delete this.model.searchStatus; delete this.model.searchUpdates;
    const page = await this.inboxPage(plan, this.model.start);
    this.model.changes = page.rows; this.model.more = page.more;
    this.model.branchOptions = [...new Set([...(this.model.branchOptions || []), ...this.model.changes.map(c => c.branch).filter(Boolean)])].sort();
    if (this.selected) await this.load(this.selected.id, false);
    this.render();
  }
  async load(id, render = true, context = {}) {
    const change = await this.api.detail(id); const rev = change.current_revision;
    const opening = this.selected?.id !== change.id;
    const sameChange = this.selected?.id === change.id;
    const oldFocus = sameChange ? this.model.detail?.viewRevision || this.selected.rev : undefined;
    const pinned = context.pinned ?? (context.revision ? true : sameChange && !!this.model.detail?.viewPinned);
    const focus = context.revision || (pinned ? oldFocus : undefined) || rev;
    if (!change.revisions[focus]) throw new Error(tr('所需 Patch set 已不存在，请刷新后重试'));
    let plan = comparisonPlan(change.revisions, 'base', focus);
    let savedComparison = context.comparison || (!context.revision && this.selected?.id === change.id ? this.selected.comparison : undefined);
    if (!context.comparison && savedComparison?.left === 'base' && savedComparison.right === oldFocus && focus !== oldFocus) savedComparison = undefined;
    if (savedComparison) {
      try { plan = comparisonPlan(change.revisions, savedComparison.left, savedComparison.right); } catch { /* A removed patch set resets comparison. */ }
    }
    const [rawFiles, comments] = await Promise.all([this.api.files(id, plan.revision, plan.base), this.api.allComments(id)]);
    const files = comparisonFiles(rawFiles, plan.reverse);
    let patchView = context.patchView || (!context.revision && this.selected?.id === change.id ? this.model.detail?.patchView : undefined);
    if (!context.patchView && patchView && patchView.rev === oldFocus && !patchView.query && focus !== oldFocus) patchView = undefined;
    if (patchView?.loading && this.selected?.rev !== rev) patchView = undefined;
    if (!patchView || !change.revisions[patchView.rev]) {
      const patchFiles = plan.left === 'base' && plan.right === focus ? rawFiles : await this.api.files(id, focus);
      change.revisions[focus].files ||= patchFiles;
      patchView = { rev: focus, query: '', files: Object.entries(patchFiles).filter(([, file]) => file.status !== 'D').map(([path]) => path).sort() };
    }
    this.clearThreads(); this.selected = { id: change.id, rev, change, files, comments, comparison: plan };
    const related = this.model.detail?.id === change.id && this.model.detail.related?.rev === focus ? this.model.detail.related : undefined;
    const update = item => item.id === change.id ? { ...item, reviewed: !!change.reviewed, status: change.status, work_in_progress: change.work_in_progress, submittable: change.submittable, updated: change.updated } : item;
    this.model.changes = this.model.changes.map(update);
    for (const page of this.inboxPages.values()) page.rows = page.rows.map(update);
    if (this.searchResults) this.searchResults.rows = this.searchResults.rows.map(update);
    this.model.detail = { ...change, viewRevision: focus, viewPinned: pinned, files, comments, comparison: plan, patchView, related, mine: change.owner?._account_id === this.user._account_id };
    this.preloadContext(); this.loadFileProgress(); this.preloadPatchChanges();
    if (this.discussion) this.discussion.title = tr`#${change._number} · 评审讨论`;
    // Reattach comments in any already-open snapshot for this exact patch set.
    for (const [uri, info] of this.documents) if (this.validInfo(info)) await this.attach(vscode.Uri.parse(uri), info);
    if (render) { this.render(); if (opening) await this.showFiles(); }
  }
  async compare(left, right) {
    const s = this.selected; const plan = comparisonPlan(s.change.revisions, left, right);
    const files = comparisonFiles(await this.api.files(s.id, plan.revision, plan.base), plan.reverse);
    s.files = files; s.comparison = plan;
    this.model.detail.files = files; this.model.detail.comparison = plan; this.loadFileProgress(); this.render(); await this.showFiles();
  }

  async patchPaths(s, rev, api) {
    const cacheKey = JSON.stringify([api.url, this.user._account_id, s.id, rev]);
    let pending = this.patchPathCache.get(cacheKey);
    if (!pending) {
      const job = { status: 'running', stage: tr('准备路径索引'), controller: new AbortController() };
      this.registerTask('index', tr`#${s.change._number || s.id} · PS ${s.change.revisions[rev]._number} 路径索引`, job, () => {
        if (this.selected?.id === s.id && this.model.detail?.patchView?.rev === rev) return this.selectPatch(rev, this.model.detail.patchView.query);
        return this.patchPaths(s, rev, api);
      });
      pending = Promise.resolve().then(() => {
        const revision = s.change.revisions[rev];
        return this.pathIndex.read({ server: api.url, account: this.user._account_id ?? this.user.username, project: s.change.project, revision: rev, ref: revision.ref, url: sshUrl(revision.fetch, this.user.username) }, {
          signal: job.controller.signal, progress: stage => { if (job.status === 'running') { job.stage = stage; this.taskState(); } }
        });
      }).then(paths => {
        if (job.controller.signal.aborted) throw job.controller.signal.reason;
        job.status = 'completed'; job.stage = tr`已索引 ${paths.length} 个文件`; return paths;
      }).catch(error => {
        job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
        job.error = this.logger.redact(job.status === 'cancelled' ? tr('路径索引已取消') : error.message); throw error;
      }).finally(() => { job.settled = true; this.taskState(); });
      this.patchPathCache.set(cacheKey, pending);
      pending.catch(() => { if (this.patchPathCache.get(cacheKey) === pending) this.patchPathCache.delete(cacheKey); });
    }
    return pending;
  }
  async selectPatch(rev, query = '') {
    const s = this.selected;
    if (!s.change.revisions[rev]) throw new Error(tr('Patch set 不存在'));
    this.patchQueryJob = undefined;
    if (!query) {
      const files = await this.api.treeFiles(s.id, rev);
      if (!Array.isArray(files)) throw new Error(tr('服务器未返回此 Patch set 的文件清单'));
      this.model.detail.patchView = { rev, query, files: files.filter(p => typeof p === 'string').sort() }; this.render(); return;
    }
    const api = this.api, job = {};
    this.patchQueryJob = job;
    this.model.detail.patchView = { rev, query, files: [], loading: true };
    const publish = () => this.send({ type: 'patchView', id: s.id, currentRevision: s.rev, patchView: this.model.detail.patchView });
    const active = () => this.patchQueryJob === job && this.selected?.id === s.id && this.selected?.rev === s.rev && this.model.detail?.patchView?.rev === rev && this.model.detail?.patchView?.query === query && this.api === api && !this.disposed;
    publish();
    job.promise = this.patchPaths(s, rev, api).then(paths => {
      if (!active()) return;
      this.model.detail.patchView = { rev, query, files: paths.filter(path => path.toLowerCase().includes(query.toLowerCase())).sort() };
      publish();
    }).catch(error => {
      if (!active()) return;
      this.model.detail.patchView = { rev, query, files: [], error: this.logger.redact(error.name === 'AbortError' ? tr('查找已取消，可在后台任务中重试') : error.message) };
      this.logger.write('error', tr('Patch 路径检索失败：') + error.message); publish();
    });
  }
  async openSingle(path, rev, side = 'REVISION') {
    const s = this.selected;
    if (!s.change.revisions[rev]) throw new Error(tr('Patch set 不存在'));
    const metadata = s.change.revisions[rev].files?.[path];
    const blocked = fileLimitReason(metadata, side === 'PARENT'); if (blocked) throw new Error(blocked);
    let contentPath = path;
    if (side === 'PARENT') contentPath = (await this.api.files(s.id, rev))[path]?.old_path || path;
    const bytes = await this.api.bytes(s.id, rev, contentPath, side === 'PARENT');
    const decoded = classifyFile(bytes, path);
    if (decoded.kind !== 'text') { await this.nativeFiles.open(bytes, { path, label: `PS ${s.change.revisions[rev]._number}${side === 'PARENT' ? ' Base' : ''}` }); return; }
    const content = decoded.text;
    const uri = vscode.Uri.from({ scheme: 'gerrit', authority: crypto.createHash('sha256').update(this.api.url).digest('hex').slice(0, 12), path: `/${s.change._number}/${rev}/${side}/${path}` });
    this.documents.set(uri.toString(), { id: s.id, rev, path, content, side, label: `PS ${s.change.revisions[rev]._number}${side === 'PARENT' ? ' Base' : ''}` });
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Active, preview: false });
    await this.attach(uri, this.documents.get(uri.toString())); return editor;
  }
  async localRepository(project) {
    if (!vscode.workspace.isTrusted) throw new Error(tr('请先信任此工作区'));
    const extension = vscode.extensions?.getExtension('vscode.git');
    let gitApi;
    try { gitApi = extension ? (extension.isActive ? extension.exports : await extension.activate()).getAPI(1) : undefined; } catch { /* Git CLI also works when VS Code's Git integration is disabled. */ }
    const roots = [...(gitApi?.repositories || []).map(repo => repo.rootUri.fsPath), ...(vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath)];
    const candidates = [];
    for (const root of [...new Set(roots)]) {
      try {
        const directory = await this.runGit(root, ['rev-parse', '--show-toplevel']);
        if (candidates.some(item => item.directory === directory)) continue;
        const remotes = (await this.runGit(directory, ['remote'])).split('\n').filter(Boolean);
        for (const name of remotes) {
          const remote = await this.runGit(directory, ['remote', 'get-url', name]);
          if (projectPath(remote) === project) { candidates.push({ label: directory, directory }); break; }
        }
      } catch { /* A workspace folder can be outside a Git repository. */ }
    }
    if (!candidates.length) throw new Error(tr`请先在 VS Code 中打开 ${project} 的本地 Git 仓库，并配置指向该项目的 remote`);
    return candidates.length === 1 ? candidates[0].directory : (await vscode.window.showQuickPick(candidates, { title: tr('选择本地代码仓库'), ignoreFocusOut: true }))?.directory;
  }

  downloadSnapshot() {
    return [...this.downloadJobs.values()].map(job => Object.fromEntries(['id','changeId','number','patch','directory','branch','status','stage','settled'].map(key => [key, key === 'stage' ? tr.current(job[key]) : job[key]])));
  }
  taskSnapshot() {
    return [...(this.backgroundJobs?.values() || [])].reverse().map(job => ({
      id: job.taskId, kind: job.kind, title: tr.current(job.title), status: job.status,
      stage: tr.current(job.error || job.stage) || (job.kind === 'search' ? tr`已检查 ${job.scanned || 0} 笔，匹配 ${job.matches || 0} 笔` : ''),
      cancelable: job.status === 'running' && job.canCancel !== false,
      retryable: !!job.settled && !job.retried && ['failed','cancelled'].includes(job.status) && job.api === this.api
    }));
  }
  taskState() {
    this.model.backgroundTasks = this.taskSnapshot();
    if (!this.disposed) this.send({ type: 'tasks', tasks: this.model.backgroundTasks });
  }
  registerTask(kind, title, job, retry) {
    Object.assign(job, { kind, title, settled: false, taskId: crypto.randomBytes(8).toString('hex'), api: this.api, retry });
    this.backgroundJobs.set(job.taskId, job);
    for (const [id, entry] of this.backgroundJobs) if (this.backgroundJobs.size > 40 && entry.settled) this.backgroundJobs.delete(id);
    this.taskState(); return job;
  }
  cancelTask(id) {
    const job = this.backgroundJobs.get(id);
    if (!job || job.status !== 'running' || job.canCancel === false) return;
    if (job === this.searchJob) return this.cancelSearch();
    job.status = 'cancelled'; job.cancelled = true; job.controller.abort(); this.taskState();
  }
  async retryTask(id) {
    const job = this.backgroundJobs.get(id);
    if (!job || !job.settled || job.retried || !['failed','cancelled'].includes(job.status)) return;
    if (job.api !== this.api) throw new Error(tr('连接已更改，请在当前连接中重新发起任务'));
    job.retried = true; this.taskState();
    try { await job.retry(); } catch (error) { job.retried = false; this.taskState(); throw error; }
  }
  openTasks() {
    if (!this.tasksView) {
      const panel = vscode.window.createWebviewPanel('gerrit.tasks', tr('Gerrit 后台任务'), vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      this.tasksView = panel; this.setupWebview(panel.webview);
      panel.onDidDispose(() => { if (this.tasksView === panel) this.tasksView = undefined; });
    } else this.tasksView.reveal(vscode.ViewColumn.Active);
    this.render();
  }
  async retrySearch(fields) {
    this.parentTrail = []; this.selected = null; this.clearThreads(); delete this.model.detail;
    Object.assign(this.model, fields, { start: 0 });
    this.send({ type: 'searchNavigation' });
    await this.refresh(); await vscode.commands.executeCommand('gerrit.dashboard.focus');
  }
  lockSearch() { if (this.searchResults) this.searchResults.locked = true; }
  applySearchUpdates() {
    const cache = this.searchResults; if (!cache) return;
    cache.rows = [...cache.rows, ...cache.pending.values()].sort((a,b) => String(b.updated || '').localeCompare(String(a.updated || '')) || String(a.id).localeCompare(String(b.id)));
    cache.pending.clear(); cache.locked = true;
    const index = cache.rows.findIndex(row => row.id === this.selected?.id);
    if (index >= 0) this.model.start = Math.floor(index / this.model.pageSize) * this.model.pageSize;
    this.showSearchPage(false);
  }
  async refreshCurrent() {
    this.needConnection();
    if (this.selected) return this.load(this.selected.id);
    return this.refresh();
  }
  loadFileProgress() {
    const s = this.selected, detail = this.model.detail, api = this.api, rev = s.comparison?.revision;
    if (!rev || !s.change.revisions[rev]) return;
    const key = this.reviewProgress.key(api.url, this.user?._account_id ?? this.user?.username, s.id);
    const record = this.reviewProgress.ensure(key, rev), baseline = record.ready ? record.baseline : this.reviewProgress.baseline(key, s.change.revisions, rev);
    const token = {}; this.progressJob = token;
    const active = () => this.progressJob === token && this.model.detail === detail && this.api === api && !this.disposed;
    const publish = (loading = false, error) => {
      if (!active()) return;
      const current = this.reviewProgress.ensure(key, rev);
      detail.fileProgress = { revision: rev, number: s.change.revisions[rev]._number, read: [...current.read], changed: current.changed || [], baselineNumber: s.change.revisions[current.baseline]?._number, baselineRevision: current.baseline, loading, error };
      this.send({ type: 'fileProgress', id: s.id, revision: rev, progress: detail.fileProgress });
    };
    publish(!record.ready && !!baseline);
    this.progressPromise = (async () => {
      if (!record.ready) {
        const changes = baseline ? await api.files(s.id, rev, baseline, { signal: this.contextController?.signal }) : {};
        if (!active()) return;
        this.reviewProgress.prepare(key, rev, baseline, changes);
      }
      publish();
    })().catch(error => { if (active()) publish(false, tr('版本比较未完成，可刷新重试')); });
  }
  async markFileRead(path, revision, read) {
    const s = this.selected;
    if (revision !== s.comparison?.revision || !Object.hasOwn(s.files, path) || path.startsWith('/')) throw new Error(tr('文件或比较版本已更新，请重新选择'));
    const key = this.reviewProgress.key(this.api.url, this.user?._account_id ?? this.user?.username, s.id);
    const canonical = s.comparison.reverse && s.files[path].old_path ? s.files[path].old_path : path;
    await this.reviewProgress.mark(key, revision, canonical, read);
    if (this.selected === s) this.loadFileProgress();
  }

  downloadState() {
    this.model.downloads = this.downloadSnapshot();
    this.taskState();
    if (!this.disposed) this.send({ type: 'downloadState', downloads: this.model.downloads });
  }
  async download(patchRev, target) {
    const s = target?.selection || this.selected; const rev = patchRev || this.model.detail.patchView?.rev || s.rev;
    const revision = s.change.revisions[rev];
    if (!revision) throw new Error(tr('Patch set 不存在，请刷新后重试'));
    const url = sshUrl(revision.fetch, this.user.username);
    const directory = target?.directory || await this.localRepository(s.change.project);
    if (!directory) return;
    const repoKey = require('node:path').resolve(directory).toLowerCase();
    if ([...this.downloadJobs.values()].some(job => job.repoKey === repoKey && (job.status === 'running' || job.settled === false))) throw new Error(tr('此仓库已有下载任务，请等待完成'));
    const id = crypto.randomBytes(8).toString('hex');
    const job = { id, changeId: s.id, number: s.change._number, patch: revision._number, directory, repoKey, branch: `change-${s.change._number}`, status: 'running', stage: tr('准备下载'), controller: new AbortController() };
    // Keep the current job per repository; completed states remain visible until the next download.
    for (const [key, previous] of this.downloadJobs) if (previous.repoKey === repoKey) this.downloadJobs.delete(key);
    this.downloadJobs.set(id, job);
    this.registerTask('download', tr`#${job.number} · PS ${job.patch} 下载到本地`, job, () => this.download(rev, { selection: s, directory }));
    this.downloadState();
    job.promise = Promise.resolve().then(() => vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: tr`Gerrit #${job.number} · PS ${job.patch} 下载到本地`
    }, progress => downloadBranch({ directory, url, signal: job.controller.signal, branch: job.branch, ref: revision.ref, revision: rev, checkWorkspace: () => {
      const path = require('node:path');
      if ((vscode.workspace.textDocuments || []).some(doc => {
        if (!doc.isDirty || doc.uri.scheme !== 'file') return false;
        const relative = path.relative(directory, doc.uri.fsPath);
        return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
      })) throw new Error(tr('本地仓库有未保存的编辑器内容，请先保存并处理修改后重试下载'));
    }, stage: stage => {
      job.stage = stage; job.canCancel = stage !== 'Git checkout'; progress.report({ message: stage }); this.downloadState();
    } }, (cwd, args, options) => this.runGit(cwd, args, { ...options, signal: job.controller.signal }))))
      .then(() => {
        job.status = 'completed'; job.stage = tr('下载完成');
        this.logger.write('info', tr`下载任务完成：#${job.number} PS ${job.patch} → ${job.branch}`);
        if (!this.disposed) vscode.window.showInformationMessage(tr`Gerrit #${job.number} 已切换到本地分支 ${job.branch}`);
      }).catch(error => {
        if (job.controller.signal.aborted) { job.status = 'cancelled'; job.stage = tr('下载已取消，未切换分支'); return; }
        job.status = 'failed';
        job.stage = /Permission denied|publickey|Host key verification failed|Could not resolve hostname|Connection refused|Could not read from remote repository/i.test(error.message)
          ? tr('SSH 下载失败：请检查本机 SSH key / agent、Gerrit 公钥、端口和 known_hosts')
          : error.message;
        this.logger.write('error', tr`下载任务失败：${job.stage}`);
        if (!this.disposed) vscode.window.showErrorMessage(`Gerrit: ${job.stage}`);
      }).finally(() => { job.settled = true; this.downloadState(); });
    // Deliberately do not await the job or the completion notification.
  }
  async handle(m) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'init') { this.render(); if (!this.api) await this.restore(); return; }
    if (m.type === 'connect') return this.connect();
    if (m.type === 'settings') return this.openSettings();
    if (m.type === 'tasks') return this.openTasks();
    if (m.type === 'logs') return this.output.show(true);
    if (m.type === 'cancelSearch') { this.cancelSearch(); this.render(); return; }
    if (m.type === 'disconnect') {
      for (const job of this.backgroundJobs.values()) this.cancelTask(job.taskId);
      this.cancelSearch(); this.contextController?.abort(); this.parentTrail = []; this.searchResults = undefined; this.patchPathCache.clear();
      this.pathIndex.dispose().catch(() => {}); this.pathIndex = new PathIndex((...args) => this.runGit(...args));
      const saved = this.context.globalState.get('connection');
      if (saved) await this.context.secrets.delete(`gerrit:${saved.url}:${saved.username}`);
      this.patchDeltaCache.clear();
      await this.context.globalState.update('connection', undefined); this.gateway?.dispose(); this.gateway = undefined; this.api = null; this.selected = null; this.clearThreads(); this.documents.clear();
      this.model = { connected: false, changes: [], query: this.setting('defaultQuery', 'is:open'), start: 0, pageSize: this.setting('pageSize', 50) }; this.render(); return;
    }
    if (m.type === 'push') return this.push();
    this.needConnection();
    if (m.type === 'filters' || m.type === 'search') {
      const values = {};
      for (const name of ['message', 'repo', 'branch', 'owner', 'changeNumber', 'file']) values[name] = m[name] === undefined ? this.model[name] : String(m[name]).trim();
      values.unreviewed = m.unreviewed === undefined ? this.model.unreviewed : !!m.unreviewed;
      values.query = m.type === 'search' ? String(m.query || 'is:open') : this.model.query;
      searchPlan(values.query, values);
      Object.assign(this.model, values, { start: 0 }); return this.refresh();
    }
    if (m.type === 'page') {
      this.model.start = Math.max(0, this.model.start + (m.next ? this.model.pageSize : -this.model.pageSize));
      if (this.model.message && this.searchResults?.key === JSON.stringify(searchPlan(this.model.query, this.model))) return this.showSearchPage();
      return this.refresh(true);
    }
    if (m.type === 'applySearchUpdates') return this.applySearchUpdates();
    if (m.type === 'refresh') return this.refreshCurrent();
    if (m.type === 'open') { this.lockSearch(); this.parentTrail = []; return this.load(String(m.id)); }
    if (m.type === 'back') { this.parentTrail = []; this.contextController?.abort(); this.selected = null; delete this.model.detail; this.clearThreads(); this.render(); return; }
    const s = this.selected; if (!s || m.id !== s.id || m.rev !== s.rev) throw new Error(tr('页面已更新，请重新选择变更后操作'));
    if (m.type === 'fileRead') return this.markFileRead(String(m.path), String(m.fileRev), !!m.read);
    if (m.type === 'returnAncestor') return this.returnChild(Number(m.index));
    if (m.type === 'parentOpen') return this.openParent(String(m.sha || ''));
    if (m.type === 'openLatest') return this.load(s.id, true, { revision: s.rev, pinned: false });
    if (m.type === 'returnChild') return this.returnChild();
    if (m.type === 'navigate') return this.navigateResult(Number(m.direction));
    if (m.type === 'metadata') return this.searchMetadata(String(m.kind), String(m.value || ''));
    if (m.type === 'file') {
      if (m.compareLeft && (m.compareLeft !== s.comparison?.left || m.compareRight !== s.comparison?.right)) throw new Error(tr('比较版本已更新，请重新点击文件'));
      const path = String(m.path), comparison = s.comparison;
      await this.openDiff(path);
      if (this.selected === s && s.comparison === comparison) await this.markFileRead(path, comparison.revision, true);
      return;
    }
    if (m.type === 'returnDiscussion') {
      await this.openDiscussion();
      this.discussion?.webview.postMessage({ type: 'showDiscussion' }); return;
    }
    if (m.type === 'showFiles') return this.showFiles();
    if (m.type === 'related') return this.loadRelated();
    if (m.type === 'relatedOpen') {
      const node = this.model.detail.related?.changes.find(item => String(item._change_number) === String(m.number));
      if (!node || !Number.isSafeInteger(node._change_number) || node._change_number <= 0) throw new Error(tr('关系链节点已更新，请重新加载'));
      return this.load(String(node._change_number));
    }
    if (m.type === 'locate') return this.locateComment(m.path, m.comment);
    if (m.type === 'patch') return this.selectPatch(String(m.patchRev || s.rev));
    if (m.type === 'patchSearch') return this.selectPatch(String(m.patchRev), String(m.query || '').trim());
    if (m.type === 'single') {
      if (this.model.detail.patchView?.rev !== m.patchRev || !this.model.detail.patchView.files.includes(m.path)) throw new Error(tr('文件版本已更新，请重新选择'));
      return this.openSingle(String(m.path), String(m.patchRev));
    }
    if (m.type === 'download') return this.download(m.patchRev);
    if (m.type === 'compare') return this.compare(String(m.left), String(m.right));
    if (m.type === 'discussion') return this.openDiscussion();
    if (m.type === 'browser') return this.openBrowser();
    if ((m.type === 'review' || m.type === 'action') && this.model.detail?.viewRevision && this.model.detail.viewRevision !== s.rev) throw new Error(tr('当前查看历史 PS，请先切换到最新 PS 后执行变更操作'));
    if (m.type === 'review') {
      const labels = {};
      for (const [name, value] of Object.entries(m.labels || {})) {
        if (!(s.change.permitted_labels?.[name] || []).some(v => Number(v) === Number(value))) throw new Error(tr('评分超出当前权限，请刷新'));
        labels[name] = Number(value);
      }
      const message = String(m.message || '').trim();
      if (!message && !Object.keys(labels).length) throw new Error(tr('请输入评论或选择评分'));
      await this.api.review(s.id, s.rev, { message, labels });
      this.send({ type: 'reviewSent' }); await this.load(s.id); return;
    }
    if (m.type === 'reply') {
      const parent = s.comments[m.path]?.find(c => c.id === m.comment);
      if (!parent) throw new Error(tr('评论不存在，请刷新'));
      const text = String(m.message || '').trim(); if (!text) throw new Error(tr('请输入回复内容'));
      const rev = Object.keys(s.change.revisions).find(key => s.change.revisions[key]._number === parent.patch_set) || s.rev;
      await this.postComment({ ...parent, rev, path: m.path }, text, parent.id); this.send({ type: 'replySent', comment: parent.id }); await this.load(s.id); return;
    }
    if (m.type === 'action') {
      const action = String(m.action); const titles = { ready: tr('发布为待评审'), abandon: tr('废弃变更'), submit: tr('合入目标分支') };
      if (!titles[action] || !s.change.actions?.[action]?.enabled) throw new Error(tr('当前状态或权限不允许此操作，请刷新'));
      if (['ready', 'abandon'].includes(action) && !this.model.detail.mine) throw new Error(tr('此入口仅操作自己的提交'));
      if (!await this.confirm(`${titles[action]}：#${s.change._number} ${s.change.subject}`, titles[action])) return;
      let message;
      if (action === 'abandon') { message = await vscode.window.showInputBox({ title: tr('废弃原因（可留空，Esc 取消）'), ignoreFocusOut: true }); if (message === undefined) return; }
      await this.api.action(s.id, action, message ? { message } : {}); await this.load(s.id);
    }
  }
  async confirm(message, button) { return await vscode.window.showWarningMessage(message, { modal: true }, button) === button; }
  provideTextDocumentContent(uri) { const doc = this.documents.get(uri.toString()); if (!doc) throw new Error(tr('此 Gerrit 快照已失效，请从工作台重新打开文件')); return doc.content; }
  async openDiff(path) {
    const s = this.selected; const file = s.files[path]; if (!file) throw new Error(tr('文件不存在'));
    const blocked = file.blockedReason || fileLimitReason(file); if (blocked) throw new Error(blocked);
    const plan = s.comparison || comparisonPlan(s.change.revisions, 'base', s.rev);
    const sides = [plan.left, plan.right].map((value, index) => {
      const rev = value === 'base' ? plan.revision : value;
      const contentPath = index === 0 ? file.old_path || path : path;
      // Parent comments are keyed by the filename in their patch set, including renames.
      const commentPath = value === 'base' ? (plan.reverse ? file.old_path || path : path) : contentPath;
      return { id: s.id, rev, side: value === 'base' ? 'PARENT' : 'REVISION', path: commentPath, contentPath,
        label: value === 'base' ? tr`Base (PS ${s.change.revisions[rev]._number} 的第一父提交)` : `PS ${s.change.revisions[rev]._number}`,
        empty: index === 0 ? file.status === 'A' : file.status === 'D' };
    });
    const bytes = await Promise.all(sides.map(info => info.empty ? Buffer.alloc(0) : this.api.bytes(s.id, info.rev, info.contentPath, info.side === 'PARENT')));
    const decoded = bytes.map((value, index) => sides[index].empty ? { kind: 'text', text: '' } : classifyFile(value, path));
    if (decoded.some(value => value.kind !== 'text')) {
      await this.nativeFiles.openPair(sides.map((info, index) => ({ ...info, bytes: bytes[index] }))); return { sides, uris: [] };
    }
    const contents = decoded.map(value => value.text);
    const uris = sides.map((info, index) => {
      const uri = vscode.Uri.from({ scheme: 'gerrit', authority: crypto.createHash('sha256').update(this.api.url).digest('hex').slice(0, 12), path: `/${s.change._number}/${info.rev}/${info.side}/${info.empty ? 'empty/' : ''}${info.path}` });
      this.documents.set(uri.toString(), { ...info, content: contents[index] }); return uri;
    });
    await vscode.commands.executeCommand('vscode.diff', uris[0], uris[1], `${path} · ${sides[0].label} ↔ ${sides[1].label}`, { preview: true, viewColumn: this.setting('diff.openBeside', false) ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active });
    for (const uri of uris) await this.attach(uri, this.documents.get(uri.toString()));
    return { sides, uris };
  }
  async openSnapshot(uri) {
    const info = uri && this.documents.get(uri.toString());
    if (!info) throw new Error(tr('请先打开 Gerrit 文件差异'));
    if (info.empty) throw new Error(tr('这一侧文件不存在'));
    const document = await vscode.workspace.openTextDocument(uri);
    return vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Active, preview: false });
  }
  async openDiffSide(side) {
    const input = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input;
    if (!input?.original || !input?.modified) throw new Error(tr('请先打开 Gerrit 文件差异'));
    return this.openSnapshot(side === 'left' ? input.original : input.modified);
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
    body.appendText(tr`此处有 ${comments.length} 条 Gerrit 评论（${info.label || info.side}）\n点击行号旁的评论图标展开并回复。\n\n`);
    for (const c of comments.slice(-5)) body.appendText(`${c.author?.name || c.author?.username || tr('Gerrit 用户')}：${c.message.slice(0, 600)}\n\n`);
    return new vscode.Hover(body);
  }
  async locateComment(path, id) {
    const s = this.selected; const comment = s.comments[path]?.find(c => c.id === id);
    if (!comment) throw new Error(tr('评论已不存在，请刷新'));
    if (!path || path.startsWith('/')) return; // Patch-level comments do not have a code file.
    const rev = Object.keys(s.change.revisions).find(key => s.change.revisions[key]._number === comment.patch_set) || s.rev;
    await this.compare('base', rev);
    if (this.selected !== s) return;
    // A file-level comment may refer to an unchanged file, which is absent from List Files.
    if (!Object.hasOwn(s.files, path)) {
      s.files[path] = { status: 'M', unchanged: true };
      this.model.detail.files = s.files; this.render();
    }
    const result = await this.openDiff(path);
    const side = comment.side || 'REVISION';
    const index = result.sides.findIndex(info => info.rev === rev && info.side === side && !info.empty);
    const uri = result.uris[index]; if (!uri) return;
    const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
    if (!editor) return;
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
      const thread = this.controller.createCommentThread(uri, range, group.map(item => ({ body: item.message, mode: vscode.CommentMode.Preview, author: { name: item.author?.name || item.author?.username || tr('Gerrit 用户') } })));
      thread.label = tr`${info.label || info.side} · 回复将立即发布`;
      thread.collapsibleState = this.setting('comments.expandThreads', true) ? vscode.CommentThreadCollapsibleState.Expanded : vscode.CommentThreadCollapsibleState.Collapsed;
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
        hoverMessage: tr`${comments.length} 条 Gerrit 评论；使用编辑器右上角“本文件评论”查看位置和跳转。`,
        renderOptions: { after: { contentText: `  💬 ${comments.length}`, color: new vscode.ThemeColor('gerrit.commentMarker'), margin: '0 0 0 1em' } }
      }));
      editor.setDecorations(this.commentDecoration, marks);
    }
  }
  async navigateComment(direction) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const points = this.commentPoints(this.documents.get(editor.document.uri.toString()));
    if (!points.length) { vscode.window.showInformationMessage(tr('当前文件版本没有评论')); return; }
    let point;
    if (!direction) {
      const picked = await vscode.window.showQuickPick(points.map(([line, comments]) => ({ label: tr`行 ${line + 1} · ${comments.length} 条评论`, description: comments.map(c => `${c.author?.name || c.author?.username || tr('用户')}: ${c.message}`).join(' | ').replace(/\s+/g, ' ').slice(0, 250), point: [line, comments] })), { title: tr('本文件评论位置'), matchOnDescription: true });
      point = picked?.point;
    } else {
      const current = editor.selection.active?.line ?? editor.selection.end.line;
      point = direction > 0 ? points.find(([line]) => line > current) || points[0] : points.slice().reverse().find(([line]) => line < current) || points.at(-1);
    }
    if (!point) return;
    const line = Math.min(editor.document.lineCount - 1, point[0]);
    editor.selection = new vscode.Selection(line, 0, line, 0); editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
    for (const [thread, info] of this.threads) if (thread.uri.toString() === editor.document.uri.toString() && info.commentIds?.some(id => point[1].some(c => c.id === id))) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    vscode.window.setStatusBarMessage(tr`Gerrit 评论 ${points.indexOf(point) + 1 || points.findIndex(p => p[0] === point[0]) + 1}/${points.length} · 行 ${line + 1}`, 5000);
  }
  async addComment() {
    const editor = vscode.window.activeTextEditor; if (!editor) return;
    const info = this.documents.get(editor.document.uri.toString());
    if (!this.validInfo(info) || info.empty) throw new Error(tr('请从当前变更详情打开非空的文件版本'));
    const thread = this.controller.createCommentThread(editor.document.uri, editor.selection, []);
    thread.label = tr`新建评论 · ${info.label || info.side} · 发布后立即可见`;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.threads.set(thread, { ...info });
  }
  async reply(reply) {
    if (!reply?.thread || !reply.text?.trim()) return;
    const thread = reply.thread;
    const info = this.threads.get(thread) || this.documents.get(thread.uri.toString());
    if (!this.validInfo(info) || info.empty) throw new Error(tr('此评论属于旧变更，请重新打开'));
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
    if (!this.validInfo({ ...info, id: s.id, rev: revision })) throw new Error(tr('评论版本已失效，请重新打开文件'));
    await this.api.review(s.id, revision, { comments: { [info.path]: [c] } });
  }
  async runGit(cwd, args, options) {
    const started = Date.now(); const operation = args[0] === '-c' ? args[2] : args[0];
    if (!this.disposed) this.logger.write('debug', tr`Git ${operation} 开始`);
    try { const result = await git(cwd, args, options); if (!this.disposed) this.logger.write('info', tr`Git ${operation} 成功 (${Date.now() - started} ms)`); return result; }
    catch (error) { error.logMessage = tr`Git ${operation} 失败 (${Date.now() - started} ms)`; if (!this.disposed) this.logger.write(options?.optional ? 'debug' : 'error', error.logMessage); throw error; }
  }
  async push() {
    if (!vscode.workspace.isTrusted) throw new Error(tr('请先信任此工作区'));
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error(tr('请先打开本地 Git 仓库'));
    const folder = folders.length === 1 ? folders[0] : (await vscode.window.showQuickPick(folders.map(f => ({ label: f.name, folder: f })), { title: tr('选择要提交的仓库') }))?.folder;
    if (!folder) return;
    const cwd = folder.uri.fsPath;
    const root = await this.runGit(cwd, ['rev-parse', '--show-toplevel']);
    const repoKey = require('node:path').resolve(root).toLowerCase();
    if ([...this.downloadJobs.values()].some(job => job.repoKey === repoKey && (job.status === 'running' || job.settled === false))) throw new Error(tr('此仓库正在下载，请完成后再上传'));
    if (await this.runGit(cwd, ['status', '--porcelain'])) {
      const choice = await vscode.window.showQuickPick([
        { label: tr('提交已暂存文件，再推送 HEAD'), commit: true },
        { label: tr('仅推送已有 HEAD（保留未提交修改）'), commit: false }
      ], { title: tr('工作区存在未提交修改'), ignoreFocusOut: true });
      if (!choice) return;
      if (choice.commit) {
        if (!await this.runGit(cwd, ['diff', '--cached', '--name-only'])) throw new Error(tr('没有已暂存文件，请在源代码管理面板中暂存需要提交的文件'));
        const message = await vscode.window.showInputBox({ title: tr('Commit 信息（使用仓库的 commit-msg hook 生成 Change-Id）'), ignoreFocusOut: true, validateInput: t => t.trim() ? undefined : tr('请输入提交信息') });
        if (!message) return;
        await this.runGit(cwd, ['commit', '-m', message]);
      }
    }
    const remotes = (await this.runGit(cwd, ['remote'])).split('\n').filter(Boolean);
    const remote = await vscode.window.showQuickPick(remotes, { title: tr('选择 Gerrit Git remote'), ignoreFocusOut: true }); if (!remote) return;
    const branch = await vscode.window.showInputBox({ title: tr('目标分支（例如 main / master）'), value: await this.runGit(cwd, ['branch', '--show-current']), ignoreFocusOut: true }); if (!branch) return;
    const mode = await vscode.window.showQuickPick([{ label: tr('发布为待评审'), wip: false }, { label: tr('上传为 WIP，稍后发布'), wip: true }], { title: tr('上传方式'), ignoreFocusOut: true }); if (!mode) return;
    const ref = pushRef(branch, mode.wip);
    await this.runGit(cwd, ['check-ref-format', `refs/heads/${branch}`]);
    // Fetch the target into FETCH_HEAD to inspect the entire outgoing commit stack.
    await this.runGit(cwd, ['fetch', '--no-tags', '--', remote, `refs/heads/${branch}`]);
    const commits = (await this.runGit(cwd, ['rev-list', '--reverse', 'FETCH_HEAD..HEAD'])).split('\n').filter(Boolean);
    if (!commits.length) throw new Error(tr('没有需要上传到该目标分支的新 commit'));
    const summaries = [];
    for (const hash of commits) {
      const message = await this.runGit(cwd, ['show', '-s', '--format=%B', hash]);
      if (!/^Change-Id: I[0-9a-f]{40}\s*$/m.test(message)) throw new Error(tr`Commit ${hash.slice(0, 8)} 缺少有效 Change-Id。请安装 Gerrit commit-msg hook 并 amend 对应 commit 后重试（README 有说明）`);
      summaries.push(`${hash.slice(0, 8)} ${message.split('\n')[0]}`);
    }
    const remoteUrl = await this.runGit(cwd, ['remote', 'get-url', '--push', remote]);
    const safeUrl = remoteUrl.replace(/(https?:\/\/)[^/@]+@/i, '$1***@');
    if (!await this.confirm(tr`上传 ${commits.length} 个 commit 到 ${safeUrl}\n${ref}\n\n${summaries.join('\n')}`, tr('上传评审'))) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: tr('上传 Gerrit 评审…') }, () => this.runGit(cwd, ['push', '--', remote, ref]));
    vscode.window.showInformationMessage(tr('Gerrit 上传成功，请刷新查看最新提交'));
  }
}
module.exports = { activate, deactivate() { const app = activeWorkbench; activeWorkbench = undefined; return app?.dispose(); } };
