# 问象开发指南

[返回使用指南](../README.md)

本文面向需要修改、测试或扩展插件的开发者，内容对应 `dsh-meihua 0.6.0` 和 DeepSeek Harness 桌面端 `0.2.0-rc.2`。日常安装、起卦、抽牌和共享背景的操作请先看使用指南。

## 1. 准备本地环境

插件源码位于本仓库。参考仓库 `dsh_clone` 和已安装的 DSH 桌面应用用于读取接口、运行库与开发工具，不应在开发插件时顺带修改它们。

依赖版本以 [package.json](../package.json) 为准。脚本使用 Node.js 的 `import.meta.dirname` 等能力，隐私扫描还使用 `node:zlib` 的 `zstdDecompressSync`；运行这些脚本时，需要支持相应 API 的 Node.js。完整集成测试会直接加载 `.local/runtime` 下的正式 DSH JSON storage 和 JSONL 后端，因此仅安装 npm 依赖不足以运行全部测试。

在已有 DSH 桌面安装和参考仓库依赖的本机环境中，可以复用现有工具：

```sh
npm run prepare:local
npm run typecheck
npm run build
npm test
```

[`prepare:local`](../scripts/prepare-local.mjs) 会读取桌面应用的 `app.asar`，把 DSH 运行库提取到本仓库的 `.local/runtime`，并在本仓库 `node_modules` 建立指向现有工具和运行库的符号链接。它不下载依赖，也不修改参考仓库或桌面安装。

该脚本目前使用本机路径作为默认值，换到其他机器时应显式指定：

| 环境变量 | 脚本默认值 | 说明 |
| --- | --- | --- |
| `DSH_RESOURCES` | `/Applications/DeepSeek Harness.app/Contents/Resources` | 需包含 `app.asar` 和相应的 `app.asar.unpacked` |
| `DSH_REFERENCE` | `/Users/skylake/Work/Projects/dsh_clone` | 需已有脚本使用的开发依赖；不是自动推导的相邻目录 |

例如，参考仓库确实位于相邻目录时，在本仓库根目录运行：

```sh
DSH_REFERENCE="$(cd ../dsh_clone && pwd)" npm run prepare:local
```

脚本会跳过已经存在的提取文件和链接。更换 DSH 版本后，应先核对 `.local/runtime` 和链接实际指向的版本；重复执行 `prepare:local` 不会自动覆盖旧运行库。

## 2. 启动隔离预览

先构建，再启动：

```sh
npm run build
npm run preview
```

[`preview`](../scripts/preview.mjs) 使用官方 `dsh` CLI，在默认 `.local/test-home` 中创建并运行 `meihua-v1` profile，将其插件依赖链接到当前仓库。它还写入 `.local/offline.patch.yml`，关闭脚本列出的真实供应商插件，并注册测试专用供应商。

打开终端输出的本地地址，在插件中选择 **「本地演示 · 模拟供应商」→「模拟解读（不调用真实 API）」**。这条路线适合检查首次解读、追问、流式文字、取消、背景提炼和并发限制。首次使用仍需为这个隔离 profile 设置测试口令。

