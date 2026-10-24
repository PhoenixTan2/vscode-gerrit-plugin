'use strict';
const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const notice = document.getElementById('notice');
let model = {}; let busy = false; let state = vscode.getState() || {};
const tr = GerritI18n.create(() => model.language);
const post = (type, data = {}) => vscode.postMessage({ type, ...data });
window.addEventListener('error', event => post('clientError', { message: event.message || tr('工作台脚本加载失败') }));
window.addEventListener('unhandledrejection', event => post('clientError', { message: event.reason?.message || tr('工作台页面处理失败') }));
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const who = account => account?.name || account?.username || account?.email || tr`用户 ${account?._account_id || '?'}`;
const key = () => `${model.server || ''}::${model.accountId ?? model.username ?? ''}::${model.detail?.id}::${model.detail?.current_revision}`;
const save = () => vscode.setState(state);
const draft = () => state.drafts?.[key()] || {};

const markdown = markdownit({ html: false, linkify: true, breaks: true });
markdown.validateLink = url => /^https?:/i.test(url) || /^\/(?!\/)/.test(url);
markdown.renderer.rules.image = (tokens, index) => e(tokens[index].content || tr('图片'));
const md = text => markdown.render(String(text || ''));
const firstLine = text => String(text || '').split(/\r?\n/).find(line => line.trim()) || tr('（空评论）');
function markdownEditor(value, { id = '', replyKey = '', label, placeholder }) {
  return tr`<div class="markdown-editor"><div class="markdown-preview markdown-body" role="button" tabindex="0" aria-label="${e(label)}，点击编辑">${value ? md(value) : tr`<span class="muted">${e(placeholder)} · 点击编辑 Markdown</span>`}</div><textarea ${id ? `id="${e(id)}"` : ''} ${replyKey ? `data-reply-key="${e(replyKey)}"` : ''} aria-label="${e(label)}" placeholder="${e(placeholder)}" hidden>${e(value)}</textarea><small class="muted markdown-hint" hidden>Markdown · 点击外部预览，发布后才发送</small></div>`;
}
function startMarkdownEdit(preview) {
  const editor = preview.closest('.markdown-editor'), input = editor.querySelector('textarea');
  preview.hidden = true; input.hidden = false; editor.querySelector('.markdown-hint').hidden = false;
  input.focus();
}
function previewMarkdown(input) {
  const editor = input.closest('.markdown-editor'); if (!editor) return;
  const preview = editor.querySelector('.markdown-preview');
  preview.innerHTML = input.value ? md(input.value) : tr('<span class="muted">点击编辑 Markdown…</span>');
  input.hidden = true; preview.hidden = false; editor.querySelector('.markdown-hint').hidden = true;
}
const patchLabel = item => item.previousPatch?.unchanged ? tr` · 与 PS ${item.previousPatch.number} 无代码差异` : '';
const readyToSubmit = c => c.status === 'NEW' && !c.work_in_progress && c.submittable === true;
const changeStatus = c => readyToSubmit(c) ? tr('可发布') : statusText(c.status);
const patchFileBlocked = (d, rev, path) => {
  const file = d.revisions?.[rev]?.files?.[path];
  return file && Number.isFinite(file.size) && 4 * Math.ceil(file.size / 3) > 32 * 1024 * 1024;
};
function compareOptions(d, side, selected, other) {
  const options = [['base', tr('Base（另一侧 PS 的第一父提交）')], ...Object.entries(d.revisions || {}).sort((a, b) => a[1]._number - b[1]._number).map(([sha, rev]) => [sha, `PS ${rev._number} · ${sha.slice(0, 8)}${patchLabel(rev)}`])];
  return options.filter(([id]) => id !== other).map(([id, label]) => `<option value="${e(id)}" ${id === selected ? 'selected' : ''}>${e(label)}</option>`).join('');
}
function autoCompare(left, right, send = true) {
  document.getElementById('compare-left').innerHTML = compareOptions(model.detail, 'left', left, right);
  document.getElementById('compare-right').innerHTML = compareOptions(model.detail, 'right', right, left);
  if (send) post('compare', { ...payload(), left, right });
}

function button(text, action, cls = 'secondary', attrs = '') { return `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${e(text)}</button>`; }
function votes(labels) {
  return Object.entries(labels || {}).map(([name, label]) => {
    const all = label.all || [], scored = all.filter(v => Number.isFinite(v.value) && v.value !== 0), waiting = all.filter(v => !Number.isFinite(v.value) || v.value === 0);
    const rows = people => people.map(v => `<div class="vote"><span>${e(who(v))}</span><strong class="${v.value > 0 ? 'positive' : v.value < 0 ? 'negative' : ''}">${v.value > 0 ? '+' : ''}${e(v.value ?? tr('未打分'))}</strong></div>`).join('');
    return `<div class="card"><b>${e(name)}</b>${rows(scored) || tr('<p class="muted">暂无非零评分</p>')}${waiting.length ? tr`<details class="unscored"><summary>未打分 / 0 分（${waiting.length} 人）</summary>${rows(waiting)}</details>` : ''}</div>`;
  }).join('');
}

function reviewerManager(d) {
  if (!d.mine || d.status !== 'NEW' || (d.viewRevision && d.viewRevision !== d.current_revision)) return '';
  const people = d.reviewers?.REVIEWER || [];
  return tr`<details class="card reviewer-manager"><summary>评审人员 · Code-Review / Verified <span class="muted">(${people.length})</span></summary><p class="muted">人员按提交管理，打分权限由 Gerrit 控制</p><p>${people.map(person => e(who(person))).join(' · ') || tr('暂无评审人员')}</p>${button(tr('管理人员 / 组'), 'manageReviewers')}</details>`;
}

