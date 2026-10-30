const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeQuestion, parseCsv, validateQuestion } = require("./question-bank-lib.cjs");
const { insertQuestion, openDatabase, projectRoot } = require("./database.cjs");

const inbox = path.join(projectRoot, "imports", "raw");
const reportRoot = path.join(projectRoot, "reports", "imports");
const supported = new Set([".json", ".jsonl", ".ndjson", ".csv"]);
fs.mkdirSync(inbox, { recursive: true });
fs.mkdirSync(reportRoot, { recursive: true });

function collectFiles(args) {
  const inputs = args.length ? args.map((item) => path.resolve(item)) : [inbox];
  const files = [];
  for (const input of inputs) {
    if (!fs.existsSync(input)) throw new Error(`导入路径不存在：${input}`);
    const stat = fs.statSync(input);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
        if (entry.isFile() && supported.has(path.extname(entry.name).toLowerCase())) files.push(path.join(input, entry.name));
      }
    } else if (supported.has(path.extname(input).toLowerCase())) files.push(input);
    else throw new Error(`暂不支持该格式：${input}`);
  }
  return files.sort();
}

function parseFile(filename) {
  const extension = path.extname(filename).toLowerCase();
  const text = fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "");
  if (extension === ".csv") return parseCsv(text);
  if ([".jsonl", ".ndjson"].includes(extension)) return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.questions)) return parsed.questions;
  return [parsed];
}

function recordIssue(db, batchId, rowNumber, questionId, severity, issue) {
  db.prepare("INSERT INTO import_issues(batch_id, row_number, question_id, severity, code, message) VALUES (?, ?, ?, ?, ?, ?)")
    .run(batchId, rowNumber, questionId || null, severity, issue.code, issue.message);
}

function markdownReport(report) {
  const lines = [
    `# 导入报告：${report.file}`,
    "",
    `- 文件指纹：\`${report.sha256}\``,
    `- 总记录：${report.total}`,
    `- 成功导入：${report.imported}`,
    `- 跳过重复：${report.skipped}`,
    `- 拒绝导入：${report.rejected}`,
    `- 警告：${report.warningCount}`,
    ""
  ];
  if (report.issues.length) {
    lines.push("## 需要处理的问题", "");
    for (const issue of report.issues) lines.push(`- 第 ${issue.row} 条${issue.questionId ? `（${issue.questionId}）` : ""}：**${issue.severity} / ${issue.code}** — ${issue.message}`);
  } else lines.push("没有发现需要处理的问题。", "");
  return `${lines.join("\n")}\n`;
}

const files = collectFiles(process.argv.slice(2));
if (!files.length) {
  console.log(`没有待导入文件。请把 JSON、JSONL 或 CSV 放入 ${inbox}`);
  process.exit(0);
}

const db = openDatabase();
const summaries = [];
for (const filename of files) {
  const bytes = fs.readFileSync(filename);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const existing = db.prepare("SELECT id, status, report_path FROM import_batches WHERE file_sha256 = ?").get(sha256);
  if (existing?.status === "completed") {
    summaries.push({ file: filename, status: "already-imported", report: existing.report_path });
    continue;
  }

  const relativeFile = path.relative(projectRoot, filename);
  const startedAt = new Date().toISOString();
  const batch = db.prepare("INSERT INTO import_batches(file_path, file_sha256, started_at, status) VALUES (?, ?, ?, 'processing') RETURNING id")
    .get(relativeFile, sha256, startedAt);
  const report = { file: relativeFile, sha256, total: 0, imported: 0, skipped: 0, rejected: 0, warningCount: 0, issues: [] };

  try {
    const rows = parseFile(filename);
    report.total = rows.length;
    db.exec("BEGIN");
    rows.forEach((raw, index) => {
      const rowNumber = index + 1;
      const { question, fingerprint, warnings } = normalizeQuestion(raw, { sourceTitle: path.basename(filename) });
      const errors = validateQuestion(question);
      for (const warning of warnings) {
        report.warningCount += 1;
        report.issues.push({ row: rowNumber, questionId: question.id, severity: "warning", ...warning });
        recordIssue(db, batch.id, rowNumber, question.id, "warning", warning);
      }
      if (errors.length) {
        report.rejected += 1;
        for (const error of errors) {
          report.issues.push({ row: rowNumber, questionId: question.id, severity: "error", ...error });
          recordIssue(db, batch.id, rowNumber, question.id, "error", error);
        }
        return;
      }
      const result = insertQuestion(db, question, fingerprint, relativeFile);
      if (result.status === "inserted") report.imported += 1;
      else {
        report.skipped += 1;
        const issue = { code: result.status, message: `与题目 ${result.existingId} 重复，已跳过` };
        report.issues.push({ row: rowNumber, questionId: question.id, severity: "warning", ...issue });
        recordIssue(db, batch.id, rowNumber, question.id, "warning", issue);
      }
    });
    db.exec("COMMIT");

    const reportBase = `${path.basename(filename, path.extname(filename)).replace(/[^\p{L}\p{N}._-]+/gu, "-")}-${sha256.slice(0, 8)}`;
    const jsonPath = path.join(reportRoot, `${reportBase}.json`);
    const markdownPath = path.join(reportRoot, `${reportBase}.md`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(markdownPath, markdownReport(report));
    db.prepare(`UPDATE import_batches SET completed_at = ?, status = 'completed', total_count = ?, imported_count = ?, skipped_count = ?, rejected_count = ?, report_path = ? WHERE id = ?`)
      .run(new Date().toISOString(), report.total, report.imported, report.skipped, report.rejected, path.relative(projectRoot, markdownPath), batch.id);
    summaries.push({ ...report, status: "completed", report: markdownPath });
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.prepare("UPDATE import_batches SET completed_at = ?, status = 'failed' WHERE id = ?").run(new Date().toISOString(), batch.id);
    summaries.push({ file: filename, status: "failed", error: error.message });
  }
}
db.close();
console.log(JSON.stringify(summaries, null, 2));
if (summaries.some((summary) => summary.status === "failed")) process.exit(1);
