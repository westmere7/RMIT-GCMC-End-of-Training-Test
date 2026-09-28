/* End-of-Training Assessment: sign-in (+ first name) → briefing, with a lobby the team can join → timed test → results.
   With nobody in the room the taker sits it alone, as before. With the team in, everyone answers the same paper;
   the taker's submit shows the answer on every screen and the taker's Next moves everyone on (see assets/group.js). */
(function () {
  "use strict";
  const A = window.Assess, G = window.Group;
  const $ = (id) => document.getElementById(id);
  const KEY = "gcmc-assessment-v2";
  const LETTERS = "ABCDEFGHIJ";
  const esc = A.escapeHtml;

  let DATA = null, S = null, meter = null, tick = null, locked = false, BYID = {};
  const QS = () => (S && S.qids ? S.qids.map((id) => BYID[id]).filter(Boolean) : []);
  const perAttempt = () => A.perAttemptOf(DATA.settings, DATA.questions.length);
  const LABELS = () => Object.assign({ left: "HR would like a word", right: "Welcome to the team" }, (DATA.settings || {}).gauge || {});
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- state (per browser tab, survives a refresh) ----------
  const PREVIEW = new URLSearchParams(location.search).has("preview");
  // teammates join at /join?r=CODE (the QR code), or open /join and type the code (on a laptop)
  const JOIN_PAGE = /^\/join\/?$/.test(location.pathname), QP = new URLSearchParams(location.search);
  const JOIN = (QP.get("join") || (JOIN_PAGE && QP.get("r")) || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const joinUrl = (code) => location.origin + "/join" + (code ? "?r=" + code : "");
  const save = () => { if (PREVIEW) return; try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: carry on in memory */ } };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const signOut = () => { try { sessionStorage.removeItem(KEY); } catch (e) {} location.reload(); };
  /** A button that's waiting on the network: a spinner, and no second click. */
  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle("is-loading", !!on); btn.disabled = !!on;
    if (on) btn.setAttribute("aria-busy", "true"); else btn.removeAttribute("aria-busy");
  }

  // ---------- group play: who's who ----------
  const MEMBER = () => !!(S && S.role === "member");
  const HOSTING = () => !!(S && S.group && S.group.live); // the taker, with the team in the room
  const GROUP = () => MEMBER() || HOSTING();
  let ROOM = null;       // the room as last seen (api/room.js snapshot)
  let ANS = {};          // answers shown so far: ANS[question index][member id] = response (member id 0 = the taker)
  let ANS_UPTO = 0;      // answers are complete for questions before this index
  let DEVICE = null;
  const auth = () => (MEMBER() ? { r: S.code, d: DEVICE } : { r: S.group.code, h: S.group.hostKey });
  const takerName = () => (ROOM && ROOM.host.name) || (HOSTING() ? S.name : "the taker");

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
    const signedIn = S && S.email;
    $("whoBox").hidden = !signedIn && !(MEMBER() && S.color); $("signOut").hidden = !signedIn;
    if (MEMBER()) $("whoEmail").textContent = S.name ? `${S.name} · Room ${S.code}` : "";
    if (signedIn) {
      $("whoEmail").textContent = S.name ? `${S.name} · ${S.email}` : S.email;
      const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
      $("dCand").textContent = S.name || "—";
      $("dDate").textContent = today;
    }
    scrollTo(0, 0);
  }

  // ---------- boot ----------
  async function boot() {
    if (PREVIEW) return startPreview();
    if (JOIN) return bootMember();
    if (JOIN_PAGE) return codeEntry();
    try {
      if (!window.crypto || !crypto.subtle) throw new Error("Open this page through the local server (Start Test.bat) or a secure (https) address.");
      DATA = await A.loadData();
    } catch (e) {
      $("bootTitle").textContent = "The assessment couldn't start"; $("bootSpinner").hidden = true;
      $("bootMsg").textContent = e.message;
      return;
    }
    const st = DATA.settings || {};
    DATA.questions.forEach((q) => { BYID[q.id] = q; });
    const n = perAttempt(), mins = st.timeLimitMinutes || 10;
    document.title = (st.title || "End-of-Training Assessment") + " · RMIT";
    $("topSubtitle").textContent = st.subtitle || "";
    $("loginCode").textContent = st.assessmentCode || ""; $("briefCode").textContent = st.assessmentCode || "";
    $("loginTitle").textContent = st.title || "End-of-Training Assessment";
    $("metaQ").textContent = n; $("metaT").textContent = mins + " minutes";
    $("dQ").textContent = n; $("dT").textContent = mins;
    const cats = new Set(DATA.questions.map(A.categoryOf));
    $("dCats").textContent = cats.size;
    $("briefLead").textContent = "A friendly check-in on everything from your onboarding.";

    S = load();
    if (S && S.role) S = null; // a joiner's tab, now without its link
    if (S && S.started && !S.qids) S = null;
    if (S && S.finished) return showResults();
    if (S && S.started) return startTest(true);
    if (S && S.email && S.name) { $("dAttempt").textContent = S.attempt || 1; show("scrBrief"); return openLobby(); }
    S = null; show("scrLogin"); $("email").focus();
  }

  // ---------- sign in: any email + any ID (testing build), then a first name if we don't have one ----------
  let pendingHash = null;
  async function lookupName(hash) {
    const legacy = (DATA.candidates || []).find((c) => c.emailSha256 === hash && c.name);
    if (legacy) return legacy.name;
    try {
      const r = await fetch("/api/people?h=" + hash, { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) return (await r.json()).name || "";
    } catch (e) { /* no API here */ }
    return "";
  }
  function guessName(email) { const g = email.split("@")[0].split(/[._-]/)[0]; return g ? g.charAt(0).toUpperCase() + g.slice(1) : ""; }

  $("loginForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = A.normEmail($("email").value), id = A.normStaffId($("staffId").value);
    const err = $("loginError"), btn = $("loginBtn");
    if (!email || !id) { err.textContent = "Enter your email and staff ID."; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "Enter a valid email address."; return; }
    err.textContent = ""; busy(btn, true);
    const hash = await A.sha256(email);

    if (!$("nameStep").hidden && pendingHash === hash) {
      const name = $("firstName").value.trim().replace(/\s+/g, " ").slice(0, 40);
      if (!name) { err.textContent = "Tell us your first name."; busy(btn, false); $("firstName").focus(); return; }
      try { await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email_sha256: hash }) }); } catch (e) { /* remembered for this session only */ }
      busy(btn, false); return enter(email, name);
    }
    const known = await lookupName(hash);
    busy(btn, false);
    if (known) return enter(email, known);
    pendingHash = hash;
    $("nameStep").hidden = false; $("firstName").value = guessName(email); $("firstName").select(); $("firstName").focus();
    btn.textContent = "Continue";
  });
  $("email").addEventListener("input", () => { if (!$("nameStep").hidden) { $("nameStep").hidden = true; $("loginBtn").textContent = "Sign in"; pendingHash = null; } });
  function enter(email, name, attempt) {
    S = { email, name, attempt: attempt || 1, started: false, finished: false }; save();
    busy($("startBtn"), false); $("startLabel").textContent = "Start assessment"; $("dAttempt").textContent = S.attempt;
    show("scrBrief");
    openLobby();
  }
  $("signOut").addEventListener("click", () => {
    const midTest = S && S.started && !S.finished;
    if (midTest && !confirm(HOSTING() ? "Sign out now? This attempt will be discarded, and the room closes for everyone." : "Sign out now? This attempt will be discarded and won't be recorded.")) return;
    clearInterval(tick); stopPolling();
    if (S && S.group && !S.finished) G.post({ action: "end", ...auth() }).catch(() => {}).then(signOut);
    else signOut();
  });

  // ---------- polling the room: one request at a time, and an older answer never overwrites a newer one ----------
  let pollTimer = null, pollEvery = 0, seq = 0, applied = 0, acting = 0, polls = 0;
  function startPolling(ms, onUpdate) {
    stopPolling(); pollEvery = ms;
    const run = async () => {
      if (!pollEvery) return;
      if (!acting) {
        const my = ++seq;
        try {
          const d = await G.get({ ...auth(), since: ANS_UPTO, ...(polls++ % 8 === 0 ? { hb: 1 } : {}) });
          if (my > applied && pollEvery) { applied = my; applyRoom(d); onUpdate(); }
        } catch (e) { if (e.status === 404 && pollEvery) { applied = my; onUpdate(e); } }
      }
      if (pollEvery) pollTimer = setTimeout(run, pollEvery);
    };
    run();
  }
  function stopPolling() { pollEvery = 0; clearTimeout(pollTimer); }
  /** A room action (POST); its answer is the newest view of the room. */
  async function roomAct(body) {
    acting++; const my = ++seq;
    try { const d = await G.post({ ...auth(), since: ANS_UPTO, ...body }); if (my > applied && d.code) { applied = my; applyRoom(d); } return d; }
    finally { acting--; }
  }
  function applyRoom(d) {
    ROOM = d;
    for (const a of d.answers || []) (ANS[a.q] = ANS[a.q] || {})[a.m] = a.r;
    ANS_UPTO = Math.max(ANS_UPTO, d.revealed || 0);
    if (d.clock && S && S.started !== false) { S.clock = d.clock; save(); }
  }

  // people on the screen: the taker (id 0, always red) first, then the team in the order they joined
  function roomPlayers() {
    if (!ROOM) return [];
    const inRoster = (m) => !ROOM.roster || ROOM.roster.includes(m.id);
    return [{ id: 0, name: ROOM.host.name, color: G.TAKER_COLOUR, taker: true, busy: ROOM.host.busy, seen: ROOM.host.seen },
      ...ROOM.members.filter(inRoster)];
  }
  const initial = (name) => esc((String(name || "?").trim()[0] || "?").toUpperCase());
  function playerLi(p, extra) {
    const me = MEMBER() ? S.memberId === p.id : p.taker;
    return `<li class="player${p.taker ? " taker" : ""}${me ? " me" : ""}" style="--c:${esc(p.color)}" data-id="${p.id}">`
      + `<span class="avatar" aria-hidden="true">${initial(p.name)}</span>`
      + `<span class="pname"><b>${esc(p.name)}</b><small>${p.taker ? "Taking the test" : me ? "You" : esc(G.colourName(p.color))}</small></span>`
      + (extra || "") + "</li>";
  }
  const away = (p) => ROOM && ROOM.now - p.seen > 25000;

  // ---------- the lobby (on the taker's briefing screen) ----------
  const lobbySeen = new Set();
  // the room loads behind a placeholder, so the page appears in one piece instead of jumping into place
  const briefLoading = (on) => { $("briefMain").classList.toggle("is-loading", on); $("briefLoading").hidden = !on; };
  async function openLobby() {
    if (!G) return;
    $("lobby").hidden = true; $("lobbyRules").hidden = true; $("briefMain").classList.remove("has-lobby");
    briefLoading(true);
    try {
      if (S.group) {
        try { applyRoom(await G.get({ ...auth(), since: 0 })); }
        catch (e) { if (e.status !== 404 && e.status !== 403) throw e; S.group = null; }
      }
      if (!S.group) {
        const d = await G.post({ action: "create", name: S.name });
        S.group = { code: d.code, hostKey: d.hostKey }; save(); applyRoom(d);
      }
    } catch (e) { S.group = null; save(); return briefLoading(false); } // group play needs the live site; offline, the test runs on its own as before
    briefLoading(false);
    if ($("scrBrief").hidden) return;
    const url = joinUrl(S.group.code);
    $("lobbyQr").innerHTML = G.qrSvg(url);
    $("lobbyCode").textContent = S.group.code;
    $("lobbyUrl").textContent = joinUrl().replace(/^https?:\/\//, ""); $("lobbyUrl").href = url;
    $("lobbyRules").innerHTML = pointsHtml(); $("lobbyRules").hidden = false;
    $("briefLead").textContent = "A friendly check-in on everything from your onboarding. Bring the team along if you like: they can scan in.";
    $("startNote").textContent = "Start when everyone's in. Each question moves on when you submit it.";
    lobbySeen.clear(); $("lobby").hidden = false; $("briefMain").classList.add("has-lobby"); renderLobby();
    startPolling(1500, (gone) => { if (gone) return openLobby(); renderLobby(); });
  }
  // the QR code, big: click it to show it across the room
  $("lobbyQr").addEventListener("click", () => {
    if (!S || !S.group) return;
    $("qrPopQr").innerHTML = G.qrSvg(joinUrl(S.group.code));
    $("qrPopCode").textContent = S.group.code;
    $("qrPopUrl").textContent = joinUrl().replace(/^https?:\/\//, "");
    $("qrPop").showModal();
  });
  $("qrPopClose").addEventListener("click", () => $("qrPop").close());
  $("qrPop").addEventListener("click", (e) => { if (e.target === $("qrPop")) $("qrPop").close(); }); // a click outside it
  $("lobbyCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(joinUrl(S.group.code)); $("lobbyCopy").textContent = "Copied"; } catch (e) { $("lobbyCopy").textContent = "Copy failed"; }
    setTimeout(() => { $("lobbyCopy").textContent = "Copy link"; }, 1600);
  });
  function renderLobby() {
    if (!ROOM || $("lobby").hidden) return;
    const ms = ROOM.members, n = ms.length;
    $("lobbyN").textContent = n + 1;
    $("lobbySub").textContent = n ? `${n} ${n === 1 ? "teammate is" : "teammates are"} in. Start when everyone's here.` : "Waiting for the team to scan in. Or start on your own.";
    $("lobbyList").innerHTML = roomPlayers().map((p) => {
      const li = playerLi(p, p.taker ? "" : `<button type="button" class="kick" data-kick="${p.id}" aria-label="Remove ${esc(p.name)}" title="Remove from the room">×</button>`);
      return lobbySeen.has(p.id) ? li : li.replace('class="player', 'class="player new');
    }).join("")
      // empty seats, until someone scans in
      + (n ? "" : '<li class="player ghost" aria-hidden="true"><span class="avatar"></span><span class="pname"><b>Waiting…</b></span></li>'.repeat(3));
    for (const li of $("lobbyList").querySelectorAll("[data-id]")) { if (away(roomPlayers().find((p) => p.id === +li.dataset.id) || {})) li.classList.add("away"); lobbySeen.add(+li.dataset.id); }
    $("startLabel").textContent = n ? `Start with ${n} ${n === 1 ? "teammate" : "teammates"}` : "Start assessment";
  }
  $("lobbyList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-kick]"); if (!b) return;
    busy(b, true);
    try { await roomAct({ action: "kick", m: +b.dataset.kick }); renderLobby(); } catch (err) { b.disabled = false; }
  });
  // the points rules in four lines: right and wrong, for the taker and for everyone else
  function pointsHtml() {
    const name = esc(S.name || "the taker"), T = G.RULES.taker, M = G.RULES.member;
    const range = (a, b) => `${G.signed(a)}<i>to</i>${G.signed(b)}`;
    const row = (ok, cls, pts, text) => `<p class="pts-row"><span class="mark ${ok ? "y" : "n"}" aria-label="${ok ? "Right" : "Wrong"}"></span><b class="${cls}">${pts}</b><span>${text}</span></p>`;
    return `<div class="pts-head"><h2 class="pts-title">How points work</h2>
        <p class="pts-note"><span class="crit-chip">Critical</span> questions count double · No answer when ${name} submits counts as wrong</p></div>
      <div class="pts-who">
        <h3><span class="av" style="--c:${G.TAKER_COLOUR}" aria-hidden="true">${initial(S.name)}</span>${name}</h3>
        ${row(true, "up", range(T.right.allRight, T.right.allWrong), "more for each teammate who got it wrong")}
        ${row(false, "down", range(T.wrong.allRight, T.wrong.allWrong), "less of a loss for each teammate who got it wrong too")}
      </div>
      <div class="pts-who">
        <h3><span class="team-dots" aria-hidden="true"><i></i><i></i><i></i></span>Everyone else</h3>
        ${row(true, "up", G.signed(M.right), "every time")}
        ${row(false, "down", G.signed(M.wrongTakerRight), `if ${name} got it right, ${G.signed(M.wrongTakerWrong)} if not`)}
      </div>`;
  }

  // ---------- briefing ----------
  $("startBtn").addEventListener("click", () => startTest(false));

  function orderFor(q, st) {
    const seq = (n) => [...Array(n).keys()];
    if (q.type === "match") {
      // Column B is always shuffled, and never lined up straight across from Column A
      const n = (q.pairs || []).length, a = st.shuffleOptions ? A.shuffle(seq(n)) : seq(n);
      let b = A.shuffle(seq(n));
      for (let t = 0; n > 1 && t < 20 && b.some((x, k) => x === a[k]); t++) b = A.shuffle(seq(n));
      return { a, b };
    }
    return q.options ? (st.shuffleOptions ? A.shuffle(seq(q.options.length)) : seq(q.options.length)) : null;
  }

  // ---------- preview: the editor shows one question here, exactly as candidates see it. Nothing is saved or sent. ----------
  function startPreview() {
    document.documentElement.classList.add("preview");
    $("bootTitle").textContent = "Loading the preview…"; $("bootMsg").textContent = "";
    addEventListener("message", (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== "preview") return;
      const q = e.data.question, st = e.data.settings || {};
      DATA = { questions: [q], settings: st }; BYID = { [q.id]: q };
      S = { preview: true, name: e.data.name || "Preview", qids: [q.id], index: 0, responses: {}, order: [orderFor(q, st)],
        startedAt: Date.now(), limitMs: (st.timeLimitMinutes || 10) * 60000 };
      show("scrTest");
      meter = meter || new Meter($("meter"), $("lamp"), LABELS());
      meter.setThreshold(st.confettiThreshold); meter.onGreen = null;
      meter.resize(); meter.setName(S.name); meter.setScore(0); meter.start();
      const mins = st.timeLimitMinutes || 10;
      $("digits").textContent = String(mins).padStart(2, "0") + ":00"; $("tFill").style.width = "100%";
      $("timerSub").textContent = "The clock doesn't run in a preview";
      renderQuestion();
      requestAnimationFrame(() => scrollTo(0, Math.max(0, $("qCard").getBoundingClientRect().top + scrollY - 90))); // straight to the question
    });
    parent.postMessage({ type: "preview-ready" }, location.origin);
  }
  // the right answer, naming options by the letters shown on screen (not their order in the editor)
  function rightText(q) {
    const ord = S.order[S.index];
    if (A.isChoiceQ(q) && Array.isArray(ord)) return (q.correct || []).map((i) => LETTERS[ord.indexOf(i)] + (A.imageAnswers(q) ? "" : ". " + q.options[i])).join(" · ");
    return A.correctText(q);
  }
  function previewResult(q, resp, correct, skipped) {
    const st = $("qStatus"); st.className = "status preview-res " + (correct ? "ok" : "no");
    st.innerHTML = (correct ? "<b>✓ Correct</b>" : `<b>${skipped ? "Skipped" : "✕ Not quite"}</b><span>Correct answer: ${esc(rightText(q))}</span>`)
      + '<button type="button" class="btn ghost small" id="previewAgain">Try again</button>';
    $("previewAgain").onclick = () => { S.responses = {}; S.order = [orderFor(q, DATA.settings || {})]; meter.setScore(0); updateProgress(); renderQuestion(); };
  }

  async function startTest(resume) {
    const st = DATA.settings || {};
    if (!resume) {
      const qids = A.drawQuestions(DATA.questions, perAttempt(), A.criticalShareOf(st));
      const order = qids.map((id) => orderFor(BYID[id], st)), limitMs = (st.timeLimitMinutes || 10) * 60000;
      if (S.group) {
        // the same paper, in the same order, for everyone in the room
        const btn = $("startBtn"); busy(btn, true); $("startLabel").textContent = "Starting…"; $("startError").textContent = "";
        stopPolling();
        try {
          const paper = { questions: qids.map((id) => BYID[id]), order, limitMs,
            settings: { title: st.title, assessmentCode: st.assessmentCode, categories: A.categoriesOf(st), gauge: st.gauge, confettiThreshold: st.confettiThreshold } };
          const d = await roomAct({ action: "start", paper });
          if (d.solo) S.group = null; // nobody joined: on your own, as before
          else S.group.live = true;
        } catch (e) {
          $("startError").textContent = "Couldn't start the room: " + e.message; busy(btn, false);
          startPolling(1500, (gone) => { if (gone) return openLobby(); renderLobby(); });
          return renderLobby();
        }
      }
      S.started = true; S.startedAt = Date.now(); S.index = 0; S.responses = {};
      S.limitMs = limitMs; S.qids = qids; S.order = order;
      if (HOSTING()) S.clock = ROOM.clock;
      save();
    }
    show("scrTest");
    meter = meter || new Meter($("meter"), $("lamp"), LABELS());
    meter.setThreshold((DATA.settings || {}).confettiThreshold); meter.greenLit = score().p >= (meter.pg || 0.9);
    meter.onGreen = (pt) => confetti({ x: pt.x, y: pt.y, n: 90, life: 2.6 });
    meter.resize(); meter.setName(S.name); meter.setScore(score().p); meter.start();
    renderQuestion(); runClock();
    if (HOSTING()) { renderPlayers(); startPolling(1000, (gone) => (gone ? roomGone() : syncTaker())); }
  }

  // ---------- scoring ----------
  function score() {
    let c = 0, w = 0, crit = 0;
    QS().forEach((q) => { const r = S.responses[q.id]; if (!r) return; if (r.correct) c++; else { w++; if (q.critical) crit++; } });
    return { c, w, crit, p: A.meterReading(c, w, crit, QS().length) };
  }
  // does the viewer's own share of right answers earn the distinction (the meter's confetti threshold)?
  const distinctionFor = (c, n) => (100 * c) / Math.max(1, n) >= ((DATA.settings || {}).confettiThreshold || 95);

  /** Everyone's points, question by question. Questions the room never reached score nothing for anyone. */
  function tally() {
    const qs = QS(), players = GROUP() ? roomPlayers() : [{ id: 0, name: S.name, color: G.TAKER_COLOUR, taker: true }];
    const reached = GROUP() ? (ROOM ? ROOM.revealed : 0) : qs.length;
    const rows = players.map((p) => ({ ...p, points: 0, correct: 0, crit: 0, cells: [], deltas: [] }));
    const members = rows.filter((r) => !r.taker);
    qs.forEach((q, k) => {
      const given = (id) => {
        if (!GROUP()) { const r = S.responses[q.id]; return r ? { r: r.response, skipped: r.skipped } : null; }
        const a = ANS[k] || {}; return id in a ? { r: a[id], skipped: a[id] == null } : null;
      };
      const right = rows.map((p) => { const g = given(p.id); return !!g && !g.skipped && A.isCorrect(q, g.r); });
      const pts = k < reached ? G.points(q.critical, right[0], right.slice(1)) : { taker: 0, members: members.map(() => 0) };
      rows.forEach((p, i) => {
        const g = given(p.id), d = i === 0 ? pts.taker : pts.members[i - 1];
        p.points += d; p.deltas.push(k < reached ? d : null);
        if (right[i]) p.correct++; else if (q.critical && k < reached) p.crit++;
        p.cells.push(k >= reached ? "none" : right[i] ? "ok" : !g || g.skipped ? "skip" : "no");
      });
    });
    return { rows, reached };
  }

  // ---------- clock (the room's clock in group play: it stops while an answer is on show) ----------
  function remaining() { return GROUP() ? G.remaining(S.clock) : Math.max(0, S.limitMs - (Date.now() - S.startedAt)); }
  const paused = () => GROUP() && S.clock && !S.clock.runningSince;
  function runClock() {
    clearInterval(tick);
    const upd = () => {
      if (!S || S.finished) return clearInterval(tick);
      const ms = remaining(), s = Math.ceil(ms / 1000), limit = GROUP() && S.clock ? S.clock.limitMs : S.limitMs;
      $("digits").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      $("tFill").style.width = Math.max(0, (100 * ms) / limit) + "%";
      $("timer").classList.toggle("warn", s <= 60); $("timer").classList.toggle("critical", s <= 30 && !paused());
      $("timer").classList.toggle("paused", !!paused());
      $("timerSub").textContent = paused() ? "Paused while the answer is on show"
        : s <= 60 ? "Final minute. Unanswered questions will be marked incorrect." : "Submits automatically at 00:00";
      if (ms <= 0 && !paused()) {
        if (MEMBER()) { if (!locked) { locked = true; $("qCard").classList.add("locked"); $("submitBtn").disabled = true; setStatus("recorded", `Time's up. Waiting for ${takerName()}…`); } return; }
        clearInterval(tick); finish(true);
      }
    };
    upd(); tick = setInterval(upd, 250);
  }

  // ---------- progress ----------
  function updateProgress() {
    const n = QS().length, done = Object.keys(S.responses).length;
    $("count").innerHTML = `${done} <small>of ${n} answered</small>`;
    $("barFill").style.width = (100 * done) / n + "%";
  }
  const setStatus = (cls, html) => { $("qStatus").className = "status " + cls; $("qStatus").innerHTML = html; };

  // ---------- questions ----------
  let current = null; // the in-progress response for the question on screen
  let revealShown = false, busySent = false;
  function renderQuestion() {
    locked = false; revealShown = false; busySent = false; draftSent = ""; clearTimeout(draftTimer);
    const q = QS()[S.index], n = QS().length;
    $("qCard").classList.remove("locked", "revealed");
    $("qNo").textContent = String(S.index + 1).padStart(2, "0"); $("qOfN").textContent = `of ${n}`;
    $("qType").textContent = A.TYPE_LABEL[q.type] || "Question";
    $("qTopic").textContent = A.categoryOf(q);
    $("qCard").classList.toggle("critical", !!q.critical);
    $("critNotice").hidden = !q.critical;
    $("critNoticeText").textContent = GROUP() ? "Points count double here, right or wrong." : "It's worth 2 points instead of 1.";
    $("qMarks").innerHTML = q.critical ? `<span class="crit-chip">Critical</span><small>${GROUP() ? "Points ×2, right or wrong" : "2 points"}</small>` : GROUP() ? "Points ×1" : "1 point";
    setStatus("", MEMBER() ? `<span class="hint">Not submitted when ${esc(takerName())} submits? Your pick still counts.</span>` : '<span class="kbd">Press <b>Enter</b> to submit</span>');
    busy($("submitBtn"), false); busy($("skipBtn"), false); busy($("nextBtn"), false);
    $("submitBtn").hidden = false; $("skipBtn").hidden = MEMBER(); $("nextBtn").hidden = true;
    const body = $("qBody"); body.innerHTML = "";
    current = A.isChoiceQ(q) ? [] : q.type === "match" ? (q.pairs || []).map(() => null) : "";
    $("qCard").dataset.type = q.type;

    if (q.type === "fill") {
      const parts = String(q.prompt).split(/_{3,}/);
      const p = document.createElement("p"); p.className = "q-prompt fill";
      p.append(parts[0] || "");
      const inp = document.createElement("input");
      inp.className = "blank"; inp.id = "answerInput"; inp.maxLength = 40; inp.autocomplete = "off"; inp.spellcheck = false; inp.setAttribute("aria-label", "Your answer");
      // the gap grows with the answer, so a long word never scrolls out of sight
      inp.addEventListener("input", () => { current = inp.value; inp.style.setProperty("--len", inp.value.length); $("submitBtn").disabled = !A.normalize(current); reportBusy(); });
      p.append(inp, parts.slice(1).join("___") || "");
      body.append(p); setTimeout(() => inp.focus(), 30);
    } else {
      const p = document.createElement("p"); p.className = "q-prompt"; p.textContent = q.prompt; body.append(p);
      if (q.type === "image" && !A.imageAnswers(q) && q.image) {
        const fig = document.createElement("figure"); fig.className = "q-figure";
        const img = new Image(); img.src = q.image; img.alt = "The picture for this question"; img.decoding = "async";
        fig.append(img); body.append(fig);
      }
      if (q.type === "short") {
        const wrap = document.createElement("div"); wrap.className = "short-answer";
        wrap.innerHTML = '<input class="input" id="answerInput" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Type your answer" aria-label="Your answer"><small>One word or a short phrase. Capitals and punctuation don\'t matter.</small>';
        body.append(wrap);
        const inp = wrap.querySelector("input");
        inp.addEventListener("input", () => { current = inp.value; $("submitBtn").disabled = !A.normalize(current); reportBusy(); });
        setTimeout(() => inp.focus(), 30);
      } else if (q.type === "match") {
        body.append(renderMatch(q));
      } else {
        // say how many to pick, where it can't be missed: one (round keys) or all that apply (square ticks, with a running count)
        const multi = A.isMultiPick(q), pics = A.imageAnswers(q);
        const how = document.createElement("p"); how.className = "pick-how " + (multi ? "multi" : "single"); how.id = "pickHow";
        how.innerHTML = multi
          ? '<span class="pick-icon" aria-hidden="true"></span><b>Select all that apply</b><span class="pick-count" id="pickCount">None selected</span>'
          : `<span class="pick-icon" aria-hidden="true"></span><b>Choose one ${pics ? "picture" : "answer"}</b>`;
        body.append(how);
        const grid = document.createElement("div"); grid.className = "options" + (pics ? " pictures" : ""); grid.setAttribute("role", multi ? "group" : "radiogroup");
        grid.setAttribute("aria-describedby", "pickHow");
        S.order[S.index].forEach((orig, k) => {
          const b = document.createElement("button");
          b.type = "button"; b.className = "opt" + (multi ? " multi" : "") + (pics ? " pic" : "");
          b.setAttribute("role", multi ? "checkbox" : "radio"); b.setAttribute("aria-checked", "false");
          b.dataset.orig = orig;
          b.innerHTML = pics
            ? `<span class="key">${LETTERS[k]}</span><img src="${esc(q.options[orig])}" alt="Picture ${LETTERS[k]}" decoding="async" draggable="false">`
            : `<span class="key">${LETTERS[k]}</span><span>${esc(q.options[orig])}</span>`;
          b.addEventListener("click", () => toggle(q, b));
          grid.append(b);
        });
        body.append(grid);
      }
    }
    $("submitBtn").disabled = true;
    updateProgress();
    if (MEMBER() && ROOM && ROOM.mine && ROOM.index === S.index && ROOM.phase === "question") answerIn(q, ROOM.mine.r);
  }

  // tell the room whether you've started on this question (Thinking… → Answering…); a teammate also sends what
  // they've picked so far, which counts as their answer if the taker submits before they do
  let draftTimer = null, draftSent = "";
  function reportBusy() {
    if (!GROUP() || locked) return;
    const on = Array.isArray(current) ? current.some((x) => x != null) : !!A.normalize(current);
    if (MEMBER()) {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        const draft = on ? JSON.stringify(current) : "";
        if (locked || draft === draftSent) return;
        draftSent = draft;
        G.post({ action: "busy", ...auth(), q: S.index, busy: on, draft: on ? current : null }).catch(() => { draftSent = ""; });
      }, 200);
      return;
    }
    if (on === busySent) return;
    busySent = on;
    G.post({ action: "busy", ...auth(), q: S.index, busy: on }).catch(() => {});
  }

  function toggle(q, b) {
    if (locked) return;
    const orig = +b.dataset.orig;
    if (!A.isMultiPick(q)) {
      current = [orig];
      for (const o of document.querySelectorAll(".opt")) o.setAttribute("aria-checked", String(+o.dataset.orig === orig));
    } else {
      const on = b.getAttribute("aria-checked") !== "true";
      b.setAttribute("aria-checked", String(on));
      current = on ? [...current, orig] : current.filter((x) => x !== orig);
      const pc = $("pickCount"); if (pc) pc.textContent = current.length ? `${current.length} selected` : "None selected";
    }
    $("submitBtn").disabled = !current.length;
    reportBusy();
  }

  // Match the pairs: a board with Column A on the left and Column B on the right. Click an item, then its match on the
  // other side (either way round), or drag from one to the other; a line joins each pair, in its own colour, and both
  // ends carry the same number. Linking a taken item moves the link; linking the same pair again undoes it.
  // current[p] = the pair index of the B item linked to pair p's A item.
  const LINK_COLOURS = ["#000054", "#0b7a8f", "#7a3e9d", "#b0620b", "#b8336a", "#3f7a1f", "#4b5c8a", "#8a5a2b"];
  function renderMatch(q) {
    const ord = S.order[S.index] || { a: [], b: [] };
    const NS = "http://www.w3.org/2000/svg";
    const wrap = document.createElement("div"); wrap.className = "match";
    wrap.innerHTML = '<div class="match-top"><p class="pick-how match"><span class="pick-icon" aria-hidden="true"></span><b>Link each item in A to its match in B</b><span class="pick-count" id="pickCount"></span></p>'
      + '<button type="button" class="match-reset" id="matchReset" hidden>Start over</button></div>'
      + '<p class="match-tip" id="matchTip" aria-live="polite"></p>';
    const board = document.createElement("div"); board.className = "match-board";
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "match-lines"); svg.setAttribute("aria-hidden", "true");
    const colA = document.createElement("div"); colA.className = "match-col a"; colA.innerHTML = "<h4><span>A</span></h4>";
    const colB = document.createElement("div"); colB.className = "match-col b"; colB.innerHTML = "<h4><span>B</span></h4>";
    const item = (side, p, i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "match-item " + side; b.dataset.side = side; b.dataset.p = p;
      b.innerHTML = side === "a"
        ? `<span class="mi-n">${i + 1}</span><span class="t">${esc(q.pairs[p].left)}</span><span class="dot"></span>`
        : `<span class="dot"></span><span class="t">${esc(q.pairs[p].right)}</span><span class="mi-n"></span>`;
      return b;
    };
    const aEls = ord.a.map((p, i) => item("a", p, i)), bEls = ord.b.map((p) => item("b", p));
    colA.append(...aEls); colB.append(...bEls); board.append(svg, colA, colB); wrap.append(board);

    let active = null, pointer = null, drag = null, justDragged = false;
    const touch = matchMedia("(pointer: coarse)").matches;
    const numOf = (ap) => ord.a.indexOf(ap); // display position of an A item
    const colourOf = (ap) => LINK_COLOURS[numOf(ap) % LINK_COLOURS.length];
    const textOf = (side, p) => (side === "a" ? q.pairs[p].left : q.pairs[p].right);
    function link(ap, bp) {
      if (current[ap] === bp) current[ap] = null; // the same pair again: undo it
      else { current = current.map((x) => (x === bp ? null : x)); current[ap] = bp; }
      active = null; paint();
    }
    function choose(side, p) {
      if (locked) return;
      if (active && active.side !== side) return side === "b" ? link(active.p, p) : link(p, active.p);
      active = active && active.side === side && active.p === p ? null : { side, p };
      paint();
    }
    // pointer: a click picks; a drag from one side to the other links
    board.addEventListener("pointerdown", (e) => {
      // touch taps (no drag), so a finger on an item can still scroll the page
      const it = e.target.closest(".match-item"); if (!it || locked || e.button > 0 || e.pointerType === "touch") return;
      drag = { side: it.dataset.side, p: +it.dataset.p, x: e.clientX, y: e.clientY, moved: false };
    });
    const onMove = (e) => {
      if (!board.isConnected) return removeEventListener("pointermove", onMove);
      const r = board.getBoundingClientRect();
      pointer = e.clientX >= r.left - 40 && e.clientX <= r.right + 40 && e.clientY >= r.top - 40 && e.clientY <= r.bottom + 40 ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
      if (drag && !drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) { drag.moved = true; active = { side: drag.side, p: drag.p }; board.classList.add("dragging"); paint(); }
      if (active) drawLines();
    };
    const onUp = (e) => {
      if (!board.isConnected) return removeEventListener("pointerup", onUp);
      if (!drag) return;
      const d = drag; drag = null; board.classList.remove("dragging");
      if (!d.moved) return;
      justDragged = true; setTimeout(() => { justDragged = false; }, 0);
      const over = document.elementFromPoint(e.clientX, e.clientY), it = over && over.closest(".match-item");
      if (it && board.contains(it) && it.dataset.side !== d.side) choose(it.dataset.side, +it.dataset.p);
      else { active = null; paint(); }
    };
    addEventListener("pointermove", onMove); addEventListener("pointerup", onUp);
    board.addEventListener("click", (e) => {
      const it = e.target.closest(".match-item"); if (!it || justDragged) return;
      choose(it.dataset.side, +it.dataset.p);
    });
    board.addEventListener("keydown", (e) => { if (e.key === "Escape" && active) { active = null; paint(); } });
    wrap.querySelector("#matchReset").addEventListener("click", () => { if (locked) return; current = current.map(() => null); active = null; paint(); });

    function dotOf(el) {
      const r = el.querySelector(".dot").getBoundingClientRect(), br = board.getBoundingClientRect();
      return { x: r.left + r.width / 2 - br.left, y: r.top + r.height / 2 - br.top };
    }
    const curve = (a, b) => { const dx = Math.max(30, Math.abs(b.x - a.x) * 0.45); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
    function drawLines() {
      svg.setAttribute("width", board.clientWidth); svg.setAttribute("height", board.clientHeight);
      svg.innerHTML = "";
      ord.a.forEach((ap, i) => {
        const bp = current[ap]; if (bp == null) return;
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", curve(dotOf(aEls[i]), dotOf(bEls[ord.b.indexOf(bp)]))); path.setAttribute("stroke", colourOf(ap));
        svg.append(path);
      });
      // the line being drawn, from the picked item to the pointer
      if (active && pointer) {
        const from = dotOf(active.side === "a" ? aEls[ord.a.indexOf(active.p)] : bEls[ord.b.indexOf(active.p)]);
        const path = document.createElementNS(NS, "path"); path.setAttribute("class", "pending");
        path.setAttribute("d", active.side === "a" ? curve(from, pointer) : curve(pointer, from));
        svg.append(path);
      }
    }
    function paint() {
      aEls.forEach((el, i) => {
        const ap = ord.a[i], on = current[ap] != null, act = !!active && active.side === "a" && active.p === ap;
        el.classList.toggle("linked", on); el.classList.toggle("active", act);
        el.style.setProperty("--c", on ? colourOf(ap) : "");
        el.setAttribute("aria-pressed", String(act));
        el.setAttribute("aria-label", `A${i + 1}: ${q.pairs[ap].left}` + (on ? `, linked to ${q.pairs[current[ap]].right}` : ", not linked"));
      });
      bEls.forEach((el, k) => {
        const bp = ord.b[k], ap = ord.a.find((x) => current[x] === bp), on = ap != null, act = !!active && active.side === "b" && active.p === bp;
        el.classList.toggle("linked", on); el.classList.toggle("active", act);
        el.style.setProperty("--c", on ? colourOf(ap) : "");
        el.querySelector(".mi-n").textContent = on ? numOf(ap) + 1 : "";
        el.setAttribute("aria-pressed", String(act));
        el.setAttribute("aria-label", `B: ${q.pairs[bp].right}` + (on ? `, linked to A${numOf(ap) + 1}` : ", not linked"));
      });
      board.classList.toggle("picking-a", !!active && active.side === "b");
      board.classList.toggle("picking-b", !!active && active.side === "a");
      const n = current.filter((x) => x != null).length;
      $("pickCount").textContent = `${n} of ${current.length} linked`;
      $("matchReset").hidden = !n;
      $("matchTip").innerHTML = active
        ? `Now pick the match for <b>${esc(textOf(active.side, active.p))}</b> in ${active.side === "a" ? "B" : "A"}.`
        : n === current.length ? `All linked. ${touch ? "Tap" : "Click"} a pair again to undo it, or submit.`
        : touch ? "Tap an item, then its match on the other side." : "Click an item, then its match on the other side. You can also drag between them.";
      $("submitBtn").disabled = locked || n < current.length;
      drawLines();
      reportBusy();
    }
    new ResizeObserver(() => drawLines()).observe(board);
    setTimeout(paint, 0);
    return wrap;
  }

  function submit(skipped) {
    if (locked) return;
    const q = QS()[S.index];
    const resp = skipped ? null : current;
    if (!skipped && (Array.isArray(resp) ? !resp.length || resp.some((x) => x == null) : !A.normalize(resp))) return;
    locked = true;
    $("qCard").classList.add("locked"); $("submitBtn").disabled = true;
    if (MEMBER()) return memberSubmit(q, resp);
    if (HOSTING()) return hostReveal(q, resp, skipped);
    const correct = !skipped && A.isCorrect(q, resp);
    S.responses[q.id] = { response: resp, correct, skipped: !!skipped, at: Date.now() };
    save();
    if (S.preview) {
      meter.setScore(score().p); meter.kick(correct ? 1 : -1); updateProgress();
      return previewResult(q, resp, correct, skipped);
    }
    setStatus("recorded", skipped ? "Skipped" : "Answer recorded");
    bounce(q, correct);
    updateProgress();
    setTimeout(() => {
      if (S.index >= QS().length - 1) return finish(false);
      S.index++; save(); renderQuestion();
    }, 850);
  }
  function bounce(q, correct) {
    if (!meter) return;
    meter.setScore(score().p);
    // roughly one answer in four gets a harder bounce, never two in a row
    const hard = (q.critical && !correct) || (!S.lastJolt && Math.random() < 0.25);
    S.lastJolt = hard; save();
    if (hard) meter.jolt(correct ? 1 : -1); else meter.kick(correct ? 1 : -1);
  }
  $("submitBtn").addEventListener("click", () => submit(false));
  $("skipBtn").addEventListener("click", () => submit(true));
  $("nextBtn").addEventListener("click", () => nextQuestion());

  document.addEventListener("keydown", (e) => {
    if ($("scrTest").hidden) return;
    if (locked) {
      if (e.key === "Enter" && HOSTING() && revealShown && !$("nextBtn").disabled && !(e.target.closest && e.target.closest("button"))) { e.preventDefault(); nextQuestion(); }
      return;
    }
    const q = QS()[S.index];
    if (e.key === "Enter" && e.target.closest && e.target.closest(".match-item")) return; // Enter picks a match item
    if (e.key === "Enter") { e.preventDefault(); if (!$("submitBtn").disabled) submit(false); return; }
    if (A.isChoiceQ(q) && !e.ctrlKey && !e.metaKey && !e.altKey && e.target.tagName !== "INPUT") {
      const k = LETTERS.indexOf(e.key.toUpperCase());
      const opts = document.querySelectorAll(".opt");
      if (k >= 0 && k < opts.length) { e.preventDefault(); toggle(q, opts[k]); }
    }
  });

  // ---------- group play: the taker's side ----------
  async function hostReveal(q, resp, skipped) {
    $("skipBtn").disabled = true; busy(skipped ? $("skipBtn") : $("submitBtn"), true); setStatus("", "Showing everyone the answer…");
    try { await roomAct({ action: "reveal", q: S.index, response: resp }); }
    catch (e) {
      busy($("submitBtn"), false); busy($("skipBtn"), false);
      locked = false; $("qCard").classList.remove("locked");
      return setStatus("error", "Couldn't reach the room. Try again.");
    }
    const correct = !skipped && A.isCorrect(q, resp);
    S.responses[q.id] = { response: resp, correct, skipped: !!skipped, at: Date.now() }; save();
    bounce(q, correct); updateProgress();
    busy($("submitBtn"), false); busy($("skipBtn"), false);
    syncTaker();
  }
  async function nextQuestion() {
    if (!HOSTING() || !revealShown || $("nextBtn").disabled) return;
    busy($("nextBtn"), true);
    try { await roomAct({ action: "next", q: S.index }); }
    catch (e) { busy($("nextBtn"), false); return setStatus("error", "Couldn't reach the room. Try again."); }
    if (ROOM.phase !== "finished") busy($("nextBtn"), false); // the last one keeps spinning while the results come in
    syncTaker();
  }
  // bring the taker's screen in line with the room (after a refresh, an action, or a poll)
  function syncTaker() {
    if (!ROOM || S.finished) return;
    if (ROOM.phase === "finished") return finish(!!ROOM.timedOut);
    if (ROOM.index !== S.index) { S.index = ROOM.index; save(); renderQuestion(); }
    if (ROOM.phase === "reveal" && !revealShown) {
      const q = QS()[S.index], a = ANS[S.index] || {};
      if (!S.responses[q.id] && 0 in a) S.responses[q.id] = { response: a[0], correct: a[0] != null && A.isCorrect(q, a[0]), skipped: a[0] == null }; // refreshed mid-reveal
      showReveal();
    }
    renderPlayers();
  }
  function roomGone() {
    stopPolling(); clearInterval(tick);
    setStatus("error", "The room has closed.");
    if (MEMBER()) return memberScreen("closed", "This room has closed", "The test was ended. Thanks for playing along.");
    // the taker's room vanished (it's pruned after two days): finish on your own from here
    S.group.live = false; save(); runClock(); renderPlayers(); renderQuestion();
  }

  // the answer, on every screen, with what it did to everyone's points
  function showReveal() {
    const q = QS()[S.index], k = S.index;
    revealShown = true; locked = true;
    $("qCard").classList.add("locked", "revealed");
    $("submitBtn").hidden = true; $("skipBtn").hidden = true;
    if (A.isChoiceQ(q)) {
      const right = new Set(q.correct || []);
      for (const o of document.querySelectorAll(".opt")) {
        const i = +o.dataset.orig;
        o.classList.toggle("is-right", right.has(i));
        o.classList.toggle("is-wrong", !right.has(i) && o.getAttribute("aria-checked") === "true");
      }
    }
    const t = tally(), id = MEMBER() ? S.memberId : 0, me = t.rows.find((r) => r.id === id) || t.rows[0];
    const cell = me.cells[k], d = me.deltas[k] || 0;
    const head = cell === "ok" ? "<b>✓ Right</b>" : cell === "skip" ? `<b>✕ ${MEMBER() ? "No answer in time" : "Skipped"}</b>` : "<b>✕ Wrong</b>";
    const pts = `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${G.signed(d)}</span>`;
    const ans = cell === "ok" ? "" : `<span>Correct answer: ${esc(rightText(q))}</span>`;
    setStatus("reveal " + (cell === "ok" ? "ok" : "no"), head + pts + ans);
    if (HOSTING()) {
      $("nextBtn").hidden = false; $("nextBtn").disabled = false;
      $("nextLabel").textContent = S.index >= QS().length - 1 ? "See the results" : "Next question";
      setTimeout(() => $("nextBtn").focus({ preventScroll: true }), 30);
    } else $("qStatus").insertAdjacentHTML("beforeend", `<span class="wait">Everyone's results are on the main screen. Waiting for ${esc(takerName())} to move on…</span>`);
    updateProgress(); renderPlayers();
  }

  // the side panel during the test: everyone's status on this question, and their points so far
  function renderPlayers() {
    const card = $("playersCard");
    card.hidden = !GROUP() || !ROOM;
    if (card.hidden) return;
    const k = S.index, phase = ROOM.phase, t = tally(), shown = (phase === "reveal" || phase === "finished") && ROOM.index === k;
    const answered = new Set(ROOM.answered || []);
    $("playersList").innerHTML = t.rows.map((p) => {
      let st;
      if (shown) {
        const c = p.cells[k], d = p.deltas[k] || 0;
        st = `<span class="pstat ${c === "ok" ? "ok" : "no"}">${c === "ok" ? "✓ Right" : c === "skip" ? "✕ No answer" : "✕ Wrong"}</span><span class="delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${G.signed(d)}</span>`;
      } else {
        const done = !p.taker && answered.has(p.id), busy = p.busy === k;
        st = `<span class="pstat ${done ? "done" : busy ? "busy" : "think"}">${done ? "Answered" : busy ? "Answering…" : "Thinking…"}</span>`;
      }
      return playerLi(p, `<span class="pwhat">${st}</span><span class="ptotal" title="Points so far">${G.signed(p.points)}</span>`);
    }).join("");
    for (const li of $("playersList").children) { const p = t.rows.find((r) => r.id === +li.dataset.id); if (p && away(p)) li.classList.add("away"); }
  }

  // ---------- group play: everyone else's side (opened from the QR code) ----------
  function memberScreen(state, title, lead) {
    show("scrJoin");
    $("joinCode").textContent = JOIN;
    $("joinTitle").textContent = title; $("joinLead").textContent = lead || "";
    $("joinForm").hidden = state !== "form"; $("joinWait").hidden = state !== "wait"; $("codeForm").hidden = state !== "code";
    $("joinRoom").hidden = state === "closed" || state === "code" || !ROOM;
    $("joinAgain").hidden = state !== "closed" || !JOIN;
  }
  async function bootMember() {
    document.documentElement.classList.add("joiner");
    DEVICE = G.deviceId();
    S = { role: "member", code: JOIN };
    memberScreen("closed", "Finding the room…");
    try { applyRoom(await G.get({ ...auth(), since: 0 })); }
    catch (e) { return memberScreen("closed", e.status === 404 ? "This room has closed" : "Couldn't reach the room", e.status === 404 ? "Check the code, or ask for a new QR code." : e.message); }
    let name = ""; try { name = localStorage.getItem("gcmc-member-name") || ""; } catch (e) {}
    $("joinName").value = (ROOM.me && ROOM.me.name) || name;
    syncMember();
    startPolling(1200, (gone) => (gone ? roomGone() : syncMember()));
  }
  // /join on its own: type the room code (for a laptop, which can't scan the QR code)
  function codeEntry() {
    document.documentElement.classList.add("joiner");
    memberScreen("code", "Join a test", "Type the room code from the main screen.");
    $("joinCode").textContent = "code";
    setTimeout(() => $("codeInput").focus(), 30);
  }
  $("codeInput").addEventListener("input", (e) => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (e.target.value !== v) e.target.value = v;
    $("codeError").textContent = "";
    if (v.length === 5) $("codeForm").requestSubmit(); // room codes are five characters
  });
  $("codeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("codeInput").value;
    if (v.length < 4) { $("codeError").textContent = "Room codes are five letters and numbers."; return; }
    busy($("codeBtn"), true);
    location.href = joinUrl(v);
  });
  let editing = false, pickedColour = null, gettingPaper = false;
  async function syncMember() {
    if (!ROOM) return;
    const me = ROOM.me, taker = takerName();
    if (me) { S.memberId = me.id; S.name = me.name; S.color = me.color; save(); }
    if (ROOM.phase === "lobby") {
      if (!me || editing) memberForm(taker);
      else {
        memberScreen("wait", `You're in, ${me.name}.`, "");
        const badge = $("joinMe"); badge.style.setProperty("--c", me.color);
        badge.querySelector(".avatar").textContent = (me.name[0] || "?").toUpperCase(); badge.querySelector("b").textContent = `${G.colourName(me.color)} is yours`;
        $("joinWaitText").textContent = `Waiting for ${taker} to start. Keep this page open: the first question appears here.`;
      }
      return renderJoinRoom();
    }
    if (!me || (ROOM.roster && !ROOM.roster.includes(me.id))) {
      stopPolling();
      return memberScreen("closed", ROOM.phase === "finished" ? "This test has finished" : "This test has already started", `Catch ${taker} for the next one.`);
    }
    if (!S.qids) {
      // the paper: the same questions, in the same order, as the taker
      if (gettingPaper) return;
      gettingPaper = true;
      try {
        const d = await G.get({ ...auth(), since: 0, paper: 1 });
        const p = d.paper; applyRoom(d);
        DATA = { questions: p.questions, settings: p.settings || {} }; BYID = {}; p.questions.forEach((q) => { BYID[q.id] = q; });
        Object.assign(S, { qids: p.questions.map((q) => q.id), order: p.order, limitMs: p.limitMs, index: ROOM.index, responses: {}, started: true }); save();
      } catch (e) { return; } finally { gettingPaper = false; }
      memberResponses();
      show("scrTest"); // answers only: the meter, the room and the answer sheet are on the taker's screen
      renderQuestion(); runClock();
      startPolling(1000, (gone) => (gone ? roomGone() : syncMember()));
    }
    if (ROOM.phase === "finished") return memberFinish();
    if (ROOM.index !== S.index) { S.index = ROOM.index; save(); memberResponses(); renderQuestion(); }
    if (ROOM.phase === "reveal" && !revealShown) { memberResponses(); showReveal(); }
    renderPlayers();
  }
  // your answers so far, from the room (a question's answer only counts once the taker has submitted)
  function memberResponses() {
    QS().forEach((q, k) => {
      if (k >= ANS_UPTO) return;
      const a = ANS[k] || {}, has = S.memberId in a, r = has ? a[S.memberId] : null;
      S.responses[q.id] = { response: r, correct: has && r != null && A.isCorrect(q, r), skipped: r == null, timedOut: false };
    });
    save();
  }
  function memberForm(taker) {
    if ($("joinForm").hidden) {
      memberScreen("form", `Join ${taker}'s test`, `Answer the same questions alongside ${taker}. Get them right and you both do well; get them wrong and it costs you.`);
      $("joinError").textContent = "";
      if (!$("joinName").value) setTimeout(() => $("joinName").focus(), 30);
    }
    // colours someone else has taken are gone from the list
    const taken = new Set(ROOM.members.filter((m) => !ROOM.me || m.id !== ROOM.me.id).map((m) => m.color));
    if (pickedColour && taken.has(pickedColour)) { pickedColour = null; $("joinHint").textContent = "Someone just took that colour. Pick another."; }
    if (!pickedColour && ROOM.me && !taken.has(ROOM.me.color)) pickedColour = ROOM.me.color;
    const free = G.PALETTE.filter((p) => !taken.has(p.c));
    const box = $("joinSwatches"), want = free.map((p) => p.c + (p.c === pickedColour ? "*" : "")).join();
    if (box.dataset.state === want) return;
    box.dataset.state = want;
    box.innerHTML = free.map((p) => `<button type="button" class="swatch" role="radio" aria-checked="${p.c === pickedColour}" style="--c:${p.c}" data-c="${p.c}"><i aria-hidden="true"></i>${esc(p.n)}</button>`).join("")
      || '<p class="hint">Every colour is taken. Ask someone to leave, or catch the next one.</p>';
  }
  function renderJoinRoom() {
    $("joinRoom").hidden = false;
    $("joinN").textContent = ROOM.members.length + 1;
    $("joinList").innerHTML = roomPlayers().map((p) => playerLi(p)).join("");
  }
  $("joinSwatches").addEventListener("click", (e) => {
    const b = e.target.closest(".swatch"); if (!b) return;
    pickedColour = b.dataset.c; $("joinHint").textContent = ""; $("joinError").textContent = "";
    for (const s of $("joinSwatches").children) s.setAttribute("aria-checked", String(s === b));
    $("joinSwatches").dataset.state = "";
  });
  $("joinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("joinName").value.trim().replace(/\s+/g, " ").slice(0, 24), err = $("joinError"), btn = $("joinBtn");
    if (!name) { err.textContent = "Tell us your name."; return $("joinName").focus(); }
    if (!pickedColour) { err.textContent = "Pick a colour."; return; }
    err.textContent = ""; busy(btn, true);
    try {
      await roomAct({ action: "join", name, color: pickedColour });
      try { localStorage.setItem("gcmc-member-name", name); } catch (e2) {}
      editing = false; $("joinForm").hidden = true;
    } catch (e2) { err.textContent = e2.message; $("joinSwatches").dataset.state = ""; }
    busy(btn, false);
    syncMember();
  });
  $("joinChange").addEventListener("click", () => { editing = true; $("joinBtn").textContent = "Save"; syncMember(); });
  $("joinLeave").addEventListener("click", async () => {
    busy($("joinLeave"), true);
    try { await roomAct({ action: "leave" }); } catch (e) {}
    busy($("joinLeave"), false);
    editing = false; pickedColour = null; $("joinBtn").textContent = "Join the room"; syncMember();
  });

  async function memberSubmit(q, resp) {
    clearTimeout(draftTimer);
    setStatus("", "Sending…"); busy($("submitBtn"), true);
    try { await roomAct({ action: "answer", q: S.index, response: resp }); busy($("submitBtn"), false); answerIn(q, resp); }
    catch (e) {
      busy($("submitBtn"), false);
      if (e.status === 409) { $("submitBtn").disabled = true; return setStatus("recorded", esc(e.message)); }
      locked = false; $("qCard").classList.remove("locked");
      setStatus("error", "Couldn't send that. Try again.");
    }
  }
  function answerIn(q, resp) {
    locked = true; $("qCard").classList.add("locked"); $("submitBtn").disabled = true;
    setStatus("recorded", `Answer in. Waiting for ${esc(takerName())}…`);
  }
  async function memberFinish() {
    stopPolling(); clearInterval(tick);
    try { applyRoom(await G.get({ ...auth(), since: 0 })); } catch (e) {}
    memberResponses();
    S.finished = true; S.usedMs = S.clock ? S.clock.usedMs : 0; S.finishedAt = Date.now(); S.timedOut = !!ROOM.timedOut;
    S.board = board(); save();
    showResults();
  }

  // ---------- analysis ----------
  function analyse() {
    const qs = QS(), order = A.categoriesOf(DATA.settings);
    const cats = new Map();
    let streak = 0, best = 0;
    qs.forEach((q) => {
      const r = S.responses[q.id] || {};
      const c = A.categoryOf(q);
      if (!cats.has(c)) cats.set(c, { name: c, total: 0, correct: 0 });
      const e = cats.get(c); e.total++; if (r.correct) e.correct++;
      streak = r.correct ? streak + 1 : 0; best = Math.max(best, streak);
    });
    const byCat = [...cats.values()].map((e) => ({ ...e, share: e.correct / e.total }));
    byCat.sort((a, b) => b.share - a.share || b.total - a.total || order.indexOf(a.name) - order.indexOf(b.name));
    const answered = qs.filter((q) => S.responses[q.id] && !S.responses[q.id].timedOut).length;
    const usedMs = S.usedMs != null ? S.usedMs : S.finishedAt - S.startedAt;
    return { byCat, streak: best, answered, usedMs, avgMs: answered ? usedMs / answered : 0 };
  }

  // everyone's result, kept with the attempt so the results survive a refresh (and the room closing)
  function board() {
    const t = tally();
    return { reached: t.reached, rows: t.rows.map(({ id, name, color, taker, points, correct, crit, cells, deltas }) => ({ id, name, color, taker: !!taker, points, correct, crit, cells, deltas })) };
  }

  // ---------- finish & results ----------
  async function finish(timedOut) {
    if (S.finished || finish.busy) return;
    finish.busy = true; clearInterval(tick);
    if (HOSTING()) {
      stopPolling(); locked = true; $("qCard").classList.add("locked"); busy($("nextBtn"), true);
      // close the room for everyone, and collect every answer
      for (let t = 0; t < 3; t++) {
        try { await roomAct({ action: "finish", timedOut: !!timedOut }); applyRoom(await G.get({ ...auth(), since: 0 })); break; }
        catch (e) { await new Promise((r) => setTimeout(r, 800)); }
      }
      if (ROOM) timedOut = !!ROOM.timedOut;
    }
    finish.busy = false;
    QS().forEach((q) => { if (!S.responses[q.id]) S.responses[q.id] = { response: null, correct: false, skipped: true, timedOut: !!timedOut }; });
    S.finished = true; S.finishedAt = HOSTING() ? Date.now() : Math.min(Date.now(), S.startedAt + S.limitMs); S.timedOut = !!timedOut;
    if (HOSTING() && S.clock) S.usedMs = Math.min(S.clock.limitMs, S.clock.usedMs);
    S.board = board();
    save();
    const sc = score(), an = analyse(), me = S.board.rows[0];
    try {
      fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: S.email, name: S.name, assessment: DATA.settings.assessmentCode, attempt: S.attempt || 1,
        startedAt: new Date(S.startedAt).toISOString(), finishedAt: new Date(S.finishedAt).toISOString(),
        correct: sc.c, total: QS().length, criticalErrors: sc.crit, points: me.points, timedOut: S.timedOut, longestStreak: an.streak,
        mode: HOSTING() ? "group" : "solo",
        room: HOSTING() ? { code: S.group.code, people: S.board.rows.slice(1).map(({ name, color, points, correct, crit }) => ({ name, color, points, correct, criticalErrors: crit })) } : undefined,
        byCategory: an.byCat.map(({ name, correct, total }) => ({ name, correct, total })),
        responses: QS().map((q, k) => ({ id: q.id, category: A.categoryOf(q), prompt: q.prompt, given: A.responseText(q, S.responses[q.id].response), correct: S.responses[q.id].correct, points: me.deltas[k] })),
      }) }).catch(() => {});
    } catch (e) { /* results logging is best effort */ }
    showResults();
  }

  const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function countUp(el, to, ms, fmt) {
    fmt = fmt || String;
    if (reduced) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(to * e));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  const plural = (n, one, many) => `${n} ${Math.abs(n) === 1 ? one : many}`;

  function showResults() {
    if (meter) meter.stop();
    stopPolling();
    const qs = QS(), n = qs.length, member = MEMBER();
    const bd = S.board || board(), taker = bd.rows[0], group = bd.rows.length > 1;
    const sc = score(), an = analyse();
    const name = S.name || "", tName = taker.name || name;
    const distinction = distinctionFor(taker.correct, n);

    if (member) {
      $("resTitle").textContent = `${tName} scored ${G.signed(taker.points)}.`;
      $("resMsg").textContent = `${tName} got ${taker.correct} of ${n} right. Here's how the whole room did, and your own answers underneath.`;
    } else {
      $("resTitle").textContent = distinction ? `Outstanding, ${name}. Welcome to the team.` : `Congratulations, ${name}. You've completed your onboarding.`;
      $("resMsg").textContent = distinction
        ? "A near-perfect result. The needle had nowhere left to go."
        : S.timedOut ? "Time ran out before the last questions, but the hard part is done. The breakdown below shows where to look next."
        : "Everything you missed is something you'll pick up fast on real tasks. The breakdown below shows where to look next.";
    }
    $("resBadge").hidden = !distinction;
    const zt = $("resZone"); zt.hidden = member;
    if (!member) { zt.textContent = "Meter: " + new Meter(null, null, LABELS()).zone(sc.p); zt.className = "zone-tag" + (sc.p >= 1 / 3 ? " good" : sc.p <= -1 / 3 ? " bad" : ""); }
    $("resOf").textContent = `${taker.correct} of ${n} correct` + (group ? ` · ${plural(bd.rows.length - 1, "teammate", "teammates")} in the room` : "");
    $("resCrit").hidden = !taker.crit; $("resCrit").textContent = `${taker.crit} critical ${taker.crit === 1 ? "error" : "errors"}`;
    $("resPtsUnit").textContent = Math.abs(taker.points) === 1 ? "point" : "points";
    show("scrResults");
    countUp($("resPts"), taker.points, 1200, G.signed);

    // every answer, in order
    const strip = $("resStrip"); strip.innerHTML = "";
    qs.forEach((q, i) => {
      const c = taker.cells[i] === "none" ? "skip" : taker.cells[i], d = taker.deltas[i];
      const cell = document.createElement("i");
      cell.className = c + (q.critical && c !== "ok" ? " crit" : "");
      cell.title = `Q${i + 1} · ${A.categoryOf(q)}${q.critical ? " · critical" : ""} · ${c === "ok" ? "right" : c === "skip" ? "skipped" : "wrong"}${d != null ? " · " + G.signed(d) : ""}`;
      cell.style.animationDelay = reduced ? "0s" : 0.4 + i * 0.03 + "s";
      strip.append(cell);
    });

    renderRoomBoard(bd);

    // the rest is about the viewer's own attempt; the team sees the room, then their own answers
    $("resStats").hidden = member; $("resGrid").hidden = member;
    $("certBtn").hidden = member; $("retakeBtn").hidden = member;
    $("againBtn").textContent = member ? "Leave the room" : "Sign out";
    $("reviewTitle").textContent = member ? `Your answers, ${name}` : "Your answers";
    if (!member) {
      $("sTime").textContent = fmtTime(an.usedMs); $("sTimeSub").textContent = `of ${fmtTime(S.limitMs)} allowed` + (group ? ", answers on show not counted" : "");
      $("sAvg").textContent = Math.round(an.avgMs / 1000) + "s";
      countUp($("sStreak"), an.streak, 900);
      const aced = an.byCat.filter((c) => c.correct === c.total).length;
      countUp($("sAced"), aced, 900); $("sAcedSub").textContent = `of ${an.byCat.length} with every answer right`;

      // by category
      const list = $("catList"); list.innerHTML = "";
      an.byCat.forEach((c) => {
        const row = document.createElement("div"); row.className = "cat-row";
        row.innerHTML = `<span class="name">${esc(c.name)}</span><span class="track"><span class="fill ${c.share >= 0.8 ? "" : c.share >= 0.5 ? "mid" : "low"}"></span></span><span class="num">${c.correct}/${c.total}<small>right</small></span>`;
        list.append(row);
      });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        [...list.querySelectorAll(".fill")].forEach((f, i) => { f.style.transitionDelay = reduced ? "0s" : 0.3 + i * 0.08 + "s"; f.style.width = 100 * an.byCat[i].share + "%"; });
      }));
      const best = an.byCat[0], worst = an.byCat[an.byCat.length - 1];
      $("bestCat").textContent = best ? best.name : "—"; $("bestSub").textContent = best ? `${best.correct} of ${best.total} correct` : "";
      if (worst && worst.correct < worst.total) { $("worstCat").textContent = worst.name; $("worstSub").textContent = `${worst.correct} of ${worst.total} correct`; }
      else { $("worstCat").textContent = "Nothing"; $("worstSub").textContent = "Every answer right in every category"; }
      $("sName").textContent = name || "—"; $("sEmail").textContent = S.email || "";
      $("sDate").textContent = "Completed " + new Date(S.finishedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
      $("certBtn").href = "certificate.html?" + new URLSearchParams({ n: name, c: sc.c, t: n, pts: taker.points, b: best && best.correct > 0 ? best.name : "", d: new Date(S.finishedAt).toISOString() });
    }

    renderReview("wrong");
    if (distinction && !member && !S.confettiShown) { S.confettiShown = true; save(); confetti(); }
  }

  // the whole room: the taker on top, then the team, best first
  function renderRoomBoard(bd) {
    const card = $("roomCard");
    card.hidden = bd.rows.length < 2;
    if (card.hidden) return;
    const n = QS().length, taker = bd.rows[0];
    const team = bd.rows.slice(1).sort((a, b) => b.points - a.points || b.correct - a.correct);
    const medals = ["🥇", "🥈", "🥉"];
    $("roomSub").textContent = `${plural(team.length, "teammate", "teammates")} played along with ${taker.name}` + (bd.reached < n ? ` · the room reached question ${bd.reached} of ${n}` : "");
    const cells = (r) => `<span class="mini-strip" aria-hidden="true">${r.cells.map((c, i) => `<i class="${c}${QS()[i] && QS()[i].critical ? " crit" : ""}"></i>`).join("")}</span>`;
    const row = (r, rank) => {
      const me = MEMBER() ? r.id === S.memberId : r.taker;
      return `<div class="board-row${r.taker ? " taker" : ""}${me ? " me" : ""}" style="--c:${esc(r.color)}">
        <span class="rank">${r.taker ? "" : rank < 3 && team.length > 1 ? medals[rank] : rank + 1}</span>
        <span class="avatar" aria-hidden="true">${initial(r.name)}</span>
        <span class="who"><b>${esc(r.name)}</b><small>${r.taker ? "Taking the test" : me ? "You" : esc(G.colourName(r.color))}${r.crit ? ` · ${plural(r.crit, "critical miss", "critical misses")}` : ""}</small></span>
        ${cells(r)}
        <span class="right-n"><b>${r.correct}</b><small>of ${n}</small></span>
        <span class="pts ${r.points > 0 ? "up" : r.points < 0 ? "down" : ""}">${G.signed(r.points)}<small>${Math.abs(r.points) === 1 ? "point" : "points"}</small></span>
      </div>`;
    };
    $("roomBoard").innerHTML = row(taker, -1) + `<p class="board-label">The team</p>` + team.map(row).join("");
  }

  function renderReview(which) {
    const qs = QS(), list = $("reviewList"); list.innerHTML = "";
    const wrongN = qs.filter((q) => !(S.responses[q.id] || {}).correct).length;
    $("nWrong").textContent = wrongN; $("nAll").textContent = qs.length;
    $("tabWrong").setAttribute("aria-selected", String(which === "wrong")); $("tabAll").setAttribute("aria-selected", String(which === "all"));
    const items = qs.map((q, i) => [q, i]).filter(([q]) => which === "all" || !(S.responses[q.id] || {}).correct);
    if (!items.length) { list.innerHTML = '<p class="flawless">Nothing to revisit. Flawless.</p>'; return; }
    const bd = S.board, mine = bd && (bd.rows.find((r) => (MEMBER() ? r.id === S.memberId : r.taker)) || null);
    const groups = new Map();
    for (const it of items) { const c = A.categoryOf(it[0]); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
    for (const [cat, its] of groups) {
      const g = document.createElement("div"); g.className = "rev-group";
      g.innerHTML = `<h3>${esc(cat)}</h3>`;
      for (const [q, i] of its) {
        const r = S.responses[q.id] || {};
        const unreached = mine && mine.cells[i] === "none";
        const row = document.createElement("div"); row.className = "review-item" + (r.correct ? " ok" : "");
        const given = unreached || r.timedOut ? "Not reached (time ran out)" : A.responseText(q, r.response);
        // picture answers show the pictures themselves
        const pics = (idx) => `<span class="rev-pics">${idx.map((k) => `<img src="${esc(q.options[k])}" alt="Picture ${k + 1}">`).join("")}</span>`;
        const showPics = A.imageAnswers(q) && !r.timedOut && Array.isArray(r.response) && r.response.length;
        const givenHtml = showPics ? pics(r.response) : esc(given);
        const rightHtml = A.imageAnswers(q) ? pics(q.correct || []) : esc(A.correctText(q));
        const qPic = q.type === "image" && !A.imageAnswers(q) && q.image ? `<img class="rev-qpic" src="${esc(q.image)}" alt="">` : "";
        const d = mine ? mine.deltas[i] : null;
        const pts = d != null ? ` <span class="rev-pts ${d > 0 ? "up" : d < 0 ? "down" : ""}">${G.signed(d)}</span>` : "";
        row.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>
          <div class="q">${q.critical ? '<span class="crit-chip">Critical ×2</span> ' : ""}${esc(q.prompt.replace(/_{3,}/g, "____"))}${pts}${qPic}</div>
          <div class="ans">${r.correct
            ? `<div><label>Your answer</label><span class="right plain">${givenHtml} ✓</span></div>`
            : `<div><label>Your answer</label><span class="yours${r.response == null ? " none" : ""}">${givenHtml}</span></div>
               <div><label>Correct answer</label><span class="right">${rightHtml}</span></div>`}</div>`;
        g.append(row);
      }
      list.append(g);
    }
  }
  $("tabWrong").addEventListener("click", () => renderReview("wrong"));
  $("tabAll").addEventListener("click", () => renderReview("all"));
  $("againBtn").addEventListener("click", () => {
    if (!MEMBER()) return signOut();
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    location.href = "/join";
  });
  // same person, fresh draw: back to the briefing with the attempt number bumped (every attempt is recorded)
  $("retakeBtn").addEventListener("click", () => {
    $("confetti").hidden = true; pieces = [];
    ROOM = null; ANS = {}; ANS_UPTO = 0;
    enter(S.email, S.name, (S.attempt || 1) + 1);
  });

  // ---------- confetti (hand-rolled, brand colours; one shared loop, so bursts can overlap) ----------
  // confetti() = the full celebration; confetti({x, y, n, life}) = a smaller burst from a point (the meter's green end)
  let pieces = [], confettiRunning = false;
  function confetti(o) {
    if (reduced) return;
    o = o || {};
    const cv = $("confetti"), burst = o.x != null, now = performance.now();
    const cols = burst ? ["#1f9d55", "#1f9d55", "#fac800", "#e61e2a", "#000054"] : ["#e61e2a", "#000054", "#fac800", "#e3e5e0", "#ffffff"];
    for (let i = 0; i < (o.n || 260); i++) pieces.push({
      x: burst ? o.x : innerWidth / 2 + (Math.random() - 0.5) * 240, y: burst ? o.y : innerHeight * 0.35,
      vx: (Math.random() - 0.5) * (burst ? 10 : 16), vy: -Math.random() * (burst ? 10 : 16) - (burst ? 3 : 4),
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: cols[(Math.random() * cols.length) | 0], born: now, life: o.life || 5,
    });
    if (confettiRunning) return;
    confettiRunning = true;
    const g = cv.getContext("2d"), dpr = devicePixelRatio || 1;
    cv.hidden = false; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    (function step(t) {
      g.clearRect(0, 0, innerWidth, innerHeight);
      pieces = pieces.filter((p) => (t - p.born) / 1000 < p.life);
      for (const p of pieces) {
        const age = (t - p.born) / 1000;
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.globalAlpha = Math.max(0, 1 - Math.max(0, age - (p.life - 1.5)) / 1.5);
        g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      }
      if (pieces.length) requestAnimationFrame(step); else { confettiRunning = false; cv.hidden = true; }
    })(now);
  }

  boot();
})();
