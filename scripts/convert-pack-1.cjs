const fs = require("fs");
const path = require("path");
const { normalizeQuestion, validateQuestion } = require("./question-bank-lib.cjs");
const { projectRoot } = require("./database.cjs");

const textRoot = path.join(projectRoot, "tmp", "pdfs", "pack_1");
const outputPath = path.join(projectRoot, "imports", "raw", "pack_1-structured.json");
const reportPath = path.join(projectRoot, "reports", "imports", "pack_1-conversion.json");

const configs = [
  {
    key: "econ-core",
    text: "pack1-01.txt",
    pdf: "2026年中级经济师《经济基础》高频核心密押卷.pdf",
    title: "2026年中级经济师《经济基础》高频核心密押卷",
    subject: "经济基础知识",
    expected: 105,
    mode: "inline"
  },
  {
    key: "econ-secret",
    text: "pack1-02.txt",
    pdf: "2026年中级经济师《经济基础》绝密押题卷（试题+答案）.pdf",
    title: "2026年中级经济师《经济基础》绝密押题卷",
    subject: "经济基础知识",
    expected: 105,
    mode: "inline"
  },
  {
    key: "hr-core",
    text: "pack1-03.txt",
    pdf: "2026年中级经济师《人力资源管理》高频核心密押卷.pdf",
    title: "2026年中级经济师《人力资源管理》高频核心密押卷",
    subject: "人力资源管理",
    expected: 100,
    mode: "inline"
  },
  {
    key: "hr-secret",
    text: "pack1-04.txt",
    pdf: "2026年中经《人力资源管理》绝密押题卷（试题+答案）.pdf",
    title: "2026年中经《人力资源管理》绝密押题卷",
    subject: "人力资源管理",
    expected: 100,
    mode: "inline"
  },
  {
    key: "econ-a",
    text: "pack1-05.txt",
    pdf: "经济基础密押A卷.pdf",
    title: "2026中级经济师《经济基础》临考密押A卷",
    subject: "经济基础知识",
    expected: 105,
    mode: "separate"
  },
  {
    key: "econ-b",
    text: "pack1-06.txt",
    pdf: "经济基础密押B卷.pdf",
    title: "2026中级经济师《经济基础》临考密押B卷",
    subject: "经济基础知识",
    expected: 105,
    mode: "separate"
  },
  {
    key: "econ-c",
    text: "pack1-07.txt",
    pdf: "经济基础密押C卷.pdf",
    title: "2026中级经济师《经济基础》临考密押C卷",
    subject: "经济基础知识",
    expected: 105,
    mode: "separate"
  },
  {
    key: "econ-d",
    text: "pack1-08.txt",
    pdf: "经济基础密押D卷.pdf",
    title: "2026中级经济师《经济基础》临考密押D卷",
    subject: "经济基础知识",
    expected: 105,
    mode: "separate"
  }
];

