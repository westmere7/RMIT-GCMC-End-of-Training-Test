/* End-of-Training Assessment: sign-in → briefing → timed test → results. */
(function () {
  "use strict";
  const A = window.Assess;
  const $ = (id) => document.getElementById(id);
  const KEY = "gcmc-assessment-v1";
  const LETTERS = "ABCDEFGHIJ";

  let DATA = null, S = null, meter = null, tick = null, locked = false;

  // ---------- state (per browser tab, survives a refresh) ----------
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: carry on in memory */ } };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } };

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
    const signedIn = S && S.email;
    $("whoBox").hidden = !signedIn; $("signOut").hidden = !signedIn || id === "scrTest";
    if (signedIn) $("whoEmail").textContent = S.email;
    scrollTo(0, 0);
  }

  // ---------- boot ----------
  async function boot() {
    try {
      if (!window.crypto || !crypto.subtle) throw new Error("Open this page through the local server (Start Test.bat) or a secure (https) address.");
      DATA = await A.loadData();
    } catch (e) {
      $("bootTitle").textContent = "The assessment couldn't start";
      $("bootMsg").textContent = e.message + " If you opened index.html directly, start it with ‘Start Test.bat’ instead.";
      return;
    }
    const st = DATA.settings || {};
    const n = DATA.questions.length, mins = st.timeLimitMinutes || 10;
    document.title = (st.title || "End-of-Training Assessment") + " · RMIT";
    $("topSubtitle").textContent = st.subtitle || "";
    $("loginCode").textContent = st.assessmentCode || ""; $("briefCode").textContent = st.assessmentCode || "";
    $("loginTitle").textContent = st.title || "End-of-Training Assessment";
    $("metaQ").textContent = n; $("metaT").textContent = mins + " minutes";
    $("dQ").textContent = n; $("dT").textContent = mins + ":00"; $("dCand").textContent = st.candidateName || "Candidate";
    $("briefLead").textContent = `${n} questions covering everything from your onboarding: the team and GCMC, RMIT Melbourne, brand and squad style, platforms, workflow, meetings, and a little Aussie English. You have ${mins} minutes.`;

    S = load();
    if (S && S.finished) return showResults();
    if (S && S.started) return startTest(true);
    if (S && S.email) return show("scrBrief");
    S = null; show("scrLogin"); $("email").focus();
  }

  // ---------- sign in ----------
  $("loginForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = A.normEmail($("email").value), id = A.normStaffId($("staffId").value);
    const err = $("loginError");
    if (!email || !id) { err.textContent = "Enter your RMIT email and staff ID."; return; }
    if (!/^[^@\s]+@(student\.)?rmit\.edu\.(au|vn)$/.test(email)) { err.textContent = "Use your RMIT staff email address (…@rmit.edu.vn or …@rmit.edu.au)."; return; }
    const auth = DATA.auth || {};
    if (auth.emailSha256 || auth.staffIdSha256) {
      const [eh, ih] = await Promise.all([A.sha256(email), A.sha256(id)]);
      if ((auth.emailSha256 && eh !== auth.emailSha256) || (auth.staffIdSha256 && ih !== auth.staffIdSha256)) {
        err.textContent = "Those details don't match our records. Check your email and staff ID and try again.";
        $("staffId").value = ""; $("staffId").focus(); return;
      }
    }
    err.textContent = "";
    S = { email, started: false, finished: false };
    save(); show("scrBrief");
  });
  $("signOut").addEventListener("click", () => { try { sessionStorage.removeItem(KEY); } catch (e) {} location.reload(); });

  // ---------- briefing ----------
  $("agree").addEventListener("change", (e) => { $("startBtn").disabled = !e.target.checked; });
  $("startBtn").addEventListener("click", () => startTest(false));

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function startTest(resume) {
    const st = DATA.settings || {};
    if (!resume) {
      S.started = true; S.startedAt = Date.now(); S.index = 0; S.responses = {};
      S.limitMs = (st.timeLimitMinutes || 10) * 60000;
      S.order = DATA.questions.map((q) => (q.options ? (st.shuffleOptions ? shuffle(q.options.map((_, i) => i)) : q.options.map((_, i) => i)) : null));
      save();
    }
    show("scrTest");
    const labels = Object.assign({ left: "Back to Day 1", middle: "Probation", right: "Welcome to the team" }, st.gauge || {});
    meter = meter || new Meter($("meter"), $("lamp"), labels);
    meter.resize(); meter.setScore(score().p); meter.start();
    buildDots(); renderQuestion(); runClock();
  }

  // ---------- scoring ----------
  function score() {
    let c = 0, w = 0;
    DATA.questions.forEach((q) => {
      const r = S.responses[q.id];
      if (!r) return;
      if (r.correct) c++; else w++;
    });
    const div = Math.max(6, DATA.questions.length / 2);
    return { c, w, p: Math.max(-1, Math.min(1, (c - w) / div)) };
  }

  // ---------- clock ----------
  function remaining() { return Math.max(0, S.limitMs - (Date.now() - S.startedAt)); }
  function runClock() {
    const ring = $("ring"), circ = 2 * Math.PI * 34;
    ring.style.strokeDasharray = circ;
    clearInterval(tick);
    const upd = () => {
      const ms = remaining(), s = Math.ceil(ms / 1000);
      $("digits").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      ring.style.strokeDashoffset = circ * (1 - ms / S.limitMs);
      $("timer").classList.toggle("warn", s <= 60); $("timer").classList.toggle("critical", s <= 30);
      $("timerSub").textContent = s <= 60 ? "Final minute. Unanswered questions will be marked incorrect." : "Submits automatically at 00:00";
      if (ms <= 0) { clearInterval(tick); finish(true); }
    };
    upd(); tick = setInterval(upd, 250);
  }

  // ---------- progress ----------
  function buildDots() {
    const box = $("dots"); box.innerHTML = "";
    DATA.questions.forEach(() => box.appendChild(document.createElement("span")));
    updateProgress();
  }
  function updateProgress() {
    const n = DATA.questions.length, done = Object.keys(S.responses).length;
    $("count").innerHTML = `${done} <small>of ${n} answered</small>`;
    $("barFill").style.width = (100 * done) / n + "%";
    [...$("dots").children].forEach((d, i) => {
      const r = S.responses[DATA.questions[i].id];
      d.className = r ? (r.skipped ? "skipped" : "done") : i === S.index ? "current" : "";
    });
    $("meterReading").textContent = "Live reading: " + meter.zone();
  }

  // ---------- questions ----------
  let current = null; // the in-progress response for the question on screen
  function renderQuestion() {
    locked = false;
    const q = DATA.questions[S.index], n = DATA.questions.length;
    $("qCard").classList.remove("locked");
    $("qNum").textContent = `Question ${S.index + 1} of ${n}`;
    $("qType").textContent = A.TYPE_LABEL[q.type] || "Question";
    $("qTopic").textContent = q.topic || "General";
    $("qStatus").className = "status"; $("qStatus").innerHTML = '<span class="kbd">Press <b>Enter</b> to submit</span>';
    const body = $("qBody"); body.innerHTML = "";
    current = q.type === "single" || q.type === "multi" ? [] : "";

    if (q.type === "fill") {
      const parts = String(q.prompt).split(/_{3,}/);
      const p = document.createElement("p"); p.className = "q-prompt fill";
      p.append(parts[0] || "");
      const inp = document.createElement("input");
      inp.className = "blank"; inp.id = "answerInput"; inp.maxLength = 40; inp.autocomplete = "off"; inp.spellcheck = false; inp.setAttribute("aria-label", "Your answer");
      inp.addEventListener("input", () => { current = inp.value; $("submitBtn").disabled = !A.normalize(current); });
      p.append(inp, parts.slice(1).join("___") || "");
      body.append(p); setTimeout(() => inp.focus(), 30);
    } else {
      const p = document.createElement("p"); p.className = "q-prompt"; p.textContent = q.prompt; body.append(p);
      if (q.type === "short") {
        const wrap = document.createElement("div"); wrap.className = "short-answer";
        wrap.innerHTML = '<input class="input" id="answerInput" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Type your answer" aria-label="Your answer"><small>One word or a short phrase. Capitals and punctuation don\'t matter.</small>';
        body.append(wrap);
        const inp = wrap.querySelector("input");
        inp.addEventListener("input", () => { current = inp.value; $("submitBtn").disabled = !A.normalize(current); });
        setTimeout(() => inp.focus(), 30);
      } else {
        const grid = document.createElement("div"); grid.className = "options"; grid.setAttribute("role", q.type === "single" ? "radiogroup" : "group");
        S.order[S.index].forEach((orig, k) => {
          const b = document.createElement("button");
          b.type = "button"; b.className = "opt" + (q.type === "multi" ? " multi" : "");
          b.setAttribute("role", q.type === "single" ? "radio" : "checkbox"); b.setAttribute("aria-checked", "false");
          b.dataset.orig = orig;
          b.innerHTML = `<span class="key">${LETTERS[k]}</span><span>${A.escapeHtml(q.options[orig])}</span>`;
          b.addEventListener("click", () => toggle(q, b));
          grid.append(b);
        });
        body.append(grid);
      }
    }
    $("submitBtn").disabled = true;
    updateProgress();
  }

  function toggle(q, b) {
    if (locked) return;
    const orig = +b.dataset.orig;
    if (q.type === "single") {
      current = [orig];
      for (const o of document.querySelectorAll(".opt")) o.setAttribute("aria-checked", String(+o.dataset.orig === orig));
    } else {
      const on = b.getAttribute("aria-checked") !== "true";
      b.setAttribute("aria-checked", String(on));
      current = on ? [...current, orig] : current.filter((x) => x !== orig);
    }
    $("submitBtn").disabled = !current.length;
  }

  function submit(skipped) {
    if (locked) return;
    const q = DATA.questions[S.index];
    const resp = skipped ? null : current;
    if (!skipped && (Array.isArray(resp) ? !resp.length : !A.normalize(resp))) return;
    locked = true;
    const correct = !skipped && A.isCorrect(q, resp);
    S.responses[q.id] = { response: resp, correct, skipped: !!skipped };
    save();
    $("qCard").classList.add("locked"); $("submitBtn").disabled = true;
    $("qStatus").className = "status recorded"; $("qStatus").textContent = skipped ? "Skipped" : "Answer recorded";
    meter.setScore(score().p); meter.kick(correct ? 1 : -1);
    updateProgress();
    setTimeout(() => {
      if (S.index >= DATA.questions.length - 1) return finish(false);
      S.index++; save(); renderQuestion();
    }, 850);
  }
  $("submitBtn").addEventListener("click", () => submit(false));
  $("skipBtn").addEventListener("click", () => submit(true));

  document.addEventListener("keydown", (e) => {
    if ($("scrTest").hidden || locked) return;
    const q = DATA.questions[S.index];
    if (e.key === "Enter") { e.preventDefault(); if (!$("submitBtn").disabled) submit(false); return; }
    if ((q.type === "single" || q.type === "multi") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = LETTERS.indexOf(e.key.toUpperCase());
      const opts = document.querySelectorAll(".opt");
      if (k >= 0 && k < opts.length) { e.preventDefault(); toggle(q, opts[k]); }
    }
  });

  // ---------- finish & results ----------
  function finish(timedOut) {
    clearInterval(tick);
    DATA.questions.forEach((q) => { if (!S.responses[q.id]) S.responses[q.id] = { response: null, correct: false, skipped: true, timedOut: !!timedOut }; });
    S.finished = true; S.finishedAt = Math.min(Date.now(), S.startedAt + S.limitMs); S.timedOut = !!timedOut;
    save();
    const sc = score();
    try {
      fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: S.email, assessment: DATA.settings.assessmentCode, startedAt: new Date(S.startedAt).toISOString(), finishedAt: new Date(S.finishedAt).toISOString(),
        correct: sc.c, total: DATA.questions.length, timedOut: S.timedOut,
        responses: DATA.questions.map((q) => ({ id: q.id, prompt: q.prompt, given: A.responseText(q, S.responses[q.id].response), correct: S.responses[q.id].correct })),
      }) }).catch(() => {});
    } catch (e) { /* results logging is best effort */ }
    showResults();
  }

  function showResults() {
    if (meter) meter.stop();
    const st = DATA.settings || {}, n = DATA.questions.length;
    const sc = score(), pct = Math.round((100 * sc.c) / n);
    const zone = (meter || new Meter($("meter"), null, Object.assign({ left: "Back to Day 1", middle: "Probation", right: "Welcome to the team" }, st.gauge || {}))).zone(sc.p);
    const name = st.candidateName || "";
    const distinction = pct >= (st.confettiThreshold || 95);
    $("resTitle").textContent = distinction ? `Outstanding, ${name}. Welcome to the team.` : `Congratulations, ${name}. You've completed your onboarding.`;
    $("resMsg").textContent = distinction
      ? "A near-perfect result. The needle had nowhere left to go."
      : S.timedOut ? "Time ran out before the last questions, but the hard part is done. Have a look at the ones to revisit below." : "Every answer below is something you'll pick up fast on real tasks. Have a look at the ones to revisit, then you're good to go.";
    $("resPct").textContent = pct + "%";
    $("resOf").innerHTML = `${sc.c} of ${n} correct<span>Meter reading: ${A.escapeHtml(zone)}</span>`;
    $("resBadge").hidden = !distinction;
    $("sCorrect").textContent = sc.c; $("sWrong").textContent = n - sc.c;
    const used = Math.round((S.finishedAt - S.startedAt) / 1000);
    $("sTime").textContent = `${Math.floor(used / 60)}:${String(used % 60).padStart(2, "0")}`;
    $("sZone").textContent = zone; $("sEmail").textContent = S.email || "—";
    $("sDate").textContent = new Date(S.finishedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

    const list = $("reviewList"); list.innerHTML = "";
    const wrong = DATA.questions.map((q, i) => [q, i]).filter(([q]) => !S.responses[q.id] || !S.responses[q.id].correct);
    if (!wrong.length) list.innerHTML = '<p class="flawless">Nothing to revisit. Flawless.</p>';
    for (const [q, i] of wrong) {
      const r = S.responses[q.id] || {};
      const given = A.responseText(q, r.response);
      const row = document.createElement("div"); row.className = "review-item";
      row.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>
        <div class="q"><small>${A.escapeHtml(q.topic || "")}</small>${A.escapeHtml(q.prompt.replace(/_{3,}/g, "____"))}</div>
        <div class="ans"><div><label>Your answer</label><span class="yours${r.response == null ? " none" : ""}">${A.escapeHtml(r.timedOut ? "Not reached (time ran out)" : given)}</span></div>
        <div><label>Correct answer</label><span class="right">${A.escapeHtml(A.correctText(q))}</span></div></div>`;
      list.append(row);
    }
    show("scrResults");
    if (distinction && !S.confettiShown) { S.confettiShown = true; save(); confetti(); }
  }

  // ---------- confetti (hand-rolled, brand colours) ----------
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cv = $("confetti"), g = cv.getContext("2d"), dpr = devicePixelRatio || 1;
    cv.hidden = false; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; g.scale(dpr, dpr);
    const cols = ["#e61e2a", "#000054", "#fac800", "#e3e5e0", "#ffffff"];
    const P = Array.from({ length: 260 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 240, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 4,
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[(Math.random() * cols.length) | 0],
    }));
    const t0 = performance.now();
    (function step(t) {
      const age = (t - t0) / 1000;
      g.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of P) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.globalAlpha = Math.max(0, 1 - Math.max(0, age - 3.5) / 1.5);
        g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      }
      if (age < 5) requestAnimationFrame(step); else cv.hidden = true;
    })(t0);
  }

  boot();
})();