function comparison(d) {
  const plan = d.comparison || { left: 'base', right: d.current_revision };
  const select = side => `<select id="compare-${side}" aria-label="${side === 'left' ? tr('左侧版本') : tr('右侧版本')}">${compareOptions(d, side, plan[side], plan[side === 'left' ? 'right' : 'left'])}</select>`;
  return tr`<h2>版本比较</h2><form id="compare"><label for="compare-left">左侧</label>${select('left')}<label for="compare-right">右侧</label>${select('right')}<div class="row">${button(tr('交换左右'), 'swap')}</div></form><p class="muted">可比较任意两个 PS，或 PS 与其 Base。代码评论绑定实际版本。</p>`;
}
function reviewForm(d) {
  if (d.viewRevision && d.viewRevision !== d.current_revision) return tr`<h2>历史 PS 浏览</h2><p class="muted">整体评审与评分针对最新 PS。先切换到最新版本，再发布评审。</p>${button(tr('切换到最新 PS 评审'), 'openLatest')}`;
  const saved = draft();
  return tr`<h2>发布评审 · 最新 PS ${e(d.revisions?.[d.current_revision]?._number)}</h2><form id="review">${markdownEditor(saved.message || '', { id: 'review-message', label: tr('评审评论'), placeholder: tr('写下整体评审意见…') })}${Object.entries(d.permitted_labels || {}).map(([name, values], i) => tr`<label for="label-${i}">${e(name)}</label><select id="label-${i}" data-label="${e(name)}"><option value="">不修改评分</option>${values.map(v => `<option value="${e(Number(v))}" ${String(saved.labels?.[name]) === String(Number(v)) ? 'selected' : ''}>${e(v.trim())} ${e(d.labels?.[name]?.values?.[v] || '')}</option>`).join('')}</select>`).join('')}<div class="row"><button type="submit">发布评审</button><span class="muted">整体评论与评分立即发布；下方代码回复发到原评论所在 PS。</span></div></form>`;
}
function time(value) {
  if (!value) return '—';
  const iso = String(value).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + 'Z');
  if (Number.isNaN(date.getTime())) return value;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function timestamps(d) { return tr`<dl class="timestamps"><div><dt>创建时间</dt><dd>${e(time(d.created))}</dd></div><div><dt>最后更新</dt><dd>${e(time(d.updated))}</dd></div></dl>`; }