function compact(value) {
  return String(value || "")
    .replace(/^--- PAGE \d+ ---$/gm, " ")
    .replace(/^\s*(?:一|二|三)[.、､].*题.*$/gm, " ")
    .replace(/【\s*\d+\s*分\s*】/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageAt(text, index) {
  const matches = [...text.slice(0, index).matchAll(/^--- PAGE (\d+) ---$/gm)];
  return matches.length ? Number(matches.at(-1)[1]) : 1;
}

function candidateMatches(value) {
  const matches = [];
  for (const match of value.matchAll(/^(\d+\.\d+)(?=【)/gm)) matches.push({index: match.index, end: match.index + match[0].length, label: match[1], caseQuestion: true});
  for (const match of value.matchAll(/^(\d+)[.．]\s*/gm)) {
    if (/^\d+[.．]\d+(?=【)/.test(value.slice(match.index))) continue;
    if (Number(match[1]) <= 105) matches.push({index: match.index, end: match.index + match[0].length, label: match[1], caseQuestion: false});
  }
  return matches.sort((a, b) => a.index - b.index);
}

function optionMarkers(value) {
  return [...value.matchAll(/^([A-E])[.．、:：]\s*/gm)].map((match) => ({
    id: match[1], index: match.index, end: match.index + match[0].length
  }));
}

function lastOptionGroup(value) {
  const markers = optionMarkers(value);
  let chosen = null;
  for (let index = 0; index < markers.length; index += 1) {
    if (markers[index].id !== "A") continue;
    const group = [markers[index]];
    for (let next = index + 1; next < markers.length; next += 1) {
      const expected = String.fromCharCode(65 + group.length);
      if (markers[next].id === "A") break;
      if (markers[next].id !== expected) break;
      group.push(markers[next]);
      if (group.length === 5) break;
    }
    if (group.length >= 4) chosen = group;
  }
  return chosen;
}

function extractOptions(text, absoluteStart, absoluteEnd, markers) {
  return markers.map((marker, index) => {
    const start = absoluteStart + marker.end;
    const end = index + 1 < markers.length ? absoluteStart + markers[index + 1].index : absoluteEnd;
    return {id: marker.id, text: compact(text.slice(start, end))};
  });
}

function caseMaterial(text, questionStart, label) {
  const group = label.split(".")[0];
  const caseHeading = text.lastIndexOf("三.案例分析题", questionStart);
  const prefix = text.slice(Math.max(0, caseHeading), questionStart);
  const groupMatches = [...prefix.matchAll(new RegExp(`^${group}[.．]\\s*`, "gm"))];
  if (!groupMatches.length) return null;
  const start = Math.max(0, caseHeading) + groupMatches.at(-1).index + groupMatches.at(-1)[0].length;
  const materialText = text.slice(start, questionStart).replace(/根据以上资料，回答下列问题[：:]?/g, " ");
  return compact(materialText) || null;
}

function makeQuestion(config, parsed, order) {
  const answerCount = parsed.answers.length;
  const type = parsed.caseQuestion
    ? (answerCount > 1 ? "case-multiple" : "case-single")
    : (answerCount > 1 ? "multiple" : "single");
  const { question } = normalizeQuestion({
    id: `pack1-${config.key}-q${String(order).padStart(3, "0")}`,
    subject: config.subject,
    chapter: `${config.title}（待分类）`,
    knowledgePoints: ["待分类"],
    type,
    material: parsed.material,
    stem: parsed.stem,
    media: [],
    options: parsed.options,
    answers: parsed.answers,
    explanation: parsed.explanation || "待补充解析",
    difficulty: 2,
    frequency: "high",
    source: {
      kind: "user_provided_practice_pdf",
      title: config.title,
      year: 2026,
      reference: `imports/raw/pack_1/${config.pdf}`,
      page: parsed.page
    },
    syllabusVersion: "2026-待复核",
    review: {status: "draft", reviewer: null, verifiedAt: null},
    tags: ["2026", "密押卷", "pack_1", `原题号${parsed.label}`]
  });
  const errors = validateQuestion(question);
  if (question.stem.length < 6) errors.push({code: "short-stem", message: "题干过短"});
  if (![4, 5].includes(question.options.length)) errors.push({code: "option-count", message: `选项数为 ${question.options.length}`});
  if (question.options.some((option) => !option.text)) errors.push({code: "empty-option", message: "存在空选项"});
  return {question, errors};
}

function parseInline(config, text) {
  const answerMatches = [...text.matchAll(/^答案\s*[：:]\s*([A-E]+)/gm)];
  const located = [];
  let previousAnswerEnd = 0;
  for (const answerMatch of answerMatches) {
    const window = text.slice(previousAnswerEnd, answerMatch.index);
    const group = lastOptionGroup(window);
    if (!group) {
      located.push({error: "答案前未识别到 A-D 选项", answer: answerMatch[1], page: pageAt(text, answerMatch.index)});
      previousAnswerEnd = answerMatch.index + answerMatch[0].length;
      continue;
    }
    const beforeOptions = window.slice(0, group[0].index);
    const candidates = candidateMatches(beforeOptions);
    const candidate = candidates.at(-1);
    if (!candidate) {
      located.push({error: "答案前未识别到题号", answer: answerMatch[1], page: pageAt(text, answerMatch.index)});
      previousAnswerEnd = answerMatch.index + answerMatch[0].length;
      continue;
    }
    located.push({
      start: previousAnswerEnd + candidate.index,
      markerEnd: previousAnswerEnd + candidate.end,
      label: candidate.label,
      caseQuestion: candidate.caseQuestion,
      optionMarkers: group,
      optionWindowStart: previousAnswerEnd,
      answerIndex: answerMatch.index,
      answerEnd: answerMatch.index + answerMatch[0].length,
      answers: [...answerMatch[1]]
    });
    previousAnswerEnd = answerMatch.index + answerMatch[0].length;
  }

  const valid = located.filter((item) => item.start !== undefined);
  const parsed = valid.map((item, index) => {
    const nextStart = valid[index + 1]?.start ?? text.length;
    const optionStart = item.optionWindowStart + item.optionMarkers[0].index;
    const options = extractOptions(text, item.optionWindowStart, item.answerIndex, item.optionMarkers);
    const afterAnswer = text.slice(item.answerEnd, nextStart);
    const explanationMatch = afterAnswer.match(/解析\s*[：:]\s*/);
    return {
      label: item.label,
      caseQuestion: item.caseQuestion,
      material: item.caseQuestion ? caseMaterial(text, item.start, item.label) : null,
      stem: compact(text.slice(item.markerEnd, optionStart).replace(/^【不定项选择题】\s*/, "")),
      options,
      answers: item.answers,
      explanation: compact(explanationMatch ? afterAnswer.slice(explanationMatch.index + explanationMatch[0].length) : afterAnswer),
      page: pageAt(text, item.start)
    };
  });
  return {parsed, locationIssues: located.filter((item) => item.error)};
}

function findNumberedStart(text, number, fromIndex = 0) {
  const expression = new RegExp(`^${number}[.．]\\s*`, "gm");
  expression.lastIndex = fromIndex;
  return expression.exec(text);
}

function parseSeparate(config, text) {
  let answerHeading = text.search(/^参考答案及解析\s*$/m);
  if (answerHeading < 0) answerHeading = text.search(/^1[.．]?\s*【答案/m);
  if (answerHeading < 0) return {parsed: [], locationIssues: [{error: "未找到答案区"}]};
  const questionText = text.slice(0, answerHeading);
  const answerText = text.slice(answerHeading);
  const answers = new Map();
  const answerMatches = [...answerText.matchAll(/^(\d+)[.．]?\s*【答案[^】]*】\s*(?:=\s*)?([A-E](?:(?:\s*[,，、]\s*)?[A-E])*)/gm)];
  for (const [index, match] of answerMatches.entries()) {
    const nextIndex = answerMatches[index + 1]?.index ?? answerText.length;
    const after = answerText.slice(match.index + match[0].length, nextIndex);
    const explanationMatch = after.match(/【解析】\s*/);
    answers.set(Number(match[1]), {
      answers: [...match[2].matchAll(/[A-E]/g)].map((item) => item[0]),
      explanation: compact(explanationMatch ? after.slice(explanationMatch.index + explanationMatch[0].length) : after)
    });
  }

  const parsed = [];
  const locationIssues = [];
  let cursor = 0;
  for (let number = 1; number <= config.expected; number += 1) {
    const start = findNumberedStart(questionText, number, cursor);
    if (!start) {
      locationIssues.push({number, error: "未找到题号"});
      continue;
    }
    const next = number < config.expected ? findNumberedStart(questionText, number + 1, start.index + start[0].length) : null;
    const end = next?.index ?? questionText.length;
    const segment = questionText.slice(start.index, end);
    const markers = optionMarkers(segment);
    const answer = answers.get(number);
    if (!answer) {
      locationIssues.push({number, page: pageAt(text, start.index), error: "未找到答案"});
      cursor = end;
      continue;
    }
    if (![4, 5].includes(markers.length)) {
      locationIssues.push({number, page: pageAt(text, start.index), error: `选项数异常：${markers.length}`});
      cursor = end;
      continue;
    }
    parsed.push({
      label: String(number),
      caseQuestion: false,
      material: null,
      stem: compact(segment.slice(start[0].length, markers[0].index)),
      options: extractOptions(segment, 0, segment.length, markers),
      answers: answer.answers,
      explanation: answer.explanation,
      page: pageAt(text, start.index)
    });
    cursor = end;
  }
  return {parsed, locationIssues};
}

const questions = [];
const reports = [];
for (const config of configs) {
  const inputPath = path.join(textRoot, config.text);
  const text = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
  const result = config.mode === "inline" ? parseInline(config, text) : parseSeparate(config, text);
  const issues = result.locationIssues.map((issue) => ({...issue}));
  let accepted = 0;
  for (const [index, parsed] of result.parsed.entries()) {
    const built = makeQuestion(config, parsed, index + 1);
    if (built.errors.length) {
      issues.push({number: parsed.label, page: parsed.page, error: built.errors.map((item) => `${item.code}: ${item.message}`).join("；")});
      continue;
    }
    questions.push(built.question);
    accepted += 1;
  }
  reports.push({
    key: config.key,
    source: `imports/raw/pack_1/${config.pdf}`,
    expected: config.expected,
    located: result.parsed.length,
    accepted,
    rejected: config.expected - accepted,
    issues
  });
}

const summary = {
  expected: configs.reduce((sum, config) => sum + config.expected, 0),
  accepted: questions.length,
  rejected: configs.reduce((sum, config) => sum + config.expected, 0) - questions.length,
  files: reports
};
fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.mkdirSync(path.dirname(reportPath), {recursive: true});
fs.writeFileSync(outputPath, `${JSON.stringify({questions}, null, 2)}\n`);
fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (summary.rejected) process.exitCode = 2;
