# 问象 0.6.0 远程环境适配验收

日期：2026-10-07。目标为现有 SSH 连接 `skylakeserver` 的 Linux 环境，以及“云泽的PC”的 Windows DSH 桌面环境。两端使用同一份问象包，宿主运行库按平台分别准备。

## 交付包

- 安装包：`artifacts/dsh-meihua-0.6.0-environment-20261007.tgz`
- 字节数：`11697769`
- SHA-256：`a7565ac54bc6eacf203c1eb00c57c96f89dc894b3115930c4d5b44f083491861`
- Host bundle SHA-256：`832df7853a00ed0c41e2f4ac8fe30e6115a41182ee5d40dabb04474ecb11ece7`
- Client bundle SHA-256：`d915994092df080ed15b4032cdc53757cbff56648c1f71722ece3c062bf5ffe6`

归档已解压回读：40 个文件与归档逐字节一致，78 张塔罗图片和 36 张雷诺曼 SVG 均通过素材、来源与许可校验，五个公开规则入口可导入。包中不含参考仓库、Mac 的依赖目录、模拟供应商夹具或日常背景数据；验证脚本与夹具另行放入各端独立适配目录。

## 本次修改

移除准备和预览脚本中的开发者机器路径，改为按平台发现参考仓库、桌面 resources、官方 runtime 与 CLI，并支持显式路径覆盖。Windows 目录链接使用 junction；`.cmd/.bat` 参数经过边界检查后通过系统命令解释器运行，JavaScript CLI 使用当前 Node。

准备脚本校验正式 DSH peer 版本和运行库来源指纹，检测陈旧缓存。预览固定独立数据目录、回环监听与本地模拟供应商。环境检查直接导入已打包的五种规则、验证 ICU 农历/闰月与 AES-256-GCM，并核对插件实际依赖解析路径。页面验收比较浏览器实际响应中的完整客户端字节，关联目标 Host 与交付包。

## Linux 实际结果

| 项目 | 实际状态 |
| --- | --- |
| 目标目录 | `/home/codex/apps/wenxiang-environment-adaptation/linux/` |
| 平台 | Ubuntu 24.04.1、x86_64 |
| Node / ICU | `v22.22.3` / `78.2` |
| DSH | 独立目录安装官方 `@deepseek-ai/dsh@0.2.0-rc.2` |
| 环境检查 | 10/10 PASS，含实际 peer 解析路径与 Host 导入 |
| 关键 Host 模块导入 | 6/6 PASS |
| 前端启动与五个 catalog RPC | 6/6 PASS，HTTP 200 |
| 浏览器页面验收 | 57/57 PASS，64 张截图 |
| 启动脚本重启 | 6/6 PASS |
| 清理 | PASS，本任务的预览进程均停止，端口 19418 无监听 |

页面验收组合为 **Linux Host + Mac Chromium，经 SSH 回环转发**。覆盖五个入口、小六壬固定时间例盘、雷诺曼三/五张结果、六爻实物投币录入、浅/深主题、宽/窄/紧凑布局及运行错误。浏览器收到的完整问象客户端字节与本包 Client SHA-256 一致。此结果不扩展为 Linux 本机浏览器或 Windows 原生窗口的证据。

远端已保存并实际重启验证 `start-preview.sh`。重新使用时，在远端目录运行：

```sh
cd /home/codex/apps/wenxiang-environment-adaptation/linux
./start-preview.sh
```

本机另开终端转发，再使用当次启动日志中的入口地址：

```sh
ssh -C -N -L 127.0.0.1:19418:127.0.0.1:19418 skylakeserver
```

脚本在前台运行。测试 home 为该目录的 `.local/preview-home`，供应商仅为 `meihua-offline`。短期入口令牌只留在私有运行日志，交付报告使用脱敏日志。

## Windows 实际结果

| 项目 | 实际状态 |
| --- | --- |
| 目标目录 | `D:\MyProjects\wenxiang-environment-adaptation\windows\` |
| 平台 | Windows 11 家庭中文版、x64，系统版本 `10.0.26200` |
| Node / ICU | `v24.16.0` / `78.3` |
| DSH | 官方 Windows Desktop `0.2.0-rc.2`，解包到本任务独立 `desktop` 目录 |
| 可执行文件 | `desktop\DeepSeek Harness.exe`，Authenticode 签名 Valid |
| 随附 CLI | `desktop\resources\runtime\cli\bin\dsh.cmd`，实际版本 `0.2.0-rc.2` |
| 环境检查 | 10/10 PASS，含实际 peer 解析路径与 Host 导入 |
| 浏览器页面验收 | 57/57 PASS，64 张截图，完整 served-client 字节匹配同一交付包 |
| 原生窗口 | PASS，在独立 `DSH_HOME` 与 Electron `--user-data-dir` 下启动，实际 `dsh-app://app/` 窗口确认五入口并完成梅花易数本地起卦 |
| 清理 | PASS，本任务 Host、浏览器与原生进程已停止；19419 与临时调试端口 9223 无监听 |

