const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const databasePath = process.env.JINGTU_DB_PATH
  ? path.resolve(process.env.JINGTU_DB_PATH)
  : path.join(projectRoot, "database", "question-bank.sqlite");

function openDatabase(filename = databasePath) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  createSchema(db);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      subject TEXT NOT NULL,
      chapter TEXT NOT NULL,
      knowledge_points_json TEXT NOT NULL,
      type TEXT NOT NULL,
      material TEXT,
      stem TEXT NOT NULL,
      options_json TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      scoring_json TEXT NOT NULL,
      explanation_json TEXT NOT NULL,
      difficulty INTEGER NOT NULL,
      frequency TEXT NOT NULL,
      source_json TEXT NOT NULL,
      syllabus_version TEXT NOT NULL,
      review_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      source_file TEXT,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_questions_subject_chapter ON questions(subject, chapter);
    CREATE INDEX IF NOT EXISTS idx_questions_review ON questions(json_extract(review_json, '$.status'));
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      file_sha256 TEXT NOT NULL UNIQUE,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      report_path TEXT
    );
    CREATE TABLE IF NOT EXISTS import_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      row_number INTEGER,
      question_id TEXT,
      severity TEXT NOT NULL,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      FOREIGN KEY(batch_id) REFERENCES import_batches(id)
    );
  `);
}

function setMetadata(db, key, value) {
  db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

function getMetadata(db) {
  return Object.fromEntries(db.prepare("SELECT key, value FROM metadata ORDER BY key").all().map((row) => [row.key, row.value]));
}

function insertQuestion(db, question, fingerprint, sourceFile = null) {
  const byId = db.prepare("SELECT id, fingerprint FROM questions WHERE id = ?").get(question.id);
  if (byId) return { status: "duplicate-id", existingId: byId.id };
  const byFingerprint = db.prepare("SELECT id FROM questions WHERE fingerprint = ?").get(fingerprint);
  if (byFingerprint) return { status: "duplicate-content", existingId: byFingerprint.id };
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO questions (
      id, fingerprint, subject, chapter, knowledge_points_json, type, material, stem,
      options_json, answers_json, scoring_json, explanation_json, difficulty, frequency,
      source_json, syllabus_version, review_json, tags_json, source_file, imported_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    question.id, fingerprint, question.subject, question.chapter, JSON.stringify(question.knowledgePoints), question.type,
    question.material, question.stem, JSON.stringify(question.options), JSON.stringify(question.answers), JSON.stringify(question.scoring),
    JSON.stringify(question.explanation), question.difficulty, question.frequency, JSON.stringify(question.source), question.syllabusVersion,
    JSON.stringify(question.review), JSON.stringify(question.tags), sourceFile, now, now
  );
  return { status: "inserted", existingId: null };
}

function getAllQuestions(db) {
  return db.prepare("SELECT * FROM questions ORDER BY subject, chapter, id").all().map((row) => ({
    id: row.id,
    subject: row.subject,
    chapter: row.chapter,
    knowledgePoints: JSON.parse(row.knowledge_points_json),
    type: row.type,
    material: row.material,
    stem: row.stem,
    options: JSON.parse(row.options_json),
    answers: JSON.parse(row.answers_json),
    scoring: JSON.parse(row.scoring_json),
    explanation: JSON.parse(row.explanation_json),
    difficulty: row.difficulty,
    frequency: row.frequency,
    source: JSON.parse(row.source_json),
    syllabusVersion: row.syllabus_version,
    review: JSON.parse(row.review_json),
    tags: JSON.parse(row.tags_json)
  }));
}

module.exports = { databasePath, getAllQuestions, getMetadata, insertQuestion, openDatabase, projectRoot, setMetadata };
