// คลังคำศัพท์กลาง (อ่านอย่างเดียว) — โหลดจากไฟล์ static ใน /vocab: index.json + level-NN.json
// ไม่แตะ Firestore/DOM ทดสอบด้วย node ได้ (ส่ง fetchImpl เข้ามา) · ไฟล์คลังเป็น immutable: ห้ามเขียนทับ

// อ้างอิงจากตำแหน่งของโมดูลนี้ (js/vocab.js → ../vocab/) เพื่อให้ทำงานถูกต้องไม่ว่าหน้าจะอยู่ path ไหน
export const VOCAB_DIR = new URL("../vocab/", import.meta.url).href;
export const SCHEMA = 2;
export const TAGS = ["daily-life", "science", "health", "education", "work", "travel", "emotion", "society", "technology", "nature"];

/** wordKey ของคลัง = ตัวพิมพ์เล็ก ตัดช่องว่างหัวท้าย ช่องว่างซ้อนเหลือช่องเดียว (กฎเดียวกับ tools/build-vocab) */
export function wordKey(s) {
  return String(s ?? "").toLowerCase().replace(/\//g, " ").replace(/\s+/g, " ").trim();
}

export class VocabError extends Error {
  constructor(kind, detail = "") {
    super(`vocab:${kind}${detail ? `:${detail}` : ""}`);
    this.kind = kind;        // network | http | parse | schema
    this.detail = detail;
  }
}

/** ข้อความภาษาไทยที่บอกวิธีแก้ */
export function describeError(err) {
  switch (err?.kind) {
    case "network": return "โหลดคลังคำศัพท์ไม่ได้ — ตรวจอินเทอร์เน็ต (ถ้าเคยเปิดแอปตอนออนไลน์แล้ว คลังที่โหลดไว้จะใช้ออฟไลน์ได้)";
    case "http": return `ไม่พบไฟล์คลังคำศัพท์ (${err.detail}) — ลองรีเฟรชหน้า หรือรอให้แอปอัปเดตเสร็จ`;
    case "parse": return "ไฟล์คลังคำศัพท์อ่านไม่ได้ — ลองรีเฟรชหน้า ถ้ายังเป็นอีกให้ล้างแคชแล้วเปิดใหม่ตอนออนไลน์";
    case "schema": return "ไฟล์คลังคำศัพท์เป็นรุ่นที่แอปนี้ยังไม่รองรับ — รีเฟรชเพื่ออัปเดตแอป";
    default: return "เกิดข้อผิดพลาดกับคลังคำศัพท์ ลองรีเฟรชหน้า";
  }
}

/**
 * สร้างตัวโหลดคลัง (แยกสถานะต่อ instance เพื่อทดสอบง่าย) — แอปใช้ตัวเดียว (export ด้านล่าง)
 * baseUrl: โฟลเดอร์ของไฟล์คลัง · fetchImpl: ฟังก์ชัน fetch
 */
export function createVocab({ baseUrl = VOCAB_DIR, fetchImpl = (...a) => fetch(...a) } = {}) {
  let index = null;
  let indexP = null;
  const levels = new Map();        // level → { level, words }
  const levelP = new Map();        // level → Promise
  let byKey = null;                // wordKey → entry (สร้างเมื่อโหลดระดับ)
  const keyIndex = () => (byKey ||= new Map());

  async function getJson(file) {
    let res;
    try { res = await fetchImpl(`${baseUrl}${file}`); } catch { throw new VocabError("network", file); }
    if (!res.ok) throw new VocabError("http", `${file} ${res.status}`);
    try { return await res.json(); } catch { throw new VocabError("parse", file); }
  }

  function loadIndex() {
    if (index) return Promise.resolve(index);
    indexP ||= getJson("index.json").then((j) => {
      if (j?.schema !== SCHEMA || !Array.isArray(j.levels) || !j.levels.length) throw new VocabError("schema", String(j?.schema));
      index = j;
      return j;
    }).finally(() => { indexP = null; });
    return indexP;
  }

  async function loadLevel(n) {
    if (levels.has(n)) return levels.get(n);
    if (!levelP.has(n)) {
      levelP.set(n, (async () => {
        const idx = await loadIndex();
        const meta = idx.levels.find((l) => l.level === n);
        if (!meta) throw new VocabError("http", `level ${n}`);
        const j = await getJson(meta.file);
        if (!Array.isArray(j?.words)) throw new VocabError("parse", meta.file);
        const lv = { level: n, words: j.words };
        levels.set(n, lv);
        for (const w of j.words) keyIndex().set(w.wordKey, w);
        return lv;
      })().finally(() => levelP.delete(n)));
    }
    return levelP.get(n);
  }

  return {
    loadIndex,
    loadLevel,
    /** จำนวนระดับทั้งหมด */
    async levelCount() { return (await loadIndex()).levels.length; },
    /** คำทั้งหมดของระดับ เรียงตาม rank */
    async wordsOfLevel(n) { return (await loadLevel(n)).words; },
    /** ระดับของ rank (1..count) — null ถ้านอกช่วง */
    async levelOfRank(rank) {
      const m = (await loadIndex()).levels.find((l) => rank >= l.rankFrom && rank <= l.rankTo);
      return m ? m.level : null;
    },
    /** โหลดทุกระดับ (ใช้ค้นหาข้ามระดับ/กราฟ/Export) — ทยอยโหลดพร้อมกัน */
    async loadAll(onProgress) {
      const idx = await loadIndex();
      let done = 0;
      await Promise.all(idx.levels.map((l) => loadLevel(l.level).then(() => onProgress?.(++done, idx.levels.length))));
    },
    /** index.json ที่โหลดแล้ว (null ถ้ายังไม่โหลด) — ใช้อ่านแบบ synchronous หลัง loadAll() */
    cachedIndex() { return index; },
    /** wordKey ทั้งหมดของระดับที่โหลดแล้ว */
    keys() { return byKey ? [...byKey.keys()] : []; },
    /** หาคำด้วย wordKey จากระดับที่โหลดแล้วเท่านั้น (ไม่โหลดเพิ่ม) — null ถ้ายังไม่เจอ */
    peek(key) { return byKey?.get(wordKey(key)) || null; },
    /** หาคำด้วย wordKey; ถ้ายังไม่เจอในระดับที่โหลด จะโหลดระดับที่เหลือทีละระดับจนเจอ */
    async get(key) {
      const k = wordKey(key);
      if (!k) return null;
      const hit = keyIndex().get(k);
      if (hit) return hit;
      const idx = await loadIndex();
      for (const l of idx.levels) {
        if (levels.has(l.level)) continue;
        await loadLevel(l.level);
        const h2 = keyIndex().get(k);
        if (h2) return h2;
      }
      return null;
    },
    /**
     * ค้นคำจากระดับที่โหลด: { levels?: number[], tags?: string[] (มีแท็กใดแท็กหนึ่ง), cefr?: string[], pos?: string[], text?: string }
     * ผลเรียงตาม rank — โหลดเฉพาะระดับที่ขอ (ไม่ระบุ levels = โหลดทั้งหมด)
     */
    async query({ levels: lv, tags, cefr, pos, text } = {}) {
      const idx = await loadIndex();
      const want = lv?.length ? lv : idx.levels.map((l) => l.level);
      const loaded = await Promise.all(want.map((n) => loadLevel(n)));
      const q = text ? wordKey(text) : "";
      return loaded.flatMap((l) => l.words).filter((w) =>
        (!tags?.length || w.tags.some((t) => tags.includes(t))) &&
        (!cefr?.length || cefr.includes(w.cefr)) &&
        (!pos?.length || w.pos.some((p) => pos.includes(p))) &&
        (!q || w.wordKey.includes(q) || w.th.some((t) => t.text.includes(text)))
      ).sort((a, b) => a.rank - b.rank);
    },
    /** ข้อมูลเครดิต/สัญญาอนุญาตจาก index.json */
    async credits() {
      const i = await loadIndex();
      return { version: i.version, count: i.count, license: i.license, credits: i.credits, sources: i.sources || null };
    },
    /** ล้างสถานะในหน่วยความจำ (ทดสอบ/บังคับโหลดใหม่หลังอัปเดตแอป) */
    reset() { index = null; indexP = null; levels.clear(); levelP.clear(); byKey = null; },
  };
}

/** ตัวโหลดที่แอปใช้ร่วมกัน */
export const vocab = createVocab();
