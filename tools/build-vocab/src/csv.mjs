// อ่าน NGSL-GR_rank.csv (WordID,Word) และคำนวณระดับ 1–11 — โครงสร้างตรวจจากไฟล์จริง: UTF-8 มี BOM, CRLF, 2 คอลัมน์, WordID 1…N เรียงต่อเนื่อง
// ห้ามเรียงใหม่: ลำดับในไฟล์ = rank

/** wordKey ของคลัง: ตัวพิมพ์เล็ก NFC ตัดช่องว่างหัวท้าย (ตรงกับ wordKey ของแอปสำหรับคำเดี่ยว) */
export const wordKeyOf = (w) => String(w).normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

export function parseCsvText(text) {
  const src = String(text).replace(/^﻿/, "");
  const lines = src.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("ไฟล์ CSV ว่าง");
  const header = lines[0].split(",").map((h) => h.trim());
  const iId = header.findIndex((h) => /^wordid$/i.test(h)), iWord = header.findIndex((h) => /^word$/i.test(h));
  if (iId < 0 || iWord < 0) throw new Error(`ไม่พบคอลัมน์ WordID/Word ในหัวตาราง: ${JSON.stringify(header)}`);
  const iLevel = header.findIndex((h) => /^level$/i.test(h));
  const rows = lines.slice(1).map((l, n) => {
    const c = l.split(",");
    if (c.length !== header.length) throw new Error(`บรรทัด ${n + 2}: จำนวนคอลัมน์ ${c.length} ไม่ตรงหัวตาราง (${header.length})`);
    return { rank: Number(c[iId]), word: c[iWord].trim(), ...(iLevel >= 0 ? { level: Number(c[iLevel]) } : {}), line: n + 2 };
  });
  return { header, rows, hasLevel: iLevel >= 0 };
}

/**
 * ตรวจและแก้คำ: rank ต้องเป็น 1…N ต่อเนื่อง · ใช้ fixes {rank: {from, to}} แก้ค่าที่สเปรดชีตทำเพี้ยน (ต้องตรงกับค่าเดิมเป๊ะ ไม่งั้น error)
 * คืน { words: [{ rank, word, wordKey, level }], fixed: [...], problems: [...] }
 */
export function buildWords(parsed, { fixes = {}, sizes = [400, 400, 400, 400, 400, 400, 400, 400, 600, 600] } = {}) {
  const problems = [], fixed = [];
  parsed.rows.forEach((r, i) => { if (r.rank !== i + 1) problems.push(`บรรทัด ${r.line}: WordID ${r.rank} ไม่ตรงลำดับที่ ${i + 1}`); });
  const words = parsed.rows.map((r) => {
    let word = r.word;
    const fx = fixes[String(r.rank)];
    if (fx) {
      if (fx.from !== word) problems.push(`WordID ${r.rank}: wordFixes คาดว่าเป็น “${fx.from}” แต่ในไฟล์เป็น “${word}”`);
      else { fixed.push({ rank: r.rank, from: word, to: fx.to, why: fx.why }); word = fx.to; }
    }
    return { rank: r.rank, word, wordKey: wordKeyOf(word), level: r.level ?? levelOfRank(r.rank, sizes) };
  });
  const seen = new Map();
  for (const w of words) {
    if (!w.word) problems.push(`WordID ${w.rank}: คำว่าง`);
    if (seen.has(w.wordKey)) problems.push(`WordID ${w.rank} ซ้ำกับ WordID ${seen.get(w.wordKey)} (“${w.wordKey}”)`);
    else seen.set(w.wordKey, w.rank);
    if (/^(true|false)$/.test(w.word)) continue;                      // ผ่านการแก้แล้ว (ตัวพิมพ์เล็ก)
    if (/^(TRUE|FALSE|NULL|NAN|#\w+!?)$/.test(w.word)) problems.push(`WordID ${w.rank}: “${w.word}” น่าจะเป็นค่าที่สเปรดชีตแปลงให้ — เพิ่มใน wordFixes`);
    if (!/^[\p{L}][\p{L}'’-]*$/u.test(w.word)) problems.push(`WordID ${w.rank}: “${w.word}” มีอักขระที่ไม่ใช่ตัวอักษร`);
  }
  return { words, fixed, problems };
}

/** ระดับจาก rank: sizes = ขนาดของระดับ 1…K; ระดับ K+1 = ที่เหลือทั้งหมด */
export function levelOfRank(rank, sizes) {
  let end = 0;
  for (let i = 0; i < sizes.length; i++) { end += sizes[i]; if (rank <= end) return i + 1; }
  return sizes.length + 1;
}

export function levelRanges(words) {
  const by = new Map();
  for (const w of words) { const r = by.get(w.level) || { level: w.level, from: w.rank, to: w.rank, count: 0 }; r.to = Math.max(r.to, w.rank); r.from = Math.min(r.from, w.rank); r.count++; by.set(w.level, r); }
  return [...by.values()].sort((a, b) => a.level - b.level);
}
