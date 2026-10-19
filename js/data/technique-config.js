// ค่ากำหนดของ Technique Score — ค่าตั้งต้นของแอป (ไม่ได้มาจากไฟล์ Roadmap) ปรับได้ที่นี่
// target = จำนวนต่อ 7 วันที่ถือว่า "ใช้เทคนิคนี้เต็ม" (คะแนน 100%) · challenge = มินิชาเลนจ์วันนี้เมื่อเทคนิคนี้ใช้น้อยที่สุด
export const TECHNIQUE_CONFIG = {
  "01": { unit: "ครั้งทบทวน", source: "จำนวนครั้งที่ให้คะแนนบัตรคำ (reviews)", target: 50, challenge: { goal: 20, text: "ทบทวนบัตรคำให้ครบ 20 ครั้ง" } },
  "02": { unit: "ครั้งที่พิมพ์ตอบ", source: "รีวิวที่พิมพ์คำตอบก่อนเปิดเฉลย", target: 20, challenge: { goal: 10, text: "ทบทวนโหมด “ไทย → อังกฤษ” และพิมพ์คำตอบ 10 ข้อ" } },
  "03": { unit: "ครั้งที่เช็ก i+1", source: "ผลจากตัวเช็ก i+1 (readings)", target: 2, challenge: { goal: 1, text: "วางบทอ่าน 1 บทในตัวเช็ก i+1 แล้วดูว่าคำใหม่กี่ %" } },
  "04": { unit: "บัตรใหม่ (วลี/ประโยค)", source: "บัตรคำที่เพิ่มใหม่ (ทุกใบต้องมีประโยคตัวอย่างอย่างน้อย 4 คำ)", target: 5, challenge: { goal: 2, text: "เพิ่มบัตรคำใหม่ 2 ใบ เป็นวลีหรือคำที่มีประโยคตัวอย่าง" } },
  "05": { unit: "รอบ Shadowing", source: "รอบที่ฝึก Shadowing (shadowingEvents)", target: 5, challenge: { goal: 3, text: "Shadowing คลิปเดิม 3 รอบ" } },
  "06": { unit: "ข้อที่ฝึกเจาะจุด", source: "แบบฝึก Deliberate Practice (practiceEvents)", target: 10, challenge: { goal: 5, text: "ทำแบบฝึกเจาะจุดจาก Error Log 5 ข้อ" } },
  "07": { unit: "ชุดฝึกคละ", source: "ชุดฝึกคละโจทย์ (interleavingSessions)", target: 2, challenge: { goal: 1, text: "ทำชุดฝึกคละโจทย์ 1 ชุด" } },
  "08": { unit: "วันที่เรียน", source: "จำนวนวันที่มีกิจกรรมใน 7 วัน", target: 5, challenge: { goal: 1, text: "ทำกิจกรรมการเรียนอย่างน้อย 1 อย่างวันนี้ เพื่อไม่ให้ streak ขาด" } },
};
