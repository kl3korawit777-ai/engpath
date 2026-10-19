// หน้าคำ: ข้อมูลบัตร + โน้ต (พิมพ์ [[ แล้วเลือกคำ) + Backlinks (คำไหนลิงก์มาหาคำนี้)
import * as db from "../db.js";
import * as srs from "../srs.js";
import * as lib from "../library.js";
import * as lk from "../links.js";
import { wordKey, thDisplay } from "../lexicon.js";
import { LEVEL_LABELS, MEMORY_LABELS, POS_LABELS } from "../data/lexicon-config.js";
import { setAddWordPrefill } from "../scope.js";
import * as gr from "../graph.js";
import * as gui from "../graphui.js";
import { h } from "../dom.js";

const SAVE_DELAY = 800;
const wordHref = (key) => `#/word/${encodeURIComponent(key)}`;

export function render(root, { toast, param }) {
  const key = wordKey(param || "");
  if (!key) {
    root.replaceChildren(h("div", { class: "page-head" }, h("h1", { text: "คำ" })), h("div", { class: "notice", text: "ไม่ได้ระบุคำ — เลือกคำจากหน้า “คลังคำ”" }), h("a", { class: "btn btn--secondary", href: "#/library", text: "ไปที่คลังคำ" }));
    return;
  }

  const cardOf = () => db.list("cards").find((c) => wordKey(c.en) === key) || null;
  const cardKeys = () => db.list("cards").map((c) => wordKey(c.en));
  const exists = (k) => cardKeys().includes(k);
  let saveTimer = null;
  let lex = null;                      // ข้อมูลจากคลังคำ (cache เท่านั้น ไม่เรียก API ที่หน้านี้)
  let sugg = [], pick = 0, open = null;

  const head = h("div", { class: "stack" });
  const info = h("section", { class: "card stack" });
  const ta = h("textarea", { class: "input note-area", rows: 8, spellcheck: false, "aria-label": `โน้ตของ ${key}`, "aria-autocomplete": "list", "aria-controls": "note-suggest",
    placeholder: "จดโน้ตที่นี่ พิมพ์ [[ เพื่อลิงก์ไปคำอื่น เช่น [[decide]] หรือ [[decide|ตัดสินใจ]]" });
  const pop = h("ul", { class: "suggest", id: "note-suggest", role: "listbox", hidden: true });
  const status = h("small", { class: "muted mono", role: "status" });
  const preview = h("div", { class: "note-preview" });
  const rel = h("div", { class: "stack" });
  const localBox = h("div", { class: "graph-box graph-box--local", role: "application", "aria-label": "กราฟรอบคำนี้" });
  const localBar = h("div", { class: "row" });
  const localInfo = h("small", { class: "muted mono", role: "status" });
  const local = h("details", { class: "card stack", id: "local-graph" }, h("summary", { text: "กราฟรอบคำนี้" }), localBar, localInfo, localBox);
  root.replaceChildren(head, info, h("section", { class: "card stack" },
    h("h2", { text: "โน้ต" }), h("div", { class: "note-wrap" }, ta, pop), status, preview), rel, local);

  const existingDoc = () => db.get("links", key);
  ta.value = existingDoc()?.notes || "";

  // ---------- บันทึก ----------
  function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    const doc = lk.buildLinkDoc(key, ta.value);
    const cur = existingDoc();
    if (cur) { if (cur.notes === doc.notes) return; db.update("links", key, { notes: doc.notes, to: doc.to }); }
    else if (doc.notes.trim()) db.create("links", { id: key, ...doc });
    else return;
    status.textContent = "บันทึกแล้ว";
  }
  const schedule = () => { clearTimeout(saveTimer); saveTimer = setTimeout(flush, SAVE_DELAY); status.textContent = "กำลังพิมพ์…"; };

  // ---------- autocomplete ----------
  function closePop() { open = null; pop.hidden = true; ta.removeAttribute("aria-activedescendant"); }
  function refreshPop() {
    open = lk.openLink(ta.value, ta.selectionStart);
    if (!open) { closePop(); return; }
    sugg = lk.suggest(open.query, cardKeys().filter((k) => k !== key));
    pick = Math.min(pick, Math.max(0, sugg.length - 1));
    pop.hidden = false;
    pop.replaceChildren(...(sugg.length
      ? sugg.map((k, i) => h("li", { role: "option", id: `sg-${i}`, class: `suggest__item ${i === pick ? "is-on" : ""}`, "aria-selected": String(i === pick), text: k,
          onmousedown: (e) => { e.preventDefault(); choose(k); } }))
      : [h("li", { class: "suggest__empty muted", text: open.query ? "ไม่พบในคลัง — พิมพ์ต่อได้ ลิงก์จะเป็นสีจางและกดเพิ่มคำได้ภายหลัง" : "ยังไม่มีบัตรคำอื่นให้ลิงก์" })]));
    if (sugg.length) ta.setAttribute("aria-activedescendant", `sg-${pick}`);
  }
  function choose(k) {
    const r = lk.applySuggestion(ta.value, ta.selectionStart, k);
    ta.value = r.text;
    ta.setSelectionRange(r.caret, r.caret);
    closePop(); pick = 0;
    onChange();
    ta.focus();
  }
  ta.addEventListener("keydown", (e) => {
    if (pop.hidden || !sugg.length) { if (e.key === "Escape") closePop(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); pick = (pick + 1) % sugg.length; refreshPop(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); pick = (pick - 1 + sugg.length) % sugg.length; refreshPop(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(sugg[pick]); }
    else if (e.key === "Escape") { e.preventDefault(); closePop(); }
  });
  const onChange = () => { schedule(); drawPreview(); refreshPop(); };
  ta.addEventListener("input", () => { pick = 0; onChange(); });
  ta.addEventListener("click", refreshPop);
  ta.addEventListener("keyup", (e) => { if (e.key.startsWith("Arrow") && e.key !== "ArrowUp" && e.key !== "ArrowDown") refreshPop(); });
  ta.addEventListener("blur", () => { closePop(); flush(); });

  // ---------- แสดงลิงก์ ----------
  function linkNode(s) {
    if (s.exists) return h("a", { class: "wlink", href: wordHref(s.key), title: s.key, text: s.label });
    return h("button", { class: "wlink wlink--missing", type: "button", title: `“${s.key}” ยังไม่มีในคลัง — กดเพื่อเพิ่ม`, text: s.label,
      onclick: () => { flush(); setAddWordPrefill({ word: s.key }); location.hash = "#/cards"; } });
  }
  const renderText = (text) => lk.segments(text, exists).map((s) => (s.type === "text" ? document.createTextNode(s.text) : linkNode(s)));

  function drawPreview() {
    const text = ta.value;
    preview.replaceChildren(...(text.trim() && lk.parseLinks(text).length
      ? [h("small", { class: "muted", text: "ตัวอย่างที่แสดง" }), h("div", { class: "note-render" }, ...renderText(text))]
      : []));
  }

  function drawRel() {
    const cur = lk.buildLinkDoc(key, ta.value);
    const out = lk.outgoing(cur);
    const back = lk.backlinks(db.list("links"), key);
    rel.replaceChildren(
      h("section", { class: "card stack", id: "backlinks" },
        h("h2", { text: `Backlinks (${back.length})` }),
        back.length ? h("ul", { class: "list" }, ...back.map((b) => h("li", { class: "card-row" },
          h("div", { class: "card-row__main" },
            h("a", { class: "wlink", href: wordHref(b.from), text: b.from }),
            ...b.lines.map((line) => h("div", { class: "muted bl-line" }, ...renderText(line))))))) : h("p", { class: "muted", text: "ยังไม่มีคำไหนลิงก์มาหาคำนี้ — ในโน้ตของคำอื่น พิมพ์ [[" + key + "]]" })),
      h("section", { class: "card stack", id: "outgoing" },
        h("h2", { text: `ลิงก์ออก (${out.length})` }),
        out.length ? h("div", { class: "row" }, ...out.map((k) => linkNode({ key: k, label: k, exists: exists(k) }))) : h("p", { class: "muted", text: "โน้ตนี้ยังไม่ลิงก์ไปคำอื่น" })));
  }

  // ---------- ข้อมูลคำ ----------
  function drawInfo() {
    const c = cardOf();
    head.replaceChildren(
      h("div", { class: "row" }, h("a", { class: "btn btn--secondary btn--chip", href: "#/library", text: "← คลังคำ" })),
      h("div", { class: "page-head" }, h("h1", { text: c?.en || key }), c ? h("p", { text: c.th }) : null));
    if (!c) {
      info.replaceChildren(h("div", { class: "notice" }, "คำนี้ยังไม่มีบัตรคำในคลัง — เขียนโน้ตไว้ก่อนได้ หรือ ",
        h("button", { class: "btn btn--chip", type: "button", text: "เพิ่มเป็นบัตรคำ", onclick: () => { flush(); setAddWordPrefill({ word: key }); location.hash = "#/cards"; } })));
      return;
    }
    const st = srs.stateMap([c], db.list("reviews")).get(c.id);
    const meanings = (lex?.meanings || []).slice(0, 3);
    info.replaceChildren(
      h("div", { class: "row tags" },
        c.ipa || lex?.ipa ? h("span", { class: "mono", text: c.ipa || lex.ipa }) : null,
        c.pos ? h("span", { class: "badge", text: POS_LABELS[c.pos] ?? c.pos }) : null,
        h("span", { class: "badge", text: LEVEL_LABELS[lib.levelOf(c.freq)] }),
        h("span", { class: "badge", text: MEMORY_LABELS[lib.memoryStatus(st)] }),
        ...lib.cardTags(c).map((t) => h("span", { class: "badge", text: t }))),
      c.example ? h("p", {}, h("em", { text: c.example })) : null,
      meanings.length ? h("ul", { class: "list" }, ...meanings.map((m) => h("li", { class: "muted", text: `${m.pos ? `(${m.pos}) ` : ""}${m.definition || ""}` }))) : null,
      lex?.th?.length && !c.th ? h("p", { text: thDisplay(lex.th) }) : null);
  }

  // ---------- กราฟรอบคำนี้ (สร้างเมื่อเปิดเท่านั้น) ----------
  let lv = null, depth = 1, ghostOn = false, localTimer = null, localBusy = false;
  function drawLocalBar() {
    localBar.replaceChildren(
      ...[1, 2].map((d) => h("button", { class: `btn btn--chip ${depth === d ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(depth === d), text: `${d} ชั้น`, onclick: () => { depth = d; drawLocalBar(); buildLocal(); } })),
      h("label", { class: "row check" }, h("input", { type: "checkbox", checked: ghostOn, onchange: (e) => { ghostOn = e.target.checked; buildLocal(); } }), h("span", { text: "แสดงคำแนะนำ" })),
      h("a", { class: "btn btn--secondary btn--chip", href: "#/graph", text: "เปิดกราฟทั้งคลัง" }));
  }
  async function buildLocal() {
    if (!lv) return;
    const full = gui.buildFromDb({ ghosts: ghostOn });
    if (!full.nodes.some((n) => n.id === key)) { await lv.setGraph({ nodes: [], edges: [], stats: full.stats }); localInfo.textContent = "คำนี้ยังไม่มีบัตรคำ จึงยังไม่อยู่ในกราฟ"; return; }
    const { ids } = gr.neighborhood(full, key, depth, gr.DEFAULT_ON);
    const sub = { nodes: full.nodes.filter((n) => ids.has(n.id)), edges: full.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), stats: full.stats };
    await lv.setGraph(sub);
    lv.setTypes(gr.DEFAULT_ON);
    lv.select(key);
    localInfo.textContent = `${sub.nodes.length} คำ · ${sub.edges.filter((e) => gr.DEFAULT_ON.includes(e.type)).length} เส้น`;
  }
  local.addEventListener("toggle", async () => {
    if (!local.open || lv || localBusy) return;
    localBusy = true;
    drawLocalBar(); localInfo.textContent = "กำลังโหลด…";
    try {
      await gui.ensureLexicon(cardKeys());
      lv = await gui.createGraphView({ container: localBox, persist: false, onSelect: (id) => { if (id && id !== key) location.hash = wordHref(id); } });
      buildLocal();
    } catch (e) { console.error(e); localInfo.textContent = "โหลดกราฟไม่สำเร็จ — ลองรีเฟรชตอนออนไลน์"; }
    localBusy = false;
  });

  const redraw = () => { drawInfo(); drawPreview(); drawRel(); if (lv) { clearTimeout(localTimer); localTimer = setTimeout(buildLocal, 500); } };
  const unsub = db.subscribe(() => {
    const cur = existingDoc();
    if (document.activeElement !== ta && cur && cur.notes !== ta.value) { ta.value = cur.notes; }   // แก้จากอีกเครื่อง/แท็บ (ขณะไม่ได้พิมพ์)
    redraw();
  });
  db.lexiconGet(key).then((r) => { lex = r.doc; drawInfo(); }).catch(() => {});
  redraw();

  return () => { unsub(); flush(); clearTimeout(saveTimer); clearTimeout(localTimer); lv?.destroy(); };
}
