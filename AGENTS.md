# 项目工作约定

- 每批功能修改完成后运行 `python scripts/verify.py`，再运行 `python scripts/package.py`。
- 工作区只保留当前版本的 Gerrit Workbench VSIX。打包脚本验证新包后删除本项目旧版本包，不处理其他产物。
- 每次完成用户要求的一批修改，直接创建一笔本地 Git commit，说明实际改动和验证结果；未经要求不推送。
- 不把账号密码、HTTP Key、Cookie 或登录令牌写进源码、测试数据、文档、日志或 Git 提交。
