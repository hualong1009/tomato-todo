# 番茄待办

Windows 桌面待办应用：分组、状态视图、桌面便签、番茄专注、AI 回顾、WebDAV 备份与 MCP 接口。

同一个 React 渲染层也可以打包成 **安卓 App**（Capacitor），详见下方「安卓版」章节。

## 界面预览

| 桌面端主界面 | 桌面端详情（Markdown / 图片） |
| --- | --- |
| ![桌面端主界面](docs/images/desktop-home.png) | ![桌面端详情](docs/images/desktop-detail.png) |

| 手机端（Capacitor） | AI 回顾 |
| --- | --- |
| ![手机端主界面](docs/images/mobile-home.png) | ![AI 回顾](docs/images/mobile-ai-review.png) |

## 开发与构建

```bash
npm install
npm run dev        # 开发模式
npm run build      # 类型检查 + 构建
npm run build:win  # 构建 Windows NSIS 安装包
npm run dev:web    # 浏览器里预览移动端布局（手机视口）
npm run build:web  # 构建移动端 Web 资源到 dist-mobile/
```

生成物位于 `out/`，安装包位于 `release/`（NSIS 安装器 + `win-unpacked` 免安装目录）。

> 提示：如果项目放在 OneDrive 同步目录里，`release/` 中的文件可能被 OneDrive 锁住导致打包失败（EPERM/EBUSY）。
> 可以把输出目录指到本地磁盘：
> `npx electron-builder --win --config.directories.output="D:/tmp/tomato-release"`

## 功能

- 待办支持标题、详细内容、用户分组、紧急程度、期望完成时间、实际开始 / 完成时间。
- 勾选完成、右键菜单、开始任务、归档 / 恢复 / 永久删除。
- 状态视图：全部、未开始、进行中、未完成（逾期）、已完成、已归档。
- 每条待办可固定为桌面便签，独立背景色与透明度；关闭便签即取消固定。
- 番茄钟：开始专注会同时把任务标记为进行中，完成的专注段写入 `focusLog`。
- AI 回顾：支持 OpenAI / Anthropic 兼容端点，周 / 月 / 年总结，提示词模板可编辑。可点击「获取模型」直接拉取网关的模型列表；请求走 Chromium 网络栈，自动使用系统代理与企业 CA。
- 安全锁定：支持设置管理员密码（scrypt 哈希存储），空闲超过设定时间自动锁定，锁定后需输入密码解锁，锁定时便签窗口自动隐藏。
- 关闭即最小化到系统托盘：默认关闭按钮隐藏到托盘，按全局快捷键或点击托盘图标可再次唤起（可在设置中关闭该行为）。
- WebDAV 备份：支持可用性测试、自动 / 手动上传、从远端恢复。远端文件不包含 AI Key 和 WebDAV 密码；可设置加密密码，上传前用 AES-256-GCM 加密、恢复时自动解密。
- 应用重置：一键清空全部待办、分组与设置；设置了管理员密码时需输入密码才能重置。远端 WebDAV 备份不会被删除。
- MCP：外部 Agent 可通过 stdio 搜索、新增、修改、开始、完成、归档待办、记录专注和生成 AI 回顾（`summarise_todos`，使用应用内配置的 AI 接口）。
- 全局快捷键默认 `Ctrl+Shift+Space`，可在设置中重新录制。

## 数据与 MCP

本地数据统一保存在 `%APPDATA%/tomato-todo/tomato-todo-data.json`（dev 与安装版共用同一份；安装后不会因为 productName 改变目录）。

设置页「MCP 接入」会显示当前环境可直接复制的 stdio 配置，dev 和安装版的命令不同：

- **dev**：`node_modules/electron/dist/electron.exe out/mcp-entry.cjs`
- **安装版**：`<安装目录>/番茄待办.exe <安装目录>/resources/app.asar.unpacked/out/mcp-entry.cjs`

两者都需要环境变量 `ELECTRON_RUN_AS_NODE=1`。Windows 上 Electron 主进程的 stdin/stdout 管道不可用，
所以 MCP 服务器不是用 `electron . --mcp` 启动，而是以纯 Node 模式运行自包含入口 `out/mcp-entry.cjs`
（构建时由 `scripts/build-mcp-entry.mjs` 生成，并随安装包解包到 `app.asar.unpacked`）。

开发模式下也可以直接运行：

```bash
npm run mcp
```

MCP 与桌面应用共享同一数据文件；桌面端通过文件监听自动刷新，外部 Agent 新增/修改待办会实时同步到界面。

## 测试

```bash
npm test          # 95 个单元 / 集成测试（共享逻辑、持久化、WebDAV、Store、MCP、加密、适配层）
npm run test:e2e  # 构建后跑桌面端 Electron + 移动端 Web 的 Playwright 测试
```

E2E 覆盖：桌面端新建/完成/详情/番茄钟/右键菜单/归档/设置/AI/主题/搜索、下拉组件、
安全锁定与托盘、MCP stdio，以及移动端布局（抽屉侧栏、全屏详情、设置裁剪、本地持久化）。

## 图标

应用图标基于 Twemoji Tomato（CC-BY 4.0）重新设计，源文件位于 `build/icon.svg`，生成 `icon.png` 与 `icon.ico`。

## 安卓版（Capacitor）

桌面版与安卓版共用同一份 React 渲染层和 `src/shared` 业务逻辑，区别只在数据层：
桌面用 Electron preload 注入的 `window.api`，安卓用 `src/renderer/src/platform` 里的
Capacitor 适配层（`@capacitor/preferences` 存数据、`CapacitorHttp` 发网络请求以绕过 WebView 的 CORS）。

```bash
npm run build:web     # 构建 Web 资源到 dist-mobile/
npx cap sync android  # 同步到 android/ 工程（会自动执行 build:web）
npx cap open android  # 用 Android Studio 打开，编译安装
# 或已连接设备时：
npm run android:run
```

首次构建需要安装 **Android Studio + Android SDK（API 34+）与 JDK 21**，并设置 `ANDROID_HOME`。
测试环境只安装了 JDK 21，没有 Android SDK，因此仓库里不包含 APK 产物。

### 安卓端能力差异

| 功能 | 桌面端 | 安卓端 |
|---|---|---|
| 待办 / 分组 / 搜索 / 番茄钟 / 详情 | ✅ | ✅ |
| AI 回顾（周/月/年） | ✅ | ✅ 走 `CapacitorHttp` |
| WebDAV 备份 / 恢复 | ✅ 支持加密 | ⚠️ 仅明文 JSON（加密备份会提示不支持） |
| 本地数据存储 | `%APPDATA%/tomato-todo/*.json` | Preferences（`CapacitorStorage.*`） |
| 桌面便签、托盘、全局快捷键 | ✅ | — 无（固定在手机上只标记状态） |
| 管理员密码 / 自动锁定 | ✅ | — 由系统锁屏保护，设置里已隐藏 |
| MCP 服务 | ✅ | — 仅桌面端 |
| 关闭到托盘 | ✅ | — 设置里已隐藏 |

移动端界面会自动切换布局：隐藏自绘标题栏、侧栏变成抽屉、详情面板全屏、隐藏桌面专属设置项。

### 安卓图标

```bash
npm run android:icons  # 从 build/icon.png 生成 mipmap 图标与 splash
```
