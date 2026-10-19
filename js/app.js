import * as db from "./db.js";

const ROUTES = {
  today: { label: "วันนี้", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', load: () => import("./views/today.js") },
  cards: { label: "บัตรคำ", icon: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v10"/>', load: () => import("./views/cards.js") },
  train: { label: "ฝึก", icon: '<path d="M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>', load: () => import("./views/train.js") },
  journal: { hidden: true, navGroup: "train", label: "Journal", icon: "", load: () => import("./views/journal.js") },
  interleave: { hidden: true, navGroup: "train", label: "คละโจทย์", icon: "", load: () => import("./views/interleave.js") },
  exam: { hidden: true, navGroup: "train", label: "สอบจับเวลา", icon: "", load: () => import("./views/exam.js") },
  reading: { hidden: true, navGroup: "train", label: "ตัวเช็ก i+1", icon: "", load: () => import("./views/reading.js") },
  shadowing: { hidden: true, navGroup: "train", label: "Shadowing", icon: "", load: () => import("./views/shadowing.js") },
  write: { hidden: true, navGroup: "train", label: "เขียน", icon: "", load: () => import("./views/write.js") },
  roadmap: { label: "Roadmap", icon: '<path d="M4 19c4-1 3-6 8-6s4-6 8-7"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="6" r="1.5"/>', load: () => import("./views/roadmap.js") },
  techniques: { more: true, label: "เทคนิค", icon: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>', load: () => import("./views/techniques.js") },
  word: { hidden: true, navGroup: "library", label: "คำ", icon: "", load: () => import("./views/word.js") },
  dashboard: { more: true, label: "สถิติ", icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', load: () => import("./views/dashboard.js") },
  graph: { more: true, label: "กราฟคำ", icon: '<circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M8 8l3 8M16.5 8l-3.5 8M8.2 7h7.6"/>', load: () => import("./views/graph.js") },
  library: { more: true, label: "คลังคำ", icon: '<path d="M4 4h5v16H4zM11 4h5v16h-5zM18 6l3 .8-3.6 13.2-3-.8z"/>', load: () => import("./views/library.js") },
  errors: { more: true, label: "Error Log", icon: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.01"/>', load: () => import("./views/errors.js") },
  onboarding: { hidden: true, label: "Onboarding", icon: "", load: () => import("./views/onboarding.js") },
  settings: { more: true, label: "ตั้งค่า", icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>', load: () => import("./views/settings.js") },
};
const DEFAULT_ROUTE = "today";

const SYNC = {
  synced: { text: "ซิงก์แล้ว", icon: '<path d="M20 6 9 17l-5-5"/>' },
  pending: { text: "รอส่ง", icon: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>' },
  offline: { text: "ออฟไลน์", icon: '<path d="M2 2l20 20"/><path d="M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5-2.7M2 8.8a15 15 0 0 1 4.2-2.6M12 20h.01"/>' },
};

const root = document.getElementById("root");
const toastEl = document.getElementById("toast");
let toastTimer;
export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
}
db.onError((e) => toast(`บันทึกไม่สำเร็จ: ${e.code || e.message}`));

const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;

// ---------- หน้าก่อนล็อกอิน ----------
function renderAuthScreen(state, error) {
  shell = null;
  const wrap = document.createElement("main");
  wrap.className = "auth-screen";
  const card = document.createElement("div");
  card.className = "card auth-card";
  card.innerHTML = `<h1>Eng<span>Path</span></h1>`;
  const p = document.createElement("p");
  p.className = "muted";
  card.append(p);

  if (state === "loading") {
    p.textContent = "กำลังโหลด…";
  } else if (state === "unconfigured") {
    p.textContent = "ยังไม่ได้ตั้งค่า Firebase";
    const n = document.createElement("div");
    n.className = "notice";
    n.innerHTML = "คัดลอก <code>js/firebase-config.example.js</code> เป็น <code>js/firebase-config.js</code> แล้วกรอกค่าจาก Firebase Console (ดูขั้นตอนใน README.md)";
    card.append(n);
  } else if (state === "error") {
    p.textContent = "เกิดข้อผิดพลาด";
    const n = document.createElement("div");
    n.className = "notice notice--bad";
    n.textContent = (error && (error.code || error.message)) || "ไม่ทราบสาเหตุ (ถ้าเปิดแอปครั้งแรกขณะออฟไลน์ ต้องต่อเน็ตก่อน 1 ครั้ง)";
    card.append(n);
    card.append(signInButton());
  } else {
    p.textContent = "โค้ชเดินตาม Roadmap ภาษาอังกฤษ A1 → C1";
    card.append(signInButton());
  }
  wrap.append(card);
  root.replaceChildren(wrap);
}

function signInButton() {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = "ล็อกอินด้วย Google";
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await db.signIn(); } catch (e) { toast(`ล็อกอินไม่สำเร็จ: ${e.code || e.message}`); }
    b.disabled = false;
  });
  return b;
}

// ---------- shell หลังล็อกอิน ----------
let shell = null;
let cleanup = null;
let renderToken = 0;

function buildShell() {
  const app = document.createElement("div");
  app.className = "app";
  const visible = Object.entries(ROUTES).filter(([, r]) => !r.hidden);
  const link = ([k, r], cls = "") => `<a href="#/${k}" data-route="${k}"${cls ? ` class="${cls}"` : ""}>${svg(r.icon)}<span>${r.label}</span></a>`;
  const nav = visible.map((e) => link(e, e[1].more ? "more-item" : "")).join("")
    + `<button type="button" class="more-btn" id="more-btn" aria-expanded="false" aria-controls="more-sheet">${svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>')}<span>เพิ่มเติม</span></button>`;
  const sheet = visible.filter(([, r]) => r.more).map((e) => link(e)).join("");
  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand">Eng<span>Path</span></div>
      <nav class="nav" aria-label="เมนูหลัก">${nav}</nav>
      <div class="more-sheet" id="more-sheet" hidden>${sheet}</div>
    </aside>
    <div class="content">
      <header class="topbar"><div class="sync" id="sync" role="status"></div></header>
      <main class="main" id="view"></main>
    </div>`;
  root.replaceChildren(app);
  shell = { app, view: app.querySelector("#view"), sync: app.querySelector("#sync"), moreBtn: app.querySelector("#more-btn"), sheet: app.querySelector("#more-sheet") };
  // แผง "เพิ่มเติม" (มือถือ): เปิด/ปิดด้วยปุ่ม, คลิกนอกแผง หรือกด Esc
  const setSheet = (open) => { shell.sheet.hidden = !open; shell.moreBtn.setAttribute("aria-expanded", String(open)); };
  shell.closeSheet = () => setSheet(false);
  shell.moreBtn.addEventListener("click", (e) => { e.stopPropagation(); setSheet(shell.sheet.hidden); });
  document.addEventListener("click", (e) => { if (!shell.sheet.hidden && !shell.sheet.contains(e.target)) setSheet(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setSheet(false); });
  db.onSync(updateSync);
}

function updateSync(status) {
  if (!shell) return;
  const s = SYNC[status];
  shell.sync.dataset.state = status;
  shell.sync.innerHTML = `${svg(s.icon)}<span class="mono">${s.text}</span>`;
  shell.sync.title = s.text;
}

async function route() {
  if (!shell) return;
  const [key, ...rest] = (location.hash.replace(/^#\//, "") || DEFAULT_ROUTE).split("/");
  let param = "";
  try { param = decodeURIComponent(rest.join("/")); } catch { param = rest.join("/"); }
  const r = ROUTES[key] || ROUTES[DEFAULT_ROUTE];
  const name = ROUTES[key] ? key : DEFAULT_ROUTE;
  const navKey = r.navGroup || name;
  shell.app.querySelectorAll("[data-route]").forEach((a) =>
    a.dataset.route === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  shell.moreBtn.toggleAttribute("data-current", Boolean(ROUTES[navKey]?.more));
  shell.closeSheet();
  const token = ++renderToken;
  if (cleanup) { cleanup(); cleanup = null; }
  const mod = await r.load();
  if (token !== renderToken) return;
  shell.view.replaceChildren();
  cleanup = mod.render(shell.view, { toast, param }) || null;
}
window.addEventListener("hashchange", route);

// ---------- เริ่มต้น ----------
let onboardingChecked = false;

/** หลังล็อกอิน: รอข้อมูลชุดแรกซิงก์ก่อน แล้วค่อยตัดสินใจว่าต้องพาไป Onboarding ไหม (ครั้งเดียวต่อรอบการใช้งาน) */
async function startRoute() {
  const token = ++renderToken;
  shell.view.textContent = "กำลังโหลดข้อมูล…";
  await db.whenReady();
  if (token !== renderToken) return;
  import("./statsync.js").then((m) => m.startStatsSync()).catch(console.error);   // dailyStats: สร้างย้อนหลัง/อัปเดตเมื่อมี event ใหม่
  if (!onboardingChecked) {
    onboardingChecked = true;
    if (!db.getSettings().onboarding && location.hash !== "#/onboarding") {
      location.hash = "#/onboarding";      // เรียก route() ผ่าน hashchange
      return;
    }
  }
  route();
}

db.initAuth((state, user, error) => {
  if (state === "signedIn") {
    if (!shell) buildShell();
    startRoute();
  } else {
    if (cleanup) { cleanup(); cleanup = null; }
    renderAuthScreen(state, error);
  }
});

if ("serviceWorker" in navigator) {
  // sw.js จะถูกเพิ่มในส่วน PWA; ถ้ายังไม่มีไฟล์ จะไม่ทำอะไร
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
