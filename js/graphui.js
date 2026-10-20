// ส่วนแสดงกราฟ (Cytoscape) ใช้ร่วมกันระหว่างหน้า Global graph และ Local graph ในหน้าคำ
// ข้อมูล → graph.js (pure) · ไฟล์นี้จัดการโหลด lexicon จาก cache, วาด, layout + จำตำแหน่ง, การเลือกโหนด
import * as db from "./db.js";
import { vocab } from "./vocab.js";
import { lexiconFromEntry, familiesFromEntries } from "./libentry.js";
import * as srs from "./srs.js";
import * as lib from "./library.js";
import * as gr from "./graph.js";
import { splitSentences } from "./clips.js";
import { wordKey } from "./lexicon.js";
import { forceLayout } from "./layout.js";

const VENDOR = "../vendor/cytoscape-3.34.4.esm.min.mjs";
const POS_KEY = "engpath.graphPositions";
const LAYOUT_ALL_RATIO = 0.1;      // ถ้าโหนดที่ไม่มีตำแหน่งเกินสัดส่วนนี้ จัดวางใหม่ทั้งกราฟ
let cytoscapePromise = null;

export const loadCytoscape = () => (cytoscapePromise ||= import(VENDOR).then((m) => m.default));

// ---------- ข้อมูล ----------
/** ข้อมูลคำ (คำพ้อง/ตรงข้าม/ความหมาย) มาจากคลังกลางที่โหลดไว้ในเครื่อง — คืนจำนวนคำที่พบในคลัง (คง API เดิมไว้ให้หน้าที่เรียกอยู่) */
export async function ensureLexicon(keys) {
  return keys.filter((k) => vocab.peek(k)).length;
}

export function collectInput({ ghosts = false } = {}) {
  const cards = db.list("cards");
  const states = srs.stateMap(cards, db.list("reviews"));
  const texts = [];
  for (const c of cards) if (c.example) texts.push(c.example);
  for (const c of db.list("clips")) for (const s of c.sentences || []) if (s.text) texts.push(s.text);
  for (const j of db.list("journal")) for (const s of splitSentences(j.text || "")) texts.push(s);
  const lexicon = new Map(), entries = [];
  for (const c of cards) { const k = wordKey(c.en); const w = vocab.peek(k); if (w) { lexicon.set(k, lexiconFromEntry(w)); entries.push(w); } }
  return {
    cards, links: db.list("links"), lexicon, families: [...db.list("wordFamilies"), ...familiesFromEntries(entries)], texts, ghosts,
    statusOf: (key) => { const c = cards.find((x) => wordKey(x.en) === key); return c ? lib.memoryStatus(states.get(c.id)) : "new"; },
  };
}

export function buildFromDb(opts) {
  const input = collectInput(opts);
  // statusOf เรียกต่อโหนด: ทำ map เพื่อไม่ให้ O(n²)
  const byKey = new Map(input.cards.map((c) => [wordKey(c.en), c]));
  const states = srs.stateMap(input.cards, db.list("reviews"));
  input.statusOf = (key) => { const c = byKey.get(key); return c ? lib.memoryStatus(states.get(c.id)) : "new"; };
  return gr.buildGraph(input);
}

// ---------- ตำแหน่งที่จำไว้ ----------
function loadPositions() { try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch { return {}; } }
function savePositions(p) { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* เต็ม/ปิดไว้ — ไม่เป็นไร */ } }
export function clearPositions() { try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ } }

// ---------- วาด ----------
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const STATUS_LABEL = { new: "ใหม่", learning: "กำลังเรียน", known: "จำได้", ghost: "ยังไม่มีบัตร" };

function palette() {
  return {
    ink: css("--ink") || "#1F1D1A", bg: css("--bg") || "#F3EEE4", line: css("--line-strong") || "#D9D0BF",
    status: { new: css("--butter") || "#F1D36B", learning: css("--seg-input") || "#3D5A80", known: css("--good") || "#2E7D55", ghost: css("--paper") || "#FFFDF8" },
  };
}

export const statusLabel = (s) => STATUS_LABEL[s] || s;

/**
 * สร้างตัววาดกราฟ: { setGraph(graph), setTypes(types), setStatusFilter(set|null), setTagFilter(set|null), focus(id), select(id), relayout(), fit(), destroy() }
 * opts: { container, persist (จำตำแหน่ง), onSelect(id|null), layoutFilter?(ids) }
 */