function icon(name) {
  const paths = {
    discussion: '<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/>',
    commit: '<circle cx="12" cy="12" r="4"/><path d="M2 12h6m8 0h6"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${paths[name] || paths.commit}</svg>`;
}

function metadataLink(text, kind, value = '') {
  return text ? button(text, 'metadata', 'meta-link', tr`data-kind="${e(kind)}" data-value="${e(value)}" title="检索：${e(text)}"`) : '—';
}
const relationKey = () => `${key()}::relation`;

function parentLink(d, sha) {
  const target = d.parentTargets?.[sha];
  if (target?.status === 'found' && target.changes?.length) {
    const first = target.changes[0];
    return button(sha, 'parentOpen', 'meta-link', tr`data-sha="${e(sha)}" title="打开父提交 #${e(first.number)} · PS ${e(first.patch)}"`);
  }
  const title = target?.status === 'missing' ? tr('没有可见的 Gerrit 变更') : target?.status === 'failed' ? tr('未能确认 Gerrit 变更，可刷新后重试') : tr('正在确认是否关联 Gerrit 变更');
  return `<span title="${e(title)}">${e(sha)}</span>`;
}
const displaySubject = d => d.viewRevision && d.viewRevision !== d.current_revision ? d.revisions?.[d.viewRevision]?.commit?.subject || (d.revisions?.[d.viewRevision]?.commit?.message ? firstLine(d.revisions[d.viewRevision].commit.message) : d.subject) : d.subject;

function commitInfo(d, expanded = model.commitInfoExpanded) {
  const focus = d.viewRevision || d.current_revision;
  const commit = d.revisions?.[focus]?.commit || {};
  return tr`<details id="commit-info" class="commit-info" ${expanded ? 'open' : ''}><summary>${icon('commit')}Commit 信息<span class="muted">PS ${e(d.revisions?.[focus]?._number)}${focus === d.current_revision ? tr(' · 最新') : tr` · 历史版本（最新 PS ${e(d.revisions?.[d.current_revision]?._number)}）`} · ${e(focus?.slice(0, 10))}</span></summary><pre>${e(commit.message || d.subject)}</pre><dl class="metadata"><dt>SHA</dt><dd class="mono">${e(focus)}</dd><dt>Change-Id</dt><dd class="mono">${e(d.change_id)}</dd><dt>作者</dt><dd>${metadataLink([commit.author?.name, commit.author?.email && `<${commit.author.email}>`].filter(Boolean).join(' '), 'author')}</dd><dt>提交者</dt><dd>${metadataLink([commit.committer?.name, commit.committer?.email && `<${commit.committer.email}>`].filter(Boolean).join(' '), 'committer')}</dd><dt>父提交</dt><dd class="mono">${(commit.parents || []).map(p => parentLink(d, p.commit)).join(' · ')}</dd></dl></details>`;
}
function downloadStatus() {
  const jobs = (model.downloads || []).filter(job => job.changeId === model.detail?.id);
  return jobs.map(job => `<div class="download-task ${e(job.status)}" role="status"><div class="row">${icon('download')}<strong>${e(job.stage)}</strong><span class="badge">PS ${e(job.patch)}</span></div><div class="muted mono">${e(job.directory)} → ${e(job.branch)}</div><p class="muted">${job.status === 'running' ? tr('后台执行中，可继续浏览和评审。') : job.status === 'completed' ? tr('已在当前代码仓库切换到此分支。') : tr('本地任务已结束，请处理以上问题后重试。')}</p></div>`).join('');
}

const statusText = value => ({ NEW: tr('评审中'), MERGED: tr('已合入'), ABANDONED: tr('已废弃') }[value] || value || '—');
function relationChain(d) {
  const expanded = state.relations?.[relationKey()] ?? !!model.relationChainExpanded;
  const shell = tr`<details id="relation-chain" class="relation-chain" data-relation-key="${e(relationKey())}" ${expanded ? 'open' : ''}><summary>关系链 · Relation chain <span class="muted">${!d.related || d.related.status === 'loading' ? tr('后台加载中…') : d.related.status === 'failed' ? tr('加载失败') : tr`${d.related.changes.length} 个节点`}</span></summary>`;
  if (!d.related || d.related.status === 'loading') return tr`${shell}<p class="muted">关联提交正在后台加载，无需展开触发。</p></details>`;
  if (d.related.status === 'failed') return `${shell}<p class="negative">${e(d.related.error || tr('关系链加载失败'))}</p>${button(tr('重新加载'), 'related')}</details>`;
  const nodes = d.related.changes;
  return tr`${shell}<p class="muted">所查看 PS 的相关提交，上新下旧；点击变更打开其最新 PS。</p><div class="chain">${nodes.map(node => {
    const current = node.commit?.commit === (d.viewRevision || d.current_revision);
    const old = node._revision_number && node._current_revision_number && node._revision_number !== node._current_revision_number;
    const label = node._change_number ? `#${node._change_number} · ${node.commit?.subject || ''}` : node.commit?.subject || node.commit?.commit || tr('提交');
    return `<div class="chain-node ${current ? 'current' : ''}">${node._change_number ? button(label, 'relatedOpen', 'secondary file', `data-number="${e(node._change_number)}"`) : `<div class="chain-commit">${e(label)}</div>`}<div class="muted"><span class="mono">${e(node.commit?.commit?.slice(0, 10))}</span> ${node._revision_number ? `· PS ${e(node._revision_number)}` : ''} ${e(statusText(node.status))} ${current ? tr('<span class="badge">当前 PS</span>') : ''}${old ? tr`<span class="badge">旧 PS · 最新为 ${e(node._current_revision_number)}</span>` : ''}</div>${node.commit?.parents?.length ? tr`<div class="chain-parents muted mono">父提交 ← ${e(node.commit.parents.map(p => p.commit?.slice(0, 10)).join(', '))}</div>` : ''}</div>`;
  }).join('') || tr('<p class="empty">此 PS 没有关联变更</p>')}</div>${button(tr('刷新关系链'), 'related')}</details>`;
}
function fileComparison(d) {
  const count = Object.keys(d.files || {}).filter(path => !path.startsWith('/')).length;
  return tr`${comparison(d)}<p class="muted">${count} 个修改文件 · 见底部“Gerrit 对比差异”面板</p>`;
}
const fileFilterKey = () => `${model.detail?.id}:${model.detail?.comparison?.left}:${model.detail?.comparison?.right}`;

function fileResults(d, query = '') {
  const files = Object.entries(d.files || {}).filter(([path]) => !path.startsWith('/')).sort(([a], [b]) => a.localeCompare(b));
  const matched = files.filter(([path]) => path.toLowerCase().includes(query.toLowerCase()));
  const progress = d.fileProgress || {}, read = new Set(progress.read || []), changed = new Set(progress.changed || []);
  const revision = d.comparison?.revision || (d.comparison?.right === 'base' ? d.comparison.left : d.comparison?.right) || d.current_revision;
  const canonical = (path, file) => d.comparison?.reverse && file.old_path ? file.old_path : path;
  const readCount = files.filter(([path,file]) => read.has(canonical(path,file))).length;
  const baseline = progress.baselineNumber ? tr` · 相比 PS ${e(progress.baselineNumber)} 有 ${changed.size} 个文件变化 ${button(tr('查看版本间变化'), 'progressCompare', 'secondary')}` : '';
  return tr`<div class="muted file-count">显示 ${matched.length} / ${files.length} 个文件 · PS ${e(d.revisions?.[revision]?._number || '?')} 已读 ${readCount}/${files.length}${progress.loading ? tr(' · 正在比较上次版本…') : ''}${progress.error ? ` · ${e(progress.error)}` : baseline}</div><div class="file-table"><div class="file-item file-item-head"><span class="muted">已读</span><div class="file-columns muted"><span>类型</span><span>文件路径</span><span>新增 / 删除</span><span>全部评论</span></div></div>${matched.map(([path, f]) => tr`<div class="file-item ${f.blockedReason ? 'file-blocked' : ''}"><input type="checkbox" data-read-file="${e(path)}" data-file-rev="${e(revision)}" aria-label="标记已读 ${e(path)}" title="此 PS 的本机已读标记" ${read.has(canonical(path,f)) ? 'checked' : ''}><button type="button" class="file-row" data-action="file" data-path="${e(path)}" ${f.blockedReason ? `data-unavailable="true" disabled title="${e(f.blockedReason)}"` : ''}><span class="file-status type-${['A','D','M','R','C','W'].includes(f.status) ? f.status : 'M'}" title="${e(({A:tr('新增'),D:tr('删除'),M:tr('修改'),R:tr('重命名'),C:tr('复制'),W:tr('重写')})[f.status || 'M'] || tr('修改'))}">${e(f.status || 'M')}</span><span class="file-path" title="${e(path)}"><span class="file-name">${e(path)}${f.old_path ? tr`<small class="muted">原路径：${e(f.old_path)}</small>` : ''}</span>${f.blockedReason ? tr('<span class="file-limit"> · 超过 32MB 响应限制</span>') : ''}${(changed.has(path) || changed.has(canonical(path,f))) ? tr('<span class="file-changed">版本有变化</span>') : ''}</span><span class="file-stats"><span class="positive">+${e(f.lines_inserted || 0)}</span> <span class="negative">−${e(f.lines_deleted || 0)}</span></span><span class="muted" title="此文件所有 Patch set 的评论数">${e((d.comments?.[path] || []).length)}</span></button></div>`).join('') || tr('<div class="empty">没有匹配的修改文件</div>')}</div>`;
}

function filesPanel() {
  const d = model.detail;
  if (!model.connected || !d) return tr('<div class="file-panel"><p class="empty">在左侧 Gerrit 工作台选择一笔变更，即可在这里查看修改文件。</p></div>');
  const plan = d.comparison || { left: 'base', right: d.current_revision };
  const label = rev => rev === 'base' ? 'Base' : `PS ${d.revisions?.[rev]?._number || '?'}`;
  const filter = state.fileFilter?.key === fileFilterKey() ? state.fileFilter.query : '';
  return tr`<div class="file-panel"><div class="file-toolbar"><div><b>#${e(d._number)} · ${e(d.subject)}</b><span class="badge">${e(label(plan.left))} → ${e(label(plan.right))}</span></div>${button(tr('返回评审讨论'), 'returnDiscussion')}<input id="file-filter" type="search" aria-label="筛选修改文件路径" placeholder="筛选文件路径…" value="${e(filter)}"></div><div id="file-results">${fileResults(d, filter)}</div></div>`;
}
function patchBrowser(d) {
  const view = d.patchView; const rev = view?.rev || d.current_revision;
  const files = view?.files || [];
  return tr`<div class="section-heading">${icon('code')}<h2>查看版本文件</h2></div><form id="patch"><label for="patch-revision">选择 Patch set</label><select id="patch-revision">${Object.entries(d.revisions || {}).sort((a, b) => b[1]._number - a[1]._number).map(([sha, item]) => `<option value="${e(sha)}" ${sha === rev ? 'selected' : ''}>PS ${item._number} · ${sha.slice(0, 8)}${patchLabel(item)}</option>`).join('')}</select><div class="row">${button(tr('下载到本地'), 'download')}</div></form><p class="muted">使用 SSH 在已打开的本地代码仓库中 fetch 此 PS，并创建 change-${e(d._number)} 分支。请先保存文件并保持工作区干净。</p><div id="download-status">${downloadStatus()}</div>${view ? tr`<form id="patch-search"><input id="patch-search-text" aria-label="查找此版本中的文件" placeholder="输入文件名或路径（忽略大小写）…" value="${e(view.query || '')}"><div class="row"><button type="submit">查找此版本中的文件</button></div></form><p class="muted">${view.loading ? tr`正在后台读取此版本的文件清单，可继续评审…` : view.error ? tr`文件查找失败：${e(view.error)}` : view.query ? tr`找到 ${files.length} 个文件（含未修改文件，忽略大小写）` : tr`当前显示此 PS 的 ${files.length} 个改动文件。可按文件名或路径查找此版本中的全部文件，包括未修改的头文件；无需打开本地仓库。`}</p>${files.map(path => button(path, 'single', 'secondary file', `data-path="${e(path)}" data-patch-rev="${e(rev)}" ${patchFileBlocked(d, rev, path) ? tr('data-unavailable="true" disabled title="文件内容编码后的响应超过 32MB 限制"') : ''}`)).join('')}` : tr('<div class="empty">正在加载 Patch 文件…</div>')}`;
}
function discussion(d) {
  const groups = [];
  for (const [path, comments] of Object.entries(d.comments || {})) {
    const ids = new Map(comments.map(c => [c.id, c])); const threads = new Map();
    for (const c of comments) {
      let root = c; const seen = new Set();
      while (root.in_reply_to && ids.has(root.in_reply_to) && !seen.has(root.id)) { seen.add(root.id); root = ids.get(root.in_reply_to); }
      const list = threads.get(root.id) || []; list.push(c); threads.set(root.id, list);
    }
    for (const list of threads.values()) {
      list.sort((a, b) => String(a.updated).localeCompare(String(b.updated)));
      if (state.unresolvedOnly && !list.at(-1).unresolved) continue;
      if (state.participatedOnly && !list.some(c => (model.accountId !== undefined && c.author?._account_id === model.accountId) || (model.username && c.author?.username === model.username))) continue;
      groups.push({ path, list });
    }
  }
  const codeTab = state.tabs?.[d.id] === 'code';
  const discussionBody = tr`<h2>代码讨论 <span class="muted">所有 Patch set · ${groups.length} 个线程</span></h2><div class="filters"><label class="row"><input id="unresolved-only" type="checkbox" ${state.unresolvedOnly ? 'checked' : ''}>仅显示未解决的讨论</label><label class="row"><input id="participated-only" type="checkbox" ${state.participatedOnly ? 'checked' : ''}>有我参与的讨论</label></div>${groups.map(({ path, list }) => {
    const root = list[0]; const last = list.at(-1);
    const replyKey = `${key()}::${last.id}`;
    return tr`<details class="card thread" data-thread-key="${e(`${key()}::${root.id}`)}" ${state.threadCollapsed?.[`${key()}::${root.id}`] ? '' : 'open'}><summary class="thread-summary"><b title="${e(path)}">${path === '/PATCHSET_LEVEL' ? tr('全局评论') : e(path)}${root.line ? `:${e(root.line)}` : tr(' · 文件评论')}</b><span class="thread-snippet" title="${e(firstLine(root.message))}">${markdown.renderInline(firstLine(root.message))}</span><span class="badge">${last.unresolved ? tr('未解决') : tr('已解决')}</span></summary><p class="muted">PS ${e(root.patch_set || '?')} · ${root.side === 'PARENT' ? 'Base' : 'Patch'} ${root.range ? tr`· 行 ${root.range.start_line}–${root.range.end_line}` : ''}</p>${list.map(c => `<div class="thread-message"><div class="message-byline"><span class="avatar">${e(who(c.author).slice(0, 1))}</span><b>${e(who(c.author))}</b><time>${e(time(c.updated))}</time></div><div class="message markdown-body">${md(c.message)}</div></div>`).join('')}<div class="row">${!path.startsWith('/') ? button(tr('定位到差异代码'), 'locate', 'secondary', `data-path="${e(path)}" data-comment="${e(root.id)}"`) : ''}</div><form data-form="reply" data-path="${e(path)}" data-comment="${e(last.id)}">${markdownEditor(state.replies?.[replyKey] || '', { replyKey, label: tr`回复 ${path} 的讨论`, placeholder: tr('回复这条讨论…') })}<div class="row"><button type="submit">发布回复</button></div></form></details>`;
  }).join('') || tr('<div class="empty">暂无符合筛选的代码讨论</div>')}<h2>活动记录</h2>${(d.messages || []).slice().reverse().map(m => `<details class="card activity"><summary><b>${e(who(m.author))}</b><span class="badge">PS ${e(m._revision_number)}</span><span class="activity-snippet" title="${e(firstLine(m.message))}">${markdown.renderInline(firstLine(m.message))}</span><time>${e(time(m.date))}</time></summary><div class="message markdown-body">${md(m.message)}</div></details>`).join('') || tr('<p class="muted">暂无活动</p>')}`;
  return tr`<div class="review-shell"><div class="hero"><div class="hero-top"><span class="eyebrow">CHANGE #${e(d._number)}</span><span class="badge status">${e(changeStatus(d))}</span><div class="hero-actions"><span id="task-entry">${taskButton()}</span>${button(tr('刷新此变更'), 'refresh')}${button(tr('内置浏览器'), 'browser')}</div></div><div id="result-navigation" class="result-navigation" aria-label="检索结果导航">${resultNavigation()}${pendingSearch()}</div><h1>${e(displaySubject(d))}</h1><p class="muted">${metadataLink(d.project, 'repo')} <span class="separator">/</span> ${metadataLink(d.branch, 'branch')} <span class="separator">·</span> ${metadataLink(who(d.owner), 'owner')} <span class="badge">最新 PS ${e(d.revisions?.[d.current_revision]?._number)}</span></p>${timestamps(d)}</div>${commitInfo(d)}${relationChain(d)}<div class="discussion-layout"><section><nav class="tabs" aria-label="评审视图">${button(tr('讨论'), 'tabDiscussion', codeTab ? 'tab' : 'tab active')}${button(tr('代码与下载'), 'tabCode', codeTab ? 'tab active' : 'tab')}</nav>${codeTab ? `<div class="card code-panel" id="patch-browser">${patchBrowser(d)}</div>` : discussionBody}</section><aside><div class="ratings"><h2>当前评分 <span class="muted">最新 PS</span></h2>${reviewerManager(d)}${votes(d.labels) || tr('<p class="muted">暂无评分标签</p>')}</div><div class="card composer">${reviewForm(d)}</div></aside></div></div>`;
}


