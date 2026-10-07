# 问象 0.4 Goal 完成审计

审计日期：2026-10-06。依据用户提供的 Goal 原文及当前源码，逐项核对 G0—G3 的共享记忆、加密、日志与兼容行为。G4—G9 是后续专项，不属于本次实施或完成判定。

本审计区分源码、当前源码测试和实际运行证据。测试数量、历史截图或先前的安装包不能单独证明当前交付完整；最终构建、归档、安装包完整性、隐私扫描与原生复验见本文末尾的交付检查点。

## 本轮发现与修复

1. 原文证据校验仍会把“我妹妹的生日”“我丈夫出生”“我孩子出生”等第三方经历，以及“我问模型得到的答案”“举例，非真实”保存为本人事实。本轮增加正向本人主体校验：`我的`后须为本人字段并满足字段边界；`我／本人`后须为时间副词及本人谓语、年龄或明确状态。未知名词主体默认不保存为 fact。所有 fact 都必须保留完整原陈述，不能截掉报告者、第三方主语或限定语；跨行模型转述同样排除。新增语义对照同时保留正常生日、出生时间不详、职业和计划，避免以拒绝所有内容代替正确提炼。
2. 原冲突判断只识别每个固定段落的第一个字段，生日与出生时间写在同一段落时，新的不同出生时间未标待核实。本轮改为检查每句、每行内全部明确字段，并覆盖出生信息、所在地、年龄、职业、婚姻及明确的偏好／约束。保留全部用户原文；同值、未知信息补充和不同偏好对象有对照测试。
3. 模型目录失败发生在 processed 标记前，后续普通检查点会自动重试。本轮把 failed 消息 ID 一并纳入自动抑制，只有 `retry:true` 才恢复失败消息的处理。没有选模型时仍显示待更新，可在选择模型后处理。
4. 同一轮旧消息失败、后来新消息成功时，原实现删除整轮 failed 清单，旧失败可能再次写回。本轮仅清除本次实际处理的失败 ID，并保留剩余失败的 pending 状态。
5. 首次摘要的加密保存失败时，失败围栏自身也可能无法持久化。本轮仅在 RAM 保留失败 ID 围栏，文档保持旧版、没有明文保存降级；存储恢复后的普通检查点不自动调用模型，明确重试才处理。

记忆审计修复修改 `src/host/memory-service.ts` 与 `tests/memory.test.ts`；主执行者另补 `tests/client-memory-flow.test.ts` 和 README 的 epoch 兼容说明。当前源码的 Host 记忆专项为 22/22、模块专项为 8/8，合计 30/30 通过；`npm run typecheck` 通过。该检查记录不替代最终全量回归或打包验收。

## 逐项证据矩阵

以下路径均相对项目根目录。行号用于定位本轮审计时的实现；文件随后变更时以实际代码与新检查记录为准。“已证明”表示明确实现及相应测试／运行证据存在，不能据此扩大成对所有模型、宿主插件或自然语言输入的保证。

