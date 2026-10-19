# EngPath — เว็บแอปเรียนภาษาอังกฤษตาม Roadmap A1 → C1

## ภาพรวม
แอปที่เป็น "โค้ชเดินตาม Roadmap": บอกว่าวันนี้ต้องทำอะไร เก็บทุกอย่างที่ฝึก
และวัดผลทุก 4–6 สัปดาห์เพื่อปลดล็อกขั้นถัดไป ใช้บนคอม, iPad, มือถือ และซิงก์ข้อมูลข้ามเครื่องอัตโนมัติ

## เทคโนโลยี (ห้ามเปลี่ยนโดยไม่ถามก่อน)
- Vanilla HTML/CSS/JS แบบ ES modules ไม่มี build step รันบน GitHub Pages ได้ทันที
- PWA: manifest.json + service worker (cache app shell, versioned cache) ใช้ออฟไลน์ได้
- Firebase JS SDK v10+ แบบ modular โหลดจาก https://www.gstatic.com/firebasejs/
  - Auth: Google sign-in
  - Firestore + persistentLocalCache (multi-tab) เป็นทั้งที่เก็บข้อมูลในเครื่องและตัวซิงก์
- ห้ามใช้ framework หรือไลบรารีเพิ่ม ยกเว้นได้รับอนุญาต

## โครงสร้างข้อมูล (ต้องรองรับการซิงก์ตั้งแต่แรก)
ทุกข้อมูลอยู่ใต้ users/{uid}/...
- ทุก document มี: id (สร้างฝั่ง client), createdAt, updatedAt, deleted (soft delete)
- ข้อมูลที่เป็น "เหตุการณ์" เก็บแบบต่อท้ายอย่างเดียว ห้ามแก้ไข: reviews, sessions, errorEvents
- ตัวเลขสรุป (streak, จำนวนครั้งที่ผิด, นาทีรวม) ให้คำนวณจาก events เสมอ ห้ามเก็บเป็นตัวนับที่แก้ทับ
- ห้ามซิงก์: API key ใด ๆ, เสียงอัด

## ดีไซน์ (ยึดตามนี้ทุกหน้า)
โทนครีม ทันสมัย ตอบสนองเร็ว
- สี (กำหนดเป็น CSS custom properties ใน :root):
  --bg #F3EEE4 · --surface #FBF8F1 · --paper #FFFDF8 · --ink #1F1D1A · --muted #6F685D
  --line #E4DCCD · --line-strong #D9D0BF · --accent #2E5E4E · --accent-soft #DDE7DF
  --butter #F1D36B · --good #2E7D55 · --bad #B4432F
  ช่วงเวลา: --seg-srs #2E5E4E · --seg-input #3D5A80 · --seg-output #7A4E7E · --seg-weak #C98A2B
- ฟอนต์ (Google Fonts): Anuphan = เนื้อหา, Bricolage Grotesque = หัวข้อและตัวเลขใหญ่, JetBrains Mono = ตัวเลขเวลาและป้ายเล็ก
- ปุ่มหลัก: พื้น --ink ตัวอักษร --bg ทรง pill · ปุ่มรอง: ขอบ --line-strong พื้นโปร่ง
- การ์ด: พื้น --surface ขอบ 1px --line มุมโค้ง 22px
- ปุ่มทุกปุ่ม: transition 120ms, กดแล้ว scale(.97), สูงอย่างน้อย 44px, มี :focus-visible
- เลย์เอาต์: เดสก์ท็อปใช้เมนูซ้าย, มือถือ (<768px) ใช้แถบเมนูลอยด้านล่าง
- รองรับ prefers-reduced-motion
- วาง token ให้เพิ่ม dark mode ได้ภายหลัง

## กฎการทำงาน
- ภาษาใน UI: ไทย (คำศัพท์เทคนิคภาษาอังกฤษใช้ได้) · ตอบและอธิบายกับผู้ใช้เป็นภาษาไทย
- ห้ามเดา API, ชื่อฟังก์ชันของ SDK หรือพฤติกรรมของไลบรารี ถ้าไม่แน่ใจให้ตรวจเอกสารทางการหรือถามก่อน
- ห้ามใส่ข้อมูลปลอมเป็นข้อมูลจริง ข้อมูลตัวอย่างต้องติดป้าย "ตัวอย่าง" และลบได้
- ห้ามใส่ Firebase config หรือ key จริงลงในโค้ดตัวอย่าง ให้ใช้ไฟล์ config ที่ผู้ใช้กรอกเอง
- ทำเฉพาะขอบเขตของเฟสที่สั่ง ไม่เพิ่มฟีเจอร์เกินมาเอง
- ทำเสร็จแต่ละขั้นให้สรุปสั้น ๆ ว่าทำอะไรไป และอะไรยังค้าง

