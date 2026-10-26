# 番茄待办

Windows 桌面待办应用：分组、状态视图、桌面便签、番茄专注、AI 回顾、WebDAV 备份与 MCP 接口。

## 开发与构建

```bash
npm install
npm run dev        # 开发模式
npm run build      # 类型检查 + 构建
npm run build:win  # 构建 Windows NSIS 安装包
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
- MCP：外部 Agent 可通过 stdio 搜索、新增、修改、开始、完成、归档待办和记录专注。
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
npm test       # 47 个单元 / 集成测试（共享逻辑、持久化、WebDAV、Store、MCP）
npm run test:e2e  # 构建后启动 Electron 的 Playwright 冒烟测试
```

E2E 覆盖新建、完成、详情、番茄钟、右键菜单、归档、设置、AI 面板、主题和搜索。

## 图标

应用图标基于 Twemoji Tomato（CC-BY 4.0）重新设计，源文件位于 `build/icon.svg`，生成 `icon.png` 与 `icon.ico`。
