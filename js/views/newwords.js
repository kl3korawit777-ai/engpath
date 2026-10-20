import * as db from "../db.js";
import { vocab, describeError, TAGS } from "../vocab.js";
import { dayKey } from "../streak.js";
import { h } from "../dom.js";
import * as nw from "../newwords.js";

export const TAG_LABELS = {
  "daily-life": "ชีวิตประจำวัน", science: "วิทยาศาสตร์", health: "สุขภาพ", education: "การศึกษา", work: "การทำงาน",
  travel: "เดินทาง", emotion: "อารมณ์", society: "สังคม", technology: "เทคโนโลยี", nature: "ธรรมชาติ",
};

const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
function speak(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  speechSynthesis.speak(u);
}

const currentPlan = () => nw.normalizePlan(db.getSettings(), { tagList: TAGS });

/** เริ่มเรียน (learning) หรือข้าม (known) — คำที่เคยลบ/ข้ามไว้จะถูกนำกลับมาใช้บัตรใบเดิม (id = wordKey) */
export function setWordStatus(word, status, day = dayKey(Date.now())) {
  const f = nw.cardFields(word, day, status);
  if (db.getRaw("cards", word.wordKey)) db.update("cards", word.wordKey, { ...f, deleted: false });
  else db.create("cards", f);
}

// ======================= คำใหม่วันนี้ (หน้า “วันนี้”) =======================
export function mount(el, { toast } = {}) {
  let alive = true;
  let extra = 0;
  let loaded = null;                  // { key, words } ของแผนล่าสุด
  let failed = null;
  const box = h("section", { class: "card stack", id: "new-words" });
  el.replaceChildren(box);

  async function load(plan) {
    const key = plan.levels.join(",");
    if (loaded?.key === key) return loaded.words;
    const words = await vocab.query({ levels: plan.levels });
    loaded = { key, words };
    return words;
  }

  async function draw() {
    const plan = currentPlan();
    let words;
    try { words = await load(plan); failed = null; } catch (e) { failed = e; }
    if (!alive) return;
    if (failed) { box.replaceChildren(h("h2", { text: "คำใหม่วันนี้" }), h("div", { class: "notice notice--bad", role: "alert", text: describeError(failed) })); return; }

    const cards = db.list("cards");
    const taken = new Set([...nw.takenKeys(cards), ...db.skippedKeys()]);
    const day = dayKey(Date.now());
    const added = nw.addedOn(cards, day);
    const left = nw.quotaLeft(plan.perDay, added) + extra;
    const list = nw.candidates(words, { taken, plan, limit: left });
    const remaining = nw.remainingCount(words, { taken, plan });

    const row = (w) => h("li", { class: "newword" },
      h("div", { class: "newword__main" },
        h("div", { class: "row" },
          h("strong", { class: "newword__en", text: w.word }),
          w.ipa ? h("span", { class: "mono muted", text: w.ipa }) : null,
          h("span", { class: "badge", text: w.cefr }),
          h("span", { class: "muted mono", text: w.pos.join(", ") }),
          canSpeak ? h("button", { class: "btn btn--secondary btn--icon", type: "button", "aria-label": `ฟังเสียง ${w.word}`, text: "🔊", onclick: () => speak(w.word) }) : null),
        h("div", { text: w.th.slice(0, 2).map((t) => t.text).join(" / ") }),
        w.examples[0] ? h("div", { class: "muted", text: w.examples[0].text }) : null),
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", text: "เรียนคำนี้", onclick: () => setWordStatus(w, "learning") }),
        h("button", { class: "btn btn--secondary", type: "button", text: "รู้แล้ว", title: "ข้ามคำนี้ — จะไม่ขึ้นอีกและไม่เข้ารอบทบทวน",
          onclick: () => { setWordStatus(w, "known"); toast?.(`ข้าม “${w.word}” แล้ว (นำกลับได้ที่ ตั้งค่า → ชุดคำที่เรียน)`); } })));

    let body;
    if (!remaining) body = h("p", { class: "muted", text: "ไม่เหลือคำตามระดับ/แท็กที่เลือกแล้ว — เปลี่ยนชุดคำได้ที่ตั้งค่า" });
    else if (!list.length) body = h("p", { class: "good", text: `ครบ ${plan.perDay} คำของวันนี้แล้ว 🎉` });
    else body = h("ul", { class: "newwords" }, ...list.map(row));

    box.replaceChildren(
      h("div", { class: "row" },
        h("h2", { text: "คำใหม่วันนี้" }),
        h("span", { class: "badge mono", text: `${added} / ${plan.perDay}` }),
        h("span", { class: "muted mono", text: `ระดับ ${plan.levels.join(", ")}${plan.tags.length ? ` · ${plan.tags.map((t) => TAG_LABELS[t] || t).join(", ")}` : ""} · เหลือ ${remaining.toLocaleString("th-TH")} คำ` })),
      body,
      h("div", { class: "row" },
        remaining && !left ? h("button", { class: "btn btn--secondary", type: "button", text: "เรียนเพิ่มอีก 5 คำ", onclick: () => { extra += 5; draw(); } }) : null,
        h("a", { class: "btn btn--secondary", href: "#/settings", text: "ตั้งค่าชุดคำ" })));
  }

  const unsub = db.subscribe(draw);
  draw();
  return () => { alive = false; unsub(); };
}