| 计划要求 | 实现与有语义的测试证据 | 判定与边界 |
|---|---|---|
| 一份背景文档，按四类组织、上限 4,000 字符、编辑显示剩余容量 | `shared/memory.ts:3`；`MemoryPanel.tsx:18,82–83`；`memory-service.ts:18,166,284`；`memory-client.test.tsx:39` | 已证明 |
| 生日、时间、地点只用明确用户输入，保留不详、不转换日期 | `memory-service.ts:28–49,272–280`；`memory.test.ts:59,187,211,240` | 已证明原文与陈述边界校验；不做日期推算 |
| 手动新增或修改的固定段落自动更新时原样保留 | `memory-service.ts:166–174,284–292`；`memory.test.ts:59,160,227` | 已证明 |
| 明确冲突标为待核实 | `memory-service.ts:51–72,284–290`；`memory.test.ts:135,227,240` | 本轮修复并证明；全部固定段落显式字段、同值对照均有测试 |
| 提炼只读取新增用户问题／追问，助手文本和第三方经历不当本人事实 | `service.ts:126–127`；`tarot-service.ts:165–166`；`memory-service.ts:28–49,272–280`；`memory.test.ts:70,187,211` | 本轮修复并证明；自然语言边界见下文 |
| 结束、离开模块、另起一轮触发；临时宿主切走／刷新不触发 | `client/index.tsx:42–49,54,64–65`；`service.ts:59–62`；`tarot-service.ts:69–75` | 源码行为已核对；最终 UI flow 与原生证据须在交付检查点登记 |
| 检查点仅处理尚未提炼消息，无新增不调用模型 | `memory-service.ts:217–227`；`memory.test.ts:59,177,253` | 已证明 |
| 使用本轮所选模型，未选有效模型显示待更新 | `service.ts:126`；`tarot-service.ts:165`；`memory-service.ts:226`；`memory.test.ts:105,253` | 已证明 |
| 成功自动保存新版本，并显示更新时间、来源和变化 | `memory-service.ts:159–164,264–268`；`MemoryPanel.tsx:83,89–90`；`memory-client.test.tsx:39` | 已证明 |
| 失败、取消、不合格输出保留上一版，不自动重试 | `memory-service.ts:224,228–236,257–268`；`memory.test.ts:70,88,105,125,253,272` | 本轮补全目录失败、混合新旧消息及加密保存失败的抑制 |
| 最近 20 个加密版本，撤回生成新版本，已处理消息不复活 | `memory-service.ts:159–164,176–182`；`memory.test.ts:96,160` | 已证明 |
| 自动更新、手动编辑、撤回共用写入队列和 CAS，晚摘要不覆盖编辑 | `memory-service.ts:117,166–182,260–268`；`memory.test.ts:88,151` | 已证明 |
| 首次 AI 解读冻结背景；起卦、洗牌、抽牌本地执行 | `memory-service.ts:121–126`；`service.ts:72–78`；`tarot-service.ts:111–118`；`memory-module.test.ts:49,56,65` | 已证明 |
| 下一首解等待后台摘要，摘要失败使用上一成功版本 | `memory-service.ts:121–126`；`memory.test.ts:70,79,88,105`；`memory-module.test.ts:56` | 已证明 |
| 同次追问沿用开始时快照及本次问答 | `service.ts:94`；`tarot-service.ts:132`；`memory-module.test.ts:65` | 已证明 |
| 背景作为 user 资料块，不注入 system | `private-generation.ts:25–28,53`；`memory-module.test.ts:65` | 已证明 |
| 清空文档、版本、审计和当前缓存，取消任务并拒绝旧页面 | `memory-service.ts:195–208`；`memory-store.ts:35–37`；模块 `onInvalidate`；`memory.test.ts:115,170`；`memory-module.test.ts:85,93,113`；`memory-client.test.tsx:163,176` | 已证明 |
| Host 唯一 MemoryService，两模块引用同一实例 | `host/index.ts:16–18` | 已证明 |
| 使用宿主 storage 保存密文，没有 filesystem 或明文降级 | `memory-store.ts:17–33`；`memory.test.ts:35,105,272`；真实 JSON／zstd 后端扫描记录 | 源码与失败路径已证明；最终包扫描需重新登记 |
| AES-256-GCM、随机 DEK、异步 scrypt 指定参数、盐至少 16 字节、每次随机 nonce/tag | `memory-vault.ts:10,35–41,58–60` | 已证明；`N=131072,r=8,p=1`，salt16、nonce12、tag16 |
| 改口令只重新包装数据密钥 | `memory-vault.ts:71–73`；`memory-service.ts:184–193`；`memory.test.ts:35` | 已证明 |
| 错口令、篡改拒绝解锁，重启需要解锁并可恢复 | `memory.test.ts:35,52`；隔离 native restart/recovery 的 AX 与截图 | 测试已证明；当前最终包的原生身份与复验另登记 |
| 普通 Session 只元信息，私人上下文、输出、供应商错误进入密文 | `private-generation.ts:41–53,75–89`；`memory-service.ts:242–269`；`backend-acceptance.json` 与 Session 读回 | 已证明路径；最终包隐私扫描与 Session 读回另登记 |
| `GenerateOptions.sessionId` 可选，private 调用省略 | `platform.ts`；`private-generation.ts:53`；`memory-service.ts:253`；`memory.test.ts:64`；`memory-module.test.ts:34` | 已证明；不扩大为隔离所有宿主插件 |
| 认证 `/api/memory/*`，编辑／撤回带版本，结果附背景使用状态 | `shared/memory.ts:4`；`host/index.ts:25`；`transport.ts:14–25`；安装版 `dsh-client-connection/lib/index.js:585–588,833–840`；`memory-client.test.tsx:87`；`memory.test.ts:170` | 宿主 `/api` admission 先校验信任与认证；实际 HTTP probe 由交付检查点登记 |
| 锁定仍可本地起卦／抽牌／释义；AI 必须解锁；锁定清缓存与取消 | `memory-service.ts:115,152–155`；模块 invalidation；`memory-module.test.ts:49`；`memory-client.test.tsx:59,87,163` | 已证明 |
| 单用户，无云同步、人物档案、向量数据库或完整历史列表 | 当前实现与 `MemoryPanel.tsx`；README 的首版范围 | 已核对范围 |
| 明文仍发送供应商；忘口令无法恢复；旧普通日志不迁移或删除 | `MemoryPanel.tsx:76,93,97`；README、验收文档 | 已明确交付边界 |

## 自然语言与隐私证据边界

