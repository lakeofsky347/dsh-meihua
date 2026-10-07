# 0.4 加密共享记忆验收

日期：2026-10-06（Asia/Shanghai）。批准的实施范围为 G0—G3；后续占卜方式见 `roadmap.md`。本记录逐项区分源码能力、自动化测试、隔离运行与真实供应商质量。G0—G3 已达到 0.4 验收终点；未执行的外部效果保留 `NOT_CHECKED`。

## 当前最终交付：Goal 逐项复核后

权威完成矩阵见 `v4-goal-completion-audit.md`。本轮复核修复了第三方/转述误归本人、多字段固定段落冲突未标、目录或持久化失败自动重试、旧失败在新消息成功后复活的问题；同时补足双模块导航、新轮、单次停用及临时切走的实际 RPC 测试。此前 109 项测试与包身份属于历史阶段，下面新的 119 项和归档身份为当前交付依据。

| 验收面 | 当前最终结果 | 权威证据（均位于 `artifacts/verification-memory-2026-10-06/`） |
|---|---|---|
| 类型、构建、完整回归、打包 | 退出码均 0；119/119 PASS，无失败/取消/跳过；记忆专项 22、模块专项 8、客户端流程专项 4 均包含其中 | `goal-build-checks.json`、`goal-tests.log` |
| 当前归档 | `artifacts/dsh-meihua-0.4.0.tgz`，11,518,278 字节；SHA-256 `fdfff8a18df1b579aa54676bca8b92d11e230534949cb92e651ff62714733980` | `goal-package-integrity.json` |
| 安装回读 | 22/22 文件字节一致；78 张内嵌图及 core/tarot 导出通过 | `goal-package-integrity.json` |
| 来源、冲突、失败和并发 | 直接本人完整陈述、相同/不同显式字段、目录失败与保存失败围栏、旧失败保留、固定段落、版本/CAS 等通过 | `goal-tests.log` 与逐项完成矩阵 |
| 双模块客户端流程 | 实际发布 client 控制器 → 完整连接信封 → 正确 RPC → Host → 官方 JSON storage；离开模块、直接新轮、单次不用背景仍写本人信息、刷新/暂时切走不提炼均对两模块执行 | `tests/client-memory-flow.test.ts`、`goal-tests.log` |
| HTTP 认证 | status/document/save 未认证均 401；跨源请求 403；实际认证 UI 操作成功 | `goal-memory-auth-probe.json` |
| 当前包原生运行 | 启动默认锁定，解锁恢复 v2；梅花首解 v2，直接切换自动 v3，塔罗首解 v3，直接新轮自动 v4；两段固定内容、实际深色、锁定清缓存和本地抽牌可用 | `goal-native-ui-acceptance.json`、v3/v4 AX 与截图 |
| 两模块主题/窄窗/复制 | 实际深浅主题事件；350px 无页面横向溢出；梅花/塔罗首解及追问完成、塔罗十张无重复；浏览器剪贴板读回字段完整并恢复原空剪贴板 | `goal-web-ui-acceptance.json`、`goal-*-narrow-*.jpg` |
| 当前原生明文留存 | home 46、logs 2、browser 69，共 117 文件；7 个合成标记 0 命中，读取/解压失败和未覆盖块均 0 | `goal-native-privacy-scan-index.json` 与三个子报告 |
| 当前 Web 留存 | 30 文件、7 个合成标记 0 命中；1 个开发 symlink 未跟随 | `goal-web-profile-privacy-scan.json` |
| 官方 Session 回读 | 原生 6/6（最后新增的两份版本为 2/3），Web 7/7；每份占卜 Session 7 个元信息事件，无私人文本事件/合成标记 | `goal-native-session-readback.json`、`goal-web-session-readback.json` |
| 退出与隔离 | 仅结束隔离副本；dsh handler 恢复为 `com.deepseek.dsh`；临时主题/viewport 恢复；正式安装/profile 未操作 | `goal-native-final-exit.json` |
| 外部效果边界 | 真实供应商摘要/解读质量及原生系统剪贴板读回为 NOT_CHECKED；全部生成是合成资料与本地 fixture | UI/Session 报告与完成矩阵 |

