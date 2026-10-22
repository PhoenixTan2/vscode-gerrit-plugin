'use strict';
// Native Comments opens a resource with a command-driven selection. Match only our
// registered thread ranges; ordinary cursor movement and explicit file opens are not navigation.
function nativeCommentTarget(vscode, event, threads, activation = false) {
  if (!activation && event?.kind !== vscode.TextEditorSelectionChangeKind.Command) return;
  const uri = event.textEditor?.document.uri, selection = event.selections?.[0];
  if (!uri || !selection) return;
  const tab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  if (!tab?.input?.uri || tab.input.uri.toString() !== uri.toString()) return;
  for (const [thread, info] of threads) {
    if (!thread.comments.length || !info.commentIds?.length || info.path?.startsWith('/') || thread.uri.toString() !== uri.toString()) continue;
    const range = thread.range;
    const matches = range ? ['start','end'].every(end => ['line','character'].every(part => selection[end][part] === range[end][part]))
      : selection.start.line === 0 && selection.start.character === 0 && selection.end.line === 0 && selection.end.character === 0;
    if (matches) return { info, commentId: info.commentIds[0], tab };
  }
}
module.exports = {nativeCommentTarget};
