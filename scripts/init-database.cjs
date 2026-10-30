const fs = require("fs");
const path = require("path");
const { fingerprintQuestion, validateQuestion } = require("./question-bank-lib.cjs");
const { databasePath, insertQuestion, openDatabase, projectRoot, setMetadata } = require("./database.cjs");

const seedPath = path.join(projectRoot, "dist", "data", "questions.json");
if (!fs.existsSync(seedPath)) throw new Error(`找不到初始题库：${seedPath}`);

const bank = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const db = openDatabase();
for (const [key, value] of Object.entries({
  schemaVersion: bank.schemaVersion || "2.0.0",
  bankVersion: bank.bankVersion || "local.1",
  syllabusVersion: bank.syllabusVersion || "待校验",
  locale: bank.locale || "zh-CN",
  title: bank.title || "经途中级经济师本地题库",
  description: bank.description || "本地维护题库"
})) setMetadata(db, key, value);

let inserted = 0;
let skipped = 0;
for (const question of bank.questions || []) {
  const errors = validateQuestion(question);
  if (errors.length) throw new Error(`${question.id || "未知题目"} 无法写入主库：${errors.map((error) => error.message).join("；")}`);
  const result = insertQuestion(db, question, fingerprintQuestion(question), path.relative(projectRoot, seedPath));
  if (result.status === "inserted") inserted += 1;
  else skipped += 1;
}
db.close();
console.log(JSON.stringify({ database: databasePath, seed: seedPath, inserted, skipped }, null, 2));
