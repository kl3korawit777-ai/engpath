// ตรรกะคลังคำศัพท์แบบ pure: แท็กซ้อนชั้น, ระดับ, สถานะการจำ, ตัวกรอง (ใช้ซ้ำกับ Smart folder)
import { LEVEL_THRESHOLDS, KNOWN_INTERVAL_DAYS } from "./data/lexicon-config.js";
import { isDue, DAY } from "./srs.js";

// ---------- แท็ก ----------
/** ตัวพิมพ์เล็ก, ช่องว่างซ้อนเหลือช่องเดียว, ตัดช่องว่างรอบ "/", ตัด segment ว่าง */
export function normalizeTag(t) {
  return String(t ?? "").toLowerCase().replace(/\s+/g, " ").split("/").map((s) => s.trim()).filter(Boolean).join("/");
}

export function cardTags(card) {
  return [...new Set((card.tags || []).map(normalizeTag).filter(Boolean))];
}

/** การ์ดมีแท็ก path นี้ หรือแท็กลูกของ path นี้ (science ตรงกับ science/biology แต่ไม่ตรงกับ science-fiction) */
export function tagMatches(card, path) {
  const p = normalizeTag(path);
  return !!p && cardTags(card).some((t) => t === p || t.startsWith(`${p}/`));
}

/** ต้นไม้แท็ก: [{ name, path, count, children }] — count = จำนวนการ์ดไม่ซ้ำใน (กิ่งนี้ + ลูกทั้งหมด) */
export function buildTagTree(cards) {
  const root = { children: new Map() };
  for (const c of cards) {
    for (const tag of cardTags(c)) {
      let node = root, path = "";
      for (const seg of tag.split("/")) {
        path = path ? `${path}/${seg}` : seg;
        if (!node.children.has(seg)) node.children.set(seg, { name: seg, path, ids: new Set(), children: new Map() });
        node = node.children.get(seg);
        node.ids.add(c.id);
      }
    }
  }
  const out = (m) => [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => ({ name: n.name, path: n.path, count: n.ids.size, children: out(n.children) }));
  return out(root.children);
}

/**
 * เปลี่ยนชื่อ/ย้ายแท็กทั้งกิ่ง: from → to (ลูกทั้งหมดย้ายตาม) คืน [{ id, tags }] เฉพาะการ์ดที่เปลี่ยน
 * ถ้า to มีอยู่แล้วจะรวมกัน (ลบแท็กซ้ำ) · ไม่ทำกับแท็กที่แค่ขึ้นต้นเหมือนกัน (science ≠ science-fiction)
 */
export function renameTag(cards, from, to) {
  const f = normalizeTag(from), t = normalizeTag(to);
  if (!f || !t) throw new Error("ชื่อแท็กต้องไม่ว่าง");
  if (f === t) return [];
  if (t.startsWith(`${f}/`)) throw new Error("ย้ายแท็กเข้าไปอยู่ในกิ่งของตัวเองไม่ได้");
  const patches = [];
  for (const c of cards) {
    let changed = false;
    const next = (c.tags || []).map((raw) => {
      const n = normalizeTag(raw);
      if (n === f || n.startsWith(`${f}/`)) { changed = true; return `${t}${n.slice(f.length)}`; }
      return raw;
    });
    if (!changed) continue;
    const seen = new Set();
    patches.push({ id: c.id, tags: next.filter((x) => { const k = normalizeTag(x); if (!k || seen.has(k)) return false; seen.add(k); return true; }) });
  }
  return patches;
}

// ---------- ระดับ / สถานะการจำ ----------
/** basic | medium | academic | unknown (freq เป็น null) */
export function levelOf(freq, th = LEVEL_THRESHOLDS) {
  if (freq == null || Number.isNaN(Number(freq))) return "unknown";
  return freq >= th.basic ? "basic" : freq >= th.medium ? "medium" : "academic";
}

/** new | learning | known (interval ≥ KNOWN_INTERVAL_DAYS) */
export function memoryStatus(state) {
  if (!state || state.isNew) return "new";
  return state.interval >= KNOWN_INTERVAL_DAYS ? "known" : "learning";
}

/** จำนวนครั้งที่ตอบ "ลืม" (rating 0) ต่อการ์ด */
export function wrongCounts(reviews) {
  const m = new Map();
  for (const r of reviews) if (r.rating === 0) m.set(r.cardId, (m.get(r.cardId) || 0) + 1);
  return m;
}

// ---------- ตัวกรอง ----------
/**
 * criteria (ทุกฟิลด์ไม่บังคับ; หลายฟิลด์รวมกันแบบ AND):
 *   q            ข้อความค้นหา (en/th/example/แท็ก)
 *   tags[]       ต้องตรงทุกแท็กที่ระบุ (AND) — แต่ละแท็กรวมแท็กลูก
 *   pos[]        ชนิดคำ (OR ภายในฟิลด์; "" = ไม่ระบุ)
 *   levels[]     basic|medium|academic|unknown (OR)
 *   sources[]    แหล่งที่มา (OR; ค่าว่างถือเป็น manual)
 *   memory[]     new|learning|known (OR)
 *   wrongMin     ตอบ "ลืม" ≥ n ครั้ง
 *   addedWithinDays  เพิ่มภายใน n วัน
 *   dueOnly      เฉพาะที่ถึงรอบทบทวน
 * ctx: { states: Map(cardId → srs state), wrong: Map(cardId → n), now }
 */
