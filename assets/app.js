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
      $("dDate").textContent = $("dSignDate").textContent = today;
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
    $("dPen").textContent = PENALTY();
    const nCrit = DATA.questions.filter((q) => q.critical).length;
    $("dCritN").textContent = nCrit ? "Your paper may include some; they're flagged in red." : "";
    $("briefLead").textContent = "Covers every part of your onboarding. Read the conditions, then start.";

    S = load();
    if (S && S.started && !S.qids) S = null;
    if (S && S.finished) return showResults();
    if (S && S.started) return startTest(true);
    if (S && S.email && S.name) { $("dAttempt").textContent = S.attempt || 1; return show("scrBrief"); }
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
  function enter(email, name, attempt) {
    S = { email, name, attempt: attempt || 1, started: false, finished: false }; save();
    $("agree").checked = false; $("startBtn").disabled = true; $("dAttempt").textContent = S.attempt;
    show("scrBrief");
  }
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
      S.qids = A.drawQuestions(DATA.questions, perAttempt(), A.criticalShareOf(st));
      const seq = (n) => [...Array(n).keys()];
      S.order = QS().map((q) => {
        if (q.type === "match") {
          // Column B is always shuffled, and never lined up straight across from Column A
          const n = (q.pairs || []).length, a = st.shuffleOptions ? A.shuffle(seq(n)) : seq(n);
          let b = A.shuffle(seq(n));
          for (let t = 0; n > 1 && t < 20 && b.some((x, k) => x === a[k]); t++) b = A.shuffle(seq(n));
          return { a, b };
        }
        return q.options ? (st.shuffleOptions ? A.shuffle(seq(q.options.length)) : seq(q.options.length)) : null;
      });
      save();
    }
    show("scrTest");
    meter = meter || new Meter($("meter"), $("lamp"), LABELS());
    meter.setThreshold((DATA.settings || {}).confettiThreshold); meter.greenLit = score().p >= (meter.pg || 0.9);
    meter.onGreen = (pt) => confetti({ x: pt.x, y: pt.y, n: 90, life: 2.6 });
    meter.resize(); meter.setName(S.name); meter.setScore(score().p); meter.start();
    buildDots(); renderQuestion(); runClock();
  }

  // ---------- scoring ----------
  const PENALTY = () => { const v = (DATA.settings || {}).criticalPenalty; return v == null || v === "" ? 3 : Math.max(0, +v || 0); };
  function score() {
    let c = 0, w = 0, crit = 0;
    QS().forEach((q) => { const r = S.responses[q.id]; if (!r) return; if (r.correct) c++; else { w++; if (q.critical) crit++; } });
    const pen = PENALTY(), marks = c - pen * crit;
    // each answer moves it a fixed step until half the attempt is in, then it tracks accuracy (critical misses weigh extra);
    // the step is sized to the attempt so a run of correct answers climbs steadily instead of pinning the needle early
    const steps = Math.max(8, Math.round(QS().length / 2));
    return { c, w, crit, pen, marks, p: Math.max(-1, Math.min(1, (c - w - pen * crit) / Math.max(c + w, steps))) };
  }
  const pctOf = (sc, n) => Math.max(0, Math.round((100 * sc.marks) / n));

  // ---------- clock ----------
  function remaining() { return Math.max(0, S.limitMs - (Date.now() - S.startedAt)); }
  function runClock() {
    clearInterval(tick);
    const upd = () => {
      const ms = remaining(), s = Math.ceil(ms / 1000);
      $("digits").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      $("tFill").style.width = Math.max(0, (100 * ms) / S.limitMs) + "%";
      $("timer").classList.toggle("warn", s <= 60); $("timer").classList.toggle("critical", s <= 30);
      $("timerSub").textContent = s <= 60 ? "Final minute. Unanswered questions will be marked incorrect." : "Submits automatically at 00:00";
      if (ms <= 0) { clearInterval(tick); finish(true); }
    };
    upd(); tick = setInterval(upd, 250);
  }

  // ---------- progress ----------
  function buildDots() {
    const box = $("dots"); box.innerHTML = "";
    QS().forEach((q, i) => { const d = document.createElement("span"); d.textContent = i + 1; if (q.critical) { d.dataset.crit = "1"; d.title = "Critical question"; } box.appendChild(d); });
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
    $("qNo").textContent = String(S.index + 1).padStart(2, "0"); $("qOfN").textContent = `of ${n}`;
    $("qType").textContent = A.TYPE_LABEL[q.type] || "Question";
    $("qTopic").textContent = A.categoryOf(q);
    $("qCard").classList.toggle("critical", !!q.critical);
    $("critNotice").hidden = !q.critical; $("critNoticeText").textContent = `A wrong or skipped answer loses ${PENALTY()} marks.`;
    $("qMarks").innerHTML = q.critical ? `<span class="crit-chip">Critical</span><small>−${PENALTY()} marks if wrong</small>` : "1 mark";
    $("qStatus").className = "status"; $("qStatus").innerHTML = '<span class="kbd">Press <b>Enter</b> to submit</span>';
    const body = $("qBody"); body.innerHTML = "";
    current = q.type === "single" || q.type === "multi" ? [] : q.type === "match" ? (q.pairs || []).map(() => null) : "";
    $("qCard").dataset.type = q.type;

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
      } else if (q.type === "match") {
        body.append(renderMatch(q));
      } else {
        // say how many to pick, where it can't be missed: one (round keys) or all that apply (square ticks, with a running count)
        const how = document.createElement("p"); how.className = "pick-how " + q.type; how.id = "pickHow";
        how.innerHTML = q.type === "multi"
          ? '<span class="pick-icon" aria-hidden="true"></span><b>Select all that apply</b><span class="pick-count" id="pickCount">None selected</span>'
          : '<span class="pick-icon" aria-hidden="true"></span><b>Choose one answer</b>';
        body.append(how);
        const grid = document.createElement("div"); grid.className = "options"; grid.setAttribute("role", q.type === "single" ? "radiogroup" : "group");
        grid.setAttribute("aria-describedby", "pickHow");
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
      const pc = $("pickCount"); if (pc) pc.textContent = current.length ? `${current.length} selected` : "None selected";
    }
    $("submitBtn").disabled = !current.length;
  }

  // Match the pairs: a board with Column A on the left and Column B on the right. Click an item, then its match on the
  // other side (either way round), or drag from one to the other; a line joins each pair, in its own colour, and both
  // ends carry the same number. Linking a taken item moves the link; linking the same pair again undoes it.
  // current[p] = the pair index of the B item linked to pair p's A item.
  const LINK_COLOURS = ["#000054", "#0b7a8f", "#7a3e9d", "#b0620b", "#b8336a", "#3f7a1f", "#4b5c8a", "#8a5a2b"];
  function renderMatch(q) {
    const ord = S.order[S.index] || { a: [], b: [] };
    const esc = A.escapeHtml, NS = "http://www.w3.org/2000/svg";
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
      const it = e.target.closest(".match-item"); if (!it || locked || e.button > 0) return;
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
        : n === current.length ? "All linked. Click a pair again to undo it, or submit." : "Click an item, then its match on the other side. You can also drag between them.";
      $("submitBtn").disabled = n < current.length;
      drawLines();
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
    const correct = !skipped && A.isCorrect(q, resp);
    S.responses[q.id] = { response: resp, correct, skipped: !!skipped, at: Date.now() };
    save();
    $("qCard").classList.add("locked"); $("submitBtn").disabled = true;
    $("qStatus").className = "status recorded"; $("qStatus").textContent = skipped ? "Skipped" : "Answer recorded";
    meter.setScore(score().p);
    // roughly one answer in four gets a harder bounce, never two in a row
    const hard = (q.critical && !correct) || (!S.lastJolt && Math.random() < 0.25);
    S.lastJolt = hard; save();
    if (hard) meter.jolt(correct ? 1 : -1); else meter.kick(correct ? 1 : -1);
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
    if (e.key === "Enter" && e.target.closest && e.target.closest(".match-item")) return; // Enter picks a match item
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
        email: S.email, name: S.name, assessment: DATA.settings.assessmentCode, attempt: S.attempt || 1,
        startedAt: new Date(S.startedAt).toISOString(), finishedAt: new Date(S.finishedAt).toISOString(),
        correct: sc.c, total: QS().length, criticalErrors: sc.crit, criticalPenalty: sc.pen, marks: sc.marks, percent: pctOf(sc, QS().length), timedOut: S.timedOut, longestStreak: an.streak,
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
    const sc = score(), pct = pctOf(sc, n), an = analyse();
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
    $("resOf").textContent = `${sc.c} of ${n} correct` + (sc.crit ? ` · −${sc.pen * sc.crit} for critical errors` : "");
    $("resCrit").hidden = !sc.crit; $("resCrit").textContent = `${sc.crit} critical ${sc.crit === 1 ? "error" : "errors"}`;
    show("scrResults");
    countUp($("resPct"), pct, 1200);

    // every answer, in order
    const strip = $("resStrip"); strip.innerHTML = "";
    qs.forEach((q, i) => {
      const r = S.responses[q.id] || {};
      const cell = document.createElement("i");
      cell.className = (r.correct ? "ok" : r.skipped ? "skip" : "no") + (q.critical && !r.correct ? " crit" : "");
      cell.title = `Q${i + 1} · ${A.categoryOf(q)}${q.critical ? " · critical" : ""} · ${r.correct ? "right" : r.skipped ? "skipped" : "wrong"}`;
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

    $("certBtn").href = "certificate.html?" + new URLSearchParams({ n: name, c: sc.c, t: n, p: pct, b: best && best.pct > 0 ? best.name : "", d: new Date(S.finishedAt).toISOString() });

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
          <div class="q">${q.critical ? `<span class="crit-chip">Critical${r.correct ? "" : ` · −${PENALTY()}`}</span> ` : ""}${A.escapeHtml(q.prompt.replace(/_{3,}/g, "____"))}</div>
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
  // same person, fresh draw: back to the briefing with the attempt number bumped (every attempt is recorded)
  $("retakeBtn").addEventListener("click", () => {
    $("confetti").hidden = true; pieces = [];
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
