// ค้นคำในคลังกลางจากรูปที่พบในข้อความ (เช่น running → run) และพาไปหน้าคำ — คำนอกคลังเพิ่มไม่ได้
import { vocab, wordKey } from "./vocab.js";
import { stems } from "./reading.js";

/** หาคำในคลังจากคำที่พบ: ตรงตัวก่อน แล้วลองรูปพื้นฐาน (ตัด s/es/ed/ing/ly ฯลฯ) — คืน entry หรือ null (peek ฉีดเข้ามาได้เพื่อทดสอบ) */
export function findInLibrary(word, peek = (k) => vocab.peek(k)) {
  const k = wordKey(word);
  if (!k) return null;
  const exact = peek(k);
  if (exact) return exact;
  for (const s of stems(k)) {
    if (s === k) continue;
    const w = peek(s);
    if (w) return w;
  }
  return null;
}

/** เปิดหน้าคำในคลังของคำที่เลือก — ถ้าไม่อยู่ในคลังจะแจ้งแทนการเปลี่ยนหน้า; คืน true เมื่อเปิดได้ */
export function gotoLibraryWord(word, toast) {
  const w = findInLibrary(word);
  if (!w) { toast?.(`“${String(word).trim()}” ไม่อยู่ในคลังกลาง (เพิ่มคำนอกคลังไม่ได้)`); return false; }
  location.hash = `#/word/${encodeURIComponent(w.wordKey)}`;
  return true;
}
