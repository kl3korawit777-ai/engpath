// สอบจับเวลา: คลังข้อสอบ (ผู้ใช้นำเข้าเอง) · ตั้งค่า/preset · ทำข้อสอบจับเวลา · ทบทวนข้อผิด · ประวัติ
import * as db from "../db.js";
import * as ex from "../exam.js";
import * as el from "../errlog.js";
import { findExistingError } from "../journal.js";
import { splitSentences } from "../clips.js";
import { tokenize } from "../reading.js";
import { wordKey } from "../lexicon.js";
import { setAddWordPrefill } from "../scope.js";
import { h } from "../dom.js";

// ข้อสอบที่กำลังทำอยู่คงไว้ระดับ module: ออกไปหน้าอื่นแล้วกลับมาทำต่อได้ (เวลานับจากนาฬิกาจริง จึงเดินต่อและหมดเวลาได้ตามจริง)
let live = null;

const fmtDate = (ts) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
const download = (name, text, type) => {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export function render(root, { toast }) {
  let tab = "take";
  let view = "main";                 // main | run | result
  let result = null;                 // { attempt, snap: Map qid → item }
  let importReport = null;
  let editing = null;                // null | "new" | question id
  let filter = { q: "", set: "", section: "" };
  let reviewAll = false;
  const added = new Set();           // `${attemptKey}|${qid}` ที่ส่งเข้า Error Log แล้ว (ในหน้านี้)
  const cfg = { name: "", presetId: "", setName: "", sections: new Set(), count: 20, minutes: 30, targetPercent: "" };
  let tick = null;

  const body = h("div", { class: "stack" });
  root.replaceChildren(h("div", { class: "page-head" }, h("h1", { text: "สอบจับเวลา" }), h("p", { class: "muted", text: "ทำข้อสอบจากคลังที่คุณนำเข้าเอง — จับเวลา ปักธง ส่งอัตโนมัติเมื่อหมดเวลา แล้วทบทวนข้อผิด" })), body);

  const questions = () => db.list("questions");
  const cfgObj = () => ({ name: cfg.name.trim(), presetId: cfg.presetId, setName: cfg.setName, sections: [...cfg.sections], count: Number(cfg.count), minutes: Number(cfg.minutes), targetPercent: cfg.targetPercent === "" ? null : Number(cfg.targetPercent) });

  function draw() {
    if (view === "run") return drawRun();
    if (view === "result") return drawResult();
    const tabs = h("div", { class: "row tabs" }, ...[["take", "ทำข้อสอบ"], ["bank", "คลังข้อสอบ"], ["history", "ประวัติ"]].map(([k, label]) =>
      h("button", { class: `btn ${tab === k ? "" : "btn--secondary"}`, type: "button", text: label, "aria-pressed": String(tab === k), onclick: () => { tab = k; draw(); } })));
    body.replaceChildren(tabs, tab === "take" ? takeTab() : tab === "bank" ? bankTab() : historyTab());
  }

  // ================= ทำข้อสอบ: ตั้งค่า =================
  function takeTab() {
    const qs = questions();
    const sets = [...new Set(qs.map((q) => q.setName).filter(Boolean))].sort();
    const avail = ex.matchingQuestions(qs, cfgObj());
    const presets = db.list("examSets").sort((a, b) => a.name.localeCompare(b.name));
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    const num = (key, label, min, max, hint) => h("label", { class: "field" }, h("span", { text: label }),
      h("input", { class: "input", type: "number", inputmode: "numeric", min, max, value: cfg[key], oninput: (e) => { cfg[key] = e.target.value; }, onchange: draw }), hint ? h("small", { class: "muted", text: hint }) : null);

    const startBtn = h("button", { class: "btn", type: "button", disabled: !avail.length, text: "เริ่มสอบ", onclick: () => {
      const c = cfgObj(); const m = ex.validateConfig(c);
      if (m) { err.hidden = false; err.textContent = m; return; }
      startExam(c);
    } });

    return h("div", { class: "stack" },
      !qs.length ? h("div", { class: "notice", role: "status" }, "ยังไม่มีข้อสอบในคลัง — ไปแท็บ “คลังข้อสอบ” เพื่อเพิ่มทีละข้อ หรือนำเข้าไฟล์ CSV/JSON จากแหล่งที่คุณมีสิทธิ์ใช้") : null,
      live ? h("div", { class: "notice stack", role: "status" }, h("strong", { text: "มีข้อสอบที่ยังทำค้างอยู่" }), h("div", {}, h("button", { class: "btn", type: "button", text: "กลับไปทำต่อ", onclick: resume }))) : null,
      presets.length ? h("section", { class: "card stack" }, h("h2", { text: "Preset ของฉัน" }),
        h("ul", { class: "list" }, ...presets.map((p) => h("li", { class: "card-row" },
          h("div", { class: "card-row__main" }, h("strong", { text: p.name }), h("span", { class: "mono muted", text: `${p.count} ข้อ · ${p.minutes} นาที${p.targetPercent ? ` · เป้า ${p.targetPercent}%` : ""}${p.setName ? ` · ชุด ${p.setName}` : ""}${p.sections?.length ? ` · ${p.sections.map((s) => ex.SECTIONS[s]).join("/")}` : ""}` })),
          h("div", { class: "row" },
            h("button", { class: "btn btn--secondary", type: "button", text: "ใช้ preset นี้", onclick: () => { Object.assign(cfg, { name: p.name, presetId: p.id, setName: p.setName || "", sections: new Set(p.sections || []), count: p.count, minutes: p.minutes, targetPercent: p.targetPercent ?? "" }); draw(); } }),
            h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ลบ", onclick: () => { if (confirm(`ลบ preset “${p.name}”?`)) { db.softDelete("examSets", p.id); if (cfg.presetId === p.id) cfg.presetId = ""; } } })))))) : null,
      h("section", { class: "card stack" },
        h("h2", { text: "ตั้งค่าชุดสอบ" }),
        h("label", { class: "field" }, h("span", { text: "ชุดข้อสอบ" }),
          h("select", { class: "input select", "aria-label": "ชุดข้อสอบ", onchange: (e) => { cfg.setName = e.target.value; draw(); } }, h("option", { value: "", text: "ทุกชุด" }), ...sets.map((s) => h("option", { value: s, text: s, selected: s === cfg.setName })))),
        h("div", { class: "stack" }, h("strong", { text: "ส่วน (ไม่เลือก = ทุกส่วน)" }),
          h("div", { class: "row lib-chips" }, ...Object.entries(ex.SECTIONS).map(([k, label]) => h("button", { class: `btn btn--chip ${cfg.sections.has(k) ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(cfg.sections.has(k)), text: `${label} (${ex.matchingQuestions(qs, { setName: cfg.setName, sections: [k] }).length})`,
            onclick: () => { cfg.sections.has(k) ? cfg.sections.delete(k) : cfg.sections.add(k); draw(); } })))),
        h("div", { class: "grid2" }, num("count", "จำนวนข้อ", 1, ex.LIMITS.examMax), num("minutes", "เวลา (นาที)", 1, 600, "ตั้งเองตามรูปแบบข้อสอบที่คุณจะสอบ (เช่น TGAT1 / A-Level)"), num("targetPercent", "เป้าคะแนน % (ไม่บังคับ)", 1, 100, "ใช้ตรวจ “ถึงเป้า 2 ครั้งติด” ใน Roadmap ขั้น 4")),
        h("p", { class: "muted", text: `ในคลังตรงเงื่อนไข ${avail.length} ข้อ${avail.length && avail.length < Number(cfg.count) ? ` — จะได้ ${avail.length} ข้อ (น้อยกว่าที่ตั้ง)` : ""}` }),
        h("label", { class: "field" }, h("span", { text: "ชื่อ preset (ถ้าจะบันทึก)" }), h("input", { class: "input", value: cfg.name, placeholder: "เช่น A-Level ซ้อม 30 ข้อ", maxlength: "80", oninput: (e) => { cfg.name = e.target.value; } })),
        err,
        h("div", { class: "row" }, startBtn,
          h("button", { class: "btn btn--secondary", type: "button", text: cfg.presetId ? "อัปเดต preset" : "บันทึกเป็น preset", onclick: () => {
            const c = cfgObj(); const m = !c.name ? "ตั้งชื่อ preset ก่อน" : ex.validateConfig(c);
            if (m) { err.hidden = false; err.textContent = m; return; }
            const data = { name: c.name, setName: c.setName, sections: c.sections, count: c.count, minutes: c.minutes, targetPercent: c.targetPercent };
            if (cfg.presetId && db.get("examSets", cfg.presetId)) db.update("examSets", cfg.presetId, data); else cfg.presetId = db.create("examSets", data).id;
            toast("บันทึก preset แล้ว"); draw();
          } }))));
  }

  // ================= ทำข้อสอบ: ระหว่างสอบ =================
  function startExam(config) {
    const built = ex.buildExam(questions(), config);
    if (!built.items.length) { toast("ไม่มีข้อสอบตรงเงื่อนไข"); return; }
    const now = Date.now();
    live = { config, items: built.items, answers: Array(built.items.length).fill(null), flags: Array(built.items.length).fill(false), i: 0, startAt: now, limitSec: config.minutes * 60, tracker: ex.createTracker(built.items.length, now), submitted: false };
    resume();
  }

  function resume() {
    view = "run";
    drawRun();
    startTick();
  }

  function startTick() {
    clearInterval(tick);
    tick = setInterval(onTick, 500);
  }
  function onTick() {
    if (!live || view !== "run") return;
    const left = ex.remainingSec(live.startAt, live.limitSec, Date.now());
    const c = document.getElementById("exam-clock");
    if (c) { c.textContent = ex.clock(left); c.classList.toggle("is-low", left <= 60); }
    if (ex.isTimeUp(live.startAt, live.limitSec, Date.now())) submit(true);
  }
  const onVis = () => { if (document.visibilityState === "visible") onTick(); };
  document.addEventListener("visibilitychange", onVis);

  function go(i) {
    live.tracker = ex.enter(live.tracker, i, Date.now());
    live.i = i;
    drawRun();
  }

  function drawRun() {
    if (!live) { view = "main"; draw(); return; }
    const L = live, it = L.items[L.i];
    const answered = L.answers.filter((a) => a !== null).length;
    const left = ex.remainingSec(L.startAt, L.limitSec, Date.now());
    const palette = h("div", { class: "palette", role: "group", "aria-label": "รายการข้อ" }, ...L.items.map((_, k) => h("button", {
      class: `pal ${k === L.i ? "is-cur" : ""} ${L.answers[k] !== null ? "is-ans" : ""} ${L.flags[k] ? "is-flag" : ""}`, type: "button", "aria-label": `ข้อ ${k + 1}${L.answers[k] !== null ? " ตอบแล้ว" : ""}${L.flags[k] ? " ปักธง" : ""}`, "aria-current": k === L.i ? "true" : null, text: String(k + 1), onclick: () => go(k) })));
    body.replaceChildren(h("section", { class: "card stack exam" },
      h("div", { class: "row exam__bar" },
        h("div", { class: `exam__clock mono ${left <= 60 ? "is-low" : ""}`, id: "exam-clock", role: "timer", "aria-live": "off", text: ex.clock(left) }),
        h("span", { class: "badge", text: `ตอบแล้ว ${answered}/${L.items.length}` }),
        h("button", { class: "btn", type: "button", text: "ส่งข้อสอบ", onclick: () => submit(false) })),
      h("div", { class: "row" }, h("span", { class: "badge", text: `ข้อ ${L.i + 1}/${L.items.length}` }), h("span", { class: "badge", text: ex.SECTIONS[it.section] }), L.flags[L.i] ? h("span", { class: "badge", text: "🚩 ปักธง" }) : null),
      h("p", { class: "exam__q", text: it.question }),
      h("div", { class: "stack", role: "radiogroup", "aria-label": "ตัวเลือก" }, ...it.options.map((o, k) => h("button", {
        class: `btn btn--secondary btn--answer exam__opt ${L.answers[L.i] === o ? "is-sel" : ""}`, type: "button", role: "radio", "aria-checked": String(L.answers[L.i] === o),
        onclick: () => { L.answers[L.i] = L.answers[L.i] === o ? null : o; drawRun(); } }, h("span", { class: "mono", text: `${"ABCDEF"[k]}. ` }), o))),
      h("div", { class: "row" },
        h("button", { class: "btn btn--secondary", type: "button", disabled: L.i === 0, text: "← ก่อนหน้า", onclick: () => go(L.i - 1) }),
        h("button", { class: "btn btn--secondary", type: "button", disabled: L.i + 1 >= L.items.length, text: L.answers[L.i] === null ? "ข้าม →" : "ถัดไป →", onclick: () => go(L.i + 1) }),
        h("button", { class: `btn btn--secondary ${L.flags[L.i] ? "is-on" : ""}`, type: "button", "aria-pressed": String(L.flags[L.i]), text: L.flags[L.i] ? "เอาธงออก" : "🚩 ปักธง", onclick: () => { L.flags[L.i] = !L.flags[L.i]; drawRun(); } })),
      palette,
      h("small", { class: "muted", text: "ไม่แสดงเฉลยจนกว่าจะส่งข้อสอบ · เวลานับจากนาฬิกาจริง: ถ้าออกจากหน้านี้เวลายังเดินต่อ และถ้ากลับมาหลังหมดเวลาแอปจะส่งให้อัตโนมัติ (นับเฉพาะคำตอบที่ตอบไว้ก่อนหมดเวลา)" })));
  }

  function submit(auto) {
    const L = live;
    if (!L || L.submitted) return;
    if (!auto) {
      const unanswered = L.answers.filter((a) => a === null).length, flagged = L.flags.filter(Boolean).length;
      if (!confirm(`ส่งข้อสอบ?${unanswered ? `\nยังไม่ได้ตอบ ${unanswered} ข้อ (นับเป็นผิด)` : ""}${flagged ? `\nมี ${flagged} ข้อที่ปักธงไว้` : ""}`)) return;
    }
    L.submitted = true;
    clearInterval(tick);
    const end = auto ? Math.min(Date.now(), L.startAt + L.limitSec * 1000) : Date.now();
    const times = ex.finalize(L.tracker, end);
    const score = ex.scoreExam(L.items, L.answers, times, L.flags);
    const doc = ex.attemptDoc({ config: L.config, start: L.startAt, end, limitSec: L.limitSec, autoSubmitted: auto, score });
    let saved = doc;
    try { saved = db.append("examAttempts", doc); } catch (e) { console.error(e); toast("บันทึกผลสอบไม่สำเร็จ"); }
    try { db.append("sessions", { start: L.startAt, end, durationSec: Math.max(1, doc.durationSec), skill: "weak", stage: db.getSettings().stage }); } catch (e) { console.error(e); }
    result = { attempt: saved, snap: new Map(L.items.map((x) => [x.qid, x])) };
    live = null;
    reviewAll = false;
    view = "result";
    if (auto) toast("หมดเวลา — ส่งข้อสอบอัตโนมัติแล้ว");
    draw();
  }

  // ================= ผลสอบ + ทบทวน =================
  function itemOf(a) {
    const snap = result.snap.get(a.qid);
    if (snap) return snap;
    const q = db.get("questions", a.qid);
    return q && !q.deleted ? { qid: q.id, section: q.section, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation || "" } : null;
  }

  function drawResult() {
    const A = result.attempt;
    const att = db.list("examAttempts");
    const key = A.id || String(A.start);
    const status = ex.targetStatus(att.some((x) => x.id === A.id) ? att : [...att, A]);
    const target = A.config?.targetPercent;
    const reached = target ? A.scorePct >= target : null;
    const times = A.items.map((a) => a.sec);
    const avg = times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : 0;
    const slowest = A.items.map((a, i) => ({ n: i + 1, sec: a.sec })).sort((a, b) => b.sec - a.sec).slice(0, 3);
    const shown = A.items.map((a, i) => ({ a, i })).filter(({ a }) => reviewAll || !a.correct);
    const table = (head, rows) => h("div", { class: "table-wrap" }, h("table", { class: "data-table" }, h("thead", {}, h("tr", {}, ...head.map((x) => h("th", { scope: "col", text: x })))), h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c, k) => (k === 0 ? h("th", { scope: "row", text: String(c) }) : h("td", { text: String(c) }))))))));

    body.replaceChildren(
      h("section", { class: "card stack" },
        h("div", { class: "row" }, h("h2", { text: "ผลสอบ" }), h("span", { class: "mono muted", text: fmtDate(A.start) }), A.autoSubmitted ? h("span", { class: "badge", text: "ส่งอัตโนมัติ (หมดเวลา)" }) : null),
        h("div", { class: "big-num" }, h("span", { text: `${A.correct}/${A.total}` }), h("span", { class: "muted", text: `  ${A.scorePct}%` })),
        target ? h("p", { class: reached ? "good" : "bad", text: `${reached ? "✓ ถึงเป้า" : "✗ ยังไม่ถึงเป้า"} ${target}%${status.twoInARow && status.key === ex.configKey(A.config) ? " — ถึงเป้า 2 ครั้งติดแล้ว" : ""}` }) : null,
        h("p", { class: "muted", text: `ใช้เวลา ${ex.clock(A.durationSec)} จาก ${ex.clock(A.limitSec)} · เฉลี่ยต่อข้อ ${avg} วินาที${slowest[0] ? ` · นานสุด ข้อ ${slowest.map((s) => `${s.n} (${s.sec}s)`).join(", ")}` : ""}` }),
        table(["ส่วน", "ถูก", "ทั้งหมด", "%"], A.bySection.map((s) => [ex.SECTIONS[s.section], s.correct, s.total, `${Math.round((s.correct / s.total) * 100)}%`])),
        h("details", { class: "lex-details" }, h("summary", { text: "เวลาต่อข้อ" }), table(["ข้อ", "ผล", "วินาที", "ปักธง"], A.items.map((a, i) => [i + 1, a.correct ? "ถูก" : a.chosen === null ? "ไม่ได้ตอบ" : "ผิด", a.sec, a.flagged ? "🚩" : ""]))),
        h("div", { class: "row" },
          h("button", { class: "btn btn--secondary", type: "button", text: "กลับ", onclick: () => { view = "main"; result = null; tab = "take"; draw(); } }),
          h("button", { class: "btn btn--secondary", type: "button", "aria-pressed": String(reviewAll), text: reviewAll ? "แสดงเฉพาะข้อที่ผิด/ไม่ได้ตอบ" : "แสดงทุกข้อ", onclick: () => { reviewAll = !reviewAll; draw(); } }))),
      h("section", { class: "stack" }, h("h2", { text: reviewAll ? "ทบทวนทุกข้อ" : `ทบทวนข้อที่ผิด/ไม่ได้ตอบ (${shown.length})` }),
        shown.length ? null : h("p", { class: "good", text: "ถูกทุกข้อ 🎉" }),
        ...shown.map(({ a, i }) => reviewCard(a, i, key))));
  }

  function reviewCard(a, i, key) {
    const it = itemOf(a);
    if (!it) return h("div", { class: "card stack" }, h("strong", { text: `ข้อ ${i + 1}` }), h("p", { class: "muted", text: "ข้อสอบข้อนี้ถูกลบหรือแก้ไขแล้ว จึงแสดงรายละเอียดไม่ได้ (ผลคะแนนยังอยู่)" }));
    const done = added.has(`${key}|${a.qid}`);
    const sel = h("select", { class: "input select", "aria-label": "หมวดข้อผิด" }, ...el.CATEGORIES.map((c) => h("option", { value: c, text: c, selected: c === ex.CATEGORY_OF_SECTION[it.section] })));
    const known = new Set(db.list("cards").map((c) => wordKey(c.en)));
    const words = [...new Set(tokenize(`${it.question} ${it.options.join(" ")}`).map((t) => t.key).filter((w) => w.length >= 4 && !known.has(w)))].slice(0, 12);
    return h("div", { class: "card stack" },
      h("div", { class: "row" }, h("strong", { text: `ข้อ ${i + 1}` }), h("span", { class: "badge", text: ex.SECTIONS[it.section] }), a.chosen === null ? h("span", { class: "badge", text: "ไม่ได้ตอบ" }) : null, a.flagged ? h("span", { class: "badge", text: "🚩" }) : null, h("span", { class: "mono muted", text: `${a.sec}s` })),
      h("p", { class: "exam__q", text: it.question }),
      h("ul", { class: "list" }, ...it.options.map((o, k) => h("li", { class: `opt ${o === it.answer ? "is-right" : o === a.chosen ? "is-wrong" : ""}` }, h("span", { class: "mono", text: `${"ABCDEF"[k]}. ` }), o, o === it.answer ? "  ✓ ถูก" : o === a.chosen ? "  ✗ ที่เลือก" : ""))),
      it.explanation ? h("p", { class: "muted", text: `คำอธิบาย: ${it.explanation}` }) : null,
      !a.correct ? h("div", { class: "row" }, sel,
        h("button", { class: "btn", type: "button", disabled: done, text: done ? "เพิ่มเข้า Error Log แล้ว ✓" : "เพิ่มเข้า Error Log", onclick: () => addToErrorLog(it, a.chosen, sel.value, `${key}|${a.qid}`) })) : null,
      !a.correct && words.length ? h("div", { class: "stack" }, h("small", { class: "muted", text: "คำศัพท์ในข้อนี้ — กดเพื่อเพิ่มเป็นบัตรคำ" }),
        h("div", { class: "row lib-chips" }, ...words.map((w) => h("button", { class: "btn btn--chip btn--secondary", type: "button", text: w,
          onclick: () => { const sent = splitSentences(it.question).find((s) => tokenize(s).some((t) => t.key === w)) || ""; setAddWordPrefill({ word: w, example: sent }); location.hash = "#/cards"; } })))) : null);
  }

  function addToErrorLog(it, chosen, category, mark) {
    const p = ex.errorPayload(it, chosen, category);
    const existing = findExistingError(db.list("errors"), p.wrong, p.right);
    if (existing) { db.append("errorEvents", { errorId: existing.id, type: "occurred", at: Date.now() }); toast("มีข้อผิดนี้ใน Error Log แล้ว — นับเพิ่มอีก 1 ครั้ง"); }
    else { const e = db.create("errors", p); db.append("errorEvents", { errorId: e.id, type: "occurred", at: Date.now() }); toast("เพิ่มเข้า Error Log แล้ว"); }
    added.add(mark);
    drawResult();
  }

  // ================= ประวัติ =================
  function historyTab() {
    const att = db.list("examAttempts").sort((a, b) => b.start - a.start);
    const st = ex.targetStatus(att);
    return h("div", { class: "stack" },
      st.last2.length ? h("section", { class: "card stack" }, h("h2", { text: "เป้าหมาย (Roadmap ขั้น 4)" }),
        h("p", {}, `ชุดล่าสุดที่ตั้งเป้า: ${st.last2.map((x) => `${x.score}% (เป้า ${x.target}%) ${x.reached ? "✓" : "✗"}`).join(" ← ก่อนหน้า ")}`),
        h("p", { class: st.twoInARow ? "good" : "muted", text: st.twoInARow ? "ถึงเป้า 2 ครั้งติด ✓" : "ยังไม่ถึงเป้า 2 ครั้งติด" })) : null,
      h("section", { class: "card stack" }, h("h2", { text: "ประวัติการสอบ" }),
        att.length ? h("ul", { class: "list" }, ...att.map((a) => h("li", { class: "card-row" },
          h("div", { class: "card-row__main" }, h("strong", { text: `${a.scorePct}% (${a.correct}/${a.total})` }), h("span", { class: "mono muted", text: `${fmtDate(a.start)} · ${a.config?.name || a.config?.setName || "ทุกชุด"}${a.config?.targetPercent ? ` · เป้า ${a.config.targetPercent}%` : ""}${a.autoSubmitted ? " · ส่งอัตโนมัติ" : ""}` })),
          h("button", { class: "btn btn--secondary", type: "button", text: "ดูผลและทบทวน", onclick: () => { result = { attempt: a, snap: new Map() }; reviewAll = false; view = "result"; draw(); } })))) : h("p", { class: "muted", text: "ยังไม่เคยสอบ" })));
  }

  // ================= คลังข้อสอบ =================
  function bankTab() {
    const qs = questions();
    const bySection = Object.entries(ex.SECTIONS).map(([k, label]) => `${label} ${qs.filter((q) => q.section === k).length}`).join(" · ");
    const sets = [...new Set(qs.map((q) => q.setName).filter(Boolean))].sort();
    const samples = qs.filter((q) => q.source === ex.SAMPLE_SOURCE);
    const shown = qs.filter((q) => (!filter.set || q.setName === filter.set) && (!filter.section || q.section === filter.section) && (!filter.q || q.question.toLowerCase().includes(filter.q.toLowerCase())))
      .sort((a, b) => (a.setName || "").localeCompare(b.setName || "") || a.createdAt - b.createdAt).slice(0, 100);
    return h("div", { class: "stack" },
      h("section", { class: "card stack" }, h("h2", { text: "คลังข้อสอบของฉัน" }),
        h("div", { class: "notice", text: "ใส่เฉพาะข้อสอบที่คุณเขียนเองหรือมีสิทธิ์ใช้ — แอปไม่มีข้อสอบจริง/ข้อสอบลิขสิทธิ์มาให้ และข้อมูลนี้ซิงก์เฉพาะบัญชีของคุณ ไม่ถูกแชร์" }),
        h("p", { class: "muted mono", text: `${qs.length} ข้อ · ${bySection}${sets.length ? ` · ${sets.length} ชุด` : ""}` }),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", text: "+ เพิ่มข้อสอบ", onclick: () => { editing = "new"; draw(); } }),
          h("button", { class: "btn btn--secondary", type: "button", text: "ดาวน์โหลด template CSV", onclick: () => download("engpath-exam-template.csv", ex.templateCsv(), "text/csv;charset=utf-8") }),
          h("button", { class: "btn btn--secondary", type: "button", text: "ดาวน์โหลด template JSON", onclick: () => download("engpath-exam-template.json", ex.templateJson(), "application/json") }),
          samples.length ? h("button", { class: "btn btn--secondary", type: "button", text: `ลบข้อสอบตัวอย่าง (${samples.length})`, onclick: () => { if (confirm(`ลบข้อสอบที่ติดป้าย “${ex.SAMPLE_SOURCE}” ทั้ง ${samples.length} ข้อ?`)) { samples.forEach((q) => db.softDelete("questions", q.id)); toast("ลบข้อสอบตัวอย่างแล้ว"); } } }) : null)),
      importPanel(),
      editing ? editor() : null,
      qs.length ? h("section", { class: "card stack" },
        h("div", { class: "row" },
          h("input", { class: "input", type: "search", value: filter.q, placeholder: "ค้นหาในคำถาม", "aria-label": "ค้นหาข้อสอบ", oninput: (e) => { filter.q = e.target.value; refreshList(); } }),
          h("select", { class: "input select", "aria-label": "กรองตามชุด", onchange: (e) => { filter.set = e.target.value; draw(); } }, h("option", { value: "", text: "ทุกชุด" }), ...sets.map((s) => h("option", { value: s, text: s, selected: s === filter.set }))),
          h("select", { class: "input select", "aria-label": "กรองตามส่วน", onchange: (e) => { filter.section = e.target.value; draw(); } }, h("option", { value: "", text: "ทุกส่วน" }), ...Object.entries(ex.SECTIONS).map(([k, l]) => h("option", { value: k, text: l, selected: k === filter.section })))),
        h("div", { id: "q-list" }, questionList(shown)),
        qs.length > shown.length ? h("small", { class: "muted", text: `แสดง ${shown.length} จาก ${qs.length} ข้อ — ใช้ตัวกรองเพื่อหาข้อที่ต้องการ` }) : null) : null);
  }

  function refreshList() { const l = document.getElementById("q-list"); if (!l) return; const qs = questions(); l.replaceChildren(questionList(qs.filter((q) => (!filter.set || q.setName === filter.set) && (!filter.section || q.section === filter.section) && (!filter.q || q.question.toLowerCase().includes(filter.q.toLowerCase()))).slice(0, 100))); }

  function questionList(list) {
    return h("ul", { class: "list" }, ...list.map((q) => h("li", { class: "card-row" },
      h("div", { class: "card-row__main" }, h("span", { class: "q-text", text: q.question.length > 160 ? `${q.question.slice(0, 160)}…` : q.question }),
        h("div", { class: "row tags" }, h("span", { class: "badge", text: ex.SECTIONS[q.section] }), q.setName ? h("span", { class: "badge", text: q.setName }) : null, q.source ? h("span", { class: `badge ${q.source === ex.SAMPLE_SOURCE ? "badge--sample" : ""}`, text: q.source }) : null)),
      h("div", { class: "row" },
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "แก้ไข", onclick: () => { editing = q.id; draw(); } }),
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ลบ", onclick: () => { if (confirm("ลบข้อสอบข้อนี้?")) db.softDelete("questions", q.id); } })))));
  }

  function editor() {
    const cur = editing === "new" ? null : db.get("questions", editing);
    const f = {
      question: h("textarea", { class: "input", rows: 4, value: cur?.question || "", "aria-label": "คำถาม", placeholder: "คำถาม (ถ้าเป็น Reading ใส่บทอ่านไว้ในช่องนี้ได้)" }),
      options: Array.from({ length: ex.LIMITS.maxOptions }, (_, k) => h("input", { class: "input", value: cur?.options[k] || "", "aria-label": `ตัวเลือก ${"ABCDEF"[k]}`, placeholder: `ตัวเลือก ${"ABCDEF"[k]}${k < 2 ? "" : " (ไม่บังคับ)"}` })),
      explanation: h("textarea", { class: "input", rows: 2, value: cur?.explanation || "", "aria-label": "คำอธิบาย", placeholder: "คำอธิบาย (ไม่บังคับ)" }),
      section: h("select", { class: "input select", "aria-label": "ส่วน" }, ...Object.entries(ex.SECTIONS).map(([k, l]) => h("option", { value: k, text: l, selected: k === (cur?.section || "grammar") }))),
      set: h("input", { class: "input", value: cur?.setName || "", placeholder: "ชุดข้อสอบ (ไม่บังคับ)", "aria-label": "ชุดข้อสอบ", maxlength: "80" }),
      source: h("input", { class: "input", value: cur?.source || "", placeholder: "แหล่งที่มา (ไม่บังคับ)", "aria-label": "แหล่งที่มา", maxlength: "120" }),
    };
    let correct = cur ? Math.max(0, cur.options.indexOf(cur.answer)) : 0;
    const radios = f.options.map((_, k) => h("label", { class: "row check" }, h("input", { type: "radio", name: "correct", checked: k === correct, onchange: () => { correct = k; }, "aria-label": `ตัวเลือก ${"ABCDEF"[k]} คือคำตอบที่ถูก` }), h("span", { class: "mono", text: "ถูก" })));
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    return h("form", { class: "card stack", novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const opts = f.options.map((i) => i.value.trim());
      if (!opts[correct]) { err.hidden = false; err.textContent = "ตัวเลือกที่ติ๊กว่าถูกยังว่างอยู่"; return; }
      const v = ex.validateQuestion({ question: f.question.value, options: opts, answer: opts[correct], explanation: f.explanation.value, section: f.section.value, set: f.set.value, source: f.source.value });
      if (v.error) { err.hidden = false; err.textContent = v.error; return; }
      if (cur) db.update("questions", cur.id, v.q); else db.create("questions", v.q);
      editing = null; toast("บันทึกข้อสอบแล้ว"); draw();
    } },
      h("h2", { text: cur ? "แก้ไขข้อสอบ" : "เพิ่มข้อสอบ" }), f.question,
      ...f.options.map((inp, k) => h("div", { class: "row" }, inp, radios[k])),
      f.explanation, h("div", { class: "grid2" }, f.section, f.set), f.source, err,
      h("div", { class: "row" }, h("button", { class: "btn", type: "submit", text: "บันทึก" }), h("button", { class: "btn btn--secondary", type: "button", text: "ยกเลิก", onclick: () => { editing = null; draw(); } })));
  }

  function importPanel() {
    const file = h("input", { type: "file", accept: ".csv,.json,.txt,text/csv,application/json", hidden: true, onchange: async () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { importReport = { fatal: "ไฟล์ใหญ่เกิน 5 MB — แบ่งไฟล์แล้วนำเข้าทีละส่วน" }; draw(); return; }
      check(await f.text(), f.name); file.value = "";
    } });
    const paste = h("textarea", { class: "input", rows: 3, placeholder: "หรือวางข้อมูล CSV/JSON ที่นี่", "aria-label": "วางข้อมูลข้อสอบ" });
    function check(text, name = "") {
      const r = ex.importAuto(text, name, questions());
      importReport = r;
      draw();
    }
    const rep = importReport;
    return h("section", { class: "card stack", id: "import-panel" },
      h("h2", { text: "นำเข้าข้อสอบ (CSV / JSON)" }),
      h("p", { class: "muted", text: "ใช้ template ที่ดาวน์โหลดจากปุ่มด้านบน — แอปจะตรวจทุกแถวและบอกบรรทัดที่ผิดก่อน ไม่นำเข้าอะไรจนกว่าคุณจะกดยืนยัน" }),
      h("div", { class: "row" }, h("button", { class: "btn btn--secondary", type: "button", text: "เลือกไฟล์…", onclick: () => file.click() }), file,
        h("button", { class: "btn btn--secondary", type: "button", text: "ตรวจข้อมูลที่วาง", onclick: () => { if (paste.value.trim()) check(paste.value); } })),
      paste,
      rep?.fatal ? h("div", { class: "notice notice--bad", role: "alert", text: rep.fatal }) : null,
      rep && !rep.fatal ? h("div", { class: "stack", role: "status" },
        h("p", {}, `พบ ${rep.total} รายการ (${rep.format.toUpperCase()}) · `, h("strong", { class: "good", text: `ถูกต้อง ${rep.questions.length}` }), ` · `, h("strong", { class: rep.errors.length ? "bad" : "muted", text: `ผิดพลาด ${rep.errors.length}` }), ` · ซ้ำกับที่มีอยู่ ${rep.skippedDuplicates}`),
        rep.errors.length ? h("div", { class: "notice notice--bad stack" }, h("strong", { text: "รายการที่ต้องแก้ในไฟล์:" }),
          h("ul", { class: "plain-list" }, ...rep.errors.slice(0, 50).map((e) => h("li", { text: ex.describeError(e) })), rep.errors.length > 50 ? h("li", { class: "muted", text: `…และอีก ${rep.errors.length - 50} รายการ` }) : null)) : null,
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", disabled: !rep.questions.length, text: rep.errors.length ? `นำเข้าเฉพาะที่ถูกต้อง (${rep.questions.length} ข้อ)` : `นำเข้า ${rep.questions.length} ข้อ`,
            onclick: () => { for (const q of rep.questions) db.create("questions", q); toast(`นำเข้า ${rep.questions.length} ข้อแล้ว`); importReport = null; draw(); } }),
          h("button", { class: "btn btn--secondary", type: "button", text: "ยกเลิก", onclick: () => { importReport = null; draw(); } }))) : null);
  }

  const unsub = db.subscribe(() => {
    if (view === "run") return;
    const a = document.activeElement;
    if (a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) && root.contains(a)) return;      // ไม่รื้อฟอร์มระหว่างพิมพ์
    draw();
  });

  if (live && !live.submitted) { if (ex.isTimeUp(live.startAt, live.limitSec, Date.now())) { view = "run"; submit(true); } else resume(); } else draw();

  return () => { unsub(); clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
}
