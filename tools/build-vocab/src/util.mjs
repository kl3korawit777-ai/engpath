// เครื่องมือกลางของ build-vocab: path, อ่าน/เขียน JSON, cache
// รันในเครื่องผู้ดูแลเท่านั้น — ห้าม deploy ห้ามเรียกจากแอป และ "ไม่เรียก API ภายนอกใด ๆ" (ไม่มีโค้ดเครือข่ายในเครื่องมือนี้)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");           // tools/build-vocab
export const REPO = join(ROOT, "..", "..");
export const CACHE = process.env.VOCAB_CACHE_DIR || join(ROOT, "cache");            // ตัวแปร VOCAB_* ใช้ในการทดสอบเท่านั้น
export const WORK = process.env.VOCAB_WORK_DIR || join(ROOT, "work");
export const VOCAB_DIR = process.env.VOCAB_OUT_DIR || join(REPO, "vocab");
export const OVERRIDES_FILE = process.env.VOCAB_OVERRIDES || join(ROOT, "overrides.json");
export const config = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));

export const pad = (n, w = 4) => String(n).padStart(w, "0");

export function readJson(path, fallback = undefined) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
}

/** เขียนแบบ atomic (เขียนไฟล์ชั่วคราวแล้ว rename) กันไฟล์เสียเมื่อโปรแกรมถูกหยุดกลางคัน */
export function writeJson(path, data, pretty = true) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : 0) + "\n", "utf8");
  renameSync(tmp, path);
}

export const cachePath = (...p) => join(CACHE, ...p);
export const workPath = (...p) => join(WORK, ...p);
export const has = (path) => existsSync(path);
export const listFiles = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

export const sha256 = async (text) => (await import("node:crypto")).createHash("sha256").update(text).digest("hex");

export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out.flags[k] = v === undefined ? true : v;
    } else out._.push(a);
  }
  return out;
}