function pendingSearch() {
  const count = model.searchUpdates?.pending || 0;
  return count ? tr`<div class="search-updates" role="status">新增 ${e(count)} 条结果 · 当前顺序保持不变 ${button(tr('合并新增结果'), 'applySearchUpdates')}</div>` : '';
}
function taskButton() {
  const count = (model.backgroundTasks || []).filter(job => job.status === 'running').length;
  return button(tr`后台任务${count ? ` · ${count}` : ''}`, 'tasks', 'secondary');
}
function taskList() {
  const status = { running: tr('进行中'), completed: tr('已完成'), cancelled: tr('已取消'), failed: tr('失败') };
  return tr`<div class="task-list"><h1>后台任务</h1><p class="muted">检索、版本文件索引和本地下载。切换分支开始后不再中断该步骤。</p>${(model.backgroundTasks || []).map(job => `<article class="card task-row"><div class="row"><strong>${e(job.title)}</strong><span class="badge">${e(status[job.status] || job.status)}</span></div><p class="muted">${e(job.stage)}</p><div class="row">${job.cancelable ? button(tr('取消'), 'taskCancel', 'secondary', `data-task-id="${e(job.id)}"`) : ''}${job.retryable ? button(tr('重试'), 'taskRetry', 'secondary', `data-task-id="${e(job.id)}"`) : ''}</div></article>`).join('') || tr('<p class="empty">暂无后台任务</p>')}</div>`;
}