`goal-native-memory-v3.png` 和 `goal-native-memory-v4-dark.png` 已按实际截图独立目视：新本人陈述进入文档，合成生日与“出生时间不详”原文、两个固定段落保留，界面可读。来源判断采用保守的直接陈述/原文边界校验，冲突比较明确字段；不宣称任意自然语言身份和所有语义矛盾均已解决，模糊信息可手动编辑。旧日志继续不迁移、不删除。

以下各节保留首次 0.4 实施的历史证据。出现“最终包/109 项/60be…”时指该历史阶段，当前交付身份以本节及 `goal-*` 报告为准。

## 基线与隐私边界

本轮开始时 `package.json` 为 0.3.0；原基线 70/70 测试通过。既有梅花和塔罗首解与追问把完整系统提示、冻结起卦/牌阵记录、问题、回答和流式块写入标准 Session 日志。旧版验收 profile 内已有这些合成明文记录；本轮不读取用户正式 profile，不自动迁移或删除旧日志。

新版需要加密保存背景文档、历史版本与私人对话记录。普通 Session 仅保存请求标识、模块、背景版本、计量、状态及稳定错误码；模型调用省略 `sessionId`，避免当前 DSH 的 Session 日志贡献器再次记录输入和输出。这个边界不等同于对其他宿主插件或模型供应商的隔离。

普通日志的自定义 `private/request`、`private/result` 事件使用 `ignorable: true` 信封，以兼容已安装宿主的日志读取器。计量只保留白名单中的非负整数，任意供应商文本和未知错误代码不能进入普通日志。正常取消轮的完整输入与部分输出继续留存在密文 audit；锁定或清空后靠代次检查拒绝迟到写入。

独立口令保护本地留存。解锁后文本会在 Host/页面内存中使用，解读和摘要会将相关明文发送给用户所选模型。口令遗失无法恢复资料；云同步、多人物档案、向量数据库、完整历史列表和旧 Session 日志迁移不属于 0.4。

## 首次 0.4 阶段交付与结果登记（历史）

| 验收面 | 需要覆盖 | 本轮结果 |
|---|---|---|
| 基线 | 现有 0.3 测试与两模块接口 | 本轮执行输出确认 70/70 |
| 加密 | 初始化、错口令、篡改、改口令、重启恢复、写入失败 | Host 16/16 专项通过，含真实 JSON backend；最终全集 109/109 |
| 文档 | 4,000 字符、固定段落、版本差异、20 版保留、撤回 | Host 专项、Web 编辑/撤回及最终原生编辑/固定/恢复通过 |
| 提炼 | 仅用户新增消息、生日原样、第三方/假设/引用不归本人、失败保留旧版 | 合成供应商专项通过；真实模型质量 NOT_CHECKED |
| 并发 | 检查点去重、编辑竞争、锁定/清空取消、迟到提交失效 | Host 专项通过；异步持久化期间锁定、迟到初始化、长对话增量均覆盖 |
| 共享 | 梅花到塔罗、首解冻结、追问原快照、单次停用、替他人问 | Host、Web 与最终包原生链路通过：梅花首解/追问 v1，塔罗新首解 v2 |
| 日志 | 官方 JSONL 后端元信息读回、provider 请求省略 sessionId | Host 5 份、Web runtime 3 份、原生 runtime 4 份官方 JSONL/zstd 读回通过；最终全集 109/109 |
| 私人明文扫描 | 独立 storage、Session（含 zstd）、临时文件、错误/诊断日志 | backend-home 清空前后各 15 文件、Web profile 22 文件、原生 home/logs/browser 三树共 109 文件，均 0 命中/读取失败/未覆盖压缩 |
| 界面 | 编辑、口令、更新、撤回、锁定/清空、窄窗、复制与导航 | Web 核心链路与窄窗目视、原生核心链路/重启恢复通过；复制格式和主题绑定自动回归通过，真实剪贴板及原生深色 NOT_CHECKED |
| 安装包 | 类型、构建、素材和导出、解包字节回读 | 类型/构建/109 测试/打包退出码均 0；最终包 22/22 文件字节一致，78 张内嵌牌图完整 |
| 真实模型质量 | 摘要准确性及真实解读质量 | NOT_CHECKED；本轮未授权真实 API |

