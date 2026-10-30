const CACHE = "jingtu-v5";
const PRECACHE = [
  "./",
  "index.html",
  "styles.css",
  "data/questions.json",
  "app.js",
  "manifest.webmanifest",
  "icon.svg",
  "version.json"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async asset => {
      const response = await fetch(asset, {cache: "reload"});
      if (!response.ok) throw new Error(`预缓存失败: ${asset}`);
      await cache.put(asset, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("jingtu-") && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, {cache: "no-cache"});
    if (response.ok && response.type !== "opaque") {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await caches.match("index.html") || await caches.match("./");
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener("fetch", event => {
  const {request} = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 账号、会话和学习进度必须始终直连服务器，绝不进入 Cache Storage。
  if (url.pathname.startsWith("/api/")) return;

  // 页面、题库和静态资源在线时向服务器确认版本，离线时才使用缓存。
  event.respondWith(networkFirst(request));
});
