const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
let QUESTIONS = [];
let BANK_META = {};
const REASONS = ["知识点不会", "概念混淆", "审题失误", "计算/推理错误"];
const DEFAULT_STATE = { schemaVersion: 3, updatedAt: 0, dailyGoal: 20, examDate: "2026-11-08", records: {}, daily: {}, answerLog: [], reviewDaily: {}, streak: 0, lastStudy: null, mastered: [], exams: [], favorites: [], important: [], notes: {}, feedback: [], activePractice: null };
let state = loadState();
let currentView = "home";
let practiceSubject = "all";
let activeQuiz = null;
let activeExam = null;
let examTimer = null;
let selectedExamMode = "mixed";
let reportSubject = "all";
let trendDays = 7;
let feedbackStatus = "all";
let feedbackQuestionId = null;
let syncTimer = null;
let syncInFlight = false;
let suppressSync = false;
let authState = { user: null, revision: 0 };

function loadState() {
  try {
    const loaded = {...DEFAULT_STATE, ...JSON.parse(localStorage.getItem("jingtu-state") || "{}")};
    loaded.favorites = Array.isArray(loaded.favorites) ? loaded.favorites : [];
    loaded.important = Array.isArray(loaded.important) ? loaded.important : [];
    loaded.notes = loaded.notes && typeof loaded.notes === "object" ? loaded.notes : {};
    loaded.feedback = Array.isArray(loaded.feedback) ? loaded.feedback : [];
    loaded.answerLog = Array.isArray(loaded.answerLog) ? loaded.answerLog : [];
    loaded.reviewDaily = loaded.reviewDaily && typeof loaded.reviewDaily === "object" ? loaded.reviewDaily : {};
    return loaded;
  }
  catch { return {...DEFAULT_STATE}; }
}
function saveState({touch = true} = {}) {
  if (touch) state.updatedAt = Date.now();
  localStorage.setItem("jingtu-state", JSON.stringify(state));
  if (!suppressSync) scheduleSync();
}
function localDate(d = new Date()) { return d.toLocaleDateString("sv-SE"); }
function todayDone() { return state.daily[localDate()] || 0; }
function accuracy(filter = () => true) {
  let total = 0, correct = 0;
  QUESTIONS.filter(filter).forEach(q => { const r = state.records[q.id]; if (r) { total += r.attempts || 0; correct += r.correct || 0; }});
  return {total, correct, rate: total ? Math.round(correct / total * 100) : 0};
}
function questionProgress(filter = () => true) {
  const questions = QUESTIONS.filter(filter);
  const attempted = questions.filter(question => (state.records[question.id]?.attempts || 0) > 0).length;
  const attempts = questions.reduce((sum, question) => sum + (state.records[question.id]?.attempts || 0), 0);
  const mastered = questions.filter(question => state.mastered.includes(question.id) || (state.records[question.id]?.correctStreak || 0) >= 2).length;
  const total = questions.length;
  return {total, attempted, remaining: Math.max(0, total - attempted), attempts, mastered, coverage: total ? Math.round(attempted / total * 100) : 0};
}
function wrongQuestions() { return QUESTIONS.filter(q => state.records[q.id]?.wrong > 0 && !state.mastered.includes(q.id)); }
function dueQuestions(filter = () => true) { const now = localDate(); return QUESTIONS.filter(q => filter(q) && state.records[q.id]?.due && state.records[q.id].due <= now); }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); }
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200); }
function shuffle(list) { return [...list].sort(() => Math.random() - .5); }
function toggleId(list, id) { return list.includes(id) ? list.filter(value => value !== id) : [...list, id]; }

function mergeStates(localState, remoteState) {
  if (!remoteState || typeof remoteState !== "object") return {...DEFAULT_STATE, ...localState};
  const local = {...DEFAULT_STATE, ...localState};
  const remote = {...DEFAULT_STATE, ...remoteState};
  const newer = (local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote;
  const merged = {...DEFAULT_STATE, ...newer};
  merged.records = {};
  const ids = new Set([...Object.keys(remote.records || {}), ...Object.keys(local.records || {})]);
  ids.forEach(id => {
    const a = remote.records?.[id], b = local.records?.[id];
    if (!a) merged.records[id] = b;
    else if (!b) merged.records[id] = a;
    else {
      const recent = String(b.last || "") >= String(a.last || "") ? b : a;
      merged.records[id] = {
        ...a, ...b, ...recent,
        attempts: Math.max(a.attempts || 0, b.attempts || 0),
        correct: Math.max(a.correct || 0, b.correct || 0),
        wrong: Math.max(a.wrong || 0, b.wrong || 0),
        due: [a.due, b.due].filter(Boolean).sort().at(-1)
      };
    }
  });
  merged.daily = {...remote.daily};
  Object.entries(local.daily || {}).forEach(([day, count]) => { merged.daily[day] = Math.max(merged.daily[day] || 0, count || 0); });
  merged.mastered = Object.entries(merged.records).filter(([, record]) => (record.correctStreak || 0) >= 2).map(([id]) => id);
  merged.favorites = [...new Set([...(remote.favorites || []), ...(local.favorites || [])])];
  merged.important = [...new Set([...(remote.important || []), ...(local.important || [])])];
  merged.notes = {...(remote.notes || {}), ...(local.notes || {})};
  const feedback = [...(remote.feedback || []), ...(local.feedback || [])];
  merged.feedback = [...new Map(feedback.map(item => [item.id || JSON.stringify(item), item])).values()];
  const answerLog = [...(remote.answerLog || []), ...(local.answerLog || [])];
  merged.answerLog = [...new Map(answerLog.map(item => [item.id || JSON.stringify(item), item])).values()].sort((a,b)=>String(a.at||"").localeCompare(String(b.at||""))).slice(-10000);
  merged.reviewDaily = {...(remote.reviewDaily || {})};
  Object.entries(local.reviewDaily || {}).forEach(([day, value]) => {
    const previous=merged.reviewDaily[day] || {planned:0,completed:[]};
    merged.reviewDaily[day]={planned:Math.max(previous.planned||0,value.planned||0),completed:[...new Set([...(previous.completed||[]),...(value.completed||[])])]};
  });
  const exams = [...(remote.exams || []), ...(local.exams || [])];
  merged.exams = [...new Map(exams.map(exam => [JSON.stringify(exam), exam])).values()];
  merged.streak = Math.max(remote.streak || 0, local.streak || 0);
  merged.updatedAt = Math.max(remote.updatedAt || 0, local.updatedAt || 0);
  return merged;
}

async function api(path, options = {}) {
  const response = await fetch(path, {cache: "no-store", credentials: "same-origin", headers: {"Content-Type": "application/json", ...(options.headers || {})}, ...options});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败 (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function setSyncStatus(label, type = "") {
  const element = $("#sync-status");
  if (!element) return;
  element.textContent = label;
  element.className = `sync-pill ${type}`.trim();
  const accountLabel = $("#account-sync-label");
  if (accountLabel && authState.user) accountLabel.textContent = label;
}

function scheduleSync() {
  if (!authState.user) return;
  clearTimeout(syncTimer);
  setSyncStatus("等待同步", "syncing");
  syncTimer = setTimeout(() => syncProgress(), 900);
}

async function syncProgress() {
  if (!authState.user || syncInFlight) return;
  syncInFlight = true;
  setSyncStatus("正在同步", "syncing");
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await api("/api/progress", {method: "PUT", body: JSON.stringify({baseRevision: authState.revision, state})});
        authState.revision = result.revision;
        setSyncStatus("已同步");
        return;
      } catch (error) {
        if (error.status !== 409 || attempt > 0) throw error;
        authState.revision = error.payload.revision || 0;
        suppressSync = true;
        state = mergeStates(state, error.payload.state);
        saveState({touch: false});
        suppressSync = false;
      }
    }
  } catch (error) {
    console.error("Cloud sync failed", error);
    setSyncStatus("同步失败", "error");
  } finally {
    syncInFlight = false;
  }
}

