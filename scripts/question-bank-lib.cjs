const crypto = require("crypto");

const ALLOWED_TYPES = new Set(["single", "multiple", "case-single", "case-multiple"]);
const ALLOWED_FREQUENCIES = new Set(["low", "medium", "high"]);
const ALLOWED_REVIEW = new Set(["draft", "reviewed", "verified", "retired"]);

function firstDefined(object, names) {
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null && object[name] !== "") return object[name];
  }
  return undefined;
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function toList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  if (!text) return [];
  return text.split(/[|;；,，、\n]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeType(value, answerCount = 1, hasMaterial = false) {
  const text = cleanText(value).toLowerCase();
  const map = {
    "单选": "single", "单选题": "single", "single": "single",
    "多选": "multiple", "多选题": "multiple", "multiple": "multiple",
    "案例单选": "case-single", "案例单选题": "case-single", "case-single": "case-single",
    "案例多选": "case-multiple", "案例多选题": "case-multiple", "case-multiple": "case-multiple"
  };
  if (map[text]) return map[text];
  if (hasMaterial) return answerCount > 1 ? "case-multiple" : "case-single";
  return answerCount > 1 ? "multiple" : "single";
}

function normalizeAnswers(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item).toUpperCase()).filter(Boolean);
  const text = cleanText(value).toUpperCase();
  if (!text) return [];
  if (/^[A-H]+$/.test(text)) return [...text];
  return text.split(/[|;；,，、\s]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeOptions(raw) {
  if (Array.isArray(raw.options)) {
    return raw.options.map((option, index) => {
      if (typeof option === "object" && option !== null) {
        return { id: cleanText(option.id || String.fromCharCode(65 + index)).toUpperCase(), text: cleanText(option.text ?? option.value) };
      }
      return { id: String.fromCharCode(65 + index), text: cleanText(option) };
    }).filter((option) => option.text);
  }

  const options = [];
  for (const id of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    const text = firstDefined(raw, [`option${id}`, `选项${id}`, id]);
    if (text !== undefined && cleanText(text)) options.push({ id, text: cleanText(text) });
  }
  return options;
}

function normalizeExplanation(raw, warnings) {
  if (raw.explanation && typeof raw.explanation === "object") {
    return {
      summary: cleanText(raw.explanation.summary) || "待补充解析",
      keyPoint: cleanText(raw.explanation.keyPoint) || null,
      memoryTip: cleanText(raw.explanation.memoryTip) || null,
      optionAnalysis: raw.explanation.optionAnalysis && typeof raw.explanation.optionAnalysis === "object" ? raw.explanation.optionAnalysis : {}
    };
  }
  const summary = cleanText(firstDefined(raw, ["explanation", "解析", "答案解析"]));
  if (!summary) warnings.push({ code: "missing-explanation", message: "缺少解析，已标记为待补充" });
  return { summary: summary || "待补充解析", keyPoint: null, memoryTip: null, optionAnalysis: {} };
}

function fingerprintQuestion(question) {
  const normalized = [
    cleanText(question.subject).replace(/\s+/g, ""),
    cleanText(question.stem).replace(/[\s，。；：、,.!?！？;:]/g, "").toLowerCase(),
    ...(question.options || []).map((option) => cleanText(option.text).replace(/\s+/g, "").toLowerCase())
  ].join("|");
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function normalizeQuestion(raw, defaults = {}) {
  const warnings = [];
  const options = normalizeOptions(raw);
  const answers = normalizeAnswers(firstDefined(raw, ["answers", "answer", "答案", "正确答案"]));
  const material = cleanText(firstDefined(raw, ["material", "案例材料", "材料"])) || null;
  const subject = cleanText(firstDefined(raw, ["subject", "科目"]) ?? defaults.subject);
  const chapter = cleanText(firstDefined(raw, ["chapter", "章节"]) ?? defaults.chapter);
  const knowledgePoints = toList(firstDefined(raw, ["knowledgePoints", "knowledgePoint", "知识点"])) || [];
  const type = normalizeType(firstDefined(raw, ["type", "题型"]), answers.length, Boolean(material));
  const sourceValue = raw.source && typeof raw.source === "object" ? raw.source : {};
  const reviewValue = raw.review && typeof raw.review === "object" ? raw.review : {};
  const explanation = normalizeExplanation(raw, warnings);

  const question = {
    id: cleanText(firstDefined(raw, ["id", "题号", "编号"])),
    subject,
    chapter,
    knowledgePoints: knowledgePoints.length ? knowledgePoints : (chapter ? [chapter] : []),
    type,
    material,
    stem: cleanText(firstDefined(raw, ["stem", "question", "题干", "题目"])),
    options,
    answers,
    scoring: raw.scoring && typeof raw.scoring === "object" ? raw.scoring : {
      score: Number(firstDefined(raw, ["score", "分值"])) || (type.includes("multiple") ? 2 : 1),
      partialCredit: type.includes("multiple")
    },
    explanation,
    difficulty: Number(firstDefined(raw, ["difficulty", "难度"])) || 2,
    frequency: cleanText(firstDefined(raw, ["frequency", "频率"])) || "medium",
    source: {
      kind: cleanText(sourceValue.kind || firstDefined(raw, ["sourceKind", "来源类型"])) || "user_import",
      title: cleanText(sourceValue.title || firstDefined(raw, ["sourceTitle", "来源标题", "来源"])) || defaults.sourceTitle || "用户导入",
      year: sourceValue.year ?? firstDefined(raw, ["sourceYear", "来源年份", "年份"]) ?? null,
      reference: sourceValue.reference ?? firstDefined(raw, ["sourceReference", "来源引用", "出处"]) ?? null
    },
    syllabusVersion: cleanText(firstDefined(raw, ["syllabusVersion", "大纲版本"]) ?? defaults.syllabusVersion) || "待校验",
    review: {
      status: cleanText(reviewValue.status || firstDefined(raw, ["reviewStatus", "审核状态"])) || "draft",
      reviewer: reviewValue.reviewer ?? firstDefined(raw, ["reviewer", "审核人"]) ?? null,
      verifiedAt: reviewValue.verifiedAt ?? firstDefined(raw, ["verifiedAt", "校验日期"]) ?? null
    },
    tags: toList(firstDefined(raw, ["tags", "标签"]))
  };

  const fingerprint = fingerprintQuestion(question);
  if (!question.id) {
    question.id = `q-${fingerprint.slice(0, 12)}`;
    warnings.push({ code: "generated-id", message: `缺少题目 ID，已生成 ${question.id}` });
  }
  if (!question.tags.length) question.tags = [...new Set([...question.knowledgePoints, question.subject].filter(Boolean))];
  return { question, fingerprint, warnings };
}

function validateQuestion(question) {
  const errors = [];
  const optionIds = (question.options || []).map((option) => option.id);
  const optionTexts = (question.options || []).map((option) => cleanText(option.text));
  const add = (condition, code, message) => { if (!condition) errors.push({ code, message }); };

  add(Boolean(question.id), "missing-id", "缺少题目 ID");
  add(Boolean(question.subject), "missing-subject", "缺少科目");
  add(Boolean(question.chapter), "missing-chapter", "缺少章节");
  add(ALLOWED_TYPES.has(question.type), "invalid-type", `不支持的题型：${question.type}`);
  add(Boolean(question.stem), "missing-stem", "题干为空");
  add(optionIds.length >= 2, "too-few-options", "选项不足 2 个");
  add(new Set(optionIds).size === optionIds.length, "duplicate-option-id", "选项 ID 重复");
  add(new Set(optionTexts).size === optionTexts.length, "duplicate-option-text", "选项文本重复");
  add(optionTexts.every(Boolean), "empty-option", "存在空选项");
  add(Array.isArray(question.answers) && question.answers.length > 0, "missing-answer", "缺少答案");
  add((question.answers || []).every((answer) => optionIds.includes(answer)), "answer-out-of-range", "答案不属于任何选项");
  if (["single", "case-single"].includes(question.type)) add(question.answers.length === 1, "single-answer-count", "单选题必须且只能有一个答案");
  if (["multiple", "case-multiple"].includes(question.type)) add(question.answers.length >= 2, "multiple-answer-count", "多选题至少需要两个答案");
  if (question.type.startsWith("case-")) add(Boolean(question.material), "missing-material", "案例题缺少材料");
  add(question.difficulty >= 1 && question.difficulty <= 5, "invalid-difficulty", "难度必须在 1—5 之间");
  add(ALLOWED_FREQUENCIES.has(question.frequency), "invalid-frequency", `频率无效：${question.frequency}`);
  add(ALLOWED_REVIEW.has(question.review?.status), "invalid-review", `审核状态无效：${question.review?.status}`);
  return errors;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const meaningful = rows.filter((item) => item.some((value) => cleanText(value)));
  if (meaningful.length < 2) return [];
  const headers = meaningful[0].map((header) => cleanText(header).replace(/^\uFEFF/, ""));
  return meaningful.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

module.exports = { fingerprintQuestion, normalizeQuestion, parseCsv, validateQuestion };
