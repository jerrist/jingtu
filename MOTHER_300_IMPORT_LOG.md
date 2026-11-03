# 《中级经济基础》母题 300 题导入记录

导入日期：2026-11-03

## 结果

- PDF 原题：300 道。
- 结构化成功：300 道；解析拒绝：0 道。
- 主库新增：276 道；按内容指纹去重跳过：24 道。
- 导入后主库：490 道，其中经济基础知识 395 道、人力资源管理 95 道。
- 网页题库版本：`local-20261103.490`，结构版本：`2.1.0`。

主库导入前备份位于 `database/backups/question-bank-2026-11-03-before-mother-300.sqlite`。转换报告位于 `reports/imports/mother-300-conversion.json`，导入报告位于 `reports/imports/mother-300-structured-96a7136b.md`。

## 异常复核

自动转换仅人工复核了 6 道异常题：

- 第 160、163、167 题：原卷中为 5 选多选题，按答案数量识别为多选题。
- 第 287、294 题：虽位于多选题章节，但原题为 4 选单选题，按答案数量识别为单选题。
- 第 168 题：PDF 文本层遗漏泰铢符号，选项 D 依据原页解析补为 `฿（泰铢符号）`。

第 35、36 题共用 PDF 中的劳动供给曲线原图，资源路径为 `dist/assets/questions/mother-300/labor-supply-curve.jpg`。题库现支持题干、案例材料和答案解析三个位置的图片。

## 复现与校验

```powershell
npm run bank:convert-mother-300
node scripts/import-question-bank.cjs imports/raw/mother-300-structured.json
npm run bank:export
npm run bank:validate
npm run test:sw
```

网页复核指定题目：`http://127.0.0.1:4173/?question=mother-300-q035`。
