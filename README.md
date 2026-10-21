# Gerrit Workbench

在 VS Code 中完成 Gerrit 连接、提交、代码评审、评论、回复、评分和变更管理。常用功能通过侧边栏、编辑器按钮和右键菜单操作，无需 Ctrl+Shift+P。

## 安装与连接

在扩展面板 `…` → **从 VSIX 安装**，选择 `gerrit-workbench-0.10.0.vsix`。点击左侧 Gerrit Workbench 图标连接服务器。该入口与其他 Gerrit 插件相互独立；若活动栏未显示，可右键活动栏勾选 Gerrit Workbench，或点击状态栏 Gerrit 打开。支持服务器根地址、`/gerrit` 部署前缀及直接粘贴 `/dashboard/self` 地址。

认证方式：

- **HTTP Key / HTTP 密码**：使用 Gerrit Settings → HTTP Credentials 中生成的 Key，通过 `/a/` API 认证。
- **网页登录密码（HTTP 反向代理）**：使用网页登录密码，通过同站 `/login/` 建立 Gerrit 会话。写操作携带 `X-Gerrit-Auth`。

密码仅保存在 VS Code SecretStorage；Cookie 和会话令牌保存在内存。需要跨站浏览器交互的 SSO / OAuth 尚不支持。HTTPS 保留证书校验；当前不提供独立的代理配置。

## 操作入口

