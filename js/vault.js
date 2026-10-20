// สร้างไฟล์ Markdown สำหรับ Obsidian vault (หนึ่งคำต่อหนึ่งไฟล์) — pure ไม่แตะ DB/DOM/JSZip
import { wordKey, thDisplay } from "./lexicon.js";
import { parseLinks } from "./links.js";
import { cardTags, cardLevel, memoryStatus, normalizeTag } from "./library.js";
import { buildGraph, EDGE_TYPES } from "./graph.js";
import { dayKey } from "./streak.js";

export const ROOT = "EngPath";
export const WORDS_DIR = "words";
const NAME_MAX = 100;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const RELATED_ORDER = ["link", "syn", "ant", "family", "coll", "cooc"];       // แท็กอยู่ใน frontmatter/#แท็ก จึงไม่ซ้ำเป็น Related

// ---------- ชื่อไฟล์ ----------
/** ปลอดภัยทุกระบบ (Windows/macOS/Linux/iOS) และไม่ทำให้ลิงก์ Obsidian เพี้ยน: ตัด \ / : * ? " < > | # ^ [ ] และตัวควบคุม */
export function safeName(s) {
  let n = String(s ?? "").normalize("NFC").replace(/[\\/:*?"<>|#^\[\]\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "");
  if (RESERVED.test(n)) n = `${n}_`;
  while (new TextEncoder().encode(n).length > NAME_MAX) n = n.slice(0, -1);
  return n.trim() || "word";
}

/** key → ชื่อไฟล์ (ไม่มี .md) ไม่ซ้ำกันแม้ระบบไฟล์ไม่แยกตัวพิมพ์ */
export function uniqueNames(keys) {
  const used = new Set(), out = new Map();
  for (const key of keys) {
    const base = safeName(key);
    let name = base, i = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${i++})`;
    used.add(name.toLowerCase());
    out.set(key, name);
  }
  return out;
}

// ---------- YAML / แท็ก ----------
export const yamlStr = (s) => JSON.stringify(String(s ?? ""));       // สตริงในเครื่องหมายคำพูดคู่แบบ JSON ใช้เป็น YAML ได้

/** แท็กที่ Obsidian อ่านได้: ไม่มีช่องว่าง ใช้ตัวอักษร/ตัวเลข/_/-// เท่านั้น และต้องมีอักษรอย่างน้อย 1 ตัว; ไม่ได้ → "" */
export function obsidianTag(t) {
  const n = normalizeTag(t).split("/").map((seg) => seg.replace(/\s+/g, "-").replace(/[^\p{L}\p{M}\p{N}_-]/gu, "")).filter(Boolean).join("/");
  if (!n) return "";
  return /^[\p{N}\/]+$/u.test(n) ? `t${n.replaceAll("/", "-")}` : n;
}

function frontmatter(f) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(f)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) { lines.push(v.length ? `${k}:` : `${k}: []`); for (const x of v) lines.push(`  - ${yamlStr(x)}`); }
    else if (typeof v === "number") lines.push(`${k}: ${v}`);
    else if (k === "due" || k === "created") lines.push(`${k}: ${v}`);          // วันที่ YYYY-MM-DD ไม่ใส่เครื่องหมายคำพูด เพื่อให้ Obsidian รู้ว่าเป็นวันที่
    else lines.push(`${k}: ${yamlStr(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

// ---------- ลิงก์ ----------
const linkTo = (names, key, label) => {
  const file = names.get(key);
  if (!file) return `[[${key}]]`;
  return file === key && (!label || label === key) ? `[[${file}]]` : `[[${file}|${label || key}]]`;
};

/** โน้ตของผู้ใช้: คงลิงก์ [[ ]] ไว้ แต่ถ้าข้อความเป้าหมายไม่ตรงชื่อไฟล์จริง (เช่น [[a/b]] ที่ไฟล์ชื่อ "a b", [[etc.]] ที่ไฟล์ชื่อ "etc") ให้ชี้ไฟล์จริงและคงข้อความที่แสดงเดิม */
export function rewriteNoteLinks(text, names) {
  const src = String(text ?? "");
  let out = "", pos = 0;
  for (const l of parseLinks(src)) {
    out += src.slice(pos, l.start);
    const file = names.get(l.key);
    out += file && file.toLowerCase() !== l.target.toLowerCase() ? `[[${file}|${l.alias || l.target}]]` : src.slice(l.start, l.end);
    pos = l.end;
  }
  return out + src.slice(pos);
}

// ---------- เนื้อหา ----------
function wordMarkdown({ node, card, state, lex, notes, related, names, tagList, now }) {
  const status = memoryStatus(state);
  const fm = frontmatter({
    th: card.th, ipa: card.ipa || lex?.ipa || "", pos: card.pos || "", tags: tagList, level: cardLevel(card), vocab_level: card.level ?? lex?.vocabLevel ?? null, cefr: lex?.cefr || "", status,
    interval: state && !state.isNew ? state.interval : null, due: state && !state.isNew ? dayKey(state.due) : null,
    source: card.source || "manual", created: dayKey(card.createdAt || now),
  });
  const out = [fm, "", `# ${card.en}`, ""];
  const head = [`**${card.th}**`, card.ipa || lex?.ipa ? `/${(card.ipa || lex.ipa).replace(/^\/|\/$/g, "")}/` : "", card.pos ? `(${card.pos})` : ""].filter(Boolean).join(" ");
  out.push(head, "");
  if (tagList.length) out.push(tagList.map((t) => `#${t}`).join(" "), "");

  const meanings = (lex?.meanings || []).filter((m) => m.definitions?.length);
  const thSenses = lex?.th?.length ? thDisplay(lex.th) : "";
  if (meanings.length || (thSenses && thSenses !== card.th)) {
    out.push("## ความหมาย", "");
    if (thSenses && thSenses !== card.th) out.push(`- ไทย: ${thSenses}`);
    for (const m of meanings) for (const d of m.definitions) out.push(`- (${m.pos}) ${d.en}`);
    out.push("");
  }
  const examples = [card.example, ...(lex?.examples || []).slice(0, 5)].filter(Boolean);
  if (examples.length) { out.push("## ประโยคตัวอย่าง", ""); for (const e of [...new Set(examples)]) out.push(`- ${e}`); out.push(""); }
  if (notes?.trim()) out.push("## โน้ต", "", rewriteNoteLinks(notes, names).trim(), "");

  const rel = RELATED_ORDER.filter((t) => related.get(t)?.size);
  if (rel.length) {
    out.push("## Related", "");
    for (const t of rel) { out.push(`### ${EDGE_TYPES[t].label}`, ""); for (const k of [...related.get(t)].sort()) out.push(`- ${linkTo(names, k)}`); out.push(""); }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * สร้างไฟล์ทั้งหมดของ vault
 * cards: บัตรที่จะ export · allCards: บัตรทั้งคลัง (ใช้สร้างความสัมพันธ์) · states: Map cardId → สถานะ SRS · lexicon: Map wordKey → doc (เท่าที่มีในเครื่อง)
 * links/families/texts: เหมือน buildGraph
 * คืน { files: [{ path, content }], stats: { words, lexiconUsed, relatedEdges } }
 */
export function buildVault({ cards, allCards = cards, states, lexicon = new Map(), links = [], families = [], texts = [], now = Date.now() }) {
  const live = cards.filter((c) => !c.deleted && wordKey(c.en));
  const keys = [...new Map(live.map((c) => [wordKey(c.en), c])).keys()];
  const byKey = new Map(live.map((c) => [wordKey(c.en), c]));
  const names = uniqueNames(keys.sort());
  const graph = buildGraph({ cards: allCards, links, lexicon, families, texts, statusOf: () => "new" });
  const rel = new Map(keys.map((k) => [k, new Map()]));
  let edges = 0;
  for (const e of graph.edges) {
    if (e.type === "tag") continue;
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      if (!rel.has(a) || !names.has(b)) continue;
      const m = rel.get(a);
      (m.get(e.type) || m.set(e.type, new Set()).get(e.type)).add(b);
    }
    edges++;
  }
  const notesByKey = new Map(links.filter((d) => !d.deleted).map((d) => [d.from, d.notes]));
  const files = [];
  let lexiconUsed = 0;
  for (const key of keys) {
    const card = byKey.get(key);
    const lex = lexicon.get(key) || null;
    if (lex) lexiconUsed++;
    const tagList = [...new Set(cardTags(card).map(obsidianTag).filter(Boolean))];
    files.push({
      path: `${ROOT}/${WORDS_DIR}/${names.get(key)}.md`,
      content: wordMarkdown({ node: key, card, state: states.get(card.id), lex, notes: notesByKey.get(key), related: rel.get(key), names, tagList, now }),
    });
  }
  files.push({ path: `${ROOT}/README.md`, content: readme(keys.length, now) });
  return { files, stats: { words: keys.length, lexiconUsed, relatedEdges: edges } };
}

function readme(n, now) {
  return [
    "# EngPath vault", "",
    `ส่งออกเมื่อ ${dayKey(now)} · ${n} คำ`, "",
    "เปิดใน Obsidian: เลือก **Open folder as vault** แล้วชี้ไปที่โฟลเดอร์นี้ (โฟลเดอร์ `EngPath`)", "",
    "- หนึ่งคำต่อหนึ่งไฟล์ในโฟลเดอร์ `words/`",
    "- ลิงก์ `[[ ]]` จากโน้ตของคุณคงไว้ และมีส่วน **Related** แยกตามชนิดความสัมพันธ์",
    "- แท็กอยู่ใน frontmatter (`tags`) และเป็น `#แท็ก` ในเนื้อหา — เปิด Graph view ได้ทันที",
    "- ไฟล์นี้เป็นสำเนา ณ เวลาที่ส่งออก แก้ใน Obsidian ไม่ย้อนกลับมาที่แอป", "",
  ].join("\n");
}
