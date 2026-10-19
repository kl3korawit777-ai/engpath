// กราฟเชื่อมโยงคำ: สร้างโหนด/เส้นจากข้อมูลที่มีอยู่ (pure ไม่แตะ DB/DOM/Cytoscape)
// เส้นที่เก็บใน Firestore มีแค่ลิงก์ [[ ]] (links) และตระกูลคำที่ยืนยัน (wordFamilies) — ที่เหลือคำนวณในเครื่อง
import { wordKey } from "./lexicon.js";
import { tokenize } from "./reading.js";
import { cardTags } from "./library.js";
import { outgoing } from "./links.js";

export const EDGE_TYPES = {
  link: { label: "ลิงก์เอง [[ ]]", color: "#2E5E4E" },
  syn: { label: "คำพ้อง", color: "#3D5A80" },
  ant: { label: "คำตรงข้าม", color: "#B4432F" },
  family: { label: "ตระกูลคำ", color: "#7A4E7E" },
  coll: { label: "คำที่มักมาคู่กัน", color: "#C98A2B" },
  cooc: { label: "อยู่ประโยค/คลิป/Journal เดียวกัน", color: "#6F685D" },
  tag: { label: "แท็กเดียวกัน", color: "#B9AE96" },
};
export const DEFAULT_ON = ["link", "syn", "ant", "family", "coll", "cooc"];     // แท็กปิดไว้เพราะเส้นเยอะ
export const STRUCTURAL = ["link", "syn", "ant", "family", "coll", "cooc"];     // ใช้จัดวาง layout (ไม่รวมแท็ก/คำแนะนำ)

const MAX_PER_SENTENCE = 8;      // ประโยคที่มีคำในคลังเกินนี้ข้าม (กันเส้นระเบิด)
const MAX_GROUP_CLIQUE = 8;      // กลุ่มที่ใหญ่กว่านี้เชื่อมแบบลูกโซ่แทนเชื่อมทุกคู่
export const MAX_GHOSTS = 150;

// ---------- ตระกูลคำ (กฎตัด suffix ง่าย ๆ — เป็นแค่ "คำแนะนำ" ผู้ใช้ต้องยืนยัน) ----------
const SUFFIXES = ["ational", "ization", "isation", "ations", "ation", "itions", "ition", "ments", "ment", "ness", "ities", "ity", "ives", "ive", "ions", "ion", "ings", "ing", "ers", "er", "ed", "es", "ful", "less", "able", "ible", "ly", "al", "s", "e", "y"];

/** รากคำแบบหยาบ: decide/decision/decisive → "decis"; null ถ้าสั้นเกิน/ไม่ใช่คำเดี่ยว */
export function stem(word) {
  const w = String(word).toLowerCase();
  if (!/^[a-z]+$/.test(w) || w.length < 5) return null;
  let s = w;
  for (const suf of SUFFIXES) {
    if (s.length - suf.length >= 4 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  if (s.length >= 5) s = s.replace(/[dtc]$/, "s");     // decid ≈ decis
  s = s.replace(/(.)\1$/, "$1");                        // permiss → permis
  return s.length >= 4 ? s : null;
}

export const familyId = (members) => [...members].sort().join("|");

/**
 * กลุ่มที่ควรเป็นตระกูลเดียวกัน (≥ 2 คำที่ stem เท่ากัน) ยกเว้นกลุ่มที่ผู้ใช้เคยตัดสินแล้ว (ยืนยัน/ปฏิเสธ) ตาม familyId
 * decided: Set ของ familyId ที่ตัดสินแล้ว
 */
export function familyCandidates(keys, decided = new Set()) {
  const by = new Map();
  for (const k of new Set(keys)) {
    const s = stem(k);
    if (s) (by.get(s) || by.set(s, []).get(s)).push(k);
  }
  return [...by.values()].filter((m) => m.length >= 2).map((m) => m.sort()).filter((m) => !decided.has(familyId(m)))
    .sort((a, b) => a[0].localeCompare(b[0]));
}

// ---------- สร้างกราฟ ----------
const pairId = (type, a, b) => (a < b ? `${type}|${a}|${b}` : `${type}|${b}|${a}`);

function connect(add, type, members) {
  const m = [...new Set(members)].sort();
  if (m.length < 2) return;
  if (m.length <= MAX_GROUP_CLIQUE) { for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) add(type, m[i], m[j]); }
  else for (let i = 0; i + 1 < m.length; i++) add(type, m[i], m[i + 1]);
}

/**
 * cards: [{ id, en, th, tags, example }] · links: เอกสาร links · lexicon: Map wordKey → เอกสาร lexicon (เท่าที่โหลดแล้ว)
 * families: เอกสาร wordFamilies · texts: [string] ข้อความที่จะหาคำที่อยู่ประโยคเดียวกัน (ตัวอย่างบัตร, บทคลิป, Journal)
 * statusOf(key) → "new" | "learning" | "known" · ghosts: เปิดโหมดแสดงคำแนะนำ
 * คืน { nodes:[{id,label,th,status,ghost,cardId}], edges:[{id,source,target,type}], stats:{lexiconLoaded, skippedSentences} }
 */
export function buildGraph({ cards, links = [], lexicon = new Map(), families = [], texts = [], statusOf = () => "new", ghosts = false }) {
  const nodes = new Map();
  for (const c of cards) {
    if (c.deleted) continue;
    const id = wordKey(c.en);
    if (id && !nodes.has(id)) nodes.set(id, { id, label: c.en, th: c.th || "", status: statusOf(id), ghost: false, cardId: c.id, tags: cardTags(c) });
  }
  const edges = new Map();
  const add = (type, a, b) => { if (a !== b && nodes.has(a) && nodes.has(b)) edges.set(pairId(type, a, b), { id: pairId(type, a, b), source: a < b ? a : b, target: a < b ? b : a, type }); };

  // ลิงก์เอง (ทิศทางไม่สำคัญในกราฟ) — ปลายทางที่ไม่ใช่โหนดข้าม
  for (const d of links) if (!d.deleted) for (const to of outgoing(d)) add("link", d.from, to);

  // ตระกูลคำที่ผู้ใช้ยืนยัน
  for (const f of families) if (!f.deleted && f.confirmed) connect(add, "family", (f.members || []).map(wordKey));

  // related จาก lexicon: syn/ant/(trg+jjb = คำที่มักมาคู่กัน)
  const REL = [["syn", "syn"], ["ant", "ant"], ["trg", "coll"], ["jjb", "coll"]];
  const ghostCount = new Map();
  let loaded = 0;
  for (const [key, lex] of lexicon) {
    if (!nodes.has(key) || !lex?.related) continue;
    loaded++;
    for (const [field, type] of REL) {
      for (const w of lex.related[field] || []) {
        const t = wordKey(w);
        if (!t || t === key) continue;
        if (nodes.has(t)) add(type, key, t);
        else if (ghosts) { const g = ghostCount.get(t) || { n: 0, links: [] }; g.n++; g.links.push([type, key]); ghostCount.set(t, g); }
      }
    }
  }

  // อยู่ประโยคเดียวกัน
  const single = new Set(), multi = [];
  for (const k of nodes.keys()) { if (k.includes(" ")) multi.push(k); else single.add(k); }
  let skipped = 0;
  for (const text of texts) {
    const norm = tokenize(text).map((t) => t.key).join(" ");
    if (!norm) continue;
    const padded = ` ${norm} `;
    const found = new Set(norm.split(" ").filter((t) => single.has(t)));
    for (const m of multi) if (padded.includes(` ${m} `)) found.add(m);
    if (found.size > MAX_PER_SENTENCE) { skipped++; continue; }
    connect(add, "cooc", [...found]);
  }

  // แท็กเดียวกัน
  const byTag = new Map();
  for (const n of nodes.values()) for (const t of n.tags) (byTag.get(t) || byTag.set(t, []).get(t)).push(n.id);
  for (const members of byTag.values()) connect(add, "tag", members);

  // โหนดคำแนะนำ (ยังไม่มีบัตร): เลือกที่ถูกอ้างถึงมากสุด
  if (ghosts) {
    const top = [...ghostCount].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, MAX_GHOSTS);
    for (const [key, g] of top) {
      nodes.set(key, { id: key, label: key, th: "", status: "ghost", ghost: true, cardId: null, tags: [] });
      for (const [type, from] of g.links) add(type, from, key);
    }
  }
  for (const n of nodes.values()) delete n.tags;
  return { nodes: [...nodes.values()], edges: [...edges.values()], stats: { lexiconLoaded: loaded, skippedSentences: skipped } };
}

