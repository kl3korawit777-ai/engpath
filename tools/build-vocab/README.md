# build-vocab — เครื่องมือสร้างคลังคำ 5,050 คำ

สร้าง `/vocab/index.json` และ `/vocab/level-01.json … level-11.json` จากรายการ NGSL-GR 1.0 + ข้อมูล Wiktionary (kaikki.org) + ข้อความที่ Claude Code เขียนในเซสชัน

> **รันในเครื่องผู้ดูแลเท่านั้น** ห้าม deploy ห้ามเรียกจากแอป · **ไม่เรียก API ภายนอกใด ๆ** (ไม่มีโค้ดเครือข่าย ไม่ใช้ API key — มีเทสต์ตรวจข้อนี้) · ไม่ต้อง `npm install`

## ต้องมี (วางใน `tools/build-vocab/input/`)
1. `NGSL-GR_rank.csv` (ดาวน์โหลดจาก newgeneralservicelist.com)
2. ไฟล์ English ของ kaikki.org — `kaikki.org-dictionary-English.jsonl` (~3.1 GB, postprocessed JSONL; หน้าเว็บระบุว่า deprecated แต่ยังโหลดได้) จาก `https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl` · รับ `.jsonl` หรือ `.jsonl.gz`

ทั้งสองไฟล์ถูก `.gitignore` (ไม่ขึ้น repo)

## ลำดับงาน (รันจากโฟลเดอร์รากของโปรเจกต์)

| ขั้น | คำสั่ง | ทำอะไร |
|---|---|---|
| 0 | `node tools/build-vocab/run.mjs words` | อ่าน CSV ตรวจโครงสร้าง คำนวณระดับ 1–11 แก้คำที่สเปรดชีตทำเพี้ยน |
| 1 | `node tools/build-vocab/run.mjs wiktionary` | อ่านไฟล์ kaikki แบบ stream กรองเฉพาะ 5,050 คำ → `cache/wiktionary.json` + แสดงสถิติ |
| 1b | `node tools/build-vocab/run.mjs stats` | ดูสถิติของขั้น 1 ซ้ำ |
| 2a | `node tools/build-vocab/run.mjs batches` | แบ่งเป็นชุดละ 100 คำ → `work/batches/batch-NNN.input.json` |
| 2b | `node tools/build-vocab/run.mjs progress` | ดูความคืบหน้าและชุดถัดไป (อ่านจาก `work/progress.json`) |
| 2c | Claude Code เขียน `batch-NNN.output.json` ตาม `STYLE.md` | ทีละชุด |
| 2d | `node tools/build-vocab/run.mjs validate-batch N` | ตรวจชุดที่ N; ผ่านแล้วบันทึกลง `progress.json` เอง |
| 3a | `node tools/build-vocab/run.mjs validate` | ตรวจทุกชุดที่ผ่านแล้วรวมกัน (ประโยคซ้ำข้ามชุด, overrides) |
| 3b | `node tools/build-vocab/run.mjs report` | รายงาน HTML ใน `cache/report.html` |
| 3c | `node tools/build-vocab/run.mjs build` | สร้าง `/vocab/*` + รายงานขนาดไฟล์ |

ทุกขั้นเขียนไฟล์แบบ atomic และรันซ้ำได้

## อินพุต: NGSL-GR_rank.csv
- โครงสร้างจริง: UTF-8 มี BOM, CRLF, 2 คอลัมน์ `WordID,Word`, 5,050 แถว, WordID 1…5050 ต่อเนื่อง ใช้ WordID เป็น **rank ตามลำดับในไฟล์ (ไม่เรียงใหม่)**
- ไม่มีคอลัมน์ระดับ จึงคำนวณ: ระดับ 1–8 ละ 400 คำ · ระดับ 9–10 ละ 600 คำ · ระดับ 11 = ที่เหลือ 650 คำ (ปรับที่ `config.json` → `levels.sizes`)
- ค่าที่ถูกแก้ใน `config.json` → `wordFixes` (ต้องตรงค่าเดิมเป๊ะ ไม่งั้นหยุดและแจ้ง): WordID 528 `TRUE` → `true`, 2148 `FALSE` → `false` (สเปรดชีตแปลงเป็นค่าตรรกะ), 13 `august` → `August` (อยู่ระหว่าง July กับ September)
- `wordKey` = ตัวพิมพ์เล็ก (NFC) ของคำ เช่น `Monday` → `monday`

