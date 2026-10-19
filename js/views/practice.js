// แท็บ "ฝึกเจาะจุด" ในหน้า Error Log: จุดเน้นสัปดาห์ + แบบฝึกที่สร้างในเครื่อง (ไม่ต้องใช้ AI) + โจทย์เพิ่มจาก AI (ถ้ามีคีย์)
import * as db from "../db.js";
import * as pr from "../practice.js";
import * as el from "../errlog.js";
import { describeError } from "../lexicon.js";
import { lexiconConfig } from "../localsettings.js";
import { h } from "../dom.js";

const DRILL_LABEL = { choose: "เลือกแบบที่ถูก", recall: "พิมพ์แบบที่ถูกจากความจำ", cloze: "เติมคำในช่องว่าง" };

export function mount(root, { toast }) {
  let session = null;                 // { error, drills, i, results[], events[], cur: null | { correct, shown } }
  const aiDrills = new Map();         // errorId → โจทย์ AI ที่สร้างไว้ (อยู่ในหน้านี้เท่านั้น ไม่ซิงก์)
  let aiBusy = null;
  const box = h("div", { class: "stack" });
  root.replaceChildren(box);

  const field = (label, input) => h("label", { class: "field" }, h("span", { text: label }), input);

  function data() {
    const errors = db.list("errors");
    const errorEvents = db.list("errorEvents");
    return { errors, errorEvents, cards: db.list("cards"), practiceEvents: db.list("practiceEvents"), stats: el.errorStats(errors, errorEvents) };
  }

  // ================= หน้าหลัก =================
  function drawHome() {
    const { errors, errorEvents, cards, practiceEvents, stats } = data();
    const now = Date.now();
    const settings = db.getSettings();
    const focus = pr.focusErrors({ errors, events: errorEvents, focus: settings.focus, now });
    const open = errors.filter((e) => !stats.get(e.id).resolved);
    const hasKey = Boolean(lexiconConfig().apiKey);

    const suggestions = open.map((e) => ({ e, r: pr.resolveSuggestion({ errorId: e.id, practiceEvents, errorEvents }) })).filter((x) => x.r.suggest);

    const focusCards = focus.items.map(({ error, count }) => {
      const related = pr.relatedCards(error, cards).length;
      const ai = aiDrills.get(error.id);
      return h("div", { class: "card stack" },
        h("div", {}, h("s", { class: "bad", text: error.wrong }), "  →  ", h("strong", { class: "good", text: error.right })),
        h("div", { class: "row tags" }, h("span", { class: "badge", text: error.category }), h("span", { class: "mono muted", text: `ผิด ${count} ครั้งใน ${pr.FOCUS_DAYS} วัน` }),
          h("span", { class: "mono muted", text: related ? `บัตรที่เกี่ยวข้อง ${related} ใบ` : "ยังไม่มีบัตรที่เกี่ยวข้อง (ไม่มีข้อเติมช่องจากบัตร)" }),
          ai ? h("span", { class: "badge", text: `โจทย์ AI ${ai.length} ข้อ` }) : null),
        error.note ? h("div", { class: "muted", text: error.note }) : null,
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", text: "เริ่มฝึก", onclick: () => start(error) }),
          hasKey ? h("button", { class: "btn btn--secondary", type: "button", disabled: aiBusy === error.id, text: aiBusy === error.id ? "กำลังสร้างโจทย์…" : "สร้างโจทย์เพิ่มด้วย AI", onclick: () => makeAi(error) }) : null));
    });

    box.replaceChildren(...[
      ...suggestions.map(({ e, r }) => h("div", { class: "notice stack", role: "status" },
        h("strong", { text: `ทำถูกติดต่อกัน ${pr.RESOLVE_STREAK_DAYS} วันแล้ว: “${e.right}”` }),
        h("div", { class: "muted", text: `วันที่ฝึก ${r.days.map((d) => d.key).join(", ")} — ถือว่าแก้ได้แล้วไหม?` }),
        h("div", { class: "row" }, h("button", { class: "btn", type: "button", text: "แก้ได้แล้ว", onclick: () => markResolved(e.id) })))),
      h("section", { class: "stack" },
        h("div", { class: "row" }, h("h2", { text: "จุดเน้นสัปดาห์" }),
          h("span", { class: "badge", text: focus.source === "user" ? "คุณเลือกเอง" : "เลือกอัตโนมัติ (30 วันล่าสุด)" })),
        ...(focusCards.length ? focusCards : [h("p", { class: "muted", text: "ยังไม่มีข้อผิดที่ยังไม่แก้และเกิดขึ้นใน 30 วันที่ผ่านมา — จดข้อผิดที่แท็บ “รายการ” แล้วกลับมาฝึกที่นี่" })])),
      open.length ? focusPicker(open, focus, now) : null,
      open.length > focus.items.length ? otherErrors(open, focus) : null,
    ].filter(Boolean));
  }

  function focusPicker(open, focus, now) {
    const picked = new Set(focus.items.map((x) => x.error.id));
    const boxes = open.map((e) => h("label", { class: "row check" },
      h("input", { type: "checkbox", checked: picked.has(e.id), value: e.id, onchange: (ev) => {
        const on = [...pickerRoot.querySelectorAll("input:checked")];
        if (on.length > pr.FOCUS_LIMIT) { ev.target.checked = false; toast(`เลือกได้ไม่เกิน ${pr.FOCUS_LIMIT} เรื่อง`); }
      } }),
      h("span", {}, h("s", { class: "bad", text: e.wrong }), " → ", e.right)));
    const pickerRoot = h("div", { class: "stack" }, ...boxes);
    return h("details", { class: "lex-details" }, h("summary", { text: "เปลี่ยนจุดเน้นสัปดาห์" }),
      h("p", { class: "muted", text: `เลือกได้สูงสุด ${pr.FOCUS_LIMIT} เรื่อง มีผลถึงสิ้นสัปดาห์นี้ (จันทร์–อาทิตย์) แล้วกลับเป็นอัตโนมัติ` }),
      pickerRoot,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", text: "บันทึกจุดเน้น", onclick: () => {
          const ids = [...pickerRoot.querySelectorAll("input:checked")].map((i) => i.value);
          if (!ids.length) { toast("เลือกอย่างน้อย 1 เรื่อง หรือกด “ใช้ค่าอัตโนมัติ”"); return; }
          db.saveSettings({ focus: { weekKey: pr.weekKey(now), errorIds: ids } });
          toast("บันทึกจุดเน้นแล้ว");
          drawHome();
        } }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ใช้ค่าอัตโนมัติ", onclick: () => { db.saveSettings({ focus: { weekKey: "", errorIds: [] } }); drawHome(); } })));
  }

  function otherErrors(open, focus) {
    const inFocus = new Set(focus.items.map((x) => x.error.id));
    return h("section", { class: "card stack" }, h("h2", { text: "ข้อผิดอื่นที่ยังไม่แก้" }),
      h("ul", { class: "list" }, ...open.filter((e) => !inFocus.has(e.id)).map((e) => h("li", { class: "card-row" },
        h("div", { class: "card-row__main" }, h("div", {}, h("s", { class: "bad", text: e.wrong }), " → ", h("strong", { text: e.right })), h("span", { class: "badge", text: e.category })),
        h("button", { class: "btn btn--secondary", type: "button", text: "ฝึกข้อนี้", onclick: () => start(e) })))));
  }

  function markResolved(errorId) {
    db.append("errorEvents", { errorId, type: "resolved", at: Date.now() });
    toast("ทำเครื่องหมายว่าแก้ได้แล้ว");
    if (session) { session = null; }
    drawHome();
  }

  async function makeAi(error) {
    if (aiBusy) return;
    const cfg = lexiconConfig();
    aiBusy = error.id;
    drawHome();
    try {
      const items = await pr.fetchAiDrills(error, { apiKey: cfg.apiKey, model: cfg.model });
      aiDrills.set(error.id, items);
      toast(`AI สร้างโจทย์ ${items.length} ข้อแล้ว — จะรวมอยู่ในการฝึกครั้งถัดไป`);
    } catch (e) {
      toast(describeError(e));
    } finally {
      aiBusy = null;
      if (!session) drawHome();
    }
  }

  // ================= รอบฝึก =================
  function start(error) {
    const { cards } = data();
    const drills = [...pr.buildDrills(error, cards), ...(aiDrills.get(error.id) || [])];
    session = { error, drills, i: 0, results: [], events: [], cur: null };
    drawDrill();
  }

  function record(correct) {
    const s = session, d = s.drills[s.i];
    const doc = db.append("practiceEvents", { errorId: s.error.id, drill: d.type, correct, at: Date.now(), ...(d.ai ? { ai: true } : {}), ...(d.cardId ? { cardId: d.cardId } : {}) });
    s.events.push(doc);
    s.results.push(correct);
    s.cur = { correct };
  }

  function next() {
    session.i++;
    session.cur = null;
    if (session.i >= session.drills.length) drawSummary(); else drawDrill();
  }

  function drawDrill() {
    const s = session, d = s.drills[s.i];
    const head = h("div", { class: "stack" },
      h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": s.drills.length, "aria-valuenow": s.i }, h("i", { style: `width:${(s.i / s.drills.length) * 100}%` })),
      h("div", { class: "row" }, h("span", { class: "badge", text: `ข้อ ${s.i + 1}/${s.drills.length}` }), h("span", { class: "badge", text: DRILL_LABEL[d.type] }), d.ai ? h("span", { class: "badge badge--sample", text: "โจทย์จาก AI" }) : null));
    const feedback = () => h("div", { class: "stack", role: "status" },
      h("div", { class: s.cur.correct ? "good" : "bad", text: s.cur.correct ? "✓ ถูกต้อง" : "✗ ยังไม่ถูก" }),
      !s.cur.correct ? h("div", {}, "คำตอบที่ถูก: ", h("strong", { text: d.answer })) : null,
      h("div", {}, h("button", { class: "btn", type: "button", text: s.i + 1 >= s.drills.length ? "ดูสรุป" : "ข้อถัดไป", onclick: next })));

    let body;
    if (d.type === "choose") {
      body = h("div", { class: "stack" }, h("p", { class: "prompt__main", text: "ข้อไหนถูก?" }),
        h("div", { class: "stack" }, ...d.options.map((o) => h("button", { class: "btn btn--secondary btn--answer", type: "button", disabled: Boolean(s.cur), text: o,
          onclick: () => { record(o === d.answer); drawDrill(); } }))),
        s.cur ? feedback() : null);
    } else {
      const input = h("input", { class: "input", autocomplete: "off", autocapitalize: "none", spellcheck: false, disabled: Boolean(s.cur), "aria-label": "คำตอบ", placeholder: "พิมพ์คำตอบ…" });
      const check = () => { if (!input.value.trim()) { input.focus(); return; } record(pr.checkExact(input.value, d.answer)); drawDrill(); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !s.cur) check(); });
      body = h("div", { class: "stack" },
        d.type === "recall"
          ? h("div", { class: "stack" }, h("p", { class: "muted", text: "ประโยค/วลีนี้ผิด พิมพ์แบบที่ถูกแทนจากความจำ" }), h("p", { class: "prompt__main" }, h("s", { class: "bad", text: d.prompt })))
          : h("div", { class: "stack" }, h("p", { class: "muted", text: d.ai ? "เติมคำที่ขาด" : "เติมวลีที่ขาด (จากประโยคตัวอย่างในบัตรคำของคุณ)" }), h("p", { class: "prompt__main", text: d.sentence }), d.hint ? h("p", { class: "muted", text: `คำใบ้: ${d.hint}` }) : null),
        h("div", { class: "row" }, input, h("button", { class: "btn", type: "button", disabled: Boolean(s.cur), text: "ตรวจคำตอบ", onclick: check })),
        s.cur ? feedback() : null);
      input.style.flex = "1";
      if (!s.cur) queueMicrotask(() => input.focus());
    }
    box.replaceChildren(h("section", { class: "card stack" }, head, body, h("div", {}, h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ออกจากการฝึก", onclick: () => { session = null; drawHome(); } }))));
  }

  function drawSummary() {
    const s = session;
    const ok = s.results.filter(Boolean).length;
    const d = data();
    const mine = [...d.practiceEvents, ...s.events.filter((e) => !d.practiceEvents.some((p) => p.id === e.id))];
    const sug = pr.resolveSuggestion({ errorId: s.error.id, practiceEvents: mine, errorEvents: d.errorEvents });
    box.replaceChildren(h("section", { class: "card stack" },
      h("h2", { text: "จบรอบฝึกแล้ว" }),
      h("p", {}, `ตอบถูก `, h("strong", { text: `${ok}/${s.results.length}` }), " ข้อ"),
      h("div", { class: "muted" }, h("s", { text: s.error.wrong }), " → ", s.error.right),
      sug.suggest ? h("div", { class: "notice stack", role: "status" }, h("strong", { text: `ทำถูกติดต่อกัน ${pr.RESOLVE_STREAK_DAYS} วันแล้ว — ถือว่าแก้ได้แล้วไหม?` }),
        h("div", {}, h("button", { class: "btn", type: "button", text: "แก้ได้แล้ว", onclick: () => markResolved(s.error.id) }))) : null,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", text: "ฝึกอีกรอบ", onclick: () => start(s.error) }),
        h("button", { class: "btn btn--secondary", type: "button", text: "กลับ", onclick: () => { session = null; drawHome(); } }))));
  }

  const unsub = db.subscribe(() => { if (!session && !aiBusy) drawHome(); });
  drawHome();
  return unsub;
}
