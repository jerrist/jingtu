# 经途 · 中级经济师人力方向刷题

手机优先的静态 PWA，覆盖经济基础知识与人力资源管理，并配有本地 SQLite 题库、批量导入、去重、异常报告、网页 JSON 导出和账号云同步流程。

线上地址：<https://exam.jerrists.cloud>

系统组成、数据流、持续集成和部署回滚说明见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 题库目录

- `database/question-bank.sqlite`：本地题库主库，不提交到 Git。
- `imports/raw/`：原始资料投放区。
- `reports/imports/`：导入异常和重复题报告。
- `exports/`：按需生成的其他格式。
- `dist/data/questions.json`：供网页读取的发布文件。

详细操作和日常建议见 [`题库维护指南.md`](题库维护指南.md)。
已导入的免费公开题源、数量及未导入原因见 [`FREE_SOURCE_LOG.md`](FREE_SOURCE_LOG.md)。

## 初始化与同步

需要 Node.js 24 或更高版本，不需要安装第三方依赖。

```powershell
npm run bank:sync
```

该命令会初始化主库、处理新增导入文件、导出网页题库并执行校验。相同内容的原始文件会通过 SHA-256 指纹自动跳过。

## 本地预览

在 `dist` 目录启动任意静态 HTTP 服务器即可。未登录时学习记录保存在浏览器 `localStorage` 中；登录后会与线上账号同步。

## GitHub 与自动发布

- 代码仓库：<https://github.com/jerrist/jingtu>
- `main` 分支每次推送都会运行 GitHub Actions 的 `CI` 工作流。
- 服务器每两分钟检查一次 `main`，只部署 CI 已成功的提交。
- 每次部署前都会在 `/var/lib/jingtu/backups` 创建 SQLite 一致性快照。
- 前端按 Git 提交建立独立版本目录，失败时自动恢复之前的前端与后端。
- 服务器运行数据库、备份、导入导出结果和发布压缩包均不会提交到 GitHub。
- Service Worker 对页面和题库使用网络优先、离线回退；`/api/` 永不进入浏览器 Cache Storage。

服务器端安装文件见 `deploy/server-auto-deploy.sh`、`deploy/jingtu-deploy.service` 和 `deploy/jingtu-deploy.timer`。

## 第一版功能

- 每日刷题计划与学习连续天数
- 双科章节练习
- 答题解析与错误原因记录
- 错题本和到期复习
- 15 分钟小模考
- 章节正确率与学习数据导出
- 独立 JSON 题库、结构版本和内容版本
- 单选、多选、案例单选及案例多选数据模型
- 题库自动校验脚本

> 当前内置题目为产品演示用示例题库，正式备考应替换或扩充为经授权、按最新考试大纲校验的题库。

题库结构说明见 `QUESTION_SCHEMA.md`。运行 `npm run bank:validate` 可检查题库完整性。
