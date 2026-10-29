const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
let QUESTIONS = [];
let BANK_META = {};
const REASONS = ["知识点不会", "概念混淆", "审题失误", "计算/推理错误"];
const DEFAULT_STATE = { dailyGoal: 20, examDate: "2026-11-08", records: {}, daily: {}, streak: 0, lastStudy: null, mastered: [], exams: [] };
let state = loadState();
let currentView = "home";
let practiceSubject = "all";
let activeQuiz = null;
let activeExam = null;
let examTimer = null;

function loadState() {
  try { return {...DEFAULT_STATE, ...JSON.parse(localStorage.getItem("jingtu-state") || "{}")}; }
  catch { return {...DEFAULT_STATE}; }
}
function saveState() { localStorage.setItem("jingtu-state", JSON.stringify(state)); }
function localDate(d = new Date()) { return d.toLocaleDateString("sv-SE"); }
function todayDone() { return state.daily[localDate()] || 0; }
function accuracy(filter = () => true) {
  let total = 0, correct = 0;
  QUESTIONS.filter(filter).forEach(q => { const r = state.records[q.id]; if (r) { total += r.attempts || 0; correct += r.correct || 0; }});
  return {total, correct, rate: total ? Math.round(correct / total * 100) : 0};
}
function wrongQuestions() { return QUESTIONS.filter(q => state.records[q.id]?.wrong > 0 && !state.mastered.includes(q.id)); }
function dueQuestions() { const now = localDate(); return wrongQuestions().filter(q => !state.records[q.id].due || state.records[q.id].due <= now); }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); }
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200); }
function shuffle(list) { return [...list].sort(() => Math.random() - .5); }
function optionText(option) { return typeof option === "string" ? option : option.text; }
function optionId(option, index) { return typeof option === "string" ? String.fromCharCode(65 + index) : option.id; }
function answerIds(question) { return question.answers || [String.fromCharCode(65 + question.answer)]; }
function isMultiple(question) { return ["multiple", "case-multiple"].includes(question.type); }
function isCorrectAnswer(question, selected = []) {
  const expected = [...answerIds(question)].sort();
  const actual = [...selected].sort();
  return expected.length === actual.length && expected.every((id, index) => id === actual[index]);
}
function typeLabel(question) {
  return ({single:"单选题", multiple:"多选题", "case-single":"案例单选", "case-multiple":"案例多选"})[question.type] || "选择题";
}
function explanationText(question) { return question.explanation?.summary || question.explain || "暂无解析"; }
async function loadQuestionBank() {
  const response = await fetch("data/questions.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`题库加载失败 (${response.status})`);
  const bank = await response.json();
  if (!bank.schemaVersion || !bank.bankVersion || !Array.isArray(bank.questions)) throw new Error("题库结构无效");
  BANK_META = bank;
  QUESTIONS = bank.questions.filter(question => question.review?.status !== "retired");
}

function markStudy() {
  const today = localDate();
  if (state.lastStudy === today) return;
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  state.streak = state.lastStudy === localDate(yesterday) ? state.streak + 1 : 1;
  state.lastStudy = today; saveState();
}

function switchView(view) {
  currentView = view;
  $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
  $$('[data-view]').forEach(b => b.classList.toggle("active", b.dataset.view === view));
  const titles = {home:"今天，向前一小步", practice:"把每个知识点练扎实", review:"错题不是负担，是路标", exam:"用一次模考，校准节奏", stats:"你的努力，都有迹可循"};
  $("#view-title").textContent = titles[view];
  if (view === "home") renderHome();
  if (view === "review") renderReview();
  if (view === "stats") renderStats();
  window.scrollTo({top:0, behavior:"smooth"});
}

function renderHome() {
  const done = todayDone(), goal = state.dailyGoal, pct = Math.min(100, Math.round(done / goal * 100));
  $("#daily-done").textContent = done; $("#daily-goal").textContent = goal;
  $("#remaining-count").textContent = Math.max(0, goal - done);
  $("#daily-progress-ring").style.strokeDashoffset = 414.7 * (1 - pct / 100);
  $("#daily-message").textContent = done >= goal ? "今天的计划已完成，保持节奏比突击更重要。" : "系统会优先安排薄弱知识点和到期错题。";
  const subjects = ["经济基础知识", "人力资源管理"];
  $("#subject-grid").innerHTML = subjects.map((s, i) => { const a = accuracy(q => q.subject === s); return `<article class="subject-card ${i ? "hr" : "econ"}"><div class="subject-top"><span class="subject-symbol">${i ? "人" : "经"}</span><span class="subject-score">${a.rate}<small>%</small></span></div><h3>${s}</h3><p>${a.total ? `累计完成 ${a.total} 次作答` : "还未开始，今天就开个头"}</p><div class="mini-bar"><span style="width:${a.rate}%"></span></div></article>`; }).join("");
  const chapters = chapterStats().filter(x => x.total >= 2).sort((a,b) => a.rate - b.rate);
  const weak = chapters[0];
  $("#weak-title").textContent = weak ? weak.chapter : "还没有薄弱点";
  $("#weak-copy").textContent = weak ? `当前正确率 ${weak.rate}%，建议安排一组专项练习。` : "完成几道题后，这里会自动识别需要加强的章节。";
  $("#practice-weak").dataset.chapter = weak?.chapter || "all";
  const due = dueQuestions(); $("#due-count").textContent = due.length;
  $("#review-preview").innerHTML = due.length ? `<span>↻</span><div><b>${due.length} 道错题等待复习</b><p>${due[0].chapter}${due.length > 1 ? " 等知识点" : ""}</p></div>` : `<span>✓</span><div><b>暂时没有到期错题</b><p>做错的题会在合适的时间回来找你。</p></div>`;
  renderCountdown();
}

function renderCountdown() {
  const target = new Date(`${state.examDate}T23:59:59`), days = Math.max(0, Math.ceil((target - new Date()) / 86400000));
  $("#days-left").textContent = `${days} 天`;
}

function updateChapterPicker() {
  const list = QUESTIONS.filter(q => practiceSubject === "all" || q.subject === practiceSubject);
  const chapters = [...new Set(list.map(q => q.chapter))];
  $("#chapter-select").innerHTML = `<option value="all">全部章节</option>${chapters.map(c => `<option value="${c}">${c}</option>`).join("")}`;
}

function startQuiz({questions, mode="practice"}) {
  if (!questions.length) { toast("这个范围暂时没有可练习题目"); return; }
  activeQuiz = {questions: shuffle(questions).slice(0, 10), index:0, score:0, answered:false, selected:[], mode};
  $("#practice-setup").classList.add("hidden"); $("#quiz-stage").classList.remove("hidden"); renderQuizQuestion();
}

function renderQuizQuestion() {
  const {questions, index} = activeQuiz; const q = questions[index]; const rec = state.records[q.id] || {};
  activeQuiz.selected = [];
  $("#quiz-stage").innerHTML = `<div class="quiz-shell"><div class="quiz-meta"><button class="ghost-button" id="quit-quiz">← 退出练习</button><span class="progress-text">第 ${index + 1} / ${questions.length} 题</span></div><div class="quiz-progress"><span style="width:${(index/questions.length)*100}%"></span></div><article class="question-card"><div class="question-tags"><span class="question-tag">${q.subject}</span><span class="question-tag">${q.chapter}</span><span class="question-tag">${typeLabel(q)}</span><span class="question-tag">难度 ${q.difficulty || 2}</span>${rec.attempts ? `<span class="question-tag">已练 ${rec.attempts} 次</span>` : ""}</div>${q.material ? `<div class="case-material"><b>案例材料</b><br>${q.material}</div>` : ""}<h2>${q.stem}</h2>${isMultiple(q) ? `<div class="multi-hint">多选题 · 请选择所有正确选项后确认</div>` : ""}<div class="option-list">${q.options.map((o,i) => { const id=optionId(o,i); return `<button class="option" data-option="${id}"><span class="option-letter">${id}</span><span>${optionText(o)}</span></button>`; }).join("")}</div>${isMultiple(q) ? `<div class="quiz-actions"><button class="primary-button" id="confirm-answer" disabled>确认答案 <span>→</span></button></div>` : ""}<div id="answer-feedback"></div></article></div>`;
  $("#quit-quiz").onclick = quitQuiz;
  $$('[data-option]', $("#quiz-stage")).forEach(b => b.onclick = () => isMultiple(q) ? toggleQuizOption(b.dataset.option, b) : answerQuiz([b.dataset.option]));
  if (isMultiple(q)) $("#confirm-answer").onclick = () => answerQuiz(activeQuiz.selected);
}

function toggleQuizOption(id, button) {
  activeQuiz.selected = activeQuiz.selected.includes(id) ? activeQuiz.selected.filter(value => value !== id) : [...activeQuiz.selected, id];
  button.classList.toggle("selected", activeQuiz.selected.includes(id));
  $("#confirm-answer").disabled = activeQuiz.selected.length === 0;
}

function answerQuiz(selected) {
  if (activeQuiz.answered) return; activeQuiz.answered = true;
  const q = activeQuiz.questions[activeQuiz.index], correct = isCorrectAnswer(q, selected);
  if (correct) activeQuiz.score++;
  const expected = answerIds(q);
  $$('[data-option]', $("#quiz-stage")).forEach((b) => { const id=b.dataset.option; b.disabled = true; if (expected.includes(id)) b.classList.add("correct"); if (selected.includes(id) && !expected.includes(id)) b.classList.add("wrong"); });
  if ($("#confirm-answer")) $("#confirm-answer").remove();
  recordAnswer(q, correct);
  $("#answer-feedback").innerHTML = `<div class="answer-panel ${correct ? "" : "bad"}"><h4>${correct ? "回答正确，很稳。" : `回答错误，正确答案是 ${expected.join("、")}。`}</h4><p>${explanationText(q)}</p>${q.explanation?.memoryTip ? `<p><b>记忆提示：</b>${q.explanation.memoryTip}</p>` : ""}${correct ? "" : `<div class="reason-prompt"><span>这次为什么会错？</span><div class="reason-buttons">${REASONS.map(r => `<button class="reason-button" data-reason="${r}">${r}</button>`).join("")}</div></div>`}</div><div class="quiz-actions"><button class="primary-button" id="next-question">${activeQuiz.index === activeQuiz.questions.length-1 ? "查看结果" : "下一题"} <span>→</span></button></div>`;
  $$('[data-reason]').forEach(b => b.onclick = () => { $$('[data-reason]').forEach(x => x.classList.remove("active")); b.classList.add("active"); state.records[q.id].reason = b.dataset.reason; saveState(); toast("已记录错因"); });
  $("#next-question").onclick = nextQuiz;
}

function recordAnswer(q, correct) {
  markStudy(); const r = state.records[q.id] || {attempts:0, correct:0, wrong:0};
  r.attempts++; if (correct) { r.correct++; r.due = daysFromNow(r.wrong ? 3 : 7); } else { r.wrong++; r.due = daysFromNow(1); }
  r.last = localDate(); state.records[q.id] = r; state.daily[localDate()] = todayDone() + 1; saveState();
  $("#streak").textContent = state.streak;
}

function nextQuiz() {
  if (activeQuiz.index < activeQuiz.questions.length - 1) { activeQuiz.index++; activeQuiz.answered = false; activeQuiz.selected = []; renderQuizQuestion(); }
  else renderQuizResult();
}
function renderQuizResult() {
  const {score, questions} = activeQuiz, pct = Math.round(score/questions.length*100);
  $("#quiz-stage").innerHTML = `<div class="quiz-shell"><div class="result-card"><div class="result-score"><strong>${pct}</strong><small>正确率</small></div><h2>${pct >= 80 ? "这一组掌握得不错" : pct >= 60 ? "基础已经有了，再巩固一下" : "薄弱点找到了，这就是进步的起点"}</h2><p>答对 ${score} 题，答错 ${questions.length-score} 题。错题已自动加入复习计划。</p><button class="primary-button" id="finish-quiz">返回练习中心 <span>→</span></button></div></div>`;
  $("#finish-quiz").onclick = quitQuiz;
}
function quitQuiz() { activeQuiz = null; $("#quiz-stage").classList.add("hidden"); $("#practice-setup").classList.remove("hidden"); renderHome(); }

function renderReview(filter="全部") {
  const wrong = wrongQuestions();
  $("#wrong-summary").textContent = `${wrong.length} 道待掌握 · ${dueQuestions().length} 道今日到期`;
  $("#reason-filters").innerHTML = ["全部", ...REASONS].map(r => `<button class="filter-chip ${r===filter?"active":""}" data-filter="${r}">${r}</button>`).join("");
  $$('[data-filter]').forEach(b => b.onclick = () => renderReview(b.dataset.filter));
  const list = filter === "全部" ? wrong : wrong.filter(q => (state.records[q.id].reason || "知识点不会") === filter);
  $("#wrong-list").innerHTML = list.length ? list.map(q => { const r=state.records[q.id]; return `<article class="wrong-card"><div><span class="small-tag">${r.reason || "未标记错因"}</span><h3>${q.stem}</h3><p>${q.subject} · ${q.chapter} · 错 ${r.wrong} 次 · ${r.due <= localDate() ? "今日应复习" : `${r.due} 复习`}</p></div><button class="ghost-button" data-review-one="${q.id}">再做一次</button></article>`; }).join("") : `<div class="empty-state"><span>✓</span><b>这里很干净</b><p>完成练习后，答错的题会自动出现在这里。</p></div>`;
  $$('[data-review-one]').forEach(b => b.onclick = () => { switchView("practice"); startQuiz({questions:[QUESTIONS.find(q => q.id===b.dataset.reviewOne)],mode:"review"}); });
}

function startExam() {
  activeExam = {questions:shuffle(QUESTIONS).slice(0,10), index:0, answers:{}, remaining:900};
  $("#exam-intro").classList.add("hidden"); $("#exam-stage").classList.remove("hidden"); renderExam();
  clearInterval(examTimer); examTimer=setInterval(()=>{ activeExam.remaining--; updateTimer(); if(activeExam.remaining<=0) submitExam(); },1000);
}
function updateTimer(){ const m=String(Math.floor(activeExam.remaining/60)).padStart(2,"0"),s=String(activeExam.remaining%60).padStart(2,"0"); const el=$("#exam-timer"); if(el) el.textContent=`${m}:${s}`; }
function renderExam() {
  const q=activeExam.questions[activeExam.index], chosen=activeExam.answers[q.id] || [];
  $("#exam-stage").innerHTML=`<div class="exam-top"><button class="ghost-button" id="quit-exam">退出模考</button><span class="timer" id="exam-timer"></span></div><div class="exam-grid"><article class="question-card"><div class="question-tags"><span class="question-tag">${q.subject}</span><span class="question-tag">${typeLabel(q)}</span><span class="question-tag">第 ${activeExam.index+1} 题</span></div>${q.material ? `<div class="case-material"><b>案例材料</b><br>${q.material}</div>` : ""}<h2>${q.stem}</h2>${isMultiple(q) ? `<div class="multi-hint">多选题 · 请选择所有正确选项</div>` : ""}<div class="option-list">${q.options.map((o,i)=>{const id=optionId(o,i);return `<button class="option ${chosen.includes(id)?"selected":""}" data-exam-option="${id}"><span class="option-letter">${id}</span><span>${optionText(o)}</span></button>`;}).join("")}</div><div class="quiz-actions">${activeExam.index?`<button class="ghost-button" id="exam-prev">上一题</button>`:""}<button class="primary-button" id="exam-next">${activeExam.index===activeExam.questions.length-1?"交卷":"下一题"} <span>→</span></button></div></article><aside class="answer-sheet"><h3>答题卡</h3><div class="sheet-grid">${activeExam.questions.map((x,i)=>`<button class="sheet-button ${(activeExam.answers[x.id] || []).length?"done":""} ${i===activeExam.index?"current":""}" data-sheet="${i}">${i+1}</button>`).join("")}</div></aside></div>`;
  updateTimer();
  $$('[data-exam-option]').forEach(b=>b.onclick=()=>{const id=b.dataset.examOption;if(isMultiple(q)){const values=activeExam.answers[q.id]||[];activeExam.answers[q.id]=values.includes(id)?values.filter(value=>value!==id):[...values,id];}else activeExam.answers[q.id]=[id];renderExam();});
  $$('[data-sheet]').forEach(b=>b.onclick=()=>{activeExam.index=Number(b.dataset.sheet);renderExam();});
  $("#exam-prev") && ($("#exam-prev").onclick=()=>{activeExam.index--;renderExam();});
  $("#exam-next").onclick=()=> activeExam.index===activeExam.questions.length-1 ? submitExam() : (activeExam.index++,renderExam());
  $("#quit-exam").onclick=quitExam;
}
function submitExam(){
  if(!activeExam)return; clearInterval(examTimer); let score=0;
  activeExam.questions.forEach(q=>{const ok=isCorrectAnswer(q,activeExam.answers[q.id]||[]);if(ok)score++;recordAnswer(q,ok);});
  state.exams.push({date:localDate(),score,total:10});saveState();
  $("#exam-stage").innerHTML=`<div class="quiz-shell"><div class="result-card"><div class="result-score"><strong>${score}</strong><small>/ 10 分</small></div><h2>${score>=8?"考场状态不错":"模考的价值，是提前暴露问题"}</h2><p>本次作答 ${Object.keys(activeExam.answers).length} 题，答对 ${score} 题。错误题目已进入错题复习。</p><button class="primary-button" id="finish-exam">完成并查看报告 <span>→</span></button></div></div>`;
  $("#finish-exam").onclick=()=>{quitExam();switchView("stats");};
}
function quitExam(){clearInterval(examTimer);activeExam=null;$("#exam-stage").classList.add("hidden");$("#exam-intro").classList.remove("hidden");}

function chapterStats(){
  const chapters=[...new Set(QUESTIONS.map(q=>q.chapter))];
  return chapters.map(chapter=>({chapter,...accuracy(q=>q.chapter===chapter)})).filter(x=>x.total);
}
function renderStats(){
  const all=accuracy(), wrong=wrongQuestions().length, examBest=state.exams.length?Math.max(...state.exams.map(x=>x.score)):0;
  $("#stat-strip").innerHTML=[['累计作答',all.total+' 次'],['综合正确率',all.rate+'%'],['待掌握错题',wrong+' 道'],['模考最佳',examBest+'/10']].map(x=>`<div class="stat-tile"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
  const chapters=chapterStats().sort((a,b)=>b.total-a.total).slice(0,10);
  $("#chapter-bars").innerHTML=chapters.length?chapters.map(x=>`<div class="bar-row"><span title="${x.chapter}">${x.chapter.length>8?x.chapter.slice(0,8)+'…':x.chapter}</span><div class="bar-track"><span style="width:${x.rate}%"></span></div><b>${x.rate}%</b></div>`).join(""):`<div class="empty-state"><span>⌁</span><p>完成练习后生成章节分析。</p></div>`;
  const counts=REASONS.map(r=>({r,n:Object.values(state.records).filter(x=>x.reason===r).length})), max=Math.max(1,...counts.map(x=>x.n));
  $("#reason-chart").innerHTML=counts.map(x=>`<div class="reason-row"><span>${x.r}</span><div class="reason-dotbar"><span style="width:${x.n/max*100}%"></span></div><b>${x.n}</b></div>`).join("");
}

function exportData(){
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),state},null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`经途学习数据-${localDate()}.json`;a.click();URL.revokeObjectURL(a.href);toast("学习数据已导出");
}

async function init(){
  await loadQuestionBank();
  const now=new Date();$("#today-label").textContent=now.toLocaleDateString("zh-CN",{month:"long",day:"numeric",weekday:"long"});$("#streak").textContent=state.streak;
  $$('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  $$('[data-go]').forEach(b=>b.onclick=()=>switchView(b.dataset.go));
  $$('[data-subject]').forEach(b=>b.onclick=()=>{$$('[data-subject]').forEach(x=>x.classList.remove("selected"));b.classList.add("selected");practiceSubject=b.dataset.subject;updateChapterPicker();});
  updateChapterPicker();renderHome();
  const draftCount=QUESTIONS.filter(q=>q.review?.status==="draft").length;
  $("#bank-status").innerHTML=`<span>结构 v${BANK_META.schemaVersion}</span><span>题库 ${BANK_META.bankVersion}</span><span>${QUESTIONS.length} 道题</span><span>${draftCount} 道待审核</span>`;
  $("#start-daily").onclick=()=>{switchView("practice");const due=dueQuestions();const rest=QUESTIONS.filter(q=>!due.includes(q));startQuiz({questions:[...due,...shuffle(rest)].slice(0,10),mode:"daily"});};
  $("#start-practice").onclick=()=>{const ch=$("#chapter-select").value;startQuiz({questions:QUESTIONS.filter(q=>(practiceSubject==="all"||q.subject===practiceSubject)&&(ch==="all"||q.chapter===ch))});};
  $("#practice-weak").onclick=()=>{switchView("practice");const ch=$("#practice-weak").dataset.chapter;startQuiz({questions:QUESTIONS.filter(q=>ch==="all"||q.chapter===ch)});};
  $("#review-now").onclick=()=>switchView("review");
  $("#start-exam").onclick=startExam;$("#export-data").onclick=exportData;
  const dialog=$("#settings-dialog");const openSettings=()=>{$("#goal-input").value=state.dailyGoal;$("#exam-date-input").value=state.examDate;dialog.showModal();};
  $("#open-settings").onclick=openSettings;$("#header-settings").onclick=openSettings;
  $("#save-settings").onclick=e=>{e.preventDefault();state.dailyGoal=Math.max(5,Math.min(100,Number($("#goal-input").value)||20));state.examDate=$("#exam-date-input").value||state.examDate;saveState();dialog.close();renderHome();toast("学习计划已更新");};
  if("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(()=>{});
}
init().catch(error=>{
  console.error(error);
  document.body.innerHTML=`<main class="main"><div class="empty-state"><span>!</span><b>题库暂时无法加载</b><p>${error.message}</p><button class="primary-button" onclick="location.reload()">重新加载</button></div></main>`;
});
