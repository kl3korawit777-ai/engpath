// ตัวเล่นคลิป (เบราว์เซอร์เท่านั้น): YouTube ผ่าน YouTube IFrame Player API เท่านั้น (ห้ามดึงไฟล์เสียง/วิดีโอจาก YouTube)
// และไฟล์ตรงผ่าน <audio>/<video> — ทั้งสองแบบให้ controller หน้าตาเดียวกัน
//   controller: { type, ready, play(), pause(), toggle(), seek(t), time(), duration(), state(), setRate(r), rate(), rates(), destroy() }
//   handlers  : { onTime(t), onState(state), onError(thaiMessage) }   state = idle | playing | paused | buffering | ended

const YT_API = "https://www.youtube.com/iframe_api";
const YT_ERRORS = {
  2: "ลิงก์คลิปไม่ถูกต้อง",
  5: "เบราว์เซอร์เล่นคลิปนี้ไม่ได้ ลองรีเฟรชหน้า",
  100: "ไม่พบคลิป (อาจถูกลบหรือเป็นส่วนตัว)",
  101: "เจ้าของคลิปไม่อนุญาตให้ฝังเล่นนอก YouTube",
  150: "เจ้าของคลิปไม่อนุญาตให้ฝังเล่นนอก YouTube",
};
const FILE_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const OFFLINE_MESSAGE = "คลิป YouTube ต้องต่อเน็ตจึงจะเล่นได้ — บทและเสียงอัดของคุณยังใช้ได้ตามปกติ";

let ytLoading = null;
function loadYouTubeApi(timeoutMs = 10000) {
  if (window.YT?.Player) return Promise.resolve();
  if (!navigator.onLine) return Promise.reject(new Error(OFFLINE_MESSAGE));
  if (ytLoading) return ytLoading;
  ytLoading = new Promise((resolve, reject) => {
    const fail = (msg) => { ytLoading = null; reject(new Error(msg)); };
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === "function") prev(); resolve(); };
    const s = document.createElement("script");
    s.src = YT_API;
    s.async = true;
    s.onerror = () => fail(`${OFFLINE_MESSAGE} (โหลดตัวเล่น YouTube ไม่สำเร็จ)`);
    document.head.append(s);
    setTimeout(() => { if (!window.YT?.Player) fail("โหลดตัวเล่น YouTube ไม่ทัน — ตรวจอินเทอร์เน็ตแล้วลองใหม่"); }, timeoutMs);
  });
  return ytLoading;
}

const STATE_FROM_YT = { [-1]: "idle", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "paused" };

async function createYouTube(host, clip, h) {
  await loadYouTubeApi();
  const mount = document.createElement("div");
  host.replaceChildren(mount);
  let player, poll = null, state = "idle", destroyed = false;
  const setState = (s) => { state = s; h.onState?.(s); };
  const startPoll = () => {
    stopPoll();
    poll = setInterval(() => { try { h.onTime?.(player.getCurrentTime()); } catch { /* ยังไม่พร้อม */ } }, 120);
  };
  const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };

  await new Promise((resolve, reject) => {
    player = new window.YT.Player(mount, {
      width: "100%", height: "100%", videoId: clip.videoId,
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => {
          try { player.cueVideoById({ videoId: clip.videoId, startSeconds: clip.start || 0 }); } catch { /* ใช้จุดเริ่มเดิม */ }
          resolve();
        },
        onStateChange: (e) => {
          const s = STATE_FROM_YT[e.data] || "idle";
          setState(s);
          if (s === "playing") startPoll(); else stopPoll();
          if (s !== "playing") { try { h.onTime?.(player.getCurrentTime()); } catch { /* */ } }
        },
        onError: (e) => { const m = YT_ERRORS[e.data] || "เล่นคลิปไม่สำเร็จ"; h.onError?.(m); reject(new Error(m)); },
        onAutoplayBlocked: () => h.onError?.("เบราว์เซอร์บล็อกการเล่นอัตโนมัติ — กดปุ่มเล่นอีกครั้ง"),
      },
    });
    setTimeout(() => reject(new Error("ตัวเล่น YouTube ไม่พร้อมใช้งาน — ลองใหม่")), 15000);
  });

  return {
    type: "youtube",
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    toggle: () => (state === "playing" ? player.pauseVideo() : player.playVideo()),
    seek: (t) => player.seekTo(Math.max(0, t), true),
    time: () => player.getCurrentTime(),
    duration: () => player.getDuration() || 0,
    state: () => state,
    setRate: (r) => player.setPlaybackRate(r),
    rate: () => player.getPlaybackRate(),
    rates: () => player.getAvailablePlaybackRates?.() || [1],
    destroy: () => { destroyed = true; stopPoll(); try { player.destroy(); } catch { /* */ } host.replaceChildren(); void destroyed; },
  };
}