## 隔离验证方法

仅使用 `.local/memory-acceptance/` 下的独立 DSH home、合成个人信息与本地模拟供应商。`DSH_PREVIEW_HOME` 可把 preview home 指向该目录；默认 preview 路径继续兼容既有流程。正式桌面 profile 与正式安装保持独立。

合成 canary 输入记录保存于扫描树以外，例如 `.local/memory-acceptance/canaries.json`，格式为 marker ID 到合成字符串的 JSON 对象，至少三个不同标记；可分别代表口令、生日/背景、用户问题、模型输出和供应商错误回显。所有验收资料必须是明确合成值。

```sh
DSH_PREVIEW_HOME=.local/memory-acceptance/home DSH_PREVIEW_PORT=19404 npm run preview
node scripts/verify-memory-privacy.mjs --root .local/memory-acceptance/home --canaries .local/memory-acceptance/canaries.json --output artifacts/verification-memory-2026-10-06/privacy-scan.json
```

扫描器只接受项目 `.local/memory-acceptance` 内的真实路径，不跟随符号链接；读取 raw 文件以及 zstd/gzip 解压内容，检查 UTF-8、UTF-16LE/BE、JSON 与 URI 编码的已知标记，报告只输出 marker ID 和哈希，无资料原文。默认 `--tree-kind host` 要求同时覆盖密文 storage 和 Session；`--tree-kind logs`、`--tree-kind browser` 分别只要求相应树有实际文件，报告明确标注 Session 和密文 storage 不适用，避免以错误的目录要求制造覆盖。文件无法读取或解压、所需覆盖缺失时为 `NOT_CHECKED`，命中标记为 `FAIL`。Chromium 的 `.ldb`/`.sst` 表块压缩未解码时也为 `NOT_CHECKED`，不能以 raw 未命中替代完整检查。`PASS` 只意味着本次已扫描文件中没有这些已知合成标记，不证明未知备份、浏览器内存、外部插件或供应商的隐私。

每次阶段结果登记具体命令、退出码和相对证据路径。完成后的完整测试/构建/打包由主实施任务集中执行；针对性测试仅在代码或发现变化后补跑。

## 已取得的 Host 隔离证据

`artifacts/verification-memory-2026-10-06/backend-acceptance.json` 记录 15 项合成集成检查，使用已安装 DSH 的真实 `JsonStorageBackend` 与 `JSONL/zstd` 后端。生成调用共 8 次，全部为本地 fixture，没有真实模型请求。

覆盖独立口令初始化、首解冻结、追问原版本、增量摘要与重复检查点去重、塔罗共享、错误回显、取消保留部分输出、5 份官方 Session 元信息读回、MemoryService 重建后锁定与恢复、改口令、替他人问停用、清空及陈旧页面提交失效。完整测试中的原有角色顺序、取消、超时、错误、模型目录竞争与跨模块锁断言均保留；相关四份测试文件 42/42 通过。

`backend-privacy-before-clear.json` 在文档及私人 audit 仍存在时扫描，`backend-privacy-scan.json` 在清空后扫描。每次包括 1 份真实密文 storage 和 14 份 Session/锁文件，共 15 文件；口令、生日、问题、模型输出与错误回显的 6 个合成标记均无命中，读取及 zstd 解压失败数为 0。清空前扫描用于确认有私人内容时的留存，避免只检查空文档。

