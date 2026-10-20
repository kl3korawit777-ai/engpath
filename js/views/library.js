// คลังคำศัพท์: ค้นหา, กรองหลายมิติ (ชนิดคำ / ระดับ / แหล่งที่มา / แท็ก), ต้นไม้แท็กพร้อมจำนวนคำ, เปลี่ยนชื่อ/ย้ายแท็กทั้งกิ่ง
import * as db from "../db.js";
import * as srs from "../srs.js";
import * as lib from "../library.js";
import { LEVEL_LABELS, SOURCE_LABELS, POS_LABELS, MEMORY_LABELS } from "../data/lexicon-config.js";
import { wordKey } from "../lexicon.js";
import { h } from "../dom.js";
import { setReviewScope } from "../scope.js";

const PAGE = 100;

export function render(root, { toast }) {
  const criteria = { q: "", tags: [], pos: [], levels: [], sources: [], memory: [] };
  let renaming = null;        // path ของแท็กที่กำลังเปลี่ยนชื่อ/ย้าย
  let activeFolderId = null;  // Smart folder ที่โหลดเงื่อนไขมาใช้อยู่
  let folderForm = null;      // null | { mode: "new" } | { mode: "rename", id }
  let shown = PAGE;
  let ctx = null;

  const aside = h("aside", { class: "lib-filters" });
  const list = h("div");
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "คลังคำศัพท์" }), h("p", { class: "muted", text: "ค้นหาและจัดหมวดบัตรคำของคุณ" })),
    h("div", { class: "lib-grid" }, aside, list)
  );

  const resetCriteria = () => Object.assign(criteria, { q: "", tags: [], pos: [], levels: [], sources: [], memory: [], wrongMin: undefined, addedWithinDays: undefined, dueOnly: false });
  const applyFolder = (f) => {
    const c = lib.sanitizeConditions(f.conditions);
    resetCriteria();
    for (const k of ["tags", "pos", "levels", "sources", "memory"]) criteria[k] = [...(c[k] || [])];
    Object.assign(criteria, { wrongMin: c.wrongMin, addedWithinDays: c.addedWithinDays, dueOnly: Boolean(c.dueOnly) });
    activeFolderId = f.id;
    shown = PAGE;
    draw();
  };
  const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); shown = PAGE; draw(); };

  function computeCtx() {
    const cards = db.list("cards");
    const reviews = db.list("reviews");
    ctx = { cards, states: srs.stateMap(cards, reviews), wrong: lib.wrongCounts(reviews), now: Date.now() };
  }

  const chipGroup = (title, field, options) => h("div", { class: "stack lib-group" },
    h("strong", { text: title }),
    h("div", { class: "row lib-chips" }, ...options.map(([value, label, count]) => h("button", {
      class: `btn btn--chip ${criteria[field].includes(value) ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(criteria[field].includes(value)),
      text: `${label} ${count}`, onclick: () => toggle(criteria[field], value),
    }))));

  function drawFilters() {
    const cards = ctx.cards;
    const count = (fn) => cards.reduce((n, c) => n + (fn(c) ? 1 : 0), 0);
    const posValues = [...new Set(cards.map((c) => c.pos || ""))].sort();
    const levelValues = ["basic", "medium", "academic", "unknown"];
    const sourceValues = [...new Set(cards.map((c) => c.source || "manual"))].sort();

    const search = h("input", { class: "input", type: "search", value: criteria.q, placeholder: "ค้นหาคำ ความหมาย ประโยค หรือแท็ก", "aria-label": "ค้นหา",
      oninput: (e) => { criteria.q = e.target.value; shown = PAGE; drawList(); } });

    const selectedTags = criteria.tags.length
      ? h("div", { class: "row lib-chips" }, ...criteria.tags.map((t) => h("button", { class: "btn btn--chip", type: "button", title: "เอาออก", text: `${t} ✕`, onclick: () => toggle(criteria.tags, t) })))
      : null;

    const renameBox = renaming ? renameForm(renaming) : null;

    aside.replaceChildren(...[
      search,
      lib.hasCriteria(criteria) ? h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ล้างตัวกรอง", onclick: () => {
        resetCriteria(); activeFolderId = null; shown = PAGE; draw();
      } }) : null,
      foldersPanel(),
      chipGroup("ชนิดคำ", "pos", posValues.map((p) => [p, POS_LABELS[p] ?? p, count((c) => (c.pos || "") === p)])),
      chipGroup("ระดับ (ตามความถี่)", "levels", levelValues.map((l) => [l, LEVEL_LABELS[l], count((c) => lib.cardLevel(c) === l)]).filter(([, , n]) => n || criteria.levels.length)),
      chipGroup("แหล่งที่มา", "sources", sourceValues.map((s) => [s, SOURCE_LABELS[s] ?? s, count((c) => (c.source || "manual") === s)])),
      chipGroup("สถานะการจำ", "memory", ["new", "learning", "known"].map((m) => [m, MEMORY_LABELS[m], count((c) => lib.memoryStatus(ctx.states.get(c.id)) === m)])),
      extraPanel(),
      h("div", { class: "stack lib-group" }, h("strong", { text: "แท็ก" }), selectedTags, renameBox, tagTree())].filter(Boolean));
  }

  function tagTree() {
    const tree = lib.buildTagTree(ctx.cards);
    if (!tree.length) return h("p", { class: "muted", text: "ยังไม่มีแท็ก (ใส่แท็กเช่น science/biology ตอนเพิ่มหรือแก้บัตร)" });
    const node = (n) => {
      const label = h("div", { class: "tag-row" },
        h("button", { class: `tag-name ${criteria.tags.includes(n.path) ? "is-on" : ""}`, type: "button", "aria-pressed": String(criteria.tags.includes(n.path)),
          text: `${n.name} (${n.count})`, title: n.path, onclick: () => toggle(criteria.tags, n.path) }),
        h("button", { class: "tag-edit", type: "button", "aria-label": `เปลี่ยนชื่อหรือย้ายแท็ก ${n.path}`, title: "เปลี่ยนชื่อ / ย้าย", text: "✎",
          onclick: () => { renaming = n.path; drawFilters(); } }));
      return n.children.length
        ? h("details", { open: true, class: "tag-node" }, h("summary", {}, label), h("ul", { class: "tagtree" }, ...n.children.map((c) => h("li", {}, node(c)))))
        : label;
    };
    return h("ul", { class: "tagtree" }, ...tree.map((n) => h("li", {}, node(n))));
  }

  function renameForm(from) {
    const input = h("input", { class: "input", value: from, "aria-label": "ชื่อแท็กใหม่", autocomplete: "off" });
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    return h("form", { class: "card form", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        let patches;
        try { patches = lib.renameTag(ctx.cards, from, input.value); } catch (ex) { err.hidden = false; err.textContent = ex.message; return; }
        const to = lib.normalizeTag(input.value);
        if (!patches.length) { renaming = null; draw(); return; }
        if (!confirm(`เปลี่ยนแท็ก “${from}” เป็น “${to}” (รวมแท็กลูกทั้งหมด) ในบัตร ${patches.length} ใบ?`)) return;
        for (const p of patches) db.update("cards", p.id, { tags: p.tags });
        // Smart folder ที่อ้างอิงแท็กนี้ เปลี่ยนตามด้วย
        for (const f of db.list("smartFolders")) {
          const nc = lib.renameTagInConditions(f.conditions, from, to);
          if (nc) db.update("smartFolders", f.id, { conditions: nc });
        }
        // ตัวกรองที่เลือกอยู่ ย้ายตามชื่อใหม่
        criteria.tags = criteria.tags.map((t) => (t === from || t.startsWith(`${from}/`)) ? `${to}${t.slice(from.length)}` : t);
        renaming = null;
        toast(`เปลี่ยนแท็กในบัตร ${patches.length} ใบแล้ว`);
        draw();
      } },
      h("small", { class: "muted", text: "เปลี่ยนชื่อหรือย้าย (ใส่ path ใหม่ เช่น science → sci หรือ biology → science/biology)" }),
      input, err,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "submit", text: "ตกลง" }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ยกเลิก", onclick: () => { renaming = null; drawFilters(); } })));
  }

  function extraPanel() {
    const num = (label, field, placeholder) => h("label", { class: "field" }, h("span", { text: label }),
      h("input", { class: "input", type: "number", min: "1", inputmode: "numeric", value: criteria[field] ?? "", placeholder,
        oninput: (e) => { const v = Math.floor(Number(e.target.value)); criteria[field] = e.target.value !== "" && v >= 1 ? v : undefined; shown = PAGE; drawList(); drawFolderButtons(); } }));
    return h("div", { class: "stack lib-group" }, h("strong", { text: "เงื่อนไขเพิ่มเติม" }),
      num("ตอบผิด (ลืม) ≥ กี่ครั้ง", "wrongMin", "เช่น 2"),
      num("เพิ่มภายใน กี่วัน", "addedWithinDays", "เช่น 7"),
      h("label", { class: "row check" }, h("input", { type: "checkbox", checked: criteria.dueOnly, onchange: (e) => { criteria.dueOnly = e.target.checked; shown = PAGE; draw(); } }), h("span", { text: "เฉพาะที่ถึงรอบทบทวน" })));
  }

  const folderButtons = h("div", { class: "stack" });
  function drawFolderButtons() {
    const folders = db.list("smartFolders");
    const active = folders.find((f) => f.id === activeFolderId);
    const conds = lib.sanitizeConditions(criteria);
    const canSave = lib.hasCriteria(conds);
    folderButtons.replaceChildren(...[
      folderForm ? nameForm() : null,
      !folderForm && canSave ? h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "+ บันทึกตัวกรองนี้เป็น Smart folder", onclick: () => { folderForm = { mode: "new" }; drawFolderButtons(); } }) : null,
      !folderForm && active ? h("div", { class: "row lib-chips" },
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "เปลี่ยนชื่อ", onclick: () => { folderForm = { mode: "rename", id: active.id }; drawFolderButtons(); } }),
        canSave ? h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "อัปเดตเงื่อนไข", title: "ใช้ตัวกรองปัจจุบันแทนเงื่อนไขของโฟลเดอร์นี้", onclick: () => { db.update("smartFolders", active.id, { conditions: conds }); toast("อัปเดตเงื่อนไขแล้ว"); } }) : null,
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ลบ", onclick: () => {
          if (!confirm(`ลบ Smart folder “${active.name}” ? (บัตรคำไม่ถูกลบ)`)) return;
          db.softDelete("smartFolders", active.id); activeFolderId = null; toast("ลบแล้ว"); draw();
        } })) : null,
    ].filter(Boolean));
  }

  function nameForm() {
    const rename = folderForm.mode === "rename";
    const cur = rename ? db.get("smartFolders", folderForm.id) : null;
    const input = h("input", { class: "input", value: cur?.name || "", placeholder: "ชื่อ Smart folder", maxlength: "100", "aria-label": "ชื่อ Smart folder", autocomplete: "off" });
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    return h("form", { class: "card form", novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) { err.hidden = false; err.textContent = "ตั้งชื่อก่อน"; return; }
        if (rename) db.update("smartFolders", cur.id, { name });
        else activeFolderId = db.create("smartFolders", { name, conditions: lib.sanitizeConditions(criteria) }).id;
        folderForm = null;
        toast("บันทึกแล้ว");
        draw();
      } },
      input, err,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "submit", text: "บันทึก" }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ยกเลิก", onclick: () => { folderForm = null; drawFolderButtons(); } })));
  }

  function foldersPanel() {
    const folders = db.list("smartFolders").sort((a, b) => a.name.localeCompare(b.name));
    const labels = { level: LEVEL_LABELS, memory: MEMORY_LABELS, source: SOURCE_LABELS, pos: POS_LABELS };
    drawFolderButtons();
    return h("div", { class: "stack lib-group" }, h("strong", { text: "Smart folder" }),
      folders.length ? h("ul", { class: "tagtree" }, ...folders.map((f) => {
        const conds = lib.sanitizeConditions(f.conditions);
        const n = lib.filterCards(ctx.cards, conds, ctx).length;
        return h("li", {}, h("div", { class: "tag-row" },
          h("button", { class: `tag-name ${f.id === activeFolderId ? "is-on" : ""}`, type: "button", "aria-pressed": String(f.id === activeFolderId),
            text: `${f.name} (${n})`, title: lib.describeConditions(conds, labels), onclick: () => applyFolder(f) }),
          h("button", { class: "tag-edit", type: "button", "aria-label": `ทบทวน Smart folder ${f.name}`, title: "ทบทวนบัตรในโฟลเดอร์นี้", text: "▶",
            onclick: () => { setReviewScope({ type: "folder", id: f.id }); location.hash = "#/cards"; } })));
      })) : h("p", { class: "muted", text: "ยังไม่มี — ตั้งตัวกรองแล้วกด “บันทึกเป็น Smart folder”" }),
      folderButtons);
  }

  function drawList() {
    const result = lib.filterCards(ctx.cards, criteria, ctx).sort((a, b) => a.en.localeCompare(b.en));
    const rows = result.slice(0, shown).map((c) => row(c));
    list.replaceChildren(...[
      h("p", { class: "muted mono", text: `${result.length} / ${ctx.cards.length} ใบ` }),
      h("ul", { class: "list" }, rows.length ? rows : h("li", { class: "muted", text: ctx.cards.length ? "ไม่พบบัตรที่ตรงกับตัวกรอง" : "ยังไม่มีบัตรคำ เริ่มเรียนคำใหม่ได้ที่หน้า “วันนี้”" })),
      result.length > shown ? h("button", { class: "btn btn--secondary", type: "button", text: `แสดงเพิ่ม (เหลือ ${result.length - shown})`, onclick: () => { shown += PAGE; drawList(); } }) : null].filter(Boolean));
  }

  function row(c) {
    const lvl = lib.cardLevel(c);
    const posSel = c.source === "library" ? h("span", { class: "badge", text: POS_LABELS[c.pos || ""] ?? c.pos }) : h("select", { class: "input select pos-select", "aria-label": `ชนิดคำของ ${c.en}`,
      onchange: (e) => db.update("cards", c.id, { pos: e.target.value || null }) },
      ...Object.entries(POS_LABELS).map(([v, l]) => h("option", { value: v, text: l, selected: v === (c.pos || "") })));
    return h("li", { class: "card-row" },
      h("div", { class: "card-row__main" },
        h("div", {}, h("a", { class: "wlink", href: `#/word/${encodeURIComponent(wordKey(c.en))}`, title: "เปิดหน้าคำ (โน้ต + Backlinks)" }, h("strong", { text: c.en })), h("span", { text: `  ${c.th}` })),
        h("div", { class: "row tags" },
          h("span", { class: "badge", text: LEVEL_LABELS[lvl] }),
          h("span", { class: "badge", text: MEMORY_LABELS[lib.memoryStatus(ctx.states.get(c.id))] }),
          ...lib.cardTags(c).map((t) => h("button", { class: "badge badge--btn", type: "button", text: t, title: "กรองด้วยแท็กนี้", onclick: () => { if (!criteria.tags.includes(t)) toggle(criteria.tags, t); } })))),
      posSel);
  }

  function draw() { drawFilters(); drawList(); }

  const unsub = db.subscribe(() => { computeCtx(); if (!renaming && !folderForm) drawFilters(); drawList(); });
  computeCtx();
  draw();
  return unsub;
}