Windows 浏览器验收使用官方 Desktop 发行包随附的 Host，页面实际运行在 Windows 的 Chromium 中。另已手工完成五入口、塔罗选牌/揭示牌面/本地牌义和主题检查；模拟流式解读仅用本地夹具。原生窗口启动证据与 Web Host 的 57 项插件交互证据分别记录。

原生验收使用独立 home 中固定的 `desktop` profile，保留官方 base/web-app 并追加问象。离线 patch 放在独立 home 的 `cordis.patch.yml`，账户平台服务保留，三个真实推理 adapter 关闭。首次欢迎页进入“添加 API Key”子页后点击“稍后配置”，没有输入或保存密钥。实际本地起卦显示“泽水困 / 风火家人 / 天水讼”，共享背景未启用，控制台 0 错误/0 警告。这一项是原生窗口实测；未把 Windows Web 的 57 项全部记作原生窗口测试。

官方安装包下载后按官方 feed 的大小与 SHA-512 验证，再解包到独立目录。没有执行 DSH 的系统安装流程。桌面可执行文件 SHA-256 为 `df4e91fd91f6f1bee19a1990b0e167bfe06abf8353279d82bbb8e60edb6ba0d3`。原生程序使用固定的 `profiles/desktop`；不能以启动参数 `--profile=meihua-v1` 代替这个 profile。

在 PC 的 PowerShell 中使用保存的原生启动脚本：

```powershell
& 'D:\MyProjects\wenxiang-environment-adaptation\windows\Start-Desktop.ps1'
```

首次欢迎流程可选“添加 API Key”后点“稍后配置”，只体验本地起卦/抽牌不需要填写密钥。独立 Web 验收入口由同目录 `Start-Preview.ps1` 启动。

## 验收资料

本机资料集中在 `artifacts/verification-environment-20261007/`：

- `package-integrity.json`：归档结构、素材和规则回读。
- `local-tests.log`：原有回归 169/169 PASS。
- `environment-tests.log`：平台路径、参数及隔离边界 11/11 PASS。
- `local-environment.json`：Mac 解包验证 10/10 PASS。
- `linux-environment.json`：最终 Linux 环境验证。
- `linux-host-runtime.json`：实际启动和五个 catalog RPC。
- `linux-frontend.json`：实际页面、主题、布局与 served-client 校验。
- `linux-launcher-restart.json`：启动脚本重启验证。
- `cleanup.json`：Linux owned 进程与监听清理。
- `delivery-manifest.json`：两端最终报告、归档及完整 served-client 对应、原生实测、清理状态与 Windows 10 文件回读 SHA-256 的汇总校验。

完整 Linux 页面截图在 `artifacts/verification-frontend-20261007/2026-10-07T14-14-37-106Z/`。

Windows 的 10 个脱敏交付文件已从授权服务器目录回读到本机 `artifacts/verification-environment-20261007/windows-evidence/`，逐文件 SHA-256 与 PC/服务器清单一致：

- `WINDOWS_ENVIRONMENT_FINAL_20261007.json`：最终目标机环境检查 10/10 PASS。
- `WINDOWS_FRONTEND_VALIDATION_20261007.json`：页面自动化 57/57 PASS、64 张截图及完整客户端字节匹配。
- `WINDOWS_NATIVE_DESKTOP_20261007.json`：官方原生窗口、隔离 profile、五入口、本地结果与截图哈希。
- `WINDOWS_CLEANUP_20261007.json`：本任务进程数与监听均为 0。
- `WINDOWS_ADAPTATION_FINAL_20261007.md`：Windows 执行记录与实际 runtime 来源。
- `Start-Desktop.ps1`、`Start-Preview.ps1`：在 PC 原目录中使用的启动脚本。原生脚本默认不打开调试端口。
- `native-01-five-entry-home.png`、`native-02-meihua-local-result.png`、`02-tarot-local-result.png`：代表截图；已回读检查。

Windows 上保留了全部 64 张自动截图；本机仅回读上述 3 张代表截图，不把这份回读目录称为完整截图集。

最终本地汇总校验 PASS：两端环境各 10 项、浏览器各 57 项全部通过；Host/client bundle 在两端一致，两个浏览器都实际收到同包的完整客户端字节；Windows 原生截图哈希一致；Linux 与 Windows 清理报告通过；10 个 Windows 回传文件与服务器逐项一致。

## 验证范围

本次验证使用合成例盘与独立测试 profile。真实模型解读质量、私人背景迁移、日常 profile 安装/启用不属于本次已验证结果。用户原有应用、服务和项目没有纳入适配目录。源码修改尚未提交或推送 Git。
