# 梅花易数 · DSH 插件

第一版 `0.1.0`，针对 **DeepSeek Harness 桌面端 0.2.0-rc.2**。手动打开独立页面、起一卦，随后选择 DSH 已配置的供应商及模型，生成并保留本卦的第一次解读。定位为闲时娱乐与自省。

## 安装与使用

已构建的安装包位于 `artifacts/dsh-meihua-0.1.0.tgz`。

1. 在 DSH 左侧打开「插件」，选择「添加插件」。
2. 将安装包的**绝对路径**粘贴到安装来源输入框；按 DSH 的安装流程安装并启用。
3. 左侧出现「梅花易数」后打开页面，填写所问之事（可留空），选择时间或三数起卦。
4. 起卦动画持续约 4.8 秒，可以跳过。动画结束后查看本卦、互卦、变卦、动爻、体用、五行及计算过程。
5. 选择已配置的供应商和模型，点击「开始解读」。插件复用 DSH 的模型服务、认证和连接机制，不维护另一套 API Key。
6. 解读完成后可复制问题、卦象、过程和文字。每卦只提交一次；取消、出错或输出截断时保留已收到的文字，继续操作请另起一卦。

CLI 安装示例（已配置 `dsh` 命令时）：

```sh
dsh plugin add /absolute/path/dsh-meihua-0.1.0.tgz --profile desktop
```

普通安装包不带模拟供应商。正常解读会调用你选择的供应商，并按其规则产生费用。开页面和起卦不调用模型。

## 首版规则

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

同一插件运行期间，切换到其他页面、关闭插件页面或刷新页面后再打开，仍可查看当前卦及已收到的首份解读。重新起卦替换当前结果；完整模型请求与首份输出同时写入 DSH 标准 Session 日志。

首版没有历史列表、追问、重新解读、后台定时起卦或多模型比较。重启 DSH 后页面从空状态开始，长期留存可使用「复制结果」，正式 Session 日志仍由 DSH 保存。取消和超时通过 AbortSignal 终止当前请求；不会自动重试。

界面使用宿主主题颜色，在桌面宽屏为双栏，窄窗自动堆叠；跟随系统的减少动态效果设置跳过仪式动画。八卦及爻线为本地 SVG，不加载远程图片或字体。

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

`prepare:local` 将已安装的发布版运行库提取到本仓库 `.local/runtime`，开发工具以符号链接只读复用。默认桌面应用资源位置为 `/Applications/DeepSeek Harness.app/Contents/Resources`，参考仓库为 `/Users/skylake/Work/Projects/dsh_clone`；可通过 `DSH_RESOURCES` 与 `DSH_REFERENCE` 覆盖。一般开发环境也可安装 package.json 中列明的依赖；正式 JSONL 集成测试需本机发布版提取目录。

`preview` 用官方 `dsh` 入口启动隔离的 `.local/test-home` profile，不更改正式桌面配置。打开终端输出的本地地址，选择 **「本地演示 · 模拟供应商」** 可验收流式显示和单次限制。该模拟输出与正式模型解读不同，不调用真实 API，不进入发行包。可通过 `DSH_CLI` 指定官方 CLI、`DSH_PREVIEW_PORT` 指定端口（默认 19402）。

生成安装包：

```sh
npm pack --pack-destination artifacts
```

## 扩展接口

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
