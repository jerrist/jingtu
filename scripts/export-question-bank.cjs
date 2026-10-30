const fs = require("fs");
const path = require("path");
const { getAllQuestions, getMetadata, openDatabase, projectRoot, setMetadata } = require("./database.cjs");

const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(projectRoot, "dist", "data", "questions.json");
const db = openDatabase();
const questions = getAllQuestions(db);
if (!questions.length) throw new Error("主库为空，拒绝导出空题库");

const today = new Date().toISOString().slice(0, 10);
const bankVersion = `local-${today.replaceAll("-", "")}.${questions.length}`;
setMetadata(db, "bankVersion", bankVersion);
const metadata = getMetadata(db);
const bank = {
  schemaVersion: metadata.schemaVersion || "2.0.0",
  bankVersion,
  syllabusVersion: metadata.syllabusVersion || "待校验",
  locale: metadata.locale || "zh-CN",
  title: metadata.title || "经途中级经济师本地题库",
  description: metadata.description || "由 SQLite 主库导出的网页题库",
  updatedAt: today,
  questions
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(bank, null, 2)}\n`);
db.close();
console.log(JSON.stringify({ output: outputPath, bankVersion, total: questions.length }, null, 2));