function renderAccountUI() {
  const signedIn = Boolean(authState.user);
  $("#account-anonymous")?.classList.toggle("hidden", signedIn);
  $("#account-signed-in")?.classList.toggle("hidden", !signedIn);
  const button = $("#account-button");
  if (button) button.textContent = signedIn ? authState.user.username.slice(0, 2) : "登录";
  if (signedIn) {
    $("#account-username-label").textContent = authState.user.username;
    $("#account-user-avatar").textContent = authState.user.username.slice(0, 1);
  } else setSyncStatus("本地模式");
  const progressOwner = $("#progress-owner-label");
  if (progressOwner) progressOwner.textContent = signedIn ? `${authState.user.username} 的题库进度` : "本机题库进度";
}

async function activateAccount(user) {
  authState.user = user;
  renderAccountUI();
  setSyncStatus("正在合并", "syncing");
  const cloud = await api("/api/progress");
  authState.revision = cloud.revision || 0;
  if (cloud.state) {
    suppressSync = true;
    state = mergeStates(state, cloud.state);
    saveState({touch: false});
    suppressSync = false;
    renderHome();
  }
  await syncProgress();
}

async function authenticate(mode) {
  const username = $("#account-username").value.trim();
  const password = $("#account-password").value;
  const message = $("#auth-message");
  message.textContent = "正在连接…";
  try {
    const result = await api(`/api/auth/${mode}`, {method: "POST", body: JSON.stringify({username, password})});
    await activateAccount(result.user);
    $("#account-password").value = "";
    message.textContent = "";
    toast(mode === "register" ? "账号已创建，数据已同步" : "登录成功，数据已同步");
  } catch (error) { message.textContent = error.message; }
}

async function restoreSession() {
  try {
    const result = await api("/api/me");
    if (result.user) await activateAccount(result.user);
    else renderAccountUI();
  } catch {
    console.info("Cloud sync unavailable; continuing locally.");
    renderAccountUI();
  }
}