scanner 自检另外验证 plain、zstd、gzip 三种明文样例都会报 `FAIL`、干净样例的已知标记不命中、正式 profile 范围外路径被拒绝；自检结果在 `.local/memory-acceptance/scanner-selftest/selfcheck.json`。新增树类型自检在 `scanner-tree-selftest/selfcheck.json`，验证日志/浏览器树覆盖标注、Host 缺失覆盖为 `NOT_CHECKED`、UTF-16 标记检出、未解码 LevelDB 表块保留 `NOT_CHECKED`。这些是扫描工具的合成自检，不计为插件隐私验收。

`memory-isolated/final-backend-tests.json` 读回为 16/16 Host 专项测试与类型检查通过，包含篡改认证、固定段落、第三方/引用/假设排除、摘要等待、编辑竞争、撤回与 20 版保留、失败不自动重试、显式重试、容量与生日冲突、在途清空、锁定与初始化/持久化竞争。超过 100 条已处理消息的检查点仍只发送新增用户消息；总输入上限为 60,000 字符和 3,000 条消息。Host 启动还显式依赖 `storage.backend.json`，避免 JSON 后端注册时序导致存储永久不可用。

`memory-isolated/module-tests.json` 记录另 8/8 G3 合成集成测试，通过真实 `MemoryService`、安装版 JSON backend 与两模块 Host 服务检查锁定时本地流程、后台摘要时本地流程、下一首解等待、跨模块冻结、未首解替他人设置及偏好恢复、清空后过期/缺失代次拒绝、准备期间竞争和旧检查点失效。私人 mutation 使用同步代次围栏，避免在异步目录或初始化等待后接受陈旧内容。

## Web 开发构建交互证据

官方 DSH CLI 使用独立 `.local/memory-acceptance/desktop-profile` home 与本地模拟供应商。交互链路为：设置口令、编辑背景 v1、梅花首解与追问均引用 v1、结束后摘要生成 v2、恢复早版产生 v3、重复结束不生成 v4、塔罗解读冻结 v3、锁定后两模块的当前私人会话清理。

`web-shared-memory.jpg` 已独立目视检查：解锁 v2 页面清楚显示生日 `1996-09-14` 与“出生时间不详”的原文，以及合成学习问题和追问进入同一背景。所有这些内容均为声明的合成资料，模型也是本地 fixture。

`web-memory-narrow.jpg` 已独立目视检查：350 像素宽截图中，共享背景面板的标题、当前 v3、锁定入口、编辑区、剩余容量与更新时间均可读；面板有纵向滚动空间，无水平截断。该截图验证文档面板的窄窗布局，其他模块的窄窗功能依各自交互证据登记。

生成结束且 profile 锁定后运行 `web-profile-privacy-scan.json`：22 个实际文件（8 个 Session/锁文件、1 个密文 storage）中，口令、背景、生日、问题与追问的 5 个 UI 标记无命中，读取/解压失败数为 0；插件 symlink 1 个未跟随。此报告验证的是该隔离 profile 文件树，截图与合成输入记录放在扫描树之外，便于复核。

`web-session-readback.json` 再用已安装官方 JSONL/zstd 后端的只读 handle 回读真实 Web runtime 生成的 3 份占卜 Session：梅花首解、梅花追问、塔罗首解。3/3 通过，背景版本为 1/1/3，路由均为 `meihua-offline / offline-demo`；每份只含 7 个元信息事件，自定义事件可忽略标记完整，不存在完整输入、输出或流式记录，也不包含任何 UI 私人标记。

## 首次构建与安装包证据（历史）

`build-checks.json` 记录 `npm run typecheck`、`npm run build`、`npm test` 与隔离 cache 的 `npm pack --ignore-scripts` 退出码均为 0；`tests.log` 读回为 109/109 通过，无失败、取消或跳过。