function resultNavigation() {
  const historical = model.detail?.viewRevision && model.detail.viewRevision !== model.detail.current_revision;
  const latest = historical ? button(tr('查看最新 PS'), 'openLatest', 'secondary') : '';
  const crumbs = (model.breadcrumbs || []).map(item => button('#' + item.number, 'returnAncestor', 'meta-link', `data-index="${e(item.index)}"`)).join('<span aria-hidden="true"> → </span>');
  if (model.parentNavigation) return tr`${button(tr`← 返回子提交 #${model.parentNavigation.number}`, 'returnChild', 'secondary')}${latest}<nav class="breadcrumbs" aria-label="父子提交路径">${crumbs} → <strong>#${e(model.detail?._number)}</strong></nav><span class="muted">父提交浏览${historical ? tr` · 正在查看 PS ${e(model.detail.revisions?.[model.detail.viewRevision]?._number)}` : ''}</span>`;
  const nav = model.resultNavigation || {};
  const control = (label, direction, enabled) => button(label, 'navigate', 'secondary', `data-direction="${direction}" ${enabled ? '' : 'data-unavailable="true" disabled'}`);
  return tr`${latest}${control(tr('← 上一条'), -1, nav.previous)}${control(tr('下一条 →'), 1, nav.next)}<span class="muted" title="按当前检索结果顺序">${nav.index ? tr`第 ${nav.index} 条${nav.total ? ` / ${nav.total}${nav.more ? '+' : ''}` : ''}` : tr('不在当前检索结果中')}</span>`;
}

function sidebarDetail(d) {
  const rev = d.revisions?.[d.current_revision]; const actions = d.viewRevision && d.viewRevision !== d.current_revision ? {} : d.actions || {};
  const commentCount = Object.values(d.comments || {}).flat().length;
  return tr`<div class="row">${button(tr('← 返回列表'), 'back')}${button(tr('刷新此变更'), 'refresh')}${button(tr('内置浏览器'), 'browser')}</div><p><span class="badge">#${e(d._number)}</span><span class="badge status">${e(changeStatus(d))}</span>${d.work_in_progress ? '<span class="badge">WIP</span>' : ''}</p><div id="result-navigation" class="result-navigation" aria-label="检索结果导航">${resultNavigation()}${pendingSearch()}</div><h1>${e(displaySubject(d))}</h1><p class="muted">${metadataLink(d.project, 'repo')} → ${metadataLink(d.branch, 'branch')}<br>${metadataLink(who(d.owner), 'owner')} · 最新 PS ${e(rev?._number)}</p>${timestamps(d)}${commitInfo(d)}<div class="review-entry">${icon('discussion')}${button(tr`打开评审讨论（${commentCount} 条代码评论）`, 'discussion', 'wide')}<p class="muted">讨论与评分、Commit 信息、单个 Patch 代码和本地下载。</p></div><div class="row">${d.mine && actions.ready?.enabled ? button(tr('发布为待评审'), 'ready', '') : ''}${d.mine && actions.abandon?.enabled ? button(tr('废弃'), 'abandon', 'secondary danger') : ''}${actions.submit?.enabled ? button(tr('合入分支'), 'submit') : ''}</div>${reviewerManager(d)}${relationChain(d)}${fileComparison(d)}`;
}

