// แท็บ "เพิ่มคำ": พิมพ์คำ/วลี → ดึงข้อมูล (คลังเดิมก่อน แล้วค่อย API) → ตรวจ/แก้ในฟอร์ม → บันทึกเป็นบัตรคำ
import * as db from "../db.js";
import * as srs from "../srs.js";
import * as lx from "../lexicon.js";
import { lexiconConfig } from "../localsettings.js";
import { h } from "../dom.js";

const POS_OPTIONS = ["", "noun", "verb", "adjective", "adverb", "phrase", "other"];
const SOURCE_ORDER = ["dictionary", "datamuse", "mymemory", "ai"];
const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

function speak(text) {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  speechSynthesis.speak(u);
}

export function mount(root, { toast, onSaved, prefill = null }) {
  let token = 0;                 // กันผลของคำค้นเก่าทับคำใหม่
  let current = null;            // { key, word, lex }
  let busy = false;
  let pendingExample = prefill?.example || "";      // ประโยคตัวอย่างที่ส่งมา ใส่ในช่องหลังฟอร์มวาดครั้งแรก

  const input = h("input", { class: "input", placeholder: "พิมพ์คำหรือวลี เช่น look after", autocomplete: "off", autocapitalize: "none", spellcheck: false, "aria-label": "คำหรือวลีที่ต้องการเพิ่ม" });
  const go = h("button", { class: "btn", type: "button", text: "ค้นหา", onclick: () => lookup(false) });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(false); });
  const status = h("div", { class: "lex-status", role: "status", "aria-live": "polite" });
  const detail = h("div", { class: "stack" });
  root.replaceChildren(h("section", { class: "card stack" },
    h("h2", { text: "เพิ่มคำ" }),
    h("p", { class: "muted", text: "ระบบจะดูในคลังของคุณก่อน (ไม่เสียโควตา) แล้วค่อยเรียก API เฉพาะคำที่ไม่เคยมี" }),
    h("div", { class: "row" }, input, go), status), detail);
  input.style.flex = "1";

  const setStatus = (kind, text, extra = []) => {
    status.className = `lex-status lex-status--${kind}`;
    status.replaceChildren(h("div", { text }), ...extra);
  };

  function sourceReport(lex) {
    const rows = SOURCE_ORDER.filter((k) => lex?.sources?.[k]).map((k) => {
      const s = lex.sources[k];
      const label = lx.API_LABELS[k];
      const text = s.ok ? `${label}: สำเร็จ${s.note === "notFound" ? " (ไม่พบคำนี้ในพจนานุกรม)" : s.note === "noTranslation" ? " (ไม่มีคำแปล)" : ""}` : s.error;
      return h("li", { class: s.ok ? "good" : "bad", text: `${s.ok ? "✓" : "✗"} ${text}` });
    });
    return rows.length ? [h("ul", { class: "lex-sources" }, ...rows)] : [];
  }

  async function lookup(force) {
    if (busy) return;
    const word = input.value.trim().replace(/\s+/g, " ");
    if (!lx.isValidWord(word)) {
      setStatus("error", `ใส่คำหรือวลีเป็นตัวอักษร (ไม่เกิน ${lx.WORD_MAX} ตัวอักษร ขึ้นต้นด้วยตัวอักษรหรือตัวเลข)`);
      detail.replaceChildren();
      return;
    }
    const key = lx.wordKey(word);
    const my = ++token;
    busy = true;
    go.disabled = true;
    setStatus("loading", "กำลังดึง…");
    try {
      let existing = null;
      if (force && current?.key === key) existing = current.lex;
      const found = await db.lexiconGet(key);
      if (my !== token) return;
      if (!force && found.doc) {
        current = { key, word, lex: found.doc };
        setStatus("cached", "ดึงจากคลังเดิม (ไม่เสียโควตา)", sourceReport(found.doc));
        drawForm();
        return;
      }
      existing = found.doc || existing;
      if (force && existing?.userEdited && !confirm("คุณเคยแก้คำแปลคำนี้เอง การแปลใหม่จะดึงข้อมูลอื่นจาก API มาเพิ่ม แต่จะ ไม่ทับคำแปลที่คุณแก้ ต้องการดำเนินการต่อไหม?")) {
        setStatus("cached", "ยกเลิกการแปลใหม่ — ใช้ข้อมูลเดิม");
        return;
      }
      if (!navigator.onLine) {
        current = { key, word, lex: existing };
        setStatus("error", "ดึงไม่สำเร็จ: ออฟไลน์อยู่และคำนี้ยังไม่เคยอยู่ในคลัง — กรอกเองในฟอร์มได้ หรือต่อเน็ตแล้วกด “แปลใหม่”");
        drawForm();
        return;
      }
      const cfg = lexiconConfig();
      const results = await lx.fetchAll(key, { email: cfg.email });
      if (my !== token) return;
      const anyOk = Object.values(results).some((r) => r.ok);
      const merged = lx.mergeLexicon(existing, results, { word, now: Date.now() });
      const lex = anyOk ? db.lexiconPut(key, merged, existing) : existing;
      current = { key, word, lex };
      const failed = Object.values(results).filter((r) => !r.ok).length;
      if (!anyOk) setStatus("error", "ดึงไม่สำเร็จ: ทุกแหล่งใช้ไม่ได้ในตอนนี้ — กรอกเองในฟอร์มได้", sourceReport(merged));
      else if (failed) setStatus("partial", "ดึงได้บางส่วน — ข้อมูลที่ขาดดูด้านล่าง กรอกเองหรือกด “แปลใหม่” ภายหลังได้", sourceReport(lex));
      else setStatus("ok", "ดึงข้อมูลใหม่แล้ว และเก็บไว้ในคลังถาวร", sourceReport(lex));
      drawForm();
    } catch (e) {
      console.error(e);
      if (my === token) setStatus("error", `ดึงไม่สำเร็จ: ${e.message}`);
    } finally {
      if (my === token) { busy = false; go.disabled = false; }
    }
  }

  async function askAi() {
    const cfg = lexiconConfig();
    if (!current || busy) return;
    const { key, word } = current;
    if (current.lex?.userEdited && !confirm("คุณเคยแก้คำแปลคำนี้เอง AI จะเพิ่มประโยคตัวอย่างและแท็กแนะนำ แต่จะ ไม่ทับคำแปลที่คุณแก้ ดำเนินการต่อไหม?")) return;
    busy = true;
    go.disabled = true;
    const my = ++token;
    setStatus("loading", "กำลังให้ AI ช่วย…");
    try {
      const results = { ai: await lx.fetchAi(key, { apiKey: cfg.apiKey, model: cfg.model }).then((data) => ({ ok: true, data }), (e) => ({ ok: false, error: lx.describeError(e) })) };
      if (my !== token) return;
      const merged = lx.mergeLexicon(current.lex, results, { word, now: Date.now() });
      const lex = results.ai.ok ? db.lexiconPut(key, merged, current.lex) : current.lex;
      current = { key, word, lex };
      if (results.ai.ok) setStatus("ok", "AI ช่วยแล้ว — ตรวจคำแปลและประโยคก่อนบันทึก", sourceReport(lex));
      else setStatus("error", results.ai.error);
      drawForm();
    } finally {
      busy = false;
      go.disabled = false;
    }
  }

  function drawForm() {
    const { key, word, lex } = current;
    const data = lex || { th: [], examples: [], meanings: [], related: { syn: [], ant: [], trg: [], jjb: [] }, suggestedTags: [] };
    const f = {
      en: h("input", { class: "input", value: lex?.word || word, autocapitalize: "none", autocomplete: "off" }),
      th: h("textarea", { class: "input", rows: 2, value: lx.thDisplay(data.th), placeholder: "คำแปลภาษาไทย" }),
      example: h("textarea", { class: "input", rows: 2, placeholder: "ประโยคตัวอย่างอย่างน้อย 4 คำ" }),
      ipa: h("input", { class: "input", value: data.ipa || "", placeholder: "ไม่บังคับ" }),
      pos: h("select", { class: "input select" }, ...POS_OPTIONS.map((p) => h("option", { value: p, text: p || "— ไม่ระบุ —", selected: p === lx.suggestPos({ ...data, word }) }))),
      tags: h("input", { class: "input", value: (data.suggestedTags || []).join(", "), placeholder: "คั่นด้วยจุลภาค เช่น science/biology, daily-life" }),
    };
    const wc = h("small", { class: "muted mono" });
    const updateWc = () => { const n = srs.wordCount(f.example.value); wc.textContent = `${n} คำ (ขั้นต่ำ ${srs.MIN_EXAMPLE_WORDS})`; };
    f.example.addEventListener("input", updateWc);
    if (pendingExample) { f.example.value = pendingExample; pendingExample = ""; }
    updateWc();
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });

    const exampleChoices = (data.examples || []).filter((s) => srs.wordCount(s) >= srs.MIN_EXAMPLE_WORDS).map((s) =>
      h("button", { class: "btn btn--secondary btn--chip", type: "button", text: s, onclick: () => { f.example.value = s; updateWc(); } }));
    const tagChips = (data.suggestedTags || []).map((t) =>
      h("button", { class: "btn btn--secondary btn--chip", type: "button", text: `+ ${t}`, onclick: () => {
        const cur = f.tags.value.split(",").map((x) => x.trim()).filter(Boolean);
        if (!cur.includes(t)) f.tags.value = [...cur, t].join(", ");
      } }));

    const audio = data.audioUrl
      ? h("button", { class: "btn btn--secondary", type: "button", text: "🔊 ฟังเสียง", onclick: () => {
          const a = new Audio(data.audioUrl);
          a.play().catch(() => speak(f.en.value));      // ถ้าไฟล์เสียงเล่นไม่ได้ ใช้เสียงสังเคราะห์แทน
        } })
      : canSpeak ? h("button", { class: "btn btn--secondary", type: "button", text: "🔊 ฟังเสียง", onclick: () => speak(f.en.value) }) : null;

    const meanings = (data.meanings || []).length
      ? h("details", { class: "lex-details" }, h("summary", { text: "ความหมายภาษาอังกฤษ" }),
          ...data.meanings.map((m) => h("div", {}, h("strong", { text: m.pos }),
            h("ul", {}, ...m.definitions.map((d) => h("li", {}, d.en, d.example ? h("div", { class: "muted", text: `“${d.example}”` }) : null))))))
      : null;
    const rel = data.related || {};
    const relRows = [["พ้องความหมาย", rel.syn], ["ตรงข้าม", rel.ant], ["มักมาด้วย", rel.trg], ["คำคุณศัพท์ที่ใช้คู่", rel.jjb]].filter(([, v]) => v?.length);
    const related = relRows.length
      ? h("details", { class: "lex-details" }, h("summary", { text: "คำที่เกี่ยวข้อง" }),
          ...relRows.map(([label, words]) => h("div", {}, h("strong", { text: `${label}: ` }), words.join(", "))))
      : null;

    const field = (label, el) => h("label", { class: "field" }, h("span", { text: label }), el);
    const cfg = lexiconConfig();
    const form = h("form", { class: "card form", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const card = {
          en: f.en.value.trim(), th: f.th.value.trim(), example: f.example.value.trim(), ipa: f.ipa.value.trim(),
          tags: f.tags.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
          pos: f.pos.value || null, freq: lex?.freq ?? null, source: "manual",
        };
        const msg = srs.validateCard(card);
        const dup = !msg && db.list("cards").find((c) => lx.wordKey(c.en) === lx.wordKey(card.en));
        err.hidden = !(msg || dup);
        if (msg || dup) { err.textContent = msg || `มีบัตรคำ “${dup.en}” อยู่แล้ว ไปแก้ที่แท็บ “รายการ”`; return; }
        // ผู้ใช้แก้คำแปลเอง → จดลงคลังว่า userEdited เพื่อไม่ให้ API ทับ
        if (lex && card.th !== lx.thDisplay(lex.th)) {
          db.lexiconPut(key, { ...lex, th: [{ sense: "", text: card.th }], thSource: "user", userEdited: true }, lex);
        }
        db.create("cards", card);
        toast("บันทึกเป็นบัตรคำแล้ว");
        onSaved?.();
      } },
      h("div", { class: "row" }, h("h2", { text: lex?.word || word }), data.freq != null ? h("span", { class: "badge", text: `ความถี่ ${data.freq.toFixed(1)}/ล้านคำ` }) : null, audio),
      meanings, related,
      field("อังกฤษ (en)", f.en), field("ไทย (th)", f.th),
      field("ประโยคตัวอย่าง (≥ 4 คำ)", f.example), wc,
      exampleChoices.length ? h("div", { class: "stack" }, h("small", { class: "muted", text: "ประโยคแนะนำ (กดเพื่อใช้)" }), ...exampleChoices) : null,
      h("div", { class: "row" }, field("ชนิดคำ", f.pos), field("IPA", f.ipa)),
      field("แท็ก", f.tags), tagChips.length ? h("div", { class: "row" }, ...tagChips) : null, err,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "submit", text: "บันทึกเป็นบัตรคำ" }),
        h("button", { class: "btn btn--secondary", type: "button", text: "แปลใหม่", onclick: () => lookup(true) }),
        cfg.apiKey ? h("button", { class: "btn btn--secondary", type: "button", text: "ให้ AI ช่วย", onclick: askAi }) : null,
        !cfg.apiKey ? h("small", { class: "muted", text: "ใส่ Claude API key ในหน้า “ตั้งค่า” เพื่อใช้ปุ่ม “ให้ AI ช่วย”" }) : null));
    detail.replaceChildren(form);
    f.example.focus();
  }

  if (prefill?.word) { input.value = prefill.word; lookup(false); } else input.focus();
  return () => { token++; if (canSpeak) speechSynthesis.cancel(); };
}