## ข้อตกลงที่อนุมัติแล้ว (เฟส 1)
- หน้าอื่นห้ามเรียก Firestore ตรง ต้องผ่าน js/db.js เท่านั้น
- สถานะ SRS ของการ์ด (ease/interval/due) ไม่เก็บใน card คำนวณจากการเล่น reviews ซ้ำตามเวลา
- สถานะ "แก้ได้แล้ว" และจำนวนครั้งที่ผิดคำนวณจาก errorEvents (type: occurred/resolved/reopened)
- เวลาทั้งหมดใช้ Date.now() (ms) จากเครื่อง
- Collections ใต้ users/{uid}/: settings (doc main), cards, errors, reviews*, sessions*, errorEvents* (*ต่อท้ายอย่างเดียว)
- firestore.rules: เจ้าของเท่านั้น · events สร้างได้อย่างเดียว · ห้าม hard delete

## คลังคำศัพท์และ API (เพิ่มในเฟส 2)
- คำแปลและข้อมูลคำ "แปลครั้งเดียว เก็บถาวร": เก็บที่ users/{uid}/lexicon/{wordKey}
  wordKey = คำตัวพิมพ์เล็ก ตัดช่องว่างหัวท้าย ช่องว่างซ้อนเหลือช่องเดียว
- ลำดับการหา: Firestore cache ในเครื่อง → Firestore server → API (เรียกเฉพาะคำที่ไม่เคยมี)
- ถ้าผู้ใช้แก้คำแปลเอง (userEdited: true) ห้ามให้ผลจาก API เขียนทับ
- API ที่อนุญาต: Free Dictionary API, Datamuse, MyMemory, Claude API (ไม่บังคับ)
- API key ของ Claude และอีเมลสำหรับ MyMemory เก็บใน localStorage ของแต่ละเครื่องเท่านั้น ห้ามขึ้น Firestore
- ทุกการเรียก API ต้องมี timeout, จัดการ error และแสดงข้อความภาษาไทยที่บอกวิธีแก้

## สื่อ เสียง และ Web API ของเบราว์เซอร์ (เพิ่มในเฟส 3)
- เสียงอัด Shadowing เก็บใน IndexedDB ของเครื่องเท่านั้น ห้ามขึ้น Firestore
  เรียก navigator.storage.persist() และแสดงพื้นที่ที่ใช้ไปจาก navigator.storage.estimate()
- คลิป YouTube เล่นผ่าน YouTube IFrame Player API เท่านั้น ห้ามดาวน์โหลดหรือดึงไฟล์เสียง/วิดีโอจาก YouTube
- Web API ที่บางเบราว์เซอร์ไม่รองรับ (SpeechRecognition, MediaRecorder, pointer pressure)
  ต้องตรวจก่อนใช้ทุกครั้ง ถ้าไม่รองรับให้ซ่อนฟีเจอร์และบอกเหตุผลเป็นภาษาไทย ห้ามให้แอปพัง
- ผลลัพธ์จาก AI ต้องขอเป็น JSON และตรวจโครงสร้างก่อนใช้ ถ้าไม่ตรงให้แสดง error ห้ามเดาข้อมูลเติม
- ภาพลายมือเก็บเป็น JPEG ย่อขนาด (กว้าง ≈ 260px, quality ≈ 0.6) ขนาดไม่เกิน ~25 KB ต่อภาพ

## ไลบรารี สถิติ และคลังข้อสอบ (เพิ่มในเฟส 4)
- ไลบรารีที่อนุญาตเพิ่ม (ระบุเวอร์ชันตายตัว และให้ service worker cache ไว้ใช้ออฟไลน์):
  Chart.js (กราฟ Dashboard), Cytoscape.js (กราฟเชื่อมโยงคำ), JSZip (Export vault)
- events ยังเป็นข้อมูลจริงเพียงแหล่งเดียว ตัวสรุปรายวัน (dailyStats) เป็นแค่ cache ที่คำนวณจาก events
  ต้องมีฟังก์ชัน "คำนวณใหม่ทั้งหมด" ได้เสมอ และห้ามแก้ dailyStats ด้วยมือ
- ระวังโควตา Firestore (อ่าน 50,000 ครั้งต่อวัน): Dashboard ต้องอ่านจาก dailyStats ไม่ใช่ดึง events ทั้งหมดทุกครั้ง
- คลังข้อสอบ: ห้ามใส่ข้อสอบจริงหรือข้อสอบที่มีลิขสิทธิ์ลงใน repo
  แอปเป็นแค่ "เครื่องมือทำข้อสอบ" ผู้ใช้นำเข้าข้อสอบเองจากแหล่งที่ตัวเองมีสิทธิ์ใช้
