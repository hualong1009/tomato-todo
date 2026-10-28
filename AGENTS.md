# AGENTS.md

> AI 编程助手与人类开发者的共同开发规范，由 pi-init 生成，请结合实际修订。

## 1. 项目概述

番茄待办（tomato-todo）：集待办清单、番茄钟、桌面便签、AI 回顾于一体的效率应用。一套代码三个平台——Windows/Linux/macOS 桌面端（Electron）与 Android 端（Capacitor），渲染层与核心逻辑完全共享。

核心技术栈与关键依赖：

- **桌面端**：Electron + electron-vite + React + TypeScript（electron-builder 打包，Windows NSIS / Linux AppImage·deb·rpm / macOS dmg）
- **移动端**：Capacitor 8（`android/` 原生工程，Java + RemoteViews 桌面小组件）
- **共享逻辑**：`src/shared/` 为纯 Node-free 的渲染器共用代码（类型、状态操作、备份、AI 摘要）
- **AI**：OpenAI / Anthropic 兼容网关，多提示词模板
- **自动化**：内置 MCP 服务器（stdio），供外部 Agent 操作待办
- **测试**：Vitest（单测）+ playwright-core（Electron/浏览器 e2e）

## 2. 快速命令

```bash
npm install            # 安装依赖

npm run dev            # Electron 开发模式（热重载）
npm run build          # 类型检查 + 构建主进程/渲染层/MCP 入口（产物在 out/）
npm run build:win      # 构建 Windows NSIS 安装包
npm run build:linux    # 构建 Linux AppImage/deb/rpm（deb/rpm 需在 Linux/macOS 上打包）
npm run build:mac      # 构建 macOS dmg（需在 macOS 上打包）

npm run dev:web        # 浏览器里预览移动端布局（手机视口）
npm run build:web      # 构建移动端 Web 资源到 dist-mobile/

npm test               # vitest run（全部单测，216 项）
npx vitest run tests/shared.test.ts   # 运行单个测试文件
npm run test:e2e       # 构建 + 全部 e2e（electron-smoke/sticky-window/dropdown-ui/security/mobile-web/mcp-stdio）

# Android（需要 ANDROID_HOME 与 JDK 21；本地 gradle wrapper 用腾讯镜像）
npm run android:sync   # build:web + 版本同步 + cap sync android
npm run android:open   # Android Studio 打开工程
npm run android:run    # 部署到设备
npm run version:sync   # package.json 版本 → Android versionName/versionCode
```

## 3. 目录结构说明

```
src/
├── main/        # Electron 主进程（Node 环境）：持久化、WebDAV、备份加密、安全锁、本地备份
│   └── index.ts     # 主进程入口：窗口管理、便签窗口、IPC、快捷键、MCP 启动
├── preload/     # 预加载脚本：contextBridge 暴露 window.api
├── renderer/    # 渲染层（浏览器环境，桌面/安卓共用）
│   ├── src/main.tsx         # 渲染入口（#/sticky/ 路由分流便签窗口）
│   ├── src/App.tsx          # 主应用（桌面+移动端自适应）
│   ├── src/components/      # 全部 UI 组件（TodoItem、DetailPanel、RichContentEditor…）
│   ├── src/platform/        # 平台适配：Electron api / Capacitor 适配层
│   └── src/*.css            # 按职责拆分的样式表
├── shared/      # ⚠️ 纯共享代码，禁止 import Node API（渲染器共用）
│   ├── types.ts         # 全部领域类型（Todo/Group/Settings/AppState…）
│   ├── operations.ts     # 状态操作（createTodo/updateTodo…，纯函数）
│   └── normalise.ts      # 状态校验/迁移（任何来源的数据先过这里）
└── mcp/         # MCP 服务器（stdio，供外部 Agent 操作待办）

android/         # Capacitor 原生工程（MainActivity + TodoWidgetProvider/ThemePlugin/WidgetPlugin）
tests/           # vitest 单测 + tests/e2e/ 端到端
scripts/         # 版本同步、MCP 入口打包、安卓图标生成
docs/            # ci.md（CI 说明）、releases/（每版发布说明）、images/
.github/         # ci.yml（PR/push 测试）、release.yml（v* 标签四平台发布）、actions/publish-release/
build/          # 应用图标（icon.png 1024×1024、icon.ico）
```

重要入口：`package.json` 的 `version` 是**唯一版本维护点**，`npm run version:sync` 同步到 `android/app/build.gradle`（versionCode = major×10000+minor×100+patch）。

## 4. 代码风格与规范

