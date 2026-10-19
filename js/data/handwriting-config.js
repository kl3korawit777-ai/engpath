// เกณฑ์และค่าคงที่ของ Handwriting ทั้งหมดอยู่ที่นี่ (ปรับได้โดยไม่แตะตรรกะ)

export const HW = {
  // ฟอนต์ (Google Fonts) — โหลดด้วย document.fonts.load ก่อนวาด และ service worker cache ไว้ใช้ออฟไลน์
  fonts: {
    print: { family: "Andika", css: '"Andika", "Comic Sans MS", sans-serif', label: "Print" },
    cursive: { family: "Playwrite US Trad", css: '"Playwrite US Trad", "Snell Roundhand", cursive', label: "Cursive" },
  },

  // กรอบเขียน (หน่วย em ของฟอนต์) — เส้นที่เขียนเก็บเป็นพิกัด 0–1 ของกรอบนี้ จึงวาดใหม่ตรงรอยเมื่อหมุนจอ/เปลี่ยนขนาด
  box: { padX: 0.45, padY: 0.3, minWidthEm: 3 },

  // การให้คะแนน (Trace / Fade)
  score: {
    coverageWeight: 0.55,        // คะแนน = 0.55·coverage + 0.45·accuracy
    accuracyWeight: 0.45,
    letterRedBelow: 0.6,         // ตัวอักษรที่ coverage < 60% แสดงเป็นสีแดง
    levelUpAt: 80,               // Trace/Fade ได้ ≥ 80 → ขึ้นหนึ่งระดับ
    maskPxPerEm: 56,             // ความละเอียดของ offscreen mask (px ต่อ 1 em) — ลดความละเอียดเพื่อให้เร็ว
    inkRadiusEm: 0.07,           // ขยายเส้นหมึกก่อนวัด coverage (ยอมให้เขียนเบี่ยงเล็กน้อย)
    bandRadiusEm: 0.16,          // แถบรอบตัวอักษรที่นับว่า "อยู่ในรอย" สำหรับ accuracy
    inkStrokeEm: 0.06,           // ความหนาเส้นหมึกใน mask
    guideAlphaMin: 64,           // พิกเซลของรอยที่นับ (alpha ≥ ค่านี้)
  },

  // การเลื่อนระดับตามการให้คะแนนตัวเอง (Copy / Recall): 0 = ยังไม่ได้, 1 = เขียนได้, 2 = ง่ายมาก
  selfRatingDelta: { 0: -1, 1: 0, 2: 1 },

  // ปากกา
  ink: {
    color: "#1F1D1A",
    baseWidthEm: 0.055,          // ความกว้างเส้นที่ pressure = 0.5 และความหนา x1
    pressureMin: 0.45,           // ตัวคูณความกว้างที่แรงกดต่ำสุด
    pressureMax: 1.5,            // ตัวคูณความกว้างที่แรงกดสูงสุด
    thickness: { min: 0.5, max: 2.5, step: 0.1, default: 1 },
    eraserRadiusEm: 0.18,
    mousePressure: 0.5,          // เมาส์/นิ้วไม่มี pressure จริง ใช้ค่านี้
  },

  // รูปลายมือย่อที่ซิงก์ขึ้น Firestore
  image: { width: 260, quality: 0.6, maxBytes: 25000, minQuality: 0.3, qualityStep: 0.1 },

  maxPhraseLength: 30,           // วลีที่ยาวกว่านี้ไม่เสนอให้คัดลายมือ
};
