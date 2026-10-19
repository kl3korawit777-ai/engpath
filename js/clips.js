// คลังคลิป Shadowing แบบ pure: ตรวจ URL, เวลา, แบ่งประโยค, ผูกเวลาให้ประโยค, ตัดสินใจเรื่องช่วงเล่น/วน, ตัวกรองคลัง
// ห้ามดาวน์โหลด/ดึงไฟล์จาก YouTube — ไฟล์นี้แค่แยกวิเคราะห์ URL (ตัวเล่นอยู่ใน player.js ผ่าน YouTube IFrame Player API)

export const LEVEL_OPTIONS = ["A1", "A2", "B1", "B2", "C1"];
export const ACCENTS = { us: "อเมริกัน", uk: "อังกฤษ", au: "ออสเตรเลีย", other: "อื่น ๆ" };
export const AUDIO_EXT = ["mp3", "m4a", "wav", "ogg"];
export const VIDEO_EXT = ["mp4", "webm"];

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be"]);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const fail = (error) => ({ ok: false, error });

// ---------- เวลา ----------
/** "90", "90s", "1m30s", "1h2m3s", "1:30", "1:02:03" → วินาที หรือ null */
export function parseTime(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  let m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/.exec(s);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  m = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return null;
}

/** วินาที → "m:ss" (หรือ "h:mm:ss") */
export function formatTime(sec) {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** ช่องกรอก "นาที:วินาที" ของผู้ใช้ ("" = ไม่ระบุ → null) ผิดรูป → undefined */
export function parseClockInput(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const t = parseTime(s);
  return t === null ? undefined : t;
}

// ---------- URL ----------
/**
 * คืน { ok:true, type:"youtube", videoId, url, start } | { ok:true, type:"file", kind:"audio"|"video", url, start } | { ok:false, error }
 * YouTube: watch, youtu.be, shorts, embed, live (อ่าน t= / start= ทั้งใน query และ #t=) · ไฟล์ตรง: .mp3 .m4a .wav .ogg .mp4 .webm
 */
export function parseClipUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return fail("วางลิงก์คลิปก่อน");
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); } catch { return fail("ลิงก์ไม่ถูกต้อง"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") return fail("รองรับเฉพาะลิงก์ที่ขึ้นต้นด้วย http หรือ https");
  const host = u.hostname.toLowerCase();

  if (YT_HOSTS.has(host)) {
    const parts = u.pathname.split("/").filter(Boolean);
    let id = null;
    if (host === "youtu.be") id = parts[0];
    else if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0])) id = parts[1];
    if (!id || !YT_ID.test(id)) return fail("ลิงก์ YouTube นี้ไม่ใช่คลิปเดี่ยว (เช่น เพลย์ลิสต์ ช่อง หรือหน้าค้นหา) — วางลิงก์ของคลิปที่ต้องการ");
    const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
    const start = parseTime(u.searchParams.get("t") ?? u.searchParams.get("start") ?? hash.get("t") ?? hash.get("start"));
    return { ok: true, type: "youtube", videoId: id, url: `https://www.youtube.com/watch?v=${id}`, start: start ?? 0 };
  }

  const ext = (u.pathname.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  if (AUDIO_EXT.includes(ext) || VIDEO_EXT.includes(ext)) {
    const hashT = parseTime(new URLSearchParams(u.hash.replace(/^#/, "")).get("t"));
    return { ok: true, type: "file", kind: AUDIO_EXT.includes(ext) ? "audio" : "video", url: u.href.replace(/#.*$/, ""), start: hashT ?? 0 };
  }
  return fail(`ไม่รู้จักลิงก์นี้ — รองรับลิงก์ YouTube หรือไฟล์ตรง (${[...AUDIO_EXT, ...VIDEO_EXT].map((e) => `.${e}`).join(" ")})`);
}

export const youtubeThumb = (videoId) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

// ---------- แบ่งประโยค ----------
const ABBR = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "u.s", "u.k", "no", "fig", "inc", "ltd", "co", "mt", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);

function isBoundary(before, punct, next) {
  if (/[!?]/.test(punct)) return true;
  const word = (before.match(/([A-Za-z][A-Za-z.]*)$/)?.[1] || "").toLowerCase().replace(/\.$/, "");
  if (ABBR.has(word)) return false;
  if (/(^|\s)[A-Z]$/.test(before)) return false;                                                            // ตัวย่อชื่อ เช่น "J. Smith"
  if (next && /[a-z]/.test(next)) return false;                                                           // ตัวเล็กตามหลัง = ยังไม่จบประโยค
  return true;
}

/**
 * แบ่งบทเป็นประโยค: ย่อหน้า (บรรทัดว่าง) เป็นขอบเขต; บรรทัดที่ไม่ลงท้ายด้วยเครื่องหมายจบประโยคจะต่อกับบรรทัดถัดไป
 * ไม่ตัดที่คำย่อ (Mr. Dr. e.g.) ทศนิยม หรือจุดที่ตามด้วยตัวพิมพ์เล็ก
 */
export function splitSentences(text) {
  const out = [];
  for (const para of String(text ?? "").split(/\n\s*\n/)) {
    const flat = para.replace(/([^.!?…"”’')\]\s])[ \t]*\r?\n[ \t]*/g, "$1 ").replace(/\s+/g, " ").trim();
    if (!flat) continue;
    let last = 0;
    for (const m of flat.matchAll(/[.!?…]+["'”’)\]]*(?=\s|$)/g)) {
      const end = m.index + m[0].length;
      const next = flat.slice(end).match(/^\s*(\S)/)?.[1];
      if (isBoundary(flat.slice(last, m.index), m[0], next)) { out.push(flat.slice(last, end).trim()); last = end; }
    }
    if (flat.slice(last).trim()) out.push(flat.slice(last).trim());
  }
  return out;
}

/** แบ่งบทใหม่แล้วคงเวลา (t) ของประโยคที่ข้อความเหมือนเดิมไว้ */
export function mergeSentences(oldSentences, texts) {
  const pool = new Map();
  for (const s of oldSentences || []) if (s.t != null) (pool.get(s.text) || pool.set(s.text, []).get(s.text)).push(s.t);
  return texts.map((text) => ({ text, t: pool.get(text)?.shift() ?? null }));
}

export const sentencesToText = (sentences) => (sentences || []).map((s) => s.text).join("\n");

// ---------- ผูกเวลาประโยค / ช่วงเล่น ----------
export function setSentenceTime(sentences, index, t) {
  return sentences.map((s, i) => (i === index ? { ...s, t: t == null ? null : Math.max(0, Math.round(t * 10) / 10) } : s));
}

/** ประโยคที่กำลังเล่นอยู่ = ประโยคสุดท้ายที่ t ≤ เวลาปัจจุบัน (ไม่มี = -1) */
export function activeSentence(sentences, time) {
  let idx = -1, best = -Infinity;
  sentences.forEach((s, i) => { if (s.t != null && s.t <= time + 1e-6 && s.t >= best) { idx = i; best = s.t; } });
  return idx;
}

/** ช่วงของประโยค: เริ่มที่ t ของมัน จบที่ t ถัดไปที่มากกว่า (หรือท้ายคลิป) — ยังไม่ผูกเวลา = null */
export function sentenceRange(sentences, index, clipEnd = null) {
  const s = sentences[index];
  if (!s || s.t == null) return null;
  const next = sentences.filter((x) => x.t != null && x.t > s.t).map((x) => x.t).sort((a, b) => a - b)[0];
  return { start: s.t, end: next ?? clipEnd ?? null };
}

/**
 * ตัดสินใจตามเวลาเล่นปัจจุบัน (เรียกถี่ ๆ) — ลำดับ: วนประโยค → วน A–B → ช่วงที่ตั้ง (เล่นเฉพาะช่วง)
 *   คืน { seekTo?: number, pause?: true } หรือ {} ถ้าไม่ต้องทำอะไร
 * state: { rangeStart, rangeEnd (null = ท้ายคลิป), loopA, loopB, loopOn, sentence: {start,end}|null }
 */
export function tickDecision(t, st, eps = 0.05) {
  if (st.sentence && st.sentence.end != null) {
    if (t >= st.sentence.end - eps || t < st.sentence.start - 0.5) return { seekTo: st.sentence.start };
    return {};
  }
  if (st.loopOn && st.loopA != null && st.loopB != null && st.loopB > st.loopA) {
    if (t >= st.loopB - eps || t < st.loopA - 0.5) return { seekTo: st.loopA };
    return {};
  }
  if (st.rangeEnd != null && t >= st.rangeEnd - eps) return { seekTo: st.rangeStart ?? 0, pause: true };
  if (st.rangeStart != null && t < st.rangeStart - 0.5) return { seekTo: st.rangeStart };
  return {};
}

// ---------- ตรวจข้อมูลคลิป ----------
/** คืนข้อความผิดพลาด หรือ null */
export function validateClip(c) {
  if (!String(c.title || "").trim()) return "ตั้งชื่อคลิป";
  if (String(c.title).length > 120) return "ชื่อคลิปยาวเกิน 120 ตัวอักษร";
  if (c.start === undefined || c.end === undefined) return "เวลาเริ่ม/จบต้องเป็นรูปแบบ นาที:วินาที (เช่น 1:30)";
  if (c.start != null && c.start < 0) return "เวลาเริ่มต้องไม่ติดลบ";
  if (c.start != null && c.end != null && c.end <= c.start) return "เวลาจบต้องมากกว่าเวลาเริ่ม";
  if (c.level && !LEVEL_OPTIONS.includes(c.level)) return "ระดับไม่ถูกต้อง";
  if (c.accent && !ACCENTS[c.accent]) return "สำเนียงไม่ถูกต้อง";
  if ((c.sentences || []).length > 2000) return "บทยาวเกิน 2,000 ประโยค";
  return null;
}

// ---------- คลัง ----------
/** จำนวนรอบที่ฝึกต่อคลิป (จาก shadowingEvents kind="round") */
export function roundCounts(events) {
  const m = new Map();
  for (const e of events) if (e.kind === "round") m.set(e.clipId, (m.get(e.clipId) || 0) + 1);
  return m;
}

/** criteria: { q, level, accent, topic, unpracticed, playlist } — ทุกเงื่อนไข AND */
export function filterClips(clips, criteria, { rounds = new Map(), playlists = [] } = {}) {
  const c = criteria || {};
  const q = (c.q || "").toLowerCase().trim();
  const inList = c.playlist ? new Set(playlists.find((p) => p.id === c.playlist)?.clipIds || []) : null;
  return clips.filter((clip) => {
    if (q && ![clip.title, clip.topic, ...(clip.sentences || []).map((s) => s.text)].join(" ").toLowerCase().includes(q)) return false;
    if (c.level && clip.level !== c.level) return false;
    if (c.accent && clip.accent !== c.accent) return false;
    if (c.topic && (clip.topic || "").toLowerCase() !== c.topic.toLowerCase()) return false;
    if (c.unpracticed && (rounds.get(clip.id) || 0) > 0) return false;
    if (inList && !inList.has(clip.id)) return false;
    return true;
  });
}

export const distinctTopics = (clips) => [...new Set(clips.map((c) => (c.topic || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
