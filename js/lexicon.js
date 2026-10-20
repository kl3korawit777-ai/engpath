// ตัวช่วยเกี่ยวกับคำ/ข้อความ และตัวเรียก Claude API (ไม่บังคับ — ใช้กับ Journal ตรวจด้วย AI และแบบฝึกเจาะจุดเท่านั้น)
// ข้อมูลคำศัพท์ (ความหมาย คำแปล ตัวอย่าง) มาจากคลังกลางใน /vocab (js/vocab.js) ไม่เรียก API ภายนอกอีกแล้ว
// ไฟล์นี้ไม่แตะ Firestore และไม่อ้างอิง DOM — ทดสอบด้วย node ได้ (ส่ง fetchImpl เข้ามา)

export const API_TIMEOUT_MS = 8000;
export const WORD_MAX = 80;
export const API_LABELS = { ai: "Claude" };

// ---------- wordKey ----------
/** ตัวพิมพ์เล็ก ตัดช่องว่างหัวท้าย ช่องว่างซ้อนเหลือช่องเดียว (+ "/" → ช่องว่าง เพราะ Firestore ใช้ "/" ใน doc id ไม่ได้) */
export function wordKey(s) {
  return String(s ?? "").toLowerCase().replace(/\//g, " ").replace(/\s+/g, " ").trim();
}

/** คำ/วลีที่รับ: ขึ้นต้นด้วยตัวอักษรหรือตัวเลข ใช้ตัวอักษร ช่องว่าง ' ’ . - ได้ ยาวไม่เกิน WORD_MAX */
export function isValidWord(s) {
  const k = wordKey(s);
  return k.length > 0 && k.length <= WORD_MAX && /^[\p{L}\p{N}][\p{L}\p{N} '’.\-]*$/u.test(k);
}

// ---------- error ----------
export class ApiError extends Error {
  constructor(api, kind, { status = null, detail = "" } = {}) {
    super(`${api}:${kind}${status ? `:${status}` : ""}`);
    this.api = api;
    this.kind = kind;       // timeout | network | http | parse | auth | empty
    this.status = status;
    this.detail = detail;
  }
}

/** ข้อความภาษาไทยที่บอกวิธีแก้ */
export function describeError(err) {
  const name = API_LABELS[err?.api] || "บริการภายนอก";
  if (!(err instanceof ApiError)) return `${name}: เกิดข้อผิดพลาดที่ไม่คาดคิด ลองอีกครั้ง`;
  switch (err.kind) {
    case "timeout":
      return `${name}: ไม่ตอบกลับภายในเวลาที่กำหนด — บริการอาจล่มชั่วคราว ลองใหม่ภายหลัง (ส่วนอื่นยังใช้ได้)`;
    case "network":
      return `${name}: เชื่อมต่อไม่ได้ — ตรวจอินเทอร์เน็ต หรือบริการอาจถูกบล็อกในเครือข่ายนี้`;
    case "auth":
      return `${name}: API key ไม่ถูกต้องหรือหมดอายุ — ตรวจและวางคีย์ใหม่ในหน้า “ตั้งค่า”`;
    case "parse":
      return `${name}: ได้ข้อมูลในรูปแบบที่อ่านไม่ได้ — ลองอีกครั้ง หรือรายงานผู้พัฒนาถ้าเกิดซ้ำ`;
    case "empty":
      return `${name}: ไม่ได้ผลลัพธ์ที่ใช้ได้ — ลองใหม่อีกครั้ง`;
    case "http":
      if (err.status === 429) return `${name}: ถูกจำกัดจำนวนครั้ง (429) — รอสักครู่แล้วลองใหม่ หรือตรวจโควตาบัญชี`;
      if (err.status === 400) return `${name}: คำขอไม่ถูกต้อง (400) — ตรวจชื่อรุ่นในหน้า “ตั้งค่า”${err.detail ? `: ${err.detail}` : ""}`;
      if (err.status === 401 || err.status === 403) return `${name}: ไม่ได้รับอนุญาต (${err.status}) — ตรวจ API key ในหน้า “ตั้งค่า”`;
      if (err.status === 404) return `${name}: ไม่พบรุ่นที่ตั้งไว้ — ตรวจชื่อรุ่นในหน้า “ตั้งค่า”`;
      if (err.status >= 500) return `${name}: เซิร์ฟเวอร์ขัดข้อง (${err.status}) — ลองใหม่ภายหลัง`;
      return `${name}: ตอบกลับผิดพลาด (${err.status})`;
    default:
      return `${name}: ผิดพลาด (${err.kind})`;
  }
}

// ---------- HTTP ----------
export async function getJson(api, url, { fetchImpl = fetch, timeout = API_TIMEOUT_MS, init = {} } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: ac.signal });
    } catch {
      throw new ApiError(api, ac.signal.aborted ? "timeout" : "network");
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.error?.message || ""; } catch { /* ไม่มี body */ }
      throw new ApiError(api, "http", { status: res.status, detail });
    }
    try {
      return await res.json();
    } catch {
      throw new ApiError(api, ac.signal.aborted ? "timeout" : "parse");
    }
  } finally {
    clearTimeout(timer);
  }
}

export function wordCount(s) {
  return (String(s).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
}

// ---------- Claude API (ไม่บังคับ) ----------
export const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

/** เรียก Claude Messages API ด้วย prompt เดียว คืนข้อความ (เฉพาะ text block) — ใช้กับ Journal ตรวจด้วย AI และแบบฝึกเจาะจุด */
export async function claudeText(prompt, { apiKey, model = DEFAULT_CLAUDE_MODEL, ...opts } = {}) {
  if (!apiKey) throw new ApiError("ai", "auth");
  const body = { model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] };
  const j = await getJson("ai", CLAUDE_URL, {
    ...opts,
    timeout: opts.timeout ?? 30000,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",   // จำเป็นสำหรับเรียกจากเบราว์เซอร์ (ยืนยันจากการทดสอบจริง)
      },
      body: JSON.stringify(body),
    },
  }).catch((e) => {
    if (e instanceof ApiError && e.kind === "http" && e.status === 401) throw new ApiError("ai", "auth", { status: 401 });
    throw e;
  });
  return (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

/** ข้อความคำแปลสำหรับช่องแสดงผล (ใช้กับ Export Obsidian) */
export function thDisplay(th) {
  return (th || []).map((t) => t.text).join(" / ");
}
