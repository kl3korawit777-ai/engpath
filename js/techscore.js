// Technique Score: ใช้แต่ละเทคนิคกี่ครั้งใน 7 วันล่าสุด (นับจาก dailyStats ซึ่งคำนวณจาก events) + เทคนิคที่ใช้น้อยที่สุด + มินิชาเลนจ์
import { TECHNIQUES } from "./data/techniques.js";
import { TECHNIQUE_CONFIG } from "./data/technique-config.js";
import { rangeKeys } from "./dashboardlogic.js";
import { dayKey } from "./streak.js";

// ตัวนับต่อเทคนิคของ "วันเดียว" (เอกสาร dailyStats ที่อาจไม่มี)
const COUNT = {
  "01": (d) => d?.reviews || 0,
  "02": (d) => d?.recall || 0,
  "03": (d) => d?.readings || 0,
  "04": (d) => d?.newCards || 0,
  "05": (d) => d?.shadowRounds || 0,
  "06": (d) => d?.practice || 0,
  "07": (d) => d?.interleave || 0,
  "08": (d) => (d?.activity > 0 ? 1 : 0),
};

export const countFor = (id, d) => COUNT[id](d);

/** คะแนนของ 8 เทคนิคใน 7 วันล่าสุด: [{ id, name, count, target, score (0–100), available, href, ... }] */
export function techniqueScores({ map, now, techniques = TECHNIQUES, config = TECHNIQUE_CONFIG }) {
  const { keys } = rangeKeys("week", now);
  return techniques.map((t) => {
    const cfg = config[t.id];
    const count = keys.reduce((a, k) => a + COUNT[t.id](map.get(k)), 0);
    return {
      id: t.id, name: t.name, subtitle: t.subtitle, count, target: cfg.target, unit: cfg.unit, source: cfg.source,
      score: Math.min(100, Math.round((count / cfg.target) * 100)),
      available: t.feature.status === "available", href: t.feature.href || null, errorsTab: t.feature.errorsTab || null,
    };
  });
}

/** เทคนิคที่ใช้น้อยที่สุด (คะแนนต่ำสุด → จำนวนน้อยสุด → ลำดับเลข) เฉพาะที่มีฟีเจอร์ในแอปแล้ว; null ถ้าไม่มี */
export function leastUsed(scores) {
  const ok = scores.filter((s) => s.available);
  if (!ok.length) return null;
  return [...ok].sort((a, b) => a.score - b.score || a.count - b.count || (a.id < b.id ? -1 : 1))[0];
}

/** มินิชาเลนจ์วันนี้จากเทคนิคที่ใช้น้อยที่สุด: { id, name, text, goal, done, count, href, errorsTab } (null ถ้าไม่มีเทคนิคให้เลือก) */
export function miniChallenge({ map, now, config = TECHNIQUE_CONFIG, techniques = TECHNIQUES }) {
  const least = leastUsed(techniqueScores({ map, now, techniques, config }));
  if (!least) return null;
  const c = config[least.id].challenge;
  const count = countFor(least.id, map.get(dayKey(now)));
  return { id: least.id, name: least.name, text: c.text, goal: c.goal, count, done: count >= c.goal, href: least.href, errorsTab: least.errorsTab, weekScore: least.score };
}
