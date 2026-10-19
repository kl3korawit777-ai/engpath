// คลังคำศัพท์: wordKey, ตัวเรียก API (Free Dictionary / Datamuse / MyMemory / Claude), การรวมผล
// ไฟล์นี้ไม่แตะ Firestore และไม่อ้างอิง DOM — ทดสอบด้วย node ได้ (ส่ง fetchImpl เข้ามา)

export const API_TIMEOUT_MS = 8000;
export const WORD_MAX = 80;
export const API_LABELS = { dictionary: "Free Dictionary", datamuse: "Datamuse", mymemory: "MyMemory", ai: "Claude" };

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
    this.kind = kind;       // timeout | network | http | parse | quota | auth | empty
    this.status = status;
    this.detail = detail;
  }
}

/** ข้อความภาษาไทยที่บอกวิธีแก้ */
export function describeError(err) {
  const name = API_LABELS[err?.api] || "บริการภายนอก";
  if (!(err instanceof ApiError)) return `${name}: เกิดข้อผิดพลาดที่ไม่คาดคิด ลองกด “แปลใหม่” อีกครั้ง`;
  switch (err.kind) {
    case "timeout":
      return `${name}: ไม่ตอบกลับภายใน ${API_TIMEOUT_MS / 1000} วินาที — บริการอาจล่มชั่วคราว ลองกด “แปลใหม่” ภายหลัง (ส่วนอื่นยังใช้ได้)`;
    case "network":
      return `${name}: เชื่อมต่อไม่ได้ — ตรวจอินเทอร์เน็ต หรือบริการอาจถูกบล็อกในเครือข่ายนี้`;
    case "quota":
      return `${name}: โควตาฟรีวันนี้หมดแล้ว — ตั้งอีเมลในหน้า “ตั้งค่า” เพื่อเพิ่มโควตา หรือรอพรุ่งนี้`;
    case "auth":
      return `${name}: API key ไม่ถูกต้องหรือหมดอายุ — ตรวจและวางคีย์ใหม่ในหน้า “ตั้งค่า”`;
    case "parse":
      return `${name}: ได้ข้อมูลในรูปแบบที่อ่านไม่ได้ — ลองกด “แปลใหม่” หรือรายงานผู้พัฒนาถ้าเกิดซ้ำ`;
    case "empty":
      return `${name}: ไม่ได้ผลลัพธ์ที่ใช้ได้ — ลองให้ AI ช่วยใหม่ หรือกรอกเอง`;
    case "http":
      if (err.status === 429) return `${name}: ถูกจำกัดจำนวนครั้ง (429) — รอสักครู่แล้วลองใหม่${err.api === "ai" ? " หรือตรวจโควตาบัญชี" : ""}`;
      if (err.status === 400) return `${name}: คำขอไม่ถูกต้อง (400)${err.api === "ai" ? " — ตรวจชื่อรุ่นในหน้า “ตั้งค่า”" : ""}${err.detail ? `: ${err.detail}` : ""}`;
      if (err.status === 401 || err.status === 403) return `${name}: ไม่ได้รับอนุญาต (${err.status})${err.api === "ai" ? " — ตรวจ API key ในหน้า “ตั้งค่า”" : ""}`;
      if (err.status === 404 && err.api === "ai") return `${name}: ไม่พบรุ่นที่ตั้งไว้ — ตรวจชื่อรุ่นในหน้า “ตั้งค่า”`;
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

const enc = encodeURIComponent;
const uniq = (a) => [...new Set(a)];

// ---------- Free Dictionary ----------
/** คืน null ถ้าไม่พบคำ (404) */
export async function fetchDictionary(word, opts) {
  let entries;
  try {
    entries = await getJson("dictionary", `https://api.dictionaryapi.dev/api/v2/entries/en/${enc(word)}`, opts);
  } catch (e) {
    if (e instanceof ApiError && e.kind === "http" && e.status === 404) return null;
    throw e;
  }
  if (!Array.isArray(entries)) throw new ApiError("dictionary", "parse");
  let ipa = "", audioUrl = "";
  const byPos = new Map();
  const examples = [];
  for (const en of entries) {
    ipa ||= en.phonetic || (en.phonetics || []).find((p) => p.text)?.text || "";
    audioUrl ||= (en.phonetics || []).find((p) => p.audio)?.audio || "";
    for (const m of en.meanings || []) {
      const defs = (m.definitions || []).slice(0, 3).map((d) => ({ en: d.definition || "", ...(d.example ? { example: d.example } : {}) }));
      byPos.set(m.partOfSpeech, [...(byPos.get(m.partOfSpeech) || []), ...defs]);
      for (const d of m.definitions || []) if (d.example) examples.push(d.example);
    }
  }
  if (audioUrl.startsWith("//")) audioUrl = `https:${audioUrl}`;
  return {
    ipa, audioUrl,
    meanings: [...byPos].map(([pos, definitions]) => ({ pos, definitions })),
    examples: uniq(examples).slice(0, 6),
  };
}

// ---------- Datamuse ----------
const DM_POS = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };
export async function fetchDatamuse(word, opts) {
  const base = "https://api.datamuse.com/words";
  const rel = (code) => getJson("datamuse", `${base}?${code}=${enc(word)}&max=10`, opts).then((r) => r.map((x) => x.word));
  const [meta, syn, ant, trg, jjb] = await Promise.allSettled([
    getJson("datamuse", `${base}?sp=${enc(word)}&md=pf&max=1`, opts),
    rel("rel_syn"), rel("rel_ant"), rel("rel_trg"), rel("rel_jjb"),
  ]);
  const all = [meta, syn, ant, trg, jjb];
  if (all.every((r) => r.status === "rejected")) throw meta.reason;
  const first = meta.status === "fulfilled" ? meta.value.find((x) => x.word?.toLowerCase() === word) : null;
  const tags = first?.tags || [];
  const f = tags.find((t) => t.startsWith("f:"));
  const val = (r) => (r.status === "fulfilled" ? r.value : []);
  return {
    freq: f ? Number(f.slice(2)) : null,
    posTags: uniq(tags.filter((t) => DM_POS[t]).map((t) => DM_POS[t])),
    related: { syn: val(syn), ant: val(ant), trg: val(trg), jjb: val(jjb) },
  };
}

// ---------- MyMemory ----------
export async function fetchMyMemory(word, { email = "", ...opts } = {}) {
  const url = `https://api.mymemory.translated.net/get?q=${enc(word)}&langpair=${enc("en|th")}${email ? `&de=${enc(email)}` : ""}`;
  const j = await getJson("mymemory", url, opts);
  if (j?.quotaFinished) throw new ApiError("mymemory", "quota");
  const status = Number(j?.responseStatus ?? 200);
  if (status !== 200) throw new ApiError("mymemory", status === 429 ? "quota" : "http", { status });
  const text = String(j?.responseData?.translatedText || "").trim();
  if (!text || wordKey(text) === wordKey(word)) return { th: [] };     // ไม่ได้แปล (ส่งคำเดิมกลับมา)
  const alts = (j.matches || []).map((m) => String(m.translation || "").trim()).filter((t) => t && t !== text && wordKey(t) !== wordKey(word));
  return { th: [{ sense: "", text }, ...uniq(alts).slice(0, 2).map((t) => ({ sense: "ทางเลือก", text: t }))] };
}

// ---------- Claude API (ไม่บังคับ) ----------
export const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

export function wordCount(s) {
  return (String(s).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
}

export function aiPrompt(word) {
  return [
    `You are helping a Thai learner of English. For the English word or phrase "${word}", reply with ONLY one JSON object (no markdown, no commentary) in this exact shape:`,
    `{"th":[{"sense":"short Thai gloss of the meaning","text":"Thai translation"}],"examples":["English sentence"],"tags":["topic-tag"]}`,
    `Rules:`,
    `- "th": 1 to 3 items, one per distinct common meaning, written in Thai.`,
    `- "examples": 1 or 2 natural English sentences that really use the exact phrase "${word}" (a regular inflection is fine), each at least 5 words long.`,
    `- "tags": 1 to 3 lowercase English topic tags. Use "/" for sub-topics (e.g. "science/biology"); use "daily-life" for everyday words.`,
  ].join("\n");
}

/** ตรวจและล้างผลที่ AI ส่งมา */
export function parseAiReply(text, word) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new ApiError("ai", "parse");
  let j;
  try { j = JSON.parse(text.slice(a, b + 1)); } catch { throw new ApiError("ai", "parse"); }
  const th = (Array.isArray(j.th) ? j.th : [])
    .map((x) => ({ sense: String(x?.sense || "").trim().slice(0, 80), text: String(x?.text || "").trim().slice(0, 200) }))
    .filter((x) => x.text).slice(0, 3);
  const w = wordKey(word);
  const examples = (Array.isArray(j.examples) ? j.examples : []).map((s) => String(s).trim())
    .filter((s) => wordCount(s) >= 4 && s.toLowerCase().includes(w.split(" ")[0])).slice(0, 2);
  const tags = (Array.isArray(j.tags) ? j.tags : []).map((t) => String(t).trim().toLowerCase())
    .filter((t) => /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(t)).slice(0, 3);
  if (!th.length && !examples.length) throw new ApiError("ai", "empty");
  return { th, examples, tags };
}

/** เรียก Claude Messages API ด้วย prompt เดียว คืนข้อความ (เฉพาะ text block) — ใช้ร่วมกันระหว่างคำศัพท์และแบบฝึกเจาะจุด */
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

export async function fetchAi(word, opts = {}) {
  return parseAiReply(await claudeText(aiPrompt(word), opts), word);
}

// ---------- ดึงทั้งหมดพร้อมกัน ----------
/**
 * เรียก dictionary + datamuse + mymemory พร้อมกัน (+ ai ถ้า withAi)
 * คืน { dictionary, datamuse, mymemory, ai? } แต่ละตัวเป็น { ok:true, data } | { ok:false, error:"ข้อความไทย" }
 */
export async function fetchAll(word, { email = "", withAi = false, apiKey = "", model, fetchImpl, timeout } = {}) {
  const o = { fetchImpl, timeout };
  const jobs = {
    dictionary: fetchDictionary(word, o),
    datamuse: fetchDatamuse(word, o),
    mymemory: fetchMyMemory(word, { ...o, email }),
  };
  if (withAi) jobs.ai = fetchAi(word, { ...o, apiKey, model, timeout: undefined });
  const keys = Object.keys(jobs);
  const settled = await Promise.allSettled(keys.map((k) => jobs[k]));
  return Object.fromEntries(keys.map((k, i) => [k, settled[i].status === "fulfilled"
    ? { ok: true, data: settled[i].value }
    : { ok: false, error: describeError(settled[i].reason) }]));
}

// ---------- รวมผล ----------
const POS_NORMAL = { noun: "noun", verb: "verb", adjective: "adjective", adverb: "adverb" };

/** ชนิดคำที่แนะนำ: จาก Datamuse ก่อน แล้วจากพจนานุกรม; วลีที่ไม่มีข้อมูลเป็น "phrase" */
export function suggestPos(doc) {
  const p = doc.posTags?.[0] || POS_NORMAL[doc.meanings?.[0]?.pos] || doc.meanings?.[0]?.pos;
  if (p) return p;
  return /\s/.test(doc.word || "") ? "phrase" : "";
}

/** ข้อความคำแปลสำหรับช่องในฟอร์ม */
export function thDisplay(th) {
  return (th || []).map((t) => t.text).join(" / ");
}

/**
 * existing: เอกสารเดิมหรือ null; results: ผลจาก fetchAll (บางตัวอาจไม่มี)
 * กฎ: userEdited → ไม่ทับ th/thSource · แหล่งที่ล้มเหลว → คงข้อมูลเดิม · คำแปลจาก AI ไม่ถูก MyMemory ทับ
 * คืนฟิลด์ของ lexicon (ยังไม่รวม id/createdAt/updatedAt/deleted)
 */
export function mergeLexicon(existing, results, { word, now }) {
  const doc = {
    word: existing?.word || word,
    meanings: existing?.meanings || [],
    ipa: existing?.ipa || "",
    audioUrl: existing?.audioUrl || "",
    examples: existing?.examples || [],
    th: existing?.th || [],
    thSource: existing?.thSource || "",
    freq: existing?.freq ?? null,
    posTags: existing?.posTags || [],
    related: existing?.related || { syn: [], ant: [], trg: [], jjb: [] },
    suggestedTags: existing?.suggestedTags || [],
    sources: { ...(existing?.sources || {}) },
    userEdited: Boolean(existing?.userEdited),
    fetchedAt: existing?.fetchedAt || 0,
  };
  let anyOk = false;
  const mark = (api, r, note) => {
    doc.sources[api] = r.ok ? { ok: true, at: now, ...(note ? { note } : {}) } : { ok: false, at: now, error: r.error };
    if (r.ok) anyOk = true;
  };

  const d = results.dictionary;
  if (d) {
    mark("dictionary", d, d.ok && d.data === null ? "notFound" : "");
    if (d.ok && d.data) {
      doc.ipa = d.data.ipa || doc.ipa;
      doc.audioUrl = d.data.audioUrl || doc.audioUrl;
      doc.meanings = d.data.meanings.length ? d.data.meanings : doc.meanings;
      doc.examples = uniq([...d.data.examples, ...doc.examples]).slice(0, 8);
    }
  }
  const m = results.datamuse;
  if (m) {
    mark("datamuse", m);
    if (m.ok) {
      doc.freq = m.data.freq ?? doc.freq;
      doc.posTags = m.data.posTags.length ? m.data.posTags : doc.posTags;
      doc.related = m.data.related;
    }
  }
  const t = results.mymemory;
  if (t) {
    mark("mymemory", t, t.ok && !t.data.th.length ? "noTranslation" : "");
    if (t.ok && t.data.th.length && !doc.userEdited && doc.thSource !== "ai") {
      doc.th = t.data.th;
      doc.thSource = "mymemory";
    }
  }
  const a = results.ai;
  if (a) {
    mark("ai", a);
    if (a.ok) {
      if (!doc.userEdited && a.data.th.length) { doc.th = a.data.th; doc.thSource = "ai"; }
      doc.examples = uniq([...a.data.examples, ...doc.examples]).slice(0, 8);
      doc.suggestedTags = a.data.tags.length ? a.data.tags : doc.suggestedTags;
    }
  }
  if (anyOk) doc.fetchedAt = now;
  return doc;
}
