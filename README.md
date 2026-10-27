# 番茄待办

Windows 桌面待办应用：分组、状态视图、桌面便签、番茄专注、AI 回顾、WebDAV 备份与 MCP 接口。

同一个 React 渲染层也可以打包成 **安卓 App**（Capacitor），详见下方「安卓版」章节。

## 界面预览

| 桌面端主界面 | 详情默认 Markdown 预览（含附件下载） |
| --- | --- |
| ![桌面端主界面](docs/images/desktop-home.png) | ![桌面端详情预览](docs/images/desktop-detail.png) |

| 点铅笔进入编辑（分栏 + 工具栏 + 附件） |
| --- |
| ![桌面端编辑详情](docs/images/desktop-detail-edit.png) |

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
- 详情面板默认是**只读 Markdown 预览**（标题、正文渲染、附件列表）；点右上角铅笔图标进入编辑，编辑后点「保存」才写回（`Ctrl+S` 保存、`Esc` 取消，未保存关闭会二次确认）。
- 附件：任意文件（单个上限 10MB）可随待办上传、删除、下载；预览态只能下载，编辑态可增删。附件内容以 data URL 内嵌，随本地备份 / WebDAV 备份一起完整导出。
- 富文本编辑：Markdown 工具栏（加粗、斜体、删除线、标题、列表、引用、代码、链接）、编辑 / 分栏 / 预览三种模式，图片可粘贴或拖拽插入（自动压缩为 WebP）。
- 勾选完成、右键菜单、开始任务、归档 / 恢复 / 永久删除。
- 状态视图：全部、未开始、进行中、未完成（逾期）、已完成、已归档。
- 每条待办可固定为桌面便签，独立背景色与透明度；关闭便签即取消固定。
- 番茄钟：开始专注会同时把任务标记为进行中，完成的专注段写入 `focusLog`。
- AI 回顾：支持 OpenAI / Anthropic 兼容端点，今日 / 周 / 月 / 年 / 自定义日期范围总结（选起止日期即可）；不同范围（含不同自定义区间）的总结各自保留，互不覆盖。
- 提示词模板：内置默认模板不可修改，可一键复制出新模板后自由编辑名称与提示词，支持复制、修改、删除（删除二次确认）；AI 回顾面板可切换输出模板，默认使用上次选择的模板。可点击「获取模型」直接拉取网关的模型列表；请求走 Chromium 网络栈，自动使用系统代理与企业 CA。
- 安全锁定：支持设置管理员密码（scrypt 哈希存储），空闲超过设定时间自动锁定，锁定后需输入密码解锁，锁定时便签窗口自动隐藏。
- 关闭即最小化到系统托盘：默认关闭按钮隐藏到托盘，按全局快捷键或点击托盘图标可再次唤起（可在设置中关闭该行为）。
- WebDAV 备份：支持可用性测试、自动 / 手动上传、从远端恢复。远端文件不包含 AI Key 和 WebDAV 密码；可设置加密密码，上传前用 **gzip 压缩 + AES-256-GCM 加密**（`TTENC2` 格式，纯文本备份通常可缩小两个数量级），恢复时自动解密；旧版 `TTENC1` 备份仍可直接读取。传输超时 120 秒并自动重试一次，适合含图片 / 附件的大备份。
- WebDAV 图片 / 附件拆分：默认把正文图片与附件按内容寻址（`sha256` 前 16 位）上传到 `blobs/`，主备份文件只保留 `blob:` 引用与 `assets` 清单——单文件从 MB 级降到 KB 级，绕开 WebDAV 单文件大小限制；同一张图/同一个附件只上传一次，已存在的自动复用（可在设置中关闭，退回单文件模式）。
- 导出 Markdown：单条或全部导出，正文内嵌图片与附件会一并写入 `attachments/` 目录并改写为相对链接。
- 应用重置：一键清空全部待办、分组与设置；设置了管理员密码时需输入密码才能重置。远端 WebDAV 备份不会被删除。
- MCP：外部 Agent 可通过 stdio 搜索、新增、修改、开始、完成、归档待办、记录专注和生成 AI 回顾（`summarise_todos`，使用应用内配置的 AI 接口）。
- 全局快捷键默认 `Ctrl+Shift+Space`，可在设置中重新录制。

## 手机端（Android）

- **桌面小组件**：「番茄待办 · 最近待办」显示最近更新的 5 条待办（未完成、未归档），带紧急程度色点与期望时间，右上角数量含逾期统计；点任意一行打开应用，点刷新图标立即重绘；数据变化后小组件实时刷新（渲染层写入轻量摘要，原生不解析大 JSON）。
- **系统栏跟随主题**：状态栏与手势条改为透明沉浸式，背景就是应用主题色，图标明暗随深 / 浅主题自动切换；内容用 safe-area 顶开，不被系统栏遮挡。

## 数据与 MCP

本地数据统一保存在 `%APPDATA%/tomato-todo/tomato-todo-data.json`（dev 与安装版共用同一份；安装后不会因为 productName 改变目录）。

备份结构：

| 位置 | 内容 |
| --- | --- |
| 本地数据文件 | 完整 JSON：待办（正文内嵌 base64 图片）+ 附件（data URL）+ 分组 + 设置 |
| 本地加密备份 `.ttbak` | 同上整份 JSON，`TTENC2` = gzip + AES-256-GCM，单文件自包含 |
| WebDAV 主文件 | `data.json`：待办与分组；图片/附件外置成 `blob:<hash>.<ext>` 引用 + `assets` 清单 |
| WebDAV `blobs/` | 每个图片 / 附件一个文件，内容寻址，加密开启时同样是 `TTENC2` 容器 |

恢复时桌面端与手机端都会把 `blobs/` 拉回并重新内嵌成 data URL，因此本地数据模型始终自包含。

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

## Android 构建与版本号

版本号统一维护在 `package.json` 的 `version`（x.y.z 格式）：

```bash
npm run version:sync   # 把 package.json 版本同步到 android/app/build.gradle（versionName + versionCode）
npm run android:sync    # 构建 Web 资源 + 同步版本号 + cap sync android
```

- `versionName` = `package.json` 的 version（如 `1.2.0`）
- `versionCode` = major × 10000 + minor × 100 + patch（如 `10200`），保证单调递增可覆盖安装
- APK 文件名同样带版本号：`tomato-todo-v1.2.0-release.apk`
- `android:sync` 已自动跑版本同步，直接改 `package.json` 再构建即可

### 正式签名（release）

签名材料存放在仓库外：`D:/OneDrive/Private/keystore/todolist/`（keystore + `release-signing.properties`，含密码）。`build.gradle` 会自动读取并用于 release 构建；文件缺失时回退 debug 签名，保证任何环境可构建。

```bash
cd android && gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

**务必长期备份** keystore 与密码文件：丢失后将无法再发布可覆盖升级的正式包。日常自测仍可用 `assembleDebug`。

## 测试

```bash
npm test          # 155 个单元 / 集成测试（共享逻辑、持久化、WebDAV、Store、MCP、加密、附件、外置资源、小组件摘要、AI 范围、提示词模板、适配层）
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
