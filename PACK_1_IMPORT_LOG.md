# pack_1 密押卷导入记录

导入日期：2026-11-05

## 来源

本批共 8 份用户提供的 PDF：

- 经济基础高频核心密押卷、绝密押题卷各 1 套；
- 人力资源管理高频核心密押卷、绝密押题卷各 1 套；
- 经济基础临考密押 A、B、C、D 卷各 1 套。

PDF 原文件保存在 `imports/raw/pack_1/`，不提交到 GitHub。

## 导入结果

- 原始题目：830 道。
- 结构化成功：830 道；转换拒绝：0 道。
- 主库新增：820 道；内容去重跳过：10 道；导入拒绝：0 道。
- 答案冲突：0 道。
- 导入后主库：1330 道。
- 经济基础知识：1016 道；人力资源管理：314 道。
- 题型：单选 872 道、多选 398 道、案例单选 23 道、案例多选 37 道。
- 本批 40 道案例题均保留案例材料。
- 8 份 PDF 均未发现嵌入式题图，本批无需新增图片资源。

所有新增题目以 `draft` 状态导入，章节和大纲版本仍需后续人工审核。

## 异常与质量检查

- 同时支持“逐题附答案解析”和“试题、答案分区”两种 PDF 版式。
- 修复了题干以年份开头时容易被误判为小数编号的问题。
- 修复了多选答案使用 `ABC`、`A,B,C` 等不同格式时的识别问题。
- 复核了 B 卷第 14 题被公式干扰的答案行，识别结果为 B。
- 去重前比较了重复题答案，10 道重复题答案全部一致。
- 为新增的 820 道题补齐逐选项说明；原题源没有独立逐项解释时，明确标记为答案对照说明。

主库导入前备份位于 `database/backups/question-bank-2026-11-05-before-pack-1.sqlite`。转换报告位于 `reports/imports/pack_1-conversion.json`，导入报告位于 `reports/imports/pack_1-structured-828b8349.md`。

## 复现与校验

```powershell
npm run bank:convert-pack-1
node scripts/import-question-bank.cjs imports/raw/pack_1-structured.json
npm run bank:enrich-options
npm run bank:export
npm run bank:validate
npm run test:media
npm run test:options
npm run test:learning
npm run test:sw
```
