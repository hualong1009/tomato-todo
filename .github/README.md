> 本文件说明本项目在 GitHub Actions 上的自动构建方式。
>
> - `.github/workflows/ci.yml`：每次 push / PR 跑类型检查与全部测试
> - `.github/workflows/release.yml`：打 `v*` 标签时构建签名 APK + Windows NSIS 安装包并上传到 Release
>
> 使用前需要在仓库 Settings → Secrets and variables → Actions 配置：
>
> | Secret | 内容 |
> | --- | --- |
> | `KEYSTORE_BASE64` | keystore 文件 base64（生成命令见下方） |
> | `KEYSTORE_PASSWORD` | keystore 密码 |
> | `KEY_ALIAS` | 签名别名（本项目为 tomato-todo） |
>
> 把 keystore 转 base64（Windows PowerShell）：
>
> ```powershell
> [Convert]::ToBase64String([IO.File]::ReadAllBytes("D:\OneDrive\Private\keystore\todolist\tomato-todo-release.keystore")) | Set-Clipboard
> ```
>
> 发布新版本：
>
> ```bash
> # 1. 改 package.json 版本（versionName/versionCode 会自动同步）
> npm run android:sync
> # 2. 提交后打标签推送，CI 自动构建并上传 APK
> git tag v1.2.1 && git push --tags
> ```