const searchIdentity = () => `${model.server || ''}::${model.accountId ?? model.username ?? ''}`;
function searchValues() {
  const values = { query: document.getElementById('query')?.value ?? model.query ?? 'is:open', unreviewed: document.getElementById('unreviewed-only')?.checked ?? !!model.unreviewed };
  for (const name of ['message', 'repo', 'branch', 'owner', 'changeNumber', 'file']) values[name] = document.getElementById(name === 'file' ? 'file-filter-search' : name + '-filter')?.value ?? model[name] ?? '';
  return values;
}
function submitSearch(overrides = {}) {
  const values = { ...searchValues(), ...overrides };
  state.searchDraft = { identity: searchIdentity(), base: values.query, values }; save();
  post('search', values);
}
function searchStatus() {
  const status = model.searchStatus;
  if (!status) return '';
  if (status.status === 'running') return tr`<div class="search-progress">搜索中 · 已检查 ${e(status.scanned)} 笔，匹配 ${e(status.matches)} 笔 ${button(tr('停止'), 'cancelSearch')}</div>`;
  if (status.status === 'failed') return tr`<p class="negative">${e(status.error)}。保留 ${e(status.matches)} 笔部分结果，可缩小 repo / branch 范围后重试。</p>`;
  if (status.status === 'cancelled') return tr`<p class="muted">搜索已停止，保留 ${e(status.matches)} 笔已找到的结果（检索未完成）。</p>`;
  return tr`<p class="muted">已检查 ${e(status.scanned)} 笔，找到 ${e(status.matches)} 笔匹配变更</p>`;
}
function searchControls() {
  const saved = state.searchDraft?.identity === searchIdentity() ? state.searchDraft : undefined;
  const value = name => saved?.values[name] ?? model[name] ?? '';
  const repos = [...new Set((model.changes || []).map(c => c.project).filter(Boolean))];
  const owners = [...new Set(['self', ...(model.changes || []).map(c => c.owner?.username || c.owner?.email).filter(Boolean)])];
  const input = (name, label, placeholder, list = '') => `<label for="${name === 'file' ? 'file-filter-search' : name + '-filter'}">${label}</label><input id="${name === 'file' ? 'file-filter-search' : name + '-filter'}" ${list ? `list="${list}"` : ''} value="${e(value(name))}" placeholder="${placeholder}">`;
  const options = (id, values) => `<datalist id="${id}">${values.map(value => `<option value="${e(value)}"></option>`).join('')}</datalist>`;
  return tr`<form id="search" class="search-form"><div class="search-fields">${input('message', 'Message', tr('标题 / Commit / 评论，包含匹配，忽略大小写'))}${input('changeNumber', tr('Gerrit 号'), tr('例如 322，精确匹配'))}${input('file', tr('文件'), tr('修改文件名 / 路径，包含匹配，忽略大小写'))}${input('repo', 'Repo', tr('全部仓库'), 'repo-options')}${input('branch', 'Branch', tr('全部分支'), 'branch-options')}${input('owner', 'Owner', tr('用户名 / 邮箱 / self'), 'owner-options')}</div>${options('repo-options', repos)}${options('branch-options', model.branchOptions || [])}${options('owner-options', owners)}<label class="row"><input id="unreviewed-only" type="checkbox" ${model.unreviewed ? 'checked' : ''}>仅我未评审</label><div class="row"><button type="submit">搜索</button>${button(tr('重置'), 'resetSearch')}${button(tr('刷新列表'), 'refresh')}</div><details class="advanced-search"><summary>高级条件与生成的 Gerrit 查询</summary><label for="query">基础 Gerrit 条件</label><input id="query" value="${e(saved && saved.base === model.query ? saved.values.query : model.query)}"><p class="muted">范围查询</p><code>${e(model.searchPlan?.scope || model.query)}</code>${model.searchPlan?.message ? tr`<p class="muted">提交说明正则查询</p><code>${e(model.searchPlan.commitQuery)}</code><p class="muted">标题、历史 Commit、整体及行内评论、Change-Id / SHA 的包含匹配由插件跨分页补充。</p>` : ''}</details><div id="search-status" role="status">${searchStatus()}</div></form>`;
}
function inboxResults() {
  const pageSize = model.pageSize || 50;
  return tr`${(model.changes || []).map(c => tr`<button type="button" class="change state-${c.status === 'MERGED' ? 'merged' : c.status === 'ABANDONED' ? 'abandoned' : c.work_in_progress ? 'wip' : readyToSubmit(c) ? 'ready' : 'open'}" data-action="open" data-id="${e(c.id)}"><span class="muted">#${e(c._number)} · ${e(changeStatus(c))}${c.work_in_progress ? ' · WIP' : ''}</span>${c.status === 'NEW' ? tr`<span class="review-mark ${c.reviewed ? 'done' : 'pending'}" title="你在作者最近一次更新后发布过评论或评分，即显示已评审">${c.reviewed ? tr('✓ 我已评审') : tr('○ 我未评审')}</span>` : ''}<span class="subject">${e(c.subject)}</span><span class="muted">${e(c.project)} → ${e(c.branch)}<span class="card-byline">${e(who(c.owner))} · 更新 ${e(time(c.updated))}</span></span><div class="row card-votes">${Object.entries(c.labels || {}).map(([name, l]) => `<span class="badge">${e(name)} ${e(l.approved ? '✓' : l.rejected ? '✕' : [...new Set((l.all || []).filter(v => Number.isFinite(v.value)).map(v => v.value))].sort((a,b) => b-a).map(value => value > 0 ? `+${value}` : value).join(' / ') || '—')}</span>`).join('')}</div></button>`).join('') || tr('<div class="card muted">没有匹配的变更。可切换 Open 或修改查询。</div>')}<div class="row">${model.start ? button(tr('上一页'), 'prev') : ''}${model.more ? button(tr('下一页'), 'next') : ''}<span class="muted">第 ${Math.floor((model.start || 0) / pageSize) + 1} 页</span></div>`;
}
function render() {
  if (document.documentElement) document.documentElement.lang = model.language === 'en' ? 'en' : 'zh-CN';
  document.title = tr('Gerrit 工作台');
  const brand = document.querySelector?.('.brand span'); if (brand) brand.textContent = tr('工作台');
  document.getElementById('account').textContent = model.connected ? `${model.user} · ${model.server}` : tr('提交 · 评审 · 讨论');
  if (model.surface === 'tasks') { app.innerHTML = taskList();
  } else if (model.surface === 'files') {
    app.innerHTML = filesPanel();
  } else if (!model.connected) {
    app.innerHTML = tr`<h1>代码评审，触手可及。</h1><p class="muted">连接 Gerrit 后，在这里处理提交和文件比较。讨论在当前编辑器组的评审页中展开。</p><div class="row">${button(tr('连接服务器'), 'connect', '')}</div><p class="muted">支持 HTTP Key 和 HTTP 反向代理网页登录密码。凭据存入 VS Code 安全存储。</p>${button(tr('上传本地提交'), 'push')}`;
  } else if (model.detail) {
    app.innerHTML = model.surface === 'discussion' ? discussion(model.detail) : sidebarDetail(model.detail);
  } else if (model.surface === 'discussion') {
    app.innerHTML = tr('<p class="muted">请在 Gerrit 侧边栏选择一笔变更，再点击“打开评审讨论”。</p>');
  } else {
    const presets = [['Open', 'is:open'], ['Merged', 'is:merged'], ['Abandoned', 'is:abandoned'], [tr('与我相关'), 'is:open (owner:self OR reviewer:self)'], [tr('我的提交'), 'owner:self']];
    app.innerHTML = tr`<div class="row">${button(tr('上传本地提交'), 'push', '')}${button(tr('连接设置'), 'connect')}${button(tr('断开'), 'disconnect')}</div><h1>评审收件箱</h1><div class="row">${presets.map(([name, query]) => button(name, 'preset', model.query === query ? '' : 'secondary', `data-query="${e(query)}"`)).join('')}</div>${searchControls()}<p class="muted">每页最多 ${model.pageSize || 50} 条</p><div id="search-updates">${pendingSearch()}</div><div id="inbox-results">${inboxResults()}</div>`;
  }
  setBusy();
  post('rendered', { surface: model.surface || 'sidebar' });
}
function setBusy() { app.querySelectorAll('button,select,input[data-read-file]').forEach(el => { el.disabled = el.dataset?.unavailable === 'true' || (busy && !['cancelSearch','tasks','taskCancel','taskRetry'].includes(el.dataset?.action)) || (el.dataset?.action === 'download' && (model.downloads || []).some(job => job.changeId === model.detail?.id && (job.status === 'running' || job.settled === false))); }); app.setAttribute('aria-busy', String(busy)); }
function payload() { return { id: model.detail?.id, rev: model.detail?.current_revision, compareLeft: model.detail?.comparison?.left, compareRight: model.detail?.comparison?.right }; }
app.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (link?.tagName === 'A') {
    event.preventDefault(); event.stopPropagation();
    post('openLink', { url: link.getAttribute('href') }); return;
  }
  const preview = event.target.closest('.markdown-preview');
  if (preview && !event.target.closest('a')) { startMarkdownEdit(preview); return; }
  const b = event.target.closest('button[data-action]'); if (!b) return;
  const action = b.dataset.action;
  if (['tasks','taskCancel','taskRetry'].includes(action)) { post(action, { taskId: b.dataset.taskId }); return; }
  if (action === 'cancelSearch') { post('cancelSearch'); return; }
  if (busy || b.dataset.unavailable === 'true') return;
  if (action === 'progressCompare') { post('compare', { ...payload(), left: model.detail.fileProgress.baselineRevision, right: model.detail.fileProgress.revision }); return; }
  if (action === 'tabCode' || action === 'tabDiscussion') { state.tabs ||= {}; state.tabs[model.detail.id] = action === 'tabCode' ? 'code' : 'discussion'; save(); render(); if (action === 'tabCode' && !model.detail.patchView) post('patch', { ...payload(), patchRev: model.detail.current_revision }); return; }
  if (action === 'download') { post('download', { ...payload(), patchRev: document.getElementById('patch-revision').value }); return; }
  if (action === 'swap') {
    const left = document.getElementById('compare-left'); const right = document.getElementById('compare-right');
    autoCompare(right.value, left.value); return;
  }
  if (action === 'compareMode') { post('compare', { ...payload(), left: 'base', right: model.detail.current_revision }); return; }
  if (action === 'resetSearch') { submitSearch({ message: '', repo: '', branch: '', owner: '', changeNumber: '', file: '', query: 'is:open', unreviewed: false }); return; }
  if (action === 'preset') submitSearch({ query: b.dataset.query, unreviewed: ['is:merged', 'is:abandoned'].includes(b.dataset.query) ? false : !!model.unreviewed });
  else if (action === 'next' || action === 'prev') post('page', { next: action === 'next' });
  else if (['ready', 'abandon', 'submit'].includes(action)) post('action', { ...payload(), action });
  else post(action, { ...payload(), ...b.dataset });
});
function saveReview() {
  const message = document.getElementById('review-message'); if (!message) return;
  const labels = {}; app.querySelectorAll('select[data-label]').forEach(s => { if (s.value !== '') labels[s.dataset.label] = Number(s.value); });
  state.drafts ||= {}; state.drafts[key()] = { message: message.value, labels }; save();
}
app.addEventListener('input', event => {
  if (['message-filter', 'repo-filter', 'branch-filter', 'owner-filter', 'changeNumber-filter', 'file-filter-search', 'query'].includes(event.target.id)) { state.searchDraft = { identity: searchIdentity(), base: model.query, values: searchValues() }; save(); }
  if (event.target.id === 'file-filter') {
    state.fileFilter = { key: fileFilterKey(), query: event.target.value }; save();
    document.getElementById('file-results').innerHTML = fileResults(model.detail, event.target.value); setBusy();
  }
  if (event.target.id === 'review-message') saveReview();
  if (event.target.dataset?.replyKey) { state.replies ||= {}; state.replies[event.target.dataset.replyKey] = event.target.value; save(); }
});
app.addEventListener('change', event => {
  if (event.target.dataset?.readFile && !busy) post('fileRead', { ...payload(), path: event.target.dataset.readFile, fileRev: event.target.dataset.fileRev, read: event.target.checked });
  if ((event.target.id === 'compare-left' || event.target.id === 'compare-right') && !busy) autoCompare(document.getElementById('compare-left').value, document.getElementById('compare-right').value);
  if (event.target.id === 'patch-revision' && !busy) post('patch', { ...payload(), patchRev: event.target.value });
  if (event.target.id === 'unreviewed-only') submitSearch({ unreviewed: event.target.checked });
  if (event.target.id === 'unresolved-only') { state.unresolvedOnly = event.target.checked; save(); render(); }
  if (event.target.id === 'participated-only') { state.participatedOnly = event.target.checked; save(); render(); }
  if (event.target.dataset?.label) saveReview();
});
app.addEventListener('submit', event => {
  event.preventDefault(); if (busy) return;
  if (event.target.id === 'search') submitSearch();
  if (event.target.id === 'patch-search') post('patchSearch', { ...payload(), patchRev: model.detail.patchView.rev, query: document.getElementById('patch-search-text').value });
  if (event.target.id === 'review') { saveReview(); post('review', { ...payload(), ...draft() }); }
  if (event.target.dataset?.form === 'reply') post('reply', { ...payload(), path: event.target.dataset.path, comment: event.target.dataset.comment, message: event.target.querySelector('textarea').value });
});
app.addEventListener('focusout', event => {
  // Publishing must keep its click target stable while focus leaves the textarea.
  if (event.relatedTarget?.matches?.('button[type="submit"]')) return;
  if (event.target.matches?.('.markdown-editor textarea')) previewMarkdown(event.target);
});
app.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.markdown-preview')) {
    event.preventDefault(); startMarkdownEdit(event.target);
  }
});
app.addEventListener('toggle', event => {
  if (event.target.dataset?.relationKey) {
    state.relations ||= {}; state.relations[event.target.dataset.relationKey] = event.target.open; save();
    return;
  }
  if (!event.target.dataset?.threadKey) return;
  state.threadCollapsed ||= {}; state.threadCollapsed[event.target.dataset.threadKey] = !event.target.open; save();
}, true);
for (const name of ['pointerover','focusin','wheel']) app.addEventListener(name, event => {
  if (event.target.closest?.('#inbox-results')) post('lockSearch');
}, { passive: true });
window.addEventListener('message', ({ data }) => {
  if (data.type === 'showDiscussion' && model.surface === 'discussion' && model.detail) {
    state.tabs ||= {}; state.tabs[model.detail.id] = 'discussion'; save(); render();
  }
  if (data.type === 'patchComparisons' && model.detail?.id === data.id && model.detail.current_revision === data.rev) {
    for (const [sha, comparison] of Object.entries(data.patches)) if (model.detail.revisions[sha]) model.detail.revisions[sha].previousPatch = comparison;
    for (const id of ['compare-left', 'compare-right', 'patch-revision']) {
      const select = document.getElementById(id);
      for (const option of select?.options || []) {
        const rev = model.detail.revisions[option.value];
        if (rev) option.textContent = `PS ${rev._number} · ${option.value.slice(0,8)}${patchLabel(rev)}`;
      }
    }
  }
  if (data.type === 'tasks') {
    model.backgroundTasks = data.tasks;
    if (model.surface === 'tasks') app.innerHTML = taskList();
    const entry = document.getElementById('task-entry'); if (entry) entry.innerHTML = taskButton(); setBusy();
  }
  if (data.type === 'fileProgress' && model.detail?.id === data.id) {
    const plan = model.detail.comparison;
    if ((plan?.revision || (plan?.right === 'base' ? plan?.left : plan?.right) || model.detail.current_revision) === data.revision) {
      model.detail.fileProgress = data.progress;
      const region = document.getElementById('file-results'); if (region) { region.innerHTML = fileResults(model.detail, document.getElementById('file-filter')?.value || ''); setBusy(); }
    }
  }
  if (data.type === 'searchNavigation') { delete state.searchDraft; save(); }
  if (data.type === 'state') { model = data.model; render(); }
  if (data.type === 'inboxResults') {
    Object.assign(model, { changes: data.changes, start: data.start, more: data.more, resultNavigation: data.navigation, searchUpdates: data.updates });
    const updates = document.getElementById('search-updates'); if (updates) updates.innerHTML = pendingSearch();
    const navigation = document.getElementById('result-navigation'); if (navigation && model.detail) { navigation.innerHTML = resultNavigation() + pendingSearch(); setBusy(); }
    const region = document.getElementById('inbox-results');
    if (region && !model.detail && model.surface !== 'discussion' && model.surface !== 'files') { region.innerHTML = inboxResults(); setBusy(); }
  }
  if (data.type === 'parentState' && model.detail?.id === data.id && model.detail.current_revision === data.rev && (model.detail.viewRevision || model.detail.current_revision) === (data.focusRevision || data.rev)) {
    model.detail.parentTargets = data.parentTargets;
    const panel = document.getElementById('commit-info'); if (panel) { panel.outerHTML = commitInfo(model.detail, panel.open); setBusy(); }
  }
  if (data.type === 'relatedState' && model.detail?.id === data.id && model.detail.current_revision === data.rev && (model.detail.viewRevision || model.detail.current_revision) === (data.focusRevision || data.rev)) {
    model.detail.related = data.related;
    const panel = document.getElementById('relation-chain');
    if (panel) {
      state.relations ||= {}; state.relations[relationKey()] = panel.open; save();
      panel.outerHTML = relationChain(model.detail); setBusy();
    }
  }
  if (data.type === 'patchView' && model.detail?.id === data.id && model.detail?.current_revision === data.currentRevision) {
    model.detail.patchView = data.patchView;
    const region = document.getElementById('patch-browser'); if (region) { region.innerHTML = patchBrowser(model.detail); setBusy(); }
  }
  if (data.type === 'downloadState') { model.downloads = data.downloads; const region = document.getElementById('download-status'); if (region) region.innerHTML = downloadStatus(); setBusy(); }
  if (data.type === 'searchProgress') { model.searchStatus = data.searchStatus; const region = document.getElementById('search-status'); if (region) region.innerHTML = searchStatus(); setBusy(); }
  if (data.type === 'busy') { busy = data.value; if (busy) notice.textContent = tr('处理中…'); else if (notice.textContent === tr('处理中…')) notice.textContent = ''; setBusy(); }
  if (data.type === 'error') {
    notice.textContent = data.message;
    if (model.detail && document.getElementById('compare-left')) {
      const plan = model.detail.comparison || { left: 'base', right: model.detail.current_revision };
      autoCompare(plan.left, plan.right, false);
    }
  }
  if (data.type === 'reviewSent') { if (state.drafts) delete state.drafts[key()]; save(); }
  if (data.type === 'replySent') { if (state.replies) delete state.replies[`${key()}::${data.comment}`]; save(); }
});
post('init');
