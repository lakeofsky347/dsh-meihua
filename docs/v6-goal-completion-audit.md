# 问象 0.6.0：G4—G9 完成审计

核对日期：2026-10-07（Asia/Shanghai）。本次已完成用户要求继续推进的 G4—G9：G4—G7 为可运行功能，合并为 0.6.0；G8 为完整签库内容包与模块施工规格；G9 为四个候选体系各自的需求、规则样例、依赖成本和实施计划。没有另外发布 0.5，也没有将 G8/G9 文档范围扩写成已实现运行模块。

本次全部解读、追问与自动摘要采用本地模拟供应商。算法对照、自动化检查、安装包回读、实际 Web/原生界面和私人明文扫描分别记录；这些结果不证明真实模型解读质量。

## Goal 完成矩阵

| Goal | 交付与完成依据 | 状态 |
|---|---|---|
| G4 | 五模块同一目录、门户导航与状态恢复；唯一 MemoryService/GenerationGate；共享私人生成、取消、追问与精确 Connection RPC。梅花/塔罗保留独立服务与结果，三个新模块共用 MethodService。新增模块接入步骤与兼容约束已写入规则说明。 | PASS |
| G5 | 固定月日时顺数、六位本地释义和计数过程；原书“三月初五辰时得小吉”对照；闰月、零点、时区与计数边界；实际页面指定 2024-04-13 08:00 / Asia/Shanghai 复现农历三月初五辰时与小吉。 | PASS |
| G6 | 36 张完整编号、原创中文释义与 36 张原创 SVG；三张/五张排列、无重复抽取、中心主题、相邻组合和五张镜像；本地组合语法明确为候选解释。实际原生三张、Web 五张、首解、追问、取消与复制通过。 | PASS |
| G7 | 六次三币模拟或手录 6/7/8/9，自下而上；多动爻、本卦/变卦、八宫、纳甲、世应、六亲、六神、月建日辰、旬空；静乾卦和古籍屯之震人工表、十二交节及日期边界对照。实际六行完整表与共享记忆接入通过。 | PASS |
| G8 | 固定关帝清刊校订 100 签：100 签号、400 七言诗句、2,800 诗字、逐条出处与原扫描页码、原创中文释义与关键词、异文和修复记录、许可；独立施工规格及 44 文件内容包完整性回读。 | PASS_CONTENT_SPEC |
| G9 | 八字、占星、奇门、卢恩各一份独立需求，含固定规则样例、依赖许可成本、步骤和验收；总评、主来源快照与哈希清单；独立文档复核无未解决项。建议八字优先，其他候选另立专项。 | PASS_DOCUMENTATION_SCOPE |

G8 未实现抽签按钮或运行服务，人工第二遍审校为 NOT_CHECKED。G9 未实现四候选运行模块，没有执行候选八字适配器或真实星历；维护者测试期望、人工数学样例和古籍人工盘的证据层级均在各自文档中标明。

## 已交付文件

- 插件：`artifacts/dsh-meihua-0.6.0.tgz`，11,682,580 字节，40 文件。
- 插件 SHA-256：`1793edefa73eabd092cbff2348bc75bd82bf1c5b0000588b868727d03d1e3331`。
- 签库：`artifacts/guandi-qing-collated-100-1.0.0.tgz`，35,277,171 字节，44 文件。
- 签库 SHA-256：`0e715c73ace15ea57c728e1fb43afc90038c024d14725a67ff4016b97c3c9fa6`。
- [G4 接入机制](g4-module-framework.md)、[G5 小六壬规则](g5-xiaoliu-rules.md)、[G6 雷诺曼规则](g6-lenormand-rules.md)、[G7 六爻规则](g7-liuyao-rules.md)。
- [G8 内容包与模块规格](g8-lot-module-spec.md)、[签库正文](../content/lot/guandi-100/lots.json)、[签库来源与校订](../content/lot/guandi-100/collation.json)。
- [G9 总评](g9-candidate-evaluation.md)、[八字需求](g9-bazi-requirements.md)、[占星需求](g9-astrology-requirements.md)、[奇门需求](g9-qimen-requirements.md)、[卢恩需求](g9-runes-requirements.md)。

0.4 既有包与验收文件保留，没有覆写：[0.4 完成审计](v4-goal-completion-audit.md)、[0.4 记忆验收](v4-memory-acceptance.md)。0.4 最终包 SHA-256 为 `fdfff8a18df1b579aa54676bca8b92d11e230534949cb92e651ff62714733980`。

## 自动化、规则与打包

