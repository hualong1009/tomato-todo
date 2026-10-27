# 发布说明归档

每个版本一份 `vX.Y.Z.md`，发布流水线自动把它作为 GitHub Release 的说明：

- 文件**首行 `# 标题`** 会作为 Release 标题
- 其余内容为 Release 正文（Markdown）
- 打 `vX.Y.Z` 标签时流水线自动查找 `docs/releases/vX.Y.Z.md`：存在则使用，**不存在则回退 GitHub 自动生成**（只有 Full Changelog 一行）

## 发版流程

```bash
# 1. 升版本号（同步 Android versionName/versionCode）
npm run version:sync        # 先把 package.json 的 version 改成新版本

# 2. 写本版本说明 docs/releases/vX.Y.Z.md（首行 # 标题）

# 3. 提交并打标签，流水线完成构建 + 上传 + 发布说明
git add -A && git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z && git push origin master --tags
```

之后**不需要**再用 `gh release edit` 本地编辑发布说明。
