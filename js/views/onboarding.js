// Onboarding ครั้งแรกหลังล็อกอิน (ข้ามได้ แก้ทีหลังได้ใน Settings):
// ประเมินตัวเอง 4 ทักษะ + EF SET (ไม่บังคับ) → เป้าหมาย SMART → เวลาเรียนต่อวัน → ระบบเสนอขั้นเริ่มต้นให้ยืนยัน
import * as db from "../db.js";
import * as rl from "../roadmap-logic.js";
import { ROADMAP } from "../data/roadmap.js";
import { planFor, SEGMENTS } from "../timer.js";
import { h } from "../dom.js";

const DAILY_OPTIONS = [30, 45, 60, 90];
const STEPS = ["ประเมินตัวเอง", "เป้าหมาย", "เวลาเรียน", "ขั้นเริ่มต้น"];

export function render(root, { toast }) {
  const saved = db.getSettings();
  const ob = saved.onboarding || {};
  const d = {
    selfAssess: { ...(ob.selfAssess || {}) },
    efSet: { level: ob.efSet?.level || "", score: ob.efSet?.score ?? "" },
    goal: { type: ob.goal?.type || "cefr", target: ob.goal?.target || "B2", examName: ob.goal?.examName || "", date: ob.goal?.date || "" },
    dailyMinutes: saved.dailyMinutes || 60,
    stage: null,
  };
  let step = 0;

  const body = h("div");
  const nav = h("div", { class: "row" });
  const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "เริ่มต้นกับ EngPath" }), h("p", { class: "muted", text: "ตอบสั้น ๆ 4 ขั้น เพื่อให้แอปเสนอขั้นเริ่มต้นและแผนเวลาที่เหมาะกับคุณ ข้ามได้ แก้ทีหลังได้ใน “ตั้งค่า”" })),
    h("section", { class: "card stack" }, h("div", { class: "row steps", "aria-label": "ขั้นตอน" }), body, err, nav)
  );
  const stepsEl = root.querySelector(".steps");

  const field = (label, el, hint) => h("label", { class: "field" }, h("span", { text: label }), el, hint ? h("small", { class: "muted", text: hint }) : null);
  const showErr = (m) => { err.hidden = !m; err.textContent = m || ""; };

  const levelSelect = (value, onchange, { levels = rl.LEVELS, blank = "ยังไม่แน่ใจ" } = {}) =>
    h("select", { class: "input select", onchange: (e) => onchange(e.target.value) },
      h("option", { value: "", text: blank, selected: !value }), ...levels.map((l) => h("option", { value: l, text: l, selected: l === value })));

  function draw() {
    showErr("");
    stepsEl.replaceChildren(...STEPS.map((s, i) => h("span", { class: `badge ${i === step ? "" : "badge--off"}`, text: `${i + 1}. ${s}` })));
    if (step === 0) body.replaceChildren(stepSelf());
    if (step === 1) body.replaceChildren(stepGoal());
    if (step === 2) body.replaceChildren(stepDaily());
    if (step === 3) body.replaceChildren(stepStage());
    nav.replaceChildren(...[
      step > 0 ? h("button", { class: "btn btn--secondary", type: "button", text: "ย้อนกลับ", onclick: () => { step--; draw(); } }) : null,
      step < 3 ? h("button", { class: "btn", type: "button", text: "ถัดไป", onclick: next }) : h("button", { class: "btn", type: "button", text: "ยืนยันและเริ่มเรียน", onclick: finish }),
      h("button", { class: "btn btn--secondary", type: "button", text: "ข้ามไปก่อน", onclick: skip }),
    ].filter(Boolean));
  }

  function stepSelf() {
    const score = h("input", { class: "input", type: "number", min: "0", max: "100", inputmode: "numeric", value: d.efSet.score, placeholder: "เช่น 58",
      oninput: (e) => { d.efSet.score = e.target.value; } });
    return h("div", { class: "stack" },
      h("p", { text: "ระดับภาษาอังกฤษของคุณแต่ละทักษะตอนนี้ (A1 = เริ่มต้น … C1 = คล่อง) เดาคร่าว ๆ ได้ ถ้าไม่แน่ใจเลือก “ยังไม่แน่ใจ”" }),
      h("div", { class: "grid2 form-grid" }, ...rl.SKILLS.map((s) => field(s.label, levelSelect(d.selfAssess[s.key], (v) => { d.selfAssess[s.key] = v; })))),
      h("details", { class: "lex-details", open: Boolean(d.efSet.level || d.efSet.score !== "") },
        h("summary", { text: "ผลสอบ EF SET (ไม่บังคับ)" }),
        h("p", { class: "muted", text: "ถ้าเคยทำแบบทดสอบ EF SET ใส่ผลตรงนี้ได้ ระบบจะใช้ระดับจาก EF SET เป็นหลัก" }),
        h("div", { class: "grid2 form-grid" }, field("ระดับที่ได้", levelSelect(d.efSet.level, (v) => { d.efSet.level = v; }, { levels: rl.EF_LEVELS, blank: "ไม่ได้ทำ" })), field("คะแนน (0–100)", score))));
  }

  function stepGoal() {
    const g = d.goal;
    const dateIn = h("input", { class: "input", type: "date", value: g.date, "aria-label": "วันที่ต้องการบรรลุเป้าหมาย", onchange: (e) => { g.date = e.target.value; } });
    const addMonths = (n) => { const x = new Date(); x.setMonth(x.getMonth() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    const typeBtn = (v, label) => h("button", { class: `btn ${g.type === v ? "" : "btn--secondary"}`, type: "button", text: label, "aria-pressed": String(g.type === v), onclick: () => { g.type = v; draw(); } });
    return h("div", { class: "stack" },
      h("p", { text: "ตั้งเป้าหมายแบบ SMART: ชัดเจน วัดผลได้ และมีวันที่กำกับ เช่น “ถึงระดับ B2 ภายใน 10 เดือน”" }),
      h("div", { class: "row" }, typeBtn("cefr", "ระดับ CEFR"), typeBtn("exam", "คะแนนสอบ")),
      g.type === "cefr"
        ? field("ระดับที่ต้องการ", h("select", { class: "input select", onchange: (e) => { g.target = e.target.value; } }, ...rl.LEVELS.map((l) => h("option", { value: l, text: l, selected: l === g.target }))))
        : h("div", { class: "grid2 form-grid" },
            field("ชื่อข้อสอบ", h("input", { class: "input", value: g.examName, placeholder: "เช่น IELTS, TGAT1", oninput: (e) => { g.examName = e.target.value; } })),
            field("คะแนนที่ต้องการ", h("input", { class: "input", value: g.type === "exam" && !rl.LEVELS.includes(g.target) ? g.target : "", placeholder: "เช่น 6.5", oninput: (e) => { g.target = e.target.value; } }))),
      field("ภายในวันที่", dateIn),
      h("div", { class: "row" }, ...[3, 6, 10].map((n) => h("button", { class: "btn btn--secondary btn--chip", type: "button", text: `อีก ${n} เดือน`, onclick: () => { g.date = addMonths(n); draw(); } }))));
  }

  function stepDaily() {
    return h("div", { class: "stack" },
      h("p", { text: "ตั้งเวลาเรียนต่อวัน (Roadmap แนะนำ 30–60 นาที และผูกกับกิจวัตรเดิม เช่น หลังอาหารเย็น) แอปจะแบ่งเวลาเป็น 4 ช่วงให้อัตโนมัติ" }),
      h("div", { class: "row" }, ...DAILY_OPTIONS.map((m) => h("button", {
        class: `btn ${d.dailyMinutes === m ? "" : "btn--secondary"}`, type: "button", text: `${m} นาที`, "aria-pressed": String(d.dailyMinutes === m),
        onclick: () => { d.dailyMinutes = m; draw(); } }))));
  }

  function suggestion() {
    const self = {};
    for (const s of rl.SKILLS) if (d.selfAssess[s.key]) self[s.key] = d.selfAssess[s.key];
    return rl.suggestStage({ selfAssess: self, efSet: { level: d.efSet.level } });
  }

  function stepStage() {
    const sug = suggestion();
    if (d.stage === null) d.stage = sug.stage;
    const why = sug.source === "efset" ? `จากผล EF SET (ระดับ ${sug.level})`
      : sug.source === "self" ? `จากการประเมินตัวเอง (ระดับเฉลี่ย ${sug.level})`
      : "ยังไม่มีข้อมูลระดับ จึงเริ่มจากขั้น 0 เพื่อวัดระดับก่อน";
    const plan = planFor(d.stage, d.dailyMinutes);
    return h("div", { class: "stack" },
      h("p", {}, `ระบบเสนอให้เริ่มที่ `, h("strong", { text: `ขั้น ${sug.stage}: ${ROADMAP[sug.stage].name}` }), ` ${why}`),
      h("p", { class: "muted", text: "เปลี่ยนได้ถ้าคิดว่าขั้นอื่นเหมาะกว่า (สลับขั้นได้ทุกเมื่อในหน้า “วันนี้”)" }),
      h("div", { class: "row", role: "group", "aria-label": "เลือกขั้นเริ่มต้น" }, ...ROADMAP.map((s) => h("button", {
        class: `btn ${d.stage === s.stage ? "" : "btn--secondary"}`, type: "button", text: `ขั้น ${s.stage}`, "aria-pressed": String(d.stage === s.stage),
        onclick: () => { d.stage = s.stage; draw(); } }))),
      h("div", { class: "answer stack" },
        h("strong", { text: `ขั้น ${d.stage} · ${ROADMAP[d.stage].cefr} · ${ROADMAP[d.stage].duration}` }),
        h("div", { class: "muted", text: ROADMAP[d.stage].goal }),
        h("div", { class: "mono", text: `เวลาต่อวัน ${d.dailyMinutes} นาที = ${SEGMENTS.map((s, i) => `${s.label} ${plan[i]}`).join(" / ")}` })));
  }

  function validateStep() {
    if (step === 0 && d.efSet.score !== "" && !(Number(d.efSet.score) >= 0 && Number(d.efSet.score) <= 100)) return "คะแนน EF SET ต้องเป็นตัวเลข 0–100";
    if (step === 1) return rl.validateGoal(d.goal, Date.now());
    return null;
  }

  function next() {
    const m = validateStep();
    if (m) { showErr(m); return; }
    step++;
    if (step === 3) d.stage = null;       // คำนวณข้อเสนอใหม่จากคำตอบล่าสุด
    draw();
  }

  function finish() {
    const m = rl.validateGoal(d.goal, Date.now());
    if (m) { step = 1; draw(); showErr(m); return; }
    // เขียนครบทุกคีย์ (ค่าว่าง = ไม่ระบุ) เพราะ merge ใน Firestore ลบคีย์เดิมให้ไม่ได้ เวลาทำ Onboarding ซ้ำ
    const selfAssess = Object.fromEntries(rl.SKILLS.map((s) => [s.key, d.selfAssess[s.key] || ""]));
    const efSet = { level: d.efSet.level || "", score: d.efSet.score !== "" ? Number(d.efSet.score) : null };
    const goal = d.goal.type === "cefr" ? { type: "cefr", target: d.goal.target, date: d.goal.date }
      : { type: "exam", examName: d.goal.examName.trim(), target: String(d.goal.target).trim(), date: d.goal.date };
    db.saveSettings({ stage: d.stage, dailyMinutes: d.dailyMinutes, onboarding: { done: true, skipped: false, doneAt: Date.now(), selfAssess, efSet, goal } });
    toast("ตั้งค่าเริ่มต้นเรียบร้อย");
    location.hash = "#/today";
  }

  function skip() {
    if (db.getSettings().onboarding?.done) { location.hash = "#/settings"; return; }   // ทำเสร็จไปแล้ว: ออกโดยไม่แก้อะไร
    db.saveSettings({ onboarding: { done: false, skipped: true, skippedAt: Date.now() } });
    toast("ข้ามไปก่อน — กลับมาตั้งค่าได้ที่หน้า “ตั้งค่า” หรือ “Roadmap”");
    location.hash = "#/today";
  }

  draw();
}
