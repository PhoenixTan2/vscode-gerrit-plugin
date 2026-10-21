'use strict';
function field(value, name, limit = 255) {
  const text = String(value || '').trim();
  if (/[\r\n\x00]/.test(text) || text.length > limit) throw new Error(`请输入有效的 ${name}（最多 ${limit} 字符）`);
  return text;
}
function inboxQuery(query, { repo = '', branch = '', owner = '', unreviewed = false } = {}) {
  const base = String(query || 'is:open').trim() || 'is:open';
  const filters = [];
  for (const [operator, value, label] of [['project', repo, 'repo'], ['branch', branch, '分支'], ['owner', owner, 'Owner']]) {
    const text = field(value, label); if (text) filters.push(operator + ':' + JSON.stringify(text));
  }
  if (unreviewed) filters.push('is:open -reviewedby:self');
  return filters.length ? `(${base}) ${filters.join(' ')}` : base;
}
const escapeRegex = value => value.replace(/[\\.\[\]{}()*+?^$|"@#&~<>-]/g, '\\$&');
function fuzzyPattern(value) {
  return '^.*' + [...field(value, 'message', 200)].map(c => {
    const lower = c.toLowerCase(), upper = c.toUpperCase();
    return lower !== upper && [...lower].length === 1 && [...upper].length === 1 ? `[${escapeRegex(lower)}${escapeRegex(upper)}]` : escapeRegex(c);
  }).join('') + '.*';
}
function searchPlan(query, fields = {}) {
  const message = field(fields.message, 'message', 200);
  const scope = inboxQuery(query, fields);
  return { scope, message, commitQuery: message ? `(${scope}) message:${JSON.stringify(fuzzyPattern(message))}` : scope };
}
function matchesChange(change, message, comments = {}) {
  const needle = message.toLowerCase();
  const values = [change.subject, change.change_id, String(change._number || ''), ...(change.messages || []).map(m => m.message)];
  for (const [sha, rev] of Object.entries(change.revisions || {})) values.push(sha, rev.commit?.message);
  for (const [path, list] of Object.entries(comments)) for (const comment of list) values.push(comment.message);
  return values.some(value => typeof value === 'string' && value.toLowerCase().includes(needle));
}
async function scanChanges(api, plan, { cancelled = () => false, progress = () => {} } = {}) {
  const found = new Map(), commitHits = new Set(); let offset = 0, scanned = 0, failed = false;
  const stopped = () => failed || cancelled();
  // Run the generated native regex, then supplement it with complete scoped comments.
  for (let start = 0; !stopped();) {
    const rows = await api.list(plan.commitQuery, start);
    for (const row of rows) commitHits.add(row.id);
    if (!rows.length || !rows.at(-1)._more_changes) break;
    start += rows.length;
  }
  while (!stopped()) {
    const rows = await api.list(plan.scope, offset, { search: true });
    if (stopped()) return null;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (next < rows.length && !stopped()) {
        const change = rows[next++];
        let matches = commitHits.has(change.id) || matchesChange(change, plan.message);
        if (!matches) matches = matchesChange(change, plan.message, await api.allComments(change.id));
        if (stopped()) return;
        if (matches) found.set(change.id, change);
        progress({ scanned: ++scanned, matches: found.size });
      }
    }).map(promise => promise.catch(error => { failed = true; throw error; })));
    if (stopped()) return null;
    if (!rows.length || !rows.at(-1)._more_changes) break;
    offset += rows.length;
  }
  if (stopped()) return null;
  return [...found.values()].sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
}
module.exports = { inboxQuery, fuzzyPattern, searchPlan, matchesChange, scanChanges };