// ---------- ค้นหาในกราฟ ----------
/** เพื่อนบ้านภายใน depth ชั้น ผ่านเฉพาะเส้นชนิดที่เปิด; คืน { ids:Set, dist:Map } */
export function neighborhood(graph, start, depth, types) {
  const on = new Set(types);
  const adj = new Map();
  for (const e of graph.edges) {
    if (!on.has(e.type)) continue;
    (adj.get(e.source) || adj.set(e.source, []).get(e.source)).push(e.target);
    (adj.get(e.target) || adj.set(e.target, []).get(e.target)).push(e.source);
  }
  const dist = new Map([[start, 0]]);
  let frontier = [start];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const k of frontier) for (const n of adj.get(k) || []) if (!dist.has(n)) { dist.set(n, d); next.push(n); }
    frontier = next;
  }
  return { ids: new Set(dist.keys()), dist };
}

/** จำนวนเส้นต่อโหนด (เฉพาะชนิดที่เปิด) */
export function degrees(graph, types) {
  const on = new Set(types), deg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) if (on.has(e.type)) { deg.set(e.source, deg.get(e.source) + 1); deg.set(e.target, deg.get(e.target) + 1); }
  return deg;
}

/** กลุ่มสำหรับ "ทบทวนกลุ่มนี้": โหนดนี้ + เพื่อนบ้านชั้นเดียว เฉพาะที่มีบัตร (ไม่รวมคำแนะนำ) */
export function reviewGroup(graph, start, types) {
  const { ids } = neighborhood(graph, start, 1, types);
  const real = new Map(graph.nodes.filter((n) => !n.ghost).map((n) => [n.id, n]));
  return [...ids].map((k) => real.get(k)).filter(Boolean);
}

/** ค้นหาโหนดจากข้อความ: ตรงเป๊ะก่อน ขึ้นต้นด้วย แล้วมีอยู่ในคำ/คำแปล (จำกัดจำนวน) */
export function findNodes(graph, query, limit = 8) {
  const q = wordKey(query);
  if (!q) return [];
  const rank = (n) => (n.id === q ? 0 : n.id.startsWith(q) ? 1 : n.id.includes(q) ? 2 : n.th.toLowerCase().includes(q) ? 3 : 9);
  return graph.nodes.map((n) => [rank(n), n]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0] || a[1].id.localeCompare(b[1].id)).slice(0, limit).map(([, n]) => n);
}

// ---------- ตรวจรูปแบบเอกสาร (ใช้กับ Import) ----------
export function isValidFamily(d) {
  return d && Array.isArray(d.members) && d.members.length >= 2 && d.members.length <= 30 && d.members.every((m) => typeof m === "string" && m === wordKey(m) && m)
    && typeof d.confirmed === "boolean";
}