async function logoutAccount() {
  await syncProgress();
  try { await api("/api/auth/logout", {method: "POST", body: "{}"}); } catch {}
  authState = {user: null, revision: 0};
  renderAccountUI();
  $("#account-dialog").close();
  toast("已退出账号，本机记录仍然保留");
}
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
function escapeAttribute(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function renderQuestionMedia(question, placement = "stem") {
  return (question.media || []).filter(media => media.kind === "image" && media.placement === placement).map(media => `<figure class="question-media"><img src="${escapeAttribute(media.src)}" alt="${escapeAttribute(media.alt)}" loading="lazy">${media.caption ? `<figcaption>${media.caption}</figcaption>` : ""}</figure>`).join("");
}
async function loadQuestionBank() {
  const response = await fetch("data/questions.json", {cache: "no-store"});
  if (!response.ok) throw new Error(`题库加载失败 (${response.status})`);
  const bank = await response.json();
  if (!bank.schemaVersion || !bank.bankVersion || !Array.isArray(bank.questions)) throw new Error("题库结构无效");
  BANK_META = bank;
  QUESTIONS = bank.questions.filter(question => question.review?.status !== "retired");
}

const EXAM_MODES = {
  mixed: {label:"快速混合", count:10, minutes:15, filter:()=>true},
  hr: {label:"人力专项", count:30, minutes:35, filter:q=>q.subject==="人力资源管理"},
  econ: {label:"经济专项", count:30, minutes:35, filter:q=>q.subject==="经济基础知识"},
  sprint: {label:"冲刺模考", count:20, minutes:25, filter:()=>true, smart:true},
  "full-econ": {label:"2026 经济基础完整套卷", count:105, minutes:90, subject:"经济基础知识", full:true},
  "full-hr": {label:"2026 人力实务完整套卷", count:100, minutes:90, subject:"人力资源管理", full:true}
};

const EXAM_RULES_2026 = {
  "full-econ": {single:70, multiple:35, case:0, total:105, score:140},
  "full-hr": {single:60, multiple:20, case:20, total:100, score:140}
};

function buildRulePaper(mode) {
  const config=EXAM_MODES[mode], rule=EXAM_RULES_2026[mode];
  const pool=shuffle(QUESTIONS.filter(q=>q.subject===config.subject));
  const used=new Set(), questions=[];
  const add=(predicate,count,section,score)=>{
    pool.filter(q=>!used.has(q.id)&&predicate(q)).slice(0,count).forEach(q=>{used.add(q.id);questions.push({...q,_examSection:section,_examScore:score});});
  };
  add(q=>q.type==="single",rule.single,"单选题",1);
  add(q=>q.type==="multiple",rule.multiple,"多选题",2);
  add(q=>q.type==="case-single"||q.type==="case-multiple",rule.case,"案例分析题",2);
  const caseShortfall=Math.max(0,rule.case-questions.filter(q=>q._examSection==="案例分析题").length);
  pool.filter(q=>!used.has(q.id)).slice(0,rule.total-questions.length).forEach(q=>{used.add(q.id);questions.push({...q,_examSection:questions.length<rule.single?"单选题":"案例分析题（题库补足）",_examScore:questions.length<rule.single?1:2});});
  return {questions:questions.slice(0,rule.total),rule,caseShortfall,missing:Math.max(0,rule.total-questions.length)};
}

function priorityScore(question, mode = "daily") {
  const record = state.records[question.id] || {};
  const chapter = accuracy(q => q.chapter === question.chapter);
  const due = record.due && record.due <= localDate();
  let score = Math.random() * 8;
  if (due) score += 500;
  if (record.wrong) score += Math.min(180, record.wrong * 45);
  if (!record.attempts) score += 120;
  if (record.attempts && chapter.rate < 70) score += 90 - chapter.rate;
  if ((record.memoryStage || 0) < 2) score += 35;
  if (question.frequency === "high") score += mode === "sprint" ? 120 : 45;
  if (state.important.includes(question.id)) score += 30;
  if (mode === "sprint" && state.mastered.includes(question.id)) score -= 80;
  return score;
}

function selectSmartQuestions(pool, count = 10, mode = "daily") {
  return [...pool].sort((a, b) => priorityScore(b, mode) - priorityScore(a, mode)).slice(0, count);
}

function sprintQuestions() {
  const focused = QUESTIONS.filter(q => q.frequency === "high" || state.records[q.id]?.wrong || !state.mastered.includes(q.id) || state.important.includes(q.id));
  return selectSmartQuestions(focused.length ? focused : QUESTIONS, 20, "sprint");
}

function scheduleReview(record, correct) {
  record.ease = Math.max(1.3, record.ease || 2.3);
  if (!correct) {
    record.memoryStage = 0;
    record.interval = 1;
    record.ease = Math.max(1.3, record.ease - .2);
  } else {
    record.memoryStage = Math.min(5, (record.memoryStage || 0) + 1);
    const intervals = [1, 1, 3, 7, 14, 30];
    record.interval = intervals[record.memoryStage];
  }
  record.due = daysFromNow(record.interval);
}

function ensureTodayReviewPlan() {
  const today=localDate();
  if (!state.reviewDaily[today]) {
    state.reviewDaily[today]={planned:dueQuestions().length,completed:[]};
    saveState();
  }
  return state.reviewDaily[today];
}

function recordLearningEvent(question, correct, context={}) {
  const durationMs=Math.max(0,Math.min(15*60*1000,Number(context.durationMs)||0));
  const event={
    id:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${question.id}-${Math.random()}`,
    questionId:question.id,subject:question.subject,chapter:question.chapter,
    knowledgePoint:question.knowledgePoints?.[0]||question.chapter,type:question.type,
    date:localDate(),at:new Date().toISOString(),correct:Boolean(correct),
    durationMs,mode:context.mode||"practice",isReview:Boolean(context.isReview)
  };
  state.answerLog.push(event);
  if (state.answerLog.length>10000) state.answerLog=state.answerLog.slice(-10000);
}

function dateRange(days) {
  return Array.from({length:days},(_,index)=>{const date=new Date();date.setDate(date.getDate()-(days-1-index));return localDate(date);});
}

function trendSeries(days=7) {
  return dateRange(days).map(date=>{
    const events=state.answerLog.filter(item=>item.date===date);
    const review=state.reviewDaily[date]||{planned:0,completed:[]};
    return {date,attempts:events.length,accuracy:events.length?Math.round(events.filter(item=>item.correct).length/events.length*100):0,minutes:Math.round(events.reduce((sum,item)=>sum+(item.durationMs||0),0)/60000),reviewRate:review.planned?Math.min(100,Math.round((review.completed||[]).length/review.planned*100)):0};
  });
}

function speedInsights() {
  const correct=state.answerLog.filter(item=>item.correct&&item.durationMs>0);
  const groups=new Map();
  correct.forEach(item=>{const key=`${item.subject}|${item.knowledgePoint||item.chapter}`;const value=groups.get(key)||{subject:item.subject,name:item.knowledgePoint||item.chapter,totalMs:0,count:0,slow:0};value.totalMs+=item.durationMs;value.count++;const threshold=["multiple","case-multiple","case-single"].includes(item.type)?150000:90000;if(item.durationMs>threshold)value.slow++;groups.set(key,value);});
  return [...groups.values()].map(item=>({...item,averageSeconds:Math.round(item.totalMs/item.count/1000),slowRate:Math.round(item.slow/item.count*100)})).filter(item=>item.count>=2&&item.slowRate>=40).sort((a,b)=>b.slowRate-a.slowRate||b.averageSeconds-a.averageSeconds).slice(0,8);
}

function persistPractice(nextIndex = activeQuiz?.index || 0) {
  if (!activeQuiz) return;
  state.activePractice = {questionIds:activeQuiz.questions.map(q=>q.id), nextIndex, score:activeQuiz.score, mode:activeQuiz.mode, savedAt:Date.now()};
  saveState();
}

function clearPracticeSession() {
  if (!state.activePractice) return;
  state.activePractice = null;
  saveState();
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
  if (view === "practice") renderPracticeSetupCounts();
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
  const progress = questionProgress();
  $("#bank-attempted").textContent = progress.attempted;
  $("#bank-total").textContent = progress.total;
  $("#bank-coverage").textContent = `${progress.coverage}%`;
  $("#bank-coverage-bar").style.width = `${progress.coverage}%`;
  $("#metric-total").textContent = progress.total;
  $("#metric-attempted").textContent = progress.attempted;
  $("#metric-remaining").textContent = progress.remaining;
  $("#metric-mastered").textContent = progress.mastered;
  $("#metric-attempts").textContent = progress.attempts;
  $("#unseen-count").textContent = progress.remaining;
  $("#progress-owner-label").textContent = authState.user ? `${authState.user.username} 的题库进度` : "本机题库进度";
  const saved = state.activePractice;
  const resumeCard = $("#resume-session-card");
  const savedQuestions = saved?.questionIds?.filter(id => QUESTIONS.some(q => q.id === id)) || [];
  resumeCard.classList.toggle("hidden", !savedQuestions.length || saved.nextIndex >= savedQuestions.length);
  if (savedQuestions.length && saved.nextIndex < savedQuestions.length) {
    $("#resume-session-title").textContent = saved.mode === "sprint" ? "继续上次考前冲刺" : "继续上次练习";
    $("#resume-session-copy").textContent = `已完成 ${saved.nextIndex} / ${savedQuestions.length} 题，进度已自动保存。`;
  }
  const subjects = ["经济基础知识", "人力资源管理"];
  $("#subject-grid").innerHTML = subjects.map((s, i) => { const filter=q=>q.subject===s, a=accuracy(filter), p=questionProgress(filter); return `<article class="subject-card ${i ? "hr" : "econ"}"><div class="subject-top"><span class="subject-symbol">${i ? "人" : "经"}</span><span class="subject-score">${a.rate}<small>% 正确率</small></span></div><h3>${s}</h3><p>已做 ${p.attempted} / ${p.total} 道 · 累计作答 ${p.attempts} 次</p><div class="mini-bar" title="题库覆盖率 ${p.coverage}%"><span style="width:${p.coverage}%"></span></div></article>`; }).join("");
  const chapters = chapterStats().filter(x => x.total >= 2).sort((a,b) => a.rate - b.rate);
  const weak = chapters[0];
  $("#weak-title").textContent = weak ? weak.chapter : "还没有薄弱点";
  $("#weak-copy").textContent = weak ? `当前正确率 ${weak.rate}%，建议安排一组专项练习。` : "完成几道题后，这里会自动识别需要加强的章节。";
  $("#practice-weak").dataset.chapter = weak?.chapter || "all";
  const due = dueQuestions(); $("#due-count").textContent = due.length;
  $("#review-preview").innerHTML = due.length ? `<span>↻</span><div><b>${due.length} 道题等待复习</b><p>${due[0].chapter}${due.length > 1 ? " 等知识点" : ""}</p></div>` : `<span>✓</span><div><b>暂时没有到期题目</b><p>系统会根据记忆阶段安排下一次复习。</p></div>`;
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

function renderPracticeSetupCounts() {
  $("#favorite-count").textContent = state.favorites.filter(id => QUESTIONS.some(q => q.id === id)).length;
  $("#important-count").textContent = state.important.filter(id => QUESTIONS.some(q => q.id === id)).length;
}

function startQuiz({questions, mode="practice", resumeIndex=0, score=0, keepOrder=false}) {
  if (!questions.length) { toast("这个范围暂时没有可练习题目"); return; }
  const selectedQuestions = keepOrder ? [...questions].slice(0, 20) : shuffle(questions).slice(0, mode === "sprint" ? 20 : 10);
  activeQuiz = {questions:selectedQuestions, index:resumeIndex, score, answered:false, selected:[], mode, questionStartedAt:Date.now()};
  $("#practice-setup").classList.add("hidden"); $("#quiz-stage").classList.remove("hidden"); renderQuizQuestion();
  persistPractice(resumeIndex);
}

function renderQuizQuestion() {
  const {questions, index} = activeQuiz; const q = questions[index]; const rec = state.records[q.id] || {};
  activeQuiz.selected = [];
  activeQuiz.questionStartedAt=Date.now();
  const favorite = state.favorites.includes(q.id), important = state.important.includes(q.id), note = state.notes[q.id] || "";
  $("#quiz-stage").innerHTML = `<div class="quiz-shell"><div class="quiz-meta"><button class="ghost-button" id="quit-quiz">← 暂停练习</button><span class="progress-text">第 ${index + 1} / ${questions.length} 题</span></div><div class="quiz-progress"><span style="width:${(index/questions.length)*100}%"></span></div><article class="question-card"><div class="question-tags"><span class="question-tag">${q.subject}</span><span class="question-tag">${q.chapter}</span><span class="question-tag">${typeLabel(q)}</span><span class="question-tag">难度 ${q.difficulty || 2}</span>${rec.attempts ? `<span class="question-tag">已练 ${rec.attempts} 次</span>` : ""}</div><div class="question-tools"><button class="question-tool ${favorite ? "active" : ""}" id="toggle-favorite">★ ${favorite ? "已收藏" : "收藏"}</button><button class="question-tool ${important ? "active" : ""}" id="toggle-important">⚑ ${important ? "重点题" : "标为重点"}</button><button class="question-tool" id="toggle-note">✎ 个人笔记</button><button class="question-tool" id="report-question">! 题目有误</button></div><div class="question-note ${note ? "" : "hidden"}" id="question-note"><textarea id="question-note-input" maxlength="1000" placeholder="写下你的理解、易错点或记忆方法">${note}</textarea></div>${q.material ? `<div class="case-material"><b>案例材料</b><br>${q.material}</div>` : ""}${renderQuestionMedia(q, "material")}<h2>${q.stem}</h2>${renderQuestionMedia(q, "stem")}${isMultiple(q) ? `<div class="multi-hint">多选题 · 请选择所有正确选项后确认</div>` : ""}<div class="option-list">${q.options.map((o,i) => { const id=optionId(o,i); return `<button class="option" data-option="${id}"><span class="option-letter">${id}</span><span>${optionText(o)}</span></button>`; }).join("")}</div>${isMultiple(q) ? `<div class="quiz-actions"><button class="primary-button" id="confirm-answer" disabled>确认答案 <span>→</span></button></div>` : ""}<div id="answer-feedback"></div></article></div>`;
  $("#quit-quiz").onclick = () => quitQuiz(true);
  $("#toggle-favorite").onclick = event => { state.favorites=toggleId(state.favorites,q.id);saveState();event.currentTarget.classList.toggle("active");event.currentTarget.textContent=state.favorites.includes(q.id)?"★ 已收藏":"★ 收藏";renderPracticeSetupCounts(); };
  $("#toggle-important").onclick = event => { state.important=toggleId(state.important,q.id);saveState();event.currentTarget.classList.toggle("active");event.currentTarget.textContent=state.important.includes(q.id)?"⚑ 重点题":"⚑ 标为重点";renderPracticeSetupCounts(); };
  $("#toggle-note").onclick = () => $("#question-note").classList.toggle("hidden");
  $("#question-note-input").onchange = event => { const value=event.target.value.trim(); if(value)state.notes[q.id]=value;else delete state.notes[q.id];saveState();toast(value?"笔记已保存":"笔记已清除"); };
  $("#report-question").onclick = () => openFeedback(q);
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
  recordAnswer(q, correct, {durationMs:Date.now()-activeQuiz.questionStartedAt,mode:activeQuiz.mode,isReview:activeQuiz.mode==="review"});
  $("#answer-feedback").innerHTML = `<div class="answer-panel ${correct ? "" : "bad"}"><h4>${correct ? "回答正确，很稳。" : `回答错误，正确答案是 ${expected.join("、")}。`}</h4><p>${explanationText(q)}</p>${renderQuestionMedia(q, "explanation")}${q.explanation?.memoryTip ? `<p><b>记忆提示：</b>${q.explanation.memoryTip}</p>` : ""}${renderOptionAnalysis(q)}${correct ? `<div class="memory-rating"><span>这题对你来说：</span><button class="memory-button" data-memory="hard">有点模糊</button><button class="memory-button" data-memory="good">掌握正常</button><button class="memory-button" data-memory="easy">非常轻松</button></div>` : `<div class="reason-prompt"><span>这次为什么会错？</span><div class="reason-buttons">${REASONS.map(r => `<button class="reason-button" data-reason="${r}">${r}</button>`).join("")}</div></div>`}</div><div class="quiz-actions"><button class="question-tool" id="feedback-after-answer">! 反馈本题</button><button class="primary-button" id="next-question">${activeQuiz.index === activeQuiz.questions.length-1 ? "查看结果" : "下一题"} <span>→</span></button></div>`;
  $$('[data-reason]').forEach(b => b.onclick = () => { $$('[data-reason]').forEach(x => x.classList.remove("active")); b.classList.add("active"); state.records[q.id].reason = b.dataset.reason; saveState(); toast("已记录错因"); });
  $$('[data-memory]').forEach(b => b.onclick = () => applyMemoryRating(q.id, b.dataset.memory));
  $("#feedback-after-answer").onclick = () => openFeedback(q);
  $("#next-question").onclick = nextQuiz;
  persistPractice(activeQuiz.index + 1);
}

function derivedOptionAnalysis(question) {
  const analysis={...(question.explanation?.optionAnalysis||{})};
  const summary=explanationText(question);
  String(summary).split(/[。；;\n]/).map(value=>value.trim()).filter(value=>value.length>=6&&value.length<=180&&/(正确|错误|不正确|不符合|符合|应为|不是|属于|不属于)/.test(value)).forEach(sentence=>{
    const groups=sentence.match(/[A-D](?:[、,，和及与][A-D])*/g)||[];
    const ids=[...new Set(groups.flatMap(group=>group.match(/[A-D]/g)||[]))];
    ids.forEach(id=>{if(!analysis[id])analysis[id]=sentence;});
  });
  return analysis;
}

function optionAnalysisCoverage() {
  let total=0,filled=0;
  QUESTIONS.forEach(question=>{const analysis=derivedOptionAnalysis(question);question.options.forEach((option,index)=>{total++;if(analysis[optionId(option,index)])filled++;});});
  return {total,filled,pending:total-filled,rate:total?Math.round(filled/total*100):0};
}

function renderOptionAnalysis(question) {
  const analysis = derivedOptionAnalysis(question);
  const expected = answerIds(question);
  const rows = question.options.map((option,index)=>{
    const id=optionId(option,index), detail=analysis[id];
    const fallback=expected.includes(id)?"正确项，依据见上方解析。":"该选项的错误理由待题库补充。";
    return `<div class="option-analysis-row ${detail?"":"pending"}"><b>${id}</b><span>${detail || fallback}</span></div>`;
  }).join("");
  return `<div class="option-analysis"><h5>逐项解析</h5>${rows}</div>`;
}

function applyMemoryRating(questionId, rating) {
  const record=state.records[questionId]; if(!record)return;
  if(rating==="hard"){record.ease=Math.max(1.3,(record.ease||2.3)-.15);record.interval=Math.max(1,Math.round((record.interval||1)*.6));}
  if(rating==="easy"){record.ease=Math.min(3,(record.ease||2.3)+.1);record.interval=Math.max(2,Math.round((record.interval||1)*1.6));}
  record.due=daysFromNow(record.interval||1);record.memoryRating=rating;saveState();
  $$('[data-memory]').forEach(button=>button.disabled=true);toast(`已调整复习时间：${record.due}`);
}

function recordAnswer(q, correct, context={}) {
  markStudy(); const r = state.records[q.id] || {attempts:0, correct:0, wrong:0};
  const wasDue=Boolean(r.due&&r.due<=localDate());
  r.attempts++;
  if (correct) {
    r.correct++; r.correctStreak = (r.correctStreak || 0) + 1;
    if (r.correctStreak >= 2 && !state.mastered.includes(q.id)) state.mastered.push(q.id);
  } else {
    r.wrong++; r.correctStreak = 0;
    state.mastered = state.mastered.filter(id => id !== q.id);
  }
  scheduleReview(r, correct);
  r.last = localDate(); state.records[q.id] = r; state.daily[localDate()] = todayDone() + 1;
  const reviewPlan=ensureTodayReviewPlan();
  if ((wasDue||context.isReview)&&!reviewPlan.completed.includes(q.id)) reviewPlan.completed.push(q.id);
  recordLearningEvent(q,correct,{...context,isReview:wasDue||context.isReview});
  saveState();
  $("#streak").textContent = state.streak;
}

function nextQuiz() {
  if (activeQuiz.index < activeQuiz.questions.length - 1) { activeQuiz.index++; activeQuiz.answered = false; activeQuiz.selected = []; activeQuiz.questionStartedAt=Date.now(); persistPractice(activeQuiz.index); renderQuizQuestion(); }
  else renderQuizResult();
}
function renderQuizResult() {
  const {score, questions} = activeQuiz, pct = Math.round(score/questions.length*100);
  $("#quiz-stage").innerHTML = `<div class="quiz-shell"><div class="result-card"><div class="result-score"><strong>${pct}</strong><small>正确率</small></div><h2>${pct >= 80 ? "这一组掌握得不错" : pct >= 60 ? "基础已经有了，再巩固一下" : "薄弱点找到了，这就是进步的起点"}</h2><p>答对 ${score} 题，答错 ${questions.length-score} 题。错题已自动加入复习计划。</p><button class="primary-button" id="finish-quiz">返回练习中心 <span>→</span></button></div></div>`;
  clearPracticeSession();
  $("#finish-quiz").onclick = () => quitQuiz(false);
}
function quitQuiz(preserve = true) { if(!preserve)clearPracticeSession();activeQuiz = null; $("#quiz-stage").classList.add("hidden"); $("#practice-setup").classList.remove("hidden"); renderPracticeSetupCounts();renderHome(); }

function openFeedback(question) {
  feedbackQuestionId=question.id;
  $("#feedback-question").textContent=`${question.id} · ${question.stem}`;
  $("#feedback-note").value="";
  $("#feedback-dialog").showModal();
}

function renderReview(filter="全部") {
  const wrong = wrongQuestions(), due = dueQuestions();
  const all = [...new Map([...due,...wrong].map(question=>[question.id,question])).values()];
  $("#wrong-summary").textContent = `${wrong.length} 道待掌握 · ${due.length} 道今日到期`;
  $("#reason-filters").innerHTML = ["全部", "到期复习", ...REASONS].map(r => `<button class="filter-chip ${r===filter?"active":""}" data-filter="${r}">${r}</button>`).join("");
  $$('[data-filter]').forEach(b => b.onclick = () => renderReview(b.dataset.filter));
  const list = filter === "全部" ? all : filter === "到期复习" ? due : wrong.filter(q => (state.records[q.id].reason || "知识点不会") === filter);
  $("#wrong-list").innerHTML = list.length ? list.map(q => { const r=state.records[q.id]; return `<article class="wrong-card"><div><span class="small-tag">${r.due <= localDate() ? "今日到期" : (r.reason || `记忆阶段 ${r.memoryStage || 0}`)}</span><h3>${q.stem}</h3><p>${q.subject} · ${q.chapter} · 已练 ${r.attempts || 0} 次 · ${r.due <= localDate() ? "现在复习" : `${r.due} 复习`}</p></div><button class="ghost-button" data-review-one="${q.id}">再做一次</button></article>`; }).join("") : `<div class="empty-state"><span>✓</span><b>复习任务已清空</b><p>新的复习题会根据你的记忆阶段自动出现。</p></div>`;
  $$('[data-review-one]').forEach(b => b.onclick = () => { switchView("practice"); startQuiz({questions:[QUESTIONS.find(q => q.id===b.dataset.reviewOne)],mode:"review"}); });
}

function startExam() {
  const config=EXAM_MODES[selectedExamMode] || EXAM_MODES.mixed;
  let questions, paperInfo=null;
  if(config.full){paperInfo=buildRulePaper(selectedExamMode);questions=paperInfo.questions;}else{const pool=QUESTIONS.filter(config.filter);questions=config.smart?selectSmartQuestions(pool,config.count,"sprint"):shuffle(pool).slice(0,config.count);}
  if(!questions.length){toast("当前题库无法生成这套试卷");return;}
  if(paperInfo?.missing) toast(`当前题库还缺 ${paperInfo.missing} 道同科题，已按现有题量组卷`);
  activeExam = {questions, index:0, answers:{}, remaining:config.minutes*60, mode:selectedExamMode, label:config.label, paperInfo, timeSpent:{}, questionStartedAt:Date.now()};
  $("#exam-intro").classList.add("hidden"); $("#exam-stage").classList.remove("hidden"); renderExam();
  clearInterval(examTimer); examTimer=setInterval(()=>{ activeExam.remaining--; updateTimer(); if(activeExam.remaining<=0) submitExam(true); },1000);
}
function updateTimer(){ const m=String(Math.floor(activeExam.remaining/60)).padStart(2,"0"),s=String(activeExam.remaining%60).padStart(2,"0"); const el=$("#exam-timer"); if(el) el.textContent=`${m}:${s}`; }
function markExamQuestionTime(){if(!activeExam)return;const question=activeExam.questions[activeExam.index];if(!question)return;activeExam.timeSpent[question.id]=(activeExam.timeSpent[question.id]||0)+Math.max(0,Date.now()-activeExam.questionStartedAt);activeExam.questionStartedAt=Date.now();}
function renderExam() {
  const q=activeExam.questions[activeExam.index], chosen=activeExam.answers[q.id] || [];
  activeExam.questionStartedAt=Date.now();
  $("#exam-stage").innerHTML=`<div class="exam-top"><button class="ghost-button" id="quit-exam">退出模考</button><span>${activeExam.label} · ${activeExam.questions.length} 题</span><span class="timer" id="exam-timer"></span></div>${activeExam.paperInfo?.caseShortfall?`<div class="exam-rule-note">当前题库独立案例题不足，${activeExam.paperInfo.caseShortfall} 个案例题位使用同科、同分值客观题补足；计时与总分仍按 2026 套卷规则。</div>`:""}<div class="exam-grid"><article class="question-card"><div class="question-tags"><span class="question-tag">${q.subject}</span><span class="question-tag">${q._examSection||typeLabel(q)}</span><span class="question-tag">第 ${activeExam.index+1} 题</span><span class="question-tag">${q._examScore||q.scoring?.score||1} 分</span></div>${q.material ? `<div class="case-material"><b>案例材料</b><br>${q.material}</div>` : ""}${renderQuestionMedia(q, "material")}<h2>${q.stem}</h2>${renderQuestionMedia(q, "stem")}${isMultiple(q) ? `<div class="multi-hint">多选题 · 请选择所有正确选项；无错项时可按规则部分得分</div>` : ""}<div class="option-list">${q.options.map((o,i)=>{const id=optionId(o,i);return `<button class="option ${chosen.includes(id)?"selected":""}" data-exam-option="${id}"><span class="option-letter">${id}</span><span>${optionText(o)}</span></button>`;}).join("")}</div><div class="quiz-actions">${activeExam.index?`<button class="ghost-button" id="exam-prev">上一题</button>`:""}<button class="primary-button" id="exam-next">${activeExam.index===activeExam.questions.length-1?"交卷":"下一题"} <span>→</span></button></div></article><aside class="answer-sheet"><h3>答题卡</h3><p>${Object.keys(activeExam.answers).length}/${activeExam.questions.length} 已答</p><div class="sheet-grid">${activeExam.questions.map((x,i)=>`<button class="sheet-button ${(activeExam.answers[x.id] || []).length?"done":""} ${i===activeExam.index?"current":""}" data-sheet="${i}">${i+1}</button>`).join("")}</div></aside></div>`;
  updateTimer();
  $$('[data-exam-option]').forEach(b=>b.onclick=()=>{markExamQuestionTime();const id=b.dataset.examOption;if(isMultiple(q)){const values=activeExam.answers[q.id]||[];activeExam.answers[q.id]=values.includes(id)?values.filter(value=>value!==id):[...values,id];}else activeExam.answers[q.id]=[id];renderExam();});
  $$('[data-sheet]').forEach(b=>b.onclick=()=>{markExamQuestionTime();activeExam.index=Number(b.dataset.sheet);renderExam();});
  $("#exam-prev") && ($("#exam-prev").onclick=()=>{markExamQuestionTime();activeExam.index--;renderExam();});
  $("#exam-next").onclick=()=>{markExamQuestionTime();return activeExam.index===activeExam.questions.length-1?submitExam(false):(activeExam.index++,renderExam());};
  $("#quit-exam").onclick=quitExam;
}
function scoreExamQuestion(question, selected=[]) {
  const expected=answerIds(question), max=Number(question._examScore||question.scoring?.score)||1;
  if(isCorrectAnswer(question,selected))return max;
  if(isMultiple(question)&&question.scoring?.partialCredit&&selected.length&&selected.every(id=>expected.includes(id)))return Math.min(max-.5,selected.length*.5);
  return 0;
}
function submitExam(forced=false){
  if(!activeExam)return;
  markExamQuestionTime();
  const unanswered=activeExam.questions.filter(q=>!(activeExam.answers[q.id]||[]).length).length;
  if(!forced&&unanswered&&!confirm(`还有 ${unanswered} 道题未作答，确定交卷吗？`))return;
  clearInterval(examTimer); let score=0,correctCount=0,total=0;
  activeExam.questions.forEach(q=>{const selected=activeExam.answers[q.id]||[];total+=Number(q._examScore||q.scoring?.score)||1;if(!selected.length)return;const gained=scoreExamQuestion(q,selected);score+=gained;if(isCorrectAnswer(q,selected))correctCount++;recordAnswer(q,isCorrectAnswer(q,selected),{durationMs:activeExam.timeSpent[q.id]||0,mode:activeExam.mode});});
  score=Math.round(score*10)/10;state.exams.push({date:localDate(),score,total,answered:Object.keys(activeExam.answers).length,mode:activeExam.mode,durationSeconds:(EXAM_MODES[activeExam.mode]?.minutes||0)*60-activeExam.remaining});saveState();
  const rate=total?Math.round(score/total*100):0;
  $("#exam-stage").innerHTML=`<div class="quiz-shell"><div class="result-card"><div class="result-score"><strong>${score}</strong><small>/ ${total} 分</small></div><h2>${rate>=80?"考场状态不错":"模考的价值，是提前暴露问题"}</h2><p>本次作答 ${Object.keys(activeExam.answers).length} 题，完全答对 ${correctCount} 题，得分率 ${rate}%。未答题不会计入错题本。</p><button class="primary-button" id="finish-exam">完成并查看报告 <span>→</span></button></div></div>`;
  $("#finish-exam").onclick=()=>{quitExam();switchView("stats");};
}
function quitExam(){clearInterval(examTimer);activeExam=null;$("#exam-stage").classList.add("hidden");$("#exam-intro").classList.remove("hidden");}

function chapterStats(){
  const chapters=[...new Set(QUESTIONS.map(q=>q.chapter))];
  return chapters.map(chapter=>({chapter,...accuracy(q=>q.chapter===chapter)})).filter(x=>x.total);
}
function chapterCoverageStats(){
  const chapters=[...new Set(QUESTIONS.map(q=>q.chapter))];
  return chapters.map(chapter=>{
    const filter=q=>q.chapter===chapter;
    const question=QUESTIONS.find(filter);
    return {chapter,subject:question?.subject||"",...questionProgress(filter),accuracy:accuracy(filter).rate,wrong:QUESTIONS.filter(q=>filter(q)&&state.records[q.id]?.wrong>0&&!state.mastered.includes(q.id)).length};
  });
}
function heatLevel(coverage){ return coverage===0?0:coverage<=25?1:coverage<=50?2:coverage<=75?3:4; }
function renderTrendPanel(){
  const series=trendSeries(trendDays),withAnswers=series.filter(item=>item.attempts),totalAttempts=series.reduce((sum,item)=>sum+item.attempts,0),totalCorrect=state.answerLog.filter(item=>series.some(day=>day.date===item.date)&&item.correct).length;
  const totalMinutes=series.reduce((sum,item)=>sum+item.minutes,0),planned=series.reduce((sum,item)=>sum+(state.reviewDaily[item.date]?.planned||0),0),completed=series.reduce((sum,item)=>sum+(state.reviewDaily[item.date]?.completed||[]).length,0),maxMinutes=Math.max(1,...series.map(item=>item.minutes));
  $("#trend-summary").innerHTML=[["答题正确率",`${totalAttempts?Math.round(totalCorrect/totalAttempts*100):0}%`,`${totalAttempts} 次作答`],["学习时长",`${totalMinutes} 分钟`,`${withAnswers.length} 个学习日`],["复习完成率",`${planned?Math.min(100,Math.round(completed/planned*100)):0}%`,`${completed}/${planned} 道到期复习`]].map(item=>`<div><span>${item[0]}</span><strong>${item[1]}</strong><small>${item[2]}</small></div>`).join("");
  $("#trend-chart").innerHTML=series.map((item,index)=>`<div class="trend-day" title="${item.date}｜正确率 ${item.accuracy}%｜${item.minutes} 分钟｜复习 ${item.reviewRate}%"><div class="trend-bars"><i class="accuracy" style="height:${item.accuracy}%"></i><i class="duration" style="height:${item.minutes/maxMinutes*100}%"></i><i class="review" style="height:${item.reviewRate}%"></i></div><span>${trendDays===7||index%5===0?item.date.slice(5).replace("-","/"):""}</span></div>`).join("");
  $$('[data-trend-days]').forEach(button=>{button.classList.toggle("active",Number(button.dataset.trendDays)===trendDays);button.onclick=()=>{trendDays=Number(button.dataset.trendDays);renderTrendPanel();};});
}

function normalizedFeedbackStatus(status){return status==="pending-local"?"pending":status||"pending";}
function renderFeedbackCenter(){
  const labels={pending:"待处理",processing:"处理中",resolved:"已修复"},all=state.feedback||[];
  $("#feedback-stats").innerHTML=["pending","processing","resolved"].map(status=>`<button class="feedback-stat ${feedbackStatus===status?"active":""}" data-feedback-filter="${status}"><span>${labels[status]}</span><strong>${all.filter(item=>normalizedFeedbackStatus(item.status)===status).length}</strong></button>`).join("");
  const list=feedbackStatus==="all"?all:all.filter(item=>normalizedFeedbackStatus(item.status)===feedbackStatus);
  $("#feedback-list").innerHTML=list.length?list.slice().reverse().map(item=>{const question=QUESTIONS.find(q=>q.id===item.questionId),status=normalizedFeedbackStatus(item.status);return `<article class="feedback-review-card"><div><span class="status-badge ${status}">${labels[status]}</span><small>${new Date(item.createdAt).toLocaleString("zh-CN")}</small><h4>${item.questionId} · ${question?.stem||"题目已不在当前题库"}</h4><p><b>${item.reason}</b>${item.note?` · ${item.note}`:""}</p>${item.resolvedAt?`<small>处理于 ${new Date(item.resolvedAt).toLocaleString("zh-CN")}</small>`:""}</div><div class="feedback-actions">${question?`<button class="text-button" data-feedback-open="${item.questionId}">查看题目</button>`:""}${status!=="processing"?`<button class="secondary-button" data-feedback-action="processing" data-feedback-id="${item.id}">处理中</button>`:""}${status!=="resolved"?`<button class="primary-button" data-feedback-action="resolved" data-feedback-id="${item.id}">标记已修复</button>`:`<button class="secondary-button" data-feedback-action="pending" data-feedback-id="${item.id}">重新打开</button>`}</div></article>`;}).join(""):`<div class="empty-state compact"><span>✓</span><b>这里暂时没有反馈</b><p>从题目页提交的本机反馈会集中到这里。</p></div>`;
  $$('[data-feedback-filter]').forEach(button=>button.onclick=()=>{feedbackStatus=button.dataset.feedbackFilter;renderFeedbackCenter();});
  $$('[data-feedback-action]').forEach(button=>button.onclick=()=>{const item=state.feedback.find(value=>value.id===button.dataset.feedbackId);if(!item)return;item.status=button.dataset.feedbackAction;item.updatedAt=new Date().toISOString();if(item.status==="resolved")item.resolvedAt=item.updatedAt;else delete item.resolvedAt;saveState();renderFeedbackCenter();toast(item.status==="resolved"?"已标记为已修复":"反馈状态已更新");});
  $$('[data-feedback-open]').forEach(button=>button.onclick=()=>{const question=QUESTIONS.find(q=>q.id===button.dataset.feedbackOpen);if(!question)return;switchView("practice");startQuiz({questions:[question],mode:"feedback",keepOrder:true});});
}

function renderSpeedPanel(){
  const insights=speedInsights();
  $("#speed-insights").innerHTML=insights.length?insights.map(item=>`<button class="speed-card" data-speed-topic="${escapeAttribute(item.name)}"><span>${item.subject}</span><h4>${item.name}</h4><p>答对题平均 <b>${item.averageSeconds} 秒</b> · ${item.slowRate}% 超过建议用时</p><small>${item.count} 次正确作答样本 · 点击专项练习</small></button>`).join(""):`<div class="empty-state compact"><span>◷</span><b>还没有识别出“会做但太慢”</b><p>每个知识点积累至少 2 次正确作答后开始诊断；单选建议 90 秒，多选/案例建议 150 秒。</p></div>`;
  $$('[data-speed-topic]').forEach(button=>button.onclick=()=>{const pool=QUESTIONS.filter(q=>(q.knowledgePoints?.[0]||q.chapter)===button.dataset.speedTopic);switchView("practice");startQuiz({questions:selectSmartQuestions(pool,10,"speed"),mode:"speed",keepOrder:true});});
}

function renderStats(){
  const all=accuracy(), progress=questionProgress(), wrong=wrongQuestions().length, examBest=state.exams.length?Math.max(...state.exams.map(x=>x.total?Math.round(x.score/x.total*100):0)):0;
  $("#stat-strip").innerHTML=[['题库覆盖',progress.attempted+'/'+progress.total],['已掌握',progress.mastered+' 道'],['累计作答',all.total+' 次'],['综合正确率',all.rate+'%'],['待掌握错题',wrong+' 道'],['模考最佳',examBest+'%']].map(x=>`<div class="stat-tile"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
  $("#report-subject-filters").innerHTML=[["all","全部"],["人力资源管理","人力"],["经济基础知识","经济"]].map(([value,label])=>`<button class="filter-chip ${reportSubject===value?"active":""}" data-report-subject="${value}">${label}</button>`).join("");
  $$('[data-report-subject]').forEach(button=>button.onclick=()=>{reportSubject=button.dataset.reportSubject;renderStats();});
  const sort=$("#report-sort").value;
  let heat=chapterCoverageStats().filter(x=>reportSubject==="all"||x.subject===reportSubject);
  heat.sort(sort==="accuracy"?(a,b)=>a.accuracy-b.accuracy:sort==="wrong"?(a,b)=>b.wrong-a.wrong:(a,b)=>a.coverage-b.coverage);
  $("#chapter-heatmap").innerHTML=heat.map(x=>`<button class="heatmap-card heat-${heatLevel(x.coverage)}" data-report-chapter="${x.chapter}" aria-label="${x.chapter}，已做 ${x.attempted} 共 ${x.total} 道，正确率 ${x.accuracy}%"><span class="heatmap-subject">${x.subject}</span><h4>${x.chapter}</h4><div class="heatmap-values"><span>已做 ${x.attempted}/${x.total} · 错题 ${x.wrong}</span><b>${x.accuracy}%</b></div><span class="heatmap-action">点击开始智能专项 →</span></button>`).join("");
  $$('[data-report-chapter]').forEach(button=>button.onclick=()=>{const pool=QUESTIONS.filter(q=>q.chapter===button.dataset.reportChapter);switchView("practice");startQuiz({questions:selectSmartQuestions(pool,10,"chapter"),mode:"chapter",keepOrder:true});});
  const chapters=chapterStats().filter(x=>reportSubject==="all"||QUESTIONS.find(q=>q.chapter===x.chapter)?.subject===reportSubject).sort((a,b)=>b.total-a.total).slice(0,10);
  $("#chapter-bars").innerHTML=chapters.length?chapters.map(x=>`<div class="bar-row"><span title="${x.chapter}">${x.chapter.length>8?x.chapter.slice(0,8)+'…':x.chapter}</span><div class="bar-track"><span style="width:${x.rate}%"></span></div><b>${x.rate}%</b></div>`).join(""):`<div class="empty-state"><span>⌁</span><p>完成练习后生成章节分析。</p></div>`;
  const counts=REASONS.map(r=>({r,n:Object.values(state.records).filter(x=>x.reason===r).length})), max=Math.max(1,...counts.map(x=>x.n));
  $("#reason-chart").innerHTML=counts.map(x=>`<div class="reason-row"><span>${x.r}</span><div class="reason-dotbar"><span style="width:${x.n/max*100}%"></span></div><b>${x.n}</b></div>`).join("");
  renderTrendPanel();renderSpeedPanel();renderFeedbackCenter();
  const optionCoverage=optionAnalysisCoverage();
  $("#option-analysis-progress").innerHTML=`<div><strong>${optionCoverage.rate}%</strong><span>选项级解析覆盖率</span></div><div class="coverage-track"><span style="width:${optionCoverage.rate}%"></span></div><p>已补齐 ${optionCoverage.filled} / ${optionCoverage.total} 个选项；仍有 ${optionCoverage.pending} 个选项显示“待补充”，不会用推测内容冒充解析。</p>`;
  $("#report-sort").onchange=renderStats;
}

function exportData(){
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),state},null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`经途学习数据-${localDate()}.json`;a.click();URL.revokeObjectURL(a.href);toast("学习数据已导出");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register("service-worker.js", {updateViaCache: "none"});
    await registration.update();
  } catch (error) {
    console.info("Offline support unavailable", error);
  }
}

