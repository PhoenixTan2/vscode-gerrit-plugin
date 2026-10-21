'use strict';
// Base always means the first parent of the patch set on the opposite side.
function comparisonPlan(revisions, left, right) {
  if (left === right || (left !== 'base' && !revisions[left]) || (right !== 'base' && !revisions[right])) throw new Error('请选择两个不同的有效 Patch set / Base');
  return { left, right, revision: right === 'base' ? left : right, base: left !== 'base' && right !== 'base' ? left : undefined, reverse: right === 'base' };
}
function comparisonFiles(files, reverse) {
  if (!reverse) return files;
  return Object.fromEntries(Object.entries(files).map(([path, file]) => {
    const renamed = file.status === 'R' && file.old_path;
    return [renamed ? file.old_path : path, { ...file, old_path: renamed ? path : undefined,
      status: ({ A: 'D', D: 'A', C: 'D' })[file.status] || file.status,
      lines_inserted: file.lines_deleted || 0, lines_deleted: file.lines_inserted || 0 }];
  }));
}
module.exports = { comparisonPlan, comparisonFiles };
