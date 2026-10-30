const fs = require("fs");
const path = require("path");
const { validateQuestion } = require("./question-bank-lib.cjs");

const projectRoot = path.resolve(__dirname, "..");

const sources = [
  {
    input: path.join(projectRoot, "tmp", "pdfs", "2023-经济基础知识.txt"),
    subject: "经济基础知识",
    year: 2023,
    first: 1,
    last: 105,
    singleLast: 70,
    idPrefix: "free-2023-econ",
    title: "2023年11月12日上午中级经济师《经济基础》真题及解析（机构整理版）",
    reference: "https://file.233.com/ess-files/ess-ecms-web/A15EB680A0134AB4BFE89C5D961FE5DD.pdf",
    sourceFile: "imports/raw/2023-经济基础知识-真题解析-233网校.pdf"
  },
  {
    input: path.join(projectRoot, "tmp", "pdfs", "2024-人力资源管理.txt"),
    subject: "人力资源管理",
    year: 2024,
    first: 1,
    last: 80,
    singleLast: 60,
    idPrefix: "free-2024-hr",
    title: "2024年中级经济师《人力资源管理》11月17日下午试题（机构整理版）",
    reference: "https://www.beijingchengzhi.com/upload/other/file/20250115173693202821.pdf",
    sourceFile: "imports/raw/2024-人力资源管理-完整版.pdf"
  }
];

function removeNoiseLines(text) {
  return text.split(/\r?\n/).filter((line) => {
    const value = line.trim();
    if (!value) return false;
    if (/^--- PAGE \d+ ---$/.test(value)) return false;
    if (/^\d+\s*\/\s*\d+$/.test(value)) return false;
    if (/^\d+$/.test(value)) return false;
    if (/^全真机考、/.test(value)) return false;
    if (/^20\d{2}年.*真题/.test(value)) return false;
    if (/^(单项选择题|多项选择题|共享题干题)$/.test(value)) return false;
    if (/^第第\d+题题/.test(value)) return false;
    return true;
  }).join(" ").replace(/\s+/g, " ").trim();
}

function findQuestionStart(text, questionNumber, fromIndex) {
  const pattern = new RegExp(`^${questionNumber}[、.]`, "gm");
  pattern.lastIndex = fromIndex;
  return pattern.exec(text)?.index ?? -1;
}

function splitQuestions(text, config) {
  const blocks = [];
  let cursor = 0;
  for (let number = config.first; number <= config.last; number += 1) {
    const start = findQuestionStart(text, number, cursor);
    if (start < 0) {
      blocks.push({ number, error: "找不到题号起点" });
      continue;
    }
    const next = number < config.last ? findQuestionStart(text, number + 1, start + 1) : text.length;
    if (next < 0) {
      blocks.push({ number, error: "找不到下一题起点" });
      cursor = start + 1;
      continue;
    }
    blocks.push({ number, text: text.slice(start, next) });
    cursor = next;
  }
  return blocks;
}

function parseQuestionBlock(block, config) {
  if (block.error) return { error: block.error };
  const answerPattern = /(?:参考)?答案\s*[：:]\s*([A-E](?:\s*[,，]?\s*[A-E])*)/i;
  const answerMatch = answerPattern.exec(block.text);
  if (!answerMatch) return { error: "找不到答案" };

  const beforeAnswer = removeNoiseLines(block.text.slice(0, answerMatch.index))
    .replace(new RegExp(`^${block.number}[、.]\s*`), "");
  const afterAnswer = removeNoiseLines(block.text.slice(answerMatch.index + answerMatch[0].length));
  const markerPattern = /([A-E])[.．、]\s*/g;
  const markers = [];
  let match;
  while ((match = markerPattern.exec(beforeAnswer))) markers.push({ id: match[1].toUpperCase(), index: match.index, end: markerPattern.lastIndex });
  if (markers.length < 2) return { error: "选项标记不足" };
  if (new Set(markers.map((marker) => marker.id)).size !== markers.length) return { error: "选项标记重复，原 PDF 版式需要人工修复" };

  const stem = beforeAnswer.slice(0, markers[0].index).trim().replace(/[.。]\s*$/, "。");
  const options = markers.map((marker, index) => ({
    id: marker.id,
    text: beforeAnswer.slice(marker.end, markers[index + 1]?.index ?? beforeAnswer.length).trim().replace(/◆+$/g, "").trim()
  }));
  const answers = [...answerMatch[1].toUpperCase().matchAll(/[A-E]/g)].map((item) => item[0]);
  const type = block.number <= config.singleLast ? "single" : "multiple";
  const question = {
    id: `${config.idPrefix}-q${String(block.number).padStart(3, "0")}`,
    subject: config.subject,
    chapter: `${config.year}年公开真题整理卷（待按2026大纲分类）`,
    knowledgePoints: ["待分类"],
    type,
    material: null,
    stem,
    options,
    answers,
    scoring: { score: type === "multiple" ? 2 : 1, partialCredit: type === "multiple" },
    explanation: {
      summary: afterAnswer || "原资料未提供解析，待补充。",
      keyPoint: "待分类",
      memoryTip: null,
      optionAnalysis: {}
    },
    difficulty: 2,
    frequency: "medium",
    source: {
      kind: "recalled_exam_public",
      title: config.title,
      year: config.year,
      reference: config.reference
    },
    syllabusVersion: "2026-待复核",
    review: { status: "draft", reviewer: null, verifiedAt: null },
    tags: [String(config.year), "公开免费题源", "机构整理版", "待分类", config.subject]
  };

  const errors = validateQuestion(question);
  if (stem.length < 6) errors.push({ code: "short-stem", message: "题干过短，可能包含未抽取的公式或图片" });
  if (![4, 5].includes(options.length)) errors.push({ code: "option-count", message: `选项数为 ${options.length}，需要人工检查` });
  if (options.some((option) => option.text.length < 1)) errors.push({ code: "empty-option", message: "存在空选项" });
  if (type === "single" && answers.length !== 1) errors.push({ code: "answer-count", message: "单选题答案数量异常" });
  if (type === "multiple" && answers.length < 2) errors.push({ code: "answer-count", message: "多选题答案数量异常" });
  if (errors.length) return { error: errors.map((item) => item.message).join("；"), preview: { stem, options, answers } };
  return { question };
}

const questions = [];
const report = { generatedAt: new Date().toISOString(), sources: [] };
for (const config of sources) {
  if (!fs.existsSync(config.input)) throw new Error(`找不到抽取文本：${config.input}`);
  const text = fs.readFileSync(config.input, "utf8");
  const blocks = splitQuestions(text, config);
  const sourceReport = { sourceFile: config.sourceFile, reference: config.reference, expected: config.last - config.first + 1, accepted: 0, rejected: [] };
  for (const block of blocks) {
    const result = parseQuestionBlock(block, config);
    if (result.question) {
      questions.push(result.question);
      sourceReport.accepted += 1;
    } else sourceReport.rejected.push({ number: block.number, reason: result.error, preview: result.preview || null });
  }
  report.sources.push(sourceReport);
}

const outputPath = path.join(projectRoot, "imports", "raw", "free-public-exams-2023-2024.json");
const reportPath = path.join(projectRoot, "reports", "imports", "free-public-exams-conversion.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ questions }, null, 2)}\n`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, reportPath, totalAccepted: questions.length, sources: report.sources.map(({ sourceFile, expected, accepted, rejected }) => ({ sourceFile, expected, accepted, rejected: rejected.length })) }, null, 2));
