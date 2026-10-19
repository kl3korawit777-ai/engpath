// ส่งขอบเขตการทบทวนข้ามหน้า (เช่น กด "ทบทวน" ที่ Smart folder ในคลัง → ไปหน้าบัตรคำ) — ใช้ครั้งเดียวแล้วหาย
let pending = null;
export const setReviewScope = (scope) => { pending = scope; };
export const takeReviewScope = () => { const s = pending; pending = null; return s; };

// แท็บเริ่มต้นของหน้า Error Log ("list" | "practice") เช่น กดจากการ์ดจุดเน้นสัปดาห์ในหน้าวันนี้ — ใช้ครั้งเดียว
let pendingErrorsTab = null;
export const setErrorsTab = (tab) => { pendingErrorsTab = tab; };
export const takeErrorsTab = () => { const t = pendingErrorsTab; pendingErrorsTab = null; return t; };

// ส่งคำ/ประโยคตัวอย่างไปหน้า "เพิ่มคำ" (เช่น ลากคลุมวลีในบท Shadowing → สร้างบัตรคำ) — ใช้ครั้งเดียว
let pendingAddWord = null;
export const setAddWordPrefill = (p) => { pendingAddWord = p; };
export const takeAddWordPrefill = () => { const p = pendingAddWord; pendingAddWord = null; return p; };
