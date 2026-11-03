const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const bank = JSON.parse(fs.readFileSync(path.join(root, "dist", "data", "questions.json"), "utf8"));
const appSource = fs.readFileSync(path.join(root, "dist", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "dist", "styles.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "dist", "service-worker.js"), "utf8");

for (const id of ["mother-300-q035", "mother-300-q036"]) {
  const question = bank.questions.find((item) => item.id === id);
  assert(question, `${id} must exist in exported bank`);
  assert.strictEqual(question.media.length, 1, `${id} must have one media item`);
  const media = question.media[0];
  assert.strictEqual(media.kind, "image");
  assert.strictEqual(media.placement, "stem");
  assert(media.alt, `${id} image must have alt text`);
  assert(fs.existsSync(path.join(root, "dist", media.src)), `${id} image file must exist`);
  assert(serviceWorker.includes(`"${media.src}"`), `${id} image must be available offline`);
}

assert(appSource.includes("function renderQuestionMedia"), "app must define the media renderer");
assert(appSource.includes('renderQuestionMedia(q, "stem")'), "quiz and exam views must render stem media");
assert(appSource.includes("new URLSearchParams(location.search).get(\"question\")"), "direct question preview must be available");
assert(styles.includes(".question-media img"), "media must have responsive image styles");
console.log("Question media integration tests passed");
