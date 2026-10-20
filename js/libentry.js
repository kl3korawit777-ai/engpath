// แปลงคำในคลังกลาง (vocab entry) เป็นรูป “lexicon doc” ที่กราฟและ Export Obsidian ใช้ — pure ไม่แตะ DB/DOM
// ข้อมูลทั้งหมดอ่านจากคลังที่โหลดไว้ในเครื่อง (ไม่เรียก API/Firestore)

/** { word, ipa, meanings:[{pos, definitions:[{en}]}], th:[{sense, text}], examples:[string], related:{syn,ant,trg,jjb} } */
export function lexiconFromEntry(w) {
  if (!w) return null;
  const byPos = new Map();
  for (const d of w.defEn || []) {
    if (!d?.def) continue;
    if (!byPos.has(d.pos)) byPos.set(d.pos, []);
    byPos.get(d.pos).push({ en: d.def });
  }
  return {
    word: w.word,
    ipa: w.ipa || "",
    vocabLevel: w.level,
    cefr: w.cefr || "",
    meanings: [...byPos].map(([pos, definitions]) => ({ pos, definitions })),
    th: (w.th || []).map((t) => ({ sense: t.pos || "", text: t.text })),
    examples: (w.examples || []).map((e) => e.text),
    related: { syn: [...(w.synonyms || [])], ant: [...(w.antonyms || [])], trg: [], jjb: [] },
  };
}

/** ตระกูลคำจากคลัง ในรูปเอกสาร wordFamilies ที่ยืนยันแล้ว (ใช้สร้างเส้น family — ไม่เขียนลง Firestore) */
export function familiesFromEntries(entries) {
  const seen = new Set(), out = [];
  for (const w of entries) {
    if (!w?.family?.length) continue;
    const members = [...new Set([w.wordKey, ...w.family])].sort();
    const id = members.join("|");
    if (members.length < 2 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: `lib:${id}`, members, confirmed: true, deleted: false, fromLibrary: true });
  }
  return out;
}
