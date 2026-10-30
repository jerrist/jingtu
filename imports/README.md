# 原始题目投放区

把待整理资料放进 `raw/`。自动导入目前支持：

- `.csv`
- `.json`
- `.jsonl` / `.ndjson`

Excel、Word、PDF 和图片也可以放入 `raw/`，但不会被自动脚本读取。放入后直接告诉 Codex具体文件名，由 Codex先转换、检查，再导入主库。

不要反复改名上传同一份文件。导入器会记录文件 SHA-256；内容完全相同的文件不会重复处理。

CSV 模板见 `templates/questions-template.csv`。不确定字段时可以只填写科目、章节、题型、题干、选项、答案和解析，其余字段由整理流程补充。

`examples/import-example.csv` 仅用于展示格式和测试重复检测，不会被默认导入。
