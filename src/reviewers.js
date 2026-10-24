'use strict';
const {tr} = require('./i18n');
const {pickSuggestion} = require('./suggestions');
const nameOf = account => account.name || account.username || account.email || String(account._account_id);
function reviewerSuggestion(item) {
  if (item.account && Number.isInteger(item.account._account_id)) return {
    label: '$(account) ' + nameOf(item.account), description: item.account.email || item.account.username || '',
    value: { reviewer: String(item.account._account_id), name: nameOf(item.account) }, alwaysShow: true
  };
  if (item.group?.id) return {
    label: '$(organization) ' + item.group.name, description: tr('组') + (Number.isInteger(item.count) ? ` · ${item.count}` : ''),
    value: { reviewer: item.group.id, name: item.group.name, confirm: !!item.confirm }, alwaysShow: true
  };
}
async function manageReviewers(app, vscode) {
  const selected = app.selected, api = app.api;
  const valid = () => {
    if (app.disposed || app.api !== api || app.selected !== selected) throw new Error(tr('页面已更新，请重新选择变更后操作'));
    if (!Number.isInteger(app.user?._account_id) || selected.change.owner?._account_id !== app.user._account_id) throw new Error(tr('只能管理自己的提交的评审人员'));
    if (app.model.detail?.viewRevision && app.model.detail.viewRevision !== selected.rev) throw new Error(tr('当前查看历史 PS，请先切换到最新 PS 后执行变更操作'));
    if (selected.change.status !== 'NEW') throw new Error(tr('只能管理未关闭提交的评审人员'));
  };
  valid();
  const action = await vscode.window.showQuickPick([
    { label: tr('$(person-add) 添加人员或组'), value: 'add' },
    { label: tr('$(person) 移除评审人员'), value: 'remove' }
  ], { title: tr('管理评审人员 · Code-Review / Verified'), placeHolder: tr('人员按提交管理，打分权限由 Gerrit 控制'), ignoreFocusOut: true });
  if (!action) return; valid();
  if (action.value === 'add') {
    const choice = await pickSuggestion(vscode, {
      title: tr('添加评审人员或组'), placeholder: tr('输入姓名、邮箱或组名搜索'),
      load: async (query, signal) => query.trim() ? (await api.suggestReviewers(selected.id, query.trim(), {signal})).map(reviewerSuggestion).filter(Boolean) : []
    });
    if (!choice) return; valid();
    let confirmed = false;
    if (choice.confirm) { confirmed = await app.confirm(tr`将组 ${choice.name} 的成员添加为评审人员？`, tr('添加组成员')); if (!confirmed) return; valid(); }
    let result = await api.addReviewer(selected.id, choice.reviewer, confirmed);
    if (result?.confirm && !confirmed) {
      if (!await app.confirm(tr`将组 ${choice.name} 的成员添加为评审人员？`, tr('添加组成员'))) return;
      valid(); result = await api.addReviewer(selected.id, choice.reviewer, true);
    }
    if (result?.error || result?.confirm) throw new Error(result.error || tr('服务器未确认添加评审人员'));
  } else {
    const reviewers = await api.reviewers(selected.id); valid();
    if (!reviewers.length) { vscode.window.showInformationMessage(tr('没有可移除的评审人员')); return; }
    const choice = await vscode.window.showQuickPick(reviewers.map(account => ({
      label: nameOf(account), description: account.email || account.username || '',
      detail: Object.entries(account.approvals || {}).map(([label, vote]) => `${label}: ${vote}`).join(' · '), value: account._account_id
    })), { title: tr('选择要移除的评审人员'), ignoreFocusOut: true });
    if (!choice) return; valid();
    if (!await app.confirm(tr`移除 ${choice.label}？该人员已有的评分也会被移除。`, tr('移除评审人员'))) return;
    valid(); await api.removeReviewer(selected.id, choice.value);
  }
  if (!app.disposed && app.api === api && app.selected === selected) await app.load(selected.id);
}
module.exports = { manageReviewers, reviewerSuggestion };