| 检查 | 结果与证据 |
|---|---|
| 类型检查 | `npm run typecheck` PASS；保存日志 `artifacts/verification-v6/typecheck.log`。 |
| 构建 | `npm run build` PASS；五个公开纯核心、Host 和客户端产物完成；保存日志 `artifacts/verification-v6/build.log`。 |
| 全仓回归 | `npm test`，169/169 PASS，0 fail/cancelled/skipped，约 10.56 秒；保存日志 `artifacts/verification-v6/tests.log`。 |
| 新核心 | 小六壬 6 项、雷诺曼 8 项、六爻 12 项；属于上列 169 项，不重复累计。 |
| 新模块接入 | Host/Memory/RPC 8 组、真实控制器到 Connection/Host/密文后端的 DOM 回归 9 组；三体系结果、冻结背景、版本、取消、晚到回复、部分记录复制和非首项模型恢复。 |
| 插件归档 | [package-integrity.json](../artifacts/verification-v6/package-integrity.json)：显式路径白名单、40 文件、相对 import 边、全部逐字节一致、纯核心导出可加载；78 既有 Tarot WebP 与 36 原创 Lenormand SVG 的嵌入、哈希和许可核对。 |
| 原生安装副本 | [native-package-integrity.json](../artifacts/verification-v6/native-package-integrity.json)：与上述最终归档同一 SHA，40 文件逐字节一致。 |
| 签库 | [lot-package-integrity.json](../artifacts/verification-v6/lot-package-integrity.json)：44 文件安全解包、34 个清单记录哈希、100/400/2,800 数量和声明 schema 关键字验证；不声称完整 Draft 2020-12 验证器兼容。 |
| G9 | [g9-independent-review.json](../artifacts/verification-v6/g9-independent-review.json)：6/6 文档哈希、7/7 内嵌来源正文哈希、9/9 相对链接，无未解决项；独立复核没有重新获取外部报价。 |
| 工作区差异 | `git diff --check` PASS；最终验收清单记录源码与证据文件哈希。 |

六爻 vendor 固定为 `lunar-javascript 1.7.7`，MIT，来源与许可进入安装包。香港天文台 2026 年十二个“节”的分钟精度官方表与本地交节时间对照，最大差值 28 秒；这只支持与该分钟表一致，不宣称秒级天文认证。前后五分钟、跨时区、民用零点、1900—2100 输入边界与人工装卦表分别核对。晚子时不提前换民用日期，未加入真太阳时。

## 最终归档的实际界面验收

原生副本使用独立 bundle `com.local.dsh.memory-v06.acceptance-1793edefa73e`、独立 DSH home 和浏览器 user-data。正式应用原始 ASAR 在准备和收尾时核对；复制程序只改副本身份元数据，11,479 个打包运行条目与 1,493 个 unpacked 文件保持原始内容。副本启动临时注册的 `dsh` 协议已恢复为 `com.deepseek.dsh`。身份、启动与协议恢复原始记录及收尾 SHA 见 [native-isolation-evidence.json](../artifacts/verification-v6/native-isolation-evidence.json)。最后退出的是该最终验收副本；用户正在使用的候选副本和正式应用未由此收尾关闭。

| 实际操作 | 观察到的结果 |
|---|---|
| 三新模块本地规则 | 小六壬月日时三宫和释义；原生雷诺曼三张与 Web 五张不重复、相邻/镜像；六爻六次手录与完整字段。 |
| 共享背景 | 原生合成出生信息固定保留，明确本人学习/练习陈述使文档从 v1→v2→v3；Web 雷诺曼结束生成 v2，随后六爻首次解读使用 v2。 |
| 旧轮冻结 | 原生背景文档已经 v3，返回旧雷诺曼仍为 v1，追问完成继续沿用 v1；Web 多次切换回来也保留最初五张与 v1。 |
| 流式与取消 | Web 第二轮追问在收到文本后取消，显示“回答已取消”并保留已生成前缀；后续 UI 和终态恢复。 |
| 复制 | 实际点击后读取剪贴板：五张牌、结果、首解、追问和取消输出齐全，私人背景正文与 Host 暗牌集合未复制。 |
| 旧模块回归 | Web 梅花本地起卦，塔罗洗牌、背牌选择和单牌揭示均可用；全仓原有测试继续通过。 |
| 窄窗 | 390×844 的工具窗口设置在当前缩放下对应 325×703 CSS 视口；页面 scrollWidth 等于 clientWidth 325，顶部导航下沿与模块顶部均为约 99.73px，无重叠。六爻表格自身区域 `overflow-x:auto`、宽 201/700，横向滚动局限于表格。 |
| 主题 | 在隔离 Web 设置中实际切换浅色与深色、保存截图，再恢复跟随系统。 |
| 锁定 | 原生显示“已锁定，当前页面的私人内容已清理”；旧雷诺曼和小六壬表单不含合成私人标记。锁定后仍可本地起课，AI 与结束更新按钮禁用。 |
| 浏览器控制台 | 最终 Web 控制台 error 条目 0。 |

