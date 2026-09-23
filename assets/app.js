/* End-of-Training Assessment: sign-in (+ first name) → briefing → timed test → results. */
(function () {
  "use strict";
  const A = window.Assess;
  const $ = (id) => document.getElementById(id);
  const KEY = "gcmc-assessment-v2";
  const LETTERS = "ABCDEFGHIJ";

  let DATA = null, S = null, meter = null, tick = null, locked = false, BYID = {};
  const QS = () => (S && S.qids ? S.qids.map((id) => BYID[id]).filter(Boolean) : []);
  const perAttempt = () => Math.min((DATA.settings || {}).questionsPerAttempt || DATA.questions.length, DATA.questions.length);
  const LABELS = () => Object.assign({ left: "HR would like a word", right: "Welcome to the team" }, (DATA.settings || {}).gauge || {});
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- state (per browser tab, survives a refresh) ----------
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: carry on in memory */ } };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const signOut = () => { try { sessionStorage.removeItem(KEY); } catch (e) {} location.reload(); };

  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
    const signedIn = S && S.email;
    $("whoBox").hidden = !signedIn; $("signOut").hidden = !signedIn;
    if (signedIn) {
      $("whoEmail").textContent = S.name ? `${S.name} · ${S.email}` : S.email;
      const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
      $("dCand").textContent = $("dSign").textContent = S.name || "—";
      $("dEmail").textContent = S.email; $("dDate").textContent = $("dSignDate").textContent = today;
    }
    scrollTo(0, 0);
  }

  // ---------- boot ----------
  async function boot() {
    try {
      if (!window.crypto || !crypto.subtle) throw new Error("Open this page through the local server (Start Test.bat) or a secure (https) address.");
      DATA = await A.loadData();
    } catch (e) {
      $("bootTitle").textContent = "The assessment couldn't start";
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
    $("briefLead").textContent = `This assessment covers every part of your onboarding: ${[...cats].join(", ")}. Read the conditions and the declaration before you start.`;

    S = load();
    if (S && S.started && !S.qids) S = null;
    if (S && S.finished) return showResults();
    if (S && S.started) return startTest(true);
    if (S && S.email && S.name) return show("scrBrief");
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
    err.textContent = ""; btn.disabled = true;
    const hash = await A.sha256(email);

    if (!$("nameStep").hidden && pendingHash === hash) {
      const name = $("firstName").value.trim().replace(/\s+/g, " ").slice(0, 40);
      if (!name) { err.textContent = "Tell us your first name."; btn.disabled = false; $("firstName").focus(); return; }
      try { await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email_sha256: hash }) }); } catch (e) { /* remembered for this session only */ }
      return enter(email, name);
    }
    btn.textContent = "Checking…";
    const known = await lookupName(hash);
    btn.textContent = "Sign in"; btn.disabled = false;
    if (known) return enter(email, known);
    pendingHash = hash;
    $("nameStep").hidden = false; $("firstName").value = guessName(email); $("firstName").select(); $("firstName").focus();
    btn.textContent = "Continue";
  });
  $("email").addEventListener("input", () => { if (!$("nameStep").hidden) { $("nameStep").hidden = true; $("loginBtn").textContent = "Sign in"; pendingHash = null; } });
  function enter(email, name) { S = { email, name, started: false, finished: false }; save(); show("scrBrief"); }
  $("signOut").addEventListener("click", () => {
    const midTest = S && S.started && !S.finished;
    if (midTest && !confirm("Sign out now? This attempt will be discarded and won't be recorded.")) return;
    clearInterval(tick); signOut();
  });

  // ---------- briefing ----------
  $("agree").addEventListener("change", (e) => { $("startBtn").disabled = !e.target.checked; });
  $("startBtn").addEventListener("click", () => startTest(false));

  function startTest(resume) {
    const st = DATA.settings || {};
    if (!resume) {
      S.started = true; S.startedAt = Date.now(); S.index = 0; S.responses = {};
      S.limitMs = (st.timeLimitMinutes || 10) * 60000;
      S.qids = A.drawQuestions(DATA.questions, perAttempt());
      S.order = QS().map((q) => (q.options ? (st.shuffleOptions ? A.shuffle(q.options.map((_, i) => i)) : q.options.map((_, i) => i)) : null));
      save();
    }
    show("scrTest");
    meter = meter || new Meter($("meter"), $("lamp"), LABELS());
    meter.resize(); meter.setName(S.name); meter.setScore(score().p); meter.start();
    buildDots(); renderQuestion(); runClock();
  }

  // ---------- scoring ----------
  function score() {
    let c = 0, w = 0;
    QS().forEach((q) => { const r = S.responses[q.id]; if (!r) return; if (r.correct) c++; else w++; });
    // tracks accuracy once a few answers are in; early answers nudge it in small steps
    return { c, w, p: Math.max(-1, Math.min(1, (c - w) / Math.max(c + w, 8))) };
  }

  // ---------- clock ----------
  function remaining() { return Math.max(0, S.limitMs - (Date.now() - S.startedAt)); }
  function runClock() {
    clearInterval(tick);
    const upd = () => {
      const ms = remaining(), s = Math.ceil(ms / 1000);
      $("digits").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      $("timer").classList.toggle("warn", s <= 60); $("timer").classList.toggle("critical", s <= 30);
      $("timerSub").textContent = s <= 60 ? "Final minute. Unanswered questions will be marked incorrect." : "Submits automatically at 00:00";
      if (ms <= 0) { clearInterval(tick); finish(true); }
    };
    upd(); tick = setInterval(upd, 250);
  }

  // ---------- progress ----------
  function buildDots() {
    const box = $("dots"); box.innerHTML = "";
    QS().forEach(() => box.appendChild(document.createElement("span")));
    updateProgress();
  }
  function updateProgress() {
    const n = QS().length, done = Object.keys(S.responses).length;
    $("count").innerHTML = `${done} <small>of ${n} answered</small>`;
    $("barFill").style.width = (100 * done) / n + "%";
    [...$("dots").children].forEach((d, i) => {
      const r = S.responses[QS()[i].id];
      d.className = r ? (r.skipped ? "skipped" : "done") : i === S.index ? "current" : "";
    });
  }

  // ---------- questions ----------
  let current = null; // the in-progress response for the question on screen
  function renderQuestion() {
    locked = false;
    const q = QS()[S.index], n = QS().length;
    $("qCard").classList.remove("locked");
    $("qNum").textContent = `Question ${S.index + 1} of ${n}`;
    $("qType").textContent = A.TYPE_LABEL[q.type] || "Question";
    $("qTopic").textContent = A.categoryOf(q);
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
    const q = QS()[S.index];
    const resp = skipped ? null : current;
    if (!skipped && (Array.isArray(resp) ? !resp.length : !A.normalize(resp))) return;
    locked = true;
    const correct = !skipped && A.isCorrect(q, resp);
    S.responses[q.id] = { response: resp, correct, skipped: !!skipped, at: Date.now() };
    save();
    $("qCard").classList.add("locked"); $("submitBtn").disabled = true;
    $("qStatus").className = "status recorded"; $("qStatus").textContent = skipped ? "Skipped" : "Answer recorded";
    meter.setScore(score().p); meter.kick(correct ? 1 : -1);
    updateProgress();
    setTimeout(() => {
      if (S.index >= QS().length - 1) return finish(false);
      S.index++; save(); renderQuestion();
    }, 850);
  }
  $("submitBtn").addEventListener("click", () => submit(false));
  $("skipBtn").addEventListener("click", () => submit(true));

  document.addEventListener("keydown", (e) => {
    if ($("scrTest").hidden || locked) return;
    const q = QS()[S.index];
    if (e.key === "Enter") { e.preventDefault(); if (!$("submitBtn").disabled) submit(false); return; }
    if ((q.type === "single" || q.type === "multi") && !e.ctrlKey && !e.metaKey && !e.altKey && e.target.tagName !== "INPUT") {
      const k = LETTERS.indexOf(e.key.toUpperCase());
      const opts = document.querySelectorAll(".opt");
      if (k >= 0 && k < opts.length) { e.preventDefault(); toggle(q, opts[k]); }
    }
  });

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
    const byCat = [...cats.values()].map((e) => ({ ...e, pct: Math.round((100 * e.correct) / e.total) }));
    byCat.sort((a, b) => b.pct - a.pct || b.total - a.total || order.indexOf(a.name) - order.indexOf(b.name));
    const answered = qs.filter((q) => S.responses[q.id] && !S.responses[q.id].timedOut).length;
    const usedMs = S.finishedAt - S.startedAt;
    return { byCat, streak: best, answered, usedMs, avgMs: answered ? usedMs / answered : 0 };
  }

  // ---------- finish & results ----------
  function finish(timedOut) {
    clearInterval(tick);
    QS().forEach((q) => { if (!S.responses[q.id]) S.responses[q.id] = { response: null, correct: false, skipped: true, timedOut: !!timedOut }; });
    S.finished = true; S.finishedAt = Math.min(Date.now(), S.startedAt + S.limitMs); S.timedOut = !!timedOut;
    save();
    const sc = score(), an = analyse();
    try {
      fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: S.email, name: S.name, assessment: DATA.settings.assessmentCode,
        startedAt: new Date(S.startedAt).toISOString(), finishedAt: new Date(S.finishedAt).toISOString(),
        correct: sc.c, total: QS().length, timedOut: S.timedOut, longestStreak: an.streak,
        byCategory: an.byCat.map(({ name, correct, total }) => ({ name, correct, total })),
        responses: QS().map((q) => ({ id: q.id, category: A.categoryOf(q), prompt: q.prompt, given: A.responseText(q, S.responses[q.id].response), correct: S.responses[q.id].correct })),
      }) }).catch(() => {});
    } catch (e) { /* results logging is best effort */ }
    showResults();
  }

  const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function countUp(el, to, ms) {
    if (reduced) { el.textContent = to; return; }
    const t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(to * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function showResults() {
    if (meter) meter.stop();
    const st = DATA.settings || {}, qs = QS(), n = qs.length;
    const sc = score(), pct = Math.round((100 * sc.c) / n), an = analyse();
    const zone = new Meter(null, null, LABELS()).zone(sc.p);
    const name = S.name || "";
    const distinction = pct >= (st.confettiThreshold || 95);

    $("resTitle").textContent = distinction ? `Outstanding, ${name}. Welcome to the team.` : `Congratulations, ${name}. You've completed your onboarding.`;
    $("resMsg").textContent = distinction
      ? "A near-perfect result. The needle had nowhere left to go."
      : S.timedOut ? "Time ran out before the last questions, but the hard part is done. The breakdown below shows where to look next."
      : "Everything you missed is something you'll pick up fast on real tasks. The breakdown below shows where to look next.";
    $("resBadge").hidden = !distinction;
    const zt = $("resZone"); zt.textContent = "Meter: " + zone;
    zt.className = "zone-tag" + (sc.p >= 1 / 3 ? " good" : sc.p <= -1 / 3 ? " bad" : "");
    $("resOf").textContent = `${sc.c} of ${n} correct`;
    show("scrResults");
    countUp($("resPct"), pct, 1200);

    // every answer, in order
    const strip = $("resStrip"); strip.innerHTML = "";
    qs.forEach((q, i) => {
      const r = S.responses[q.id] || {};
      const cell = document.createElement("i");
      cell.className = r.correct ? "ok" : r.skipped ? "skip" : "no";
      cell.title = `Q${i + 1} · ${A.categoryOf(q)} · ${r.correct ? "right" : r.skipped ? "skipped" : "wrong"}`;
      cell.style.animationDelay = reduced ? "0s" : 0.4 + i * 0.03 + "s";
      strip.append(cell);
    });

    // stats
    $("sTime").textContent = fmtTime(an.usedMs); $("sTimeSub").textContent = `of ${fmtTime(S.limitMs)} allowed`;
    $("sAvg").textContent = Math.round(an.avgMs / 1000) + "s";
    countUp($("sStreak"), an.streak, 900);
    const aced = an.byCat.filter((c) => c.pct === 100).length;
    countUp($("sAced"), aced, 900); $("sAcedSub").textContent = `of ${an.byCat.length} at 100%`;

    // by category
    const list = $("catList"); list.innerHTML = "";
    an.byCat.forEach((c) => {
      const row = document.createElement("div"); row.className = "cat-row";
      row.innerHTML = `<span class="name">${A.escapeHtml(c.name)}</span><span class="track"><span class="fill ${c.pct >= 80 ? "" : c.pct >= 50 ? "mid" : "low"}"></span></span><span class="num">${c.pct}%<small>${c.correct} of ${c.total}</small></span>`;
      list.append(row);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      [...list.querySelectorAll(".fill")].forEach((f, i) => { f.style.transitionDelay = reduced ? "0s" : 0.3 + i * 0.08 + "s"; f.style.width = an.byCat[i].pct + "%"; });
    }));
    const best = an.byCat[0], worst = an.byCat[an.byCat.length - 1];
    $("bestCat").textContent = best ? best.name : "—"; $("bestSub").textContent = best ? `${best.correct} of ${best.total} correct` : "";
    if (worst && worst.pct < 100) { $("worstCat").textContent = worst.name; $("worstSub").textContent = `${worst.correct} of ${worst.total} correct`; }
    else { $("worstCat").textContent = "Nothing"; $("worstSub").textContent = "Every category at 100%"; }
    $("sName").textContent = name || "—"; $("sEmail").textContent = S.email || "";
    $("sDate").textContent = "Completed " + new Date(S.finishedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

    renderReview("wrong");
    if (distinction && !S.confettiShown) { S.confettiShown = true; save(); confetti(); }
  }

  function renderReview(which) {
    const qs = QS(), list = $("reviewList"); list.innerHTML = "";
    const wrongN = qs.filter((q) => !(S.responses[q.id] || {}).correct).length;
    $("nWrong").textContent = wrongN; $("nAll").textContent = qs.length;
    $("tabWrong").setAttribute("aria-selected", String(which === "wrong")); $("tabAll").setAttribute("aria-selected", String(which === "all"));
    const items = qs.map((q, i) => [q, i]).filter(([q]) => which === "all" || !(S.responses[q.id] || {}).correct);
    if (!items.length) { list.innerHTML = '<p class="flawless">Nothing to revisit. Flawless.</p>'; return; }
    const groups = new Map();
    for (const it of items) { const c = A.categoryOf(it[0]); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
    for (const [cat, its] of groups) {
      const g = document.createElement("div"); g.className = "rev-group";
      g.innerHTML = `<h3>${A.escapeHtml(cat)}</h3>`;
      for (const [q, i] of its) {
        const r = S.responses[q.id] || {};
        const row = document.createElement("div"); row.className = "review-item" + (r.correct ? " ok" : "");
        const given = r.timedOut ? "Not reached (time ran out)" : A.responseText(q, r.response);
        row.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>
          <div class="q">${A.escapeHtml(q.prompt.replace(/_{3,}/g, "____"))}</div>
          <div class="ans">${r.correct
            ? `<div><label>Your answer</label><span class="right plain">${A.escapeHtml(given)} ✓</span></div>`
            : `<div><label>Your answer</label><span class="yours${r.response == null ? " none" : ""}">${A.escapeHtml(given)}</span></div>
               <div><label>Correct answer</label><span class="right">${A.escapeHtml(A.correctText(q))}</span></div>`}</div>`;
        g.append(row);
      }
      list.append(g);
    }
  }
  $("tabWrong").addEventListener("click", () => renderReview("wrong"));
  $("tabAll").addEventListener("click", () => renderReview("all"));
  $("againBtn").addEventListener("click", signOut);

  // ---------- confetti (hand-rolled, brand colours) ----------
  function confetti() {
    if (reduced) return;
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
