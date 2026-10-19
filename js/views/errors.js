import * as db from "../db.js";
import * as el from "../errlog.js";
import { h } from "../dom.js";
import { mount as mountPractice } from "./practice.js";
import { takeErrorsTab } from "../scope.js";

const FILTERS = [
  { key: "open", label: "ยังไม่แก้" },
  { key: "resolved", label: "แก้ได้แล้ว" },
  { key: "all", label: "ทั้งหมด" },
];

export function render(root, ctx) {
  let tab = takeErrorsTab() || "list";
  let cleanup = null;
  const content = h("div");
  const tabs = h("div", { class: "row tabs" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "Error Log" }), h("p", { class: "muted", text: "จดข้อผิดพลาดที่เจอ แล้วฝึกเจาะจุดทีละเรื่อง" })),
    tabs, content
  );
  function show() {
    if (cleanup) { cleanup(); cleanup = null; }
    tabs.replaceChildren(...[["list", "รายการ"], ["practice", "ฝึกเจาะจุด"]].map(([k, label]) => h("button", {
      class: `btn ${tab === k ? "" : "btn--secondary"}`, type: "button", text: label, "aria-pressed": String(tab === k),
      onclick: () => { tab = k; show(); } })));
    content.replaceChildren();
    cleanup = (tab === "practice" ? mountPractice : renderList)(content, ctx) || null;
  }
  show();
  return () => { if (cleanup) cleanup(); };
}

