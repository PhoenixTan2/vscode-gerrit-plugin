# Gerrit Workbench

在 VS Code 中完成 Gerrit 连接、提交、代码评审、评论、回复、评分和变更管理。常用功能通过侧边栏、编辑器按钮和右键菜单操作，无需 Ctrl+Shift+P。

## 安装与连接

在扩展面板 `…` → **从 VSIX 安装**，选择 `gerrit-workbench-0.3.2.vsix`。点击左侧 Gerrit Workbench 图标连接服务器。该入口与其他 Gerrit 插件相互独立；若活动栏未显示，可右键活动栏勾选 Gerrit Workbench，或点击状态栏 Gerrit 打开。支持服务器根地址、`/gerrit` 部署前缀及直接粘贴 `/dashboard/self` 地址。

认证方式：

- **HTTP Key / HTTP 密码**：使用 Gerrit Settings → HTTP Credentials 中生成的 Key，通过 `/a/` API 认证。
- **网页登录密码（HTTP 反向代理）**：使用网页登录密码，通过同站 `/login/` 建立 Gerrit 会话。写操作携带 `X-Gerrit-Auth`。

密码仅保存在 VS Code SecretStorage；Cookie 和会话令牌保存在内存。需要跨站浏览器交互的 SSO / OAuth 尚不支持。HTTPS 保留证书校验；当前不提供独立的代理配置。

## 操作入口

| 功能 | 使用方法 |
| --- | --- |
| 筛选变更 | Open、Merged、与我相关、我的提交、待我评审，以及 Gerrit 查询框；默认 Open，按最后更新时间从新到旧显示 |
| 时间与 Commit 信息 | 提交卡片显示最后更新；详情和讨论页显示最后更新与提交时间。Commit 信息显示完整消息、SHA、Change-Id、作者和父提交 |
| 独立评审讨论 | 详情“打开评审讨论”，在当前编辑器组打开标签页，包含所有 Patch set 的讨论、评分和活动记录 |
| 任意版本比较 | 在版本比较中选择左右 PS / Base，支持交换左右；Base 表示另一侧 PS 的第一父提交 |
| 单个 Patch 单文件代码 | 在“单个 Patch”中选择 PS，点击“浏览此 Patch”，先展示此 PS 的改动文件，打开普通代码编辑器完整查看，不使用左右对比；服务器端路径搜索可查找其他文件，服务器可能限制每次结果数量，可缩小关键词 |
| SSH 下载 | “下载到本地” → 下载目标分支，或将当前浏览的 PS 下载到独立本地分支。选择父目录和新目录名称，不覆盖已有目录 |
| 新建代码评论 | 打开代码或 diff，选中行 / 多行 → 右键“评论所选代码行”，展开行内输入框；也可点行号旁的 `+` 或编辑器评论按钮 |
| 查找文件评论 | 橙色行号图标、行末评论数、滚动条标记；编辑器右上角提供“上一处评论”“下一处评论”“本文件评论位置” |
| 评论悬停 / 定位 | 悬停代码预览评论；讨论页“定位到代码”直接打开对应 PS 的完整文件并定位行号 |
| 评论筛选 | 讨论页支持“仅显示未解决”和“有我参与”，后者保留自己曾回复过的完整线程，可组合筛选 |
| 发布评审与打分 | 在讨论页填写整体意见，选择实际有权限的标签分数，点击“发布评审”；未选的评分不修改 |
| 回复 | 在代码线程中发布回复，或在讨论页线程下的多行文本框回复 |
| 发布 / 废弃 / 合入 | 自己的 WIP 可发布为待评审；可废弃自己的提交；有 submit 权限且服务器允许时可合入目标分支 |
| 设置 / 调试输出 | 仅保留 Gerrit 侧边栏右上角的齿轮和输出小按钮，不在页面正文重复显示 |

行评论与回复绑定实际所在的 PS / Base。整体评审与评分针对页面注明的最新 PS。评论、回复、评分立即发布；整体评审和线程回复保留本地输入草稿，不自动发布服务器已有的其他草稿。暂不支持编辑评论解决状态。

## SSH 下载与上传

下载读取 Gerrit 提供的 SSH URL（包括用户名、端口和项目路径），使用本机 OpenSSH 的配置、SSH key / agent，以 BatchMode 执行，避免后台等待密码。需要预先在 Gerrit 中添加 SSH 公钥，并在本机建立对应的 known_hosts 信任；插件不自动接受主机指纹，也不下载或保存私钥。

