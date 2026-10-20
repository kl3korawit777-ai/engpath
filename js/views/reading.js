// ตัวเช็ก i+1 (Comprehensible Input): วางข้อความ → แตะคำที่ไม่รู้ → ดู % คำที่ไม่รู้ → เพิ่มคำเป็นบัตรคำทีเดียว → บันทึก reading log
import * as db from "../db.js";
import * as srs from "../srs.js";
import * as rd from "../reading.js";
import { findInLibrary } from "../wordnav.js";
import { setWordStatus } from "./newwords.js";
import { ActivityClock, FLUSH_EVERY_MS, toSession } from "../activity.js";
import { READING, VERDICTS } from "../data/reading-config.js";
import { LEVEL_OPTIONS } from "../clips.js";
import { h } from "../dom.js";

const STATUS_HINT = {
  "known-card": "อยู่ในบัตรคำที่จำได้แล้ว (รู้อัตโนมัติ)",
  "learning-card": "อยู่ในบัตรคำที่ยังเรียนอยู่ (นับเป็นไม่รู้) — แตะเพื่อบอกว่ารู้แล้ว",
  "user-unknown": "คุณทำเครื่องหมายว่าไม่รู้ — แตะอีกครั้งเพื่อยกเลิก",
  plain: "ถือว่ารู้ — แตะถ้าไม่รู้",
};
const fmtDate = (ts) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

