'use strict';
const {tr} = require('./i18n');
// One cancellable native picker; late responses never replace newer suggestions.
function pickSuggestion(vscode, { title, placeholder, value = '', load, debounce = 180 }) {
  const picker = vscode.window.createQuickPick();
  picker.title = title; picker.placeholder = placeholder; picker.ignoreFocusOut = true;
  picker.matchOnDescription = true; picker.matchOnDetail = true;
  return new Promise(resolve => {
    let timer, controller, sequence = 0, done = false;
    const subscriptions = [];
    const finish = item => {
      if (done) return; done = true; clearTimeout(timer); controller?.abort();
      for (const subscription of subscriptions) subscription.dispose();
      picker.dispose(); resolve(item);
    };
    const update = (query, delay = debounce) => {
      clearTimeout(timer); controller?.abort(); controller = new AbortController();
      const signal = controller.signal, current = ++sequence;
      picker.items = []; picker.busy = true;
      timer = setTimeout(async () => {
        try {
          const items = await load(query, signal);
          if (!done && current === sequence) { picker.items = items; picker.busy = false; }
        } catch (error) {
          if (!done && current === sequence && !signal.aborted) {
            picker.items = [{ label: tr('$(error) 加载失败，请修改输入后重试'), detail: error.message, alwaysShow: true }]; picker.busy = false;
          }
        }
      }, delay);
    };
    subscriptions.push(picker.onDidChangeValue(query => update(query)),
      picker.onDidAccept(() => { const item = picker.selectedItems[0]; if (item?.value !== undefined && !picker.busy) finish(item.value); }),
      picker.onDidHide(() => finish(undefined)));
    picker.value = value; update(value, 0); picker.show();
  });
}
function remoteBranches(output) {
  return [...new Set(output.split(/\r?\n/).map(line => /^[0-9a-f]+\s+refs\/heads\/(.+)$/.exec(line)?.[1]).filter(Boolean))].sort();
}
async function chooseBranch(vscode, runGit, cwd, remote) {
  const controller = new AbortController();
  const output = await vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: tr('读取远端分支…'), cancellable: true}, async (_, token) => {
    const subscription = token.onCancellationRequested(() => controller.abort());
    try { return await runGit(cwd, ['ls-remote', '--heads', '--', remote], {sshNonInteractive: true, signal: controller.signal}); }
    catch (error) { if (!controller.signal.aborted) throw error; }
    finally { subscription.dispose(); }
  });
  if (controller.signal.aborted) return;
  const branches = remoteBranches(output);
  if (!branches.length) throw new Error(tr('远端没有可用分支'));
  const local = await runGit(cwd, ['branch', '--show-current']);
  return pickSuggestion(vscode, {
    title: tr('选择 Gerrit 目标分支'), placeholder: tr('输入以筛选远端现有分支（忽略大小写）'),
    value: branches.includes(local) ? local : '', debounce: 0,
    load: async query => branches.filter(branch => branch.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => Number(b === local) - Number(a === local) || a.localeCompare(b))
      .map(branch => ({ label: branch, description: branch === local ? tr('当前本地分支') : '', value: branch, alwaysShow: true }))
  });
}
module.exports = { pickSuggestion, remoteBranches, chooseBranch };
