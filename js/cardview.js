// บัตรจากคลังกลาง (มี wordKey) เก็บเฉพาะความคืบหน้า — ตอนอ่านเติม en/th/example/ipa/tags จากคลังให้
// หน้าที่อ่าน c.en / c.th เดิมใช้ต่อได้ (คลังเป็น immutable และต้องโหลดก่อน: ดู vocab.loadAll() ใน app.js)
// pure (ไม่แตะ DB/DOM) เพื่อทดสอบด้วย node ได้
import { vocab } from "./vocab.js";

const hydrated = new WeakMap();

export function hydrateCard(c) {
  if (!c?.wordKey) return c;
  const w = vocab.peek(c.wordKey);
  if (w) {
    let h = hydrated.get(c);
    if (!h) {
      h = { ...c, en: w.word, th: w.th.map((t) => t.text).join(" / "), example: w.examples[0]?.text || "", ipa: w.ipa || "", tags: w.tags, pos: w.pos[0] || null };
      hydrated.set(c, h);
    }
    return h;
  }
  return { ...c, en: c.wordKey, th: "", example: "", ipa: "", tags: [] };
}
