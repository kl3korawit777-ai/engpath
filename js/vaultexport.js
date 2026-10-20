// ส่งออก Obsidian vault เป็น .zip (JSZip โหลดเฉพาะตอนใช้) — ตรรกะสร้างไฟล์อยู่ใน vault.js
import * as db from "./db.js";
import * as srs from "./srs.js";
import * as lib from "./library.js";
import { buildVault } from "./vault.js";
import { collectInput, ensureLexicon } from "./graphui.js";
import { wordKey } from "./lexicon.js";
import { vocab } from "./vocab.js";
import { dayKey } from "./streak.js";

const JSZIP = "../vendor/jszip-3.10.2.min.js";
let zipPromise = null;
async function loadJsZip() {
  zipPromise ||= import(JSZIP).then(() => {
    if (typeof globalThis.JSZip !== "function") throw new Error("โหลด JSZip ไม่สำเร็จ");
    return globalThis.JSZip;
  });
  return zipPromise;
}

/** ตัวเลือกขอบเขต: [{ value, label }] — ทั้งคลัง · แท็ก (รวมแท็กลูก) · Smart folder */
export function scopeOptions() {
  const tags = [], walk = (ns) => ns.forEach((n) => { tags.push(n.path); walk(n.children); });
  walk(lib.buildTagTree(db.list("cards")));
  const levels = [...new Set(db.list("cards").map(levelOfCard).filter(Boolean))].sort((a, b) => a - b);
  return [
    { value: "all", label: "ทั้งคลัง" },
    ...levels.map((n) => ({ value: `level:${n}`, label: `ระดับ ${n} ของคลังกลาง` })),
    ...tags.map((t) => ({ value: `tag:${t}`, label: `แท็ก ${t}` })),
    ...db.list("smartFolders").sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ value: `folder:${f.id}`, label: `Smart folder ${f.name}` })),
  ];
}

/** ระดับของบัตรจากคลังกลาง (บัตรเดิมหาจากคำเดียวกันในคลัง) — 0 ถ้าไม่อยู่ในคลัง */
export const levelOfCard = (c) => c.level ?? vocab.peek(wordKey(c.en))?.level ?? 0;

export function cardsInScope(scope, cards, ctx) {
  if (!scope || scope === "all") return cards;
  if (scope.startsWith("level:")) return cards.filter((c) => levelOfCard(c) === Number(scope.slice(6)));
  if (scope.startsWith("tag:")) return cards.filter((c) => lib.tagMatches(c, scope.slice(4)));
  if (scope.startsWith("folder:")) {
    const f = db.get("smartFolders", scope.slice(7));
    return f && !f.deleted ? lib.filterCards(cards, lib.sanitizeConditions(f.conditions), ctx) : [];
  }
  return cards;
}

/** คืน { blob, filename, stats } — stats.missingLexicon = จำนวนคำที่ไม่มีข้อมูลคลังคำในเครื่อง (ไม่เรียก server) */
export async function exportVault({ scope = "all", includeLexicon = true } = {}) {
  const all = db.list("cards");
  if (!all.length) throw new Error("ยังไม่มีบัตรคำให้ส่งออก");
  const reviews = db.list("reviews");
  const states = srs.stateMap(all, reviews);
  const now = Date.now();
  const chosen = cardsInScope(scope, all, { states, wrong: lib.wrongCounts(reviews), now });
  if (!chosen.length) throw new Error("ไม่มีบัตรคำในขอบเขตที่เลือก");
  if (includeLexicon) await ensureLexicon(chosen.map((c) => wordKey(c.en)));
  const input = collectInput();
  const lexicon = includeLexicon ? input.lexicon : new Map();
  const v = buildVault({ cards: chosen, allCards: all, states, lexicon, links: input.links, families: input.families, texts: input.texts, now });
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  for (const f of v.files) zip.file(f.path, f.content);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { blob, filename: `engpath-vault-${dayKey(now)}.zip`, stats: { ...v.stats, missingLexicon: includeLexicon ? v.stats.words - v.stats.lexiconUsed : 0 } };
}
