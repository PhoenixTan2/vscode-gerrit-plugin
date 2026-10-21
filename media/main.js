'use strict';
const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const notice = document.getElementById('notice');
let model = {}; let busy = false; let state = vscode.getState() || {};
const post = (type, data = {}) => vscode.postMessage({ type, ...data });
window.addEventListener('error', event => post('clientError', { message: event.message || '工作台脚本加载失败' }));
window.addEventListener('unhandledrejection', event => post('clientError', { message: event.reason?.message || '工作台页面处理失败' }));
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const who = account => account?.name || account?.username || account?.email || `用户 ${account?._account_id || '?'}`;
const key = () => `${model.server || ''}::${model.accountId ?? model.username ?? ''}::${model.detail?.id}::${model.detail?.current_revision}`;
const save = () => vscode.setState(state);
const draft = () => state.drafts?.[key()] || {};
function button(text, action, cls = 'secondary', attrs = '') { return `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${e(text)}</button>`; }
function votes(labels) {
  return Object.entries(labels || {}).map(([name, label]) => `<div class="card"><b>${e(name)}</b>${(label.all || []).map(v => `<div class="vote"><span>${e(who(v))}</span><strong class="${v.value > 0 ? 'positive' : v.value < 0 ? 'negative' : ''}">${v.value > 0 ? '+' : ''}${e(v.value ?? 0)}</strong></div>`).join('') || '<p class="muted">暂无评分</p>'}</div>`).join('');
}
function comparison(d) {
  const plan = d.comparison || { left: 'base', right: d.current_revision };
  const options = [['base', 'Base（另一侧 PS 的第一父提交）'], ...Object.entries(d.revisions || {}).sort((a, b) => a[1]._number - b[1]._number).map(([sha, rev]) => [sha, `PS ${rev._number} · ${sha.slice(0, 8)}`])];
  const select = side => `<select id="compare-${side}" aria-label="${side === 'left' ? '左侧版本' : '右侧版本'}">${options.map(([id, label]) => `<option value="${e(id)}" ${id === plan[side] ? 'selected' : ''}>${e(label)}</option>`).join('')}</select>`;
  return `<h2>版本比较</h2><form id="compare"><label for="compare-left">左侧</label>${select('left')}<label for="compare-right">右侧</label>${select('right')}<div class="row"><button type="submit">比较</button>${button('交换左右', 'swap')}</div></form><p class="muted">可比较任意两个 PS，或 PS 与其 Base。代码评论绑定实际版本。</p>`;
}
function reviewForm(d) {
  const saved = draft();
  return `<h2>发布评审 · 最新 PS ${e(d.revisions?.[d.current_revision]?._number)}</h2><form id="review"><textarea id="review-message" aria-label="评审评论" placeholder="写下整体评审意见…">${e(saved.message || '')}</textarea>${Object.entries(d.permitted_labels || {}).map(([name, values], i) => `<label for="label-${i}">${e(name)}</label><select id="label-${i}" data-label="${e(name)}"><option value="">不修改评分</option>${values.map(v => `<option value="${e(Number(v))}" ${String(saved.labels?.[name]) === String(Number(v)) ? 'selected' : ''}>${e(v.trim())} ${e(d.labels?.[name]?.values?.[v] || '')}</option>`).join('')}</select>`).join('')}<div class="row"><button type="submit">发布评审</button><span class="muted">整体评论与评分立即发布；下方代码回复发到原评论所在 PS。</span></div></form>`;
}
function time(value) {
  if (!value) return '—';
  const iso = String(value).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + 'Z');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function timestamps(d) { const commitDate = d.revisions?.[d.current_revision]?.commit?.committer?.date || d.created; return `<p class="muted timestamps">最后更新：${e(time(d.updated))}<br>提交时间：${e(time(commitDate))}<br>评审创建：${e(time(d.created))}</p>`; }