async function init(){
  const serviceWorkerUpdate = registerServiceWorker();
  await loadQuestionBank();
  ensureTodayReviewPlan();
  const now=new Date();$("#today-label").textContent=now.toLocaleDateString("zh-CN",{month:"long",day:"numeric",weekday:"long"});$("#streak").textContent=state.streak;
  $$('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  $$('[data-go]').forEach(b=>b.onclick=()=>switchView(b.dataset.go));
  $$('[data-subject]').forEach(b=>b.onclick=()=>{$$('[data-subject]').forEach(x=>x.classList.remove("selected"));b.classList.add("selected");practiceSubject=b.dataset.subject;updateChapterPicker();});
  updateChapterPicker();renderPracticeSetupCounts();renderHome();
  const draftCount=QUESTIONS.filter(q=>q.review?.status==="draft").length;
  $("#bank-status").innerHTML=`<span>结构 v${BANK_META.schemaVersion}</span><span>题库 ${BANK_META.bankVersion}</span><span>${QUESTIONS.length} 道题</span><span>${draftCount} 道待审核</span>`;
  $("#start-daily").onclick=()=>{switchView("practice");const count=Math.min(10,Math.max(5,state.dailyGoal-todayDone()));startQuiz({questions:selectSmartQuestions(QUESTIONS,count,"daily"),mode:"daily",keepOrder:true});};
  $("#practice-unseen").onclick=()=>{const unseen=QUESTIONS.filter(q=>(state.records[q.id]?.attempts||0)===0);if(!unseen.length){toast("题库已经全部做过，去错题本继续巩固吧");return;}switchView("practice");startQuiz({questions:unseen,mode:"unseen"});};
  $("#start-practice").onclick=()=>{const ch=$("#chapter-select").value;startQuiz({questions:QUESTIONS.filter(q=>(practiceSubject==="all"||q.subject===practiceSubject)&&(ch==="all"||q.chapter===ch))});};
  $("#practice-weak").onclick=()=>{switchView("practice");const ch=$("#practice-weak").dataset.chapter;startQuiz({questions:QUESTIONS.filter(q=>ch==="all"||q.chapter===ch)});};
  $("#start-sprint").onclick=()=>startQuiz({questions:sprintQuestions(),mode:"sprint",keepOrder:true});
  $("#practice-favorites").onclick=()=>{const pool=QUESTIONS.filter(q=>state.favorites.includes(q.id));if(!pool.length){toast("还没有收藏题目");return;}startQuiz({questions:pool,mode:"favorites"});};
  $("#practice-important").onclick=()=>{const pool=QUESTIONS.filter(q=>state.important.includes(q.id));if(!pool.length){toast("还没有重点题目");return;}startQuiz({questions:pool,mode:"important"});};
  $("#resume-session").onclick=()=>{const saved=state.activePractice;if(!saved)return;const questions=saved.questionIds.map(id=>QUESTIONS.find(q=>q.id===id)).filter(Boolean);switchView("practice");startQuiz({questions,mode:saved.mode,resumeIndex:Math.min(saved.nextIndex,questions.length-1),score:saved.score||0,keepOrder:true});};
  $("#discard-session").onclick=()=>{clearPracticeSession();renderHome();toast("已放弃上次练习");};
  $("#review-now").onclick=()=>switchView("review");
  $$('[data-exam-mode]').forEach(button=>button.onclick=()=>{$$('[data-exam-mode]').forEach(x=>x.classList.remove("selected"));button.classList.add("selected");selectedExamMode=button.dataset.examMode;});
  $("#start-exam").onclick=startExam;$("#export-data").onclick=exportData;
  const dialog=$("#settings-dialog");const openSettings=()=>{$("#goal-input").value=state.dailyGoal;$("#exam-date-input").value=state.examDate;dialog.showModal();};
  $("#open-settings").onclick=openSettings;$("#header-settings").onclick=openSettings;
  $("#save-settings").onclick=e=>{e.preventDefault();state.dailyGoal=Math.max(5,Math.min(100,Number($("#goal-input").value)||20));state.examDate=$("#exam-date-input").value||state.examDate;saveState();dialog.close();renderHome();toast("学习计划已更新");};
  const accountDialog=$("#account-dialog");
  $("#account-button").onclick=()=>{renderAccountUI();accountDialog.showModal();};
  $("#close-account").onclick=()=>accountDialog.close();
  $("#login-account").onclick=()=>authenticate("login");
  $("#register-account").onclick=()=>authenticate("register");
  $("#sync-now").onclick=()=>syncProgress();
  $("#logout-account").onclick=()=>logoutAccount();
  $("#save-feedback").onclick=event=>{event.preventDefault();const question=QUESTIONS.find(q=>q.id===feedbackQuestionId);if(!question)return;state.feedback.push({id:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${question.id}`,questionId:question.id,reason:$("#feedback-reason").value,note:$("#feedback-note").value.trim(),createdAt:new Date().toISOString(),status:"pending"});saveState();$("#feedback-dialog").close();toast("题目反馈已进入本机审核中心");};
  await restoreSession();
  const directQuestionId = new URLSearchParams(location.search).get("question");
  const directQuestion = QUESTIONS.find(question => question.id === directQuestionId);
  if (directQuestion) {
    switchView("practice");
    startQuiz({questions: [directQuestion], mode: "direct"});
  }
  await serviceWorkerUpdate;
}
init().catch(error=>{
  console.error(error);
  document.body.innerHTML=`<main class="main"><div class="empty-state"><span>!</span><b>题库暂时无法加载</b><p>${error.message}</p><button class="primary-button" onclick="location.reload()">重新加载</button></div></main>`;
});
