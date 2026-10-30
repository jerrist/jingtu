# SQLite 主库

`question-bank.sqlite` 是题库唯一主库。网页使用的 `dist/data/questions.json` 是从主库生成的发布文件，不应作为日常维护入口。

主要数据表：

- `questions`：规范化题目；题目 ID 和内容指纹均唯一。
- `import_batches`：每次导入的文件指纹、状态和统计。
- `import_issues`：缺字段、重复题、待补解析等问题。
- `metadata`：结构版本、大纲版本和题库名称。

请定期备份本目录中的 `.sqlite` 文件。不要手工删除 `questions` 表中的题目；需要退役的题目应把审核状态改为 `retired`，以保留历史学习记录。
