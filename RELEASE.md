# 本地发布检查

**中文** | [English](#english)

本轮只准备本地 VSIX，没有公开仓库，不向 Marketplace 或 Git 远程上传。保留现有 local-tools 发布者标识，不虚构 repository / homepage / issues 地址。

1. 运行 `python scripts/verify.py`，再运行 `python scripts/package.py`。
2. 运行 `python scripts/verify_host.py --vsix gerrit-workbench-1.1.3.vsix`，验证隔离的真实 VS Code 激活、页面脚本和交互。
3. 运行 `python scripts/check_release.py`，检查语言资源、双语文档、PNG 图标和包文件白名单；日志、凭据、测试与临时文件不进入安装包。
4. 只保留当前 VSIX，并记录本地 Git commit，不推送。

新增评论快捷键仅绑定只读 Gerrit diff 中的裸 C；Ctrl+C 不匹配该绑定。差异默认使用预览标签，用户可双击保留。

插件主要 API 支持 VS Code 1.95 及以上。集成浏览器命令依版本可用性检测；旧版本可能无法提供认证网页浏览，其余原生评审仍可用。英文原生命令标题跟随 VS Code 显示语言，页面和对话框由 Gerrit Language 控制。

公开发布前再确认实际 publisher ID、仓库和支持地址，并在目标 Gerrit 上验收真实评论、打分、上传和状态变更。本轮自动测试使用本地模拟服务器，不代替目标环境的写入验收。

## 1.1.3 本地验证

- 新版包在真实 VS Code 1.144.0 中激活、工作台 / 讨论 Webview、原生评论及 diff 回归通过。隔离窗口执行 1.1.2 → 1.1.3 → 1.1.2 安装 / 回退时文件指纹符合预期，设置保留，但运行实例仍为 1.1.2：免重载升级未满足，新运行实例回退兼容性未验证。安装后需重载一次窗口使新代码生效；会话过期后的自动重登不需要重载或手动连接。
- 214 项测试通过。新增身份检查自身返回 403、身份仍有效但写操作 CSRF 返回 403、缺失 / 损坏令牌、持续 403 有限重试、并发 403 共用重登、HTTP Key 隔离与双语 / 日志脱敏验证。
- 请求自动使用已保存凭据重新登录，不弹出重连界面。新会话仍被拒绝时提示具体权限 / 凭据错误；网络错误不自动重发写操作。
- 未使用真实凭据、未对内网现有提交执行写操作；现场错误根因尚未通过目标服务器日志确认，修复分支使用本地 HTTP 服务器复现验收。

## 1.1.2 本地验证

- 新版在 VS Code 1.143.1 的真实宿主与 Webview / diff 回归通过；同窗口 1.1.1 → 1.1.2 → 1.1.1 安装与回退时设置保留，但运行实例仍为 1.1.1。免重载升级未满足，新实例回退兼容性未验证，安装后需重载窗口。

- 207 项测试通过，新增过期会话、匿名身份响应、并发重登、新 CSRF、明确认证拒绝后单次重试、权限拒绝不循环、断线不重发写操作及取消检查。
- 未使用真实凭据、未对内网现有提交执行写操作。自动恢复范围为插件独立会话，不控制外部浏览器。

## 1.1.1 本地验证

- 197 项测试通过，覆盖旧评论行号映射、重命名、Base Rebase、取消、异步加载及原 PS 回复。
- VS Code 1.143.1 中新版包激活、Webview 与原生 diff 回归通过。
- 在隔离窗口执行了 1.1.0 → 1.1.1 → 1.1.0 的同窗口安装；设置保留，但运行代码仍为 1.1.0。**免重载升级尚未通过，新运行实例的回退兼容性也尚未验证。** 安装此包后需重载窗口；干净宿主通过不代表有状态升级通过。
- 可用 `python scripts/verify_update.py --previous <上一版.vsix> --vsix gerrit-workbench-1.1.1.vsix` 复验；旧包放在工作区外临时目录。退出码 2 表示免重载验收未满足。没有修改内网现有 Gerrit 提交。

## 1.1.0 本地验证

本批追加当前用户评分预选 / 重复点击无操作、卡片直接进入讨论、评论状态默认折叠与分类计数、详情状态色及宽窄视口右侧组合窗验证。

本批追加验证页面内人员/组补全、直接评分、浮动栏防遮挡、Edit 任意方向比较、废弃后重开、负分与 WIP 色彩区分；可合入状态保留服务端判断。

本批版本号不变。原生 Edit diff 验证覆盖只读 Base、右侧编辑、多文件保存到同一服务器草稿后统一发布一次，以及发布后的只读会话。冲突检查、持久化折叠、Rebase 和无确认弹窗流程均有回归测试。没有对内网既有提交执行写入验收。

- `python scripts/verify.py`：190 项测试通过，覆盖远端分支、读取取消、候选过期响应、评审人员权限、组添加、直接删除和双语入口。
- `python scripts/package.py` 与 `python scripts/check_release.py`：通过，只保留当前 Gerrit Workbench VSIX。
- `python scripts/verify_host.py --vsix gerrit-workbench-1.1.1.vsix --viewer-vsix <第三方查看器.vsix>`：隔离宿主通过，VS Code 1.143.1 + Excel Viewer 4.2.58；有效旧、新 XLSX 原文件分别交给自定义编辑器，在两个组中使用预览标签打开。第三方扩展仅装入临时测试环境，不加入本插件依赖或 VSIX。
- Excel 集成验证覆盖 XLSX 的原字节、编辑器类型和分屏打开，不覆盖所有 Excel 格式或复杂公式 / 图表的视觉正确性。本机截图运行环境不可用，未声明完成截图验收。
- `engines.vscode` 保持 `^1.95.0`；没有提高最低版本。本轮未对内网现有提交执行添加或移除评审人员的写操作。

---

## English

## 1.1.0 local validation

Additional coverage: current-account score preselection/no-op reselect, direct card navigation, state-based comment folding/counts, detail badge colors and right-centred combined windows at wide/narrow widths.

Additional checks cover inline reviewer/group suggestions, direct scores, right-centred window geometry, bidirectional Edit comparisons, restart after discard, distinct WIP/negative colors and server-authoritative submission eligibility.

The version is unchanged for this batch. Native Edit integration covers immutable Base, writable right side, multiple files saved to one server draft and published once, and a retired read-only session. Regression tests cover conflict checks, persistent folding, Rebase and operations without confirmation popups. No write acceptance test was performed against existing intranet changes.

- `python scripts/verify.py`: 190 passing tests covering remote branch selection, cancellation, stale suggestions, ownership, group confirmation, vote-removal warnings and bilingual controls.
- `python scripts/package.py` and `python scripts/check_release.py`: passed; retain only the current Gerrit Workbench VSIX.
- `python scripts/verify_host.py --vsix gerrit-workbench-1.1.1.vsix --viewer-vsix <third-party-viewer.vsix>`: passed in an isolated VS Code 1.143.1 host with Excel Viewer 4.2.58. Valid old/new XLSX snapshots opened as custom-editor preview tabs in two groups. The viewer is installed only in the temporary test profile, not bundled or required by this extension.
- Excel integration checks exact bytes, editor type and split opening for XLSX, not every Excel format or visual correctness of complex formulas/charts. The screenshot runtime was unavailable; visual screenshot acceptance is not claimed.
- Keep `engines.vscode` at `^1.95.0`. The minimum supported version is unchanged. No reviewer write operations were performed against existing intranet changes.


[返回中文 / Back to Chinese](#本地发布检查)

This delivery is a local VSIX only. No public repository, Marketplace upload or Git push is configured. Keep the current local-tools publisher identity; do not invent repository, homepage or issue URLs.

1. Run `python scripts/verify.py`, followed by `python scripts/package.py`.
2. Run `python scripts/verify_host.py --vsix gerrit-workbench-1.1.1.vsix` to exercise an isolated real VS Code host and Webview workflows.
3. Run `python scripts/check_release.py` to check localization, bilingual documents, PNG icon and archive allowlisting. Exclude logs, credentials, tests and temporary files.
4. Retain only the current VSIX and record one local Git commit. Do not push.

The comment shortcut binds bare C only in read-only Gerrit diffs. Ctrl+C does not match it. Comparisons use preview tabs; users can double-click a tab to keep it.

Core APIs target VS Code 1.95 or later. Integrated-browser commands are detected at runtime; older versions may not support authenticated web browsing, while native review workflows remain available. Native contribution titles follow the VS Code display language; Gerrit Language controls views/dialogs.

Before any future public release, confirm the real publisher ID, repository and support URLs, and acceptance-test real comments, votes, uploads and state changes against the target Gerrit. Current automated checks use local fixtures and do not replace write-operation acceptance testing.
