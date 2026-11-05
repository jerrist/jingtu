const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("dist/app.js", "utf8").split("init().catch")[0] + `
globalThis.__learningTest = {
  scheduleReview,
  scoreExamQuestion,
  selectSmartQuestions,
  buildRulePaper,
  derivedOptionAnalysis,
  trendSeries,
  speedInsights,
  setState(value) { state = {...DEFAULT_STATE, ...value}; },
  setQuestions(value) { QUESTIONS = value; }
};`;

const context = {
  console,
  Date,
  Math,
  setTimeout,
  clearTimeout,
  localStorage: { getItem() { return null; }, setItem() {} }
};
vm.createContext(context);
vm.runInContext(source, context);

const engine = context.__learningTest;
const record = {};
engine.scheduleReview(record, false);
assert.strictEqual(record.memoryStage, 0);
assert.strictEqual(record.interval, 1);
engine.scheduleReview(record, true);
engine.scheduleReview(record, true);
assert.strictEqual(record.memoryStage, 2);
assert.strictEqual(record.interval, 3);

const single = {type:"single", answers:["B"], scoring:{score:1}};
assert.strictEqual(engine.scoreExamQuestion(single, ["B"]), 1);
assert.strictEqual(engine.scoreExamQuestion(single, ["A"]), 0);

const multiple = {type:"multiple", answers:["A", "C"], scoring:{score:2, partialCredit:true}};
assert.strictEqual(engine.scoreExamQuestion(multiple, ["A", "C"]), 2);
assert.strictEqual(engine.scoreExamQuestion(multiple, ["A"]), .5);
assert.strictEqual(engine.scoreExamQuestion(multiple, ["A", "B"]), 0);

const questions = [
  {id:"due", chapter:"A", frequency:"medium"},
  {id:"new", chapter:"B", frequency:"medium"}
];
engine.setQuestions(questions);
engine.setState({records:{due:{attempts:1, wrong:1, due:"2000-01-01"}}, important:[], mastered:[]});
assert.strictEqual(engine.selectSmartQuestions(questions, 1, "daily")[0].id, "due");

const econQuestions=[...Array(70)].map((_,i)=>({id:`s${i}`,subject:"经济基础知识",type:"single"})).concat([...Array(35)].map((_,i)=>({id:`m${i}`,subject:"经济基础知识",type:"multiple"})));
engine.setQuestions(econQuestions);
const paper=engine.buildRulePaper("full-econ");
assert.strictEqual(paper.questions.length,105);
assert.strictEqual(paper.questions.reduce((sum,item)=>sum+item._examScore,0),140);

const realBank=JSON.parse(fs.readFileSync("dist/data/questions.json","utf8"));
engine.setQuestions(realBank.questions);
const hrPaper=engine.buildRulePaper("full-hr");
assert.strictEqual(hrPaper.questions.length,100,"HR full paper must contain 100 questions");
assert.strictEqual(hrPaper.questions.reduce((sum,item)=>sum+item._examScore,0),140,"HR full paper must total 140 points");
assert.strictEqual(hrPaper.questions.filter(item=>item._examSection==="单选题").length,60);
assert.strictEqual(hrPaper.questions.filter(item=>item._examSection==="多选题").length,20);
assert.strictEqual(hrPaper.questions.filter(item=>item._examSection==="案例分析题").length,20);
assert.strictEqual(hrPaper.caseShortfall,0,"HR full paper must not substitute ordinary questions for case questions");
assert.strictEqual(hrPaper.missing,0,"HR full paper must not have a question shortage");
assert.strictEqual(new Set(hrPaper.questions.map(item=>item.id)).size,100,"HR full paper questions must be unique");

const parsed=engine.derivedOptionAnalysis({options:[{id:"A"},{id:"B"}],answers:["A"],explanation:{summary:"选项 A 正确；选项 B 错误，因为混淆了概念。",optionAnalysis:{}}});
assert.ok(parsed.A&&parsed.B,"explicit option reasons should be derived from summary");

engine.setState({answerLog:[{date:new Date().toLocaleDateString("sv-SE"),correct:true,durationMs:100000,subject:"人力资源管理",chapter:"绩效管理",knowledgePoint:"绩效评价",type:"single"},{date:new Date().toLocaleDateString("sv-SE"),correct:true,durationMs:110000,subject:"人力资源管理",chapter:"绩效管理",knowledgePoint:"绩效评价",type:"single"}],reviewDaily:{}});
assert.strictEqual(engine.speedInsights()[0].name,"绩效评价");

console.log("Learning feature tests passed");