| 功能 | 使用方法 |
| --- | --- |
| 筛选变更 | Open（含可见 WIP）、Merged、Abandoned、与我相关、我的提交，以及 Gerrit 查询框；默认 Open，按最后更新时间从新到旧显示 |
| 友好搜索 | Message、Repo、Branch、Owner 四个输入框自动组合查询。Repo / Branch 按名称限定范围，Owner 支持用户名、邮箱或 self；保留“仅我未评审”开关 |
| Message 模糊匹配 | 输入普通关键词，自动转为忽略大小写的包含正则，无需手写语法；匹配标题、历史 Commit 信息、整体评论、所有 PS 的行内评论、Change-Id / 提交号 / SHA。例如 test 可找到 TEST 和 test2 |
| 搜索进度与高级条件 | Message 搜索在后台跨分页执行，显示检查 / 命中数并可停止；边检索边显示卡片，进入评审后后台继续；返回列表使用缓存，点击搜索、重置或刷新才重新检索。失败和停止会保留部分结果并标明未完成。“高级条件与生成的 Gerrit 查询”中可查看原生范围及提交说明查询，或编辑原始条件 |
| 状态与评审标记 | `NEW` 显示为“评审中”，表示尚未关闭或合入；Open 卡片分别标出“我已评审”“我未评审”，与是否已合入是两个维度；左边框用蓝色表示评审中、橙色表示 WIP、绿色表示已合入、红色表示已废弃 |
| 时间与 Commit 信息 | 提交卡片显示最后更新；详情和讨论页依次显示创建时间、最后更新时间，统一为本地时区的 `YYYY-MM-DD HH:mm:ss`。Commit 信息紧跟最后更新时间，显示完整消息、SHA、Change-Id、作者和父提交 |
| 独立评审讨论 | 详情“打开评审讨论”，在当前编辑器组打开标签页，包含所有 Patch set 的讨论、评分和活动记录；代码讨论可折叠并记住状态，收起时单行显示评论首行，活动记录收起时也显示首行 |
| 按检索结果导航 | 工作台详情和评审讨论均提供“上一条 / 下一条”，按当前检索顺序切换，支持跨页并复用结果缓存；当前变更不在检索结果中时禁用 |
| 父子提交导航 | 预先查询父 SHA，仅关联可见 Gerrit 变更时显示直达链接，优先当前分支；准确打开父 SHA 所在 PS。父提交路径仅提供“返回子提交”，支持多级返回并恢复比较及代码浏览状态，保留检索结果；父 SHA 无关联或查询失败时只显示文本 |
| 历史 PS | Commit 信息、比较与默认代码浏览定位所查看 PS；最新评分明确标注，历史 PS 需点击“切换到最新 PS 评审”才可发布整体评审或操作整笔变更；行内回复保留原 PS |
| 元信息跳转检索 | 点击作者、提交者、仓库、分支或 Owner 回到检索页，清除旧筛选并显示对应结果；作者 / 提交者按 Commit 身份检索，分支同时限定仓库 |
| 任意版本比较 | 仅在左侧工作台选择左右 PS / Base，左右选项排除另一侧已选版本，选择变化后自动比较，支持立即交换左右；Base 表示另一侧 PS 的第一父提交。改动文件统一在下方面板查看 |
| 修改文件面板 | 打开变更或执行比较后，下方“Gerrit 文件”面板列出全部修改文件；支持路径筛选、增删行数和各 PS 评论总数，点击文件在编辑器中打开对应 diff。可点击底部“Gerrit 文件”页签展开面板 |
| Relation chain | 工作台和评审页始终以折叠栏显示关系链，进入变更后即后台加载所查看 PS 的依赖 / 后继提交，展开仅控制显示；`gerrit.relationChain.defaultExpanded` 控制默认展开或收起（默认收起），当前变更内保留手动折叠状态。显示状态、SHA、PS 及父提交；提示旧 PS，点击有变更编号的节点打开该变更最新 PS。无变更编号的 Git 提交仅展示 |
| 非文本文件 | 先读取原始字节并尝试 UTF-8 / UTF-16 解码，不因 Gerrit 的 binary 标记直接拒绝。能解码为文本则使用原生 diff；其他格式仅缓存只读原文件，再由 VS Code 在旧版 / 新版两个编辑器组尝试打开，具体预览能力取决于已安装的文件扩展。新增 / 删除侧显示不存在提示 |
| 单个 Patch 单文件代码 | 在“单个 Patch”中选择 PS 后自动展示此 PS 的改动文件，打开普通代码编辑器完整查看，不使用左右对比；只搜索所选 PS 的文件路径，不搜索代码正文或工作区未提交内容。忽略大小写，在已打开的对应仓库中读取所选 PS 的完整 Git 路径并缓存；本地缺少该版本时通过 SSH 后台 fetch 对象，不切换分支，也不改动文件和 FETCH_HEAD。首次搜索需要对应项目的本地仓库；无需先执行下载 |
| SSH 下载 | 评审页“代码与下载”选择 PS → “下载到本地”，在已打开的对应项目仓库中后台 fetch / checkout，不选择目录、不 clone |
| 新建代码评论 | 打开代码或 diff，选中行 / 多行 → 右键“评论所选代码行”，展开行内输入框；也可点行号旁的 `+` 或编辑器评论按钮 |
| 查找文件评论 | 橙色行号图标、行末评论数、滚动条标记；编辑器右上角提供“上一处评论”“下一处评论”“本文件评论位置” |
| 评论悬停 / 定位 | 悬停代码预览评论；讨论页“定位到代码”直接打开对应 PS 的完整文件并定位行号 |
| Markdown 讨论与回复 | 讨论和活动记录支持 Markdown 标题、列表、代码块、表格和链接。整体评审与回复草稿点击进入编辑，移开焦点显示预览；点击发布才发送原始文本 |
| 评论筛选 | 讨论页支持“仅显示未解决”和“有我参与”，后者保留自己曾回复过的完整线程，可组合筛选 |
| 发布评审与打分 | 在讨论页填写整体意见，选择实际有权限的标签分数，点击“发布评审”；未选的评分不修改；当前评分位于发布表单上方，随页面正常滚动 |
| 回复 | 在代码线程中发布回复，或在讨论页线程下的多行文本框回复 |
| 发布 / 废弃 / 合入 | 自己的 WIP 可发布为待评审；可废弃自己的提交；有 submit 权限且服务器允许时可合入目标分支 |
| 设置 / 调试输出 | 仅保留 Gerrit 侧边栏右上角的齿轮和输出小按钮，不在页面正文重复显示 |

行评论与回复绑定实际所在的 PS / Base。整体评审与评分针对页面注明的最新 PS。评论、回复、评分立即发布；整体评审和线程回复保留本地输入草稿，不自动发布服务器已有的其他草稿。暂不支持编辑评论解决状态。

“我已评审”使用 Gerrit 的 `REVIEWED` / `reviewedby:self` 语义：自己在作者最近一次更新之后发布过评论或评分。仅打开代码不会自动标记；作者再次更新后会重新归入未评审。这与他人是否已经评分、文件级“已读”是不同概念。分支筛选可与预设或自定义查询组合；切换 Merged 会清除仅 Open 有效的未评审开关。

