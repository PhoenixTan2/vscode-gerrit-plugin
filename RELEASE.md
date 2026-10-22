# 本地发布检查

**中文** | [English](RELEASE.en.md)

本轮只准备本地 VSIX，没有公开仓库，不向 Marketplace 或 Git 远程上传。保留现有 local-tools 发布者标识，不虚构 repository / homepage / issues 地址。

1. 运行 `python scripts/verify.py`，再运行 `python scripts/package.py`。
2. 运行 `python scripts/verify_host.py --vsix gerrit-workbench-0.15.0.vsix`，验证隔离的真实 VS Code 激活、页面脚本和交互。
3. 运行 `python scripts/check_release.py`，检查语言资源、双语文档、PNG 图标和包文件白名单；日志、凭据、测试与临时文件不进入安装包。
4. 只保留当前 VSIX，并记录本地 Git commit，不推送。

新增评论快捷键仅绑定只读 Gerrit diff 中的裸 C；Ctrl+C 不匹配该绑定。差异默认使用预览标签，用户可双击保留。

插件主要 API 支持 VS Code 1.95 及以上。集成浏览器命令依版本可用性检测；旧版本可能无法提供认证网页浏览，其余原生评审仍可用。英文原生命令标题跟随 VS Code 显示语言，页面和对话框由 Gerrit Language 控制。

公开发布前再确认实际 publisher ID、仓库和支持地址，并在目标 Gerrit 上验收真实评论、打分、上传和状态变更。本轮自动测试使用本地模拟服务器，不代替目标环境的写入验收。
