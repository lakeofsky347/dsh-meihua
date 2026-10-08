# 问象 0.6 环境适配

本说明对应 2026-10-07 的源码和安装包。Windows DSH 桌面端与 Linux Web 宿主使用相同的纯 JavaScript 插件包；各台机器使用自身的 Node、DSH 运行库和数据目录。

本次两台目标机器的版本、启动脚本和证据见[实际验收记录](environment-adaptation-20261007.md)。

## 所需环境

| 项目 | 要求 |
| --- | --- |
| DSH | `0.2.0-rc.2`，对应插件声明的宿主与客户端 peer 版本 |
| Node | `22.18+` 的 22.x 或 `24+`；桌面端可使用应用随附的 Node |
| 历法 | ICU 中国农历、闰月与 `Asia/Shanghai` 时区可用 |
| 加密 | Node `scrypt` 与 `AES-256-GCM` 可用 |
| 浏览器验收 | 本机或目标机已有 Chromium/Chrome 和 Playwright |

`.tgz` 包内已包含 78 张塔罗图像、36 张雷诺曼素材和六爻固定历法源码。不得把 Mac 的 `node_modules`、`.local/runtime`、开发工具原生二进制或日常背景文档复制到另一平台。

## Windows 桌面端

在插件管理界面输入安装包的 Windows 绝对路径，如 `D:\Downloads\dsh-meihua-0.6.0-environment-20261007.tgz`，安装后确认已启用。如果使用命令行，优先使用桌面应用现有的 `dsh` 命令：

```powershell
dsh plugin add "D:\Downloads\dsh-meihua-0.6.0-environment-20261007.tgz" --profile desktop
```

需要先做隔离验收时，将安装包解压到独立目录，并用本文提供的环境验证脚本检查该目录，不需要接触日常 DSH profile：

```powershell
node scripts/verify-environment.mjs --plugin "D:\Work\wenxiang-adaptation\package" --output "D:\Work\wenxiang-adaptation\environment.json"
```

共享背景需要在目标机单独设置测试口令。上面的环境验证仅使用合成数据，不读取私人背景或调用模型。桌面插件安装/启用、原生页面交互和真实供应商质量仍应按各自证据记录。

对官方桌面包做隔离验收时，同时使用独立 `DSH_HOME` 和 Electron 参数 `--user-data-dir=<独立目录>`。原生应用固定使用该 home 下的 `profiles/desktop`；`--profile` 不能把它切换到 Web 预览的 `meihua-v1`。在 Desktop 完全退出时准备这个独立 profile，保留宿主的默认 bundles 并追加 `dsh-meihua`。需要本地模拟供应商时，把已验证的测试 patch 放到这个独立 home 的 `cordis.patch.yml`，不要修改启动时重写的 `profiles/desktop/cordis.yml`。

## Linux 服务器

在用户应用目录安装固定版本的官方 CLI。下面的命令以独立工作目录为前提；保留原有服务和日常 profile：

```sh
npm install --prefix ./runtime --save-exact --omit=dev @deepseek-ai/dsh@0.2.0-rc.2
node scripts/verify-environment.mjs --plugin ./package --runtime ./runtime --output ./environment.json
```

如果 Node 安装在 NVM 下，普通非交互 SSH 的 PATH 可能找不到它。可显式使用 Node 的绝对路径，或仅在当前命令中设置 PATH，无需修改登录配置或系统 Node。

隔离预览复用仓库的 `scripts/preview.mjs` 与测试供应商夹具，设置 `DSH_CLI`、`DSH_PREVIEW_PLUGIN` 和专用 `DSH_PREVIEW_HOME`。启动后的服务保持监听 `127.0.0.1`，使用已有 SSH 别名转发：

```sh
ssh -N -L 127.0.0.1:19418:127.0.0.1:19418 skylakeserver
```

浏览器访问转发后的本机地址，运行时提供的短期令牌只用于进入页面，不写入公开报告。浏览器运行在 Mac 时，报告只确认“Linux Host + Mac Chromium”的组合；它不能证明 Windows 原生桌面显示。

## 跨平台开发与复核

`prepare:local` 支持显式 `DSH_RESOURCES`（包含 `app.asar` 的目录）、`DSH_REFERENCE`（已有开发依赖的参考仓库）和 `DSH_RUNTIME`（完整官方 DSH runtime）。脚本只在本仓库生成提取目录和链接。更换宿主来源后会检测旧缓存来源，不会静默混用旧版文件。Windows 目录链接使用 junction。

`preview` 支持 `DSH_CLI` 和平台默认安装位置/PATH，保留默认 `meihua-v1` 测试 profile。`DSH_PREVIEW_HOME` 必须是独立测试数据目录，不能指向日常 `$DSH_HOME` 或 `~/.dsh`。

`verify-frontend` 从仓库依赖或当前用户的 Codex 依赖目录寻找 Playwright；可通过 `DSH_FRONTEND_DEPENDENCIES` 指定包含 Playwright 的依赖目录、通过 `DSH_FRONTEND_BROWSER` 指定 Chrome/Chromium。`DSH_FRONTEND_PROFILE_MANIFEST` 可指定实际预览 profile 的 `package.json`，`DSH_FRONTEND_PLUGIN` 可指定本机解包目录，`DSH_FRONTEND_ARCHIVE` 可指定归档；设置 `DSH_FRONTEND_EXPECT_PACKAGE_SHA256` 时会校验归档。报告同时比较浏览器响应中的完整客户端字节与解包后的 bundle，关联实际服务和交付包。它仍只接受回环服务并阻止解读、追问与浏览器外部请求。

`verify-environment` 直接导入安装包中的五个规则入口，验证中国农历正常月/闰月、已知例盘、卡牌数量、加密能力，并记录实际平台、Node/ICU 和 Host/client 的 SHA-256。传入 `--runtime` 后还核对正式安装运行库的 peer 版本、实际插件依赖的解析路径，并导入 Host 模块。测试结果不代表真实模型解读质量。
