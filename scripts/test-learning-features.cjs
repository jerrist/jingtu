const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("dist/app.js", "utf8").split("init().catch")[0] + `
globalThis.__learningTest = {
  scheduleReview,
  scoreExamQuestion,
  selectSmartQuestions,
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

console.log("Learning feature tests passed");