最终归档为 `artifacts/dsh-meihua-0.4.0.tgz`，11,516,385 字节，SHA-256 为 `60be2a424a5fab0c732c652fd081a42f751da184830b81d10c10f60f3d81365f`。`package-integrity.json` 验证归档内 22 个文件与隔离原生 home 中的安装目录 22 个文件逐字节一致；78 张内嵌塔罗牌图与打包来源清单哈希一致，公共 core/tarot 导出、本地起卦及洗牌规则 smoke 检查通过。归档不含源码 fixture、原始媒体、绝对用户目录或符号链接。

## 首次安装包的原生隔离验收（历史）

原生使用独立验收应用副本、`.local/memory-acceptance/native/home` 与独立 Chromium `user-data`，加载上述已逐字节核对的最终包。生成供应商仍为本地 `meihua-offline / offline-demo`，没有真实 API 调用、正式插件安装或正式 profile 变更。

实际操作记录覆盖：设置口令、写入合成生日 `1997-05-23` 与“出生时间不详”、两个手动固定段落、梅花首解 v1、一次完整追问、一次取消追问并保留部分输出、点击结束生成 v2、塔罗本地单张抽取与解读冻结 v2、手动锁定清除文档/当前两模块缓存、锁定后仍可洗牌、正确口令解锁、退出并重启、重启默认锁定、错误口令通用提示、正确口令恢复 v2 与两个固定段落。

`native-ui-acceptance.json` 登记 12 项真实原生操作观察。`native-shared-memory-v2.png` 已独立目视确认生日与时间不详原文、两个固定段落及新增的用户写作事实显示完整，助手解读没有进入个人事实。`native-memory-v2-ax.txt`、`native-restart-restored-ax.txt` 均读回完整 v2 文档、剩余 3,801 字符与两个固定段落；后者确认重启恢复后的实际原生 UI 状态。`native-restart-restored.png` 重新按原图读取后，独立目视确认同样恢复完整 v2 文档，SHA-256 为 `339bf0698f510198f747b1fd3c8019b382816a0ae7dbfa88cdc6d9c1cf333173`。

梅花、塔罗与追问的复制格式由既有 DOM 自动化测试覆盖，主题绑定由门户测试覆盖，均进入最终 109 项回归。此次原生操作在浅色界面进行，没有点击原生复制并回读系统剪贴板，也没有验证原生深色显示；这两项保留 `NOT_CHECKED`，不以模拟 DOM 或主题属性断言替代真实桌面观察。

退出后扫描的 `native-privacy-scan-index.json` 合并三个互不重叠的实际目录：home 42 文件（10 个 Session/锁文件、1 个密文 storage），logs 2 文件，Chromium user-data 65 文件，共 109 文件。三个报告均 `PASS`，5 个合成口令/生日/背景/问题/追问标记的命中数为 0，读取/解压失败、缺失必需覆盖与未解码 LevelDB 表块数均为 0。logs 与 browser 的 Session、密文 storage 需求明确为“不适用于该树”。应用副本、合成输入与截图未放入扫描树，本结果也不声称覆盖它们。

`native-session-readback.json` 用官方后端只读回读原生实际生成的 4 个占卜 Session，4/4 通过。梅花首解、完整追问、取消追问的背景版本均为 1；塔罗首解为 2。每份仅 7 个元信息事件，私人自定义事件均可忽略，无用户/系统/助手文本事件和合成私人标记；取消轮记录 `private/result.status=cancelled`，其他三轮为 `complete`。

`native-final-exit.json` 确认只终止本轮拥有的隔离应用进程，并读回最终 `dsh` 协议处理器为原来的 `com.deepseek.dsh`。启动时副本曾注册自己的 handler，随后只恢复这个副本的变更；未把“最终已恢复”写成“从未变更”。