下载目标分支时浅克隆该分支。下载指定 PS 时，在新目录浅克隆目标分支，再 fetch `refs/changes/...`，验证 SHA 后创建 `review/<变更号>-<PS>` 本地分支。失败时保留已建立的下载目录供检查，不删除用户文件。SSH 下载不使用 HTTP 密码或 HTTP Key。

上传入口为侧边栏“上传本地提交”或源代码管理的云上传按钮。可提交已暂存内容后上传，也可只上传已有 HEAD；不自动暂存、不强推、不自动修改已有提交。先 fetch 目标分支、检查整组待上传 commit 的 Change-Id，再确认 remote 与 commit 清单。上传使用 `refs/for/<branch>`，支持 WIP；Gerrit submit 合入为独立操作。

初次使用 Gerrit 的仓库请按服务器的 **Clone with commit-msg hook** 说明安装 hook。缺少 Change-Id 时，安装后通过终端 amend 对应 commit，再上传。

## 内置浏览器

网页入口使用 VS Code **集成浏览器**。为解决反向代理 HTTP Basic 登录的 401，插件在 `127.0.0.1` 的随机端口建立认证桥接，以一次性入口票据建立本地 HttpOnly 会话，再把请求转发到已连接的固定 Gerrit 站点。密码和上游会话 Cookie 不写入网址或 HTML。

桥接拒绝未认证、伪造 Host 和跨站请求；写操作保留 Gerrit 的 XSRF 验证。切换账号、断开连接或插件退出时关闭桥接。HTTP Key 模式下网页若需要网页登录密码，会单独询问，不替换已保存的 HTTP Key。

需要提供集成浏览器命令的新版 VS Code。旧版 Simple Browser 的 iframe 对认证和 Cookie 存在限制，因此不再回退到它；旧版 VS Code 仍可使用原生代码与评审功能。

## 扩展设置与输出

点击侧边栏右上角齿轮打开本扩展设置：

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `gerrit.defaultQuery` | `is:open` | 默认查询 |
| `gerrit.pageSize` | 50 | 每页 10–100 条 |
| `gerrit.requestTimeout` | 30000 | HTTP 超时毫秒数 |
| `gerrit.commitInfo.defaultExpanded` | false | Commit 信息默认展开 / 收起 |
| `gerrit.comments.expandThreads` | false | 默认展开代码评论线程 |
| `gerrit.diff.openBeside` | false | 文件 diff 是否打开在旁边的编辑器组 |
| `gerrit.logLevel` | `info` | off / error / info / debug |

评论标记颜色可通过 VS Code `workbench.colorCustomizations` 中的 `gerrit.commentMarker` 定制。

右上角输出按钮打开 **输出 → Gerrit Workbench**。日志记录请求方法、路径、状态、耗时和 Git 操作结果，不记录认证头、Cookie、请求 / 响应正文；已知凭据和常见敏感字段脱敏。日志仍包含服务器和项目路径，分享前可自行隐藏。

## 开发、打包与提交

要求 VS Code 1.95+ 和 Git；内置网页需要支持集成浏览器的较新版本。项目使用 CommonJS 和 Node 内置库，无运行时第三方依赖，无需 npm install。打开本项目按 F5 可启动 Extension Development Host。

```sh
python scripts/verify.py
python scripts/verify_host.py
python scripts/package.py
```

也可使用独立 Node.js 执行 `npm run check` 和 `npm test`。Python 验证脚本在缺少独立 Node 时借用 VS Code 内置 Node。

打包脚本先生成并校验新包，再清理本项目旧版本 VSIX，工作区仅保留一版安装包。每批完成的修改创建一笔本地 Git commit，不自动推送；详见 AGENTS.md。

测试覆盖认证会话、CSRF、浏览器桥接和跨站防护、版本比较、历史评论位置、完整 Patch 读取、SSH 下载引用与 SHA 校验、目录保护、Windows 长路径、评论导航、时间排序、输入草稿和日志脱敏。内网已验证网页与脚本资源返回 200、Patch 改动文件及任意路径搜索，以及 SSH 分支读取与指定 PS 克隆 / fetch / checkout。原生界面完整交互和发布操作仍需实际 Extension Host 验收。

API 依据：[Gerrit Changes REST API](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html)、[上传评审](https://gerrit-review.googlesource.com/Documentation/user-upload.html)、[VS Code API](https://code.visualstudio.com/api/references/vscode-api)。