记录：[browser-acceptance.json](../artifacts/verification-v6/browser-acceptance.json)、[native-acceptance.json](../artifacts/verification-v6/native-acceptance.json)。截图位于 `artifacts/verification-v6/screenshots/`，其中 `native-shared-v3.png`、`native-lenormand.png`、`web-lenormand-five.png`、`web-six-lines-table.png`、`web-xiaoliu-fixed-date.png` 和窄窗主题图为最终包；历史 `native-portal.png` 仅是早期候选记录，不用于最终包身份证明。指定日期快照作为独立审查发现记录缺口后的补证存入浏览器 JSON；没有因补证修改源码或归档，也没有调用模型。补证后的 Web Host 扫描仍为 19 文件、0 命中。

候选包曾在同版本来源被客户端缓存，导致指定时间复验读到旧输入实现。最终源码在开始本地起课前读取实际 datetime 控件值，并在全新来源重新验收：小六壬 2024-04-13 08:00 与六爻 2024-02-10 12:00 均按输入转换正确。最终 169 项回归和上述 SHA 均在该修复之后产生。

## 加密与普通日志留存

五模块继续使用唯一背景文档、独立口令、随机数据密钥与 AES-256-GCM；异步 scrypt 的既定参数和每次随机 nonce/标签保持。新版个人输入、背景版本、首解、追问、摘要和取消后的部分输出只走私人加密记录。普通 Session 只保留模块、随机请求 id、背景版本、路由、计量、稳定错误码与终态，不传入完整私人上下文。

最终原生和 Web 在停止生成、退出副本后检查，输入仅为合成标记。扫描 raw、UTF-8、JSON 转义、URI、UTF-16LE/BE 与支持的 gzip/zstd 解压表示；本轮原生浏览器树没有需额外解码的 LevelDB table。四树共 141 文件，私人标记命中为 0。

| 扫描 | 文件数 | 覆盖 | 结果 |
|---|---:|---|---|
| [原生 Host](../artifacts/verification-v6/privacy-native-host.json) | 64 | 含 1 个密文 storage、14 个 Session 路径文件 | PASS |
| [原生日志](../artifacts/verification-v6/privacy-native-logs.json) | 2 | 验收副本运行/诊断日志 | PASS |
| [原生浏览器](../artifacts/verification-v6/privacy-native-browser.json) | 56 | 独立 user-data 中的实际缓存/存储文件 | PASS |
| [Web Host](../artifacts/verification-v6/privacy-web-host.json) | 19 | 含 1 个密文 storage、10 个 Session 路径文件；一个已知包 symlink 不跟随，包单独完整性核对 | PASS |

使用正式 DSH JSONL/zstd 后端以只读模式回读原生 6 个、Web 4 个插件 Session；[原生回读](../artifacts/verification-v6/native-session-readback.json)和 [Web 回读](../artifacts/verification-v6/web-session-readback.json)均 PASS。每个 Session 恰有七条预期元信息事件，两条 `private/*` 可忽略事件，没有 `system/user/assistant/*` 正文事件、合成私人标记或真实供应商路由。

扫描结论限定这些隔离树中的已知合成标记，不能推导成所有浏览器格式、外部插件、供应商、备份、内存或任意私人文本均已排除。Web 的 Codex 浏览器自身数据目录不在此次树扫描内，实际原生浏览器 user-data 已独立覆盖。当前宿主省略 `GenerateOptions.sessionId` 的私有生成方式避开其 DeepSeek Session 日志贡献器；不宣称隔离所有宿主插件。旧版普通日志未迁移或删除。

## 交付边界与后续最小动作

- 真实供应商解读与摘要语义质量：NOT_CHECKED，未消耗真实模型 API。
- 正式用户环境安装/启用、Git 提交和推送：未执行；本轮仅在独立验收环境安装最终包。
- G8 人工第二遍审校、抽签运行模块：分别 NOT_CHECKED / NOT_IMPLEMENTED_G8_SCOPE。
- G9 四候选运行模块、精确宿主 tzdb 与真实星历测试：NOT_IMPLEMENTED_G9_SCOPE / NOT_CHECKED；评估来源版本与报价只代表注明日期的核查。

下一项建设可按 G9 建议另立八字专项，从出生输入合同与独立人工例盘开始；抽签也已具备完整内容包与施工规格，能独立实施。两者都继续复用现有私人存储、冻结背景与清空/锁定 epoch 合同。
