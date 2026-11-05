const assert = require("assert");
const fs = require("fs");

const bank = JSON.parse(fs.readFileSync("dist/data/questions.json", "utf8"));
const publicKinds = new Set(["recalled_exam_public", "user_provided_practice_pdf"]);
const questions = bank.questions.filter(question => publicKinds.has(question.source?.kind));
let total = 0;
let explicit = 0;
let answerKey = 0;

for (const question of questions) {
  const analysis = question.explanation?.optionAnalysis || {};
  question.options.forEach((option, index) => {
    const id = typeof option === "string" ? String.fromCharCode(65 + index) : option.id;
    const detail = analysis[id];
    total++;
    assert.ok(typeof detail === "string" && detail.trim(), `${question.id} option ${id} is missing analysis`);
    if (detail.startsWith("答案对照：")) {
      answerKey++;
      assert.match(detail, /本题答案为|本题应选/, `${question.id} option ${id} has an invalid answer-key explanation`);
      assert.match(detail, /未提供可核验/, `${question.id} option ${id} must disclose the source limitation`);
    } else explicit++;
  });
}

assert.ok(questions.length > 0, "public question set must not be empty");
assert.strictEqual(total, questions.reduce((sum, question) => sum + question.options.length, 0));
assert.ok(explicit > 0 && answerKey > 0);
console.log(JSON.stringify({ publicQuestions: questions.length, publicOptions: total, explicit, answerKey }, null, 2));
