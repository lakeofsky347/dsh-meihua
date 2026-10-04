# 问象 · 占卜 · DSH 插件

版本 `0.2.0`，针对 **DeepSeek Harness 桌面端 0.2.0-rc.2**。混沌星空门户通往平级的梅花易数与塔罗模块：梅花使用水墨宣纸与传统中国色系，塔罗使用经典伟特牌面、月相和金线星盘。两模块跟随宿主深浅主题，复用 DSH 已配置的供应商及模型，定位为闲时娱乐与自省。

## 安装与使用

安装包位于 `artifacts/dsh-meihua-0.2.0.tgz`。技术包名、既有梅花接口与扩展服务保持兼容。

1. 在 DSH 左侧打开「插件」，选择「添加插件」。
2. 将安装包的**绝对路径**粘贴到安装来源输入框；按 DSH 的安装流程安装并启用。
3. 左侧打开「问象 · 占卜」，在星空中选择「梅花易数」或「塔罗牌」。进入约 1.6 秒、返回约 0.8 秒，可跳过；减少动态效果模式采用快速切换。
4. 梅花可选时间或三数起卦，约 4.8 秒仪式后查看本卦、互卦、变卦、动爻、体用、五行和计算过程。
5. 塔罗填写问题、选择牌阵和是否包含逆位，洗牌后从 78 张背牌中依次手选。选满后顺序翻牌或全部揭示，查看本地牌义，点击牌面可放大。
6. 选定已配置的供应商与模型，主动点击「开始解读」。每次占卜只生成一份解读；取消、出错或截断保留已收到文字，不自动重试。生成中需先取消才能使用插件内导航。
7. 可分别复制两模块的当前结果。门户往返和宿主页面切换保留本次运行的草稿、结果与进度；另起一轮只替换对应模块。

CLI 安装示例（已配置 `dsh` 命令时）：

```sh
dsh plugin add /absolute/path/dsh-meihua-0.2.0.tgz --profile desktop
```

普通安装包不带模拟供应商。正常解读会调用你选择的供应商，并按其规则产生费用。开页面、起卦、抽牌、翻牌和查看基础牌义不调用模型，也不加载远程图片或字体。

## 塔罗规则与素材

完整经典 Rider–Waite–Smith 牌组：22 张大阿卡纳与权杖、圣杯、宝剑、星币各 14 张。四种牌阵：单张指引（1）、时间之流（3，过去/现在/未来趋势）、问题剖面（3，现状/阻碍/建议）、凯尔特十字（10）。十字固定为现状、阻碍、目标与可能、基础、过去、近期发展、自身立场、环境影响、希望与恐惧、发展趋势，不另抽指示牌；第 2 张横置属于布局，正逆位独立记录。

Host 用 `crypto.randomInt` 驱动 Fisher–Yates 洗牌。牌序和正逆位在开始时冻结；开启逆位时每张独立 50% 概率，关闭时全部正位。选取的背牌位置按点击顺序绑定牌位，不能重复。未揭牌面和方向不通过 RPC 返回，重开客户端仍恢复选牌/翻牌进度。问题和动画不影响随机结果，模型不参与抽牌。

