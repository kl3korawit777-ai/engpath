// หน้าเขียน (Handwriting): เขียนตามรอยจาง 4 ระดับ Trace → Fade → Copy → Recall + แกลเลอรีลายมือย้อนหลัง
import * as db from "../db.js";
import * as srs from "../srs.js";
import * as core from "../handwriting-core.js";
import * as hwr from "../handwriting-render.js";
import * as practice from "../practice.js";
import { InkPad } from "../handwriting-pad.js";
import { ActivityClock, FLUSH_EVERY_MS, toSession } from "../activity.js";
import { wordKey } from "../lexicon.js";
import { vocab } from "../vocab.js";
import { HW } from "../data/handwriting-config.js";
import { h } from "../dom.js";

const SOURCES = [
  { key: "due", label: "บัตรถึงรอบ" },
  { key: "focus", label: "จุดเน้น Error Log" },
  { key: "shadowing", label: "จาก Shadowing" },
  { key: "manual", label: "ของฉัน" },
];
const HINT = {
  trace: "เขียนทับรอยเทาจางให้ตรงที่สุด แล้วกด “ตรวจ”",
  fade: "เหลือแค่เส้นขอบประ เขียนตามเส้นแล้วกด “ตรวจ”",
  copy: "ดูคำด้านบน แล้วเขียนลงช่องว่าง จากนั้นกด “เปิดเฉลย”",
  recall: "ดูคำแปล/ฟังเสียง แล้วเขียนคำจากความจำ จากนั้นกด “เปิดเฉลย”",
};
const RATINGS = [{ v: 0, label: "ยังไม่ได้" }, { v: 1, label: "เขียนได้" }, { v: 2, label: "ง่ายมาก" }];
const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const fmtDate = (ts) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

function speak(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  speechSynthesis.speak(u);
}

