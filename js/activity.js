// นาฬิกาเวลาใช้งานจริงของหน้าฝึก (เขียน / Shadowing / Journal / เช็ก i+1) — pure, ส่งเวลาเข้ามาเอง
// นับเฉพาะช่วงที่ "มีการโต้ตอบภายใน idleMs ล่าสุด" (ค่าเริ่มต้น 60 วินาที) ต่อการโต้ตอบหนึ่งครั้งนับได้ไม่เกิน idleMs
// ผู้เรียกเรียก touch() เมื่อมีการโต้ตอบ และ flush() ตอนซ่อนหน้า/ออกจากหน้า/ทุก 5 นาที แล้วบันทึกเป็น session

export const IDLE_MS = 60000;
export const FLUSH_EVERY_MS = 5 * 60000;

export class ActivityClock {
  constructor(idleMs = IDLE_MS) {
    this.idleMs = idleMs;
    this.reset();
  }

  reset() {
    this.start = null;      // เวลาที่เริ่มนับรอบนี้
    this.last = null;       // การโต้ตอบล่าสุด
    this.activeMs = 0;
  }

  touch(t) {
    if (this.last == null) { this.start = t; this.last = t; return; }
    this.activeMs += Math.min(Math.max(0, t - this.last), this.idleMs);
    this.last = t;
  }

  /** วินาทีที่ใช้งานจริงจนถึงตอนนี้ (ไม่ปิดรอบ) — ใช้แสดง/บันทึกใน log โดยไม่ทำให้ session ซ้ำ */
  elapsed(t) {
    if (this.last == null) return 0;
    return (this.activeMs + Math.min(Math.max(0, t - this.last), this.idleMs)) / 1000;
  }

  /** ปิดรอบปัจจุบัน → { start, end, durationSec } หรือ null ถ้าไม่ถึง 1 วินาที; แล้วเริ่มนับใหม่ */
  flush(t) {
    if (this.last == null) return null;
    const total = this.activeMs + Math.min(Math.max(0, t - this.last), this.idleMs);
    const out = { start: this.start, end: this.start + Math.max(total, 0), durationSec: Math.round(total / 1000) };
    this.reset();
    return out.durationSec >= 1 ? out : null;
  }
}

/** session ที่พร้อมบันทึก (skill: input | shadowing | writing | journal) */
export const toSession = (slice, skill, stage) => (slice ? { start: slice.start, end: slice.end, durationSec: slice.durationSec, skill, stage } : null);