export function render(root, { toast }) {
  let text = "";
  let tokens = [];
  let classified = [];
  let userUnknown = new Set();
  let userKnown = new Set();
  let selected = new Set();
  let index = new Map();
  let truncated = false;
  let adding = false;
  let report = null;
  const spansByKey = new Map();

  // ---------- เวลา (นับเป็นเวลา Input: session skill "input") ----------
  const clock = new ActivityClock();
  let flushedSec = 0, loggedSec = 0;
  const touch = () => clock.touch(Date.now());
  const flush = () => {
    const slice = clock.flush(Date.now());
    if (slice) flushedSec += slice.durationSec;
    const s = toSession(slice, "input", db.getSettings().stage);
    if (s) { try { db.append("sessions", s); } catch (e) { console.error(e); } }
  };
  const onHidden = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("visibilitychange", onHidden);
  const timer = setInterval(flush, FLUSH_EVERY_MS);
  root.addEventListener("pointerdown", touch);
  root.addEventListener("keydown", touch);

  const body = h("div", { class: "stack" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "ตัวเช็ก i+1" }), h("p", { class: "muted", text: "วางบทความ/บทของคลิปเพื่อดูว่ายากพอดีกับระดับของคุณไหม" })),
    body
  );

  // ================= อินพุต =================
  const area = h("textarea", { class: "input", rows: 8, placeholder: "วางข้อความภาษาอังกฤษที่นี่ (บทความ, graded reader, บทของคลิป)", "aria-label": "ข้อความที่จะตรวจ" });
  const countEl = h("small", { class: "muted mono" });
  const inputCard = h("section", { class: "card stack" },
    h("h2", { text: "ข้อความ" }),
    area, countEl,
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", text: "วิเคราะห์", onclick: analyze }),
      h("button", { class: "btn btn--secondary", type: "button", text: "ล้าง", onclick: () => { area.value = ""; text = ""; tokens = []; classified = []; updateCount(); drawResult(); } })),
    h("p", { class: "muted", text: "ทุกคำถือว่า “รู้” เป็นค่าเริ่มต้น แตะคำที่ไม่รู้ได้ · คำที่อยู่ในบัตรคำสถานะ “จำได้” หรือที่คุณกด “รู้แล้ว” รู้อัตโนมัติ · คำจากบัตร “ใหม่/กำลังเรียน” นับเป็นไม่รู้ (เฉพาะบัตรคำเดี่ยว วลีไม่ถูกนับ) · เพิ่มเรียนได้เฉพาะคำที่อยู่ในคลังกลาง" }));
  const updateCount = () => { const n = rd.tokenize(area.value).length; countEl.textContent = `${n.toLocaleString()} คำ${n > READING.maxWords ? ` (จะวิเคราะห์เฉพาะ ${READING.maxWords.toLocaleString()} คำแรก)` : ""}`; };
  area.addEventListener("input", updateCount);
  updateCount();

  const resultBox = h("div", { class: "stack" });
  body.replaceChildren(inputCard, resultBox);

  function loadIndex() {
    const cards = db.list("cards");
    index = rd.addKnownWords(rd.cardWordIndex(cards, srs.stateMap(cards, db.list("reviews"))), db.skippedKeys());
  }

  function analyze() {
    text = area.value;
    const all = rd.tokenize(text);
    truncated = all.length > READING.maxWords;
    tokens = all.slice(0, READING.maxWords);
    userUnknown = new Set(); userKnown = new Set(); selected = new Set(); report = null;
    if (!tokens.length) { toast("ไม่พบคำภาษาอังกฤษในข้อความ"); drawResult(); return; }
    loadIndex();
    reclassify();
    drawResult();
  }

  function reclassify() {
    classified = rd.classify(tokens, index, { userUnknown, userKnown });
    for (const w of [...selected]) if (!classified.some((t) => t.key === w && t.status === "user-unknown")) selected.delete(w);
  }

  // ================= ผลลัพธ์ =================
  function drawResult() {
    if (!classified.length) { resultBox.replaceChildren(); return; }
    const st = rd.stats(classified);
    resultBox.replaceChildren(summaryCard(st), textCard(), unknownCard(st), logCard(st));
  }

  function summaryCard(st) {
    const v = VERDICTS[st.verdict];
    return h("section", { class: "card stack", id: "summary" },
      h("div", { class: "row" },
        h("div", { class: "big-num" }, h("span", { id: "pct", text: st.unknownPct.toFixed(1) }), h("span", { class: "muted", text: "% คำที่ไม่รู้" })),
        h("span", { class: `badge verdict verdict--${st.verdict}`, id: "verdict", text: v.label })),
      h("p", { id: "verdict-tip", text: v.tip }),
      h("div", { class: "mono muted", id: "counts", text: `ไม่รู้ ${st.unknownCount} จาก ${st.total} คำ (${st.unique.length} คำไม่ซ้ำ) · เกณฑ์: < ${READING.easyBelow}% ง่ายไป · ${READING.easyBelow}–${READING.fitUpTo}% พอดี · > ${READING.fitUpTo}% ยากไป` }),
      truncated ? h("p", { class: "muted", text: `ข้อความยาวเกิน จึงวิเคราะห์เฉพาะ ${READING.maxWords.toLocaleString()} คำแรก` }) : null);
  }

  function textCard() {
    spansByKey.clear();
    const box = h("div", { class: "reading-text", role: "group", "aria-label": "ข้อความ แตะคำที่ไม่รู้" });
    const frag = document.createDocumentFragment();
    let pos = 0;
    classified.forEach((t, i) => {
      if (t.start > pos) frag.append(text.slice(pos, t.start));
      const sp = h("span", { class: `w w--${t.status}`, "data-i": String(i), title: STATUS_HINT[t.status], text: t.surface });
      (spansByKey.get(t.key) || spansByKey.set(t.key, []).get(t.key)).push(sp);
      frag.append(sp);
      pos = t.end;
    });
    frag.append(text.slice(pos));
    box.append(frag);
    box.addEventListener("click", (e) => {
      const el = e.target.closest?.(".w");
      if (!el) return;
      touch();
      onWord(classified[Number(el.dataset.i)]);
    });
    return h("section", { class: "card stack" },
      h("h2", { text: "แตะคำที่ไม่รู้" }),
      h("div", { class: "row legend" },
        h("span", { class: "w w--known-card", text: "รู้อัตโนมัติ (บัตรจำได้)" }), h("span", { class: "w w--learning-card", text: "บัตรที่ยังเรียนอยู่" }), h("span", { class: "w w--user-unknown", text: "ไม่รู้ (คุณแตะ)" })),
      box);
  }

  function onWord(t) {
    if (t.status === "known-card") { toast("คำนี้อยู่ในบัตรคำที่จำได้แล้ว นับเป็นรู้อัตโนมัติ"); return; }
    if (t.status === "learning-card") userKnown.add(t.key);
    else if (t.status === "user-unknown") { userUnknown.delete(t.key); selected.delete(t.key); }
    else { userUnknown.add(t.key); selected.add(t.key); }
    reclassify();
    // อัปเดตเฉพาะคำนี้ + สรุป + รายการ (ไม่วาดข้อความทั้งก้อนใหม่)
    classified.forEach((c, i) => { if (c.key === t.key) { const sp = spansByKey.get(t.key)?.find((s) => s.dataset.i === String(i)); if (sp) { sp.className = `w w--${c.status}`; sp.title = STATUS_HINT[c.status]; } } });
    const st = rd.stats(classified);
    const old = resultBox.children;
    old[0].replaceWith(summaryCard(st));
    old[2].replaceWith(unknownCard(st));
    old[3].replaceWith(logCard(st));
  }

  // ================= คำที่ไม่รู้ → บัตรคำ =================
  function unknownCard(st) {
    const addable = st.unique.filter((u) => u.status === "user-unknown");
    const existing = st.unique.filter((u) => u.status === "learning-card");
    const rows = st.unique.map((u) => {
      const can = u.status === "user-unknown";
      return h("li", { class: "card-row" },
        h("label", { class: "row check" },
          can ? h("input", { type: "checkbox", checked: selected.has(u.key), disabled: adding, onchange: (e) => { if (e.target.checked) selected.add(u.key); else selected.delete(u.key); refreshAddBtn(); } }) : null,
          h("strong", { text: u.surface.toLowerCase() }), h("span", { class: "mono muted", text: `×${u.count}` }),
          can ? null : h("span", { class: "badge", text: "มีบัตรแล้ว (กำลังเรียน)" })));
    });
    return h("section", { class: "card stack", id: "unknown-card" },
      h("h2", { text: `คำที่ไม่รู้ ${st.unique.length} คำ` }),
      st.unique.length ? h("div", { class: "row" },
        h("button", { class: "btn btn--secondary btn--chip", type: "button", disabled: adding || !addable.length, text: "เลือกทั้งหมด", onclick: () => { addable.forEach((u) => selected.add(u.key)); drawResultKeepText(); } }),
        h("button", { class: "btn btn--secondary btn--chip", type: "button", disabled: adding, text: "ไม่เลือก", onclick: () => { selected.clear(); drawResultKeepText(); } }),
        h("button", { class: "btn", type: "button", id: "add-btn", disabled: adding || !selected.size, text: `เริ่มเรียนคำที่เลือก (${selected.size})`, onclick: bulkAdd })) : h("p", { class: "muted", text: "ยังไม่มีคำที่ไม่รู้ — แตะคำในข้อความด้านบน" }),
      existing.length ? h("p", { class: "muted", text: `${existing.length} คำมีบัตรอยู่แล้ว ไม่ต้องเพิ่มซ้ำ` }) : null,
      st.unique.length ? h("ul", { class: "list" }, ...rows) : null,
      report ? reportBox() : null);
  }

  function refreshAddBtn() {
    const b = document.getElementById("add-btn");
    if (b) { b.textContent = `เริ่มเรียนคำที่เลือก (${selected.size})`; b.disabled = adding || !selected.size; }
  }

  function drawResultKeepText() {
    const st = rd.stats(classified);
    resultBox.children[2].replaceWith(unknownCard(st));
  }

  function reportBox() {
    return h("div", { class: "notice stack", role: "status" },
      report.running ? h("div", { text: `กำลังเพิ่มคำ ${report.done}/${report.total}…` }) : h("strong", { text: `เริ่มเรียนแล้ว ${report.added.length} คำ` }),
      report.added.length ? h("div", { class: "muted", text: `เพิ่ม: ${report.added.join(", ")}` }) : null,
      report.failed.length ? h("div", {}, h("div", { class: "bad", text: `เพิ่มไม่ได้ ${report.failed.length} คำ:` }), h("ul", { class: "plain-list" }, ...report.failed.map((f) => h("li", { text: `${f.word} — ${f.reason}` })))) : null);
  }

  // คำที่เลือกต้องอยู่ในคลังกลาง (จับรูปผันอย่าง running → run ให้) — เพิ่มคำนอกคลังไม่ได้
  function bulkAdd() {
    if (adding || !selected.size) return;
    const words = [...selected];
    report = { running: false, done: words.length, total: words.length, added: [], failed: [] };
    const taken = new Set([...db.list("cards").map((c) => c.wordKey || String(c.en || "").trim().toLowerCase()), ...db.skippedKeys()]);
    for (const word of words) {
      const w = findInLibrary(word);
      if (!w) { report.failed.push({ word, reason: "ไม่อยู่ในคลังกลาง" }); continue; }
      if (taken.has(w.wordKey) || taken.has(word.toLowerCase())) { report.failed.push({ word, reason: `มีคำ “${w.word}” ในการเรียนอยู่แล้ว` }); continue; }
      setWordStatus(w, "learning");
      taken.add(w.wordKey);
      report.added.push(w.word.toLowerCase() === word.toLowerCase() ? w.word : `${word} → ${w.word}`);
    }
    for (const w of words) selected.delete(w);
    loadIndex(); reclassify();                                   // คำที่เริ่มเรียนแล้วกลายเป็นบัตร “ใหม่” (ยังนับเป็นไม่รู้จนกว่าจะจำได้)
    drawResult();
    toast(`เริ่มเรียน ${report.added.length} คำ${report.failed.length ? ` · ไม่สำเร็จ ${report.failed.length}` : ""}`);
  }

  // ================= reading log =================
  function logCard(st) {
    const source = h("input", { class: "input", placeholder: "แหล่งที่มา เช่น BBC Learning English, Oxford Bookworms", maxlength: "200", "aria-label": "แหล่งที่มา" });
    const level = h("select", { class: "input select", "aria-label": "ระดับของเนื้อหา" }, h("option", { value: "", text: "ระดับ: ไม่ระบุ" }), ...LEVEL_OPTIONS.map((l) => h("option", { value: l, text: l })));
    const logs = db.list("readings").sort((a, b) => b.at - a.at).slice(0, 8);
    const mins = Math.max(0, flushedSec + clock.elapsed(Date.now()) - loggedSec) / 60;
    return h("section", { class: "card stack", id: "log-card" },
      h("h2", { text: "บันทึกการอ่าน (reading log)" }),
      h("p", { class: "muted", text: "เก็บแค่สถิติ (แหล่งที่มา ระดับ % คำที่ไม่รู้ เวลา) ไม่เก็บตัวข้อความ · เวลาที่ใช้ในหน้านี้นับเป็นเวลา Input อยู่แล้ว" }),
      h("div", { class: "grid2 form-grid" }, source, level),
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", text: "บันทึกการอ่านนี้", onclick: () => {
          const durationSec = Math.max(0, flushedSec + clock.elapsed(Date.now()) - loggedSec);
          db.append("readings", rd.buildReadingLog({ source: source.value, level: level.value, st: rd.stats(classified), durationSec, now: Date.now() }));
          loggedSec += durationSec;
          toast("บันทึกการอ่านแล้ว");
        } }),
        h("span", { class: "mono muted", text: `เวลาที่ใช้ในหน้านี้ ~${mins.toFixed(1)} นาที` })),
      logs.length ? h("ul", { class: "list" }, ...logs.map((l) => h("li", { class: "card-row" },
        h("div", { class: "card-row__main" }, h("strong", { text: l.source || "(ไม่ระบุแหล่งที่มา)" }),
          h("span", { class: "mono muted", text: `${fmtDate(l.at)} · ${l.level || "-"} · ไม่รู้ ${l.unknownPct}% (${l.unknownCount}/${l.totalWords}) · ${(l.durationSec / 60).toFixed(1)} นาที` }))))) : null);
  }

  const unsub = db.subscribe(() => { if (!adding && classified.length) { const old = resultBox.children[3]; if (old) old.replaceWith(logCard(rd.stats(classified))); } });

  return () => {
    unsub();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHidden);
    root.removeEventListener("pointerdown", touch);
    root.removeEventListener("keydown", touch);
    flush();
  };
}