模拟供应商来自 [tests/fixtures/preview-provider.mjs](../tests/fixtures/preview-provider.mjs)，输出是本地夹具，不能用于评价真实模型的解读质量，也不进入发行包。使用新建测试目录最容易保持预览环境可控；不要把日常 DSH 数据目录设为预览目录。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DSH_CLI` | `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` | 指定官方 CLI |
| `DSH_PREVIEW_HOME` | `.local/test-home` | 指定隔离数据目录，相对路径按仓库根目录解析 |
| `DSH_PREVIEW_PORT` | `19402` | 指定本地端口 |
| `DSH_PREVIEW_PLUGIN` | 当前仓库 | 指向已构建的插件或解压后的 `package` 目录 |
| `DSH_DEMO_DELAY_MS` | `400` | 模拟解读每段输出的间隔，单位为毫秒 |
| `DSH_DEMO_SUMMARY_MODE` | `valid` | 背景提炼夹具：`valid`、`invalid`、`failure` 或 `slow` |

预览不包含自动构建或文件监听。修改源码后需重新构建；修改 Host 代码后需重启预览，客户端修改需重新加载页面。验证安装包时，把 `DSH_PREVIEW_PLUGIN` 指向该包的解压目录，避免只测到了工作区的构建结果。

## 3. 构建、打包和验证

常用命令的作用如下：

| 命令或脚本 | 检查内容与产出 |
| --- | --- |
| `npm run typecheck` | 执行 `tsc --noEmit`，检查 TypeScript 类型 |
| `npm run build` | 校验并内嵌塔罗图像，生成 Host、客户端、五个规则入口、声明文件及素材许可记录，产出到 `lib/` |
| `npm test` | 执行 `tests/*.test.ts` 与 `tests/*.test.tsx`；包含本地规则、服务、记忆和客户端流程检查 |
| `npm pack --pack-destination artifacts` | 先执行 `prepack` 中的类型检查与构建，再生成 npm 安装包；不会自动执行 `npm test` |
| `node scripts/verify-package.mjs …` | 比对安装包与已解压目录，检查包结构、素材哈希、许可、导出与规则样例 |
| `node scripts/verify-frontend.mjs` | 在真实隔离 Web 运行时检查五模块本地操作、主题、宽窄布局并截图；不点击 AI 解读或追问 |
| `node scripts/verify-memory-privacy.mjs …` | 检查隔离验收资料中的合成标记是否出现在指定文件树中 |
| `sh scripts/test-git-hooks.sh` | 在临时克隆和本地 bare 仓库中验证 `video/` 的提交与推送拦截 |

### 安装包回读

当前包清单允许 `lib/`、`cordis.patch.yml`、`README.md` 和 `LICENSE`，npm 还会包含 `package.json`。`docs/`、测试、原始素材下载目录与模拟供应商不在当前发行清单中。本开发指南中的相对链接用于源码仓库浏览。

以下示例适用于当前 `0.6.0` 版本。解压前请确认目标是本次专用的空目录，防止旧文件影响回读：

```sh
npm test
npm pack --pack-destination artifacts
mkdir -p .local/package-readback
tar -xzf artifacts/dsh-meihua-0.6.0.tgz -C .local/package-readback
node scripts/verify-package.mjs \
  artifacts/dsh-meihua-0.6.0.tgz \
  .local/package-readback/package \
  artifacts/verification-package/package-integrity.json
```

[`verify-package.mjs`](../scripts/verify-package.mjs) 的三个位置参数依次是安装包、已解压的 `package` 目录、输出报告。脚本不负责解压。它目前明确支持 `0.4.x` 与 `0.6.x` 的文件布局，并对文件数量、共享 chunk 数量和导出设有固定断言。调整发行内容时，需要同时审查这些断言，不能把旧脚本的通过结果直接沿用到新包。

### 前端浏览器复核

在一个终端启动专用预览：

```sh
DSH_PREVIEW_HOME=.local/frontend-review-home \
DSH_PREVIEW_PORT=19408 \
npm run preview
```

在另一个终端运行：

```sh
node scripts/verify-frontend.mjs
```

如果运行时要求带临时令牌的入口，将终端输出的完整本地地址设为 `DSH_FRONTEND_URL` 后再运行脚本。脚本也会尝试读取 `.local/frontend-review-preview.log` 中的地址，但预览命令本身不会自动创建该日志。不要把含令牌的地址写入公开文档或截图。

该脚本仅接受回环地址，会阻止浏览器外部请求和解读、追问请求。报告和截图写入 `artifacts/verification-frontend-20261007/<运行时间>/`。可用 `DSH_FRONTEND_BROWSER` 指定浏览器程序，用 `DSH_FRONTEND_ARCHIVE` 指定报告关联的安装包。

脚本当前从本机 Codex 依赖目录加载 Playwright，并默认使用 macOS 的 Google Chrome 路径。这是本机复核工具，不是开箱即用的跨平台测试器；迁移机器时需核对脚本开头的依赖路径。报告关联的安装包哈希也不代表预览必然加载了该包，应一并核对报告中的实际插件路径与 bundle 哈希。

### 隐私和历史验收脚本

[`verify-memory-privacy.mjs`](../scripts/verify-memory-privacy.mjs) 只允许扫描本仓库 `.local/memory-acceptance` 内的测试目录，不接受日常 DSH 数据目录。需要先准备至少三个有辨识度的合成标记，标记文件和输出报告均须位于扫描树之外。例如：

```sh
node scripts/verify-memory-privacy.mjs \
  --root .local/memory-acceptance/home \
  --canaries .local/memory-acceptance/canaries.json \
  --output artifacts/verification-memory/privacy-scan.json \
  --tree-kind host
```

`--tree-kind` 可选 `host`、`logs` 或 `browser`。报告会列出未验证、跳过和编码限制；无标记命中不等于覆盖了所有存储格式。

[`read-v2-logs.mjs`](../scripts/read-v2-logs.mjs) 是 `0.2.0` 的历史日志回读工具，依赖当时的安装包、提取目录和验收记录，不是当前版本的通用日志检查入口。当前与历史的证据分别见 [0.6 验收记录](v6-goal-completion-audit.md)、[0.4 记忆验收](v4-memory-acceptance.md) 和 [0.4 完成审计](v4-goal-completion-audit.md)。本地测试、模拟供应商、真实模型联调、正式安装应分别记录。

## 4. 插件配置

默认配置在 [cordis.patch.yml](../cordis.patch.yml)，由 [parseConfig](../src/host/validation.ts) 在插件加载时校验。配置解析器要求这些字段完整存在，不在解析时补默认值。

| 字段 | 默认值 | 接受范围与作用 |
| --- | --- | --- |
| `timeZone` | `Asia/Shanghai` | 运行环境 `Intl.DateTimeFormat` 支持的时区，用于默认时间解释 |
| `animationMs` | `4800` | `0–15000` 的整数，梅花起卦仪式时长，单位为毫秒 |
| `interpretationTimeoutMs` | `120000` | `1000–600000` 的整数，生成超时，单位为毫秒 |
| `maxOutputTokens` | `3000` | `256–16000` 的整数，常规解读与追问的输出上限 |
| `pollIntervalMs` | `250` | `100–2000` 的整数，客户端轮询间隔，单位为毫秒 |

塔罗凯尔特十字的首次解读在服务中单独使用 `5000` tokens 上限；追问仍使用通用配置。背景提炼使用 `min(3000, maxOutputTokens)`，不能把 `maxOutputTokens` 理解为所有模型请求的统一上限。修改工作区配置或提示词后，已安装的旧包不会自动更新。

## 5. 代码入口与独立规则模块

| 位置 | 负责内容 |
| --- | --- |
| [src/host/index.ts](../src/host/index.ts) | 创建唯一的 `MemoryService`、`GenerationGate` 和五模块服务，注册 RPC |
| [src/shared/modules.ts](../src/shared/modules.ts) | 门户、导航和服务共用的内置模块目录 |
| [src/host/module-framework.ts](../src/host/module-framework.ts) | 背景选项、模型路由和目录校验 |
| [src/host/private-generation.ts](../src/host/private-generation.ts) | 流式生成、终态、取消、私人加密记录和普通 Session 元信息 |
| [src/host/conversation.ts](../src/host/conversation.ts) | 冻结结果下的追问、完整上下文和轮次校验 |
| [src/client/](../src/client/) | 页面、控制器、主题、导航与本地素材呈现 |

五个规则入口通过包导出提供，不要求先启动插件页面：

| 导入路径 | 主要导出 |
| --- | --- |
| `dsh-meihua/core` | 梅花类型、`RuleRegistry`、`timeRule`、`threeNumberRule`、`lunarMoment`、`remainder`、八卦与六十四卦推导 |
| `dsh-meihua/tarot` | 牌组和牌阵类型、`TAROT_CARDS`、`TAROT_SPREADS`、查找函数、`shuffleTarotDeck` |
| `dsh-meihua/xiaoliu` | 类型、`XIAOLIU_PALACES`、约定和 `calculateXiaoliu` |
| `dsh-meihua/lenormand` | 类型、牌组、排列、组合、原创素材、`createLenormandDeck` 和 `calculateLenormand` |
| `dsh-meihua/liuyao` | 类型、三币常量、纳甲表、八宫和六亲辅助函数、`liuyaoCalendar` 与 `calculateLiuyao` |

这些规则入口接收明确输入，不调用模型或读取共享背景。塔罗和雷诺曼洗牌需由调用方注入有界随机函数；Host 使用 `crypto.randomInt`，测试可注入固定来源。梅花、小六壬使用运行环境 ICU 的中国农历能力；六爻节气与日干支使用随包提供的固定历法源码。

梅花和塔罗保留各自服务与页面，另三个模块使用 `MethodService`、`MethodController` 和 `MethodPage`。当前是内置模块接入机制，没有面向外部插件的动态模块市场。模块生命周期和新增模块要求见 [内部模块接入说明](g4-module-framework.md)；规则约定分别见 [小六壬](g5-xiaoliu-rules.md)、[雷诺曼](g6-lenormand-rules.md) 和 [六爻纳甲](g7-liuyao-rules.md)。

## 6. 扩展梅花起卦规则

Host 提供 `ctx.meihua` 服务。扩展插件声明 `inject: ['meihua']` 后，可以注册规则或环境来源，并把撤销函数交给自己的 Cordis effect。下面的“两数加时”示例会增加一种数字起卦方式：

```js
import { lunarMoment, remainder } from 'dsh-meihua/core';

export const inject = ['meihua'];

export function apply(ctx) {
  ctx.effect(() => ctx.meihua.registerRule({
    id: 'two-numbers-time',
    name: '两数加时',
    fields: [
      { key: 'a', label: '第一数', min: 1, max: 999999999 },
      { key: 'b', label: '第二数', min: 1, max: 999999999 },
    ],
    calculate({ values, environment }) {
      const hour = lunarMoment(environment).hourNumber;
      return {
        upper: remainder(values.a, 8),
        lower: remainder(values.b, 8),
        movingLine: remainder(values.a + values.b + hour, 6),
        steps: [`两数 ${values.a}、${values.b}，时支序数 ${hour}`],
      };
    },
  }));

  ctx.effect(() => ctx.meihua.registerEnvironment(
    'manual-extra',
    () => ({ note: '自定义观察' }),
  ));
}
```

规则 ID 使用以小写字母开头、仅含小写字母、数字和连字符的唯一标识。`fields` 描述整数输入，`calculate` 返回上卦、下卦、动爻和计算说明；其余卦象、互卦、变卦和体用仍由公共规则层推导。新规则会出现在起卦方式和整数输入表单中，沿用现有动画与解读。

环境来源接收冻结的时间、时区和已有观察，返回 JSON 对象，结果按来源 ID 加入 `environment.details`。每个来源的序列化结果上限为 4000 字符。插件不会自动采集位置、天气或设备信息；补充观察也不会隐式改变起卦规则。

## 7. RPC 与客户端兼容约束

[`transport.ts`](../src/host/transport.ts) 注册 `/api/<模块>/<操作>` 的 POST 精确路由，认证由宿主 `/api` 承载。请求必须使用 `application/json` 和宿主 Connection 的 `client-request` 信封，信封 `method` 必须与路由一致；响应保留原 `rpcId`。直接向这些路径发送裸业务 JSON 不能替代 RPC 信封。

各模块共用 `catalog`、`current`、`interpret`、`followup`、`cancel`、`checkpoint` 和 `preferences`，本地操作如下：

| 命名空间 | 本地操作 |
| --- | --- |
| `meihua` | `cast` |
| `tarot` | `start`、`select`、`reveal` |
| `xiaoliu` | `start` |
| `lenormand` | `start`、`select`、`reveal` |
| `liuyao` | `start`、`toss`、`record` |

共享背景使用 `memory` 命名空间，提供 `status`、`initialize`、`unlock`、`lock`、`document`、`save`、`versions`、`rollback`、`clear`、`change-passphrase` 和 `checkpoint`。

维护客户端时，需要同时保留以下校验：

- **记忆代次 `epoch`：** 先读取 `memory/status`，五模块的变更请求均携带当前代次。初始化、解锁、锁定、清空和重启等操作会改变代次，旧请求返回 `MEMORY_STALE`。旧版 `0.3` 直接 RPC 客户端需要补齐此字段，保留路由名称不代表旧 payload 全部兼容。
- **背景版本 `expectedRevision`：** 手动保存和恢复旧版时同时携带当前版本及 `epoch`，避免另一窗口或后台提炼覆盖刚刚完成的编辑。
- **追问轮数 `expectedTurnCount`：** `followup` 业务 payload 为 `{ id, question, expectedTurnCount, epoch }`，轮数必须等于当前已记录追问数量，不匹配返回 `CONVERSATION_CHANGED`。
- **取消轮次 `turnId`：** 取消追问使用 `{ id, turnId, epoch }`，只能取消该条正在生成的追问。首次解读仍可使用 `{ id, epoch }`。不要让旧窗口仅凭结果 ID 取消新一轮回答。
- **本地进度 `expectedCount`：** 雷诺曼 `select` 与六爻 `toss/record` 用它核对已选槽位或已记爻的数量，拒绝重复或过期操作。

初始解读和追问使用相同的冻结结果、背景快照及首次模型路由。初始解读已有文字并到达终态后才能追问；每条追问最多 2000 字符，包含系统提示词的完整上下文超过 60000 字符时返回 `CONTEXT_LIMIT`，不会静默删除旧问答。取消、失败和截断保留已收到的文字，不自动重试。

`GenerationGate` 在全插件范围内限制同时生成。背景提炼也占用该生成位，但不会阻止本地起卦、抽牌或投币；新首解会等待正在进行的背景提炼结束，再冻结最新成功版本。`catalog/current` 不触发解读或提炼，不过模型目录读取可能由宿主供应商实现其自身的查询逻辑。

## 8. 提示词与解读角色

| 场景 | 源码位置 |
| --- | --- |
| 梅花首次解读 | [prompt.ts](../src/host/prompt.ts) 的 `INTERPRETATION_SYSTEM` |
| 塔罗首次解读 | [tarot-service.ts](../src/host/tarot-service.ts) 的 `TAROT_INTERPRETATION_SYSTEM` |
| 梅花、塔罗追问 | [conversation.ts](../src/host/conversation.ts) 的 `followupSystem` |
| 小六壬、雷诺曼、六爻首次解读与追问 | [method-service.ts](../src/host/method-service.ts) 的 `METHOD_RULES` 与 `methodSystem` |
| 共享背景提炼 | [memory-service.ts](../src/host/memory-service.ts) |

提示词由 Host 直接传给所选模型，无需用户复制到聊天窗口。修改后要重新构建并更新实际使用的插件包。

解读角色是耐心、平和的中文讲解者。重要结论要说明本次结果中的依据，把术语讲成日常语言，再解释与问题的联系；用户陈述、传统象征和未知情况要分开表达。模型不能更改本地冻结结果，不能编造卦爻引文、经历、他人想法或必然结局。

梅花首次解读采用“卦象总览、体用与变化、结合所问、今日可做之事”；塔罗采用“牌阵总览、逐牌解读、牌间关系、可以尝试的行动”。梅花、单牌和三牌参考长度为 600–1000 汉字，十牌为 1200–1800 汉字。三个新增模块使用“结果与依据、结合所问、可以尝试的行动”。追问直接回答新问题，不机械重复首次解读的整套结构。

## 9. 素材、许可与离线实现

塔罗使用 78 张历史 Pam-A 扫描牌面。项目保存了逐张 Wikimedia Commons 来源页面、Public domain 声明、作者、原文件信息和哈希，见 [素材来源清单](../src/assets/tarot/assets-sources.json) 与 [素材说明](../src/assets/tarot/README.md)。这些是仓库于 2026-10-03 留存的来源记录；项目的 MIT 许可不替代原图的公有领域声明。

本地牌图统一为 `576 × 960` WebP，保留完整绘画和英文牌名，以 data URI 内嵌到客户端。构建会检查 78 张牌的数量、格式和 SHA-256，再生成 [tarot-assets.ts](../src/client/tarot-assets.ts)。牌背为原创 SVG，中文关键词及正逆位摘要由本项目编写。查看牌面不请求远程图片，构建也不下载原图。

雷诺曼使用本项目原创的 36 张 SVG，逐张记录与 SHA-256 见 [manifest.json](../src/assets/lenormand/manifest.json)，许可见 [LICENSE](../src/assets/lenormand/LICENSE)。图像以 data URI 本地内嵌，中文释义与组合规则分别位于 `src/lenormand/`。

六爻历法使用 `lunar-javascript 1.7.7`。随库源码未改动，只把 `lunar.js` 改名为 `lunar.cjs` 以隔离 CommonJS；版本、原始来源和哈希见 [provenance.json](../src/liuyao/vendor/provenance.json)，[MIT 许可](../src/liuyao/vendor/LICENSE) 随包保留。该适配器用于离线节气时刻与民用日期的日干支。

构建会把来源清单和第三方许可复制到 `lib/`。新增或替换素材时，应同步更新来源记录、哈希和相关测试，不要只替换客户端图片。

## 10. 共享背景与加密边界

五模块共用一个 `MemoryService`。[`memory-store.ts`](../src/host/memory-store.ts) 通过宿主 JSON storage 的 KV 接口打开 `wenxiang_private_memory` 存储单元：全局数据保存加密资料封装，`audit` 表保存加密私人请求记录，没有明文文件存储降级路径。客户端不使用 `localStorage` 持久化个人内容。

[`memory-vault.ts`](../src/host/memory-vault.ts) 的当前实现为：

- 口令长度为 8–256 字符；异步 scrypt 参数为 `N=131072`、`r=8`、`p=1`，使用 16 字节随机 salt 派生 32 字节包装密钥。
- 随机生成 32 字节数据密钥，以 AES-256-GCM 加密资料；每次加密使用 12 字节随机 nonce 和 16 字节认证标签，并校验对应 AAD。
- 修改口令重新包装数据密钥；清空资料会轮换数据密钥并删除关联审计记录。忘记口令没有恢复入口。
- 背景文档上限 4000 字符，保留最近 20 个版本。手动编辑段落固定保留，恢复旧版会产生新版本。

首次解读冻结背景版本，追问沿用同一份快照。后台提炼只处理尚未提炼的用户问题和追问，检查原文证据；模型预测和助手回答不直接成为个人事实。仅关闭“本次使用共享背景”不会同时关闭自动写入；“替他人占卜”才会同时关闭本人背景引用与写入。

锁定、清空会递增 `epoch`、取消生成，并清理五模块当前结果、暗牌和解密缓存。解锁只在当前宿主运行期间有效。重新打开插件页面可以恢复同一 Host 的当前状态，重启 Host 后不能从加密审计自动恢复完整卦象、牌阵或历史列表。

加密保护的是本地持久化数据。AI 解读和背景提炼仍会把相关明文发送给所选供应商。私人生成请求省略 `sessionId`，以避开已经核对的供应商 Session 日志贡献链路；普通 Session 只保留操作元信息。这不构成对所有宿主插件、运行时内存或供应商的隔离保证，旧版已产生的普通日志也不会自动迁移或删除。

## 11. 提交和推送规则

`video/` 是本地宣传片工作区，包含可重建的大体积渲染产物，不进入版本库。[.gitignore](../.gitignore) 还排除了 `node_modules/`、`lib/`、`.local/`、安装包和验收截图目录等本地产物。

克隆后执行一次仓库级配置，启用版本库中的钩子：

```sh
git config core.hooksPath scripts/git-hooks
sh scripts/test-git-hooks.sh
```

[`pre-commit`](../scripts/git-hooks/pre-commit) 检查暂存区的 `video/` 路径，并包含对被忽略新增文件的检查；[`pre-push`](../scripts/git-hooks/pre-push) 检查待推送提交及目标树中是否含有 `video/`。先提交后删除 `video/` 并不能保证相关 blob 不被推送。

目前测试脚本验证普通 `git add` 忽略 `video/`、强制暂存后提交被拦截、绕过提交钩子后推送仍被拦截，以及本地测试远端未收到引用。它没有单独覆盖所有被忽略文件类别，也不是所有历史形态的穷举测试。

`--no-verify` 可以绕过 Git 钩子，钩子因此不能代替提交前的文件审查。发布前应检查实际 diff、包文件清单和最终包的验证记录；提交、推送、安装和启用是各自独立的步骤。

---

[返回使用指南](../README.md) · [版本推进表](roadmap.md) · [0.6 验收记录](v6-goal-completion-audit.md)
