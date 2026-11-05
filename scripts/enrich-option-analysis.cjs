const { getAllQuestions, openDatabase } = require("./database.cjs");

const write = process.argv.includes("--write");
const PUBLIC_SOURCE_KINDS = new Set(["recalled_exam_public", "user_provided_practice_pdf"]);

function optionId(option, index) {
  return typeof option === "string" ? String.fromCharCode(65 + index) : option.id;
}

function optionText(option) {
  return typeof option === "string" ? option : option.text;
}

function answerIds(question) {
  return question.answers || [String.fromCharCode(65 + question.answer)];
}

function extractExplicitReasons(summary) {
  const reasons = {};
  String(summary || "")
    .split(/[。；;\n]/)
    .map(value => value.trim())
    .filter(value => value.length >= 6 && value.length <= 220 && /(正确|错误|不正确|不符合|符合|应为|不是|属于|不属于)/.test(value))
    .forEach(sentence => {
      const groups = sentence.match(/[A-D](?:[、,，和及与][A-D])*/g) || [];
      const ids = [...new Set(groups.flatMap(group => group.match(/[A-D]/g) || []))];
      ids.forEach(id => { if (!reasons[id]) reasons[id] = sentence; });
    });
  return reasons;
}

function compact(value, limit = 96) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function answerKeyReason(question, id) {
  const answers = answerIds(question);
  const answerOptions = question.options
    .map((option, index) => ({ id: optionId(option, index), text: compact(optionText(option), 70) }))
    .filter(option => answers.includes(option.id));
  const reference = answerOptions.map(option => `${option.id}“${option.text}”`).join("、");
  if (answers.includes(id)) {
    return `答案对照：本题答案为 ${answers.join("、")}；该选项符合题干要求。原题源未提供可核验的独立逐项说明。`;
  }
  return `答案对照：本题应选 ${reference}；该选项不符合题干要求，不能作为本题答案。原题源未提供可核验的独立逐项反驳。`;
}

const db = openDatabase();
const questions = getAllQuestions(db);
const update = db.prepare("UPDATE questions SET explanation_json = ?, updated_at = ? WHERE id = ?");
const stats = { publicQuestions: 0, publicOptions: 0, alreadyFilled: 0, explicitAdded: 0, answerKeyAdded: 0, changedQuestions: 0 };

if (write) db.exec("BEGIN IMMEDIATE");
try {
  for (const question of questions) {
    if (!PUBLIC_SOURCE_KINDS.has(question.source?.kind)) continue;
    stats.publicQuestions++;
    const explanation = { ...(question.explanation || {}) };
    const analysis = { ...(explanation.optionAnalysis || {}) };
    const explicit = extractExplicitReasons(explanation.summary);
    let changed = false;
    question.options.forEach((option, index) => {
      const id = optionId(option, index);
      stats.publicOptions++;
      if (typeof analysis[id] === "string" && analysis[id].trim()) {
        stats.alreadyFilled++;
        return;
      }
      if (explicit[id]) {
        analysis[id] = explicit[id];
        stats.explicitAdded++;
      } else {
        analysis[id] = answerKeyReason(question, id);
        stats.answerKeyAdded++;
      }
      changed = true;
    });
    if (!changed) continue;
    stats.changedQuestions++;
    if (write) update.run(JSON.stringify({ ...explanation, optionAnalysis: analysis }), new Date().toISOString(), question.id);
  }
  if (write) db.exec("COMMIT");
} catch (error) {
  if (write) db.exec("ROLLBACK");
  throw error;
}
db.close();
console.log(JSON.stringify({ mode: write ? "write" : "dry-run", ...stats }, null, 2));