async function createFile(host, clip, h) {
  const el = document.createElement(clip.kind === "video" ? "video" : "audio");
  el.preload = "metadata";
  el.playsInline = true;
  if (clip.kind === "video") el.className = "clip-video";
  el.src = clip.url;
  host.replaceChildren(el);
  let state = "idle", poll = null;
  const setState = (s) => { state = s; h.onState?.(s); };
  el.addEventListener("playing", () => setState("playing"));
  el.addEventListener("pause", () => setState(el.ended ? "ended" : "paused"));
  el.addEventListener("waiting", () => setState("buffering"));
  el.addEventListener("ended", () => setState("ended"));
  poll = setInterval(() => h.onTime?.(el.currentTime), 100);

  await new Promise((resolve, reject) => {
    const fail = () => {
      const m = !navigator.onLine ? "ออฟไลน์อยู่ — ไฟล์คลิปต้องต่อเน็ตจึงจะเล่นได้ (บทและเสียงอัดยังใช้ได้)"
        : "เล่นไฟล์ไม่ได้ — ตรวจลิงก์ หรือเซิร์ฟเวอร์ของไฟล์อาจไม่อนุญาตให้เล่นจากเว็บอื่น";
      h.onError?.(m); reject(new Error(m));
    };
    el.addEventListener("error", fail, { once: true });
    el.addEventListener("loadedmetadata", () => { if (clip.start) el.currentTime = clip.start; resolve(); }, { once: true });
    setTimeout(() => { if (el.readyState < 1) fail(); }, 15000);
  });

  return {
    type: "file",
    play: () => el.play().catch(() => h.onError?.("เล่นไม่ได้ — กดปุ่มเล่นอีกครั้ง")),
    pause: () => el.pause(),
    toggle: () => (el.paused ? el.play().catch(() => h.onError?.("เล่นไม่ได้ — กดปุ่มเล่นอีกครั้ง")) : el.pause()),
    seek: (t) => { el.currentTime = Math.max(0, t); },
    time: () => el.currentTime,
    duration: () => (Number.isFinite(el.duration) ? el.duration : 0),
    state: () => state,
    setRate: (r) => { el.playbackRate = r; },
    rate: () => el.playbackRate,
    rates: () => FILE_RATES,
    destroy: () => { clearInterval(poll); el.pause(); el.removeAttribute("src"); el.load(); host.replaceChildren(); },
  };
}

/** สร้างตัวเล่นตามชนิดคลิป — โยน Error ภาษาไทยถ้าเล่นไม่ได้ (ออฟไลน์ ฯลฯ) */
export function createPlayer(host, clip, handlers = {}) {
  return clip.type === "youtube" ? createYouTube(host, clip, handlers) : createFile(host, clip, handlers);
}

/** ชื่อคลิปจาก YouTube oEmbed (ทดสอบแล้วเรียกจากเบราว์เซอร์ได้) — ล้มเหลว/ช้าเกินคืน null ให้ผู้ใช้พิมพ์เอง */
export async function fetchYouTubeTitle(url, timeoutMs = 6000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: ac.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.title === "string" && j.title.trim() ? j.title.trim().slice(0, 120) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