function patchBrowser(d) {
  const view = d.patchView; const rev = view?.rev || d.current_revision;
  const files = view?.files || [];
  const search = view?.query || '';
  const matched = files;
  return `<h2>单个 Patch · 代码浏览</h2><form id="patch"><label for="patch-revision">选择 Patch set</label><select id="patch-revision">${Object.entries(d.revisions || {}).sort((a, b) => a[1]._number - b[1]._number).map(([sha, item]) => `<option value="${e(sha)}" ${sha === rev ? 'selected' : ''}>PS ${item._number} · ${sha.slice(0, 8)}</option>`).join('')}</select><div class="row"><button type="submit">浏览此 Patch</button>${button('下载到本地', 'download')}</div></form>${view ? `<p class="muted">上传时间：${e(time(d.revisions[rev]?.created))}</p><form id="patch-search"><input id="patch-search-text" aria-label="筛选 Patch 文件" placeholder="搜索此 PS 中的任意文件路径…" value="${e(search)}"><div class="row"><button type="submit">搜索文件</button>${button('返回版本比较', 'compareMode')}</div></form><p class="muted">${search ? `服务器返回 ${files.length} 个匹配文件（服务器可能限制数量，请缩小关键词继续搜索）` : `此 Patch 有 ${files.length} 个可查看的改动文件，可搜索其他文件`}</p>${matched.slice(0, 200).map(path => button(path, 'single', 'secondary file', `data-path="${e(path)}" data-patch-rev="${e(rev)}"`)).join('')}` : '<p class="muted">可单独打开此 Patch 的任意代码文件，单文件完整查看而无需左右对比。</p>'}`;
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
  return `<div class="row">${button('刷新', 'refresh')}${button('内置浏览器', 'browser')}</div><h1>#${e(d._number)} ${e(d.subject)}</h1>${timestamps(d)}<div class="discussion-layout"><section>${reviewForm(d)}<h2>代码讨论 · 所有 Patch set</h2><label class="row"><input id="unresolved-only" type="checkbox" ${state.unresolvedOnly ? 'checked' : ''}>仅显示未解决的讨论</label><label class="row"><input id="participated-only" type="checkbox" ${state.participatedOnly ? 'checked' : ''}>有我参与的讨论</label>${groups.map(({ path, list }) => {
    const root = list[0]; const last = list.at(-1);
    const replyKey = `${key()}::${last.id}`;
    return `<article class="card thread"><div class="comment-head"><b>${e(path)}${root.line ? `:${e(root.line)}` : ' · 文件评论'}</b><span class="badge">${last.unresolved ? '未解决' : '已解决'}</span></div><p class="muted">PS ${e(root.patch_set || '?')} · ${root.side === 'PARENT' ? 'Base' : 'Patch'} ${root.range ? `· 行 ${root.range.start_line}–${root.range.end_line}` : ''}</p>${list.map(c => `<div class="thread-message"><b>${e(who(c.author))}</b> <small class="muted">${e(c.updated)}</small><p class="message">${e(c.message)}</p></div>`).join('')}<div class="row">${button('定位到代码', 'locate', 'secondary', `data-path="${e(path)}" data-comment="${e(root.id)}"`)}</div><form data-form="reply" data-path="${e(path)}" data-comment="${e(last.id)}"><textarea data-reply-key="${e(replyKey)}" aria-label="回复 ${e(path)} 的讨论" placeholder="回复这条讨论…">${e(state.replies?.[replyKey] || '')}</textarea><div class="row"><button type="submit">发布回复</button></div></form></article>`;
  }).join('') || '<p class="muted">暂无符合筛选的代码讨论</p>'}<h2>活动记录</h2>${(d.messages || []).slice().reverse().map(m => `<details class="card"><summary>${e(who(m.author))} · PS ${e(m._revision_number)} · ${e(m.date)}</summary><div class="message">${e(m.message)}</div></details>`).join('') || '<p class="muted">暂无活动</p>'}</section><aside><h2>当前评分</h2>${votes(d.labels) || '<p class="muted">暂无评分标签</p>'}</aside></div>`;
}
function sidebarDetail(d) {
  const rev = d.revisions?.[d.current_revision]; const commit = rev?.commit || {}; const actions = d.actions || {};
  const commentCount = Object.values(d.comments || {}).flat().length;
  return `<div class="row">${button('← 返回列表', 'back')}${button('刷新', 'refresh')}${button('内置浏览器', 'browser')}</div><p><span class="badge">#${e(d._number)}</span><span class="badge">${e(d.status)}</span>${d.work_in_progress ? '<span class="badge">WIP</span>' : ''}</p><h1>${e(d.subject)}</h1><p class="muted">${e(d.project)} → ${e(d.branch)}<br>${e(who(d.owner))} · 最新 PS ${e(rev?._number)}</p><div class="row">${d.mine && actions.ready?.enabled ? button('发布为待评审', 'ready', '') : ''}${d.mine && actions.abandon?.enabled ? button('废弃', 'abandon', 'secondary danger') : ''}${actions.submit?.enabled ? button('合入分支', 'submit') : ''}</div>${button(`打开评审讨论（${commentCount} 条代码评论）`, 'discussion', 'wide')}<p class="muted">在独立标签页中查看讨论、回复、发布评审和评分。</p><details ${model.commitInfoExpanded ? 'open' : ''}><summary>Commit 信息（最新 PS）</summary><pre>${e(commit.message)}</pre><p class="muted">SHA: ${e(d.current_revision)}<br>Change-Id: ${e(d.change_id)}<br>作者: ${e(commit.author?.name)} &lt;${e(commit.author?.email)}&gt;<br>时间: ${e(commit.author?.date)}<br>提交者: ${e(commit.committer?.name)}<br>父提交: ${e((commit.parents || []).map(p => p.commit).join(', '))}</p></details>${timestamps(d)}${patchBrowser(d)}${d.patchView ? '' : `${comparison(d)}<h2>比较结果 · 文件</h2><p class="muted">打开 diff 后，选中代码 → 右键“评论所选代码行”可展开行内输入框，也可点击行号旁的 +。已有评论显示为行号旁图标，悬停代码可预览。</p>${Object.entries(d.files || {}).map(([path, f]) => button(`${f.status || 'M'}  ${path}  +${f.lines_inserted || 0} −${f.lines_deleted || 0}`, 'file', 'secondary file', `data-path="${e(path)}"`)).join('') || '<p class="muted">两个版本之间没有文件改动</p>'}`}`;
}
function render() {
  document.getElementById('account').textContent = model.connected ? `${model.user} · ${model.server}` : '提交 · 评审 · 讨论';
  if (!model.connected) {
    app.innerHTML = `<h1>代码评审，触手可及。</h1><p class="muted">连接 Gerrit 后，在这里处理提交和文件比较。讨论在独立窗口中展开。</p><div class="row">${button('连接服务器', 'connect', '')}</div><p class="muted">支持 HTTP Key 和 HTTP 反向代理网页登录密码。凭据存入 VS Code 安全存储。</p>${button('上传本地提交', 'push')}`;
  } else if (model.detail) {
    app.innerHTML = model.surface === 'discussion' ? discussion(model.detail) : sidebarDetail(model.detail);
  } else if (model.surface === 'discussion') {
    app.innerHTML = '<p class="muted">请在 Gerrit 侧边栏选择一笔变更，再点击“打开评审讨论”。</p>';
  } else {
    const pageSize = model.pageSize || 50;
    const presets = [['Open', 'is:open'], ['Merged', 'is:merged'], ['与我相关', 'is:open (owner:self OR reviewer:self)'], ['我的提交', 'owner:self'], ['待我评审', 'is:open reviewer:self -owner:self']];
    app.innerHTML = `<div class="row">${button('上传本地提交', 'push', '')}${button('连接设置', 'connect')}${button('断开', 'disconnect')}</div><h1>评审收件箱</h1><div class="row">${presets.map(([name, query]) => button(name, 'preset', model.query === query ? '' : 'secondary', `data-query="${e(query)}"`)).join('')}</div><form id="search"><label for="query">Gerrit 查询</label><input id="query" value="${e(model.query)}" placeholder="is:open project:my/project"><div class="row"><button type="submit">搜索</button>${button('刷新', 'refresh')}<span class="muted">每页最多 ${pageSize} 条</span></div></form>${(model.changes || []).map(c => `<button type="button" class="change" data-action="open" data-id="${e(c.id)}"><span class="muted">#${e(c._number)} · ${e(c.status)}${c.work_in_progress ? ' · WIP' : ''}</span><span class="subject">${e(c.subject)}</span><span class="muted">${e(c.project)} → ${e(c.branch)}<br>${e(who(c.owner))}<br>最后更新：${e(time(c.updated))}</span><div class="row">${Object.entries(c.labels || {}).map(([name, l]) => `<span class="badge">${e(name)} ${e(l.approved ? '✓' : l.rejected ? '✕' : (l.all || []).map(v => v.value > 0 ? `+${v.value}` : v.value).join(' / ') || '—')}</span>`).join('')}</div></button>`).join('') || '<div class="card muted">没有匹配的变更。可切换 Open 或修改查询。</div>'}<div class="row">${model.start ? button('上一页', 'prev') : ''}${model.more ? button('下一页', 'next') : ''}<span class="muted">第 ${Math.floor((model.start || 0) / pageSize) + 1} 页</span></div>`;
  }
  setBusy();
  post('rendered', { surface: model.surface || 'sidebar' });
}
function setBusy() { app.querySelectorAll('button,select').forEach(el => { el.disabled = busy; }); app.setAttribute('aria-busy', String(busy)); }
function payload() { return { id: model.detail?.id, rev: model.detail?.current_revision, compareLeft: model.detail?.comparison?.left, compareRight: model.detail?.comparison?.right }; }
app.addEventListener('click', event => {
  const b = event.target.closest('button[data-action]'); if (!b || busy) return;
  const action = b.dataset.action;
  if (action === 'swap') {
    const left = document.getElementById('compare-left'); const right = document.getElementById('compare-right');
    [left.value, right.value] = [right.value, left.value]; return;
  }
  if (action === 'compareMode') { post('compare', { ...payload(), left: 'base', right: model.detail.current_revision }); return; }
  if (action === 'preset') post('search', { query: b.dataset.query });
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
  if (event.target.id === 'review-message') saveReview();
  if (event.target.dataset?.replyKey) { state.replies ||= {}; state.replies[event.target.dataset.replyKey] = event.target.value; save(); }
});
app.addEventListener('change', event => {
  if (event.target.id === 'unresolved-only') { state.unresolvedOnly = event.target.checked; save(); render(); }
  if (event.target.id === 'participated-only') { state.participatedOnly = event.target.checked; save(); render(); }
  if (event.target.dataset?.label) saveReview();
});
app.addEventListener('submit', event => {
  event.preventDefault(); if (busy) return;
  if (event.target.id === 'search') post('search', { query: document.getElementById('query').value });
  if (event.target.id === 'compare') post('compare', { ...payload(), left: document.getElementById('compare-left').value, right: document.getElementById('compare-right').value });
  if (event.target.id === 'patch') post('patch', { ...payload(), patchRev: document.getElementById('patch-revision').value });
  if (event.target.id === 'patch-search') post('patchSearch', { ...payload(), patchRev: model.detail.patchView.rev, query: document.getElementById('patch-search-text').value });
  if (event.target.id === 'review') { saveReview(); post('review', { ...payload(), ...draft() }); }
  if (event.target.dataset?.form === 'reply') post('reply', { ...payload(), path: event.target.dataset.path, comment: event.target.dataset.comment, message: event.target.querySelector('textarea').value });
});
window.addEventListener('message', ({ data }) => {
  if (data.type === 'state') { model = data.model; render(); }
  if (data.type === 'busy') { busy = data.value; if (busy) notice.textContent = '处理中…'; else if (notice.textContent === '处理中…') notice.textContent = ''; setBusy(); }
  if (data.type === 'error') notice.textContent = data.message;
  if (data.type === 'reviewSent') { if (state.drafts) delete state.drafts[key()]; save(); }
  if (data.type === 'replySent') { if (state.replies) delete state.replies[`${key()}::${data.comment}`]; save(); }
});
post('init');