- TypeScript 严格模式（`tsconfig.node.json` 主进程 / `tsconfig.web.json` 渲染层两套）；无独立 lint 配置，**`npm run typecheck` 是门禁**
- 命名：组件 `PascalCase.tsx`；工具/共享模块 `camelCase.ts`；测试 `*.test.ts`；`data-testid` 属性用于 e2e（如 `composer-title`、`todo-check`、`settings-tab-{key}`）
- **环境边界（最重要）**：
  - `src/shared/`、`src/renderer/` 禁止 `import` 任何 Node 内置模块（`fs`/`path`/`Buffer`…）——这些代码同时跑在安卓 WebView 里
  - Node 专属逻辑放 `src/main/`；跨进程调用走 `window.api`（preload 暴露）或 Capacitor 插件
  - Capacitor `registerPlugin` 必须有 `Capacitor.isNativePlatform()` 守卫；单测 mock 的 `@capacitor/core` 需提供对应 mock 方法
- 渲染层判断平台用 `isMobile`（`platform/`），样式桌面挂 `.app-root`、移动端挂 `.mobile-app`/`.sheet` 前缀，互不影响
- Android 插件方法运行在桥接线程：**窗口操作必须 `runOnUiThread` 包裹**（否则 CalledFromWrongThreadException 闪退，见 issue #7 前的 #2 类教训）
- 状态数据（WebDAV 恢复、导入等）一律过 `normaliseState` 校验后才使用
- 密码/敏感信息只经设置存储，禁止写入日志或备份明文

## 5. 禁止规则（NEVER Rules）

- 🚫 禁止提交 `keystore`、`release-signing.properties` 等签名材料——正式签名材料在仓库外（`D:/OneDrive/Private/keystore/todolist/`），**务必长期备份**
- 🚫 禁止修改构建产物目录：`node_modules/`、`out/`、`dist-mobile/`、`release/`、`android/app/build/`、`android/.gradle/`、`android/app/src/main/assets/public/`（gitignore 已排除）
- 🚫 禁止随意修改 `package-lock.json`（依赖变更时才动；且锁文件源必须保持 registry.npmjs.org 官方源——CI runner 在境外，指向内网镜像会导致流水线失败）
- 🚫 禁止提交密钥、token、密码等敏感信息
- 🚫 禁止在 `src/shared/`、`src/renderer/` 引入 Node API（见第 4 节）
- 🚫 禁止跳过测试直接提交：PR 必须等 CI（typecheck + 216 项单测）通过再合并
- 🚫 禁止手动修改 `android/gradle/wrapper/gradle-wrapper.properties` 的腾讯镜像配置（本地故意为之，CI workflow 会自动改回官方源，该文件永久排除在提交外）
- 🚫 禁止在 `android` 布局/manifest 里使用高版本不存在的属性（如 `android:updateWhenScreenOn`，API 36 link 失败）
- ⚠️ 项目在 OneDrive 同步目录：NSIS 打包输出目录要指向本地盘（`--config.directories.output="D:/tmp/tomato-release"`），避免 EPERM

## 6. Git 工作流

- **分支**：`master` 为主分支；功能/修复分支命名 `feat/xxx`、`fix/xxx`、`ci/xxx`
- **提交信息**：Conventional Commits（`feat:`、`fix:`、`ci:`、`chore:`、`docs:`），正文写清动机；修复关联 issue 用 `Fixes #N`
- **PR 流程**：改分支 → push → `gh pr create` → CI 绿 → `gh pr merge <n> --squash --delete-branch`（squash 合入）
- **发布**：改 `package.json` 版本 → `npm run version:sync` → 写 `docs/releases/vX.Y.Z.md`（首行 `# 标题`）→ commit → `git tag vX.Y.Z && git push origin master --tags`；发布说明由流水线自动应用（`.github/actions/publish-release`），**禁止**发版后再本地 `gh release edit`
- **重跑发布**：`git tag -f vX.Y.Z && git push -f origin vX.Y.Z`（私有仓库允许 force push）

## 7. 常见任务指南

**添加新依赖**：`npm i <pkg>`（渲染层共享代码只用浏览器/Node 双端兼容的包）；提交时一并提交 `package-lock.json`，确认解析源是官方 registry

**运行单个测试**：`npx vitest run tests/xxx.test.ts`（watch 模式 `npm run test:watch`）；单条用例 `npx vitest run -t '用例名'`

**运行/编写 e2e**：`node tests/e2e/electron-smoke.mjs` 等（必须在项目目录内跑，playwright-core 需本地解析；Electron 用系统 Chrome channel）；新增交互时给元素加 `data-testid`

**调试**：
- Electron：`npm run dev` 打开 DevTools；主进程日志看终端
- Android：`npm run android:run` + `adb logcat`；布局问题先想 `ThemePlugin` 的 insets/主题机制，Web 层的 `env(safe-area-inset-*)` 在安卓 WebView 恒为 0，系统栏留白靠原生注入的 `--safe-*` CSS 变量
- 便签窗口：路由 `#/sticky/<todoId>`（`loadFile` 的 hash 必须保留开头 `/`）

**改 Android 版本**：只改 `package.json` 的 `version`，再 `npm run version:sync`（versionCode 公式固定，勿手改 build.gradle）

**验证签名**：`$ANDROID_HOME/build-tools/36.0.0/apksigner.bat verify --print-certs <apk>`
