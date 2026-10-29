const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const legacyPath = path.join(root, "scripts", "legacy-question-bank-v1.js");
const outputPath = path.join(root, "dist", "data", "questions.json");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(legacyPath, "utf8"), context);

const knowledgePoints = {
  e01: ["需求规律", "需求量变动"], e02: ["需求价格弹性"], e03: ["无差异曲线"],
  e04: ["边际成本"], e05: ["价格歧视"], e06: ["支出法国内生产总值"],
  e07: ["经济周期"], e08: ["周期性失业"], e09: ["财政收入分配职能"],
  e10: ["紧缩性财政政策"], e11: ["货币层次"], e12: ["法定存款准备金率"],
  e13: ["离散程度", "标准差"], e14: ["历史成本"], e15: ["流动比率"],
  e16: ["代理制度"], h01: ["双因素理论"], h02: ["期望理论"],
  h03: ["路径—目标理论"], h04: ["管理幅度与管理层次"], h05: ["战略匹配"],
  h06: ["人力资源供给预测"], h07: ["甄选信度"], h08: ["结构化面试"],
  h09: ["360度评估"], h10: ["关键绩效指标"], h11: ["职位评价"],
  h12: ["技能薪酬体系"], h13: ["培训效果评估"], h14: ["劳动力需求曲线"],
  h15: ["劳动关系建立"], h16: ["社会保险基本方针"]
};
const highFrequency = new Set(["市场需求、供给与均衡价格", "财政政策", "中央银行与货币政策", "组织激励", "人员甄选", "绩效管理", "薪酬管理", "劳动关系"]);
const hardIds = new Set(["e05", "e06", "e12", "h02", "h05", "h14"]);
const easyIds = new Set(["e01", "e04", "e13", "h07", "h09", "h15"]);

const questions = context.window.QUESTION_BANK.map((question) => {
  const ids = question.options.map((_, index) => String.fromCharCode(65 + index));
  const answerId = ids[question.answer];
  const points = knowledgePoints[question.id] || [question.chapter];
  const difficulty = hardIds.has(question.id) ? 3 : easyIds.has(question.id) ? 1 : 2;
  return {
    id: question.id,
    subject: question.subject,
    chapter: question.chapter,
    knowledgePoints: points,
    type: "single",
    material: null,
    stem: question.stem,
    options: question.options.map((text, index) => ({ id: ids[index], text })),
    answers: [answerId],
    scoring: { score: 1, partialCredit: false },
    explanation: {
      summary: question.explain,
      keyPoint: points[0],
      memoryTip: null,
      optionAnalysis: Object.fromEntries(ids.map((id) => [id, id === answerId ? question.explain : null]))
    },
    difficulty,
    frequency: highFrequency.has(question.chapter) ? "high" : "medium",
    source: { kind: "original_demo", title: "经途示例题库", year: null, reference: null },
    syllabusVersion: "2026-demo",
    review: { status: "draft", reviewer: null, verifiedAt: null },
    tags: [...points, question.subject]
  };
});

const bank = {
  schemaVersion: "2.0.0",
  bankVersion: "2026-demo.2",
  syllabusVersion: "2026-demo",
  locale: "zh-CN",
  title: "经途中级经济师示例题库",
  description: "产品功能验证用原创示例题库，尚未按正式考试大纲完成审核。",
  updatedAt: "2026-10-29",
  questions
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(bank, null, 2)}\n`);
console.log(`Migrated ${questions.length} questions to ${outputPath}`);
