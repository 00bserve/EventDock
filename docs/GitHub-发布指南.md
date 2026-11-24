# 随记坞（EventDock）GitHub 发布指南

| 项目 | 内容 |
| --- | --- |
| 产品名 | 随记坞 · EventDock |
| GitHub 仓库名 | `eventdock` |
| 仓库简介 | 面向 Windows 的本地桌面事件记录工具，支持贴边入口、截图和附件。 |
| 推荐主题 | `electron`、`windows`、`offline-first`、`sqlite`、`tiptap` |

## 1. 检查待提交文件

在 EventDock 独立目录操作。提交源码、依赖锁文件、图标、README 和设计文档。安装程序和便携版可在发布时作为 GitHub Release 附件上传。

`.gitignore` 已排除依赖、构建目录和生成的编辑器包。暂存前检查数据库、个人附件、访问令牌和本地配置。当前工作区保留了上游来源说明，未包含上游的 `LICENSE` 文件。公开发布前确认保留内容的授权范围，再选择项目的许可说明。[GitHub 仓库许可说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

## 2. 创建仓库和首次提交

在 GitHub 上创建空仓库 `eventdock`。如需先保存和审查代码，可把可见性设为 Private。仓库初始化选项留空，本地已有 README。执行以下命令，从 `git status` 核对暂存内容后再提交。[GitHub 导入已有本地代码](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)

```powershell
git init -b main
git add --all
git status --short
git commit -m "Initial EventDock release"
```

## 3. 首次推送

将 `YOUR_ACCOUNT` 改成你的 GitHub 用户名或组织名。

```powershell
git remote add origin https://github.com/YOUR_ACCOUNT/eventdock.git
git remote -v
git push -u origin main
```

## 4. 发布 Windows 构建（可选）

使用 Node.js 22.12 或更高版本执行 `npm ci` 和 `npm run build`。在 GitHub Releases 创建与 `package.json` 版本相同的标签，例如 `v0.2.0`，将 `dist/` 下的安装包和便携版上传为附件。[GitHub 发布说明](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
