# 题库数据结构 v2

题库主文件位于 `dist/data/questions.json`，页面启动时动态加载。`schemaVersion` 描述结构版本，`bankVersion` 描述内容版本，两者独立升级。

## 题目字段

- `id`：跨版本稳定的题目 ID，学习记录依赖它关联。
- `subject`、`chapter`、`knowledgePoints`：科目、章节和知识点数组。
- `type`：`single`、`multiple`、`case-single` 或 `case-multiple`。
- `material`：案例材料；普通题为 `null`。
- `stem`：题干。
- `options`：带稳定 ID 的选项对象数组。
- `answers`：正确选项 ID 数组。
- `scoring`：分值和是否支持部分得分。
- `explanation`：解析摘要、核心考点、口诀及逐项分析。
- `difficulty`：1–5 级难度。
- `frequency`：`low`、`medium` 或 `high`。
- `source`：来源类型、标题、年份和引用。
- `syllabusVersion`：适用大纲版本。
- `review`：`draft`、`reviewed`、`verified` 或 `retired`，并记录审核人和校验日期。
- `tags`：检索和组卷标签。

## 校验

运行：

```powershell
node scripts/validate-question-bank.cjs
```

校验器会检查版本、重复 ID、空题干、重复选项、答案越界、题型与答案数量、案例材料、难度、来源和审核状态。