## ขั้น 1: Wiktionary (kaikki.org)
- รูปแบบข้อมูลที่ตรวจจากไฟล์จริง: บรรทัดละ 1 entry `{ word, pos, lang_code:"en", sounds[{ipa,tags}], senses[{glosses[], examples[], synonyms[], antonyms[], derived[], related[], translations[{lang_code,word,sense}]}], translations[…], … }` — คำแปลไทยคือ `translations` ที่ `lang_code == "th"` (ทั้งระดับ sense และระดับ entry; ระดับ entry จับคู่กับความหมายด้วยข้อความ `sense`)
- อ่านด้วย `readline` แบบ stream ทีละบรรทัด ไม่โหลดทั้งไฟล์เข้าหน่วยความจำ (ไฟล์ ~3 GB ใช้เวลาประมาณไม่กี่นาที)
- ดึงต่อคำ (ทั้งหมด `source: "wiktionary"`): ชนิดคำ, ความหมายอังกฤษ (gloss ละเอียดสุดต่อ sense, ข้ามความหมายโบราณ/หายาก/form-of), คำแปลไทยแยกตามความหมายและชนิดคำ, IPA (ชอบ `/…/` แท็ก General-American), ประโยคตัวอย่างอ้างอิง (ไม่ใช่ quotation), คำพ้อง, คำตรงข้าม, ตระกูลคำ (derived + related) — **เก็บเฉพาะคำสัมพันธ์ที่อยู่ใน 5,050 คำ**
- ชนิดคำที่ใช้: noun (รวม name) verb adjective adverb preposition conjunction pronoun determiner interjection number particle · ชนิดอื่น (symbol, character, abbrev, phrase, prefix, suffix …) ข้าม
- รายงานสถิติหลังรัน: กี่คำที่คำแปลไทยครบ/บางส่วน/ไม่มีเลย · ขาดประโยคตัวอย่าง · ขาด IPA · ไม่มีคำพ้อง · ไม่พบคำในไฟล์เลย
- ไม่ดึงไฟล์เสียงของ Wiktionary (ลิขสิทธิ์เป็นรายไฟล์บน Commons) — ถ้าต้องการออกเสียง แอปใช้ TTS ของเบราว์เซอร์

## ขั้น 2: เติมส่วนที่ขาด (Claude Code เขียนเองในเซสชัน)
- กฎกลางอยู่ที่ **`STYLE.md`** (schema, รูปแบบคำแปลไทย, ประโยคตัวอย่าง, วลี, แท็กที่อนุญาต, CEFR, วิธีทำงาน) — อ่านก่อนเขียนทุกชุด
- คำแปลไทยทุกความหมายมี `source`: `"wiktionary"` (ต้องมี `basedOn` = คำแปลจาก Wiktionary ที่ใช้เป็นฐาน ปรับถ้อยคำได้แต่ห้ามเปลี่ยนความหมาย) หรือ `"claude"` (เฉพาะเมื่อไม่มีตัวเลือกหรือไม่ครอบคลุมความหมายหลัก) · `"manual"` สงวนไว้สำหรับ `overrides.json`
- ประโยคตัวอย่าง 2 ประโยคแต่งใหม่ทั้งหมด (ตรงกับประโยคของ Wiktionary = ไม่ผ่าน)
- ต่อชุด: อ่าน `STYLE.md` + `batch-NNN.input.json` → เขียน `batch-NNN.output.json` → `validate-batch N` แก้จนผ่าน → บันทึก `work/progress.json` อัตโนมัติ
- **ต่องานเมื่อเซสชันถูกตัด:** อ่าน `progress.json` (หรือรัน `progress`) แล้วทำชุดถัดไป — ห้ามทำชุดที่เสร็จแล้วซ้ำ
- โฟลเดอร์ `work/` **commit ได้** (เป็นผลงานเขียนที่ผ่านตรวจแล้ว)