78 张历史 Pam-A 牌面来自同一 [TaionWC 扫描集](https://commons.wikimedia.org/wiki/Category:Rider-Waite-Smith_tarot_deck_(TaionWC))，逐张记录 Commons 的 Public domain 声明、作者、原文件与处理后哈希，见 `src/assets/tarot/assets-sources.json`。图像统一为 576×960 WebP，保持比例和完整绘画/英文牌名，并以 data URI 随客户端打包；发行包内有 `lib/tarot-assets-sources.json` 和素材说明。牌背为本地原创 SVG，中文关键词及正逆位摘要为本项目自写。

基础牌义离线可读。模型解读依据冻结牌位、牌名、方向和牌义，使用独立提示词；十张牌阵输出上限 5000 tokens，其余沿用配置上限。完整首份输出或取消前文字写入 DSH 标准 Session 日志。

## 梅花易数规则（保持 v1）

固定先天八卦序数：乾 1、兑 2、离 3、震 4、巽 5、坎 6、艮 7、坤 8。除八余零按八；除六余零按六。六爻从下向上编号。

| 起卦方式 | 上卦 | 下卦 | 动爻 |
| --- | --- | --- | --- |
| 时间起卦 | 年支序数 + 农历月 + 农历日，除八取余 | 前述和 + 时支序数，除八取余 | 年支序数 + 农历月 + 农历日 + 时支序数，除六取余 |
| 三数起卦 | 第一数 A 除八取余 | 第二数 B 除八取余 | A + B + C 除六取余 |

- 年支与时支采用子 1 至亥 12；时间在点击起卦时冻结，也可手动指定。
- 默认时区 `Asia/Shanghai`；使用运行环境 ICU 的中国农历，支持公历 1900—2100 年。
- 按农历新年换年、当地零点换日；23:00 与 00:00 均属子时，23:00 不提前换日。闰月使用同一月份数字，并在页面注明「闰」。
- 互卦下卦取二三四爻，上卦取三四五爻；纯乾、纯坤从变卦取互卦。变卦只翻转动爻。
- 动爻所在的三爻卦为用，另一三爻卦为体；五行对应乾兑金、震巽木、坎水、离火、艮坤土。
- 每个数字须为 1—999,999,999 的整数。问题及补充当下信息作为解读背景，不隐式改变起卦算法。

这些是本版采用的明确约定。模型收到冻结后的卦象和过程，负责文字解读，不负责重新计算卦象。

## 保留范围与边界

同一插件运行期间，两模块独立维护当前结果与草稿。切换到其他宿主页面、关闭插件页面后再打开，恢复原进度；刷新后由 Host 恢复冻结结果，客户端内存草稿在本次插件实例内保留。重新起卦或洗牌仅替换该模块结果。

没有历史列表、追问、重新解读、后台定时占卜或多模型比较。重启 DSH 后页面从空状态开始，长期留存可使用「复制结果」，正式 Session 日志仍由 DSH 保存。取消和超时通过 AbortSignal 终止当前请求；全插件同一时刻只允许一份解读，不自动重试。宿主自己的导航不被拦截，离开后返回仍恢复生成状态。

文化配色跟随宿主主题服务的深浅状态，在桌面宽屏为双栏，窄窗自动堆叠；十字牌阵窄窗采用编号列表与小型位置图。遵循减少动态效果设置，隐藏页面暂停星空和洗牌动画，插件销毁时清理计时器、订阅和 Canvas。门户转场限于插件主面板，并避让 macOS 标题栏。

## 开发与验收

此仓库为插件主工作区；`dsh_clone` 仅作为结构、接口和开发工具的只读参考。正式包只包含 `lib/`、组合包 patch、README、LICENSE 和包清单。

本机可直接复用已安装的 DSH 发布版和参考仓库现有工具，避免更改参考仓库或下载依赖：

```sh
npm run prepare:local
npm run typecheck
npm run build
npm test
npm run preview
```

`prepare:local` 将已安装的发布版运行库提取到本仓库 `.local/runtime`，开发工具以符号链接只读复用。默认桌面应用资源位置为 `/Applications/DeepSeek Harness.app/Contents/Resources`，参考仓库为相邻的 `../dsh_clone`；可通过 `DSH_RESOURCES` 与 `DSH_REFERENCE` 覆盖。一般开发环境也可安装 package.json 中列明的依赖；正式 JSONL 集成测试需本机发布版提取目录。

`preview` 用官方 `dsh` 入口启动隔离的 `.local/test-home` profile，不更改正式桌面配置。打开终端输出的本地地址，选择 **「本地演示 · 模拟供应商」** 可验收流式显示和单次限制。该模拟输出与正式模型解读不同，不调用真实 API，不进入发行包。可通过 `DSH_CLI` 指定官方 CLI、`DSH_PREVIEW_PORT` 指定端口（默认 19402）。

构建时会验证并内嵌全部本地 WebP，不需要网络。生成安装包：

```sh
npm pack --pack-destination artifacts
```

当前版本验收记录见 `docs/v2-acceptance.md`；v1 记录保留在 `docs/v1-acceptance.md`。测试与模拟供应商验证不代表真实模型联调。

### 提交与推送规则

`video/` 是宣传片的本地工作区（渲染产出体积大、可随时重建），不进入版本库：

- `.gitignore` 已忽略 `video/`；
- `scripts/git-hooks/pre-commit` 拒绝提交任何 `video/` 路径，并拒绝把被 `.gitignore` 忽略的新增文件强制加入提交；
- `scripts/git-hooks/pre-push` 拒绝推送任何包含 `video/` 内容的提交（含历史中曾出现过后被删除的情况）。

钩子通过仓库级配置生效，克隆后执行一次即可：

```sh
git config core.hooksPath scripts/git-hooks
sh scripts/test-git-hooks.sh   # 验证三类拦截确实生效
```

确有必要时可用 `git commit --no-verify` / `git push --no-verify` 绕过。

## 扩展接口

门户由内置模块清单组织，当前内置 `meihua` 与 `tarot`。`dsh-meihua/tarot` 导出牌组/牌阵类型、定义、查找与可注入测试随机源的纯洗牌函数。认证塔罗 RPC 为 `/api/tarot/{catalog,current,start,select,reveal,interpret,cancel}`；未揭牌位不包含 card/orientation。原有下列梅花接口保持兼容。

`dsh-meihua/core` 导出 `DivinationRule`、`EnvironmentContributor`、`RuleRegistry`、农历换算和八卦/六十四卦推导函数。Host 提供 `ctx.meihua` 服务，扩展插件声明 `inject: ['meihua']` 后可注册规则或环境来源，并将返回的撤销函数交给自身 effect。

```js
import { lunarMoment } from 'dsh-meihua/core';
export const inject = ['meihua'];
export function apply(ctx) {
  ctx.effect(() => ctx.meihua.registerRule({
    id: 'two-numbers-time', name: '两数加时',
    fields: [
      { key: 'a', label: '第一数', min: 1, max: 999999999 },
      { key: 'b', label: '第二数', min: 1, max: 999999999 },
    ],
    calculate({ values, environment }) {
      const hour = lunarMoment(environment).hourNumber;
      return {
        upper: values.a % 8 || 8,
        lower: values.b % 8 || 8,
        movingLine: (values.a + values.b + hour) % 6 || 6,
        steps: [`两数 ${values.a}、${values.b}，时支序数 ${hour}`],
      };
    },
  }));
  ctx.effect(() => ctx.meihua.registerEnvironment('manual-extra', () => ({ note: '自定义观察' })));
}
```

扩展数字方式会自动出现在起卦方式与整数输入表单中，共用动画、卦象推导和解读流程。环境来源接收冻结的时间/时区/既有观察；返回 JSON 对象，按来源标识加入解读背景。首版不自动采集位置、天气或设备信息。
