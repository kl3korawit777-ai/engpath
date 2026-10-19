import * as db from "../db.js";
import * as srs from "../srs.js";
import * as timer from "../timer.js";
import * as errlog from "../errlog.js";
import * as streak from "../streak.js";
import * as rl from "../roadmap-logic.js";
import * as practice from "../practice.js";
import * as ts from "../techscore.js";
import { setErrorsTab } from "../scope.js";
import { h } from "../dom.js";

// ลิงก์ "ไปที่" ของแต่ละช่วงเวลา (เฉพาะช่วงที่มีหน้าฝึกรองรับ)
const SEG_LINKS = {
  input: [{ text: "ตัวเช็ก i+1", href: "#/reading" }, { text: "Shadowing", href: "#/shadowing" }],
  weak: [{ text: "คละโจทย์", href: "#/interleave" }, { text: "ฝึกเจาะจุด", href: "#/errors" }],
  output: [{ text: "Shadowing", href: "#/shadowing" }, { text: "เขียนมือ", href: "#/write" }, { text: "Journal", href: "#/journal" }],
};

// ---- สถานะตัวจับเวลา อยู่ระดับ module เพื่อให้เดินต่อแม้ไปหน้าอื่น ----
let T = null;
let ticker = null;
const listeners = new Set();           // (kind: "tick" | "change") => void

const emit = (kind) => listeners.forEach((f) => f(kind));

function apply(res) {
  T = res.t;
  for (const s of res.slices) {
    try { db.append("sessions", s); } catch (e) { console.error("บันทึก session ไม่สำเร็จ", e); }
  }
  ensureTicker();
  emit("change");
}

function ensureTicker() {
  if (ticker || !T || !timer.isRunning(T)) return;
  ticker = setInterval(() => {
    if (!timer.isRunning(T)) { clearInterval(ticker); ticker = null; return; }
    const r = timer.tick(T, Date.now());
    if (r.t !== T) apply(r); else emit("tick");
  }, 250);
}

// กลับมาจากแท็บ/แอปอื่น → ตรวจทันทีโดยไม่รอ interval
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && T && timer.isRunning(T)) {
    const r = timer.tick(T, Date.now());
    if (r.t !== T) apply(r); else emit("tick");
  }
});
// ปิดแท็บขณะเดิน: บันทึกช่วงที่เดินไว้ให้ดีที่สุด
window.addEventListener("pagehide", () => { if (T && timer.isRunning(T)) apply(timer.pause(T, Date.now())); });

const pristine = (t) => !timer.isRunning(t) && t.idx === 0 && t.elapsed === 0 && !t.done;

