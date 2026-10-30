const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class FakeResponse {
  constructor(body, {ok = true, status = 200, type = "basic"} = {}) {
    this.body = body;
    this.ok = ok;
    this.status = status;
    this.type = type;
  }
  clone() { return new FakeResponse(this.body, {ok: this.ok, status: this.status, type: this.type}); }
  async text() { return this.body; }
}

class FakeRequest {
  constructor(url, {method = "GET", mode = "same-origin"} = {}) {
    this.url = new URL(url, "https://exam.jerrists.cloud/").href;
    this.method = method;
    this.mode = mode;
  }
}

const listeners = {};
const entries = new Map();
const deletedCaches = [];
const cacheKey = value => new URL(typeof value === "string" ? value : value.url, "https://exam.jerrists.cloud/").href;
const cache = {
  async put(key, value) { entries.set(cacheKey(key), value); },
  async match(key) { return entries.get(cacheKey(key)); }
};
const caches = {
  async open() { return cache; },
  async keys() { return ["jingtu-v3", "jingtu-v4", "unrelated-cache"]; },
  async delete(key) { deletedCaches.push(key); return true; },
  async match(key) { return cache.match(key); }
};

let fetchHandler = async () => new FakeResponse("network");
let lastFetchOptions = null;
const context = {
  URL,
  Request: FakeRequest,
  caches,
  console,
  fetch: async (request, options) => {
    lastFetchOptions = options;
    return fetchHandler(request, options);
  },
  self: {
    location: {origin: "https://exam.jerrists.cloud"},
    clients: {async claim() {}},
    async skipWaiting() {},
    addEventListener(name, handler) { listeners[name] = handler; }
  }
};

const source = fs.readFileSync(path.join(__dirname, "..", "dist", "service-worker.js"), "utf8");
vm.runInNewContext(source, context, {filename: "service-worker.js"});

function fetchEvent(request) {
  return {
    request,
    response: null,
    respondWith(value) { this.response = Promise.resolve(value); }
  };
}

(async () => {
  const apiEvent = fetchEvent(new FakeRequest("/api/progress"));
  listeners.fetch(apiEvent);
  assert.strictEqual(apiEvent.response, null, "API GET must bypass the service worker");

  const apiPostEvent = fetchEvent(new FakeRequest("/api/progress", {method: "PUT"}));
  listeners.fetch(apiPostEvent);
  assert.strictEqual(apiPostEvent.response, null, "API writes must bypass the service worker");

  fetchHandler = async () => new FakeResponse("fresh-bank");
  const bankRequest = new FakeRequest("/data/questions.json");
  const bankEvent = fetchEvent(bankRequest);
  listeners.fetch(bankEvent);
  assert.strictEqual(await (await bankEvent.response).text(), "fresh-bank");
  assert.strictEqual(lastFetchOptions.cache, "no-cache", "online requests must revalidate");
  assert.strictEqual(await (await caches.match(bankRequest)).text(), "fresh-bank", "fresh bank must become offline fallback");

  entries.set(cacheKey("/data/questions.json"), new FakeResponse("offline-bank"));
  fetchHandler = async () => { throw new Error("offline"); };
  const offlineEvent = fetchEvent(bankRequest);
  listeners.fetch(offlineEvent);
  assert.strictEqual(await (await offlineEvent.response).text(), "offline-bank", "offline requests must use cached bank");

  entries.set(cacheKey("index.html"), new FakeResponse("offline-shell"));
  const navigationEvent = fetchEvent(new FakeRequest("/practice", {mode: "navigate"}));
  listeners.fetch(navigationEvent);
  assert.strictEqual(await (await navigationEvent.response).text(), "offline-shell", "offline navigation must use app shell");

  let activation = null;
  listeners.activate({waitUntil(value) { activation = Promise.resolve(value); }});
  await activation;
  assert.deepStrictEqual(deletedCaches, ["jingtu-v3"], "activation must remove the stale cache");

  console.log("Service worker cache policy tests passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
