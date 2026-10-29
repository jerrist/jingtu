const fs = require("fs");
const path = require("path");

const filename = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "../dist/data/questions.json");
const bank = JSON.parse(fs.readFileSync(filename, "utf8"));
const errors = [];
const allowedTypes = new Set(["single", "multiple", "case-single", "case-multiple"]);
const allowedFrequency = new Set(["low", "medium", "high"]);
const allowedReview = new Set(["draft", "reviewed", "verified", "retired"]);
const ids = new Set();

function requireValue(condition, message) { if (!condition) errors.push(message); }
requireValue(/^\d+\.\d+\.\d+$/.test(bank.schemaVersion || ""), "schemaVersion 必须是语义版本号");
requireValue(typeof bank.bankVersion === "string" && bank.bankVersion.length > 0, "缺少 bankVersion");
requireValue(typeof bank.syllabusVersion === "string" && bank.syllabusVersion.length > 0, "缺少 syllabusVersion");
requireValue(Array.isArray(bank.questions) && bank.questions.length > 0, "questions 必须是非空数组");

for (const [index, q] of (bank.questions || []).entries()) {
  const prefix = `第 ${index + 1} 题${q.id ? `(${q.id})` : ""}`;
  requireValue(typeof q.id === "string" && q.id.length > 0, `${prefix}: 缺少 id`);
  requireValue(!ids.has(q.id), `${prefix}: id 重复`); ids.add(q.id);
  requireValue(typeof q.subject === "string" && q.subject.length > 0, `${prefix}: 缺少 subject`);
  requireValue(typeof q.chapter === "string" && q.chapter.length > 0, `${prefix}: 缺少 chapter`);
  requireValue(Array.isArray(q.knowledgePoints) && q.knowledgePoints.length > 0, `${prefix}: knowledgePoints 不能为空`);
  requireValue(allowedTypes.has(q.type), `${prefix}: 不支持的 type ${q.type}`);
  requireValue(typeof q.stem === "string" && q.stem.trim().length > 0, `${prefix}: 题干为空`);
  requireValue(Array.isArray(q.options) && q.options.length >= 2, `${prefix}: 选项不足 2 个`);
  const optionIds = (q.options || []).map((o) => o.id);
  const optionTexts = (q.options || []).map((o) => o.text?.trim());
  requireValue(new Set(optionIds).size === optionIds.length, `${prefix}: 选项 id 重复`);
  requireValue(new Set(optionTexts).size === optionTexts.length, `${prefix}: 选项文本重复`);
  requireValue(optionTexts.every(Boolean), `${prefix}: 存在空选项`);
  requireValue(Array.isArray(q.answers) && q.answers.length > 0, `${prefix}: 缺少答案`);
  requireValue((q.answers || []).every((id) => optionIds.includes(id)), `${prefix}: 答案不属于任何选项`);
  if (["single", "case-single"].includes(q.type)) requireValue(q.answers.length === 1, `${prefix}: 单选题必须且只能有一个答案`);
  if (["multiple", "case-multiple"].includes(q.type)) requireValue(q.answers.length >= 2, `${prefix}: 多选题至少需要两个答案`);
  if (q.type.startsWith("case-")) requireValue(typeof q.material === "string" && q.material.trim().length > 0, `${prefix}: 案例题缺少 material`);
  requireValue(q.difficulty >= 1 && q.difficulty <= 5, `${prefix}: difficulty 必须在 1-5 之间`);
  requireValue(allowedFrequency.has(q.frequency), `${prefix}: frequency 无效`);
  requireValue(typeof q.explanation?.summary === "string" && q.explanation.summary.length > 0, `${prefix}: 缺少解析摘要`);
  requireValue(typeof q.source?.kind === "string", `${prefix}: 缺少来源类型`);
  requireValue(typeof q.syllabusVersion === "string", `${prefix}: 缺少题目大纲版本`);
  requireValue(allowedReview.has(q.review?.status), `${prefix}: 审核状态无效`);
}

if (errors.length) {
  console.error(`题库校验失败，共 ${errors.length} 个问题：`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const subjects = Object.fromEntries([...new Set(bank.questions.map((q) => q.subject))].map((subject) => [subject, bank.questions.filter((q) => q.subject === subject).length]));
const types = Object.fromEntries([...new Set(bank.questions.map((q) => q.type))].map((type) => [type, bank.questions.filter((q) => q.type === type).length]));
console.log(JSON.stringify({ valid: true, schemaVersion: bank.schemaVersion, bankVersion: bank.bankVersion, total: bank.questions.length, subjects, types }, null, 2));