export function filterCards(cards, criteria, ctx) {
  const c = criteria || {};
  const q = (c.q || "").toLowerCase().replace(/\s+/g, " ").trim();
  return cards.filter((card) => {
    const state = ctx.states.get(card.id);
    if (q && ![card.en, card.th, card.example, ...(card.tags || [])].join(" ").toLowerCase().includes(q)) return false;
    if (c.tags?.length && !c.tags.every((t) => tagMatches(card, t))) return false;
    if (c.pos?.length && !c.pos.includes(card.pos || "")) return false;
    if (c.levels?.length && !c.levels.includes(levelOf(card.freq))) return false;
    if (c.sources?.length && !c.sources.includes(card.source || "manual")) return false;
    if (c.memory?.length && !c.memory.includes(memoryStatus(state))) return false;
    if (c.wrongMin != null && (ctx.wrong.get(card.id) || 0) < c.wrongMin) return false;
    if (c.addedWithinDays != null && !(card.createdAt >= ctx.now - c.addedWithinDays * DAY)) return false;
    if (c.dueOnly && !(state && isDue(state, ctx.now))) return false;
    return true;
  });
}

/** มีเงื่อนไขที่ใช้อยู่หรือไม่ (ไว้ขึ้นปุ่มล้างตัวกรอง) */
export function hasCriteria(c) {
  return Boolean(c && (c.q?.trim() || c.tags?.length || c.pos?.length || c.levels?.length || c.sources?.length || c.memory?.length
    || c.wrongMin != null || c.addedWithinDays != null || c.dueOnly));
}

// ---------- Smart folder ----------
export const CONDITION_KEYS = ["tags", "pos", "levels", "sources", "memory", "wrongMin", "addedWithinDays", "dueOnly"];

const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const posNum = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" && Number(v) >= 0 ? Math.floor(Number(v)) : undefined);

/** เก็บเฉพาะเงื่อนไขที่รู้จักและค่าถูกต้อง (ไม่รวม q) — ใช้ก่อนบันทึกและหลังอ่านจากไฟล์นำเข้า */
export function sanitizeConditions(c) {
  const out = {};
  for (const k of ["tags", "pos", "levels", "sources", "memory"]) {
    const a = strArr(c?.[k]);
    if (a.length) out[k] = k === "tags" ? [...new Set(a.map(normalizeTag).filter(Boolean))] : [...new Set(a)];
  }
  const w = posNum(c?.wrongMin);
  if (w !== undefined && w >= 1) out.wrongMin = w;
  const d = posNum(c?.addedWithinDays);
  if (d !== undefined && d >= 1) out.addedWithinDays = d;
  if (c?.dueOnly === true) out.dueOnly = true;
  return out;
}

/** เปลี่ยนชื่อแท็กในเงื่อนไขของ Smart folder (ตามการเปลี่ยนชื่อ/ย้ายแท็กทั้งกิ่ง) คืน null ถ้าไม่มีอะไรเปลี่ยน */
export function renameTagInConditions(conditions, from, to) {
  const f = normalizeTag(from), t = normalizeTag(to);
  if (!f || !t || f === t || !conditions?.tags?.length) return null;
  let changed = false;
  const tags = conditions.tags.map((raw) => {
    const n = normalizeTag(raw);
    if (n === f || n.startsWith(`${f}/`)) { changed = true; return `${t}${n.slice(f.length)}`; }
    return raw;
  });
  return changed ? { ...conditions, tags: [...new Set(tags.map(normalizeTag))] } : null;
}

/** สรุปเงื่อนไขเป็นภาษาไทยสั้น ๆ */
export function describeConditions(c, labels = {}) {
  const L = { level: {}, memory: {}, source: {}, pos: {}, ...labels };
  const parts = [];
  if (c.tags?.length) parts.push(`แท็ก ${c.tags.join(" + ")}`);
  if (c.pos?.length) parts.push(`ชนิดคำ ${c.pos.map((p) => L.pos[p] ?? (p || "ไม่ระบุ")).join("/")}`);
  if (c.levels?.length) parts.push(`ระดับ ${c.levels.map((l) => L.level[l] ?? l).join("/")}`);
  if (c.memory?.length) parts.push(`สถานะ ${c.memory.map((m) => L.memory[m] ?? m).join("/")}`);
  if (c.sources?.length) parts.push(`แหล่งที่มา ${c.sources.map((s) => L.source[s] ?? s).join("/")}`);
  if (c.wrongMin != null) parts.push(`ตอบผิด ≥ ${c.wrongMin} ครั้ง`);
  if (c.addedWithinDays != null) parts.push(`เพิ่มภายใน ${c.addedWithinDays} วัน`);
  if (c.dueOnly) parts.push("ถึงรอบทบทวน");
  return parts.join(" · ") || "ทุกบัตร";
}

/** ขอบเขตทบทวน { type:"folder", folder } | { type:"tag", path } | null → เงื่อนไขที่ใช้กรอง */
export function scopeCriteria(scope) {
  if (!scope) return null;
  if (scope.type === "tag") return { tags: [scope.path] };
  if (scope.type === "folder") return sanitizeConditions(scope.folder?.conditions);
  return null;
}
