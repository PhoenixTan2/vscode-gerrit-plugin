# Gerrit Workbench

**中文** | [English](#english) · [更新记录](CHANGELOG.md) · [本地发布检查](RELEASE.md)

在 VS Code 中完成 Gerrit 连接、提交、代码评审、评论、回复、评分和变更管理。常用功能通过侧边栏、编辑器按钮和右键菜单操作，无需 Ctrl+Shift+P。

## 自动恢复登录

网页登录密码（HTTP 反向代理）模式使用已保存的凭据自动重新登录，无需为会话过期手动重新连接。身份检查返回 403、旧 CSRF 令牌被拒绝或令牌缺失时，也会清除旧会话、重新登录并重试原请求一次，并发请求共用一次重登。重新登录后仍被拒绝才显示具体权限 / 凭据错误；日志记录自动重登过程，不记录凭据。超时、网络断开和服务器 5xx 不会自动重发操作。外部浏览器登录由服务器管理；密码变更需更新保存的凭据。

## 评审阅读与评论状态

差异视图会异步加载此前 PS 的代码评论，并在每条评论及线程标题中标注原 PS。未改动的行会映射到当前代码；原行已修改、删除或无法准确映射时保留为文件级评论，注明原位置，可从“本文件评论”跳回原 PS。回复仍发送到评论原来的 PS、文件和行号。比较两个 PS 时，两侧各自显示本版评论，其余较早评论集中在较新一侧，避免重复。

点击检索结果卡片直接打开评审讨论，复用现有讨论标签；工作台仍保留版本比较，返回时不重跑检索。

“发布评审”和“当前评分”放在同一个右侧居中浮窗中，宽窄窗口的位置一致，内部独立滚动。点“收起”可临时缩成标题条，展开后保留尚未发送的评论和评分选择。

Code-Review / Verified 只显示实际分值按钮，移除“不修改评分”。默认高亮当前账号已有评分，无评分时显示 0；点击当前分数不取消、不产生变更。选择不同分数后，点击“发布评审”才发送；与已有评分相同的项不重复提交。

讨论页用橙色区分未解决线程、绿色区分已解决线程。已解决默认折叠、未解决默认展开，全局评论默认展开；可手动收起或展开，解决状态改变后采用对应的新默认值。代码页用不同颜色的行号旁图标、行尾数量和滚动条标记区分状态，原生评论标签也显示已解决 / 未解决。删除“默认展开代码评论”设置，其他设置仍保留。

工作台和对比差异的代码评论数采用 **未解决(已解决)** 格式，例如 **2(5)** 表示 2 个未解决、5 个已解决的代码讨论线程。按线程最后一条评论的状态统计，回复不重复计数，全局评论不计入代码讨论数。

冲突提交链接使用链接蓝色和下划线。详情页编号旁的状态文字也按问题状态显示颜色：Open 蓝、WIP 棕、可合入粉、已合入绿、已废弃红；负分另以橙色提示，不改变服务器的可合入判断。

## 讨论页内操作与状态颜色

自己的 Open / WIP 提交在评审讨论的“评审人员”框内直接输入姓名、邮箱或组名，选择下方候选即可添加人员或整组成员；点击已有人员旁的 × 删除。支持键盘切换候选；请求过期后不会误加其他人员，工作台和讨论页的候选相互隔离。人员管理只更新对应区域，不打断正在输入的评审评论。

评分直接点击允许的分值按钮，默认显示当前账号评分；Code-Review / Verified 不再显示“不修改评分”，重复点击当前分值不改变评分。发布评审与当前评分统一放入右侧居中的组合浮窗，宽窄窗口一致，可收起并在内部滚动。

工作台的版本对比可选择 **Edit（已保存草稿）**，与任意 PS 或 Base 双向对比；也可点“查看 Edit 改动”直接对比草稿与其原 PS。需先保存本地 Edit，比较不会生成 PS。Edit 快照不提供代码评论，发布后可对新 PS 评论。“废弃 Edit”删除整份服务器草稿，不影响已发布的 PS；未保存内容存在时先停止废弃，请先保存或在编辑器中撤销改动。废弃后可在同一 PS 开始新的 Edit。

自己的 Open / WIP 最新 PS 固定显示 **Rebase** 入口；不再因服务器遗漏动作标记而隐藏。选择 Base 后由服务器校验权限和操作是否可行，历史 PS 需先切回最新 PS。

| 提交卡片颜色 | 场景 |
| --- | --- |
| 蓝色 | 普通 Open |
| 棕色 | WIP |
| 橙色 | 存在负分，-1 / -2 同色，标签保留具体分值 |
| 粉色 | 服务器判断可合入，且没有负分提醒 |
| 绿色 | 已合入 |
| 红色 | 已废弃 |

色条优先级：已合入 / 已废弃 → 负分 → WIP → 可合入 → 普通 Open。颜色仅用于提醒，是否“可合入”严格使用服务器 submittable；有负分但服务器允许合入时，显示橙色色条及“可合入”文字，不自行禁用合入。具体色调随 VS Code 主题变化。

## Edit、发布与 Rebase

打开自己的 Open / WIP 提交的最新 PS 文本 diff，点击编辑器右上角 **Edit**。左侧 Base / 已选 PS 始终只读，只有右侧 Edit 可修改。使用右上角“保存 Edit 草稿”或 Ctrl+S 保存到 Gerrit 私有草稿，不依赖本地仓库，也不会直接改目标分支。

**同一提交的所有文件共用一份 Edit 草稿。** 可以依次编辑多个文件，保存不会生成 PS。修改全部完成后点“发布 Edit 为新 PS”，插件先保存该提交所有已打开且有修改的 Edit 文件，再把整份草稿发布为一笔新 PS；不会逐文件发布。某个文件保存失败或仍有未保存改动时停止发布，内容保留在编辑器中。最新 PS 或服务器草稿被其他窗口更新时拒绝覆盖，需先处理变动后重开。保存过的草稿可在 Gerrit Web 继续处理；未保存内容应在关闭窗口前保存。

工作台和评审讨论都提供当前权限允许的“发布为待评审”（WIP → 评审）、Rebase、“合入分支”及 Edit 发布入口。Rebase 可自动沿用依赖关系、直接基于目标分支，或输入 Gerrit 号 / SHA / ref。旧 Edit 需要先 Rebase Edit 到最新 PS，再发布。操作使用服务器权限校验；不提供绕过权限或强制合入。

推送、发布、合入、废弃和人员管理不再弹出额外确认告警。仍保留目标分支、上传方式、Rebase 目标等必要输入，以及失败时的错误提示。

Commit 信息、关系链分别记住工作台和评审讨论中的展开 / 收起状态，跨变更和重启保留；不再提供默认展开设置。关系链只显示有 Gerrit 编号的关联节点，移除重复父 SHA 行；非最新 PS 显示旧版本标记，Commit 信息中的父提交导航仍保留。

冲突检查在后台运行，区分与目标分支的合并冲突及与其他未合入提交的冲突；点击冲突提交可进入详情。若服务器不支持相关接口，明确显示检查不可用。评论导航改为带上下箭头的评论气泡，区别于更改导航。

## 上传分支与评审人员

上传时读取所选 Git remote 的真实分支。同名远端分支存在时默认填入本地分支，否则留空；输入时忽略大小写筛选候选。选择后仍会检查待推送提交和 Change-Id，通过后上传。

自己的 Open / WIP 提交仅在评审讨论中提供“评审人员 · Code-Review / Verified”折叠栏，在框内按姓名、邮箱或组名搜索并添加，点已有人员旁的 × 删除。组展开为成员，按服务器协议自动确认组添加。移除人员同时移除其已有评分；实际操作受服务器权限控制。历史 PS 需切回最新 PS 再管理。

Gerrit 的评审人员属于整笔变更，不按 Code-Review、Verified 独立分配；添加人员不会授予打分权限。标签权限由服务器项目配置控制，评分仍按标签显示。

## Excel 原文件对照

插件保留二进制原字节和扩展名，交给 VS Code 在左右两个编辑器组打开旧、新文件，使用临时预览标签，不实现表格渲染或单元格 diff。

请另行安装 [Office Viewer](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-office)（xls / xlsx / xlsm）或 [Excel Viewer](https://marketplace.visualstudio.com/items?itemName=GrapeCity.gc-excelviewer)（xlsx / xlsm）。若仍显示二进制提示，在文件标签右键“重新打开编辑器的方式…”选择查看器并设为默认。插件遵循 VS Code 编辑器关联，不强制更改其他类型的关联。复杂公式、图表和宏的显示取决于查看扩展，超过响应大小限制的文件仍不可打开。

## 安装与连接

在扩展面板 `…` → **从 VSIX 安装**，选择从 [GitHub Releases](https://github.com/PhoenixTan2/vscode-gerrit-plugin/releases) 下载的 `gerrit-workbench-1.1.4.vsix`。点击左侧 Gerrit Workbench 图标连接服务器。该入口与其他 Gerrit 插件相互独立；若活动栏未显示，可右键活动栏勾选 Gerrit Workbench，或点击状态栏 Gerrit 打开。通常只需服务器根地址，例如 `http://192.168.1.10` 或 `https://review.example.com:8443`，无需手动追加 `/gerrit` 或 `/dashboard/self`。实际部署在子路径的服务器仍支持对应前缀；也兼容粘贴 dashboard 地址。

在扩展设置的 **Language / 语言** 中选择 `zh-CN`（默认）或 `en`，插件页面和对话框即时切换。VS Code 命令、设置标题等声明式文字跟随 VS Code 显示语言；评论、代码、姓名和服务器信息保持原文。

认证方式每次连接二选一，不同时使用，密码与 Key 不可混用。默认选择网页登录密码；已有连接保留上次选择。服务器可能只支持其中一种：

- **HTTP Key / HTTP 密码**：使用 Gerrit Settings → HTTP Credentials 中生成的 Key，通过 `/a/` API 认证。
- **网页登录密码（HTTP 反向代理）**：使用网页登录密码，通过同站 `/login/` 建立 Gerrit 会话。写操作携带 `X-Gerrit-Auth`。

密码仅保存在 VS Code SecretStorage；Cookie 和会话令牌保存在内存。需要跨站浏览器交互的 SSO / OAuth 尚不支持。HTTPS 保留证书校验；当前不提供独立的代理配置。

## 操作入口

| 功能 | 使用方法 |
| --- | --- |
| 筛选变更 | Open（含可见 WIP）、Merged、Abandoned、与我相关、我的提交，以及 Gerrit 查询框；默认 Open，按最后更新时间从新到旧显示 |
| 友好搜索 | Message、Repo、Branch、Owner、Gerrit 号、文件六个输入框自动组合查询。Gerrit 号按数字精确匹配（可带 #）；文件按当前 PS 修改文件名 / 路径包含匹配，忽略大小写，不搜索代码正文或所有未改动文件。Repo / Branch 按名称限定范围，Owner 支持用户名、邮箱或 self；保留“仅我未评审”开关 |
| Message 模糊匹配 | 输入普通关键词，自动转为忽略大小写的包含正则，无需手写语法；匹配标题、历史 Commit 信息、整体评论、所有 PS 的行内评论、Change-Id / 提交号 / SHA。例如 test 可找到 TEST 和 test2 |
| 搜索进度与高级条件 | Message 搜索在后台跨分页执行，显示检查 / 命中数并可停止；边检索边显示卡片，进入评审后后台继续；返回列表使用缓存，点击搜索、重置或刷新才重新检索。失败和停止会保留部分结果并标明未完成。“高级条件与生成的 Gerrit 查询”中可查看原生范围及提交说明查询，或编辑原始条件 |
| 稳定检索顺序 | 鼠标进入结果列表或打开变更后固定顺序；后续命中先显示新增数量，点击“合并新增结果”才重排并更新上一条 / 下一条，保留当前变更定位 |
| 后台任务 | 侧边栏或文件面板右上角任务按钮、讨论页任务入口，集中查看 Message 检索、版本路径索引和 SSH 下载；可取消并重试失败 / 取消的任务。Git checkout 开始后需等待完成 |
| 刷新范围 | 详情“刷新此变更”及详情中的右上角刷新仅更新当前变更；回到列表后“刷新列表”才重新检索。搜索、重置仍重新检索 |
| 文件已读进度 | 下方文件面板勾选已读，按服务器、账号、变更和 PS 保存在本机；新 PS 与此前浏览过的最近 PS 比较，继承未变文件的已读状态，修改及重命名文件需重新确认。“查看版本间变化”打开两版比较；该标记不发布到 Gerrit，也不改变“我已评审”状态 |
| 状态与评审标记 | `NEW` 显示为“评审中”，表示尚未关闭或合入；Open 卡片分别标出“我已评审”“我未评审”，与是否已合入是两个维度；卡片按标签去重相同分数，多个 0 分仅显示一次；左边框用蓝色表示评审中、棕色表示 WIP、橙色表示负分、绿色表示已合入、红色表示已废弃、粉色表示“可合入”（服务器 submittable 为 true 且非 WIP；评审条件满足，实际合入仍需权限） |
| 时间与 Commit 信息 | 提交卡片显示最后更新；详情和讨论页依次显示创建时间、最后更新时间，统一为本地时区的 `YYYY-MM-DD HH:mm:ss`。Commit 信息紧跟最后更新时间，显示完整消息、SHA、Change-Id、作者和父提交 |
| 独立评审讨论 | 详情“打开评审讨论”，点击卡片即在当前编辑器组打开标签页，包含所有 Patch set 的讨论、评分和活动记录；代码讨论可折叠并记住状态，收起时单行显示评论首行，活动记录收起时也显示首行 |
| 按检索结果导航 | 工作台详情和评审讨论均提供“上一条 / 下一条”，按当前检索顺序切换，支持跨页并复用结果缓存；当前变更不在检索结果中时禁用 |
| 父子提交导航 | 预先查询父 SHA，仅关联可见 Gerrit 变更时显示直达链接，优先当前分支；准确打开父 SHA 所在 PS。父提交路径提供“返回子提交”和多层面包屑，可直接返回任一层并恢复比较及代码浏览状态，保留检索结果；父 SHA 无关联或查询失败时只显示文本 |
| 历史 PS | Commit 信息、比较与默认代码浏览定位所查看 PS；最新评分明确标注，历史 PS 需点击“切换到最新 PS 评审”才可发布整体评审或操作整笔变更；行内回复保留原 PS |
| 元信息跳转检索 | 点击作者、提交者、仓库、分支或 Owner 回到检索页，清除旧筛选并显示对应结果；作者 / 提交者按 Commit 身份检索，分支同时限定仓库 |
| 任意版本比较 | 仅在左侧工作台选择左右 PS / Base，左右选项排除另一侧已选版本，选择变化后自动比较，支持立即交换左右；Base 表示另一侧 PS 的第一父提交。改动文件统一在下方面板查看 |
| 修改文件面板 | 打开变更或执行比较后，下方“Gerrit 对比差异”面板列出全部修改文件；支持路径筛选、增删行数和各 PS 评论总数，点击文件在编辑器中打开对应 diff，默认使用可复用的临时预览标签；双击标签可保留。“返回评审讨论”打开当前变更的讨论页并切换到讨论页签；成功打开文件差异后自动标记当前 PS 已读，可手动取消。类型 A / D / M / R / C / W 分色显示；大文件限制提示与路径同一行。根据 Gerrit 文件大小预判两侧 Base64 响应预算，超过 32MB 的文件置灰并阻止读取；大小元数据缺失时无法提前判定，响应头 Content-Length 超限则立即终止读取。可点击底部“Gerrit 对比差异”页签展开面板 |
| Relation chain | 工作台和评审页始终以折叠栏显示关系链，进入变更后即后台加载所查看 PS 的依赖 / 后继提交，展开仅控制显示；分别记住工作台和评审讨论的折叠状态，跨重启保留。显示状态、SHA、PS；提示旧 PS，移除重复父提交行及无编号 Git 节点。点击节点打开该变更最新 PS。 |
| 非文本文件 | 先读取原始字节并尝试 UTF-8 / UTF-16 解码，不因 Gerrit 的 binary 标记直接拒绝。能解码为文本则使用原生 diff；其他格式仅缓存只读原文件，再由 VS Code 在旧版 / 新版两个编辑器组尝试打开，具体预览能力取决于已安装的文件扩展。新增 / 删除侧显示不存在提示 |
| 查看版本文件 / 查找此版本中的文件 | 选择 PS 默认显示改动文件；相比上一笔 PS 无代码差异的版本在选择框标注（后台比较相邻 PS，忽略 Commit 消息等虚拟文件），仍可下载、查看 Commit 及查找未修改文件；按文件名或路径查找该版本全部文件（含未修改的头文件），忽略大小写。无需打开对应仓库，空窗口或其他仓库工作区都能使用；不搜索代码正文或未提交内容。首次查找通过 SSH 在插件独立临时 bare 缓存中读取版本路径，优先浅取并过滤 blob，不 checkout 或改动当前工作区；需要 Git 和可用 SSH 认证。找到的文件由 Gerrit 读取所选 PS 的原内容；断开连接或退出插件时清理缓存 |
| SSH 下载 | 评审页“代码与下载”选择 PS → “下载到本地”，在已打开的对应项目仓库中后台 fetch / checkout，不选择目录、不 clone |
| 单独查看差异一侧 | 差异编辑器右上角提供单独打开左侧 / 右侧文件按钮，右上角也提供“单独打开此侧文件”，复用已载入内容；新增 / 删除时不存在的一侧不打开 |
| 快捷评论 | Gerrit 只读差异编辑器中按 `C`：有选区时评论所选范围，无选区时评论光标所在行；`Ctrl+C` 继续复制，评论输入框中正常输入 |
| 新建代码评论 | 打开代码或 diff，选中行 / 多行 → 右键“添加代码评论（选区或当前行）”，展开行内输入框；也可点行号旁的 `+` 或编辑器评论按钮 |
| 查找文件评论 | 橙色行号图标、行末评论数、滚动条标记；编辑器右上角提供“上一处评论”“下一处评论”“本文件评论位置” |
| 评论悬停 / 定位 | 悬停代码预览评论；讨论页“定位到差异代码”切换到评论所属 PS 与 Base 的差异，在正确一侧定位行号；全局评论不提供代码定位 |
| Markdown 讨论与回复 | 讨论和活动记录支持 Markdown 标题、列表、代码块、表格和链接。整体评审与回复草稿点击进入编辑，移开焦点显示预览；点击发布才发送原始文本 |
| 评论中的链接 | HTTP(S) 链接在内置浏览器打开，同 Gerrit 站点复用认证网关，外站直接打开且不携带 Gerrit 凭据；支持站点相对路径，禁用非网页链接协议 |
| 评论筛选 | 讨论页支持“仅显示未解决”和“有我参与”，后者保留自己曾回复过的完整线程，可组合筛选 |
| 发布评审与打分 | 在讨论页填写整体意见，选择实际有权限的标签分数，点击“发布评审”；未选的评分不修改；评分和评审评论表单位于独立浮动侧栏，当前评分在其下方；默认直接显示非零评分，未打分 / 0 分人员放在折叠栏中 |
| 回复 | 在代码线程中发布回复，或在讨论页线程下的多行文本框回复 |
| 发布 / 废弃 / 合入 | 自己的 WIP 可发布为待评审；可废弃自己的提交；有 submit 权限且服务器允许时可合入目标分支 |
| 设置 / 调试输出 | 仅保留 Gerrit 侧边栏右上角的齿轮和输出小按钮，不在页面正文重复显示 |

行评论与回复绑定实际所在的 PS / Base。整体评审与评分针对页面注明的最新 PS。评论、回复、评分立即发布；整体评审和线程回复保留本地输入草稿，不自动发布服务器已有的其他草稿。可在讨论页为当前查看的 PS 发布全局评论，默认勾选「标记为已解决」，发布前可取消勾选。普通代码评论默认未解决。只有发起讨论的账号能用 Done 将线程标记为已解决。

“我已评审”使用 Gerrit 的 `REVIEWED` / `reviewedby:self` 语义：自己在作者最近一次更新之后发布过评论或评分。仅打开代码不会自动标记；作者再次更新后会重新归入未评审。这与他人是否已经评分、文件级“已读”是不同概念。分支筛选可与预设或自定义查询组合；切换 Merged 会清除仅 Open 有效的未评审开关。

Message 的评论包含匹配由插件补充：Gerrit 原生评论索引没有同等的正则包含语义，因此会先按状态、Repo、Branch、Owner 限定范围，再跨分页读取 Commit / 评审记录和必要的行内评论，最多并发四个评论请求。范围较大时可先填 Repo / Branch 缩小搜索。查询采用已登录账号的可见范围，不进行代码正文或文件内容全文检索。

原文件缓存保留字节、扩展名及旧 / 新 / PS 目录标识，位于系统临时目录，不写进代码仓库。插件退出时尝试清理缓存；不内置 PDF、Excel 等格式的阅读器，也不安装文件查看扩展。

## SSH 下载与上传

下载读取 Gerrit 提供的 SSH URL（包括用户名、端口和项目路径），使用本机 OpenSSH 的配置、SSH key / agent，以 BatchMode 执行，避免后台等待密码。需要预先在 Gerrit 中添加 SSH 公钥，并在本机建立对应的 known_hosts 信任；插件不自动接受主机指纹，也不下载或保存私钥。

先在 VS Code 打开对应项目的本地 Git 仓库（remote 路径须匹配 Gerrit 项目）。评审页“代码与下载”选择 PS 后，后台执行 `git fetch <SSH URL> refs/changes/...`，验证 FETCH_HEAD 与所选 PS 的 SHA 一致，再执行 `git -c core.longpaths=true checkout -b change-<变更号> <SHA>`。无需选择父目录或新建目录；多个匹配仓库时只需选择仓库。

下载前和 checkout 前检查未提交文件、未保存编辑器和已有分支。已有同名分支时会提示先重命名或删除，不自动覆盖、stash 或强制切换。同一仓库的插件下载 / 上传不会并发执行；其他浏览和评审操作可继续使用。下载阶段、结果及失败原因显示在代码页和输出频道，完成通知无需关闭即可继续使用插件。SSH 下载不使用 HTTP 密码或 HTTP Key。

上传入口为侧边栏“上传本地提交”或源代码管理的云上传按钮。可提交已暂存内容后上传，也可只上传已有 HEAD；不自动暂存、不强推、不自动修改已有提交。先 fetch 目标分支、检查整组待上传 commit 的 Change-Id，再使用选定的 remote 和分支推送，不再弹出确认告警。上传使用 `refs/for/<branch>`，支持 WIP；Gerrit submit 合入为独立操作。

初次使用 Gerrit 的仓库请按服务器的 **Clone with commit-msg hook** 说明安装 hook。缺少 Change-Id 时，安装后通过终端 amend 对应 commit，再上传。

## 内置浏览器

网页入口使用 VS Code **集成浏览器**。为解决反向代理 HTTP Basic 登录的 401，插件在 `127.0.0.1` 的随机端口建立认证桥接，以一次性入口票据建立本地 HttpOnly 会话，再把请求转发到已连接的固定 Gerrit 站点。密码和上游会话 Cookie 不写入网址或 HTML。

桥接拒绝未认证、伪造 Host 和跨站请求；写操作保留 Gerrit 的 XSRF 验证。切换账号、断开连接或插件退出时关闭桥接。HTTP Key 模式下网页若需要网页登录密码，会单独询问，不替换已保存的 HTTP Key。

需要提供集成浏览器命令的新版 VS Code。旧版 Simple Browser 的 iframe 对认证和 Cookie 存在限制，因此不再回退到它；旧版 VS Code 仍可使用原生代码与评审功能。

## 扩展设置与输出

点击侧边栏右上角齿轮打开本扩展设置：

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `gerrit.language` | `zh-CN` | 页面和对话框：中文 / English |
| `gerrit.defaultQuery` | `is:open` | 默认查询 |
| `gerrit.pageSize` | 50 | 每页 10–100 条 |
| `gerrit.requestTimeout` | 30000 | HTTP 超时毫秒数 |
| `gerrit.diff.openBeside` | false | Open Beside：在右侧独立编辑器区域打开 diff；关闭时使用当前区域 |
| `gerrit.logLevel` | `info` | off / error / info / debug |

评论标记颜色可通过 VS Code `workbench.colorCustomizations` 中的 `gerrit.commentMarker`（未解决）和 `gerrit.resolvedCommentMarker`（已解决）定制。

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


---

## English

[返回中文 / Back to Chinese](#gerrit-workbench)


Connect, upload commits, review changes, comment on code, reply and vote from VS Code. Normal workflows use the sidebar, editor buttons and file panel without opening the Command Palette.

## Automatic session recovery

Website-password (HTTP reverse proxy) mode automatically signs in with saved credentials; expired sessions do not require manual reconnection. Identity checks returning 403 and rejected, missing or malformed CSRF tokens also trigger one fresh login and one retry, shared by concurrent requests. A rejection after that retry reports a specific permission or credential error. Logs describe recovery without credentials. Timeouts, dropped connections and server 5xx responses never replay operations. External-browser sign-in remains server-managed; update saved credentials if the password changes.

## Review reading and comment states

Diff views load earlier PS code comments in the background and label each comment and thread with its original PS. Unchanged lines map to the displayed code. Comments on changed, deleted or unmappable lines remain file-level threads with their original location; use File comments to jump to the original PS. Replies retain the original PS, file and line. When comparing two PS versions, each side shows its own comments, with other earlier comments on the newer side to avoid duplicates.

Clicking a search-result card opens the review discussion directly and reuses the existing discussion tab. Comparisons remain in the workbench; returning does not repeat the search.

Post review and current votes share one floating window centred on the right at every viewport width. It scrolls internally. Collapse reduces it to a title bar; expanding retains unsent comments and score choices.

Code-Review / Verified show score buttons without an unchanged-score option. The current account's existing vote is preselected, or 0 when there is no vote. Clicking the selected score leaves it unchanged. Different scores are sent only by Post review; unchanged votes are omitted from the request.

Discussion threads use orange for unresolved and green for resolved. Resolved threads start collapsed, unresolved threads expanded, and global comments expanded. Manual folding is retained until the resolution state changes. Code views distinguish states through coloured gutter icons, inline counts and overview-ruler markers; native thread labels also name the state. The default-expand-comments setting was removed; other settings remain.

Workbench and comparison code-comment counts use **unresolved(resolved)**, such as **2(5)** for two unresolved and five resolved code discussion threads. The latest comment determines each thread's state. Replies are not counted again and global comments are excluded from code-thread counts.

Conflicting-change links use link blue and underlines. Status text beside the change number uses blue for Open, brown for WIP, pink for ready to submit, green for merged and red for abandoned. Negative votes retain a separate orange indicator without overriding server eligibility.

## In-page review controls and state colors

On your own Open / WIP changes, type a name, email or group name directly in the discussion's **Reviewers** box. Select a suggestion to add a person or group; use × next to an existing reviewer to remove them. Keyboard navigation is supported. Stale suggestions cannot add a different person, and sidebar/discussion suggestions are isolated. Reviewer updates preserve the review comment being edited.

Score buttons preselect your current vote. Code-Review / Verified have no unchanged-score button; clicking the selected value does nothing. Post review and current votes share one collapsible right-centred window at every viewport width, with internal scrolling.

The workbench comparison selectors include **Edit (saved draft)** for comparison against any PS or Base in either direction. **Compare saved edit** compares the draft to its original PS. Save local edits first; comparisons create no PS. Code comments require publishing the Edit as a PS. **Discard edit** deletes the whole private draft without changing published PS revisions. Dirty local buffers block discard until saved or undone. You can start a fresh Edit on the same PS afterwards.

Your own Open / WIP latest PS always exposes **Rebase**, even when the server omitted action metadata. The server checks permission and feasibility after the Base is selected. Historical views must first switch to the latest PS.

| Card color | Meaning |
| --- | --- |
| Blue | Ordinary Open |
| Brown | WIP |
| Orange | Negative votes; -1 / -2 share a color and retain their values |
| Pink | Server says ready to submit, with no negative-vote warning |
| Green | Merged |
| Red | Abandoned |

Stripe priority: merged / abandoned, then negative votes, WIP, ready to submit and ordinary Open. Color is a warning, while eligibility uses the server's submittable flag. A negative-voted change that the server permits can show an orange stripe and **Ready to submit** together; the extension does not invent a submission block. Exact tones follow the VS Code theme.

## Edit, publish and rebase

Open a text diff of the latest PS of your own Open / WIP change and choose **Edit** in the editor toolbar. The left Base / selected PS stays read-only; only the right Edit side is writable. Use **Save Gerrit edit** or Ctrl+S to save a private server-side draft, without a local repository or target-branch changes.

**All files in one change share one Edit draft.** Edit and save multiple files; saving does not create a PS. When finished, choose **Publish edit as new PS**. It saves every open dirty Edit file for that change, then publishes the whole draft as one new PS. Files are never published individually. A failed save or remaining dirty buffer stops publication and retains editor content. Newer patch sets or edits changed in another window are not overwritten. Reconcile them and reopen the edit. Saved drafts can be continued in Gerrit Web; save unsaved content before closing the window.

The workbench and discussion expose permitted actions: publish WIP for review, Rebase, submit and publish an Edit. Rebase can preserve dependencies automatically, use the target branch tip, or use an entered change number / SHA / ref. An old Edit must be rebased onto the latest PS before publication. All writes remain subject to server permissions.

Uploads, publishing, submission, abandonment and reviewer changes no longer show extra confirmation warnings. Necessary target/mode/rebase inputs and failure messages remain.

Commit and relation panels remember expansion separately for the workbench and discussion, across changes and restarts. The default-expansion settings were removed. Compact related changes show numbered Gerrit nodes, mark outdated patch sets and omit repeated parent-SHA rows. Parent navigation remains in commit metadata.

Background conflict checks distinguish target-branch merge conflicts from conflicts with unmerged changes; conflicting changes link to details. Unsupported checks are explicitly marked unavailable. Comment navigation uses directional comment-bubble icons distinct from diff-change navigation.

## Upload branches and reviewers

Uploads read live branches from the selected Git remote. Prefill the local branch only when it exists remotely; otherwise start empty. Type to filter suggestions case-insensitively. Outgoing commits and Change-Ids are still checked before pushing, without a confirmation warning.

Your own Open / WIP changes show a **Reviewers · Code-Review / Verified** section in the discussion page only. Type a name, email or group name in the box and select a suggestion; use × next to a reviewer to remove them. Groups expand into members; server-required group confirmation is handled automatically. Removing reviewers also removes their votes and remains subject to server permissions. Switch historical views to the latest PS before managing reviewers.

Gerrit assigns reviewers to a whole change, not separately to Code-Review and Verified. Adding reviewers does not grant voting rights; server project configuration controls label permissions. Votes remain displayed per label.

## Excel original-file comparison

Binary snapshots retain their exact bytes and filename extension. VS Code opens the old and new copies in separate editor groups as preview tabs. Gerrit Workbench does not render spreadsheets or calculate cell differences.

Install [Office Viewer](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-office) for xls / xlsx / xlsm or [Excel Viewer](https://marketplace.visualstudio.com/items?itemName=GrapeCity.gc-excelviewer) for xlsx / xlsm separately. If a binary warning remains, right-click the tab, choose **Reopen Editor With...**, select the viewer and make it the default. The extension follows VS Code editor associations without overriding other formats. Rendering of complex formulas, charts and macros depends on the viewer. Files exceeding the response limit remain unavailable.

## Install and connect

Install `gerrit-workbench-1.1.4.vsix` using Extensions → **Install from VSIX**, then open the Gerrit Workbench activity icon. Enter a server root such as `http://192.168.1.10` or `https://review.example.com:8443`. Do not append `/gerrit` unless your server is actually deployed at that prefix. Dashboard URLs are also accepted.

Choose one authentication method per connection:

- **Website password** (default): for HTTP reverse-proxy login. Creates a website session and sends CSRF tokens for writes.
- **HTTP Key / HTTP password**: the credential generated in Gerrit Settings → HTTP Credentials, using the `/a/` REST API.

The methods are not combined; a server may support either or both. Existing connections keep the last choice. Passwords are stored in VS Code SecretStorage. Cookies and session tokens stay in memory. Interactive SSO/OAuth is not supported. HTTPS certificate verification remains enabled.

## Language

Set **Gerrit → Language** to `zh-CN` (default) or `en`. Views, dialogs and extension-generated messages change immediately. Native VS Code command and settings titles follow the VS Code display language through packaged NLS resources. User comments, source code, names and server data remain unchanged.

## Main workflows

| Feature | How it works |
| --- | --- |
| Search | Open (including visible WIP), Merged, Abandoned, related-to-me and my-changes presets. Combine Message, Repo, Branch, Owner, exact Gerrit number and modified-file path fields. Message and filename matching use case-insensitive substring matching. Advanced Gerrit conditions remain available. |
| Message search | Searches subjects, historical commit messages, overall reviews, inline comments, Change-Ids, numbers and SHAs. It does not search source contents. Narrow Repo/Branch to reduce scanning time. |
| Stable results | Results stream in the background. Browsing locks their order; later hits show a count until you merge them. Back navigation uses cached results. Search/reset/list refresh starts a new search; detail refresh updates only that change. |
| Background tasks | Sidebar/file-panel task button and discussion entry show Message scans, path indexes and downloads. Cancel or retry failed/cancelled tasks. Checkout cannot be interrupted once it starts. |
| Change navigation | Previous/Next follows cached result order. Parent links appear only for confirmed visible Gerrit changes and open the exact referenced PS. Breadcrumbs return directly to any child context, restoring comparisons. |
| Commit and related changes | Created and last-updated timestamps, full commit message and metadata. Author/committer/repo/branch links search their identity. Related changes preload in the background; manual collapse state is retained. |
| Arbitrary comparison | Choose any PS pair or PS/Base in the sidebar. Base is the other PS's first parent. Selecting a revision immediately updates the bottom **Gerrit Comparison** panel. |
| PS annotations | Adjacent PS revisions are compared in the background. A revision is annotated only when no code files differ from the preceding PS. Virtual commit-message files are ignored. |
| Comparison files | File types have distinct colors, with path filters, statistics and comment counts. Successful opening marks that PS file read locally; failed opening does not. Read markers can be cleared manually. New PS versions retain reads only for unchanged files. |
| Temporary tabs | File comparisons use reusable preview tabs to avoid tab accumulation. Double-click a tab to keep it. Original binary pairs also use preview tabs in their two editor groups. |
| Single-side files | Top-right buttons open the left, right or currently focused side separately using already-loaded snapshots. Missing sides cannot be opened. |
| Discussions | Discussion opens in the active editor group. Code threads and activity entries collapse to their first lines. Filters select unresolved threads and discussions you joined. Back from the comparison panel opens the discussion tab. |
| Inline comments | Press `C` in a read-only Gerrit diff: comment on the selected range, or at the cursor line when no selection exists. `Ctrl+C` still copies. The shortcut is inactive in comment text inputs. Gutter/comment-toolbar entry points are also available. |
| Comment navigation | Gutter markers, hover summaries, scrollbar marks and previous/next comment buttons. Discussion navigation opens the original PS/Base diff and reveals the correct side. Change-level comments have no code navigation button. |
| Markdown and links | Discussions and draft replies support safe Markdown with preview on blur. HTTP(S) links open in the integrated browser. Same-site Gerrit links use the authenticated gateway; external links receive no Gerrit credentials. Site-relative links are supported. Raw HTML and non-web link protocols are disabled. |
| Votes and management | Nonzero votes show directly; unvoted/zero-score people are collapsed. Cards deduplicate identical scores. Pink Ready-to-submit cards use the server's submittable flag; submitting still requires permission. Own WIP can be published, own changes abandoned, permitted changes submitted. |
| Browse revision files | Find paths in any selected PS, including unchanged headers, without a matching workspace repository. An isolated temporary bare Git cache fetches paths over SSH; content is read through Gerrit. No checkout or workspace changes occur. |
| Binary files | Gerrit's binary flag does not prevent text decoding/diff. Opaque files are passed as original bytes to VS Code in old/new editor groups; preview depends on installed file extensions. No embedded PDF/Excel viewer is included. |
| Large files | Metadata preflights both sides against the 32 MiB Base64 response budget (about 24 MiB source bytes). Known oversized files are disabled. Without metadata, Content-Length is checked before reading and streaming responses retain the byte limit. |

File reads are local progress markers, separate from Gerrit's reviewed-by-me state. That state means you commented or voted after the author's last update. Opening a file does not publish a Gerrit review.

Overall reviews and votes target the latest PS. Historical PS pages require explicitly opening the latest PS before overall review or change-management actions. Inline replies retain the original revision. Use the discussion form to post a change-level comment on the patch set shown. By default, **Mark as resolved** is selected for change-level comments. Clear it to post an unresolved comment. New code comments start unresolved. Only the person who started a thread can mark it resolved with **Done**. Reviews publish immediately; drafts are never automatically published.

## SSH downloads and uploads

Downloads use the Gerrit-advertised SSH URL and your local OpenSSH key/agent and known_hosts. Password prompts and automatic host-key acceptance are disabled. No private keys are managed by the extension.

Open a local Git repository whose remote project matches the change. The extension fetches the selected change ref, verifies FETCH_HEAD against its SHA, then creates `change-<number>` and checks it out. It checks uncommitted files, unsaved editors and existing branches before checkout. It never clones, overwrites branches, stashes or forces checkout. Downloads and uploads are serialized per repository.

Upload staged changes or the existing HEAD through the sidebar or Source Control upload button. The destination is `refs/for/<branch>`, optionally WIP. Install Gerrit's commit-msg hook first; every uploaded commit needs a valid Change-Id. Remote and branch choices are used directly after commit validation, without a confirmation warning.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `gerrit.language` | `zh-CN` | Chinese or English views/dialogs |
| `gerrit.defaultQuery` | `is:open` | Initial query |
| `gerrit.pageSize` | 50 | 10–100 changes per page |
| `gerrit.requestTimeout` | 30000 | HTTP timeout in milliseconds |
| `gerrit.diff.openBeside` | false | Open comparisons in a separate editor group on the right |
| `gerrit.logLevel` | `info` | off/error/info/debug |

Toolbar settings and output buttons open extension settings and the Gerrit Workbench output channel. Known secrets and authentication headers are redacted; request bodies and response bodies are not logged. Output can contain server/project paths.

## Development and local delivery

Run `python scripts/verify.py`, then `python scripts/package.py`. Optionally run `python scripts/verify_host.py --vsix gerrit-workbench-1.1.4.vsix` for an isolated real VS Code host check. Node.js or VS Code's bundled Node runtime and Python are required. Local Git tests require Git. The packager validates the new archive before removing older project VSIX files and includes only runtime assets and documentation.

The source is available on [GitHub](https://github.com/PhoenixTan2/vscode-gerrit-plugin). Download the VSIX from [GitHub Releases](https://github.com/PhoenixTan2/vscode-gerrit-plugin/releases). See [release checks](RELEASE.en.md). MIT license; bundled markdown-it license is documented in [third-party notices](THIRD_PARTY_NOTICES.md).
