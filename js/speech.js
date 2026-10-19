// ตรวจคำที่พูด (เทียบกับประโยคในบทแบบ word-level ด้วย LCS) + ตัวช่วยอัดเสียง — pure ทดสอบด้วย node ได้

/** แยกเป็นคำ: ตัวพิมพ์เล็ก ตัดเครื่องหมาย (เก็บ ' ในคำเช่น don't) ขีดกลางถือเป็นช่องว่าง */
export function wordsOf(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/** LCS ของลำดับคำสองชุด คืน Set ของ index ฝั่ง a และ b ที่จับคู่กัน */
export function lcsMatches(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ia = new Set(), ib = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ia.add(i); ib.add(j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { a: ia, b: ib };
}

/**
 * เทียบประโยคเป้าหมายกับข้อความที่ได้ยิน
 *  tokens   = คำของประโยคเป้าหมายตามที่แสดง (คงเครื่องหมายไว้) ok = พูดครบทุกคำในโทเคนนั้น
 *  extra    = คำที่พูดเกินหรือไม่ตรงกับประโยค
 *  accuracy = สัดส่วนคำเป้าหมายที่จับคู่ได้ (0–1)
 */
export function compareWords(target, spoken) {
  const tokens = String(target ?? "").split(/\s+/).filter(Boolean).map((text) => ({ text, words: wordsOf(text) })).filter((t) => t.words.length);
  const flat = [], owner = [];
  tokens.forEach((t, ti) => t.words.forEach((w) => { flat.push(w); owner.push(ti); }));
  const said = wordsOf(spoken);
  const { a, b } = lcsMatches(flat, said);
  const matchedPerToken = tokens.map(() => 0);
  a.forEach((fi) => { matchedPerToken[owner[fi]]++; });
  return {
    tokens: tokens.map((t, i) => ({ text: t.text, ok: matchedPerToken[i] === t.words.length })),
    extra: said.filter((_, j) => !b.has(j)),
    matched: a.size,
    total: flat.length,
    accuracy: flat.length ? a.size / flat.length : 0,
    spokenText: said.join(" "),
  };
}

// ---------- อัดเสียง ----------
export const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];

/** เลือก mimeType ที่เครื่องรองรับ (iOS Safari ได้ audio/mp4) — ไม่มีที่ไหนรองรับคืน "" ให้เบราว์เซอร์เลือกเอง */
export function pickMimeType(isSupported, candidates = MIME_CANDIDATES) {
  return candidates.find((m) => { try { return isSupported(m); } catch { return false; } }) || "";
}

export function extensionFor(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4") || m.includes("aac")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("wav")) return "wav";
  return "audio";
}

export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(v < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** จาก navigator.storage.estimate() → { usage, quota, pct } */
export function quotaInfo(est) {
  const usage = Number(est?.usage) || 0, quota = Number(est?.quota) || 0;
  return { usage, quota, pct: quota ? (usage / quota) * 100 : null };
}

/** ข้อความภาษาไทยจากข้อผิดพลาดของ getUserMedia */
export function micErrorMessage(err) {
  const n = err?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError") return "ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน — เปิดสิทธิ์ไมโครโฟนให้เว็บนี้ในการตั้งค่าเบราว์เซอร์/ระบบ แล้วลองใหม่";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "ไม่พบไมโครโฟนในเครื่องนี้";
  if (n === "NotReadableError" || n === "AbortError") return "ไมโครโฟนถูกใช้งานโดยแอปอื่นอยู่ ปิดแอปนั้นแล้วลองใหม่";
  if (!window_isSecure()) return "ต้องเปิดเว็บผ่าน https (หรือ localhost) จึงจะอัดเสียงได้";
  return `เปิดไมโครโฟนไม่สำเร็จ (${n || "ไม่ทราบสาเหตุ"})`;
}
function window_isSecure() { return typeof isSecureContext === "undefined" ? true : isSecureContext; }

/** ข้อความภาษาไทยจาก event.error ของ SpeechRecognition */
export function speechErrorMessage(code) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed": return "ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน/บริการรู้จำเสียง — เปิดสิทธิ์ในการตั้งค่า (บน iPhone/iPad ต้องเปิด Siri และการสั่งงานด้วยเสียงด้วย)";
    case "no-speech": return "ไม่ได้ยินเสียงพูด ลองพูดใกล้ไมค์ขึ้นแล้วกดอีกครั้ง";
    case "audio-capture": return "ไม่พบไมโครโฟน";
    case "network": return "บริการรู้จำเสียงของเบราว์เซอร์ต้องต่อเน็ต — ต่อเน็ตแล้วลองใหม่";
    case "language-not-supported": return "เบราว์เซอร์นี้ไม่รองรับภาษาอังกฤษ (en-US) สำหรับรู้จำเสียง";
    case "aborted": return "";
    default: return `รู้จำเสียงไม่สำเร็จ (${code || "ไม่ทราบสาเหตุ"})`;
  }
}
