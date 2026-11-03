const fs = require("fs");
const path = require("path");
const { normalizeQuestion, validateQuestion } = require("./question-bank-lib.cjs");
const { projectRoot } = require("./database.cjs");

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(projectRoot, "tmp", "pdfs", "母题300题.txt");
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(projectRoot, "imports", "raw", "mother-300-structured.json");
const reportPath = path.join(projectRoot, "reports", "imports", "mother-300-conversion.json");
const rawText = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const manualOptionRepairs = {
  168: {D: "฿（泰铢符号）"}
};

function compact(value) {
  return String(value || "")
    .replace(/^--- PAGE \d+ ---$/gm, " ")
    .replace(/^《中级经济基础》真题母题 300 题$/gm, " ")
    .replace(/^[一二]、(?:单|多)选题$/gm, " ")
    .replace(/^考证就上233网校APP.*$/gm, " ")
    .replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findQuestionStart(number, fromIndex) {
  const expression = new RegExp(`^${number}[、.]\\s*`, "gm");
  expression.lastIndex = fromIndex;
  return expression.exec(rawText);
}

function pageAt(index) {
  const prefix = rawText.slice(0, index);
  const matches = [...prefix.matchAll(/^--- PAGE (\d+) ---$/gm)];
  return matches.length ? Number(matches.at(-1)[1]) : 1;
}

function parseSegment(number, segment, page) {
  const answerMatch = segment.match(/参考答案\s*[：:]?\s*([A-E](?:\s*[,，、]\s*[A-E])*)/i);
  if (!answerMatch) throw new Error("未识别到参考答案");
  const beforeAnswer = segment.slice(0, answerMatch.index);
  const optionMatches = [...beforeAnswer.matchAll(/^([A-E])[.．、]\s*/gm)];
  if (![4, 5].includes(optionMatches.length)) throw new Error(`选项数异常：期望 4 或 5，实际 ${optionMatches.length}`);
  if (new Set(optionMatches.map((match) => match[1])).size !== optionMatches.length) throw new Error("选项编号重复");

  const firstOption = optionMatches[0];
  const stem = compact(beforeAnswer.slice(0, firstOption.index).replace(new RegExp(`^${number}[、.]\\s*`), ""));
  const options = optionMatches.map((match, index) => ({
    id: match[1],
    text: manualOptionRepairs[number]?.[match[1]] || compact(beforeAnswer.slice(match.index + match[0].length, optionMatches[index + 1]?.index ?? beforeAnswer.length))
  }));
  const answers = [...answerMatch[1].toUpperCase().matchAll(/[A-E]/g)].map((match) => match[0]);
  const explanationMarker = segment.slice(answerMatch.index + answerMatch[0].length).match(/参考解析\s*[：:]?/);
  const afterAnswer = segment.slice(answerMatch.index + answerMatch[0].length);
  const explanation = compact(explanationMarker ? afterAnswer.slice(explanationMarker.index + explanationMarker[0].length) : afterAnswer);
  const media = [35, 36].includes(number) ? [{
    id: "labor-supply-curve",
    kind: "image",
    src: "assets/questions/mother-300/labor-supply-curve.jpg",
    alt: "工资率与劳动供给量之间的后弯劳动供给曲线",
    caption: "个人劳动供给曲线",
    placement: "stem"
  }] : [];

  const { question } = normalizeQuestion({
    id: `mother-300-q${String(number).padStart(3, "0")}`,
    subject: "经济基础知识",
    chapter: "中级经济基础母题300题（待分类）",
    knowledgePoints: ["待分类"],
    type: answers.length > 1 ? "multiple" : "single",
    stem: number === 167 ? stem.replace(/^4、\s*/, "") : stem,
    media,
    options,
    answers,
    explanation,
    difficulty: 2,
    frequency: "medium",
    source: {
      kind: "user_provided_practice_pdf",
      title: "中级经济师《中级经济基础》母题300题",
      year: null,
      reference: "imports/raw/中级经济师《中级经济基础》母题300题.pdf",
      page
    },
    syllabusVersion: "待校验",
    review: {status: "draft", reviewer: null, verifiedAt: null},
    tags: ["母题300题", `原题号${number}`]
  });
  if (stem.length < 6) throw new Error(`题干过短：${stem}`);
  if (options.some((option) => option.text.length < 1)) throw new Error("存在空选项");
  const errors = validateQuestion(question);
  if (errors.length) throw new Error(errors.map((error) => `${error.code}: ${error.message}`).join("；"));
  return question;
}

const questions = [];
const rejected = [];
let cursor = 0;
for (let number = 1; number <= 300; number += 1) {
  const startMatch = findQuestionStart(number, cursor);
  if (!startMatch) {
    rejected.push({number, page: null, error: "未找到题号起始位置"});
    continue;
  }
  const nextMatch = number < 300 ? findQuestionStart(number + 1, startMatch.index + startMatch[0].length) : null;
  const end = nextMatch?.index ?? rawText.length;
  const page = pageAt(startMatch.index);
  try {
    questions.push(parseSegment(number, rawText.slice(startMatch.index, end), page));
  } catch (error) {
    rejected.push({number, page, error: error.message});
  }
  cursor = end;
}

const report = {
  source: path.relative(projectRoot, inputPath),
  output: path.relative(projectRoot, outputPath),
  expected: 300,
  accepted: questions.length,
  rejected: rejected.length,
  issues: rejected
};
fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.mkdirSync(path.dirname(reportPath), {recursive: true});
fs.writeFileSync(outputPath, `${JSON.stringify({questions}, null, 2)}\n`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (rejected.length) process.exitCode = 2;
