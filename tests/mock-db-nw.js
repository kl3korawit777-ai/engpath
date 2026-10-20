// mock db สำหรับทดสอบหน้าคำใหม่/ตั้งค่าชุดคำในเบราว์เซอร์: ต่อยอด mock-db.js ให้มี getRaw / skippedKeys และกรองบัตร known
import * as base from "/tests/mock-db.js";
import { hydrateCard } from "/js/cardview.js";
export * from "/tests/mock-db.js";
const raw = (id) => base.all("cards").find((c) => c.id === id) || null;
export const getRaw = raw;
export const list = (c) => (c === "cards" ? base.all("cards").filter((d) => !d.deleted && d.status !== "known").map(hydrateCard) : base.list(c));
export const skippedKeys = () => new Set(base.all("cards").filter((d) => !d.deleted && d.status === "known").map((d) => d.wordKey));
export const restore = (c, i) => base.update(c, i, { deleted: false });
export const exportData = async () => ({ mock: true });