原文连续引用只能证明“模型没有凭空新增这些文字”，不能单独证明这些文字属于本人。本轮因此同时验证本人主体、完整陈述、限定与间接来源，采用保守规则。模糊主体、转述、例子和含第三方经历的事实候选可能被排除；用户可直接编辑背景保留自己确认的内容。该规则不声称解决任意自然语言中的人物身份识别。

冲突检查比较明确字段和互斥表达，保留原文与待核实标记，不推导模糊状态之间的矛盾，不改写、补齐或转换日期。未知出生时间补充已知时间不自动判成冲突；不同偏好对象不视为冲突。复杂时间变化、兼任职业或无法归入明确字段的状态仍需用户核对。

模拟供应商测试验证流程与证据校验，不能证明真实模型的提炼／解读质量。加密保护本地保存内容，模型请求仍将相关明文发送给所选供应商。省略 `sessionId` 与当前已核实的 DeepSeek Session 日志贡献器有关，不能推广为对所有宿主插件的隔离。

隐私扫描的 PASS 仅指已检查文件中没有指定合成 canary，不证明外部备份、未覆盖的浏览器压缩块、浏览器内存、其他宿主插件或供应商侧留存。扫描范围、读取失败、解压失败和未覆盖内容必须由最终报告明确列出。

## 最终交付检查点

本轮修复完成后，旧安装包 hash、源码 hash 或旧原生运行记录不能直接作为当前最终交付证据。以下检查点已依据最终包与实际运行报告完成登记。

| 检查点 | 当前最终结果及权威证据 |
|---|---|
| 最终源码身份与变更范围 | `goal-build-checks.json` 记录本轮 memory-service、两份新测试、README 与 lib 产物哈希；完成记录补充保守来源、显式冲突、失败抑制与 epoch 兼容说明。 |
| 最终类型检查、构建、全量回归 | 类型检查、构建、测试、打包退出码均为 0；`goal-tests.log` 为 **119/119 PASS**，无失败、取消、跳过；`goal-build-checks.json`。 |
| 最终安装包路径、大小、SHA-256 | `artifacts/dsh-meihua-0.4.0.tgz`；11,518,278 字节；SHA-256 `fdfff8a18df1b579aa54676bca8b92d11e230534949cb92e651ff62714733980`。旧归档独立保留，不再作为当前包身份。 |
| 归档与隔离安装目录逐字节一致性、78 张牌图 | `goal-package-integrity.json`：22/22 文件字节一致，78 张图像与来源哈希一致，公共 core/tarot 与本地算法 smoke 通过。 |
| 当前源码的 UI flow 回归与 authenticated HTTP probe | `client-memory-flow.test.ts` 四项端到端控制器/实际 RPC/Host/真实 storage 测试均对两模块执行；离开模块、直接新轮、单次不用背景仍写本人信息、暂时切走及重挂载不提炼。`goal-memory-auth-probe.json`：三个未认证端点 401，跨源请求 403；认证 UI 操作成功。 |
| 当前最终包的隔离原生复验、截图与 AX 读回 | `goal-native-ui-acceptance.json`：启动锁定、解锁恢复 v2；梅花首解 v2，直接切换自动 v3，塔罗首解 v3；直接另起一轮自动 v4；实际深色、固定两段、手动锁定清缓存及本地抽牌仍可用。`goal-native-memory-v3.png`、`goal-native-memory-v4-dark.png` 与对应 AX 已读回及目视。Web 两模块 350px、深浅主题、十张抽牌、追问与实际浏览器剪贴板见 `goal-web-ui-acceptance.json`。 |
| storage、普通 Session、临时／错误／诊断文件与 browser profile 隐私扫描 | `goal-native-privacy-scan-index.json` 三树 117 文件，7 个已知合成标记 0 命中，读取/解压失败与未覆盖块均 0；Web 30 文件 0 命中。`goal-native-session-readback.json` 6/6 与 Web 7/7 官方 JSONL/zstd 只读回读，每个占卜 Session 7 个元信息事件，无私人文本。JSON storage 临时写入沿用已加密 value，扫描范围包括 home 内临时文件。 |
| 正式应用／profile 未变更、协议处理器恢复、隔离进程终态 | `goal-native-final-exit.json` 确认只结束隔离 PID 91256，dsh 处理器为原来的 `com.deepseek.dsh`，主题偏好/viewport 已恢复；正式安装、正式 profile、提交、推送均未操作。 |
| 模拟供应商与真实模型质量的分别登记 | 全部生成使用本地 fixture 和合成资料。真实模型提炼/解读质量 **NOT_CHECKED**；原生系统剪贴板读回 **NOT_CHECKED**，Web 真实浏览器剪贴板通过，两者不混同。 |
| G0—G3 最终完成判定及 G4—G9 后续状态 | G0—G3 的 0.4 验收终点已达到，可将当前 Goal 完成。G4—G9 保持未启动；详见 `roadmap.md`。 |