export async function createGraphView({ container, persist = true, onSelect, onStatus }) {
  const cytoscape = await loadCytoscape();
  const P = palette();
  let graph = { nodes: [], edges: [] };
  let types = new Set(gr.DEFAULT_ON);
  let statusFilter = null, idFilter = null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cy = cytoscape({
    container, elements: [], minZoom: 0.05, maxZoom: 4, wheelSensitivity: 0.3,
    textureOnViewport: true, hideEdgesOnViewport: true, hideLabelsOnViewport: false, pixelRatio: "auto",
    style: [
      { selector: "node", style: {
        "background-color": (n) => P.status[n.data("status")] || P.status.new, label: "data(label)", "font-family": "Anuphan, system-ui, sans-serif", "font-size": 11,
        color: P.ink, "text-valign": "bottom", "text-margin-y": 3, "min-zoomed-font-size": 9, width: "data(size)", height: "data(size)",
        "border-width": 1, "border-color": P.ink, "border-opacity": 0.35, "text-wrap": "ellipsis", "text-max-width": 90,
        "text-background-color": P.bg, "text-background-opacity": 0.7, "text-background-padding": 1,
      } },
      { selector: "node[?ghost]", style: { "background-opacity": 0.25, "border-style": "dashed", "border-opacity": 0.6, opacity: 0.7 } },
      { selector: "edge", style: { width: 1.2, opacity: 0.55, "line-color": "data(color)", "curve-style": "haystack", "haystack-radius": 0 } },
      { selector: "edge[type = 'ant']", style: { "line-style": "dashed" } },
      { selector: ".dim", style: { opacity: 0.08, "text-opacity": 0 } },
      { selector: "edge.hl", style: { width: 2.4, opacity: 0.95 } },
      { selector: "node.sel", style: { "border-width": 3, "border-color": P.ink, "border-opacity": 1 } },
      { selector: ".off", style: { display: "none" } },
    ],
  });

  container.querySelectorAll("canvas").forEach((c) => c.setAttribute("aria-hidden", "true"));      // เลเยอร์วาดภายใน — ข้อมูลเดียวกันอ่านได้จากช่องค้นหา/แผงรายละเอียดข้างกราฟ
  const say = (t) => onStatus?.(t);

  function sizeFor(deg) { return Math.round(14 + Math.min(30, Math.sqrt(deg) * 7)); }

  function refreshVisibility() {
    cy.batch(() => {
      cy.edges().forEach((e) => e.toggleClass("off", !types.has(e.data("type"))));
      cy.nodes().forEach((n) => {
        const hide = (statusFilter && !statusFilter.has(n.data("status")) && !n.data("ghost")) || (idFilter && !idFilter.has(n.id()));
        n.toggleClass("off", Boolean(hide));
      });
      const deg = gr.degrees(graph, [...types]);
      cy.nodes().forEach((n) => n.data("size", sizeFor(deg.get(n.id()) || 0)));
    });
  }

  let worker = null, layoutSeq = 0;
  const pending = new Map();
  function runLayout(payload) {
    // Web Worker (module) ถ้ามี ไม่งั้นคำนวณบน main thread (ฟังก์ชันเดียวกัน)
    return new Promise((resolve) => {
      const done = (pos) => resolve(pos);
      try {
        worker ||= new Worker(new URL("./layout-worker.js", import.meta.url), { type: "module" });
        worker.onmessage = (e) => { const f = pending.get(e.data.id); pending.delete(e.data.id); if (f) f(e.data.error ? null : e.data.pos); };
        worker.onerror = () => { for (const f of pending.values()) f(null); pending.clear(); worker = null; };
        pending.set(payload.id, done);
        worker.postMessage(payload);
      } catch { resolve(null); }
    }).then((pos) => pos || forceLayout(payload));
  }

  async function layoutNow() {
    const my = ++layoutSeq;
    const nodes = cy.nodes();
    const index = new Map(nodes.map((n, i) => [n.id(), i]));
    const edges = [];
    cy.edges().forEach((e) => { if (gr.STRUCTURAL.includes(e.data("type"))) edges.push(index.get(e.source().id()), index.get(e.target().id())); });
    say("กำลังจัดวางกราฟ…");
    const pos = await runLayout({ id: my, n: nodes.length, edges, iterations: nodes.length > 600 ? 250 : 400, seed: 1 });
    if (my !== layoutSeq || cy.destroyed()) return;
    cy.batch(() => nodes.forEach((n, i) => n.position({ x: pos[2 * i], y: pos[2 * i + 1] })));
    if (persist) {
      const saved = loadPositions();
      nodes.forEach((x) => { if (!x.data("ghost")) { const p = x.position(); saved[x.id()] = [Math.round(p.x), Math.round(p.y)]; } });
      savePositions(saved);
    }
    say("");
  }

  function place(positions) {
    // ใช้ตำแหน่งที่จำไว้; โหนดใหม่วางใกล้เพื่อนบ้านที่มีตำแหน่ง
    let missing = 0;
    cy.nodes().forEach((n) => { const p = positions[n.id()]; if (p && !n.data("ghost")) n.position({ x: p[0], y: p[1] }); else if (!n.data("ghost")) missing++; });
    const real = cy.nodes().filter((n) => !n.data("ghost")).length || 1;
    if (missing / real > LAYOUT_ALL_RATIO) return false;
    cy.nodes().forEach((n) => {
      if (positions[n.id()] && !n.data("ghost")) return;
      const nb = n.neighborhood("node").filter((m) => positions[m.id()] || m.scratch("placed"))[0];
      const base = nb ? nb.position() : { x: 0, y: 0 };
      n.position({ x: base.x + (Math.random() - 0.5) * 80, y: base.y + (Math.random() - 0.5) * 80 });
      n.scratch("placed", true);
    });
    return true;
  }

  async function setGraph(g, { keepView = false } = {}) {
    graph = g;
    const deg = gr.degrees(g, [...types]);
    cy.batch(() => {
      cy.elements().remove();
      cy.add([
        ...g.nodes.map((n) => ({ group: "nodes", data: { id: n.id, label: n.label, th: n.th, status: n.status, ghost: n.ghost, size: sizeFor(deg.get(n.id) || 0) } })),
        ...g.edges.map((e) => ({ group: "edges", data: { id: e.id, source: e.source, target: e.target, type: e.type, color: gr.EDGE_TYPES[e.type].color } })),
      ]);
    });
    const saved = persist ? loadPositions() : {};
    refreshVisibility();
    if (!persist || !place(saved)) await layoutNow();
    if (!keepView) cy.fit(undefined, 30);
  }

  let selected = null;
  function select(id) {
    cy.batch(() => {
      cy.elements().removeClass("dim hl sel");
      selected = id && cy.getElementById(id).nonempty() ? id : null;
      if (selected) {
        const n = cy.getElementById(selected);
        const open = n.connectedEdges().filter((e) => !e.hasClass("off"));
        const keep = n.union(open).union(open.connectedNodes());
        cy.elements().not(keep).addClass("dim");
        open.addClass("hl"); n.addClass("sel");
      }
    });
    onSelect?.(selected);
  }

  cy.on("tap", "node", (e) => select(e.target.id()));
  cy.on("tap", (e) => { if (e.target === cy) select(null); });
  cy.on("dragfree", "node", (e) => {
    if (!persist || e.target.data("ghost")) return;
    const pos = loadPositions(); const p = e.target.position(); pos[e.target.id()] = [Math.round(p.x), Math.round(p.y)]; savePositions(pos);
  });

  return {
    cy,
    setGraph,
    setTypes(t) { types = new Set(t); refreshVisibility(); if (selected) select(selected); },
    setStatusFilter(s) { statusFilter = s && s.size ? s : null; refreshVisibility(); },
    setIdFilter(ids) { idFilter = ids; refreshVisibility(); },
    select,
    focus(id) {
      const n = cy.getElementById(id);
      if (!n.nonempty()) return;
      select(id);
      const opts = { center: { eles: n }, zoom: Math.max(cy.zoom(), 1.2) };
      if (reduced || cy.nodes().length > 400) cy.viewport({ zoom: opts.zoom, pan: { x: cy.width() / 2 - n.position().x * opts.zoom, y: cy.height() / 2 - n.position().y * opts.zoom } });
      else cy.animate(opts, { duration: 250 });
    },
    async relayout() { await layoutNow(); cy.fit(undefined, 30); },
    fit() { cy.fit(undefined, 30); },
    resize() { cy.resize(); },
    visibleCount() { return { nodes: cy.nodes().not(".off").length, edges: cy.edges().not(".off").length }; },
    destroy() { layoutSeq++; worker?.terminate(); worker = null; cy.destroy(); },
  };
}
