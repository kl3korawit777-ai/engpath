# EngPath

เว็บแอปเรียนภาษาอังกฤษตาม Roadmap A1 → C1 — Vanilla HTML/CSS/JS (ES modules) ไม่มี build step
ใช้ Firebase (Google sign-in + Firestore) ซิงก์ข้อมูลข้ามเครื่อง และเป็น PWA ใช้ออฟไลน์ได้

**เฟส 1:** ล็อกอิน + ซิงก์, หน้าวันนี้ (ตัวจับเวลา 4 ช่วง, Streak, heatmap), บัตรคำ SRS (SM-2), Error Log, Export/Import JSON
**เฟส 2:** เพิ่มคำผ่าน API + คลังคำแปลถาวร, คลังคำศัพท์ + แท็กซ้อนชั้น + Smart folder, Onboarding + Roadmap ขั้น 0–5 + checkpoint, ฝึกเจาะจุดจาก Error Log, เทคนิคการเรียน 8 ข้อ

---

## ตั้งค่าทีละขั้น

### 1. สร้าง Firebase project
1. เข้า <https://console.firebase.google.com> → **Add project** → ตั้งชื่อ (เช่น `engpath`)
2. ปิด Google Analytics ได้ (ไม่จำเป็น)
3. ในหน้า Project overview กด **</>** (Web) → ตั้งชื่อแอป → **Register app** (ไม่ต้องติ๊ก Firebase Hosting)
4. จะได้ `firebaseConfig` — เก็บไว้ใช้ในขั้นที่ 5

### 2. เปิด Google sign-in
**Build → Authentication → Get started → Sign-in method → Google → Enable** → เลือกอีเมลซัพพอร์ต → **Save**

### 3. สร้าง Firestore แล้ววางกฎ (rules)
1. **Build → Firestore Database → Create database** → เลือก location ที่ใกล้ (เช่น `asia-southeast1`) → เริ่มด้วย **production mode**
2. แท็บ **Rules** → ลบของเดิม → วางเนื้อหาไฟล์ [`firestore.rules`](firestore.rules) ทั้งหมด → **Publish**

กฎนี้: อ่าน/เขียนได้เฉพาะเจ้าของ (`request.auth.uid == userId`), `reviews` / `sessions` / `errorEvents` สร้างได้อย่างเดียว (ต่อท้ายเท่านั้น), และห้ามลบจริง (ใช้ soft delete)

### 4. เพิ่ม authorized domain
**Authentication → Settings → Authorized domains → Add domain** → ใส่ `<username>.github.io`
(`localhost` มีอยู่ให้แล้ว สำหรับทดสอบในเครื่อง)

### 5. กรอก `firebase-config.js`
```bash
cp js/firebase-config.example.js js/firebase-config.js
```
เปิด `js/firebase-config.js` แล้วกรอกค่าจากขั้นที่ 1 (`apiKey`, `authDomain`, `projectId`, `appId` ฯลฯ)
ไฟล์นี้อยู่ใน `.gitignore` แล้ว — **ไม่ถูก commit**

> ⚠️ เนื่องจากไฟล์นี้ไม่อยู่ใน git, GitHub Pages จะไม่มีไฟล์นี้ตอน deploy ปกติ
> ดูขั้นที่ 6 สำหรับวิธีจัดการ

### 6. Deploy ขึ้น GitHub Pages
`apiKey` ของ Firebase เว็บเป็นค่าที่ **ไม่ใช่ความลับ** (ความปลอดภัยอยู่ที่ Rules + authorized domains) จึงเปิดเผยในไซต์ได้ — แต่ผมตั้งไว้ไม่ให้ commit เอง คุณเลือกได้ 2 ทาง:

**ทาง A (ง่ายสุด):** ใช้ repo ส่วนตัวสำหรับ deploy โดยลบบรรทัด `js/firebase-config.js` ออกจาก `.gitignore` แล้ว commit ไฟล์นี้
**ทาง B:** ให้ GitHub Actions สร้างไฟล์ `js/firebase-config.js` จาก repository secret ตอน deploy

จากนั้น:
```bash
git init && git add . && git commit -m "EngPath phase 1"
git branch -M main
git remote add origin https://github.com/<username>/engpath.git
git push -u origin main
```
**Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** → รอสักครู่ จะได้ `https://<username>.github.io/engpath/`

