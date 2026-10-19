// หน้า Roadmap: ไทม์ไลน์ 6 ขั้น, ขั้นปัจจุบันเปิดรายละเอียดเต็ม, เช็กลิสต์เกณฑ์ผ่าน, วงจร checkpoint + ประวัติ
import * as db from "../db.js";
import * as rl from "../roadmap-logic.js";
import { ROADMAP, ALWAYS_DO, REVIEW_CYCLE } from "../data/roadmap.js";
import { h } from "../dom.js";

const fmtDate = (ts) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(ts));
const skillLabel = Object.fromEntries(rl.SKILLS.map((s) => [s.key, s.label]));

export function render(root, { toast }) {
  let showForm = false;
  let result = null;      // ผลล่าสุดหลังบันทึก checkpoint (แสดงในหน้านี้เท่านั้น)

  const body = h("div", { class: "stack" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "Roadmap" }), h("p", { class: "muted", text: "6 ขั้นจาก A1 → C1 ตามแผน" })),
    body
  );

  const settings = () => db.getSettings();
  const setCriterion = (stage, idx, value) => db.saveSettings({ criteria: { [rl.criterionKey(stage, idx)]: value } });

  function draw() {
    const st = settings();
    const cps = db.list("checkpoints").filter(rl.isValidCheckpoint);
    const events = db.list("errorEvents");
    const now = Date.now();
    body.replaceChildren(...[
      summaryCard(st),
      checkpointCard(st, cps, now),
      h("div", { class: "stack" }, ...ROADMAP.map((s) => stageCard(s, st, cps, events, now))),
      h("section", { class: "card stack" },
        h("h2", { text: "ทำควบคู่ทุกขั้น" }),
        h("ul", { class: "plain-list" }, ...ALWAYS_DO.map((t) => h("li", { text: t }))),
        h("h2", { text: REVIEW_CYCLE.title }), h("p", { text: REVIEW_CYCLE.text }),
        h("div", {}, h("a", { class: "btn btn--secondary", href: "#/techniques", text: "ดูเทคนิคการเรียน 8 ข้อ →" }))),
    ].filter(Boolean));
  }

  function summaryCard(st) {
    const ob = st.onboarding;
    const goal = ob?.goal;
    const goalText = goal ? `${goal.type === "exam" ? `${goal.examName} ${goal.target}` : `ระดับ ${goal.target}`} ภายใน ${goal.date}` : null;
    return h("section", { class: "card stack" },
      h("div", { class: "row" }, h("h2", { text: `ขั้นปัจจุบัน: ${st.stage} · ${ROADMAP[st.stage].name}` }), h("span", { class: "badge", text: ROADMAP[st.stage].cefr })),
      goalText ? h("p", {}, h("strong", { text: "เป้าหมาย: " }), goalText) : h("p", { class: "muted", text: ob?.skipped ? "ยังไม่ได้ตั้งเป้าหมาย (ข้าม Onboarding ไว้)" : "ยังไม่ได้ตั้งเป้าหมาย" }),
      h("p", { class: "muted", text: `เวลาเรียนต่อวัน ${st.dailyMinutes} นาที` }),
      !ob?.done ? h("div", {}, h("a", { class: "btn btn--secondary", href: "#/onboarding", text: ob?.skipped ? "ตั้งเป้าหมายและเลือกขั้นเริ่มต้น" : "เริ่ม Onboarding" })) : null);
  }

  function checkpointCard(st, cps, now) {
    const s = rl.checkpointStatus({ checkpoints: cps, onboarding: st.onboarding, weeks: st.checkpointWeeks, now });
    const sorted = [...cps].sort((a, b) => b.at - a.at);
    const when = s.baseline == null ? "ยังไม่มีจุดเริ่มต้นของรอบ (ทำ Onboarding หรือบันทึก checkpoint แรกได้เลย)"
      : s.due ? `ถึงรอบแล้ว (ครบกำหนดเมื่อ ${fmtDate(s.dueAt)})` : `รอบถัดไป ${fmtDate(s.dueAt)} (อีก ${s.daysLeft} วัน)`;
    return h("section", { class: "card stack" },
      h("div", { class: "row" }, h("h2", { text: "Checkpoint" }), s.due ? h("span", { class: "badge badge--sample", text: "ถึงรอบ" }) : null),
      h("p", { class: s.due ? "bad" : "muted", text: `วงจรทุก ${st.checkpointWeeks} สัปดาห์ · ${when}` }),
      result ? resultPanel(result) : null,
      showForm ? checkpointForm(st) : h("div", {}, h("button", { class: "btn", type: "button", text: "บันทึกผล checkpoint", onclick: () => { showForm = true; result = null; draw(); } })),
      sorted.length ? h("div", { class: "stack" }, h("h3", { text: "ประวัติ checkpoint" }), h("ul", { class: "list" }, ...sorted.map(historyRow))) : null);
  }

  function historyRow(c) {
    const scoreText = rl.SKILLS.filter((s) => typeof c.scores?.[s.key] === "number").map((s) => `${s.label} ${c.scores[s.key]}`).join(" · ");
    return h("li", { class: "card-row" },
      h("div", { class: "card-row__main" },
        h("div", {}, h("strong", { text: fmtDate(c.at) }), h("span", { class: "muted", text: `  ขั้น ${c.stage}` })),
        h("div", { class: "mono", text: scoreText }),
        c.mockExam ? h("div", { class: "muted", text: `ข้อสอบจำลอง ${c.mockExam.score}/${c.mockExam.target}` }) : null,
        c.weakSkills?.length ? h("div", { class: "muted", text: `ต้องเสริม: ${c.weakSkills.map((k) => skillLabel[k]).join(", ")}` }) : null,
        c.note ? h("div", { class: "muted", text: c.note }) : null),
      h("span", { class: `badge ${c.passed ? "" : "badge--sample"}`, text: c.passed ? "ผ่านขั้น" : "ยังไม่ผ่าน" }));
  }

  function resultPanel(r) {
    const next = r.stage + 1;
    return h("div", { class: `notice ${r.passed ? "" : "notice--warn"} stack`, role: "status" },
      r.passed
        ? [h("strong", { text: `🎉 ผ่านขั้น ${r.stage} แล้ว` }),
           next <= 5 ? h("div", { class: "row" },
             h("span", { text: `ปลดล็อกขั้น ${next}: ${ROADMAP[next].name}` }),
             db.getSettings().stage === r.stage
               ? h("button", { class: "btn", type: "button", text: `ไปขั้น ${next}`, onclick: () => {
                   if (!confirm(`เปลี่ยนขั้นปัจจุบันเป็นขั้น ${next}? (ตัวจับเวลาจะเริ่มตามสัดส่วนของขั้นใหม่)`)) return;
                   db.saveSettings({ stage: next });
                   toast(`เปลี่ยนเป็นขั้น ${next} แล้ว`);
                   result = null; draw();
                 } })
               : h("span", { class: "muted", text: "(ขั้นปัจจุบันเปลี่ยนไปแล้ว)" }))
             : h("span", { text: "คุณผ่านครบทุกขั้นของ Roadmap แล้ว — ใช้งานต่อเนื่องในขั้น 5 ได้เลย" })]
        : [h("strong", { text: `ยังไม่ผ่านเกณฑ์ขั้น ${r.stage} — ขั้นของคุณยังคงอยู่ที่ขั้น ${r.stage} (ไม่รีเซ็ต)` }),
           r.unmet.length ? h("div", {}, "เกณฑ์ที่ยังไม่ได้ติ๊ก:", h("ul", { class: "plain-list" }, ...r.unmet.map((t) => h("li", { text: t })))) : null,
           r.weak.length ? h("div", {}, h("div", { text: "ทักษะที่ควรเสริม (คำแนะนำของแอป ไม่ได้มาจากไฟล์ Roadmap):" }), h("ul", { class: "plain-list" }, ...r.weak.map((k) => h("li", { text: rl.WEAK_ADVICE[k] })))) : h("div", { class: "muted", text: `คะแนนทุกทักษะที่ใส่ไม่ต่ำกว่า ${rl.PASS_SCORE} — โฟกัสที่เกณฑ์ที่ยังไม่ได้ติ๊กด้านบน` })]);
  }

  function checkpointForm(st) {
    const stage = st.stage;
    const scoreInputs = Object.fromEntries(rl.SKILLS.map((s) => [s.key, h("input", { class: "input", type: "number", min: "0", max: "100", inputmode: "numeric", placeholder: "0–100", "aria-label": `คะแนน${s.label}` })]));
    const mockScore = h("input", { class: "input", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "คะแนนที่ได้", "aria-label": "คะแนนข้อสอบจำลอง" });
    const mockTarget = h("input", { class: "input", type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "คะแนนเป้า", "aria-label": "คะแนนเป้าข้อสอบจำลอง" });
    const note = h("textarea", { class: "input", rows: 2, placeholder: "โน้ต (ไม่บังคับ) เช่น ข้อสอบที่ใช้, สิ่งที่รู้สึกว่าอ่อน" });
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    const field = (label, el) => h("label", { class: "field" }, h("span", { text: label }), el);
    const num = (el) => (el.value === "" ? undefined : Number(el.value));

    return h("form", { class: "card form", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const scores = {};
        for (const s of rl.SKILLS) { const v = num(scoreInputs[s.key]); if (v !== undefined) scores[s.key] = v; }
        const ms = num(mockScore), mt = num(mockTarget);
        const mockExam = ms !== undefined || mt !== undefined ? { score: ms, target: mt } : null;
        const msg = rl.validateCheckpoint({ scores, mockExam });
        err.hidden = !msg;
        if (msg) { err.textContent = msg; return; }
        const prog = rl.stageProgress(db.getSettings().criteria, stage);
        const weak = rl.weakSkills(scores);
        const unmet = ROADMAP[stage].criteria.filter((_, i) => db.getSettings().criteria?.[rl.criterionKey(stage, i)] !== true).map((c) => c.text);
        const doc = { at: Date.now(), stage, scores, note: note.value.trim(), passed: prog.allDone, weakSkills: weak };
        if (mockExam) doc.mockExam = mockExam;
        db.append("checkpoints", doc);
        result = { stage, passed: prog.allDone, weak, unmet };
        showForm = false;
        toast("บันทึก checkpoint แล้ว");
        draw();
      } },
      h("h3", { text: `บันทึกผล checkpoint (ขั้น ${stage})` }),
      h("p", { class: "muted", text: "ใส่คะแนน 0–100 ของทักษะที่ทดสอบ (ไม่ต้องครบทุกทักษะ) แล้วติ๊กเกณฑ์ “ผ่านขั้นนี้เมื่อ” ที่คุณทำได้จริง — คุณเป็นคนยืนยันเอง" }),
      h("div", { class: "grid2 form-grid" }, ...rl.SKILLS.map((s) => field(s.label, scoreInputs[s.key]))),
      h("div", { class: "grid2 form-grid" }, field("ข้อสอบจำลอง: คะแนน (ไม่บังคับ)", mockScore), field("ข้อสอบจำลอง: เป้า", mockTarget)),
      h("fieldset", { class: "criteria" }, h("legend", { text: `ผ่านขั้นนี้เมื่อ: ${ROADMAP[stage].passText}` }),
        ...ROADMAP[stage].criteria.map((c, i) => criterionBox(stage, i, c, true))),
      field("โน้ต", note), err,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "submit", text: "บันทึก checkpoint" }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ยกเลิก", onclick: () => { showForm = false; draw(); } })));
  }

  /** ช่องติ๊กเกณฑ์ — editable เฉพาะขั้นปัจจุบัน */
  function criterionBox(stage, idx, c, editable, extra) {
    const checked = settings().criteria?.[rl.criterionKey(stage, idx)] === true;
    return h("label", { class: "row check criterion" },
      h("input", { type: "checkbox", checked, disabled: !editable, onchange: (e) => setCriterion(stage, idx, e.target.checked) }),
      h("span", {}, c.text, extra ? h("small", { class: "muted hint", text: extra }) : null));
  }

  function hintFor(c, cps, events, now) {
    if (c.hint === "mockExam") {
      const m = rl.mockExamHint(cps, db.MUTABLE_COLS?.includes("examAttempts") || db.EVENT_COLS?.includes("examAttempts") ? db.list("examAttempts") : []);
      if (!m.last2.length) return "ข้อมูลประกอบ: ยังไม่มีผลข้อสอบจำลอง (ทำที่หน้า “สอบจับเวลา” แล้วตั้งเป้า หรือกรอกใน checkpoint)";
      const show = (x) => (x.src === "exam" ? `${x.score}% (เป้า ${x.target}%)` : `${x.score}/${x.target}`);
      return `ข้อมูลประกอบ: ข้อสอบจำลองล่าสุด ${m.last2.map((x) => `${show(x)} ${x.reached ? "✓ ถึงเป้า" : "✗ ยังไม่ถึง"}`).join(" ← ก่อนหน้า ")}${m.twoInARow ? " — ถึงเป้า 2 ครั้งติด" : ""}`;
    }
    if (c.hint === "errorTrend") {
      const t = rl.errorTrend(events, now);
      return `ข้อมูลประกอบ: บันทึกข้อผิดใน 30 วันล่าสุด ${t.last} ครั้ง (30 วันก่อนหน้า ${t.prev} ครั้ง)${t.prev ? (t.improved ? " — ลดลง" : " — ยังไม่ลดลง") : ""}`;
    }
    return null;
  }

  function stageCard(s, st, cps, events, now) {
    const cur = st.stage;
    const status = s.stage < cur ? "done" : s.stage === cur ? "current" : s.stage === cur + 1 ? "next" : "locked";
    const label = { done: "✓ ผ่านแล้ว", current: "ขั้นปัจจุบัน", next: "ถัดไป", locked: "🔒 ยังไม่ปลดล็อก" }[status];
    const prog = rl.stageProgress(st.criteria, s.stage);
    return h("details", { class: `card stage stage--${status}`, open: status === "current" },
      h("summary", { class: "stage__head" },
        h("span", { class: "stage__num mono", text: String(s.stage) }),
        h("span", { class: "stage__title" }, h("strong", { text: s.name }), h("span", { class: "muted", text: `  ${s.cefr} · ${s.duration}` })),
        status === "current" ? h("span", { class: "mono muted", text: `${prog.done}/${prog.total}` }) : null,
        h("span", { class: `badge ${status === "current" ? "" : "badge--off"}`, text: label })),
      h("div", { class: "stack stage__body" },
        h("p", {}, h("strong", { text: "เป้าหมาย: " }), s.goal),
        h("div", {}, h("strong", { text: "สิ่งที่ต้องทำ" }), h("ul", { class: "plain-list" }, ...s.actions.map((a) => h("li", { text: a })))),
        h("div", { class: "stack" }, h("strong", { text: "เครื่องมือ / แหล่งเรียน" }), h("div", { class: "row tags" }, ...s.tools.map((t) => h("span", { class: "badge", text: t })))),
        h("fieldset", { class: "criteria" }, h("legend", { text: `ผ่านขั้นนี้เมื่อ: ${s.passText}` }),
          ...s.criteria.map((c, i) => criterionBox(s.stage, i, c, status === "current", hintFor(c, cps, events, now))),
          status !== "current" ? h("small", { class: "muted", text: status === "done" ? "ขั้นที่ผ่านแล้ว" : "ติ๊กได้เมื่อเป็นขั้นปัจจุบัน" }) : null)));
  }

  const unsub = db.subscribe(() => { if (!showForm) draw(); });
  draw();
  return unsub;
}
