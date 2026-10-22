# 本地发布检查

**中文** | [English](#english)

本轮只准备本地 VSIX，没有公开仓库，不向 Marketplace 或 Git 远程上传。保留现有 local-tools 发布者标识，不虚构 repository / homepage / issues 地址。

1. 运行 `python scripts/verify.py`，再运行 `python scripts/package.py`。
2. 运行 `python scripts/verify_host.py --vsix gerrit-workbench-1.0.0.vsix`，验证隔离的真实 VS Code 激活、页面脚本和交互。
3. 运行 `python scripts/check_release.py`，检查语言资源、双语文档、PNG 图标和包文件白名单；日志、凭据、测试与临时文件不进入安装包。
4. 只保留当前 VSIX，并记录本地 Git commit，不推送。

新增评论快捷键仅绑定只读 Gerrit diff 中的裸 C；Ctrl+C 不匹配该绑定。差异默认使用预览标签，用户可双击保留。

插件主要 API 支持 VS Code 1.95 及以上。集成浏览器命令依版本可用性检测；旧版本可能无法提供认证网页浏览，其余原生评审仍可用。英文原生命令标题跟随 VS Code 显示语言，页面和对话框由 Gerrit Language 控制。

公开发布前再确认实际 publisher ID、仓库和支持地址，并在目标 Gerrit 上验收真实评论、打分、上传和状态变更。本轮自动测试使用本地模拟服务器，不代替目标环境的写入验收。


---

## English

[返回中文 / Back to Chinese](#本地发布检查)


This delivery is a local VSIX only. No public repository, Marketplace upload or Git push is configured. Keep the current local-tools publisher identity; do not invent repository, homepage or issue URLs.

1. Run `python scripts/verify.py`, followed by `python scripts/package.py`.
2. Run `python scripts/verify_host.py --vsix gerrit-workbench-1.0.0.vsix` to exercise an isolated real VS Code host and Webview workflows.
3. Run `python scripts/check_release.py` to check localization, bilingual documents, PNG icon and archive allowlisting. Exclude logs, credentials, tests and temporary files.
4. Retain only the current VSIX and record one local Git commit. Do not push.

The comment shortcut binds bare C only in read-only Gerrit diffs. Ctrl+C does not match it. Comparisons use preview tabs; users can double-click a tab to keep it.

Core APIs target VS Code 1.95 or later. Integrated-browser commands are detected at runtime; older versions may not support authenticated web browsing, while native review workflows remain available. Native contribution titles follow the VS Code display language; Gerrit Language controls views/dialogs.

Before any future public release, confirm the real publisher ID, repository and support URLs, and acceptance-test real comments, votes, uploads and state changes against the target Gerrit. Current automated checks use local fixtures and do not replace write-operation acceptance testing.
