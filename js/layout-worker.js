// Web Worker (module) สำหรับจัดวางกราฟ — ตัวคำนวณจริงอยู่ที่ layout.js
import { forceLayout } from "./layout.js";

self.onmessage = (e) => {
  try {
    const pos = forceLayout(e.data);
    self.postMessage({ id: e.data.id, pos }, [pos.buffer]);
  } catch (err) {
    self.postMessage({ id: e.data.id, error: String(err && err.message || err) });
  }
};
