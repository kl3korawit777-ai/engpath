// กราฟเชื่อมโยงคำทั้งคลัง (Global graph) — โหนด = บัตรคำ, เส้น = ความสัมพันธ์หลายชนิดที่เปิด/ปิดได้
import * as db from "../db.js";
import * as lib from "../library.js";
import * as gr from "../graph.js";
import * as ui from "../graphui.js";
import { wordKey } from "../lexicon.js";
import { setReviewScope, setAddWordPrefill } from "../scope.js";
import { MEMORY_LABELS } from "../data/lexicon-config.js";
import { h } from "../dom.js";

const TYPES_KEY = "engpath.graphTypes";
const readTypes = () => { try { const v = JSON.parse(localStorage.getItem(TYPES_KEY)); if (Array.isArray(v)) return v.filter((t) => gr.EDGE_TYPES[t]); } catch { /* ใช้ค่าเริ่มต้น */ } return [...gr.DEFAULT_ON]; };
const saveTypes = (t) => { try { localStorage.setItem(TYPES_KEY, JSON.stringify(t)); } catch { /* ignore */ } };

export function render(root, { toast }) {
  let view = null, graph = null, alive = true;
  let types = readTypes();
  let ghosts = false;
  let statuses = new Set();
  let tagPath = "";
  let selectedId = null;
  let loadingLex = false;
  let rebuildTimer = null;

  const info = h("p", { class: "muted mono", role: "status" });
  const controls = h("section", { class: "card stack graph-controls" });
  const box = h("div", { class: "graph-box", role: "application", "aria-label": "กราฟเชื่อมโยงคำ ใช้นิ้วหรือเมาส์ลาก/ซูมได้ เลือกคำจากช่องค้นหาเพื่อไปที่โหนด" });
  const side = h("aside", { class: "card stack graph-side", "aria-live": "polite" });
  const fam = h("section", { class: "card stack" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "กราฟคำ" }), h("p", { class: "muted", text: "เห็นว่าคำในคลังเชื่อมโยงกันอย่างไร — กดโหนดเพื่อดูรายละเอียดและทบทวนเป็นกลุ่ม" })),
    controls, info, h("div", { class: "graph-grid" }, box, side), fam);

  const cardKeys = () => db.list("cards").map((c) => wordKey(c.en));

  // ---------- ตัวควบคุม ----------
  function tagPaths() {
    const out = [], walk = (ns) => ns.forEach((n) => { out.push(n.path); walk(n.children); });
    walk(lib.buildTagTree(db.list("cards")));
    return out;
  }

  function drawControls() {
    const searchBox = h("input", { class: "input", type: "search", placeholder: "ค้นหาคำแล้วซูมไปที่โหนด", "aria-label": "ค้นหาคำในกราฟ", autocomplete: "off", list: "graph-words" });
    const dl = h("datalist", { id: "graph-words" });
    const go = () => {
      const hits = gr.findNodes(graph, searchBox.value, 1);
      if (!hits.length) { toast("ไม่พบคำนี้ในกราฟ"); return; }
      view.focus(hits[0].id);
    };
    searchBox.addEventListener("input", () => { dl.replaceChildren(...gr.findNodes(graph || { nodes: [] }, searchBox.value, 8).map((n) => h("option", { value: n.id }))); });
    searchBox.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    searchBox.addEventListener("change", go);

    const typeChips = Object.entries(gr.EDGE_TYPES).map(([k, t]) => h("button", {
      class: `btn btn--chip ${types.includes(k) ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(types.includes(k)),
      onclick: () => { types = types.includes(k) ? types.filter((x) => x !== k) : [...types, k]; saveTypes(types); view.setTypes(types); updateInfo(); drawControls(); if (selectedId) drawSide(); },
    }, h("i", { class: "dot", style: `background:${t.color}` }), t.label));

    const statusChips = ["new", "learning", "known"].map((s) => h("button", {
      class: `btn btn--chip ${statuses.has(s) ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(statuses.has(s)),
      onclick: () => { statuses.has(s) ? statuses.delete(s) : statuses.add(s); view.setStatusFilter(statuses); updateInfo(); drawControls(); },
    }, MEMORY_LABELS[s]));

    const tagSel = h("select", { class: "input select", "aria-label": "กรองตามแท็ก", onchange: (e) => { tagPath = e.target.value; applyTagFilter(); updateInfo(); } },
      h("option", { value: "", text: "ทุกแท็ก" }), ...tagPaths().map((p) => h("option", { value: p, text: p, selected: p === tagPath })));

    const missing = graph ? graph.nodes.filter((n) => !n.ghost).length - graph.stats.lexiconLoaded : 0;
    controls.replaceChildren(
      h("div", { class: "row" }, searchBox, dl, tagSel),
      h("div", { class: "stack" }, h("strong", { text: "ชนิดเส้น" }), h("div", { class: "row lib-chips" }, ...typeChips)),
      h("div", { class: "row" }, h("strong", { text: "สถานะ" }), ...statusChips,
        h("label", { class: "row check" }, h("input", { type: "checkbox", checked: ghosts, onchange: (e) => { ghosts = e.target.checked; rebuild(); } }), h("span", { text: "แสดงคำแนะนำ (คำที่ยังไม่มีบัตร)" }))),
      h("div", { class: "row" },
        h("button", { class: "btn btn--secondary", type: "button", text: "จัดวางใหม่", onclick: async () => { await view.relayout(); toast("จัดวางใหม่แล้ว"); } }),
        h("button", { class: "btn btn--secondary", type: "button", text: "ให้พอดีหน้าจอ", onclick: () => view.fit() }),
        missing > 0 ? h("button", { class: "btn btn--secondary", type: "button", disabled: loadingLex || !navigator.onLine, text: loadingLex ? "กำลังโหลด…" : `โหลดข้อมูลคำที่ยังไม่มีในเครื่อง (${missing} คำ)`,
          title: "อ่านจาก Firestore ทีละคำ (นับ read) เพื่อให้เห็นคำพ้อง/คำตรงข้ามครบ — กดเมื่อต้องการเท่านั้น", onclick: loadMissing }) : null));
  }

  function applyTagFilter() {
    if (!tagPath) { view.setIdFilter(null); return; }
    view.setIdFilter(new Set(db.list("cards").filter((c) => lib.tagMatches(c, tagPath)).map((c) => wordKey(c.en))));
  }

  function updateInfo() {
    if (!graph) return;
    const v = view.visibleCount(), real = graph.nodes.filter((n) => !n.ghost).length;
    info.textContent = `${v.nodes} โหนด · ${v.edges} เส้นที่แสดง · ข้อมูลคำพ้อง/ตรงข้ามจากคลังคำ ${graph.stats.lexiconLoaded}/${real} คำ${graph.stats.skippedSentences ? ` · ข้าม ${graph.stats.skippedSentences} ประโยคที่มีคำในคลังมากเกินไป` : ""}`;
  }

  async function loadMissing() {
    loadingLex = true; drawControls();
    const keys = cardKeys();
    const r = await ui.fetchMissingLexicon(keys, (d, t) => { info.textContent = `กำลังโหลดข้อมูลคำ ${d}/${t}…`; });
    loadingLex = false;
    toast(r.tried ? `โหลดแล้ว ${r.got}/${r.tried} คำ (ที่เหลือยังไม่เคยดึงจาก API)` : "ไม่มีคำที่ต้องโหลด");
    rebuild();
  }

  // ---------- แผงข้าง ----------
  function drawSide() {
    const n = selectedId && graph.nodes.find((x) => x.id === selectedId);
    if (!n) {
      side.replaceChildren(h("h2", { text: "รายละเอียด" }), h("p", { class: "muted", text: "กดโหนดเพื่อดูคำแปลและเพื่อนบ้าน" }),
        h("div", { class: "stack" }, h("strong", { text: "สีโหนด" }), h("div", { class: "row" }, ...["new", "learning", "known"].map((s) => h("span", { class: "badge" }, h("i", { class: `dot dot--${s}` }), MEMORY_LABELS[s])))), h("small", { class: "muted", text: "ขนาดโหนด = จำนวนเส้นที่แสดงอยู่" }));
      return;
    }
    const on = new Set(types);
    const nb = new Map();
    for (const e of graph.edges) {
      if (!on.has(e.type) || (e.source !== n.id && e.target !== n.id)) continue;
      const o = e.source === n.id ? e.target : e.source;
      (nb.get(e.type) || nb.set(e.type, new Set()).get(e.type)).add(o);
    }
    const group = gr.reviewGroup(graph, n.id, types);
    side.replaceChildren(...[
      h("h2", { text: n.label }),
      n.th ? h("p", { text: n.th }) : null,
      h("div", { class: "row tags" }, h("span", { class: "badge" }, h("i", { class: `dot dot--${n.status}` }), ui.statusLabel(n.status))),
      ...[...nb].map(([type, set]) => h("div", { class: "stack" },
        h("strong", {}, h("i", { class: "dot", style: `background:${gr.EDGE_TYPES[type].color}` }), `${gr.EDGE_TYPES[type].label} (${set.size})`),
        h("div", { class: "row" }, ...[...set].sort().map((o) => h("button", { class: "wlink", type: "button", text: o, onclick: () => view.focus(o) }))))),
      !nb.size ? h("p", { class: "muted", text: "ไม่มีเส้นเชื่อมในชนิดที่เปิดอยู่" }) : null,
      h("div", { class: "row" },
        n.ghost
          ? h("button", { class: "btn", type: "button", text: "เพิ่มเป็นบัตรคำ", onclick: () => { setAddWordPrefill({ word: n.id }); location.hash = "#/cards"; } })
          : [h("a", { class: "btn", href: `#/word/${encodeURIComponent(n.id)}`, text: "เปิดหน้าคำ" }),
             h("button", { class: "btn btn--secondary", type: "button", disabled: group.length < 1, text: `ทบทวนกลุ่มนี้ (${group.length} คำ)`,
               onclick: () => { setReviewScope({ type: "cards", ids: group.map((g) => g.cardId), label: `กลุ่มจากกราฟ: ${n.label} (${group.length})` }); location.hash = "#/cards"; } })])].filter(Boolean));
  }

  // ---------- ตระกูลคำที่เสนอ ----------
  function drawFamilies() {
    const decided = new Set(db.list("wordFamilies").map((f) => gr.familyId(f.members || [])));
    const cands = gr.familyCandidates(cardKeys(), decided);
    const confirmed = db.list("wordFamilies").filter((f) => f.confirmed);
    fam.replaceChildren(...[
      h("h2", { text: "ตระกูลคำ" }),
      h("p", { class: "muted", text: "ระบบเดาจากรากคำแบบง่าย ๆ — เส้นจะขึ้นในกราฟเมื่อคุณกดยืนยันเท่านั้น" }),
      cands.length ? h("ul", { class: "list" }, ...cands.slice(0, 20).map((m) => h("li", { class: "card-row" },
        h("div", { class: "card-row__main" }, h("strong", { text: m.join(" · ") })),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", text: "ยืนยัน", onclick: () => { db.create("wordFamilies", { members: m, confirmed: true }); toast("ยืนยันตระกูลคำแล้ว"); } }),
          h("button", { class: "btn btn--secondary", type: "button", text: "ไม่ใช่", onclick: () => { db.create("wordFamilies", { members: m, confirmed: false }); } }))))) : h("p", { class: "muted", text: "ไม่มีกลุ่มที่ต้องยืนยัน" }),
      cands.length > 20 ? h("p", { class: "muted", text: `และอีก ${cands.length - 20} กลุ่ม` }) : null,
      confirmed.length ? h("div", { class: "stack" }, h("strong", { text: "ที่ยืนยันแล้ว" }), ...confirmed.map((f) => h("div", { class: "row" },
        h("span", { text: f.members.join(" · ") }),
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ยกเลิก", onclick: () => db.softDelete("wordFamilies", f.id) })))) : null].filter(Boolean));
  }

  // ---------- สร้าง/สร้างใหม่ ----------
  async function rebuild() {
    clearTimeout(rebuildTimer);
    graph = ui.buildFromDb({ ghosts });
    if (!view) return;
    await view.setGraph(graph, { keepView: Boolean(view.__drawn) });
    if (!alive) return;
    view.__drawn = true;
    view.setTypes(types); view.setStatusFilter(statuses); applyTagFilter();
    if (selectedId && graph.nodes.some((n) => n.id === selectedId)) view.select(selectedId); else selectedId = null;
    drawControls(); drawSide(); drawFamilies(); updateInfo();
  }

  let sig = "";
  const signature = () => ["cards", "links", "wordFamilies", "reviews", "clips", "journal"].map((c) => { const l = db.list(c); return `${l.length}:${l.reduce((m, d) => Math.max(m, d.updatedAt || 0), 0)}`; }).join("|");
  const unsub = db.subscribe(() => {
    const s = signature();
    if (s === sig) return;
    sig = s;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { if (alive && view) rebuild(); }, 400);
  });

  (async () => {
    if (!db.list("cards").length) {
      box.replaceChildren(h("p", { class: "muted pad", text: "ยังไม่มีบัตรคำ — เพิ่มคำที่หน้า “บัตรคำ” แล้วกราฟจะปรากฏที่นี่" }));
      drawSide(); drawFamilies();
      return;
    }
    info.textContent = "กำลังโหลดข้อมูลคำ…";
    await ui.ensureLexicon(cardKeys());
    if (!alive) return;
    try {
      view = await ui.createGraphView({ container: box, persist: true, onSelect: (id) => { selectedId = id; drawSide(); }, onStatus: (t) => { if (t) info.textContent = t; else updateInfo(); } });
    } catch (e) {
      console.error(e);
      box.replaceChildren(h("div", { class: "notice notice--bad", role: "alert", text: "โหลดไลบรารีกราฟไม่สำเร็จ — ถ้าเพิ่งอัปเดตแอป ให้รีเฟรช 2 ครั้งตอนออนไลน์" }));
      return;
    }
    if (!alive) { view.destroy(); return; }
    sig = signature();
    rebuild();
  })();

  return () => { alive = false; clearTimeout(rebuildTimer); unsub(); view?.destroy(); };
}
