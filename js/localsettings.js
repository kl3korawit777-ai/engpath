// ค่าตั้งต้นที่เก็บเฉพาะในเครื่องนี้ (localStorage) — ห้ามขึ้น Firestore / ห้ามอยู่ใน export
// ได้แก่ อีเมลสำหรับ MyMemory, Claude API key, ชื่อรุ่น Claude
import { DEFAULT_CLAUDE_MODEL } from "./lexicon.js";

const K = { email: "engpath.myMemoryEmail", apiKey: "engpath.claudeApiKey", model: "engpath.claudeModel" };

function read(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }
function write(k, v) {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); return true; } catch { return false; }
}

export function lexiconConfig() {
  return { email: read(K.email), apiKey: read(K.apiKey), model: read(K.model) || DEFAULT_CLAUDE_MODEL };
}

/** คืน false ถ้าเบราว์เซอร์บล็อกการเก็บข้อมูล (เช่น private mode) */
export function saveLexiconConfig({ email = "", apiKey = "", model = "" }) {
  const results = [write(K.email, email.trim()), write(K.apiKey, apiKey.trim()), write(K.model, model.trim())];
  return results.every(Boolean);
}
