import * as db from "../db.js";
import * as srs from "../srs.js";
import { h } from "../dom.js";
import { mount as mountAddWord } from "./addword.js";
import * as lib from "../library.js";
import { takeReviewScope, takeAddWordPrefill } from "../scope.js";

const MODES = [
  { value: "th-en", label: "ไทย → อังกฤษ" },
  { value: "en-th", label: "อังกฤษ → ไทย" },
  { value: "mixed", label: "คละ" },
];
const RESULT_TEXT = { correct: "ถูกต้อง", near: "เกือบถูก", wrong: "ยังไม่ถูก" };

const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
function speak(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  speechSynthesis.speak(u);
}
const speakBtn = (text) =>
  canSpeak ? h("button", { class: "btn btn--secondary btn--icon", type: "button", "aria-label": "ฟังเสียง", onclick: () => speak(text), text: "🔊" }) : null;

/** ไฮไลต์วลี en ในประโยคตัวอย่าง (ถ้าพบ) */
function highlight(example, phrase) {
  const p = phrase.trim();
  const i = p ? example.toLowerCase().indexOf(p.toLowerCase()) : -1;
  if (i < 0) return [example];
  return [example.slice(0, i), h("mark", { text: example.slice(i, i + p.length) }), example.slice(i + p.length)];
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function render(root, { toast }) {
  let tab = "review";        // review | list
  let editing = null;        // null | "new" | card
  let query = "";
  let mode = "mixed";
  let session = null;
  let scope = takeReviewScope();     // มาจากปุ่ม ▶ ของ Smart folder ในหน้าคลัง (ถ้ามี)
  if (scope) tab = "review";
  let addCleanup = null;
  let addPrefill = takeAddWordPrefill();     // มาจากบท Shadowing (ถ้ามี)
  if (addPrefill) tab = "add";

  const body = h("div");
  const tabBtn = (key, label) => h("button", {
    class: `btn ${tab === key ? "" : "btn--secondary"}`, type: "button", text: label,
    onclick: () => { if (session && !confirm("ออกจากรอบทบทวน? ที่ให้คะแนนแล้วถูกบันทึกไว้แล้ว")) return; session = null; tab = key; draw(); },
  });

  function draw() {
    if (addCleanup) { addCleanup(); addCleanup = null; }
    root.replaceChildren(
      h("div", { class: "page-head" }, h("h1", { text: "บัตรคำ" }), h("p", { class: "muted", text: "ทบทวนด้วย Spaced Repetition (SM-2)" })),
      h("div", { class: "row tabs" }, tabBtn("review", "ทบทวน"), tabBtn("list", "รายการ"), tabBtn("add", "เพิ่มคำ")),
      body
    );
    if (tab === "review") (session ? drawSession() : drawMenu());
    else if (tab === "add") { const pre = addPrefill; addPrefill = null; addCleanup = mountAddWord(body, { toast, prefill: pre, onSaved: () => { tab = "list"; draw(); } }); }
    else drawList();
  }

  // ================= รายการ =================
  function drawList() {
    const cards = db.list("cards").sort((a, b) => b.createdAt - a.createdAt);

    const search = h("input", { class: "input", type: "search", placeholder: "ค้นหาคำ ความหมาย ประโยค หรือแท็ก", value: query, "aria-label": "ค้นหา",
      oninput: (e) => { query = e.target.value; drawRows(); } });
    const rows = h("ul", { class: "list" });
    const count = h("p", { class: "muted mono" });
    function drawRows() {
      const qq = srs.normalize(query);
      const f = qq ? cards.filter((c) => srs.normalize([c.en, c.th, c.example, ...(c.tags || [])].join(" ")).includes(qq)) : cards;
      count.textContent = `${f.length} / ${cards.length} ใบ`;
      rows.replaceChildren(...f.map(cardRow));
      if (!f.length) rows.replaceChildren(h("li", { class: "muted", text: cards.length ? "ไม่พบบัตรที่ตรงกับคำค้น" : "ยังไม่มีบัตรคำ กด “เพิ่มบัตรคำ” เพื่อเริ่ม" }));
    }
    body.replaceChildren(
      h("div", { class: "row" }, search, h("button", { class: "btn", type: "button", text: "+ เพิ่มบัตรคำ", onclick: () => { editing = "new"; drawList(); } })),
      ...(editing ? [cardForm()] : []), count, rows
    );
    search.style.flex = "1";
    drawRows();
  }

  function cardRow(c) {
    return h("li", { class: "card-row" },
      h("div", { class: "card-row__main" },
        h("div", {}, h("strong", { text: c.en }), c.ipa ? h("span", { class: "mono muted", text: `  ${c.ipa}` }) : null, h("span", { text: `  ${c.th}` })),
        h("div", { class: "muted" }, ...highlight(c.example || "", c.en)),
        (c.tags || []).length ? h("div", { class: "row tags" }, ...c.tags.map((t) => h("span", { class: "badge", text: t }))) : null),
      h("div", { class: "row" },
        speakBtn(c.en),
        h("button", { class: "btn btn--secondary", type: "button", text: "แก้ไข", onclick: () => { editing = c; drawList(); } }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ลบ", onclick: () => {
          if (!confirm(`ลบบัตร “${c.en}” ?`)) return;
          db.softDelete("cards", c.id);
          toast("ลบแล้ว");
        } })));
  }

  function cardForm() {
    const c = editing === "new" ? { en: "", th: "", example: "", ipa: "", tags: [] } : editing;
    const f = {
      en: h("input", { class: "input", value: c.en, required: true, autocapitalize: "none", autocomplete: "off" }),
      th: h("input", { class: "input", value: c.th, required: true }),
      example: h("textarea", { class: "input", rows: 2, value: c.example || "", placeholder: "เช่น We ran out of milk yesterday." }),
      ipa: h("input", { class: "input", value: c.ipa || "", placeholder: "ไม่บังคับ" }),
      tags: h("input", { class: "input", value: (c.tags || []).join(", "), placeholder: "คั่นด้วยจุลภาค เช่น phrasal verb, daily" }),
    };
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    const field = (label, input, hint) => h("label", { class: "field" }, h("span", { text: label }), input, hint ? h("small", { class: "muted", text: hint }) : null);
    const wc = h("small", { class: "muted mono" });
    const updateWc = () => { const n = srs.wordCount(f.example.value); wc.textContent = `${n} คำ (ขั้นต่ำ ${srs.MIN_EXAMPLE_WORDS})`; };
    f.example.addEventListener("input", updateWc);
    updateWc();

    return h("form", { class: "card form", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const data = {
          en: f.en.value.trim(), th: f.th.value.trim(), example: f.example.value.trim(), ipa: f.ipa.value.trim(),
          tags: f.tags.value.split(",").map((t) => t.trim()).filter(Boolean),
        };
        const msg = srs.validateCard(data);
        err.hidden = !msg;
        if (msg) { err.textContent = msg; return; }
        if (editing === "new") db.create("cards", data); else db.update("cards", c.id, data);
        editing = null;
        drawList();
        toast("บันทึกแล้ว");
      } },
      h("h2", { text: editing === "new" ? "เพิ่มบัตรคำ" : "แก้ไขบัตรคำ" }),
      field("อังกฤษ (en)", f.en), field("ไทย (th)", f.th),
      field("ประโยคตัวอย่าง (≥ 4 คำ)", f.example, null), wc,
      field("IPA", f.ipa), field("แท็ก", f.tags), err,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "submit", text: "บันทึก" }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ยกเลิก", onclick: () => { editing = null; drawList(); } })));
  }

  // ================= ทบทวน: เมนู =================
  // ขอบเขต: null = ทุกบัตร (พฤติกรรมเดิมของเฟส 1) | { type: "folder", id } | { type: "tag", path }
  function scopeCriteriaNow() {
    if (scope?.type === "folder") {
      const f = db.get("smartFolders", scope.id);
      if (!f || f.deleted) { scope = null; return null; }
      return lib.scopeCriteria({ type: "folder", folder: f });
    }
    return lib.scopeCriteria(scope);
  }

  function dueInfo() {
    const all = db.list("cards");
    const reviews = db.list("reviews");
    const states = srs.stateMap(all, reviews);
    const now = Date.now();
    const crit = scopeCriteriaNow();
    const ids = scope?.type === "cards" ? new Set(scope.ids) : null;
    const cards = ids ? all.filter((c) => ids.has(c.id)) : crit ? lib.filterCards(all, crit, { states, wrong: lib.wrongCounts(reviews), now }) : all;
    const due = ids ? cards : cards.filter((c) => srs.isDue(states.get(c.id), now));     // กลุ่มจากกราฟ: ทบทวนได้ทั้งกลุ่มแม้ยังไม่ถึงรอบ
    return { cards, states, due, newCount: due.filter((c) => states.get(c.id).isNew).length };
  }

  function scopeSelect() {
    const folders = db.list("smartFolders").sort((a, b) => a.name.localeCompare(b.name));
    const paths = [];
    const walk = (nodes) => nodes.forEach((n) => { paths.push(n.path); walk(n.children); });
    walk(lib.buildTagTree(db.list("cards")));
    const value = scope ? (scope.type === "folder" ? `folder:${scope.id}` : scope.type === "cards" ? "group" : `tag:${scope.path}`) : "all";
    return h("label", { class: "field" }, h("span", { text: "ขอบเขตการทบทวน" }),
      h("select", { class: "input select", "aria-label": "ขอบเขตการทบทวน",
        onchange: (e) => {
          const v = e.target.value;
          if (v === "group") return;
          scope = v === "all" ? null : v.startsWith("folder:") ? { type: "folder", id: v.slice(7) } : { type: "tag", path: v.slice(4) };
          drawMenu();
        } },
        h("option", { value: "all", text: "ทุกบัตร", selected: value === "all" }),
        ...(scope?.type === "cards" ? [h("option", { value: "group", text: scope.label || "กลุ่มจากกราฟ", selected: true })] : []),
        ...(folders.length ? [h("optgroup", { label: "Smart folder" }, ...folders.map((f) => h("option", { value: `folder:${f.id}`, text: f.name, selected: value === `folder:${f.id}` })))] : []),
        ...(paths.length ? [h("optgroup", { label: "แท็ก (รวมแท็กลูก)" }, ...paths.map((p) => h("option", { value: `tag:${p}`, text: p, selected: value === `tag:${p}` })))] : [])));
  }

  function drawMenu() {
    const { due, newCount, cards } = dueInfo();
    const modeBtns = MODES.map((m) => h("button", {
      class: `btn ${mode === m.value ? "" : "btn--secondary"}`, type: "button", text: m.label, "aria-pressed": String(mode === m.value),
      onclick: () => { mode = m.value; drawMenu(); },
    }));
    body.replaceChildren(h("section", { class: "card stack" },
      h("div", { class: "big-num" }, h("span", { text: String(due.length) }), h("span", { class: "muted", text: " ใบถึงรอบทบทวน" })),
      h("p", { class: "muted", text: cards.length ? `ใหม่ ${newCount} · ทบทวนซ้ำ ${due.length - newCount} · ${scope ? "ในขอบเขตนี้" : "ทั้งหมด"} ${cards.length} ใบ` : scope ? "ไม่มีบัตรในขอบเขตนี้" : "ยังไม่มีบัตรคำ ไปที่แท็บ “รายการ” เพื่อเพิ่ม" }),
      scopeSelect(),
      h("div", { class: "row" }, ...modeBtns),
      h("div", {}, h("button", { class: "btn", type: "button", disabled: !due.length, text: "เริ่มทบทวน", onclick: () => startSession(due) }))));
  }

  // ================= ทบทวน: รอบ =================
  function startSession(due) {
    const info = dueInfo();
    session = {
      queue: shuffle(due.map((c) => c.id)),
      states: info.states,           // สถานะในรอบนี้ (อัปเดตทันที ไม่รอ snapshot)
      total: due.length, done: 0, forgot: 0,
      cur: null,
    };
    nextCard();
  }

  function nextCard() {
    while (session.queue.length) {
      const id = session.queue.shift();
      const card = db.get("cards", id);
      if (!card || card.deleted) continue;
      const m = mode === "mixed" ? (Math.random() < 0.5 ? "th-en" : "en-th") : mode;
      session.cur = { card, mode: m, answer: "", result: null, revealed: false };
      return draw();
    }
    session.cur = null;
    draw();
  }

  function drawSession() {
    const s = session;
    if (!s.cur) {
      body.replaceChildren(h("section", { class: "card stack" },
        h("h2", { text: "จบรอบทบทวนแล้ว 🎉" }),
        h("p", { text: `ให้คะแนน ${s.done} ครั้ง · ลืม ${s.forgot} ครั้ง` }),
        h("div", {}, h("button", { class: "btn", type: "button", text: "กลับ", onclick: () => { session = null; draw(); } }))));
      return;
    }
    const { card, mode: m } = s.cur;
    const progress = h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": s.total, "aria-valuenow": Math.min(s.done, s.total) },
      h("i", { style: `width:${Math.min(100, (s.done / (s.done + s.queue.length + 1)) * 100)}%` }));
    const prompt = m === "th-en"
      ? h("div", { class: "prompt" }, h("div", { class: "prompt__main", text: card.th }), h("div", { class: "muted", text: "พิมพ์คำภาษาอังกฤษ" }))
      : h("div", { class: "prompt" }, h("div", { class: "row" }, h("div", { class: "prompt__main", text: card.en }), speakBtn(card.en)),
          card.ipa ? h("div", { class: "mono muted", text: card.ipa }) : null);

    const parts = [progress, prompt];

    if (m === "th-en" && !s.cur.revealed) {
      const input = h("input", { class: "input", autocomplete: "off", autocapitalize: "none", spellcheck: false, "aria-label": "คำตอบภาษาอังกฤษ", placeholder: "คำตอบ…" });
      const check = () => {
        if (!input.value.trim()) { input.focus(); return; }
        s.cur.answer = input.value;
        s.cur.result = srs.checkAnswer(input.value, card.en);
        s.cur.revealed = true;
        draw();
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
      parts.push(h("div", { class: "row" }, input, h("button", { class: "btn", type: "button", text: "ตรวจคำตอบ", onclick: check })));
      body.replaceChildren(h("section", { class: "card stack" }, ...parts));
      input.style.flex = "1";
      input.focus();
      return;
    }

    if (!s.cur.revealed) {
      parts.push(h("div", {}, h("button", { class: "btn", type: "button", text: "เปิดเฉลย", onclick: () => { s.cur.revealed = true; draw(); } })));
      body.replaceChildren(h("section", { class: "card stack" }, ...parts));
      return;
    }

    // เฉลย + ให้คะแนน
    if (s.cur.result) {
      parts.push(h("div", { class: `result result--${s.cur.result}`, text: `${RESULT_TEXT[s.cur.result]} — คำตอบของคุณ: ${s.cur.answer}` }));
    }
    parts.push(h("div", { class: "answer stack" },
      h("div", { class: "row" }, h("strong", { class: "answer__en", text: card.en }), speakBtn(card.en), card.ipa ? h("span", { class: "mono muted", text: card.ipa }) : null),
      h("div", { text: card.th }),
      h("div", { class: "muted" }, ...highlight(card.example, card.en)),
      canSpeak ? h("div", {}, h("button", { class: "btn btn--secondary", type: "button", text: "🔊 ฟังประโยค", onclick: () => speak(card.example) })) : null));

    const now = Date.now();
    const state = s.states.get(card.id) || srs.initialState();
    const days = srs.previewIntervals(state, now);
    parts.push(h("div", { class: "rating" }, ...srs.RATINGS.map((r) =>
      h("button", { class: `btn btn--rate btn--rate-${r.value}`, type: "button", onclick: () => rate(r.value) },
        h("span", { text: r.label }),
        h("small", { class: "mono", text: r.value === 0 ? "ในรอบนี้" : srs.formatInterval(days[r.value]) })))));
    body.replaceChildren(h("section", { class: "card stack" }, ...parts));
  }

  function rate(rating) {
    const s = session, { card, mode: m, answer, result } = s.cur;
    const at = Date.now();
    db.append("reviews", { cardId: card.id, rating, mode: m, answer: answer || "", result: result || "none", at });
    s.states.set(card.id, srs.applyReview(s.states.get(card.id) || srs.initialState(), rating, at));
    s.done += 1;
    if (rating === 0) { s.forgot += 1; s.queue.push(card.id); }   // ลืม → กลับเข้าคิวท้ายรอบนี้
    nextCard();
  }

  const unsub = db.subscribe(() => {
    if (tab === "review" && !session) drawMenu();
    else if (tab === "list" && !editing) drawList();
  });
  draw();
  return () => { unsub(); if (addCleanup) addCleanup(); if (canSpeak) speechSynthesis.cancel(); };
}
