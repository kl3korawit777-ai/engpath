// Service worker: cache app shell แบบมีเวอร์ชัน + cache ฟอนต์/Firebase SDK ตอนใช้งานจริง
// เปลี่ยน VERSION ทุกครั้งที่ deploy ไฟล์ในรายการ SHELL เพื่อให้เครื่องผู้ใช้ดึงชุดใหม่
const VERSION = "v23";
const SHELL_CACHE = `engpath-shell-${VERSION}`;
const RUNTIME_CACHE = `engpath-runtime-${VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "manifest.json",
  "css/tokens.css",
  "css/app.css",
  "js/app.js",
  "js/db.js",
  "js/dom.js",
  "js/srs.js",
  "js/timer.js",
  "js/streak.js",
  "js/errlog.js",
  "js/backup.js",
  "js/lexicon.js",
  "js/library.js",
  "js/roadmap-logic.js",
  "js/practice.js",
  "js/activity.js",
  "js/clips.js",
  "js/reading.js",
  "js/journal.js",
  "js/links.js",
  "js/graph.js",
  "js/exam.js",
  "js/interleave.js",
  "js/version.js",
  "js/stats.js",
  "js/techscore.js",
  "js/data/technique-config.js",
  "js/statsync.js",
  "js/dashboardlogic.js",
  "vendor/chart-4.5.1.umd.js",
  "js/vault.js",
  "js/vaultexport.js",
  "vendor/jszip-3.10.2.min.js",
  "js/graphui.js",
  "js/layout.js",
  "js/layout-worker.js",
  "vendor/cytoscape-3.34.4.esm.min.mjs",
  "js/wordlookup.js",
  "js/speech.js",
  "js/recordings.js",
  "js/player.js",
  "js/handwriting-core.js",
  "js/handwriting-render.js",
  "js/handwriting-pad.js",
  "js/data/roadmap.js",
  "js/data/techniques.js",
  "js/data/handwriting-config.js",
  "js/scope.js",
  "js/data/lexicon-config.js",
  "js/data/reading-config.js",
  "js/localsettings.js",
  "js/views/today.js",
  "js/views/cards.js",
  "js/views/addword.js",
  "js/views/library.js",
  "js/views/roadmap.js",
  "js/views/practice.js",
  "js/views/train.js",
  "js/views/write.js",
  "js/views/shadowing.js",
  "js/views/reading.js",
  "js/views/journal.js",
  "js/views/word.js",
  "js/views/graph.js",
  "js/views/exam.js",
  "js/views/interleave.js",
  "js/views/dashboard.js",
  "js/views/techniques.js",
  "js/views/onboarding.js",
  "js/views/errors.js",
  "js/views/settings.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

// ต้นทางข้ามโดเมนที่ cache ได้ (ไฟล์ SDK มีเลขเวอร์ชันใน URL, ฟอนต์เปลี่ยนน้อย)
const isCacheableCrossOrigin = (url) =>
  (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) ||
  url.hostname === "fonts.googleapis.com" ||
  url.hostname === "fonts.gstatic.com";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, RUNTIME_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const storable = (res) => res && (res.ok || res.type === "opaque");

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  // cache: "no-cache" = ตรวจกับเซิร์ฟเวอร์ทุกครั้ง ไม่ใช้ HTTP cache ของเบราว์เซอร์ (กันได้ไฟล์เก่าค้างเข้า cache ของ SW)
  const network = fetch(request, { cache: "no-cache" }).then((res) => { if (storable(res)) cache.put(request, res.clone()); return res; });
  if (cached) { network.catch(() => {}); return cached; }
  return network;
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (storable(res)) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request).catch(() => caches.match("index.html", { cacheName: SHELL_CACHE }))
      );
      return;
    }
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }
  if (isCacheableCrossOrigin(url)) { event.respondWith(cacheFirst(request)); return; }
  // อย่างอื่น (Firestore, Auth, Google APIs) ปล่อยผ่าน ไม่แตะ
});
