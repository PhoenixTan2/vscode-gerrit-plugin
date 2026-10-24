# 更新记录

**中文** | [English](#english)

## 1.1.0

- 本批仍为 1.1.0：评审人员/组改为页面内输入补全与直接删除，评分改为分值按钮，评审表单侧栏随滚动并避免遮挡。
- 比较版本加入已保存 Edit，可与任意 PS / Base 双向查看；增加整份 Edit 废弃及同 PS 再编辑，未保存内容保护。
- 自己的 Open / WIP 固定提供 Rebase，操作由服务器验证。
- 负分统一橙色、WIP 棕色；“可合入”以服务器判断为准，负分提醒不会擅自阻止合入。

- 本批保持 1.1.0：自己的最新 PS 支持只读左侧 / 可编辑右侧的 Edit diff；多文件保存到同一草稿，统一发布为一笔新 PS，检测服务器并发编辑。
- 工作台、讨论页增加发布 / Rebase 和冲突提示，展示并跳转互相冲突的未合入提交。
- 关系链紧凑显示、移除重复父 SHA 和无编号节点、标记旧 PS；两个页面的 Commit / 关系链折叠状态持久化，移除默认展开设置。
- 移除额外确认告警，评论导航使用上下箭头气泡图标；新增原生 Edit 宿主与后台响应竞态测试。

- 上传目标从远端现有分支补全，同名本地分支默认填入，忽略大小写筛选。
- 自己的未关闭提交支持按输入搜索并添加评审人员或组、移除人员；按服务器协议自动确认组添加，移除人员同时移除其评分，历史 PS 禁止修改。
- 新增人员管理入口支持中英文，标签打分权限仍由服务器控制。
- 补充 Excel 第三方编辑器对照说明与隔离宿主验证；保留 VS Code ^1.95.0 兼容范围。

## 1.0.0

- 将已验证的 0.16.0 功能集定版为稳定版 1.0.0，取消扩展预览标记。
- 更新中英文安装与本地发布说明；无额外功能改动，不公开发布。

## 0.16.0

- 原生评论输入框提示和发布 / 回复按钮随 Gerrit Language 切换，新评论与已有线程分开显示操作。
- 补齐 VS Code 底部 Comments 原生定位入口，已登记评论的命令定位切换到所属 PS / Base 差异，保留显式单文件打开和普通光标移动。
- 扩展详情页文档改为同页中英文说明与页内 English 跳转，不依赖尚未配置的公开仓库地址。

## 0.15.0

- 评论及活动中的网页链接使用内置浏览器打开；同站 Gerrit 链接复用认证网关，外站不携带 Gerrit 凭据。
- 新增 Language 设置，默认中文、可切换英文；页面、对话框及错误支持翻译，原生贡献通过 NLS 跟随 VS Code 显示语言。提供中英文 README、更新记录及本地发布检查。
- “单独打开此侧文件”移至编辑器右上角，移除右键入口。
- 差异使用临时预览标签，二进制原文件对照也使用两组预览标签，避免浏览后标签堆积。
- Gerrit 只读差异中按 C 新建评论：有选区评论选区，无选区评论光标行；Ctrl+C 继续复制。
- 收紧发布包白名单，包含语言资源和双语文档、第三方许可证，排除日志、测试及本地临时文件；仅准备本地包，不公开发布。

## 0.14.0

- 底部返回按钮改为“返回评审讨论”，回到当前变更的讨论页签。
- Message 与其余检索条件使用统一网格对齐；卡片评分按标签去重重复分值。
- PS 标注改为后台比较相邻 PS，仅对代码文件无差异的版本标注“与 PS n 无代码差异”；首笔及比较未知的 PS 不标注，结果局部更新。
- 差异文件类型分色显示，大文件响应超限提示与路径同一行。
- 评论代码定位改为打开评论所属 PS 与 Base 的差异并定位到对应一侧，保留重命名路径及历史版本；全局评论不再提供定位按钮。
- 差异编辑器增加单独打开左侧 / 右侧文件按钮和单独打开此侧文件右键入口，复用缓存内容。
- 从底部面板成功打开差异后自动标记该 PS 文件已读，失败不标记，仍可手动取消。

## 0.13.0

- 新增 Gerrit 号精确检索和修改文件名 / 路径的忽略大小写包含检索，支持组合、翻页、重置和任务重试。
- 底部面板更名为“Gerrit 对比差异”，新增“返回版本比较”按钮，直接定位左侧版本选择区。
- 连接地址提示改为根地址格式示例，移除 HTTP 确认弹窗；认证默认网页密码，明确与 HTTP Key 二选一，保留已有连接选择。
- 代码评论、Commit 信息及关系链默认展开；说明 Open Beside 的右侧分屏含义。
- 评审条件满足且非 WIP 的变更显示粉色“可发布”卡片，依据 Gerrit submittable 判断；实际合入仍受权限约束。
- 无改动文件的 PS 在单版本与比较选择框标注；当前评分直接展示非零分，未打分 / 0 分人员默认折叠。
- 依据两侧文件大小和 Base64 膨胀预判 32MB 响应上限，超限文件置灰且后端拒绝读取；超限 Content-Length 立即终止响应。

## 0.12.0

- 浏览检索结果后固定当前顺序，后台新增命中先显示数量，点击“合并新增结果”后再按更新时间排序，保留当前变更定位。
- 新增统一“后台任务”入口，集中显示 Message 检索、版本路径索引和 SSH 下载进度，支持取消及失败 / 取消后的重试；Git checkout 开始后不再中断。
- 父子导航新增多层面包屑，可直接返回任一子提交，并恢复该层原有比较及版本浏览状态。
- 修改文件新增按账号、变更和 PS 保存在本机的已读标记；新 PS 对比此前浏览的 PS，保留未变文件进度，标出修改 / 重命名文件并提供版本间比较。
- 详情刷新仅更新当前变更，列表刷新才重新检索；后台状态与文件进度局部更新，避免打断评论草稿。

## 0.11.0

- 文件查找移除当前工作区 / 本地仓库依赖；空窗口、其他仓库工作区均可查询所选 PS 的完整文件路径。
- 使用插件自己的临时 bare Git 缓存，通过 SSH 浅取版本并优先过滤 blob；不 checkout、不修改用户工作区，文件内容仍由 Gerrit REST API 读取。
- 缓存按服务器、账号和项目隔离，同版本复用查询，同仓库请求串行；失败可重试，断开或退出时取消请求并清理缓存。
- 入口改名为“查找此版本中的文件”，所在区域改为“查看版本文件”，明确包含未修改文件并支持忽略大小写。
- 补充真实 Git 缓存、未修改头文件、无关工作区、并发隔离、取消清理与真实 Webview 交互验证。

## 0.10.0

- 进入变更详情后自动后台预加载关系链，与默认折叠设置解耦；展开只负责显示，失败提供局部重试。
- 提前确认父 SHA 对应的可见 Gerrit 变更，仅确认存在时显示直达链接；优先当前分支，多条同 SHA 记录可选择。
- 父提交定位到实际引用的 Patch set，支持多级“返回子提交”，保留原检索结果、比较区间与 Patch 浏览状态；父提交路径隐藏上一条 / 下一条。
- 历史 PS 明确显示实际提交信息，整体评审及整笔变更操作需先显式切换最新 PS，行内回复仍按原评论版本处理。
- 区分父 SHA 固定浏览与普通最新版本浏览：常规刷新跟随新 PS，父提交刷新保持所引用版本，提供显式切换最新入口。
- 父提交确认与关系链预取局部更新，取消过期请求，迟到结果不覆盖当前页面。
- 明确单个 Patch 搜索仅匹配所选 PS 的文件路径，不搜索工作区未提交内容或代码正文。

## 0.9.0

- 关系链始终使用折叠栏；新增 gerrit.relationChain.defaultExpanded 设置，默认收起，展开后按需加载并保留当前变更的展开状态。
- 作者、提交者、父提交、仓库、分支及 Owner 可点击回到检索页；自动清理旧筛选，使用对应身份 / Commit 条件，分支限定当前仓库。
- 工作台详情与评审讨论新增上一条 / 下一条，按检索结果顺序导航，支持跨分页并复用已缓存结果；异步检索继续更新可用导航。
- 文件行、元信息链接和页签取消外框，普通按钮改用较轻的边框，保留状态卡片色条。
- 代码讨论、活动记录和关系链统一几何箭头，展开时旋转；缩小评审页标题、卡片、表单和区域间距。
- 关系链加载与检索导航状态局部更新，不重绘正在编辑的 Markdown 草稿。

## 0.8.0

- 提交卡片左边框按评审中、WIP、已合入、已废弃区分颜色；按钮统一增加可见轮廓。
- 关系链未加载时也有外框，缩小“打开评审讨论”入口的图标、留白和说明。
- 左右版本选项互斥，选择变化或交换左右立即更新比较结果，移除手动比较按钮。
- Patch 文件路径搜索改为缓存完整 Git 路径清单后忽略大小写匹配；本地缺少所选版本时后台 SSH fetch，仅获取对象，不切换分支，不改动文件或 FETCH_HEAD。
- 讨论和活动记录使用 Markdown 显示；评审与回复草稿点击编辑、失焦预览，发布时保持原始 Markdown 文本。
- 代码讨论可折叠并记住状态，折叠后显示首行；活动记录收起时也显示内容首行。
- 离线打包 markdown-it 15.0.3 及 MIT 许可证，禁用原始 HTML 和非 HTTP(S) / 邮件链接，图片显示说明文字。

## 0.7.0

- 新增 Abandoned 筛选，Open 包含可见的 WIP，移除“待我评审”快捷入口。
- 搜索命中即时显示卡片；进入评审后后台继续检索，返回直接使用已缓存结果。
- 停止按钮不受其他操作忙碌状态限制，直接取消在途检索请求；保留并标明未完成的部分结果。
- 压缩提交卡片、搜索表单和底部文件列表间距。
- 单个 Patch 自动展示文件，切换 PS 自动加载；移除“浏览此 Patch”和版本比较的“查看修改文件”按钮。

## 0.6.0

- 搜索拆分为 Message / Repo / Branch / Owner，自动组合 Gerrit 条件；Message 自动进行忽略大小写的包含匹配。
- 搜索覆盖标题、历史 Commit、整体评论、行内评论及变更 / 提交标识，原生正则结果与跨分页评论匹配合并，支持后台进度和停止。
- 移除直接拒绝 Gerrit binary 标记的逻辑，读取原始字节后尝试 UTF-8 / UTF-16 文本 diff。
- 无法作为文本比较的文件交给 VS Code 左右两个原生编辑器组尝试打开，保留原扩展名和字节；不内置 PDF / Excel 阅读器。
- 新增扩展 PNG 图标，将活动栏图标改为评审气泡勾选，区别于源代码管理。
- 整体 review 补强缓存并发与退出清理、Base64 完整性校验、旧搜索隔离及浏览器异常请求处理，并补充真实 VS Code 双窗和搜索交互验证。

## 0.5.0

- 工作台 Commit 信息紧跟最后更新时间；版本比较仅保留在工作台。
- 新增底部“Gerrit 文件”面板，完整列出比较结果并支持路径筛选、增删行数、各 PS 评论数与点击打开 diff。
- 当前评分移至发布评审表单上方，移除浮动定位，避免滚动时互相覆盖。
- 新增按需加载的 Relation chain，展示 PS、SHA、父提交、状态和旧 PS 提示，可跳转关联变更。
- 将 NEW / MERGED / ABANDONED 翻译为明确状态；Open 卡片新增当前用户的已评审 / 未评审标记。
- 新增服务器端“仅我未评审”和分支筛选，跨分页生效，作者更新后按 Gerrit 语义重新进入未评审范围。
- 扩展真实 VS Code 测试，检查底部视图、文件定位、Commit 顺序、评分滚动布局与评审页无比较控件。

## 0.4.0

- 评审讨论页整合 Commit 信息、单个 Patch 文件浏览、版本比较及本地下载，采用讨论 / 代码与下载页签和独立评分侧栏。
- 时间统一为本地时区的 YYYY-MM-DD HH:mm:ss，按创建时间、最后更新时间排列，移除提交和上传时间。
- 修复 checkout 成功后等待通知关闭而永久占用忙碌状态的问题；下载作为独立后台任务，显示阶段、完成和失败状态。
- SSH 下载直接在已打开且匹配项目的本地仓库中 fetch 指定 PS，校验 SHA 后创建 change-<变更号> 分支；不再选择目录或 clone。
- 下载前和 checkout 前检查未提交修改、未保存编辑器及已有分支，同一仓库的插件下载 / 上传互斥，不覆盖本地工作。
- 优化主题自适应卡片、线程头像、图标、元信息与窄窗口布局；增加真实 Git 工作区和真实 Webview 交互回归检查。

## 0.3.2

- 为工作台使用独立的 gerritWorkbench 容器，避免与其他 Gerrit 扩展共用侧边栏入口。
- 修复忙碌期间重载侧边栏时初始化消息被丢弃的问题，增加加载提示与页面错误上报。
- 真实 Extension Host 测试等待 Webview 脚本实际渲染完成，而非只检查插件激活。

## 0.3.1

- 修复启动崩溃：移除 VS Code 公共 API 不支持的 MinimapPosition / minimap 装饰调用，保留醒目的行号、行末和滚动条评论标记。
- 删除测试中虚构的 MinimapPosition 模拟，新增真实 Extension Host 的激活、命令和侧边栏启动检查。

## 0.3.0

- 修复内置网页 HTTP Basic 401：新增仅监听本机的一次性登录认证桥接。
- 页面正文移除设置和调试输出按钮；评审讨论在当前编辑器组打开。
- 新增单个 Patch 的完整文件浏览，以及使用本机 SSH key / agent 下载目标分支或指定 PS。
- 支持 Commit 信息默认展开设置；卡片和详情显示更新时间，详情显示提交时间，按更新时间排序。
- 加强评论行号、行末、滚动条和缩略图标记，新增文件评论位置清单及前后导航。
- 新增“有我参与”的完整线程筛选。
- 打包时校验新 VSIX 后清理旧包，并按项目约定每批修改创建一笔本地 commit。

## 0.2.0

- 评论、回复、评分和活动记录迁移到独立评审讨论标签页，按线程归并，保留输入草稿。
- 新增 Open / Merged 快捷筛选，默认展示 Open。
- 支持任意 PS / Base 比较、交换左右、历史版本评论及评论定位。
- 新建代码评论直接展开原生行内输入框，已有评论支持图标展开和代码悬停预览。
- Gerrit 网页默认使用 VS Code 内置浏览器。
- 新增扩展设置页入口和可配置的分页、超时、评论展示、diff 打开方式及日志级别。
- 新增 Gerrit Workbench 输出频道，记录脱敏的 HTTP 与 Git 诊断信息。

## 0.1.2

- 支持 HTTP 反向代理网页登录会话及 XSRF 令牌。

## 0.1.1

- 自动识别 dashboard 网页地址，改进 HTTP Key 错误提示。


---

## English

[返回中文 / Back to Chinese](#更新记录)


## 1.1.0

- Keep 1.1.0: inline reviewer/group autocomplete and removal, direct score buttons, and a sticky review column without overlap.
- Compare saved Edit against any PS / Base in either direction; discard an entire draft and restart on the same PS, with dirty-buffer protection.
- Always expose Rebase for your own Open / WIP changes; the server validates the operation.
- Use orange for all negative votes and brown for WIP. Submission eligibility follows the server even when negative votes exist.

- Keep version 1.1.0 for this batch: edit your latest PS in a native diff with immutable left and writable right sides. Save multiple files into one draft and publish one new PS, with server-edit concurrency checks.
- Add publish/rebase controls and background merge/conflicting-change indicators with detail links.
- Compact related nodes, omit duplicate parent SHAs and anonymous nodes, mark old patch sets, persist Commit/relation expansion per surface and remove default-expansion settings.
- Remove extra confirmation warnings, use directional comment-bubble icons, and add native Edit host and background-race checks.

- Complete upload targets from live remote branches; prefill matching local branches and filter case-insensitively.
- Search and add reviewers or groups and remove reviewers on your own open changes. Handle group confirmation automatically; removing reviewers also removes their votes; historical views cannot modify reviewers.
- Localize reviewer controls in Chinese and English; label permissions remain server-controlled.
- Document third-party Excel comparison and isolated host validation; keep VS Code ^1.95.0 compatibility.

## 1.0.0

- Finalize the validated 0.16.0 feature set as stable 1.0.0; remove the extension preview flag.
- Update bilingual installation and local release instructions. No additional functional changes or public publication.

## 0.16.0

- Localize native comment prompts and Post comment / Reply actions using Gerrit Language. Distinguish new comments from existing threads.
- Redirect command-driven navigation to registered native Comments threads into the appropriate PS/Base diff; preserve explicit standalone opening and ordinary cursor movement.
- Embed English documentation in root documents with in-page language links so the installed extension details viewer does not need a repository URL.

## 0.15.0

- Open comment/activity web links in the integrated browser. Same-site Gerrit links reuse authenticated sessions; external links do not receive Gerrit credentials.
- Add Chinese (default) and English views, dialogs and messages, packaged NLS contributions and bilingual documentation. Preserve user content verbatim.
- Move Open this side separately from the context menu to the editor toolbar.
- Reuse preview tabs for diffs and binary comparison pairs.
- Press C in read-only Gerrit diffs to comment on the selection or cursor line. Ctrl+C remains copy.
- Restrict package contents to runtime resources, localization and documentation. Prepare a local package without publishing.

## 0.14.0

Return from comparisons to discussion; align filters; deduplicate votes; compare adjacent PS code in the background; color file types; locate historical comments in PS/Base diffs; add single-side actions; mark successful file opens read; hide change-level code navigation.

## 0.13.0

Add exact change-number and case-insensitive modified-path filters, simplify connection prompts and default to website login. Expand details by default, show pink submittable cards, fold unvoted reviewers and preflight the Base64 response size budget.

## 0.12.0

Freeze search order while browsing with explicit merging of new hits. Add background task cancellation/retry, ancestor breadcrumbs, persistent PS file progress and scoped refresh.

## 0.11.0

Remove workspace dependence from revision path lookup using isolated temporary bare Git caches. Support unchanged files, case-insensitive paths, cache isolation and cleanup.

## 0.10.0

Preload related changes and resolve parent SHAs to visible Gerrit changes. Pin parent navigation to exact historical revisions, retain return context and guard historical review writes.

## 0.9.0

Add result Previous/Next navigation, configurable related-change expansion, metadata searches, compact layout and consistent collapse arrows.

## 0.8.0

Add status colors and clearer controls. Automatically compare mutually exclusive version selections. Improve file path lookup and Markdown discussion editing/preview.

## 0.7.0

Improve streaming search, cancellation, cached results, compact files and status filters.

## 0.6.0

Improve friendly search and native opening of binary originals without embedded file-format readers.

## 0.5.0

Improve comparison/review navigation, related changes, file presentation and search workflows.

## 0.4.0

Improve discussion layout, background SSH downloads, timestamps and commit information.

## 0.3.2

Fix extension activation and view visibility compatibility.

## 0.3.1

Improve extension installation and workbench activation reliability.

## 0.3.0

Expand review, code browsing, download and comment navigation workflows.

## 0.2.0

Add configurable views, arbitrary comparisons, inline discussions and debug output.

## 0.1.2

Improve server authentication and connection handling.

## 0.1.1

Initial connection, commit upload, review, comment, reply and voting workflows.

For the detailed original historical notes, see the [Chinese changelog](CHANGELOG.md).