## ด่านตรวจ (`validate-batch` / `validate`)
**ต้องแก้ (errors):** JSON ไม่ตรง schema · `th` ว่าง/ไม่มีอักษรไทย/ซ้ำ/pos ไม่อยู่ในรายการ/`source` ผิด/`source: "wiktionary"` ที่ไม่มี `basedOn` หรือ `basedOn` ไม่อยู่ในตัวเลือกของ Wiktionary · `pos` ไม่สอดคล้องกับ Wiktionary · ประโยค ไม่ครบ 2, สั้นกว่า 4 คำ, ไม่มีคำนั้น/รูปผัน, ซ้ำกัน/ซ้ำกับคำอื่นหรือชุดอื่น, **ตรงกับประโยคของ Wiktionary** · `family` นอกคลัง · แท็กนอกรายการ · `cefr` ผิด
**เตือน (warnings):** ใช้ `source: "claude"` ทั้งที่ Wiktionary มีตัวเลือก · ประโยคยาวเกินที่แนะนำของระดับ (≤12 / ≤16 / ≤20 คำ) · วลีไม่มีคำนั้นเลย
- การจับ "รูปผัน" ใช้กฎปกติ + ตารางคำไม่ปกติใน `src/inflect.mjs`

## ขั้น 3: รายงานตรวจทาน + overrides + build
1. `report` → `cache/report.html` (เปิดในเบราว์เซอร์): **flag** คำที่ความหมายหลักมี source ไม่ใช่ wiktionary + คำที่ validate มีปัญหา/คำเตือน + สุ่ม 200 คำจากทุกระดับ (seed คงที่)
2. แก้ค่าในช่อง (pos, ความหมายไทย, ประโยค, วลี, ตระกูลคำเพิ่ม, แท็ก, CEFR) — ความหมายไทยที่แก้จะกลายเป็น `source: "manual"` → กด **บันทึก overrides.json** วางทับ `tools/build-vocab/overrides.json` (**commit ได้**)
3. `build` จะ **ไม่สร้าง** ถ้ามีคำที่ยังไม่ผ่าน validate (หลังรวม overrides) หรือยังไม่ได้เขียน · `--allow-incomplete` สร้างไฟล์ทดสอบ (`complete: false` — ห้าม deploy)
4. ต่อคำใน `/vocab`: `wordKey, word, rank, level, cefr, pos, ipa, defEn, th[{pos,text,source}], examples[{text,source}], collocations, family, synonyms, antonyms, tags, src{…}` — `src` บอกแหล่งของแต่ละฟิลด์ (wiktionary / claude / manual)
5. `index.json`: `schema`, `version` (`config.json` → `vocabVersion`), `contentHash`, `count`, `levels[]`, `tags`, `cefr`, `pos`, `sources`, `credits`, `license` — ไม่ใส่เวลาสร้าง build ซ้ำได้ไฟล์เดิมทุกไบต์ · เปลี่ยนเนื้อหาแล้วต้องเพิ่ม `vocabVersion`
6. แสดงขนาดไฟล์ (ดิบ/gzip) ต่อระดับ และเตือนถ้าไฟล์ใหญ่เกิน 400 KB

## เครดิต / สัญญาอนุญาต
- ไฟล์ `/vocab` เผยแพร่ภายใต้ **CC BY-SA 4.0** — เครดิตอยู่ใน `index.json` → `credits`: NGSL-GR 1.0 (CC BY-SA 4.0), Wiktionary (CC BY-SA) ผ่านข้อมูลสกัดของ kaikki.org (Wiktextract — Tatu Ylonen, LREC 2022), ข้อความที่ Claude Code เขียน · แอปต้องมีหน้าเครดิต (ส่วน B)
- `tests/fixtures/kaikki-sample.jsonl` เป็นตัวอย่างย่อจากข้อมูล Wiktionary จริง (CC BY-SA) ใช้ทดสอบเท่านั้น

## ทดสอบ
`npm test` ครอบคลุม: อ่าน CSV จริง/ระดับ, รูปผัน, การสกัดจากข้อมูล kaikki จริง (fixture) และการอ่านแบบ stream, ด่านตรวจทุกข้อ, build ที่ผลคงที่, การซ้อมสายงานทั้งชุดใน temp dir (ไม่แตะ cache/work/vocab จริง) และการตรวจว่าโค้ดเครื่องมือไม่มีโค้ดเครือข่าย
