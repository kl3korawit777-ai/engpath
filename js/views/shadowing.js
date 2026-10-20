// Shadowing: คลังคลิป (YouTube / ไฟล์ตรง) + เพลย์ลิสต์ + Player (ช่วงที่ตั้ง, A–B loop, ความเร็ว, วนประโยค) + 3 สเต็ป ฟัง → อ่านตาม → พูดตาม
import * as db from "../db.js";
import * as clips from "../clips.js";
import * as hwCore from "../handwriting-core.js";
import { createPlayer, fetchYouTubeTitle } from "../player.js";
import { ActivityClock, FLUSH_EVERY_MS, toSession } from "../activity.js";
import { gotoLibraryWord } from "../wordnav.js";
import { wordKey } from "../lexicon.js";
import * as recordings from "../recordings.js";
import { compareWords, pickMimeType, formatBytes, quotaInfo, micErrorMessage, speechErrorMessage } from "../speech.js";
import { h } from "../dom.js";

const STEPS = [
  { n: 1, label: "ฟัง", hint: "ฟังทั้งคลิปก่อน ยังไม่ดูบท" },
  { n: 2, label: "อ่านตามบท", hint: "ดูบทแล้วอ่านออกเสียงตาม ตั้งเวลาให้แต่ละประโยคเพื่อกระโดด/วนได้" },
  { n: 3, label: "พูดตาม", hint: "บทถูกซ่อน (เบลอ) พูดตามจากความจำ แตะประโยคเพื่อแอบดูทีละประโยค" },
];

