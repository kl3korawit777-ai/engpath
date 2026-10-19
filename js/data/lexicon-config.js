// ค่ากำหนดของคลังคำศัพท์ — ปรับได้ที่นี่ (ไม่ต้องย้ายข้อมูล: ระดับคำนวณจาก freq ตอนอ่านเสมอ)

// ความถี่จาก Datamuse (f: ต่อล้านคำ): คำที่ freq ≥ basic = พื้นฐาน, ≥ medium = กลาง, ต่ำกว่านั้น = วิชาการ
export const LEVEL_THRESHOLDS = { basic: 50, medium: 5 };

export const LEVEL_LABELS = { basic: "พื้นฐาน", medium: "กลาง", academic: "วิชาการ", unknown: "ไม่ทราบ" };

// ถือว่า "จำได้" เมื่อ interval ของ SM-2 ≥ ค่านี้ (วัน)
export const KNOWN_INTERVAL_DAYS = 21;

export const MEMORY_LABELS = { new: "ใหม่", learning: "กำลังเรียน", known: "จำได้" };

export const SOURCE_LABELS = { manual: "เพิ่มเอง", errorlog: "Error Log", shadowing: "Shadowing", reading: "ตัวเช็ก i+1" };

export const POS_LABELS = { "": "ไม่ระบุ", noun: "noun", verb: "verb", adjective: "adjective", adverb: "adverb", phrase: "phrase", other: "other" };