Message 的评论包含匹配由插件补充：Gerrit 原生评论索引没有同等的正则包含语义，因此会先按状态、Repo、Branch、Owner 限定范围，再跨分页读取 Commit / 评审记录和必要的行内评论，最多并发四个评论请求。范围较大时可先填 Repo / Branch 缩小搜索。查询采用已登录账号的可见范围，不进行代码正文或文件内容全文检索。

原文件缓存保留字节、扩展名及旧 / 新 / PS 目录标识，位于系统临时目录，不写进代码仓库。插件退出时尝试清理缓存；不内置 PDF、Excel 等格式的阅读器，也不安装文件查看扩展。

## SSH 下载与上传

下载读取 Gerrit 提供的 SSH URL（包括用户名、端口和项目路径），使用本机 OpenSSH 的配置、SSH key / agent，以 BatchMode 执行，避免后台等待密码。需要预先在 Gerrit 中添加 SSH 公钥，并在本机建立对应的 known_hosts 信任；插件不自动接受主机指纹，也不下载或保存私钥。

先在 VS Code 打开对应项目的本地 Git 仓库（remote 路径须匹配 Gerrit 项目）。评审页“代码与下载”选择 PS 后，后台执行 `git fetch <SSH URL> refs/changes/...`，验证 FETCH_HEAD 与所选 PS 的 SHA 一致，再执行 `git -c core.longpaths=true checkout -b change-<变更号> <SHA>`。无需选择父目录或新建目录；多个匹配仓库时只需选择仓库。

下载前和 checkout 前检查未提交文件、未保存编辑器和已有分支。已有同名分支时会提示先重命名或删除，不自动覆盖、stash 或强制切换。同一仓库的插件下载 / 上传不会并发执行；其他浏览和评审操作可继续使用。下载阶段、结果及失败原因显示在代码页和输出频道，完成通知无需关闭即可继续使用插件。SSH 下载不使用 HTTP 密码或 HTTP Key。

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

活动栏使用独立的评审气泡勾选图标，扩展列表显示彩色插件图标。

## 开发、打包与提交

要求 VS Code 1.95+ 和 Git；内置网页需要支持集成浏览器的较新版本。核心使用 CommonJS 和 Node 内置库；Markdown 库离线打包，无需 npm install。打开本项目按 F5 可启动 Extension Development Host。

```sh
python scripts/verify.py
python scripts/verify_host.py
python scripts/package.py
```

也可使用独立 Node.js 执行 `npm run check` 和 `npm test`。Python 验证脚本在缺少独立 Node 时借用 VS Code 内置 Node。

打包脚本先生成并校验新包，再清理本项目旧版本 VSIX，工作区仅保留一版安装包。每批完成的修改创建一笔本地 Git commit，不自动推送；详见 AGENTS.md。

测试覆盖认证会话、CSRF、浏览器桥接和跨站防护、版本比较、历史评论位置、完整 Patch 读取、SSH 下载引用与 SHA 校验、本地修改和已有分支保护、后台任务完成与重试、Windows 长路径、评论导航、时间排序、输入草稿和日志脱敏。内网已验证网页与脚本资源返回 200、Patch 改动文件及任意路径搜索，以及 SSH 分支读取与指定 PS 克隆 / fetch / checkout。真实 Extension Host 检查侧栏脚本渲染，以及评审页讨论 / 代码页签、文件与下载入口、底部修改文件视图、评分区滚动不重叠和草稿保留；服务器写入操作仍需实际账号验收。

评审标记与关系链依据：[Gerrit 3.8.5 REVIEWED](https://gerrit-documentation.storage.googleapis.com/Documentation/3.8.5/rest-api-changes.html#reviewed)、[Related Changes](https://gerrit-documentation.storage.googleapis.com/Documentation/3.8.5/rest-api-changes.html#get-related-changes)。

API 依据：[Gerrit Changes REST API](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html)、[上传评审](https://gerrit-review.googlesource.com/Documentation/user-upload.html)、[VS Code API](https://code.visualstudio.com/api/references/vscode-api)。

Markdown 渲染使用离线打包的 markdown-it 15.0.3（MIT），许可证位于 media/vendor/markdown-it.LICENSE。