export function render(root, { toast }) {
  let screen = "library";            // library | form | detail
  let editing = null;
  let openId = null;
  let detailCleanup = null;
  const crit = { q: "", level: "", accent: "", topic: "", unpracticed: false, playlist: "" };
  const body = h("div", { class: "stack" });
  root.replaceChildren(body);

  function show() {
    if (detailCleanup) { detailCleanup(); detailCleanup = null; }
    if (screen === "library") drawLibrary();
    else if (screen === "form") drawForm();
    else drawDetail();
  }

  const field = (label, el, hint) => h("label", { class: "field" }, h("span", { text: label }), el, hint ? h("small", { class: "muted", text: hint }) : null);
  const select = (options, value, onchange, label) => h("select", { class: "input select", "aria-label": label, onchange: (e) => onchange(e.target.value) },
    ...options.map(([v, l]) => h("option", { value: v, text: l, selected: v === value })));

  // ================= คลังคลิป =================
  function drawLibrary() {
    const all = db.list("clips").sort((a, b) => b.createdAt - a.createdAt);
    const playlists = db.list("playlists").sort((a, b) => a.name.localeCompare(b.name));
    const rounds = clips.roundCounts(db.list("shadowingEvents"));
    const shown = clips.filterClips(all, crit, { rounds, playlists });
    const topics = clips.distinctTopics(all);
    const curPl = playlists.find((p) => p.id === crit.playlist);

    const plRow = h("div", { class: "row" },
      h("button", { class: `btn btn--chip ${crit.playlist ? "btn--secondary" : ""}`, type: "button", text: `ทั้งหมด ${all.length}`, onclick: () => { crit.playlist = ""; drawLibrary(); } }),
      ...playlists.map((p) => h("button", { class: `btn btn--chip ${crit.playlist === p.id ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(crit.playlist === p.id),
        text: `${p.name} ${(p.clipIds || []).filter((id) => all.some((c) => c.id === id)).length}`, onclick: () => { crit.playlist = p.id; drawLibrary(); } })),
      h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "+ เพลย์ลิสต์", onclick: () => {
        const name = (prompt("ชื่อเพลย์ลิสต์ใหม่") || "").trim();
        if (!name) return;
        if (playlists.some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast("มีเพลย์ลิสต์ชื่อนี้แล้ว"); return; }
        crit.playlist = db.create("playlists", { name: name.slice(0, 60), clipIds: [] }).id;
        drawLibrary();
      } }));

    const plTools = curPl ? h("div", { class: "row" },
      h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "เปลี่ยนชื่อ", onclick: () => {
        const name = (prompt("ชื่อเพลย์ลิสต์", curPl.name) || "").trim();
        if (name) db.update("playlists", curPl.id, { name: name.slice(0, 60) });
      } }),
      h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ลบเพลย์ลิสต์", onclick: () => {
        if (!confirm(`ลบเพลย์ลิสต์ “${curPl.name}” ? (คลิปไม่ถูกลบ)`)) return;
        db.softDelete("playlists", curPl.id); crit.playlist = ""; drawLibrary();
      } })) : null;

    const filters = h("div", { class: "row" },
      h("input", { class: "input", type: "search", value: crit.q, placeholder: "ค้นหาชื่อ หัวข้อ หรือคำในบท", "aria-label": "ค้นหาคลิป", style: "flex:1;min-width:200px",
        oninput: (e) => { crit.q = e.target.value; drawList(); } }),
      select([["", "ทุกระดับ"], ...clips.LEVEL_OPTIONS.map((l) => [l, l])], crit.level, (v) => { crit.level = v; drawLibrary(); }, "กรองตามระดับ"),
      select([["", "ทุกสำเนียง"], ...Object.entries(clips.ACCENTS)], crit.accent, (v) => { crit.accent = v; drawLibrary(); }, "กรองตามสำเนียง"),
      select([["", "ทุกหัวข้อ"], ...topics.map((t) => [t, t])], crit.topic, (v) => { crit.topic = v; drawLibrary(); }, "กรองตามหัวข้อ"),
      h("label", { class: "row check" }, h("input", { type: "checkbox", checked: crit.unpracticed, onchange: (e) => { crit.unpracticed = e.target.checked; drawLibrary(); } }), h("span", { text: "ยังไม่เคยฝึก" })));

    const list = h("div", { class: "stack" });
    const drawList = () => {
      const f = clips.filterClips(all, crit, { rounds, playlists });
      list.replaceChildren(...(f.length ? f.map((c) => clipCard(c, rounds, playlists, curPl)) : [h("p", { class: "muted", text: all.length ? "ไม่พบคลิปที่ตรงกับตัวกรอง" : "ยังไม่มีคลิป กด “เพิ่มคลิป” แล้ววางลิงก์ YouTube หรือไฟล์เสียง/วิดีโอ" })]));
    };
    void shown;
    body.replaceChildren(
      h("div", { class: "page-head" }, h("h1", { text: "Shadowing" }), h("p", { class: "muted", text: "ฟัง → อ่านตามบท → ซ่อนบทแล้วพูดตาม" })),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", text: "+ เพิ่มคลิป", onclick: () => { editing = null; screen = "form"; show(); } })),
      plRow, plTools, filters, list);
    drawList();
  }

  function clipCard(c, rounds, playlists, curPl) {
    const n = rounds.get(c.id) || 0;
    const thumb = c.type === "youtube"
      ? h("img", { class: "clip-thumb", src: clips.youtubeThumb(c.videoId), alt: "", loading: "lazy" })
      : h("div", { class: "clip-thumb clip-thumb--file", text: c.kind === "video" ? "🎬" : "🎧", "aria-hidden": "true" });
    const range = c.start || c.end ? `ช่วง ${clips.formatTime(c.start || 0)}–${c.end != null ? clips.formatTime(c.end) : "จบ"}` : null;
    const addTo = playlists.filter((p) => !(p.clipIds || []).includes(c.id));
    return h("article", { class: "card clip-card" }, thumb,
      h("div", { class: "stack clip-card__main" },
        h("strong", { text: c.title }),
        h("div", { class: "row tags" },
          c.level ? h("span", { class: "badge", text: c.level }) : null, c.accent ? h("span", { class: "badge", text: clips.ACCENTS[c.accent] }) : null,
          c.topic ? h("span", { class: "badge", text: c.topic }) : null, h("span", { class: "mono muted", text: n ? `ฝึกแล้ว ${n} รอบ` : "ยังไม่เคยฝึก" }),
          range ? h("span", { class: "mono muted", text: range }) : null),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", text: "ฝึก", onclick: () => { openId = c.id; screen = "detail"; show(); } }),
          h("button", { class: "btn btn--secondary", type: "button", text: "แก้ไข", onclick: () => { editing = c; screen = "form"; show(); } }),
          curPl ? h("button", { class: "btn btn--secondary", type: "button", text: "เอาออกจากเพลย์ลิสต์", onclick: () => db.update("playlists", curPl.id, { clipIds: (curPl.clipIds || []).filter((x) => x !== c.id) }) })
            : (addTo.length ? h("select", { class: "input select", "aria-label": "เพิ่มเข้าเพลย์ลิสต์", onchange: (e) => { const p = playlists.find((x) => x.id === e.target.value); if (p) { db.update("playlists", p.id, { clipIds: [...(p.clipIds || []), c.id] }); toast(`เพิ่มเข้า “${p.name}” แล้ว`); } e.target.value = ""; } },
              h("option", { value: "", text: "เพิ่มเข้าเพลย์ลิสต์…" }), ...addTo.map((p) => h("option", { value: p.id, text: p.name }))) : null),
          h("button", { class: "btn btn--secondary", type: "button", text: "ลบ", onclick: () => {
            if (!confirm(`ลบคลิป “${c.title}” ? (บันทึกการฝึกที่เคยมียังอยู่)`)) return;
            db.softDelete("clips", c.id); toast("ลบแล้ว");
          } }))));
  }

  // ================= ฟอร์มเพิ่ม/แก้ไข =================
  function drawForm() {
    const c = editing;
    const f = {
      url: h("input", { class: "input", value: c?.url || "", placeholder: "วางลิงก์ YouTube หรือไฟล์ .mp3 .m4a .wav .ogg .mp4 .webm", autocomplete: "off", spellcheck: false, "aria-label": "ลิงก์คลิป", inputmode: "url" }),
      title: h("input", { class: "input", value: c?.title || "", maxlength: "120", placeholder: "ชื่อคลิป" }),
      start: h("input", { class: "input", value: c?.start ? clips.formatTime(c.start) : "", placeholder: "เช่น 1:30", inputmode: "numeric" }),
      end: h("input", { class: "input", value: c?.end != null ? clips.formatTime(c.end) : "", placeholder: "เช่น 3:45 (เว้นว่าง = จนจบ)", inputmode: "numeric" }),
      transcript: h("textarea", { class: "input", rows: 8, placeholder: "วางบท (transcript) ที่นี่ — ระบบจะแบ่งเป็นประโยคให้", value: clips.sentencesToText(c?.sentences) }),
      level: select([["", "ไม่ระบุ"], ...clips.LEVEL_OPTIONS.map((l) => [l, l])], c?.level || "", () => {}, "ระดับ"),
      accent: select([["", "ไม่ระบุ"], ...Object.entries(clips.ACCENTS)], c?.accent || "", () => {}, "สำเนียง"),
      topic: h("input", { class: "input", value: c?.topic || "", list: "clip-topics", placeholder: "เช่น Science, Daily life" }),
    };
    const status = h("div", { class: "lex-status", role: "status", "aria-live": "polite" });
    const countEl = h("small", { class: "muted mono" });
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    let parsed = c ? { ok: true, type: c.type, videoId: c.videoId, kind: c.kind, url: c.url, start: c.start || 0 } : null;
    let titleToken = 0;

    const checkUrl = async () => {
      const r = clips.parseClipUrl(f.url.value);
      parsed = r;
      if (!f.url.value.trim()) { status.className = "lex-status"; status.textContent = ""; return; }
      if (!r.ok) { status.className = "lex-status lex-status--error"; status.textContent = `✗ ${r.error}`; return; }
      status.className = "lex-status lex-status--ok";
      status.textContent = r.type === "youtube" ? `✓ YouTube (${r.videoId})${r.start ? ` · เริ่มที่ ${clips.formatTime(r.start)}` : ""}` : `✓ ไฟล์${r.kind === "video" ? "วิดีโอ" : "เสียง"}ตรง${r.start ? ` · เริ่มที่ ${clips.formatTime(r.start)}` : ""}`;
      if (r.start && !f.start.value.trim()) f.start.value = clips.formatTime(r.start);
      if (r.type === "youtube" && !f.title.value.trim()) {
        const my = ++titleToken;
        status.textContent += " · กำลังดึงชื่อคลิป…";
        const t = await fetchYouTubeTitle(r.url);
        if (my !== titleToken) return;
        if (t && !f.title.value.trim()) { f.title.value = t; status.textContent = status.textContent.replace(" · กำลังดึงชื่อคลิป…", " · ดึงชื่อคลิปแล้ว"); }
        else status.textContent = status.textContent.replace(" · กำลังดึงชื่อคลิป…", "") + (t ? "" : " · ดึงชื่ออัตโนมัติไม่ได้ พิมพ์ชื่อเอง");
      }
    };
    f.url.addEventListener("input", checkUrl);
    f.url.addEventListener("paste", () => setTimeout(checkUrl, 0));
    const updateCount = () => { countEl.textContent = `แบ่งได้ ${clips.splitSentences(f.transcript.value).length} ประโยค`; };
    f.transcript.addEventListener("input", updateCount);
    updateCount();
    if (c) checkUrl();

    const topicList = h("datalist", { id: "clip-topics" }, ...clips.distinctTopics(db.list("clips")).map((t) => h("option", { value: t })));

    body.replaceChildren(
      h("div", { class: "page-head" }, h("h1", { text: c ? "แก้ไขคลิป" : "เพิ่มคลิป" })),
      h("form", { class: "card form", novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const r = clips.parseClipUrl(f.url.value);
          const data = { title: f.title.value.trim(), start: clips.parseClockInput(f.start.value), end: clips.parseClockInput(f.end.value), level: f.level.value, accent: f.accent.value, topic: f.topic.value.trim() };
          const msg = !r.ok ? r.error : clips.validateClip(data);
          err.hidden = !msg;
          if (msg) { err.textContent = msg; return; }
          const doc = {
            type: r.type, url: r.url, title: data.title, start: data.start ?? 0, end: data.end ?? null,
            level: data.level, accent: data.accent, topic: data.topic,
            sentences: clips.mergeSentences(c?.sentences, clips.splitSentences(f.transcript.value)),
            ...(r.type === "youtube" ? { videoId: r.videoId, thumb: clips.youtubeThumb(r.videoId) } : { kind: r.kind }),
          };
          if (c) db.update("clips", c.id, doc); else db.create("clips", doc);
          toast("บันทึกคลิปแล้ว");
          editing = null; screen = c ? "detail" : "library"; if (c) openId = c.id;
          show();
        } },
        field("ลิงก์คลิป", f.url), status,
        field("ชื่อ", f.title),
        h("div", { class: "grid2 form-grid" }, field("เริ่ม (นาที:วินาที)", f.start), field("จบ (นาที:วินาที)", f.end)),
        field("บท (transcript)", f.transcript), countEl,
        h("div", { class: "grid2 form-grid" }, field("ระดับ", f.level), field("สำเนียง", f.accent)),
        field("หัวข้อ", f.topic), topicList, err,
        h("div", { class: "row" },
          h("button", { class: "btn", type: "submit", text: "บันทึก" }),
          h("button", { class: "btn btn--secondary", type: "button", text: "ยกเลิก", onclick: () => { editing = null; screen = c ? "detail" : "library"; if (c) openId = c.id; show(); } }))));
    void parsed;
  }

  // ================= Player + 3 สเต็ป =================
  function drawDetail() {
    const clip = db.get("clips", openId);
    if (!clip || clip.deleted) { screen = "library"; show(); return; }
    let step = 1;
    let ctrl = null;
    let lastTime = 0, lastTouch = 0;
    const loop = { a: null, b: null, on: false };
    let sentLoop = null;                      // index ของประโยคที่วนอยู่
    const peek = new Set();
    let bar = null;                           // ข้อความที่ลากคลุม { text, sentence }

    const clock = new ActivityClock();
    const touch = () => clock.touch(Date.now());
    const flush = () => {
      const s = toSession(clock.flush(Date.now()), "shadowing", db.getSettings().stage);
      if (s) { try { db.append("sessions", s); } catch (e) { console.error(e); } }
    };
    const onHidden = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHidden);
    const flushTimer = setInterval(flush, FLUSH_EVERY_MS);
    body.addEventListener("pointerdown", touch);
    body.addEventListener("keydown", touch);
    const stopTouch = () => { body.removeEventListener("pointerdown", touch); body.removeEventListener("keydown", touch); };

    const live = () => db.get("clips", clip.id) || clip;
    const sentences = () => live().sentences || [];
    const rangeNow = () => ({ rangeStart: clip.start || 0, rangeEnd: clip.end ?? null });

    const playerHost = h("div", { class: `player-host ${clip.type === "youtube" || clip.kind === "video" ? "player-host--video" : "player-host--audio"}` });
    const notice = h("div", { class: "notice", role: "status", hidden: true });
    const timeEl = h("span", { class: "mono", text: "0:00 / 0:00" });
    const playBtn = h("button", { class: "btn", type: "button", disabled: true, text: "▶ เล่น", onclick: () => { touch(); onPlayClick(); } });
    const rateSel = h("select", { class: "input select hw-level-select", "aria-label": "ความเร็ว", disabled: true, onchange: (e) => ctrl?.setRate(Number(e.target.value)) });
    const abInfo = h("span", { class: "mono muted" });
    const stepsEl = h("div", { class: "row tabs" });
    const transcriptBox = h("section", { class: "card stack" });
    const barEl = h("div", { class: "card sel-bar", hidden: true });
    const roundsEl = h("span", { class: "mono muted" });

    function refreshRates() {
      if (!ctrl) return;
      const rs = ctrl.rates(), cur = ctrl.rate();
      if (rateSel.options.length !== rs.length || rateSel.value !== String(cur)) rateSel.replaceChildren(...rs.map((r) => h("option", { value: String(r), text: `×${r}`, selected: r === cur })));
      timeEl.textContent = `${clips.formatTime(ctrl.time())} / ${clips.formatTime(ctrl.duration())}`;
    }
    const setNotice = (msg) => { notice.hidden = !msg; notice.textContent = msg || ""; };

    function onPlayClick() {
      if (!ctrl) return;
      const { rangeStart, rangeEnd } = rangeNow();
      if (ctrl.state() === "ended" || (rangeEnd != null && ctrl.time() >= rangeEnd - 0.1)) ctrl.seek(rangeStart);
      ctrl.toggle();
    }

    function sentenceState() {
      if (sentLoop == null) return null;
      return clips.sentenceRange(sentences(), sentLoop, clip.end ?? null);
    }

    function onTime(t) {
      lastTime = t;
      if (pendingCompare && ctrl && t >= pendingCompare.end - 0.05) {       // จบต้นฉบับแล้ว เล่นเสียงของฉันต่อ
        const pc = pendingCompare; pendingCompare = null; ctrl.pause(); playRecording(pc.recObj); return;
      }
      const d = clips.tickDecision(t, { ...rangeNow(), loopA: loop.a, loopB: loop.b, loopOn: loop.on, sentence: sentenceState() });
      if (d.seekTo != null && ctrl) ctrl.seek(d.seekTo);
      if (d.pause && ctrl) ctrl.pause();
      const dur = ctrl?.duration() || 0;
      timeEl.textContent = `${clips.formatTime(t)} / ${clips.formatTime(dur)}`;
      if (ctrl?.state() === "playing" && Date.now() - lastTouch > 3000) { lastTouch = Date.now(); touch(); }
      markActive(t);
    }

    let activeIdx = -2;
    function markActive(t) {
      const i = clips.activeSentence(sentences(), t);
      if (i === activeIdx) return;
      activeIdx = i;
      transcriptBox.querySelectorAll(".sent").forEach((el) => el.classList.toggle("sent--active", Number(el.dataset.index) === i));
    }

    function drawControls() {
      abInfo.textContent = loop.a != null || loop.b != null
        ? `A ${loop.a != null ? clips.formatTime(loop.a) : "–"} · B ${loop.b != null ? clips.formatTime(loop.b) : "–"} ${loop.on ? "(วนอยู่)" : ""}` : "ยังไม่ได้ตั้ง A–B";
    }

    const controls = h("div", { class: "stack" },
      h("div", { class: "row" }, playBtn,
        h("button", { class: "btn btn--secondary", type: "button", text: "⟲ 3 วิ", onclick: () => { touch(); ctrl?.seek(Math.max(rangeNow().rangeStart, ctrl.time() - 3)); } }),
        rateSel, timeEl),
      h("div", { class: "row" },
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ตั้ง A", onclick: () => { if (!ctrl) return; touch(); loop.a = ctrl.time(); if (loop.b != null && loop.b <= loop.a) loop.b = null; loop.on = loop.b != null; drawControls(); } }),
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ตั้ง B", onclick: () => {
          if (!ctrl) return; touch();
          const t = ctrl.time();
          if (loop.a == null || t <= loop.a) { toast("ตั้ง A ก่อน แล้วค่อยตั้ง B ที่เวลาหลัง A"); return; }
          loop.b = t; loop.on = true; sentLoop = null; ctrl.seek(loop.a); drawControls(); drawSentences();
        } }),
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "วน A–B", onclick: () => { loop.on = !loop.on && loop.a != null && loop.b != null; if (loop.on) sentLoop = null; drawControls(); drawSentences(); } }),
        h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ล้าง A–B", onclick: () => { loop.a = loop.b = null; loop.on = false; drawControls(); } }),
        abInfo));

    function drawSteps() {
      stepsEl.replaceChildren(...STEPS.map((s) => h("button", { class: `btn ${step === s.n ? "" : "btn--secondary"}`, type: "button", "aria-pressed": String(step === s.n), text: `${s.n}. ${s.label}`,
        onclick: () => { step = s.n; peek.clear(); drawSteps(); drawSentences(); } })));
    }


    // ================= อัดเสียง + ตรวจคำพูด =================
    const recSupported = typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recs = [];                         // เสียงอัดของคลิปนี้ (IndexedDB ของเครื่องนี้)
    let recordingState = null;             // { i, mr, startedAt, timer }
    let listening = null;                  // { i, sr }
    let interimText = "";
    let playingAudio = null;               // { audio, url }
    let pendingCompare = null;             // { end, recObj } เล่นต้นฉบับจบแล้วเล่นเสียงของฉันต่อ
    const speechResults = new Map();       // sentenceIndex → ผลเทียบคำ (ชั่วคราว ไม่เก็บ)
    const recBar = h("div", { class: "notice", role: "status", hidden: true });
    const storageBox = h("section", { class: "card stack" });

    function unsupportedNotes() {
      const n = [];
      if (!recSupported) n.push(typeof isSecureContext !== "undefined" && !isSecureContext
        ? "อัดเสียงไม่ได้: ต้องเปิดเว็บผ่าน https (หรือ localhost) — ซ่อนปุ่มอัดเสียง"
        : "เบราว์เซอร์นี้ไม่รองรับการอัดเสียง (MediaRecorder) — ซ่อนปุ่มอัดเสียง");
      if (!SR) n.push("เบราว์เซอร์นี้ไม่รองรับการตรวจคำพูด (SpeechRecognition) — ซ่อนปุ่มตรวจคำพูด ลองใช้ Chrome, Edge หรือ Safari รุ่นใหม่");
      return n;
    }

    async function loadRecs() {
      try { recs = await recordings.listRecordings(clip.id); } catch (e) { recs = []; toast(e.message); }
    }

    function refreshExtras() {
      transcriptBox.querySelectorAll(".sent").forEach((el) => el.querySelector(".sent__extra")?.replaceChildren(...extraFor(Number(el.dataset.index))));
    }

    function drawRecBar() {
      if (recordingState) {
        recBar.hidden = false;
        recBar.replaceChildren(h("div", { class: "row" }, h("strong", { class: "bad", text: `● กำลังอัดประโยคที่ ${recordingState.i + 1}` }),
          h("span", { class: "mono", text: clips.formatTime((Date.now() - recordingState.startedAt) / 1000) }),
          h("button", { class: "btn", type: "button", text: "⏹ หยุดและบันทึก", onclick: stopRecording }),
          h("small", { class: "muted", text: "แนะนำให้ใส่หูฟัง เพื่อไม่ให้ไมค์อัดเสียงต้นฉบับซ้อน" })));
      } else if (listening) {
        recBar.hidden = false;
        recBar.replaceChildren(...[h("div", { class: "row" }, h("strong", { text: `🗣 กำลังฟังประโยคที่ ${listening.i + 1} — พูดตามได้เลย` }),
          h("button", { class: "btn", type: "button", text: "⏹ เสร็จแล้ว", onclick: () => listening?.sr.stop() })),
          interimText ? h("div", { class: "muted", text: `ได้ยินว่า: ${interimText}` }) : null].filter(Boolean));
      } else { recBar.hidden = true; recBar.replaceChildren(); }
    }

    async function startRecording(i) {
      if (recordingState) { if (recordingState.i === i) stopRecording(); else toast("กำลังอัดประโยคอื่นอยู่ — กดหยุดก่อน"); return; }
      if (listening) listening.sr.stop();
      if (!recSupported) { toast("เบราว์เซอร์นี้ไม่รองรับการอัดเสียง"); return; }
      ctrl?.pause(); stopPlayback(); touch();
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast(micErrorMessage(e)); return; }
      const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t));       // iOS ได้ audio/mp4
      let mr;
      try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch (e) { stream.getTracks().forEach((t) => t.stop()); toast(`เริ่มอัดเสียงไม่สำเร็จ: ${e.message}`); return; }
      const chunks = [];
      const startedAt = Date.now();
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onerror = (e) => toast(`อัดเสียงผิดพลาด: ${e.error?.message || "ไม่ทราบสาเหตุ"}`);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingState?.timer) clearInterval(recordingState.timer);
        recordingState = null; drawRecBar(); drawSentences();
        if (!chunks.length) { toast("ไม่ได้เสียงเลย ลองอัดอีกครั้ง"); return; }
        const blob = new Blob(chunks, { type: mr.mimeType || mime || "audio/webm" });
        try {
          await recordings.putRecording({ clipId: clip.id, sentenceIndex: i, mime: blob.type, blob, durationSec: (Date.now() - startedAt) / 1000 });
          await loadRecs(); refreshExtras();
          await recordings.requestPersist();                       // ขอให้เบราว์เซอร์เก็บถาวร (สถานะแสดงในกล่อง “เสียงอัด”)
          drawStorage();
          toast("บันทึกเสียงอัดแล้ว (เก็บในเครื่องนี้เท่านั้น)");
        } catch (e) { toast(e.message); }
      };
      mr.start();
      recordingState = { i, mr, startedAt, timer: setInterval(() => { drawRecBar(); if (Date.now() - startedAt > 120000) stopRecording(); }, 250) };
      drawRecBar(); drawSentences();
    }

    function stopRecording() { try { if (recordingState && recordingState.mr.state !== "inactive") recordingState.mr.stop(); } catch { /* หยุดไปแล้ว */ } }

    function startListening(i) {
      if (listening) { listening.sr.stop(); return; }
      if (!SR) { toast("เบราว์เซอร์นี้ไม่รองรับการตรวจคำพูด"); return; }
      if (recordingState) stopRecording();
      ctrl?.pause(); stopPlayback(); touch();
      const target = sentences()[i]?.text || "";
      const sr = new SR();
      sr.lang = "en-US"; sr.interimResults = true; sr.continuous = false; sr.maxAlternatives = 1;
      let finalText = "", errored = false;
      interimText = "";
      sr.onresult = (e) => {
        let interim = "";
        for (let k = e.resultIndex; k < e.results.length; k++) { const r = e.results[k]; if (r.isFinal) finalText += `${r[0].transcript} `; else interim += r[0].transcript; }
        interimText = interim; drawRecBar();
      };
      sr.onerror = (e) => { errored = true; const m = speechErrorMessage(e.error); if (m) toast(m); };
      sr.onend = () => {
        const text = (finalText || interimText).trim();
        listening = null; interimText = ""; drawRecBar();
        if (text) speechResults.set(i, compareWords(target, text));
        else if (!errored) toast("ไม่ได้ยินเสียงพูด ลองพูดใกล้ไมค์ขึ้นแล้วกดอีกครั้ง");
        drawSentences();
      };
      try { sr.start(); } catch (e) { toast(`เริ่มตรวจคำพูดไม่สำเร็จ: ${e.message}`); return; }
      listening = { i, sr };
      drawRecBar(); drawSentences();
    }

    function stopPlayback() {
      if (!playingAudio) return;
      playingAudio.audio.pause(); URL.revokeObjectURL(playingAudio.url); playingAudio = null;
    }

    function playRecording(r) {
      stopPlayback();
      const url = URL.createObjectURL(r.blob);
      const audio = new Audio(url);
      playingAudio = { audio, url };
      audio.onended = stopPlayback;
      audio.play().catch(() => { toast("เล่นเสียงอัดไม่ได้ — ลองกดอีกครั้ง"); stopPlayback(); });
    }

    /** เทียบกับต้นฉบับ: เล่นช่วงของประโยคในคลิปก่อน แล้วเล่นเสียงของฉันต่อ */
    function compareWithOriginal(i, r) {
      const range = clips.sentenceRange(sentences(), i, clip.end ?? null);
      if (!range || !ctrl) { playRecording(r); toast("ตั้งเวลาประโยคนี้ (📍) ก่อนจึงจะเทียบกับต้นฉบับได้ — เล่นเสียงของคุณอย่างเดียวไปก่อน"); return; }
      stopPlayback();
      pendingCompare = { end: range.end ?? Math.max(range.start + 1, ctrl.duration() - 0.1), recObj: r };
      sentLoop = null; loop.on = false;
      ctrl.seek(range.start); ctrl.play();
    }

    function extraFor(i) {
      const out = [];
      const res = speechResults.get(i);
      if (res) {
        out.push(h("div", { class: "speech-result" },
          h("div", {}, ...res.tokens.map((t) => h("span", { class: t.ok ? "w-ok" : "w-miss", text: `${t.text} ` }))),
          h("div", { class: "mono muted", text: `พูดตรง ${Math.round(res.accuracy * 100)}% (${res.matched}/${res.total} คำ)${res.extra.length ? ` · พูดเกิน/ไม่ตรง: ${res.extra.join(" ")}` : ""}` }),
          h("div", { class: "muted", text: `ได้ยินว่า: ${res.spokenText || "(ไม่มี)"}` })));
      }
      const mine = recs.filter((r) => r.sentenceIndex === i);
      if (mine.length) {
        out.push(h("ul", { class: "rec-list" }, ...mine.map((r) => h("li", { class: "row" },
          h("span", { class: "mono muted", text: `${clips.formatTime(r.durationSec)} · ${formatBytes(r.size)} · ${new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(r.at))}` }),
          h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "▶ เสียงของฉัน", onclick: () => { touch(); playRecording(r); } }),
          h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "⇄ เทียบต้นฉบับ", onclick: () => { touch(); compareWithOriginal(i, r); } }),
          h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "⬇", title: "ดาวน์โหลดไฟล์เสียง", "aria-label": "ดาวน์โหลดไฟล์เสียง", onclick: () => recordings.downloadBlob(r.blob, recordings.fileNameFor(r, clip.title)) }),
          h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ลบ", onclick: async () => {
            if (!confirm("ลบเสียงอัดนี้? (ลบแล้วกู้คืนไม่ได้ เพราะเก็บเฉพาะในเครื่องนี้)")) return;
            await recordings.deleteRecording(r.id); await loadRecs(); refreshExtras(); drawStorage();
          } })))));
      }
      return out;
    }

    async function drawStorage() {
      let mineU = { count: 0, bytes: 0 }, allU = { count: 0, bytes: 0 }, est = null, persisted = null;
      try { [mineU, allU, est, persisted] = await Promise.all([recordings.usage(clip.id), recordings.usage(), recordings.storageEstimate(), recordings.isPersisted()]); } catch (e) { storageBox.replaceChildren(h("h2", { text: "เสียงอัด" }), h("p", { class: "muted", text: e.message })); return; }
      const q = quotaInfo(est);
      storageBox.replaceChildren(
        h("h2", { text: "เสียงอัด" }),
        h("p", { class: "muted", text: "เก็บในเครื่องนี้เท่านั้น (ไม่ขึ้น Firestore ไม่ซิงก์ข้ามเครื่อง ไม่รวมใน Export JSON)" }),
        h("div", { class: "mono" }, `คลิปนี้ ${mineU.count} ไฟล์ · ${formatBytes(mineU.bytes)} | ทั้งหมด ${allU.count} ไฟล์ · ${formatBytes(allU.bytes)}`),
        h("div", { class: "mono muted" }, q.quota ? `พื้นที่เบราว์เซอร์ใช้ไป ${formatBytes(q.usage)} จาก ${formatBytes(q.quota)} (${q.pct.toFixed(1)}%)` : "เบราว์เซอร์ไม่บอกพื้นที่ที่ใช้"),
        h("div", { class: persisted ? "good" : "muted", text: persisted ? "✓ เบราว์เซอร์รับปากเก็บถาวรแล้ว" : persisted === false ? "เบราว์เซอร์ยังไม่รับปากเก็บถาวร — เสียงอัดอาจถูกล้างเมื่อพื้นที่เต็ม (สำรองด้วยปุ่มดาวน์โหลดด้านล่าง)" : "เบราว์เซอร์นี้ไม่รองรับการขอเก็บถาวร" }),
        h("div", { class: "row" },
          persisted === false ? h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ขอเก็บถาวร", onclick: async () => { const ok = await recordings.requestPersist(); toast(ok ? "เบราว์เซอร์รับปากเก็บถาวรแล้ว" : "เบราว์เซอร์ไม่ให้สิทธิ์เก็บถาวร (iOS มักให้เมื่อติดตั้งเป็นแอปบน Home Screen)"); drawStorage(); } }) : null,
          h("button", { class: "btn btn--secondary btn--chip", type: "button", disabled: !allU.count, text: "ดาวน์โหลดเสียงอัดทั้งหมด (.json)", onclick: async () => {
            try { recordings.downloadBlob(await recordings.exportAllJson(), `engpath-audio-${new Date().toISOString().slice(0, 10)}.json`); } catch (e) { toast(e.message); }
          } }),
          h("button", { class: "btn btn--secondary btn--chip", type: "button", disabled: !mineU.count, text: "ลบเสียงอัดของคลิปนี้", onclick: async () => {
            if (!confirm(`ลบเสียงอัดของคลิปนี้ ${mineU.count} ไฟล์? (กู้คืนไม่ได้)`)) return;
            await recordings.deleteClipRecordings(clip.id); await loadRecs(); refreshExtras(); drawStorage();
          } })));
    }

    function stopAllMedia() {
      if (recordingState) { clearInterval(recordingState.timer); try { if (recordingState.mr.state !== "inactive") recordingState.mr.stop(); } catch { /* */ } }
      if (listening) { try { listening.sr.abort(); } catch { /* */ } }
      stopPlayback();
    }

    function drawSentences() {
      const list = sentences();
      const hint = STEPS[step - 1].hint;
      if (step === 1) {
        transcriptBox.replaceChildren(h("h2", { text: "ขั้น 1 · ฟัง" }), h("p", { class: "muted", text: hint }),
          list.length ? h("p", { class: "muted", text: `คลิปนี้มีบท ${list.length} ประโยค (ซ่อนไว้ในขั้นนี้)` }) : h("p", { class: "muted", text: "ยังไม่มีบท — กด “แก้ไขคลิป” เพื่อวางบท" }));
        return;
      }
      const rows = list.map((s, i) => {
        const blurred = step === 3 && !peek.has(i);
        const range = clips.sentenceRange(list, i, clip.end ?? null);
        return h("div", { class: `sent ${blurred ? "sent--blur" : ""} ${sentLoop === i ? "sent--loop" : ""}`, "data-index": String(i) },
          h("div", { class: "sent__ctl" },
            h("span", { class: "mono muted sent__t", text: s.t != null ? clips.formatTime(s.t) : "--:--" }),
            h("button", { class: "tag-edit", type: "button", title: "เล่นประโยคนี้", "aria-label": `เล่นประโยคที่ ${i + 1}`, text: "▶", onclick: () => { touch(); jump(i); } }),
            h("button", { class: `tag-edit ${sentLoop === i ? "is-on" : ""}`, type: "button", title: "วนประโยคนี้", "aria-label": `วนประโยคที่ ${i + 1}`, "aria-pressed": String(sentLoop === i), text: "🔁",
              onclick: () => { touch(); toggleSentLoop(i); } }),
            h("button", { class: "tag-edit", type: "button", title: "ตั้งเวลาประโยคนี้เป็นเวลาที่เล่นอยู่", text: "📍", "aria-label": `ตั้งจุดของประโยคที่ ${i + 1}`,
              onclick: () => { if (!ctrl) { toast("ต้องเล่นคลิปได้ก่อนจึงจะตั้งจุดได้"); return; } touch(); db.update("clips", clip.id, { sentences: clips.setSentenceTime(sentences(), i, ctrl.time()) }); } }),
            recSupported ? h("button", { class: `tag-edit ${recordingState?.i === i ? "is-on" : ""}`, type: "button", title: recordingState?.i === i ? "หยุดอัด" : "อัดเสียงประโยคนี้", "aria-label": `อัดเสียงประโยคที่ ${i + 1}`, "aria-pressed": String(recordingState?.i === i),
              text: recordingState?.i === i ? "⏹" : "🎙", onclick: () => startRecording(i) }) : null,
            SR ? h("button", { class: `tag-edit ${listening?.i === i ? "is-on" : ""}`, type: "button", title: listening?.i === i ? "หยุดฟัง" : "พูดแล้วตรวจคำพูด", "aria-label": `ตรวจคำพูดประโยคที่ ${i + 1}`, "aria-pressed": String(listening?.i === i),
              text: listening?.i === i ? "⏹" : "🗣", onclick: () => startListening(i) }) : null,
            s.t != null ? h("button", { class: "tag-edit", type: "button", title: "ล้างเวลา", "aria-label": `ล้างเวลาของประโยคที่ ${i + 1}`, text: "✕",
              onclick: () => db.update("clips", clip.id, { sentences: clips.setSentenceTime(sentences(), i, null) }) }) : null),
          h("div", { class: "sent__text", role: step === 3 ? "button" : null, tabindex: step === 3 ? "0" : null, title: step === 3 ? "แตะเพื่อแอบดู" : null,
            onclick: step === 3 ? () => { if (peek.has(i)) peek.delete(i); else peek.add(i); drawSentences(); } : null,
            onkeydown: step === 3 ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (peek.has(i)) peek.delete(i); else peek.add(i); drawSentences(); } } : null, text: s.text }),
          h("div", { class: "sent__extra" }, ...extraFor(i)));
        void range;
      });
      transcriptBox.replaceChildren(
        h("div", { class: "row" }, h("h2", { text: `ขั้น ${step} · ${STEPS[step - 1].label}` }), h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "แก้ไขคลิป/บท", onclick: () => { editing = live(); screen = "form"; show(); } })),
        h("p", { class: "muted", text: hint }),
        step === 2 ? h("p", { class: "muted", text: "ลากคลุมคำหรือวลีในบทเพื่อสร้างบัตรคำหรือส่งไปคัดลายมือ · 📍 = ตั้งเวลาประโยคนี้เป็นเวลาที่เล่นอยู่ · 🎙 = อัดเสียง · 🗣 = พูดแล้วตรวจคำพูด" }) : null,
        ...unsupportedNotes().map((t) => h("div", { class: "notice", role: "note", text: t })),
        ...(rows.length ? rows : [h("p", { class: "muted", text: "ยังไม่มีบท — กด “แก้ไขคลิป/บท” เพื่อวางบท" })]));
      activeIdx = -2; markActive(lastTime);
    }

    function jump(i) {
      if (!ctrl) { toast("เล่นคลิปไม่ได้ในตอนนี้"); return; }
      const r = clips.sentenceRange(sentences(), i, clip.end ?? null);
      if (!r) { toast("ยังไม่ได้ตั้งเวลาประโยคนี้ — เล่นคลิปแล้วกด 📍 ตรงประโยคที่กำลังได้ยิน"); return; }
      sentLoop = null; loop.on = false; drawControls();
      ctrl.seek(r.start); ctrl.play(); drawSentences();
    }

    function toggleSentLoop(i) {
      if (!ctrl) return;
      if (sentLoop === i) { sentLoop = null; drawSentences(); return; }
      const r = clips.sentenceRange(sentences(), i, clip.end ?? null);
      if (!r) { toast("ยังไม่ได้ตั้งเวลาประโยคนี้ — เล่นคลิปแล้วกด 📍 ตรงประโยคที่กำลังได้ยิน"); return; }
      sentLoop = i; loop.on = false; drawControls();
      ctrl.seek(r.start); ctrl.play(); drawSentences();
    }

    // ---------- ลากคลุมวลีในบท ----------
    function onSelect() {
      if (step === 1) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().replace(/\s+/g, " ").trim();
      const node = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
      const sentEl = node?.closest?.(".sent__text");
      if (!sentEl || !transcriptBox.contains(sentEl) || text.length < 2 || text.length > 80) return;
      bar = { text, sentence: sentences()[Number(sentEl.parentElement.dataset.index)]?.text || text };
      drawBar();
    }
    document.addEventListener("selectionchange", onSelect);

    function drawBar() {
      if (!bar) { barEl.hidden = true; return; }
      barEl.hidden = false;
      barEl.replaceChildren(
        h("div", {}, "เลือก: ", h("strong", { text: bar.text })),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", text: "ดูในคลังคำ", onclick: () => gotoLibraryWord(bar.text, toast) }),
          h("button", { class: "btn btn--secondary", type: "button", text: "ส่งไปคัดลายมือ", onclick: () => sendToHandwriting(bar.text) }),
          h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "ปิด", onclick: () => { bar = null; drawBar(); } })));
    }

    function sendToHandwriting(text) {
      if (!hwCore.isWritable(text)) { toast(`เขียนได้เฉพาะตัวอักษรอังกฤษ/ตัวเลข ไม่เกิน ${30} ตัวอักษร ลองเลือกวลีที่สั้นลง`); return; }
      if (db.list("handwritingWords").some((w) => wordKey(w.text) === wordKey(text))) { toast("มีคำนี้ในรายการคัดลายมือแล้ว"); return; }
      db.create("handwritingWords", { text, source: "shadowing", clipId: clip.id });
      toast("ส่งไปคัดลายมือแล้ว (ดูที่หน้า “เขียน” แหล่ง “จาก Shadowing”)");
    }

    // ---------- จบรอบ ----------
    const rounds = () => clips.roundCounts(db.list("shadowingEvents")).get(clip.id) || 0;
    const drawRounds = () => { roundsEl.textContent = `ฝึกแล้ว ${rounds()} รอบ`; };

    body.replaceChildren(
      h("div", { class: "row" }, h("button", { class: "btn btn--secondary btn--chip", type: "button", text: "← คลังคลิป", onclick: () => { screen = "library"; show(); } })),
      h("div", {}, h("h1", { text: clip.title }), h("div", { class: "row tags" }, clip.level ? h("span", { class: "badge", text: clip.level }) : null, clip.accent ? h("span", { class: "badge", text: clips.ACCENTS[clip.accent] }) : null,
        clip.topic ? h("span", { class: "badge", text: clip.topic }) : null, clip.start || clip.end ? h("span", { class: "mono muted", text: `เล่นเฉพาะช่วง ${clips.formatTime(clip.start || 0)}–${clip.end != null ? clips.formatTime(clip.end) : "จบ"}` }) : null)),
      h("section", { class: "card stack" }, playerHost, notice, controls),
      stepsEl, recBar, transcriptBox, storageBox, barEl,
      h("section", { class: "card row" }, h("button", { class: "btn", type: "button", text: "จบ 1 รอบ", onclick: () => {
        touch();
        db.append("shadowingEvents", { clipId: clip.id, kind: "round", step, at: Date.now() });
        toast("บันทึกจบ 1 รอบแล้ว");
        drawRounds();
      } }), roundsEl));
    drawSteps(); drawSentences(); drawControls(); drawRounds();
    loadRecs().then(refreshExtras); drawStorage();

    // เริ่มตัวเล่น (ออฟไลน์/ล้มเหลว → ข้อความภาษาไทย บทยังใช้ได้)
    playerHost.textContent = "กำลังโหลดตัวเล่น…";
    createPlayer(playerHost, clip, {
      onTime, onError: setNotice,
      onState: (s) => {
        playBtn.textContent = s === "playing" ? "⏸ พัก" : "▶ เล่น";
        if (s === "playing") { setNotice(""); refreshRates(); }       // YouTube บอกความเร็วที่ใช้ได้/ความยาว หลังเริ่มเล่นแล้วเท่านั้น
      },
    }).then((c) => {
      ctrl = c;
      playBtn.disabled = false; rateSel.disabled = false;
      refreshRates();
    }).catch((e) => { playerHost.replaceChildren(); setNotice(e.message); });

    const unsub = db.subscribe(() => { drawRounds(); if (step !== 1 && !window.getSelection()?.toString()) drawSentences(); });

    detailCleanup = () => {
      stopAllMedia();
      unsub();
      clearInterval(flushTimer);
      document.removeEventListener("visibilitychange", onHidden);
      document.removeEventListener("selectionchange", onSelect);
      stopTouch();
      flush();
      try { ctrl?.destroy(); } catch { /* */ }
    };
  }

  const unsubLib = db.subscribe(() => { if (screen === "library") drawLibrary(); });
  show();
  return () => { unsubLib(); if (detailCleanup) detailCleanup(); };
}