export function render(root) {
  const fmtDate = new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const stageOf = () => db.getSettings().stage;
  const dailyOf = () => db.getSettings().dailyMinutes;
  const planNow = (stage = stageOf()) => timer.planFor(stage, dailyOf());
  const samePlan = (t) => t.stage === stageOf() && t.plan.join() === planNow().join();
  if (!T || (!samePlan(T) && pristine(T))) T = timer.create(stageOf(), planNow());   // ขั้น/เวลาต่อวันถูกเปลี่ยน (เช่น จากเครื่องอื่น)

  const clock = h("div", { class: "clock mono", "aria-live": "off" });
  const bar = h("div", { class: "progress" }, h("i"));
  const minutesEl = h("div", { class: "big-num" });
  const dueEl = h("div", { class: "big-num" });
  const focusEl = h("div");
  const cpEl = h("div");
  const challengeEl = h("div");
  const streakEl = h("div", { class: "big-num" });
  const heatEl = h("div");
  const body = h("div");
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "วันนี้" }), h("p", { class: "muted", text: fmtDate })),
    body
  );

  function drawAll() {
    const stage = T.stage;
    const plan = T.plan;
    const running = timer.isRunning(T);

    const stageRow = h("div", { class: "row", role: "group", "aria-label": "ขั้นปัจจุบัน" },
      ...[0, 1, 2, 3, 4, 5].map((n) => h("button", {
        class: `btn ${n === stage ? "" : "btn--secondary"}`, type: "button", text: `ขั้น ${n}`, "aria-pressed": String(n === stage),
        onclick: () => {
          if (n === T.stage) return;
          if (!pristine(T) && !confirm("เปลี่ยนขั้นจะเริ่มตัวจับเวลาใหม่ ต้องการเปลี่ยนไหม?")) return;
          db.saveSettings({ stage: n });
          apply(timer.reset(T, Date.now(), n, planNow(n)));
        },
      })));

    const segs = h("ol", { class: "segs" }, ...timer.SEGMENTS.map((s, i) => {
      const state = T.done || i < T.idx ? "เสร็จ" : i === T.idx ? (running ? "กำลังทำ" : "ถึงคิว") : "รอ";
      return h("li", { class: `seg ${i === T.idx && !T.done ? "seg--now" : ""}`, style: `--c:${s.color}` },
        h("i", { class: "seg__dot" }), h("span", { text: s.label }),
        h("span", { class: "mono muted", text: `${plan[i]} นาที` }), h("span", { class: "mono seg__state", text: state }),
        SEG_LINKS[s.key] ? h("span", { class: "seg__go" }, h("span", { class: "muted", text: "ไปที่" }), ...SEG_LINKS[s.key].map((l) => h("a", { class: "btn btn--secondary btn--chip", href: l.href, text: l.text }))) : null);
    }));

    const controls = T.done
      ? h("div", { class: "row" }, h("p", { text: "ครบทั้ง 4 ช่วงแล้ว 🎉" }), h("button", { class: "btn", type: "button", text: "เริ่มใหม่", onclick: () => apply(timer.reset(T, Date.now())) }))
      : h("div", { class: "row" },
          h("button", { class: "btn", type: "button", text: running ? "พัก" : (T.elapsed > 0 ? "เริ่มต่อ" : "เริ่ม"),
            onclick: () => apply(running ? timer.pause(T, Date.now()) : timer.start(T, Date.now())) }),
          h("button", { class: "btn btn--secondary", type: "button", text: "ข้ามช่วง", onclick: () => apply(timer.skip(T, Date.now())) }),
          h("button", { class: "btn btn--secondary", type: "button", text: "เริ่มใหม่", onclick: () => {
            if (!pristine(T) && !confirm("เริ่มตัวจับเวลาใหม่ตั้งแต่ช่วงแรก?")) return;
            apply(timer.reset(T, Date.now()));
          } }));

    const label = T.done ? "จบแล้ว" : timer.SEGMENTS[T.idx].label;
    body.replaceChildren(
      cpEl, challengeEl,
      h("section", { class: "card stack" }, h("h2", { text: "ขั้นปัจจุบัน" }), stageRow),
      h("section", { class: "card stack timer", style: T.done ? "" : `--c:${timer.SEGMENTS[T.idx].color}` },
        h("div", { class: "row" }, h("h2", { text: label }), h("span", { class: "badge", text: `ขั้น ${stage}` })),
        clock, bar, controls, segs),
      h("div", { class: "grid2" },
        h("a", { class: "card statcard", href: "#/cards" }, dueEl, h("div", { class: "muted", text: "บัตรคำถึงรอบ" })),
        h("section", { class: "card statcard" }, minutesEl, h("div", { class: "muted", text: `นาทีวันนี้ (เป้า ${dailyOf()})` })),
        h("section", { class: "card statcard" }, streakEl, h("div", { class: "muted", text: "Streak (วันติดต่อกัน)" }))),
      h("section", { class: "card stack" }, h("h2", { text: "12 สัปดาห์ที่ผ่านมา" }), heatEl),
      h("a", { class: "card statcard", href: "#/errors", style: "display:grid", onclick: () => setErrorsTab("practice") }, h("h2", { text: "จุดเน้นสัปดาห์" }), focusEl)
    );
    updateClock();
    updateStats();
    updateCheckpoint();
    updateChallenge();
  }

  // มินิชาเลนจ์: เลือกจากเทคนิคที่ใช้น้อยที่สุดใน 7 วันล่าสุด (นับจาก dailyStats)
  function updateChallenge() {
    const map = new Map(db.list("dailyStats").map((d) => [d.id, d]));
    const c = map.size ? ts.miniChallenge({ map, now: Date.now() }) : null;
    challengeEl.replaceChildren(...(c ? [h("section", { class: `card stack challenge ${c.done ? "is-done" : ""}`, id: "mini-challenge" },
      h("div", { class: "row" }, h("h2", { text: "มินิชาเลนจ์วันนี้" }), h("span", { class: "badge", text: `เทคนิค ${c.id} ${c.name}` })),
      h("p", { text: c.text }),
      h("p", { class: c.done ? "good" : "muted mono", text: c.done ? `ทำครบแล้ว ✓ (${c.count}/${c.goal})` : `วันนี้ ${c.count}/${c.goal} · เลือกเพราะ 7 วันที่ผ่านมาใช้เทคนิคนี้น้อยที่สุด (${c.weekScore}% ของเป้า)` }),
      c.href ? h("a", { class: "btn btn--secondary", href: c.href, text: c.done ? "ทำต่อ" : "ไปทำเลย", onclick: () => { if (c.errorsTab) setErrorsTab(c.errorsTab); } }) : null)] : []));
  }

  function updateCheckpoint() {
    const st = db.getSettings();
    const s = rl.checkpointStatus({ checkpoints: db.list("checkpoints").filter(rl.isValidCheckpoint), onboarding: st.onboarding, weeks: st.checkpointWeeks, now: Date.now() });
    cpEl.replaceChildren(...(s.due ? [h("a", { class: "card notice-card", href: "#/roadmap" }, h("strong", { text: "ถึงรอบ checkpoint แล้ว" }), h("span", { class: "muted", text: `  ครบ ${st.checkpointWeeks} สัปดาห์ — วัดผลและดูว่าผ่านขั้นนี้หรือยัง` }))] : []));
  }

  function updateClock() {
    const now = Date.now();
    const rem = timer.remaining(T, now);
    clock.textContent = timer.formatClock(rem);
    const total = T.done ? 1 : T.plan[T.idx] * 60000;
    bar.firstChild.style.width = `${T.done ? 100 : Math.min(100, ((total - rem) / total) * 100)}%`;
    updateMinutes();
  }

  function updateMinutes() {
    // นาทีวันนี้ = sessions ที่บันทึกแล้ว + ช่วงที่กำลังเดิน (แสดงสด)
    const live = timer.isRunning(T) ? [{ start: T.runStart, durationSec: Math.max(0, (Date.now() - T.runStart) / 1000) }] : [];
    const mins = timer.minutesOnDay([...db.list("sessions"), ...live], Date.now());
    minutesEl.replaceChildren(h("span", { text: String(Math.floor(mins)) }), h("span", { class: "muted", text: ` / ${dailyOf()}` }));
  }

  function updateStats() {
    const cards = db.list("cards");
    const states = srs.stateMap(cards, db.list("reviews"));
    const now = Date.now();
    dueEl.replaceChildren(h("span", { text: String(cards.filter((c) => srs.isDue(states.get(c.id), now)).length) }));
    const counts = streak.activityCounts(db.list("sessions"), db.list("reviews"));
    const n = streak.currentStreak(counts, now);
    streakEl.replaceChildren(h("span", { text: String(n) }), h("span", { class: "muted", text: " วัน" }));
    const weeks = streak.heatmap(counts, now);
    heatEl.replaceChildren(
      h("div", { class: "heat", role: "img", "aria-label": `กิจกรรม 12 สัปดาห์ล่าสุด มี ${[...counts.keys()].length} วันที่ใช้งาน` },
        ...weeks.flat().map((d) => h("i", { class: `heat__c l${d.level} ${d.future ? "is-future" : ""} ${d.today ? "is-today" : ""}`, title: d.future ? "" : `${d.key}: ${d.count} รายการ` }))),
      h("div", { class: "row muted mono heat__legend" }, "น้อย", ...[0, 1, 2, 3, 4].map((l) => h("i", { class: `heat__c l${l}` })), "มาก"));
    const focus = practice.focusErrors({ errors: db.list("errors"), events: db.list("errorEvents"), focus: db.getSettings().focus, now }).items;
    focusEl.replaceChildren(focus.length
      ? h("ol", { class: "focus-list" }, ...focus.map((f) => h("li", {}, h("s", { class: "bad", text: f.error.wrong }), " → ", h("strong", { text: f.error.right }), h("span", { class: "mono muted", text: `  ×${f.count} ใน 30 วัน` }))))
      : h("p", { class: "muted", text: "ยังไม่มีข้อผิดที่ยังไม่แก้ใน 30 วันนี้" }));
    updateMinutes();
  }

  const onTimer = (kind) => (kind === "tick" ? updateClock() : drawAll());
  listeners.add(onTimer);
  const unsub = db.subscribe(() => {
    if (pristine(T) && !samePlan(T)) T = timer.create(stageOf(), planNow());
    if (!samePlan(T) && !pristine(T)) { updateStats(); return; }
    drawAll();
  });
  drawAll();
  return () => { listeners.delete(onTimer); unsub(); };
}
