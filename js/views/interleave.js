// โหมดคละโจทย์: ชุด 10–20 ข้อคละบัตรคำ / Error Log / คลังข้อสอบ — ผลแต่ละข้อกลับเข้า SRS (reviews) และ practiceEvents ทันที
import * as db from "../db.js";
import * as srs from "../srs.js";
import * as lib from "../library.js";
import * as il from "../interleave.js";
import { ActivityClock, FLUSH_EVERY_MS, toSession } from "../activity.js";
import { h } from "../dom.js";

const hasExamBank = () => db.MUTABLE_COLS?.includes("questions");

export function render(root, { toast }) {
  const cfg = { card: true, error: true, exam: true, size: il.SIZE.default, tags: new Set() };
  let stage = "setup";                 // setup | run | summary
  let run = null;                      // { items, i, results[], cur: null | { judged, input }, start, recorded }
  const body = h("div", { class: "stack" });
  root.replaceChildren(h("div", { class: "page-head" }, h("h1", { text: "คละโจทย์" }), h("p", { class: "muted", text: "สลับหัวข้อและทักษะในชุดเดียว — ฝึกให้แยกแยะและเลือกใช้ได้ถูกในสถานการณ์จริง (Interleaving)" })), body);

  const clock = new ActivityClock();
  const touch = () => clock.touch(Date.now());
  root.addEventListener("pointerdown", touch);
  root.addEventListener("keydown", touch);
  const clockTimer = setInterval(() => { if (run && !run.recorded) flushTime(); }, FLUSH_EVERY_MS);
  const onHidden = () => { if (document.visibilityState === "hidden" && run && !run.recorded) flushTime(); };
  document.addEventListener("visibilitychange", onHidden);
  function flushTime() {
    const s = toSession(clock.flush(Date.now()), "weak", db.getSettings().stage);        // ชุดคละนับเป็นเวลา “เจาะจุดอ่อน”
    if (s) { try { db.append("sessions", s); } catch (e) { console.error(e); } }
  }

  // ---------- ข้อมูลต้นทาง ----------
  function sources() {
    const cards = db.list("cards");
    const reviews = db.list("reviews");
    const errors = db.list("errors"), errorEvents = db.list("errorEvents");
    const pickedTags = [...cfg.tags];
    const chosen = pickedTags.length ? cards.filter((c) => pickedTags.some((t) => lib.tagMatches(c, t))) : cards;
    const focus = (() => { try { return il.focusErrors({ errors, events: errorEvents, focus: db.getSettings().focus, now: Date.now() }); } catch { return null; } })();
    return { cards, chosen, states: srs.stateMap(cards, reviews), errors, errorEvents, focus, questions: hasExamBank() ? db.list("questions") : [] };
  }

  function makePool() {
    const s = sources();
    const pool = il.buildPool({ cards: s.chosen, allCards: s.cards, states: s.states, errors: s.errors, errorEvents: s.errorEvents, focus: s.focus, questions: s.questions, include: { card: cfg.card, error: cfg.error, exam: cfg.exam }, now: Date.now() });
    return { pool, s };
  }

  // ---------- ตั้งค่า ----------
  function drawSetup() {
    stage = "setup";
    const { pool, s } = makePool();
    const preview = il.sequence(pool, cfg.size);
    const topics = new Set(pool.map((p) => p.topic));
    const bySrc = Object.fromEntries(Object.keys(il.SOURCES).map((k) => [k, pool.filter((p) => p.src === k).length]));
    const tagPaths = []; const walk = (ns) => ns.forEach((n) => { tagPaths.push(n.path); walk(n.children); }); walk(lib.buildTagTree(s.cards));
    const examOn = hasExamBank() && s.questions.length > 0;

    const check = (key, label, disabled, hint) => h("label", { class: "row check" },
      h("input", { type: "checkbox", checked: cfg[key] && !disabled, disabled, onchange: (e) => { cfg[key] = e.target.checked; drawSetup(); } }),
      h("span", {}, label, hint ? h("small", { class: "muted", text: `  ${hint}` }) : null));

    const canStart = preview.items.length >= 4 && topics.size >= 2;
    body.replaceChildren(
      h("section", { class: "card stack" },
        h("h2", { text: "เลือกแหล่งโจทย์" }),
        check("card", "บัตรคำ", false, `${bySrc.card} โจทย์ (ความหมาย · สะกด)`),
        check("error", "Error Log", false, `${bySrc.error} โจทย์ (เลือกแบบถูก · พิมพ์แบบถูก · เติมคำ) เฉพาะข้อผิดที่ยังไม่แก้`),
        check("exam", "คลังข้อสอบ", !examOn, examOn ? `${bySrc.exam} ข้อ` : "ยังไม่มีข้อสอบที่นำเข้า"),
        tagPaths.length ? h("details", { class: "lex-details", open: cfg.tags.size > 0 }, h("summary", { text: `เลือกแท็กของบัตรคำ (${cfg.tags.size ? `${cfg.tags.size} แท็ก` : "ทุกแท็ก"})` }),
          h("div", { class: "row lib-chips" }, ...tagPaths.map((t) => h("button", { class: `btn btn--chip ${cfg.tags.has(t) ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(cfg.tags.has(t)), text: t,
            onclick: () => { cfg.tags.has(t) ? cfg.tags.delete(t) : cfg.tags.add(t); drawSetup(); } })))) : null,
        h("div", { class: "stack" }, h("strong", { text: "จำนวนข้อ" }),
          h("div", { class: "row" }, ...[10, 12, 15, 20].map((n) => h("button", { class: `btn ${cfg.size === n ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(cfg.size === n), text: String(n), onclick: () => { cfg.size = n; drawSetup(); } })))),
        h("p", { class: "muted", text: `ในคลังโจทย์ ${pool.length} ข้อ จาก ${topics.size} หัวข้อ — ชุดนี้จะได้ ${preview.items.length} ข้อ` }),
        preview.short ? h("div", { class: "notice", role: "status", text: topics.size < 2 ? "ต้องมีโจทย์อย่างน้อย 2 หัวข้อ (แท็ก/หมวดข้อผิด) จึงจะคละได้ — ลองเปิดแหล่งเพิ่ม เพิ่มแท็กให้บัตร หรือจดข้อผิดใน Error Log" : `คละให้ครบ ${preview.requested} ข้อไม่ได้โดยไม่ให้หัวข้อเดียวกันติดกันเกิน 2 ข้อ (หัวข้อไม่หลากหลายพอ) — จะได้ ${preview.items.length} ข้อ` }) : null,
        h("div", {}, h("button", { class: "btn", type: "button", disabled: !canStart, text: "เริ่มชุดคละ", onclick: () => start() }))));
  }

  // ---------- ทำชุด ----------
  function start() {
    const { pool } = makePool();
    const seq = il.sequence(pool, cfg.size);
    if (seq.items.length < 4) { toast("โจทย์ไม่พอ"); return; }
    run = { items: seq.items, i: 0, results: [], cur: null, start: Date.now(), recorded: false };
    clock.flush(Date.now());           // เริ่มนับเวลาใหม่
    clock.touch(Date.now());
    stage = "run";
    drawItem();
  }

  function answer(input) {
    const it = run.items[run.i];
    const judged = il.judge(it, input);
    const at = Date.now();
    const ev = il.eventFor(it, judged, input, at);
    if (ev) { try { db.append(ev.col, ev.data); } catch (e) { console.error(e); toast("บันทึกผลกลับต้นทางไม่สำเร็จ"); } }
    run.results.push({ item: it, correct: judged.correct, result: judged.result, input });
    run.cur = { judged, input };
    drawItem();
  }

  function next() {
    run.i++; run.cur = null;
    if (run.i >= run.items.length) finish(); else drawItem();
  }

  function record() {
    if (!run || run.recorded || !run.results.length) return;
    run.recorded = true;
    flushTime();
    try { db.append("interleavingSessions", il.sessionDoc({ start: run.start, end: Date.now(), results: run.results })); } catch (e) { console.error(e); }
  }

  function finish() { record(); stage = "summary"; drawSummary(); }

  const PROMPT = {
    meaning: "คำภาษาอังกฤษของความหมายนี้คืออะไร?", spelling: "เลือกคำที่สะกดถูก", choose: "ข้อไหนถูก?", cloze: "เติมคำที่ขาด", recall: "ประโยค/วลีนี้ผิด พิมพ์แบบที่ถูกจากความจำ", exam: "เลือกคำตอบที่ถูก",
  };

  function drawItem() {
    const it = run.items[run.i], cur = run.cur;
    const head = h("div", { class: "stack" },
      h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": run.items.length, "aria-valuenow": run.i }, h("i", { style: `width:${(run.i / run.items.length) * 100}%` })),
      h("div", { class: "row" }, h("span", { class: "badge", text: `ข้อ ${run.i + 1}/${run.items.length}` }), h("span", { class: "badge", text: il.KINDS[it.kind] }), h("span", { class: "badge", text: il.topicLabel(it.topic) })));

    const feedback = () => {
      const j = cur.judged;
      return h("div", { class: "stack", role: "status" },
        h("div", { class: j.correct ? "good" : j.result === "near" ? "muted" : "bad", text: j.correct ? "✓ ถูกต้อง" : j.result === "near" ? "เกือบถูก (นับเป็นยังไม่ถูก)" : "✗ ยังไม่ถูก" }),
        !j.correct ? h("div", {}, "คำตอบที่ถูก: ", h("strong", { text: it.answer })) : null,
        it.explanation ? h("div", { class: "muted", text: it.explanation }) : null,
        h("div", {}, h("button", { class: "btn", type: "button", text: run.i + 1 >= run.items.length ? "ดูสรุป" : "ข้อถัดไป", onclick: next })));
    };

    let main;
    if (it.options) {
      main = h("div", { class: "stack" },
        h("p", { class: "muted", text: PROMPT[it.kind] }),
        it.prompt ? h("p", { class: "prompt__main", text: it.prompt }) : null,
        ...it.options.map((o) => h("button", { class: "btn btn--secondary btn--answer", type: "button", disabled: Boolean(cur), text: o, onclick: () => answer(o) })));
    } else {
      const input = h("input", { class: "input", autocomplete: "off", autocapitalize: "none", spellcheck: false, disabled: Boolean(cur), "aria-label": "คำตอบ", placeholder: "พิมพ์คำตอบ…" });
      const check = () => { if (!input.value.trim()) { input.focus(); return; } answer(input.value); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !cur) check(); });
      input.style.flex = "1";
      const prompt = it.kind === "meaning" ? h("p", { class: "prompt__main", text: it.prompt })
        : it.kind === "recall" ? h("p", { class: "prompt__main" }, h("s", { class: "bad", text: it.prompt }))
        : h("p", { class: "prompt__main", text: it.sentence });
      main = h("div", { class: "stack" }, h("p", { class: "muted", text: PROMPT[it.kind] }), prompt,
        h("div", { class: "row" }, input, h("button", { class: "btn", type: "button", disabled: Boolean(cur), text: "ตรวจคำตอบ", onclick: check })));
      if (!cur) queueMicrotask(() => input.focus());
    }
    body.replaceChildren(h("section", { class: "card stack" }, head, main, cur ? feedback() : null,
      h("div", {}, h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ออกจากชุดนี้", onclick: leave }))));
  }

  function leave() {
    if (run.results.length && !confirm("ออกจากชุดนี้? ข้อที่ตอบไปแล้วถูกบันทึกกลับต้นทางไปแล้ว")) return;
    record(); run = null; drawSetup();
  }

  // ---------- สรุป ----------
  function drawSummary() {
    const sm = il.summarize(run.results);
    const pct = sm.total ? Math.round((sm.correct / sm.total) * 100) : 0;
    const table = (rows, label) => h("div", { class: "table-wrap" }, h("table", { class: "data-table" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: label }), h("th", { scope: "col", text: "ถูก" }), h("th", { scope: "col", text: "ทั้งหมด" }))),
      h("tbody", {}, ...rows.map((r) => h("tr", {}, h("th", { scope: "row", text: r.name }), h("td", { text: String(r.correct) }), h("td", { text: String(r.total) }))))));
    body.replaceChildren(
      h("section", { class: "card stack" },
        h("h2", { text: "จบชุดคละแล้ว" }),
        h("div", { class: "big-num" }, h("span", { text: `${sm.correct}/${sm.total}` }), h("span", { class: "muted", text: `  ${pct}%` })),
        h("p", { class: "muted", text: "ผลของแต่ละข้อถูกส่งกลับต้นทางแล้ว: บัตรคำเข้า SRS, ข้อผิดเข้าประวัติฝึกเจาะจุด" }),
        h("div", { class: "grid2" }, table(sm.byKind.map((r) => ({ name: il.KINDS[r.key], ...r })), "ทักษะ"), table(sm.byTopic.map((r) => ({ name: il.topicLabel(r.key), ...r })), "หัวข้อ")),
        sm.mistakes.length ? h("div", { class: "stack" }, h("strong", { text: "ข้อที่ยังไม่ถูก" }),
          h("ul", { class: "list" }, ...sm.mistakes.map((m) => h("li", { class: "card-row" }, h("div", { class: "card-row__main" }, h("span", { class: "badge", text: il.KINDS[m.kind] }), h("span", { text: m.prompt || m.sentence || "" }), h("strong", { class: "good", text: m.answer })))))) : h("p", { class: "good", text: "ถูกทุกข้อ 🎉" }),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", text: "ทำชุดใหม่", onclick: () => { run = null; start(); } }),
          h("button", { class: "btn btn--secondary", type: "button", text: "กลับ", onclick: () => { run = null; drawSetup(); } }))));
  }

  const unsub = db.subscribe(() => { if (stage === "setup") drawSetup(); });
  drawSetup();

  return () => {
    unsub();
    record();
    clearInterval(clockTimer);
    document.removeEventListener("visibilitychange", onHidden);
    root.removeEventListener("pointerdown", touch);
    root.removeEventListener("keydown", touch);
  };
}