export function render(root, { toast }) {
  let tab = "write";
  let style = db.getSettings().handwritingStyle || "print";
  let source = "due";
  let current = null;          // { item, layout, level, levelOverride, th, state: "writing" | "done" }
  let pad = null;
  let galleryFilter = "";
  let galleryShown = 40;
  let stopObserver = null;

  const clock = new ActivityClock();
  const touch = () => clock.touch(Date.now());
  const flush = () => {
    const s = toSession(clock.flush(Date.now()), "writing", db.getSettings().stage);
    if (s) { try { db.append("sessions", s); } catch (e) { console.error(e); } }
  };
  const onHidden = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("visibilitychange", onHidden);
  const timer = setInterval(flush, FLUSH_EVERY_MS);
  root.addEventListener("pointerdown", touch);
  root.addEventListener("keydown", touch);

  const body = h("div", { class: "stack" });
  const tabsEl = h("div", { class: "row tabs" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "เขียน" }), h("p", { class: "muted", text: "คัดลายมือตามรอยจาง 4 ระดับ เหมาะกับ iPad + Apple Pencil" })),
    tabsEl, body
  );

  function drawTabs() {
    tabsEl.replaceChildren(...[["write", "เขียน"], ["gallery", "แกลเลอรี"]].map(([k, label]) => h("button", {
      class: `btn ${tab === k ? "" : "btn--secondary"}`, type: "button", text: label, "aria-pressed": String(tab === k),
      onclick: () => { tab = k; show(); } })));
  }

  function show() {
    if (pad) { pad.destroy(); pad = null; }
    if (stopObserver) { stopObserver(); stopObserver = null; }
    drawTabs();
    if (tab === "write") drawWrite(); else drawGallery();
  }

  // ================= ข้อมูล =================
  const attempts = () => db.list("handwritingAttempts");
  const levels = () => core.levelsFromAttempts(attempts());

  function wordLists() {
    const cards = db.list("cards");
    const reviews = db.list("reviews");
    const errors = db.list("errors"), events = db.list("errorEvents");
    const focus = practice.focusErrors({ errors, events, focus: db.getSettings().focus, now: Date.now() }).items.map((x) => x.error);
    return core.candidateWords({
      cards, states: srs.stateMap(cards, reviews), focusErrors: focus, customWords: db.list("handwritingWords"), now: Date.now(),
    });
  }

  // ================= หน้าเขียน =================
  const wordList = h("div", { class: "row hw-words" });
  const practiceBox = h("div", { class: "stack" });
  const styleRow = h("div", { class: "row" });
  const statusEl = h("span", { class: "badge badge--off", text: "ยังไม่พบ Apple Pencil" });
  const fontNote = h("div", { class: "notice", hidden: true, role: "status" });
  const sourceRow = h("div", { class: "row" });
  const addRow = h("form", { class: "row", novalidate: true });

  function drawWrite() {
    body.replaceChildren(
      h("div", { class: "row" }, styleRow, statusEl, penResetBtn()),
      fontNote,
      h("section", { class: "card stack" }, h("h2", { text: "เลือกคำ" }), sourceRow, wordList, addRow),
      practiceBox
    );
    drawStyleRow();
    drawSources();
    drawAddRow();
    drawPractice();
  }

  const penResetBtn = () => h("button", { class: "btn btn--secondary btn--chip", type: "button", hidden: true, id: "hw-pen-reset", text: "รับนิ้วอีกครั้ง",
    onclick: () => { pad?.allowTouchAgain(); } });

  function drawStyleRow() {
    styleRow.replaceChildren(...core.STYLES.map((s) => h("button", {
      class: `btn ${style === s ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(style === s), text: HW.fonts[s].label,
      onclick: () => { style = s; drawStyleRow(); drawSources(); if (current) selectWord(current.item, { keepOverride: false }); },
    })));
  }

  function drawSources() {
    const lists = wordLists();
    const lv = levels();
    sourceRow.replaceChildren(...SOURCES.map((s) => h("button", {
      class: `btn btn--chip ${source === s.key ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(source === s.key),
      text: `${s.label} ${lists[s.key].length}`, onclick: () => { source = s.key; drawSources(); },
    })));
    const items = lists[source];
    wordList.replaceChildren(...(items.length ? items.map((it) => {
      const lvl = core.levelOfWord(lv, it.wordKey, style);
      const on = current?.item.wordKey === it.wordKey;
      return h("div", { class: "hw-word" },
        h("button", { class: `btn btn--chip ${on ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(on), onclick: () => selectWord(it) },
          h("span", { text: it.text }), h("span", { class: "mono muted", text: ` · ${core.LEVEL_LABELS[lvl]}` })),
        source === "manual" && it.id ? h("button", { class: "tag-edit", type: "button", "aria-label": `ลบ ${it.text}`, title: "ลบออกจากรายการ", text: "✕",
          onclick: () => { db.softDelete("handwritingWords", it.id); if (on) { current = null; drawPractice(); } } }) : null);
    }) : [h("p", { class: "muted", text: emptyText(source) })]));
  }

  const emptyText = (k) => ({
    due: "ยังไม่มีบัตรคำที่ถึงรอบและเขียนได้ (วลียาวเกิน 30 ตัวอักษรไม่เสนอให้คัด)",
    focus: "ยังไม่มีจุดเน้นจาก Error Log (ดูแท็บ “ฝึกเจาะจุด” ในหน้า Error Log)",
    shadowing: "ยังไม่มีวลีที่ส่งมาจาก Shadowing",
    manual: "ยังไม่มีคำในรายการของคุณ พิมพ์คำหรือวลีด้านล่างแล้วกด “เพิ่ม”",
  }[k]);

  function drawAddRow() {
    const input = h("input", { class: "input", placeholder: "เพิ่มคำหรือวลีที่อยากคัด เช่น look after", autocomplete: "off", autocapitalize: "none", spellcheck: false, "aria-label": "คำที่อยากคัด" });
    addRow.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim().replace(/\s+/g, " ");
      if (!core.isWritable(text)) { toast(`ใส่ตัวอักษรอังกฤษ/ตัวเลข ไม่เกิน ${HW.maxPhraseLength} ตัวอักษร`); return; }
      if (db.list("handwritingWords").some((w) => wordKey(w.text) === wordKey(text))) { toast("มีคำนี้ในรายการแล้ว"); return; }
      db.create("handwritingWords", { text, source: "manual" });
      input.value = "";
      source = "manual";
      drawSources();
    };
    addRow.replaceChildren(input, h("button", { class: "btn btn--secondary", type: "submit", text: "เพิ่ม" }));
    input.style.flex = "1";
  }

  // ---------- เลือกคำ ----------
  async function selectWord(item, { keepOverride = false } = {}) {
    const lv = levels();
    const derived = core.levelOfWord(lv, item.wordKey, style);
    const override = keepOverride ? current?.levelOverride : null;
    const fontOk = await hwr.ensureFont(style, item.text);
    fontNote.hidden = fontOk;
    if (!fontOk) fontNote.textContent = "ยังไม่ได้ดาวน์โหลดฟอนต์ของรูปแบบนี้ (ต้องออนไลน์ครั้งแรกเพื่อให้ใช้ออฟไลน์ได้) ตอนนี้ใช้ฟอนต์สำรองแทน";
    const layout = hwr.measureLayout(item.text, style);
    current = { item, layout, derived, level: override || derived, levelOverride: override, th: item.th || "", state: "writing", style };
    drawSources();
    drawPractice();
    if (!current.th) {
      const w = vocab.peek(item.wordKey);
      if (current?.item === item && w?.th?.length) { current.th = w.th.map((t) => t.text).join(" / "); if (current.level === "recall") drawPractice({ keepPad: true }); }
    }
  }

  // ---------- พื้นที่เขียน ----------
  function drawPractice({ keepPad = false } = {}) {
    if (!current) {
      if (pad) { pad.destroy(); pad = null; }
      practiceBox.replaceChildren(h("section", { class: "card" }, h("p", { class: "muted", text: "เลือกคำด้านบนเพื่อเริ่มเขียน" })));
      return;
    }
    const c = current;
    const padHost = h("div", { class: "ink-host" });
    const resultBox = h("div", { class: "stack", role: "status" });
    const actions = h("div", { class: "row" });
    const strokesBefore = keepPad && pad ? pad.strokes : [];

    const levelSelect = h("select", { class: "input select hw-level-select", "aria-label": "ระดับ",
      onchange: (e) => { current.levelOverride = e.target.value === c.derived ? null : e.target.value; current.level = e.target.value; current.state = "writing"; drawPractice(); } },
      ...core.LEVELS.map((l) => h("option", { value: l, text: `${core.LEVEL_LABELS[l]}${l === c.derived ? " (ระดับของคุณ)" : ""}`, selected: l === c.level })));

    const model = c.level === "copy" ? h("div", { class: "hw-model", style: `font-family:${HW.fonts[style].css}`, text: c.item.text }) : null;
    const recall = c.level === "recall" ? h("div", { class: "row hw-recall" },
      h("div", { class: "prompt__main", text: c.th || "(ไม่มีคำแปลในเครื่อง — ฟังเสียงแล้วเขียน)" }),
      canSpeak ? h("button", { class: "btn btn--secondary", type: "button", text: "🔊 ฟังเสียง", onclick: () => speak(c.item.text) }) : h("small", { class: "muted", text: "เบราว์เซอร์นี้ไม่รองรับเสียงอ่าน" })) : null;

    const tools = h("div", { class: "row hw-tools" },
      toolBtn("pen", "ปากกา"), toolBtn("eraser", "ยางลบ"),
      h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ย้อนกลับ", onclick: () => pad.undo() }),
      h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ล้าง", onclick: () => {
        const wasDone = current.state === "done";
        pad.clear(); pad.setOverlay({}); resultBox.replaceChildren(); current.state = "writing";
        if (wasDone && !current.levelOverride) {                       // เขียนใหม่หลังตรวจ: ใช้ระดับล่าสุดที่คำนวณได้
          current.derived = core.levelOfWord(levels(), current.item.wordKey, style);
          if (current.derived !== current.level) { current.level = current.derived; drawPractice(); return; }
        }
        drawActions();
      } }),
      h("label", { class: "row hw-thick" }, h("span", { class: "muted", text: "ความหนา" }),
        h("input", { type: "range", min: HW.ink.thickness.min, max: HW.ink.thickness.max, step: HW.ink.thickness.step, value: padThickness, "aria-label": "ความหนาเส้น",
          oninput: (e) => { padThickness = Number(e.target.value); pad.setThickness(padThickness); } })));

    practiceBox.replaceChildren(h("section", { class: "card stack" },
      h("div", { class: "row" }, h("h2", { text: c.item.text }), levelSelect),
      h("p", { class: "muted", text: HINT[c.level] }),
      model, recall, padHost, tools, actions, resultBox));

    if (pad) pad.destroy();
    pad = new InkPad(padHost, {
      onActivity: touch,
      onChange: () => { drawActions(); },
      onStatus: ({ penReady, touchBlocked }) => {
        statusEl.className = `badge ${penReady ? "" : "badge--off"}`;
        statusEl.textContent = penReady ? "Apple Pencil พร้อม" : "ยังไม่พบ Apple Pencil";
        const btn = document.getElementById("hw-pen-reset");
        if (btn) btn.hidden = !touchBlocked;
      },
    });
    pad.setContent({ text: c.item.text, style, level: c.level, layout: c.layout });
    pad.setThickness(padThickness);
    pad.setTool(padTool);
    if (strokesBefore.length) { pad.strokes = strokesBefore; pad.redraw(); }

    function toolBtn(t, label) {
      return h("button", { class: `btn btn--chip ${padTool === t ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(padTool === t), text: label,
        onclick: (e) => { padTool = t; pad.setTool(t); for (const b of e.target.parentElement.querySelectorAll("[aria-pressed]")) { const on = b === e.target; b.setAttribute("aria-pressed", String(on)); b.classList.toggle("btn--secondary", !on); } } });
    }

    function drawActions() {
      if (!current) return;
      const done = current.state === "done";
      const empty = pad.isEmpty;
      if (c.level === "trace" || c.level === "fade") {
        actions.replaceChildren(
          h("button", { class: "btn", type: "button", disabled: done || empty, text: "ตรวจ", onclick: () => check(resultBox, drawActions) }),
          nextBtn());
      } else if (current.state === "revealed") {
        actions.replaceChildren(h("span", { class: "muted", text: "ให้คะแนนตัวเอง:" }), ...RATINGS.map((r) => h("button", { class: "btn btn--secondary", type: "button",
          text: r.label, onclick: () => rate(r.v, resultBox, drawActions) })));
      } else {
        actions.replaceChildren(
          h("button", { class: "btn", type: "button", disabled: done || empty, text: "เปิดเฉลย", onclick: () => { current.state = "revealed"; pad.setOverlay({ reveal: true }); drawActions(); } }),
          nextBtn());
      }
    }
    const nextBtn = () => h("button", { class: "btn btn--secondary", type: "button", text: "คำถัดไป", onclick: nextWord });
    drawActions();
  }

  let padTool = "pen";
  let padThickness = HW.ink.thickness.default;

  // ---------- ตรวจ / เปิดเฉลย ----------
  function saveAttempt(extra) {
    const c = current;
    const doc = db.append("handwritingAttempts", { wordKey: c.item.wordKey, text: c.item.text, style, level: c.level, at: Date.now(), ...extra });
    hwr.exportJpeg(c.layout, pad.strokes).then(
      (img) => db.append("handwritingImages", { id: doc.id, attemptId: doc.id, dataUrl: img.dataUrl, w: img.w, h: img.h }),
      (e) => toast(`บันทึกภาพไม่สำเร็จ: ${e.message}`)
    );
    return doc;
  }

  /** ข้อความผลต่อระดับ: ฝึกนอกระดับปัจจุบันไม่นับเลื่อน (ระดับคำนวณจาก attempts ก่อนหน้านี้ ไม่รวมครั้งนี้) */
  function levelMessage(doc) {
    const before = core.levelOfWord(core.levelsFromAttempts(attempts().filter((a) => a.id !== doc.id)), doc.wordKey, style);
    if (doc.level !== before) return `ฝึกนอกระดับปัจจุบัน (ระดับของคุณคือ ${core.LEVEL_LABELS[before]}) — ไม่นับการเลื่อนระดับ`;
    const after = core.applyAttempt(before, doc);
    if (after === before) return `ยังอยู่ระดับ ${core.LEVEL_LABELS[before]}`;
    return `${core.LEVELS.indexOf(after) > core.LEVELS.indexOf(before) ? "ขึ้น" : "ลด"}เป็นระดับ ${core.LEVEL_LABELS[after]}`;
  }

  function check(resultBox, redrawActions) {
    if (pad.isEmpty) { toast("ยังไม่ได้เขียน"); return; }
    const r = hwr.scoreStrokes(current.layout, current.item.text, style, pad.strokes);
    pad.setOverlay({ badLetters: r.letters.filter((l) => l.bad) });
    const doc = saveAttempt({ score: r.score, coverage: Math.round(r.coverage * 100) / 100, accuracy: Math.round(r.accuracy * 100) / 100 });
    current.state = "done";
    const pass = r.score >= HW.score.levelUpAt;
    resultBox.replaceChildren(
      h("div", { class: "row" }, h("span", { class: "big-num" }, h("span", { text: String(r.score) }), h("span", { class: "muted", text: " / 100" })),
        h("span", { class: `badge ${pass ? "" : "badge--sample"}`, text: pass ? "ผ่านเกณฑ์" : `ต่ำกว่า ${HW.score.levelUpAt}` })),
      h("div", { class: "mono muted", text: `ทับรอย ${Math.round(r.coverage * 100)}% · อยู่ในรอย ${Math.round(r.accuracy * 100)}%` }),
      r.badLetters.length ? h("div", {}, "ตัวอักษรที่พลาด (สีแดง): ", h("strong", { class: "bad", text: [...new Set(r.badLetters)].join(" ") })) : h("div", { class: "good", text: "ทับรอยครบทุกตัวอักษร" }),
      h("div", { text: levelMessage(doc) }));
    redrawActions();
  }

  function rate(v, resultBox, redrawActions) {
    const doc = saveAttempt({ selfRating: v });
    current.state = "done";
    resultBox.replaceChildren(h("div", { text: `ให้คะแนนตัวเอง: ${RATINGS[v].label}` }), h("div", { text: levelMessage(doc) }));
    redrawActions();
  }

  function nextWord() {
    const items = wordLists()[source];
    if (!items.length) return;
    const i = items.findIndex((x) => x.wordKey === current?.item.wordKey);
    selectWord(items[(i + 1) % items.length]);
  }

  // ================= แกลเลอรี =================
  function drawGallery() {
    const all = attempts().sort((a, b) => b.at - a.at);
    const words = [...new Map(all.map((a) => [a.wordKey, a.text])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const filtered = galleryFilter ? all.filter((a) => a.wordKey === galleryFilter) : all;
    const grid = h("div", { class: "hw-grid" });
    body.replaceChildren(
      h("section", { class: "card stack" },
        h("div", { class: "row" }, h("h2", { text: "ลายมือย้อนหลัง" }),
          h("select", { class: "input select", "aria-label": "กรองตามคำ", onchange: (e) => { galleryFilter = e.target.value; galleryShown = 40; drawGallery(); } },
            h("option", { value: "", text: `ทุกคำ (${all.length})` }), ...words.map(([k, t]) => h("option", { value: k, text: t, selected: k === galleryFilter })))),
        h("p", { class: "muted", text: "เรียงจากใหม่ไปเก่า — กรองตามคำเพื่อเทียบพัฒนาการ" }),
        filtered.length ? grid : h("p", { class: "muted", text: "ยังไม่มีลายมือที่บันทึกไว้" }),
        filtered.length > galleryShown ? h("button", { class: "btn btn--secondary", type: "button", text: `แสดงเพิ่ม (เหลือ ${filtered.length - galleryShown})`, onclick: () => { galleryShown += 40; drawGallery(); } }) : null));
    const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); loadImage(en.target); }
    }, { rootMargin: "200px" }) : null;
    stopObserver = () => io?.disconnect();
    for (const a of filtered.slice(0, galleryShown)) {
      const tile = h("figure", { class: "hw-tile", "data-id": a.id },
        h("div", { class: "hw-tile__img muted", text: "กำลังโหลดภาพ…" }),
        h("figcaption", { class: "mono" }, `${a.text} · ${HW.fonts[a.style]?.label} · ${core.LEVEL_LABELS[a.level]}`, h("br"),
          typeof a.score === "number" ? `คะแนน ${a.score}` : `ให้เอง: ${RATINGS[a.selfRating]?.label ?? "-"}`, " · ", fmtDate(a.at)));
      grid.append(tile);
      if (io) io.observe(tile); else loadImage(tile);
    }
  }

  async function loadImage(tile) {
    const holder = tile.querySelector(".hw-tile__img");
    const r = await db.imageGet(tile.dataset.id).catch(() => null);
    if (r?.doc?.dataUrl) holder.replaceChildren(h("img", { src: r.doc.dataUrl, alt: "ลายมือ", loading: "lazy" }));
    else holder.textContent = r?.from === "offline" ? "ภาพยังไม่อยู่ในเครื่อง (ต้องออนไลน์)" : "ไม่พบภาพ";
  }

  // ================= เริ่มต้น =================
  const unsub = db.subscribe(() => { if (tab === "write") drawSources(); });
  show();
  // ดาวน์โหลดฟอนต์ล่วงหน้าตอนออนไลน์ เพื่อให้ service worker cache ไว้ใช้ออฟไลน์
  if (navigator.onLine) for (const s of core.STYLES) hwr.ensureFont(s).catch(() => {});

  return () => {
    unsub();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHidden);
    flush();
    if (pad) pad.destroy();
    if (stopObserver) stopObserver();
    if (canSpeak) speechSynthesis.cancel();
  };
}