function renderList(root, { toast }) {
  let editing = null;      // null | "new" | error
  let filter = "open";
  let category = "ทั้งหมด";

  const body = h("div");
  root.replaceChildren(body);

  const occur = (errorId) => db.append("errorEvents", { errorId, type: "occurred", at: Date.now() });
  const mark = (errorId, type) => db.append("errorEvents", { errorId, type, at: Date.now() });

  function draw() {
    const errors = db.list("errors");
    const events = db.list("errorEvents");
    const stats = el.errorStats(errors, events);
    const cats = el.byCategory(errors, events);

    let shown = errors.filter((e) => {
      const r = stats.get(e.id).resolved;
      return filter === "all" || (filter === "resolved" ? r : !r);
    });
    if (category !== "ทั้งหมด") shown = shown.filter((e) => e.category === category);
    shown.sort((a, b) => stats.get(b.id).count - stats.get(a.id).count || b.createdAt - a.createdAt);

    body.replaceChildren(
      chart(cats),
      h("div", { class: "row", style: "margin:16px 0" },
        h("button", { class: "btn", type: "button", text: "+ เพิ่มข้อผิด", onclick: () => { editing = "new"; draw(); } }),
        ...FILTERS.map((f) => h("button", { class: `btn ${filter === f.key ? "" : "btn--secondary"}`, type: "button", text: f.label, "aria-pressed": String(filter === f.key),
          onclick: () => { filter = f.key; draw(); } })),
        h("select", { class: "input select", "aria-label": "กรองตามหมวด", onchange: (e) => { category = e.target.value; draw(); } },
          ...["ทั้งหมด", ...el.CATEGORIES].map((c) => h("option", { value: c, text: c, selected: c === category })))),
      ...(editing ? [form()] : []),
      h("ul", { class: "list" }, shown.length ? shown.map((e) => row(e, stats.get(e.id))) : h("li", { class: "muted", text: errors.length ? "ไม่มีรายการในตัวกรองนี้" : "ยังไม่มีข้อผิด กด “เพิ่มข้อผิด” เมื่อเจอข้อผิดครั้งแรก" }))
    );
  }

  function chart(cats) {
    const max = Math.max(1, ...Object.values(cats));
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    return h("section", { class: "card stack" },
      h("h2", { text: "จำนวนครั้งที่ผิด แยกตามหมวด" }),
      total ? h("div", { class: "bars", role: "list" }, ...el.CATEGORIES.map((c) =>
        h("div", { class: "bar", role: "listitem", "aria-label": `${c} ${cats[c]} ครั้ง` },
          h("span", { class: "bar__label", text: c }),
          h("span", { class: "bar__track" }, h("i", { style: `width:${(cats[c] / max) * 100}%` })),
          h("span", { class: "mono bar__n", text: String(cats[c]) }))))
        : h("p", { class: "muted", text: "ยังไม่มีข้อมูล" }));
  }

  function row(e, s) {
    return h("li", { class: `card-row ${s.resolved ? "is-resolved" : ""}` },
      h("div", { class: "card-row__main" },
        h("div", {}, h("s", { class: "bad", text: e.wrong }), "  →  ", h("strong", { class: "good", text: e.right })),
        e.note ? h("div", { class: "muted", text: e.note }) : null,
        h("div", { class: "row tags" }, h("span", { class: "badge", text: e.category }),
          h("span", { class: "mono muted", text: `ผิด ${s.count} ครั้ง` }), s.resolved ? h("span", { class: "badge", text: "แก้ได้แล้ว" }) : null)),
      h("div", { class: "row" },
        h("button", { class: "btn", type: "button", text: "ผิดอีก +1", onclick: () => occur(e.id) }),
        h("button", { class: "btn btn--secondary", type: "button", text: s.resolved ? "เปิดอีกครั้ง" : "แก้ได้แล้ว", onclick: () => mark(e.id, s.resolved ? "reopened" : "resolved") }),
        h("button", { class: "btn btn--secondary", type: "button", text: "แก้ไข", onclick: () => { editing = e; draw(); } }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ลบ", onclick: () => {
          if (!confirm("ลบข้อผิดนี้? (ประวัติการนับยังถูกเก็บไว้)")) return;
          db.softDelete("errors", e.id);
          toast("ลบแล้ว");
        } })));
  }

  function form() {
    const e = editing === "new" ? { wrong: "", right: "", category: "", note: "" } : editing;
    const f = {
      wrong: h("input", { class: "input", value: e.wrong, autocomplete: "off", placeholder: "เช่น I go to school yesterday" }),
      right: h("input", { class: "input", value: e.right, autocomplete: "off", placeholder: "เช่น I went to school yesterday" }),
      category: h("select", { class: "input select" }, h("option", { value: "", text: "เลือกหมวด…" }),
        ...el.CATEGORIES.map((c) => h("option", { value: c, text: c, selected: c === e.category }))),
      note: h("textarea", { class: "input", rows: 2, value: e.note || "", placeholder: "โน้ต (ไม่บังคับ) เช่น กฎที่ลืม" }),
    };
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    const field = (label, input) => h("label", { class: "field" }, h("span", { text: label }), input);
    return h("form", { class: "card form", novalidate: true,
      onsubmit: (ev) => {
        ev.preventDefault();
        const data = { wrong: f.wrong.value.trim(), right: f.right.value.trim(), category: f.category.value, note: f.note.value.trim() };
        const msg = el.validateError(data);
        err.hidden = !msg;
        if (msg) { err.textContent = msg; return; }
        if (editing === "new") { const doc = db.create("errors", data); occur(doc.id); }   // ผิดครั้งแรก = 1 event
        else db.update("errors", e.id, data);
        editing = null;
        draw();
        toast("บันทึกแล้ว");
      } },
      h("h2", { text: editing === "new" ? "เพิ่มข้อผิด" : "แก้ไขข้อผิด" }),
      field("ที่ผิด (wrong)", f.wrong), field("ที่ถูก (right)", f.right), field("หมวด", f.category), field("โน้ต", f.note), err,
      h("div", { class: "row" },
        h("button", { class: "btn", type: "submit", text: "บันทึก" }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ยกเลิก", onclick: () => { editing = null; draw(); } })));
  }

  const unsub = db.subscribe(() => { if (!editing) draw(); });
  draw();
  return unsub;
}