// ======================= ตั้งค่าชุดคำ (หน้า “ตั้งค่า”) =======================
export function mountPlan(el, { toast } = {}) {
  let alive = true;
  const card = h("section", { class: "card stack", id: "vocab-plan" }, h("h2", { text: "ชุดคำที่เรียน" }), h("p", { class: "muted", text: "กำลังโหลดคลังคำศัพท์…" }));
  el.append(card);

  async function draw() {
    let index;
    try { index = await vocab.loadIndex(); } catch (e) {
      if (alive) card.replaceChildren(h("h2", { text: "ชุดคำที่เรียน" }), h("div", { class: "notice notice--bad", role: "alert", text: describeError(e) }));
      return;
    }
    if (!alive) return;
    const plan = nw.normalizePlan(db.getSettings(), { maxLevel: index.levels.length, tagList: TAGS });
    const save = (patch) => { db.saveSettings(patch); toast?.("บันทึกแล้ว"); };

    const perDay = h("select", { class: "input select", "aria-label": "จำนวนคำใหม่ต่อวัน", onchange: (e) => save({ newPerDay: Number(e.target.value) }) },
      ...nw.PER_DAY_OPTIONS.map((n) => h("option", { value: n, text: `${n} คำ${n === nw.DEFAULT_PER_DAY ? " (ค่าเริ่มต้น)" : ""}`, selected: n === plan.perDay })));

    const toggle = (list, v, on) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));
    const levelBoxes = index.levels.map((l) => h("label", { class: "chip-check" },
      h("input", { type: "checkbox", checked: plan.levels.includes(l.level), onchange: (e) => {
        const next = toggle(plan.levels, l.level, e.target.checked).sort((a, b) => a - b);
        if (!next.length) { e.target.checked = true; toast?.("ต้องเลือกอย่างน้อย 1 ระดับ"); return; }
        save({ vocabLevels: next });
      } }),
      h("span", { text: `ระดับ ${l.level}` }), h("small", { class: "muted mono", text: ` #${l.rankFrom}–${l.rankTo}` })));
    const tagBoxes = TAGS.map((t) => h("label", { class: "chip-check" },
      h("input", { type: "checkbox", checked: plan.tags.includes(t), onchange: (e) => save({ vocabTags: toggle(plan.tags, t, e.target.checked) }) }),
      h("span", { text: TAG_LABELS[t] || t })));

    const skipped = [...db.skippedKeys()].sort();
    const skippedBox = h("details", { class: "lex-details" }, h("summary", { text: `คำที่กด “รู้แล้ว” (${skipped.length})` }),
      skipped.length
        ? h("ul", { class: "plain-list" }, ...skipped.map((k) => h("li", { class: "row" },
            h("strong", { text: vocab.peek(k)?.word || k }),
            h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "นำกลับมาเรียน", onclick: () => { db.softDelete("cards", k); toast?.(`นำ “${k}” กลับเข้าคิวแล้ว`); } }))))
        : h("p", { class: "muted", text: "ยังไม่มี" }));

    card.replaceChildren(
      h("h2", { text: "ชุดคำที่เรียน" }),
      h("p", { class: "muted", text: `คลังกลาง ${index.count.toLocaleString("th-TH")} คำ (ผู้ใช้เพิ่มหรือแก้คำในคลังไม่ได้) — เลือกระดับและหัวข้อ แล้วระบบจะเสนอคำใหม่ตามลำดับความถี่ในหน้า “วันนี้”` }),
      h("label", { class: "field" }, h("span", { text: "คำใหม่ต่อวัน" }), perDay),
      h("fieldset", { class: "field" }, h("legend", { text: "ระดับที่เรียน" }), h("div", { class: "chips" }, ...levelBoxes)),
      h("fieldset", { class: "field" }, h("legend", { text: "หัวข้อ (ไม่เลือก = ทุกหัวข้อ)" }), h("div", { class: "chips" }, ...tagBoxes)),
      h("div", {}, h("a", { class: "btn btn--secondary", href: "#/placement", text: db.getSettings().placement ? "ทำแบบทดสอบวัดระดับอีกครั้ง" : "ไม่แน่ใจว่าควรเริ่มระดับไหน? ทำแบบทดสอบวัดระดับ" })),
      skippedBox,
      h("p", {}, h("a", { href: "#/credits", text: "เครดิตและสัญญาอนุญาตของคลังคำ" })));
  }

  const unsub = db.subscribe(draw);
  draw();
  return () => { alive = false; unsub(); };
}
