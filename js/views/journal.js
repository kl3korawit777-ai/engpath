// Journal: เขียนบันทึกรายวัน (เป้า 5–10 ประโยค) บันทึกร่างอัตโนมัติ ใช้ออฟไลน์ได้ + ตรวจด้วย AI (มี Claude API key) หรือตรวจเองด้วยเช็กลิสต์
import * as db from "../db.js";
import * as jn from "../journal.js";
import { describeError } from "../lexicon.js";
import { lexiconConfig } from "../localsettings.js";
import { ActivityClock, FLUSH_EVERY_MS, toSession } from "../activity.js";
import { dayKey } from "../streak.js";
import { gotoLibraryWord } from "../wordnav.js";
import { CATEGORIES } from "../errlog.js";
import { h } from "../dom.js";

const SAVE_DELAY = 1500;
const fmtDay = (key) => { const [y, m, d] = key.split("-").map(Number); return new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d)); };
const fmtTime = (ts) => new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

export function render(root, { toast }) {
  const today = () => dayKey(Date.now());
  let date = today();
  let entry = null;               // เอกสาร journal ของวันที่เลือก (ถ้ามี)
  let text = "";
  let saveTimer = null;
  let savedAt = null;
  let busy = false;               // กำลังให้ AI ตรวจ
  let aiError = null;
  let selfOpen = false;

  const clock = new ActivityClock();
  const touch = () => clock.touch(Date.now());
  const flushClock = () => {
    const s = toSession(clock.flush(Date.now()), "journal", db.getSettings().stage);
    if (s) { try { db.append("sessions", s); } catch (e) { console.error(e); } }
  };
  const onHidden = () => { if (document.visibilityState === "hidden") { flushDraft(); flushClock(); } };
  document.addEventListener("visibilitychange", onHidden);
  const clockTimer = setInterval(flushClock, FLUSH_EVERY_MS);
  root.addEventListener("pointerdown", touch);
  root.addEventListener("keydown", touch);

  const body = h("div", { class: "stack" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "Journal" }), h("p", { class: "muted", text: "เขียนบันทึกสั้น ๆ วันละ 5–10 ประโยค แล้วให้ AI หรือตัวเองตรวจ" })),
    body
  );

  const forDate = (k) => db.list("journal").filter((e) => e.date === k).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;

  function openDate(k) {
    flushDraft();
    date = k; entry = forDate(k); text = entry?.text || ""; aiError = null; savedAt = entry ? entry.updatedAt : null;
    draw();
  }

  // ================= ร่างอัตโนมัติ =================
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushDraft, SAVE_DELAY); }

  function flushDraft() {
    clearTimeout(saveTimer); saveTimer = null;
    const c = jn.countText(text);
    if (!entry) {
      if (!text.trim()) return;
      entry = db.create("journal", { date, text, corrected: "", wordCount: c.words, sentenceCount: c.sentences });
    } else if (entry.text !== text) {
      db.update("journal", entry.id, { text, wordCount: c.words, sentenceCount: c.sentences });
      entry = { ...entry, text };
    } else return;
    savedAt = Date.now();
    const el = document.getElementById("save-status");
    if (el) el.textContent = `บันทึกร่างแล้ว ${fmtTime(savedAt)}`;
  }

  // ================= หน้าจอ =================
  function draw() {
    const live = entry ? db.get("journal", entry.id) || entry : null;
    if (live) entry = live;
    const hasKey = Boolean(lexiconConfig().apiKey);
    body.replaceChildren(...[
      dateBar(),
      editorCard(hasKey),
      aiError ? h("div", { class: "notice notice--bad", role: "alert", text: aiError }) : null,
      reviewCard(),
      selfCard(),
      historyCard(),
    ].filter(Boolean));
  }

  function dateBar() {
    return h("div", { class: "row" },
      h("strong", { text: date === today() ? `วันนี้ · ${fmtDay(date)}` : fmtDay(date) }),
      date !== today() ? h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "← เขียนของวันนี้", onclick: () => openDate(today()) }) : null);
  }

  function editorCard(hasKey) {
    const area = h("textarea", { class: "input journal-area", rows: 10, value: text, placeholder: "วันนี้เกิดอะไรขึ้นบ้าง? เขียนเป็นภาษาอังกฤษ 5–10 ประโยค (ไม่ต้องกลัวผิด)", "aria-label": "บันทึกประจำวัน", spellcheck: false, autocapitalize: "sentences" });
    const stat = h("div", { class: "row mono" });
    const status = h("span", { class: "muted", id: "save-status", text: savedAt ? `บันทึกร่างแล้ว ${fmtTime(savedAt)}` : "ยังไม่ได้เขียน" });
    const update = () => {
      const c = jn.countText(area.value), g = jn.goalStatus(c.sentences);
      stat.replaceChildren(h("span", { text: `${c.words} คำ` }), h("span", { text: `${c.sentences} ประโยค` }), h("span", { class: g === "in" ? "good" : "muted", text: jn.GOAL_TEXT[g](c.sentences) }));
    };
    area.addEventListener("input", () => { text = area.value; update(); status.textContent = "กำลังพิมพ์…"; scheduleSave(); });
    area.addEventListener("blur", flushDraft);
    update();
    window.__journalArea = area;
    const offline = !navigator.onLine;
    return h("section", { class: "card stack" },
      area, stat, status,
      h("div", { class: "row" },
        hasKey ? h("button", { class: "btn", type: "button", disabled: busy || offline, text: busy ? "AI กำลังตรวจ…" : "ให้ AI ตรวจ", onclick: askAi }) : null,
        h("button", { class: "btn btn--secondary", type: "button", text: selfOpen ? "ซ่อนโหมดตรวจเอง" : "ตรวจเอง (เช็กลิสต์)", onclick: () => { selfOpen = !selfOpen; draw(); } })),
      !hasKey ? h("p", { class: "muted", text: "ยังไม่ได้ใส่ Claude API key — ใช้โหมดตรวจเองได้ หรือใส่คีย์ในหน้า “ตั้งค่า” เพื่อให้ AI ตรวจ" }) : null,
      hasKey && offline ? h("p", { class: "muted", text: "ออฟไลน์อยู่ — เขียนและบันทึกร่างได้ตามปกติ แต่ต้องต่อเน็ตจึงจะให้ AI ตรวจได้" }) : null);
  }

  // ================= ตรวจด้วย AI =================
  async function askAi() {
    flushDraft();
    if (!entry || !text.trim()) { toast("เขียนบันทึกก่อนแล้วค่อยให้ AI ตรวจ"); return; }
    const cfg = lexiconConfig();
    busy = true; aiError = null; draw();
    const reviewed = text;
    try {
      const items = await jn.reviewWithAi(reviewed, { apiKey: cfg.apiKey, model: cfg.model });
      const { placed } = jn.planEdits(reviewed, items);
      saveReview({ source: "ai", at: Date.now(), forText: reviewed, items: items.map((i) => ({ ...i, logged: false })) }, jn.applyEdits(reviewed, placed));
      toast(items.length ? `AI พบข้อควรแก้ ${items.length} จุด` : "AI ไม่พบข้อผิด 🎉");
    } catch (e) {
      aiError = e.kind === "parse"
        ? `AI ตอบกลับในรูปแบบที่ใช้ไม่ได้ (${e.detail || "โครงสร้างไม่ตรง"}) — ไม่ได้ใช้ผลนี้ ลองกด “ให้ AI ตรวจ” อีกครั้ง`
        : describeError(e);
    } finally {
      busy = false; draw();
    }
  }

  function saveReview(review, corrected) {
    db.update("journal", entry.id, { review, corrected });
    entry = { ...entry, review, corrected };
  }

  // ================= ผลการตรวจ =================
  function reviewCard() {
    const r = entry?.review;
    if (!r) return null;
    const stale = r.forText !== text;
    const { placed, skipped } = jn.planEdits(r.forText, r.items);
    const cmp = jn.sideBySide(r.forText, placed);
    const seg = (arr, cls) => h("div", { class: "cmp-text" }, ...arr.map((s) => (s.changed ? h("mark", { class: cls, title: `${s.item.category}: ${s.item.explanation_th}`, text: s.text }) : document.createTextNode(s.text))));
    return h("section", { class: "card stack", id: "review-card" },
      h("div", { class: "row" }, h("h2", { text: "ผลการตรวจ" }), h("span", { class: "badge", text: r.source === "ai" ? "AI ตรวจ" : "ตรวจเอง" }), h("span", { class: "mono muted", text: fmtTime(r.at) })),
      stale ? h("div", { class: "notice", role: "status", text: "คุณแก้บันทึกหลังจากตรวจแล้ว — รายการด้านล่างอ้างอิงฉบับที่ตรวจไว้ (กด “ให้ AI ตรวจ” ใหม่เพื่ออัปเดต)" }) : null,
      !r.items.length ? h("p", { class: "good", text: "ไม่พบข้อผิด 🎉" }) : null,
      r.items.length ? h("div", { class: "cmp-grid" },
        h("div", { class: "stack" }, h("strong", { text: "ฉบับเดิม" }), seg(cmp.original, "chg chg--old")),
        h("div", { class: "stack" }, h("strong", { text: "ฉบับแก้" }), seg(cmp.corrected, "chg chg--new"))) : null,
      skipped.length ? h("p", { class: "muted", text: `${skipped.length} ข้อซ้อนทับกับข้ออื่น จึงไม่ถูกใส่ในฉบับแก้` }) : null,
      ...r.items.map((it, i) => itemCard(it, i, r)));
  }

  function itemCard(it, i, r) {
    return h("div", { class: "card item-card stack" },
      h("div", {}, h("s", { class: "bad", text: it.original }), "  →  ", h("strong", { class: "good", text: it.corrected })),
      h("div", { class: "row tags" }, h("span", { class: "badge", text: it.category })),
      it.explanation_th ? h("div", { class: "muted", text: it.explanation_th }) : null,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", disabled: it.logged, text: it.logged ? "เพิ่มเข้า Error Log แล้ว ✓" : "เพิ่มเข้า Error Log", onclick: () => logItem(it, i) }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ทำเป็นบัตรคำ", onclick: () => makeCard(it) }),
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ลบรายการ", onclick: () => removeItem(i) })));
  }

  function logItem(it, i) {
    const existing = jn.findExistingError(db.list("errors"), it.original, it.corrected);
    if (existing) {
      db.append("errorEvents", { errorId: existing.id, type: "occurred", at: Date.now() });
      toast("มีข้อผิดนี้ใน Error Log แล้ว — นับเพิ่มอีก 1 ครั้ง");
    } else {
      const e = db.create("errors", jn.errorPayload(it));
      db.append("errorEvents", { errorId: e.id, type: "occurred", at: Date.now() });
      toast("เพิ่มเข้า Error Log แล้ว");
    }
    const r = entry.review;
    saveReview({ ...r, items: r.items.map((x, k) => (k === i ? { ...x, logged: true } : x)) }, entry.corrected);   // ปุ่มกดซ้ำไม่ได้ ไม่นับซ้ำในข้อเดียวกัน
    draw();
  }

  function makeCard(it) {
    gotoLibraryWord(it.corrected, toast);
  }

  function removeItem(i) {
    const r = entry.review;
    const items = r.items.filter((_, k) => k !== i);
    const { placed } = jn.planEdits(r.forText, items);
    saveReview({ ...r, items }, jn.applyEdits(r.forText, placed));
    draw();
  }

  // ================= ตรวจเอง =================
  function selfCard() {
    if (!selfOpen) return null;
    const area = window.__journalArea;
    const f = {
      original: h("input", { class: "input", placeholder: "ข้อความที่ผิด (ตรงกับที่เขียนไว้)", autocomplete: "off", "aria-label": "ข้อความที่ผิด" }),
      corrected: h("input", { class: "input", placeholder: "แบบที่ถูก", autocomplete: "off", "aria-label": "แบบที่ถูก" }),
      category: h("select", { class: "input select", "aria-label": "หมวด" }, h("option", { value: "", text: "เลือกหมวด…" }), ...CATEGORIES.map((c) => h("option", { value: c, text: c }))),
      note: h("input", { class: "input", placeholder: "โน้ตกันลืม (ไม่บังคับ)", autocomplete: "off", "aria-label": "โน้ต" }),
    };
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    return h("section", { class: "card stack", id: "self-card" },
      h("h2", { text: "ตรวจเอง" }),
      h("p", { class: "muted", text: "อ่านบันทึกทวนทีละข้อด้านล่าง เจอที่ผิดก็จดลงรายการ แล้วส่งเข้า Error Log ได้" }),
      ...jn.SELF_CHECKLIST.map((c) => h("details", { class: "lex-details" }, h("summary", { text: c.label }), h("p", { text: c.question }),
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: `จดข้อผิดหมวด ${c.category}`, onclick: () => { f.category.value = c.category; f.original.focus(); } }))),
      h("form", { class: "stack", novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          flushDraft();
          const res = jn.makeSelfItem({ original: f.original.value, corrected: f.corrected.value, category: f.category.value, note: f.note.value }, text);
          err.hidden = !res.error;
          if (res.error) { err.textContent = res.error; return; }
          if (!entry) { err.hidden = false; err.textContent = "เขียนบันทึกก่อน"; return; }
          const r = entry.review;
          if (r && r.forText !== text && r.items.length) { err.hidden = false; err.textContent = "คุณแก้บันทึกหลังตรวจแล้ว — ลบรายการเดิมหรือให้ AI ตรวจใหม่ก่อน จึงจะจดเพิ่มได้"; return; }
          const items = [...(r?.items || []), { ...res.item, logged: false }];
          const { placed } = jn.planEdits(text, items);
          saveReview({ source: r?.source || "self", at: Date.now(), forText: text, items }, jn.applyEdits(text, placed));
          f.original.value = f.corrected.value = f.note.value = ""; f.category.value = "";
          draw();
        } },
        h("div", { class: "row" }, f.original, h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ใช้ข้อความที่เลือก", onclick: () => {
          const sel = area ? area.value.slice(area.selectionStart, area.selectionEnd).trim() : "";
          if (sel) f.original.value = sel; else toast("ลากคลุมข้อความในช่องเขียนก่อน");
        } })),
        f.corrected, f.category, f.note, err,
        h("div", {}, h("button", { class: "btn", type: "submit", text: "จดเป็นข้อผิด" }))));
  }

  // ================= ประวัติ =================
  function historyCard() {
    const list = db.list("journal").sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.updatedAt - a.updatedAt)).slice(0, 30);
    if (!list.length) return null;
    return h("section", { class: "card stack" }, h("h2", { text: "บันทึกย้อนหลัง" }),
      h("ul", { class: "list" }, ...list.map((e) => h("li", { class: "card-row" },
        h("div", { class: "card-row__main" }, h("strong", { text: fmtDay(e.date) }),
          h("span", { class: "mono muted", text: `${e.wordCount ?? 0} คำ · ${e.sentenceCount ?? 0} ประโยค${e.review ? ` · ${e.review.source === "ai" ? "AI ตรวจแล้ว" : "ตรวจเองแล้ว"} (${e.review.items.length} จุด)` : ""}` })),
        h("button", { class: "btn btn--secondary", type: "button", text: entry?.id === e.id ? "กำลังเปิดอยู่" : "เปิด", disabled: entry?.id === e.id, onclick: () => { flushDraft(); date = e.date; entry = e; text = e.text || ""; aiError = null; savedAt = e.updatedAt; draw(); } })))));
  }

  const unsub = db.subscribe(() => { if (!busy && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") { if (entry) entry = db.get("journal", entry.id) || entry; draw(); } });

  entry = forDate(date);
  text = entry?.text || "";
  savedAt = entry ? entry.updatedAt : null;
  draw();

  return () => {
    unsub();
    flushDraft();
    clearTimeout(saveTimer);
    clearInterval(clockTimer);
    document.removeEventListener("visibilitychange", onHidden);
    root.removeEventListener("pointerdown", touch);
    root.removeEventListener("keydown", touch);
    flushClock();
    delete window.__journalArea;
  };
}