ทุกครั้งที่แก้ไฟล์ใน app shell ให้เปลี่ยน `VERSION` ใน `sw.js` (เช่น `v1` → `v2`) เพื่อให้เครื่องผู้ใช้ดึงชุดใหม่

### 7. ทดสอบบน iPad
1. เปิด `https://<username>.github.io/engpath/` ใน **Safari** → ล็อกอินด้วย Google
2. แชร์ (ไอคอนสี่เหลี่ยมมีลูกศร) → **Add to Home Screen**
3. เปิดจากไอคอนบน Home Screen — **ต้องล็อกอินใหม่อีกครั้ง** เพราะ PWA บน iOS แยกที่เก็บข้อมูลจาก Safari (ปกติ)
4. ใช้งานสักพัก (ให้โหลดบัตรคำและ cache ครบ) → เปิด **โหมดเครื่องบิน** → เปิดแอปจากไอคอน ต้องใช้ทบทวนบัตรได้
5. ต่อเน็ตกลับ → ไอคอนมุมขวาบนเปลี่ยน ออฟไลน์ → รอส่ง → ซิงก์แล้ว

ถ้าล็อกอินบน iPad/PWA แล้ววนกลับหน้าล็อกอิน (redirect flow): ตรวจว่า `authDomain` ใน config ตรงกับโดเมนที่ใช้ และ domain อยู่ใน authorized domains —
เบราว์เซอร์ที่บล็อก third-party storage อาจทำให้ `signInWithRedirect` ไม่สำเร็จ ดู [คำแนะนำของ Firebase](https://firebase.google.com/docs/auth/web/redirect-best-practices)

---

---

## ตั้งค่าเพิ่มสำหรับเฟส 2

### อัปเดต Firestore rules (ต้องทำ ไม่งั้นเขียนข้อมูลใหม่ไม่ได้)
เฟส 2 เพิ่ม collection `lexicon`, `smartFolders`, `checkpoints`, `practiceEvents` — วางเนื้อหา [`firestore.rules`](firestore.rules) ทั้งไฟล์ทับของเดิมใน **Firestore Database → Rules** แล้วกด **Publish**
ถ้าไม่ Publish จะขึ้น `บันทึกไม่สำเร็จ: permission-denied` เมื่อเพิ่มคำ/สร้าง Smart folder/บันทึก checkpoint
(ข้อมูลของเฟส 1 ใช้ต่อได้ ไม่ต้องย้าย ฟิลด์ใหม่มีค่าเริ่มต้นตอนอ่าน)

### ตั้งอีเมลสำหรับ MyMemory (ไม่บังคับ แนะนำ)
**ตั้งค่า → แหล่งข้อมูลคำศัพท์ → อีเมลสำหรับ MyMemory** ใส่อีเมลจริงของคุณ แล้วกด **บันทึก**
อีเมลจะถูกส่งไปกับคำขอแปลเป็นพารามิเตอร์ `de` เพื่อเพิ่มโควตาแปลฟรี (ไม่ได้ส่งไปที่อื่น) เก็บในเครื่องนี้เท่านั้น

### ใส่ Claude API key (ไม่บังคับ — เปิดปุ่ม “ให้ AI ช่วย” และ “สร้างโจทย์เพิ่มด้วย AI”)
1. สร้างคีย์ที่ <https://platform.claude.com/settings/keys> (ต้องมีเครดิตในบัญชี)
2. **ตั้งค่า → แหล่งข้อมูลคำศัพท์ → Claude API key** วางคีย์ แล้วกด **บันทึก**
3. (ถ้าต้องการ) ใส่ชื่อรุ่นในช่อง “ชื่อรุ่น Claude” — เว้นว่างใช้ค่าเริ่มต้น `claude-sonnet-5-5` ดูรุ่นที่ใช้ได้ใน [Models overview](https://platform.claude.com/docs/en/models/overview) (เช่น `claude-haiku-5-5` ถูกกว่า)

ข้อควรรู้เรื่องคีย์:
- เก็บใน `localStorage` ของแต่ละเครื่องเท่านั้น **ไม่ขึ้น Firestore และไม่รวมใน Export JSON** ต้องใส่แยกทุกเครื่อง
- แอปเรียก `api.anthropic.com` ตรงจากเบราว์เซอร์ด้วย header `anthropic-dangerous-direct-browser-access: true` (ทดสอบแล้วว่าจำเป็น ไม่งั้นถูกบล็อก CORS) ใครใช้เครื่องนี้ก็เปิดดูคีย์ได้ → ใช้เฉพาะเครื่องที่ไว้ใจ และตั้งวงเงินใช้จ่ายในคอนโซล
- ปุ่ม **ล้างคีย์** ลบออกจากเครื่องนี้ · ห้ามใส่คีย์ลงไฟล์ในโปรเจกต์หรือ commit ขึ้น repo

### โควตาของแต่ละ API
| บริการ | ใช้ทำอะไร | โควตา / ข้อจำกัด |
|---|---|---|
| Free Dictionary (`api.dictionaryapi.dev`) | ความหมายอังกฤษ, IPA, เสียง, ประโยคตัวอย่าง | เว็บไซต์ไม่ระบุโควตา · **ตอนทดสอบบริการนี้ไม่ตอบสนอง** แอปจึงดึงส่วนอื่นต่อและบอกว่าข้อมูลส่วนไหนขาด |
| Datamuse (`api.datamuse.com`) | ชนิดคำ, ความถี่, คำพ้อง/ตรงข้าม/มักมาด้วย | ไม่ต้องมีคีย์ สูงสุด 100,000 คำขอ/วัน (1 คำที่เพิ่มใหม่ใช้ 5 คำขอ) |
| MyMemory (`api.mymemory.translated.net`) | คำแปลไทยค่าเริ่มต้น | ไม่ระบุอีเมล 5,000 ตัวอักษร/วัน · ระบุอีเมล 50,000 ตัวอักษร/วัน |
| Claude API | แปลตามความหมาย, ประโยคตัวอย่าง, แท็กแนะนำ, โจทย์ฝึกเจาะจุด | จ่ายตามโทเค็นของบัญชีคุณ (ราคาล่าสุดดู [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)) |

คำที่เคยแปลแล้วเก็บถาวรใน `users/{uid}/lexicon/{wordKey}` — ค้นซ้ำ (แม้บนอีกเครื่องหรือตอนออฟไลน์) ไม่เรียก API ใหม่ จะเรียกอีกครั้งเมื่อกด **แปลใหม่** เท่านั้น ถ้าคุณแก้คำแปลเองแล้ว API จะไม่ทับคำแปลนั้น
ทุกคำขอมี timeout (API ทั่วไป 8 วินาที, Claude 30 วินาที) และแสดงข้อความภาษาไทยบอกวิธีแก้เมื่อล้มเหลว

### เครื่องมือเสริม
- ตัวเลือกแผน: **ตั้งค่า → แผนการเรียน** (เวลาเรียนต่อวัน 30–120 นาที จะสเกลสัดส่วน 4 ช่วงตามนั้น, วงจร checkpoint 4–6 สัปดาห์)
- ครั้งแรกหลังล็อกอินแอปจะพาไป Onboarding (ข้ามได้ กลับมาทำใหม่ได้ที่ **ตั้งค่า** หรือหน้า **Roadmap**)
- ถ้อยคำ Roadmap และเทคนิค 8 ข้อถอดจาก `docs/English_Learning_Roadmap.pdf` (ไฟล์อินโฟกราฟิก) — ถ้าพบคำผิด แก้ที่ `js/data/roadmap.js` และ `js/data/techniques.js`
- เกณฑ์ระดับคำจากความถี่ (พื้นฐาน/กลาง/วิชาการ) ปรับได้ที่ `js/data/lexicon-config.js`

---

## เฟส 3 — เขียน + Shadowing

### ต้องทำก่อนใช้
- **Publish `firestore.rules` ใหม่** ใน Firebase Console (เพิ่ม `clips, playlists, handwriting*, shadowingEvents, readings, journal`) ไม่งั้นเขียนข้อมูลใหม่ไม่ได้
- เปิดแอปแล้วรีเฟรช 2 ครั้ง เพื่อให้ service worker เวอร์ชันใหม่ทำงาน

### หน้าใหม่ (อยู่ในเมนู “ฝึก”)
| หน้า | ทำอะไร |
|---|---|
| เขียนมือ (`#/write`) | ฝึกเขียนคำด้วยนิ้ว/Apple Pencil ให้คะแนนจากรูปร่าง เก็บภาพ JPEG เล็ก (~260px) |
| Shadowing (`#/shadowing`) | คลังคลิป (YouTube ผ่าน IFrame Player หรือไฟล์เสียง/วิดีโอที่มี Range) เล่นทีละประโยค/วนซ้ำ อัดเสียงเทียบ |
| ตัวเช็ก i+1 (`#/reading`) | วางข้อความ ดูสัดส่วนคำใหม่ เพิ่มคำเป็นบัตรคำ |
| Journal (`#/journal`) | เขียนวันละ 5–10 ประโยค บันทึกร่างอัตโนมัติ ออฟไลน์ได้ ให้ AI ตรวจ (ต้องมี Claude API key) หรือตรวจเองด้วยเช็กลิสต์ แล้วส่งเข้า Error Log / บัตรคำ |

หน้า “วันนี้” มีปุ่ม “ไปที่” ในช่วง Input และ Output และเวลาที่ใช้ในทุกหน้าใหม่ถูกบันทึกเป็น session ตามทักษะ (input / shadowing / writing / journal)

### การรองรับของเบราว์เซอร์
- **อัดเสียง (MediaRecorder)** และ **ตรวจคำพูด (SpeechRecognition)** บางเบราว์เซอร์ไม่รองรับ (เช่น SpeechRecognition บน Firefox) — แอปจะซ่อนฟีเจอร์และบอกเหตุผลเป็นภาษาไทย ไม่ทำให้แอปพัง
- iPad/iPhone ต้องอนุญาตไมโครโฟนเมื่อเบราว์เซอร์ถาม และ Apple Pencil ใช้ได้กับหน้าเขียนมือ
- คลิป YouTube บางตัวปิดไม่ให้ฝัง (embed) — แอปจะแจ้งให้เลือกคลิปอื่น; แอปไม่ดาวน์โหลดเสียง/วิดีโอจาก YouTube
- ไฟล์เสียง/วิดีโอจากลิงก์ตรง ต้องเป็นเซิร์ฟเวอร์ที่รองรับ HTTP Range (ไม่งั้นกรอไม่ได้)

### เสียงอัดและพื้นที่เก็บ
- เสียงอัดเก็บใน **IndexedDB ของเครื่องนั้นเท่านั้น ไม่ซิงก์ขึ้น Firestore และไม่อยู่ในไฟล์ export** (เปลี่ยนเครื่องแล้วไม่ตามไป)
- แอปเรียก `navigator.storage.persist()` และแสดงพื้นที่ที่ใช้จาก `navigator.storage.estimate()` — ลบเสียงเก่าเองได้ในหน้า Shadowing
- Claude API key เก็บเฉพาะ localStorage ของเครื่อง ไม่ขึ้น Firestore

### Collections ที่เพิ่ม (ใต้ `users/{uid}/`)
| Collection | ชนิด | ฟิลด์เฉพาะ |
|---|---|---|
| `handwritingWords` | แก้ไขได้ | คำที่ใช้ฝึก |
| `handwritingAttempts`, `handwritingImages` | ต่อท้ายอย่างเดียว | ผลการฝึก / ภาพ JPEG เล็ก |
| `clips`, `playlists` | แก้ไขได้ | คลิปและเพลย์ลิสต์ |
| `shadowingEvents` | ต่อท้ายอย่างเดียว | ผลฝึก Shadowing แต่ละครั้ง |
| `readings` | ต่อท้ายอย่างเดียว | ผลตัวเช็ก i+1 |
| `journal` | แก้ไขได้ | `date, text, corrected, wordCount, sentenceCount, review{source, items[], at, forText}` |

---

## เฟส 4 — เชื่อมโยง + วิเคราะห์

### ต้องทำก่อนใช้
- **Publish `firestore.rules` ใหม่** (เพิ่ม `links, wordFamilies, dailyStats, questions, examSets, interleavingSessions, examAttempts`) ไม่งั้นเขียนข้อมูลใหม่ของเฟสนี้ไม่ได้ — ถ้ายังไม่ publish แอปจะหยุดลองเขียนสถิติในรอบนั้นเอง
- เปิดแอป รีเฟรช 2 ครั้ง เพื่อให้ service worker (แคช v23) ติดตั้ง — ไลบรารีอยู่ใน `vendor/` (Chart.js 4.5.1, Cytoscape 3.34.4, JSZip 3.10.2) ถูกแคชไว้ใช้ออฟไลน์

### ลิงก์ [[ ]] และ Backlinks
- เปิดหน้าคำจาก **คลังคำ** (กดชื่อคำ) ที่หน้าคำมีช่อง “โน้ต” พิมพ์ `[[` แล้วเลือกคำจากรายการ (↑↓ Enter) หรือพิมพ์เอง: `[[decide]]` หรือ `[[decide|ตัดสินใจ]]` (อ้างอิงด้วย wordKey ไม่ใช่ข้อความที่แสดง)
- ลิงก์ไปคำที่ยังไม่มีบัตรขึ้นเป็นลิงก์จาง กดแล้วเปิดฟอร์มเพิ่มคำ (ดึงข้อมูลด้วยระบบเดิมของเฟส 2)
- ส่วน **Backlinks** บอกว่าคำไหนลิงก์มาหาคำนี้ พร้อมบรรทัดที่อ้างถึง และอัปเดตทันทีเมื่อแก้โน้ต

### กราฟคำ (เมนู “เพิ่มเติม” → กราฟคำ)
- โหนด = บัตรคำ สีตามสถานะ (ใหม่/กำลังเรียน/จำได้) ขนาดตามจำนวนเส้นที่แสดง · เส้นแยกสีตามชนิด เปิด/ปิดได้ (ลิงก์เอง · คำพ้อง · คำตรงข้าม · ตระกูลคำ · คำที่มักมาคู่กัน · อยู่ประโยค/คลิป/Journal เดียวกัน · แท็กเดียวกัน [ปิดไว้ก่อน เพราะเส้นเยอะ])
- “แสดงคำแนะนำ” แสดงคำที่เกี่ยวข้องแต่ยังไม่มีบัตรเป็นโหนดจาง กดแล้วเพิ่มได้
- กดโหนด → แผงด้านข้างแสดงคำแปล เพื่อนบ้าน ปุ่ม **เปิดหน้าคำ** และ **ทบทวนกลุ่มนี้** (คำนี้ + เพื่อนบ้านชั้นเดียว ทบทวนได้แม้ยังไม่ถึงรอบ — คะแนนที่ให้เข้า SRS ตามปกติ)
- ซูม/ลาก: เมาส์, ล้อเลื่อน, pinch และลากด้วยนิ้วบน iPad · ค้นหาคำแล้วซูมไปที่โหนดได้
- ตระกูลคำ: แอปเดาจากรากคำ (decide/decision/decisive) แล้วให้คุณกด “ยืนยัน” — เฉพาะที่ยืนยันจึงเป็นเส้น
- ข้อมูลคำพ้อง/คำตรงข้ามมาจากคลังคำที่ **มีในเครื่อง** (ไม่เรียก server อัตโนมัติ) — ปุ่ม “โหลดข้อมูลคำที่ยังไม่มีในเครื่อง” จะอ่านจาก Firestore ทีละคำ (นับ read) เมื่อคุณกดเอง
- ตำแหน่งโหนดถูกจำไว้ในเครื่อง ไม่ขึ้น Firestore · “จัดวางใหม่” คำนวณใหม่ (ใช้ force layout ของแอปเองที่รันใน Web Worker เพราะ layout `cose` ของ Cytoscape ช้ามากเมื่อโหนดหลักพัน)
- กราฟเป็นภาพ (canvas) ที่ screen reader อ่านไม่ได้ — ใช้ช่องค้นหาและแผงรายละเอียด (ปุ่มเพื่อนบ้าน) แทน

### Export Obsidian vault
- **ตั้งค่า → Export Obsidian vault** เลือกทั้งคลัง / แท็ก / Smart folder แล้วดาวน์โหลด `.zip`
- แตกไฟล์ → ใน Obsidian เลือก **Open folder as vault** → ชี้ไปที่โฟลเดอร์ `EngPath` (หนึ่งคำต่อหนึ่งไฟล์ใน `words/`)
- แต่ละไฟล์มี frontmatter (`th, ipa, pos, tags, level, status, interval, due, source, created`), แท็กแบบ `#science/biology`, ความหมาย/ประโยคตัวอย่าง (จากคลังคำที่มีในเครื่อง), โน้ตที่คงลิงก์ `[[ ]]` และส่วน **Related** แยกตามชนิดความสัมพันธ์
- ชื่อไฟล์ตัดอักขระที่ใช้ไม่ได้ในบางระบบ (`\ / : * ? " < > | # ^ [ ]`) และถ้าชื่อต่างจากคำ ลิงก์ในโน้ตจะถูกเขียนให้ชี้ไฟล์จริง
- เป็นสำเนา ณ ตอนส่งออก — แก้ใน Obsidian ไม่ย้อนกลับมาที่แอป

### หน้าสถิติ (เมนู “เพิ่มเติม” → สถิติ)
ช่วงเวลา: **วัน** (วันนี้เทียบเมื่อวาน) · **สัปดาห์** (7 วันล่าสุดเทียบ 7 วันก่อนหน้า) · **เดือน** (30 วัน) · **ทั้งหมด**

| ตัวเลข | คำอธิบาย |
|---|---|
| เวลาเรียนรวม | ผลรวมวินาทีของ session ทุกทักษะในช่วงที่เลือก (session ที่คร่อมเที่ยงคืน/ข้ามชั่วโมงถูกแบ่งตามเวลาจริง) |
| คำที่จำได้ | จำนวนบัตรที่ interval ของ SM-2 ≥ 21 วัน “ตอนนี้” และจำนวนที่เปลี่ยนในช่วง (ได้ − เสีย) |
| ตอบบัตรคำถูก | การทบทวนที่ให้คะแนนมากกว่า 0 (ไม่ใช่ “ลืม”) ÷ ทั้งหมดในช่วง |
| Streak | วันติดกันที่มี session หรือการทบทวน (ตรงกับหน้า “วันนี้”) + ยาวที่สุด |
| กราฟเวลา | แท่ง stacked ตามทักษะ (นาที) เทียบเส้นเป้าหมายรายวัน; ช่วง “วัน” แสดงรายชั่วโมง; ช่วงยาวกว่า 90 วันรวมเป็นสัปดาห์ |
| ชั่วโมง × วัน | นาทีที่เรียนในแต่ละชั่วโมงของแต่ละวันในสัปดาห์ (จันทร์–อาทิตย์) ช่วง “วัน” ใช้ 7 วันล่าสุด |
| Input/Output | Input = ช่วง Input · Output = Output + Shadowing + เขียนมือ + Journal เทียบสัดส่วนที่ขั้นปัจจุบันแนะนำ (จากแผนตัวจับเวลา) |
| คลังคำ | คำสะสมเทียบ “จำได้” สะสม |
| บัตรถึงรอบ | บัตรที่เคยทบทวนแล้วที่จะถึงรอบใน 14 วัน (เลยกำหนดนับเป็นวันนี้) |
| ข้อผิดตามหมวด | จำนวนครั้งที่เกิดข้อผิดต่อหมวด เดือนนี้เทียบเดือนก่อน |
| ลายมือ | คะแนนเฉลี่ยรายวัน (เฉพาะที่ให้คะแนนอัตโนมัติ) แยก Print/Cursive |

- ทุกกราฟมี “ดูตารางข้อมูล” เพื่ออ่านค่าตรง ๆ
- **dailyStats** เป็นแค่ cache ที่คำนวณจาก events (แก้ด้วยมือไม่ได้ และไม่รวมในไฟล์ Export): แอปคำนวณใหม่เมื่อมี event ใหม่ เขียนเฉพาะวันที่ค่าเปลี่ยน, สร้างย้อนหลังอัตโนมัติครั้งแรก, และมีปุ่ม **คำนวณสถิติใหม่ทั้งหมด** ที่หน้า “ตั้งค่า” — เรียนบนสองเครื่องจะได้ค่าเดียวกันหลังซิงก์ ไม่นับซ้ำ
- หน้าสถิติอ่านจาก dailyStats (วันละ 1 เอกสาร) ไม่ดึง events ทั้งหมดทุกครั้ง

### Technique Score และ Mini-challenge
- ใน 7 วันล่าสุด: 01 = จำนวนการทบทวน · 02 = ทบทวนที่พิมพ์คำตอบ · 03 = ครั้งที่เช็ก i+1 · 04 = บัตรใหม่ที่เพิ่ม · 05 = รอบ Shadowing · 06 = ข้อที่ฝึกเจาะจุด · 07 = ชุดคละโจทย์ · 08 = จำนวนวันที่เรียน
- คะแนน % เทียบเป้าต่อสัปดาห์ที่ตั้งค่าตั้งต้นไว้ใน `js/data/technique-config.js` (ปรับได้) — เทคนิคที่คะแนนต่ำสุดถูกไฮไลต์ และเป็นมินิชาเลนจ์ในหน้า “วันนี้”

### คละโจทย์ (ฝึก → คละโจทย์)
- สร้างชุด 10–20 ข้อจากบัตรคำ (เลือกแท็กได้) / ข้อผิดใน Error Log / คลังข้อสอบ: ความหมาย · สะกด · เลือกแบบที่ถูก · เติมคำ · พิมพ์แบบที่ถูก
- ห้ามหัวข้อเดียวกันติดกันเกิน 2 ข้อ และสลับชนิดโจทย์เมื่อทำได้ (ถ้าหัวข้อไม่หลากหลายพอ แอปจะบอกว่าได้กี่ข้อ)
- ผลแต่ละข้อกลับต้นทางทันที: บัตรคำ → การทบทวนใน SRS (ผิด=ลืม, เกือบถูก=ยาก, ถูก=จำได้) · ข้อผิด → ประวัติฝึกเจาะจุด; เวลานับเป็น session “เจาะจุดอ่อน”

### สอบจับเวลา (ฝึก → สอบจับเวลา)
แอปเป็น **เครื่องมือทำข้อสอบ** — ไม่มีข้อสอบจริง/ลิขสิทธิ์มาให้ คุณนำเข้าเองจากแหล่งที่คุณมีสิทธิ์ใช้ (ข้อมูลซิงก์เฉพาะบัญชีคุณ)

1. แท็บ **คลังข้อสอบ** → ดาวน์โหลด template (CSV หรือ JSON) — ในไฟล์มี 3 ข้อตัวอย่างที่ติดป้าย “ตัวอย่าง” ลบได้ในปุ่มเดียว
2. คอลัมน์ CSV: `question, option_a … option_f (2–6 ตัวเลือก), answer, explanation (ไม่บังคับ), section, set, source`
   - `answer` ใส่ตัวอักษร A–F หรือข้อความของตัวเลือกให้ตรง · `section` = `reading | grammar | vocab | conversation` · `set` = ชื่อชุดข้อสอบ
   - ช่องที่มีขึ้นบรรทัดใหม่/ลูกน้ำต้องอยู่ในเครื่องหมายคำพูด `"…"` (Excel/Google Sheets ทำให้เอง) · รองรับตัวคั่น `,` `;` tab
3. นำเข้า: แอปตรวจทุกแถวแล้ว **บอกบรรทัดที่ผิด** (JSON บอก “รายการที่ N”) จะไม่นำเข้าอะไรจนกว่าคุณกดยืนยัน และนำเข้าเฉพาะแถวที่ถูกต้อง (ข้ามข้อซ้ำ)
4. แท็บ **ทำข้อสอบ**: เลือกชุด/ส่วน จำนวนข้อ เวลา (ตั้งเองตามรูปแบบที่จะสอบ เช่น TGAT1 / A-Level) เป้าคะแนน % แล้วบันทึกเป็น preset ได้ — ระหว่างสอบมีนับถอยหลัง ปักธง ข้าม ไม่แสดงเฉลย หมดเวลาแล้วส่งอัตโนมัติ (เวลานับจากนาฬิกาจริง ถ้าออกจากหน้านี้ไปแล้วกลับมาหลังหมดเวลาจะส่งให้ทันที)
5. หลังสอบ: คะแนนรวม/รายส่วน เวลาต่อข้อ ทบทวนข้อผิดพร้อมคำอธิบาย ปุ่ม **เพิ่มเข้า Error Log** และกดคำศัพท์ในข้อเพื่อเพิ่มเป็นบัตรคำ
6. Roadmap ขั้น 4 แสดงผลสอบจำลองล่าสุดเทียบเป้า และ “ถึงเป้า 2 ครั้งติด” (นับ 2 ครั้งล่าสุดของ preset/ชุดสอบแนวเดียวกันที่ตั้งเป้าไว้)

### Collections ที่เพิ่ม (ใต้ `users/{uid}/`)
| Collection | ชนิด | ฟิลด์เฉพาะ |
|---|---|---|
| `links/{wordKey}` | แก้ไขได้ | `from, notes (โน้ตของคำ), to[{key, alias, line}]` (ดัชนีลิงก์ออก) |
| `wordFamilies` | แก้ไขได้ | `members[], confirmed` |
| `dailyStats/{yyyy-mm-dd}` | cache (คำนวณจาก events) | นาทีต่อทักษะ/ชั่วโมง, reviews, correct, recall, newCards, knownGained/Lost, errorCat, hw, … — **ไม่ export** |
| `questions` | แก้ไขได้ | `question, options[], answer, explanation, section, setName, source` |
| `examSets` | แก้ไขได้ | `name, setName, sections[], count, minutes, targetPercent` |
| `interleavingSessions` | ต่อท้ายอย่างเดียว | `start, end, durationSec, total, correct, items[{src, kind, topic, ref, correct}]` |
| `examAttempts` | ต่อท้ายอย่างเดียว | `start, end, durationSec, limitSec, autoSubmitted, config, total, correct, scorePct, bySection[], items[{qid, section, chosen, correct, sec, flagged}]` |

### Accessibility และประสิทธิภาพ
- ปุ่ม/ลิงก์ที่แตะได้สูง ≥ 44px, ทุกปุ่มและช่องกรอกมีชื่อ (label/aria-label), มี focus ring ทุกชนิด, contrast ตัวอักษรผ่าน 4.5:1 ทุกหน้าที่ตรวจ — สคริปต์ตรวจอยู่ที่ `tests/a11y-audit.js` (รันในหน้า harness)
- ไลบรารีกราฟ/zip โหลดเฉพาะตอนเปิดหน้านั้น (`import()`), การคำนวณ dailyStats ทำไม่บ่อยกว่าทุก 15 วินาทีขณะใช้งาน

---

## รันในเครื่อง
```bash
python -m http.server 8080      # แล้วเปิด http://localhost:8080
```
(ต้องผ่าน http://localhost — เปิดไฟล์ตรง ๆ ด้วย file:// ไม่ได้เพราะใช้ ES modules)

## ทดสอบ
```bash
npm test      # หรือ node --test tests/*.test.mjs   (srs, timer, streak, errlog, backup, lexicon, library, roadmap, practice, techniques, handwriting, activity, clips, speech, reading, journal, links, graph, layout, vault, stats, dashboardlogic, techscore, interleave, exam, version)
```
หน้า view ทดสอบโดยไม่ต้องใช้ Firebase ได้ที่ `http://localhost:8080/tests/harness.html?v=cards` (หรือ `today`, `errors`, `library`, `roadmap`, `onboarding`) — ใช้ `tests/mock-db.js` แทน `js/db.js`

## โครงข้อมูล (ใต้ `users/{uid}/`)
| Collection | ชนิด | ฟิลด์เฉพาะ |
|---|---|---|
| `settings/main` | แก้ไขได้ | `stage` (0–5), `dailyMinutes` (60), `checkpointWeeks` (5), `onboarding{done, skipped, doneAt, selfAssess, efSet, goal}`, `criteria{"ขั้น.ข้อ": true}`, `focus{weekKey, errorIds[]}` |
| `cards` | แก้ไขได้ | `en, th, example (≥ 4 คำ), ipa, tags[]` (แท็กซ้อนชั้นด้วย `/`), `pos`, `freq`, `source` |
| `errors` | แก้ไขได้ | `wrong, right, category, note` |
| `lexicon/{wordKey}` | แก้ไขได้ | `word, meanings[], ipa, audioUrl, examples[], th[], thSource, freq, posTags[], related{syn,ant,trg,jjb}, suggestedTags[], sources{…}, userEdited, fetchedAt` |
| `smartFolders` | แก้ไขได้ | `name, conditions{tags, pos, levels, sources, memory, wrongMin, addedWithinDays, dueOnly}` (รวมแบบ AND) |
| `reviews` | ต่อท้ายอย่างเดียว | `cardId, rating (0–3), mode, answer, result, at` |
| `sessions` | ต่อท้ายอย่างเดียว | `start, end, durationSec, skill, stage` |
| `errorEvents` | ต่อท้ายอย่างเดียว | `errorId, type (occurred/resolved/reopened), at` |
| `checkpoints` | ต่อท้ายอย่างเดียว | `at, stage, scores{listening,speaking,reading,writing}, mockExam{score,target}, note, passed, weakSkills[]` |
| `practiceEvents` | ต่อท้ายอย่างเดียว | `errorId, drill (choose/recall/cloze), correct, at, ai?, cardId?` |

ทุก doc มี `id, createdAt, updatedAt, deleted` — ตัวเลขสรุป (สถานะ SRS, จำนวนครั้งที่ผิด, Streak, นาทีรวม, ระดับจากความถี่, สถานะการจำ, ครบรอบ checkpoint) **คำนวณจาก events เสมอ** ไม่เก็บเป็นตัวนับ
ไอคอนใน `icons/` เป็น placeholder — เปลี่ยนเป็นของคุณเองได้ (ขนาดเดิม 192, 512, 180)
