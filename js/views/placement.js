import * as db from "../db.js";
import { vocab, describeError } from "../vocab.js";
import { h } from "../dom.js";
import * as pl from "../placement.js";

const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
function speak(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  speechSynthesis.speak(u);
}

export function render(root, { toast } = {}) {
  let alive = true;
  let levelCount = 11;
  let results = [];
  let current = null;                 // ข้อที่กำลังตอบ
  const queue = new Map();            // level → ข้อที่ยังไม่ถูกถาม
  const rng = pl.mulberry32(Date.now());
  const body = h("div", { class: "stack" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "วัดระดับคำศัพท์" }), h("p", { class: "muted", text: "ช่วยเลือกระดับที่เหมาะจะเริ่มเรียน — ใช้เวลาประมาณ 3–5 นาที" })),
    body
  );

  const fail = (e) => body.replaceChildren(h("div", { class: "notice notice--bad", role: "alert", text: describeError(e) }));

  async function intro() {
    try { levelCount = await vocab.levelCount(); } catch (e) { return fail(e); }
    if (!alive) return;
    const prev = db.getSettings().placement;
    body.replaceChildren(h("section", { class: "card stack" },
      h("h2", { text: "วิธีทำ" }),
      h("ul", { class: "plain-list" },
        h("li", { text: "เห็นคำอังกฤษ แล้วเลือกความหมายภาษาไทยที่ถูกจาก 4 ตัวเลือก" }),
        h("li", { text: "ไม่รู้ให้กด “ยังไม่รู้” ดีกว่าเดา — ผลจะแม่นกว่า" }),
        h("li", { text: "เริ่มจากคำง่ายไปยาก และหยุดเองเมื่อเริ่มยากเกินไป" })),
      prev ? h("p", { class: "muted", text: `เคยทำเมื่อ ${new Date(prev.at).toLocaleDateString("th-TH")} — แนะนำระดับ ${prev.startLevel}` }) : null,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", text: "เริ่มทำ", onclick: () => { results = []; queue.clear(); next(); } }),
        h("a", { class: "btn btn--secondary", href: "#/settings", text: "ข้าม ไปตั้งค่าเอง" }))));
  }

  async function next() {
    const step = pl.nextStep(results, { levelCount });
    if (step.done) return finish();
    if (!queue.has(step.level)) {
      try {
        const words = await vocab.wordsOfLevel(step.level);
        queue.set(step.level, pl.levelQuestions(words, words, pl.PER_LEVEL, rng));
      } catch (e) { return fail(e); }
      if (!alive) return;
    }
    const q = queue.get(step.level).shift();
    if (!q) { results.push({ level: step.level, correct: false }); return next(); }   // ระดับที่สร้างข้อไม่ครบ นับเป็นไม่ผ่านแทนการค้าง
    current = q;
    drawQuestion();
  }

  function answer(i) {
    results.push({ level: current.level, correct: i === current.answer });
    next();
  }

  function drawQuestion() {
    const q = current;
    body.replaceChildren(h("section", { class: "card stack placement" },
      h("div", { class: "row" }, h("span", { class: "badge mono", text: `ข้อ ${results.length + 1}` }), h("span", { class: "muted", text: "เลือกความหมายที่ถูก" })),
      h("div", { class: "row" },
        h("div", { class: "prompt__main", text: q.word }),
        q.ipa ? h("span", { class: "mono muted", text: q.ipa }) : null,
        canSpeak ? h("button", { class: "btn btn--secondary btn--icon", type: "button", "aria-label": `ฟังเสียง ${q.word}`, text: "🔊", onclick: () => speak(q.word) }) : null),
      h("div", { class: "stack", role: "group", "aria-label": "ตัวเลือก" },
        ...q.choices.map((c, i) => h("button", { class: "btn btn--secondary placement__choice", type: "button", text: c, onclick: () => answer(i) }))),
      h("div", {}, h("button", { class: "btn btn--secondary", type: "button", text: "ยังไม่รู้", onclick: () => answer(-1) }))));
  }

  function finish() {
    const est = pl.estimate(results, { levelCount });
    let chosen = est.startLevel;
    const sel = h("select", { class: "input select", "aria-label": "ระดับที่จะเริ่ม", onchange: (e) => { chosen = Number(e.target.value); useBtn.textContent = `ใช้ระดับ ${chosen} เริ่มเรียน`; } },
      ...Array.from({ length: levelCount }, (_, i) => h("option", { value: i + 1, text: `ระดับ ${i + 1}`, selected: i + 1 === chosen })));
    const useBtn = h("button", { class: "btn", type: "button", text: `ใช้ระดับ ${chosen} เริ่มเรียน`, onclick: () => {
      db.saveSettings({ vocabLevels: [chosen], placement: { at: Date.now(), startLevel: est.startLevel, chosen, byLevel: est.byLevel } });
      toast?.(`ตั้งชุดคำเริ่มต้นเป็นระดับ ${chosen} แล้ว`);
      location.hash = "#/today";
    } });
    body.replaceChildren(
      h("section", { class: "card stack" },
        h("h2", { text: `ระดับที่แนะนำ: ${est.startLevel}` }),
        est.confidence === "low" ? h("p", { class: "muted", text: "ผลยังไม่นิ่งนัก (ตอบน้อยหรือสลับไปมา) — ลองทำซ้ำหรือเลือกระดับเองได้" }) : h("p", { class: "muted", text: "ระดับนี้คือจุดที่คุณเริ่มจำคำไม่แน่น — เริ่มเรียนตรงนี้จะไม่ง่ายหรือยากเกินไป" }),
        h("div", { class: "table-wrap" }, h("table", { class: "data-table" },
          h("thead", {}, h("tr", {}, h("th", { text: "ระดับ" }), h("th", { text: "ถูก" }), h("th", { text: "ผล" }))),
          h("tbody", {}, ...est.byLevel.map((e) => h("tr", {}, h("td", { text: String(e.level) }), h("td", { class: "mono", text: `${e.correct}/${e.total}` }), h("td", { text: pl.passed(e) ? "ผ่าน" : "ยังไม่แน่น" }))))))),
      h("section", { class: "card stack" },
        h("label", { class: "field" }, h("span", { text: "เริ่มเรียนที่ระดับ" }), sel),
        h("div", { class: "row" }, useBtn, h("button", { class: "btn btn--secondary", type: "button", text: "ทำใหม่", onclick: intro }))));
  }

  intro();
  return () => { alive = false; };
}
