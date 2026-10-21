'use strict';
// Filters are sent to Gerrit before paging, rather than hiding rows on one page.
function inboxQuery(query, { branch = '', unreviewed = false } = {}) {
  const base = String(query || 'is:open').trim() || 'is:open';
  const filters = [];
  const value = String(branch).trim();
  if (/[\r\n\x00]/.test(value) || value.length > 255) throw new Error('请输入有效的分支名称');
  if (value) filters.push('branch:' + JSON.stringify(value));
  if (unreviewed) filters.push('is:open -reviewedby:self');
  return filters.length ? `(${base}) ${filters.join(' ')}` : base;
}
module.exports = { inboxQuery };
