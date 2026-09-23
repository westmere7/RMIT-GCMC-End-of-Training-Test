/* Assessment editor: edits data/questions.json. Saves through the local server, or downloads the file. */
(function () {
  "use strict";
  const A = window.Assess;
  const $ = (id) => document.getElementById(id);
  let D = null, dirty = false;

  function setState(text, cls) { const el = $("saveState"); el.textContent = text; el.className = "save-state " + (cls || ""); }
  let baseline = "";
  const snapshot = () => JSON.stringify(D, (k, v) => (k === "revision" || k === "updatedAt" ? undefined : v));
  function setBaseline() { baseline = snapshot(); dirty = false; $("saveBtn").disabled = true; }
  function markDirty() {
    dirty = snapshot() !== baseline;
    $("saveBtn").disabled = !dirty;
    if (dirty) setState("Unsaved changes", "dirty");
    else setState("No changes since the last save · revision " + (D.revision || 0), "ok");
  }
  addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- settings ----------
  const SETTINGS = [["sTitle", "title"], ["sSubtitle", "subtitle"], ["sCode", "assessmentCode"]];
  function renderSettings() {
    const s = (D.settings = D.settings || {}); s.gauge = s.gauge || {};
    for (const [id, key] of SETTINGS) { $(id).value = s[key] || ""; $(id).oninput = (e) => { s[key] = e.target.value; markDirty(); }; }
    $("sMins").value = s.timeLimitMinutes || 10; $("sMins").oninput = (e) => { s.timeLimitMinutes = Math.max(1, +e.target.value || 10); markDirty(); };
    $("sPer").value = s.questionsPerAttempt || 30; $("sPer").oninput = (e) => { s.questionsPerAttempt = Math.max(1, +e.target.value || 30); markDirty(); renderBank(); };
    $("sConf").value = s.confettiThreshold == null ? 95 : s.confettiThreshold; $("sConf").oninput = (e) => { s.confettiThreshold = +e.target.value; markDirty(); };
    $("sPen").value = s.criticalPenalty == null ? 3 : s.criticalPenalty; $("sPen").oninput = (e) => { s.criticalPenalty = Math.max(0, +e.target.value || 0); markDirty(); renderBank(); };
    $("sShuffle").checked = !!s.shuffleOptions; $("sShuffle").onchange = (e) => { s.shuffleOptions = e.target.checked; markDirty(); };
    s.categories = A.categoriesOf(s);
    $("sCats").value = s.categories.join(", ");
    $("sCats").oninput = (e) => { s.categories = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); markDirty(); renderList(); };
    $("sExam").value = (s.examiners && s.examiners.length ? s.examiners : Examiners.DEFAULT).join("\n");
    $("sExam").oninput = (e) => { s.examiners = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean); markDirty(); };
    delete s.gauge.middle;
    for (const [id, key, def] of [["gLeft", "left", "HR would like a word"], ["gRight", "right", "Welcome to the team"]]) {
      $(id).value = s.gauge[key] || def; $(id).oninput = (e) => { s.gauge[key] = e.target.value; markDirty(); };
    }
    renderGate();
  }
  function renderBank() {
    const n = D.questions.length, per = Math.min((D.settings || {}).questionsPerAttempt || 30, n);
    const cats = new Set(D.questions.map(A.categoryOf));
    const nc = D.questions.filter((q) => q.critical).length, pen = D.settings.criticalPenalty == null ? 3 : D.settings.criticalPenalty;
    $("bankInfo").innerHTML = "<b>" + n + "</b> questions in <b>" + cats.size + "</b> categories. Each attempt draws <b>" + per + "</b> at random" + (per >= cats.size ? ", with at least one from every category." : ".")
      + " <b>" + nc + "</b> marked critical (−" + pen + " each if wrong).";
  }
  // ---------- people (first names, saved straight to the live API) ----------
  let peopleApi = true;
  async function peopleCall(method, body, h) {
    const res = await fetch("/api/people" + (h ? "?h=" + h : ""), { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (!(res.headers.get("content-type") || "").includes("json")) throw new Error("no api");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "People request failed (" + res.status + ").");
    return data;
  }
  function renderGate() { delete D.auth; if (D.candidates && !D.candidates.filter((c) => c.name && c.emailSha256).length) delete D.candidates; }
  async function loadPeople() {
    const box = $("candList");
    let list = [];
    try {
      // one-off: names kept in the old question document move to the people list
      const legacy = (D.candidates || []).filter((c) => c.name && c.emailSha256);
      for (const c of legacy) await peopleCall("POST", { name: c.name, email_sha256: c.emailSha256 });
      if (D.candidates) { delete D.candidates; markDirty(); }
      list = await peopleCall("GET");
    } catch (e) {
      peopleApi = false;
      $("gateState").innerHTML = e.message === "no api" ? "<b>People can only be managed where the live API runs</b> (the Vercel site, or the local dev server)." : A.escapeHtml(e.message);
      $("cAdd").disabled = true; box.innerHTML = ""; return;
    }
    $("gateState").innerHTML = list.length
      ? "<b>" + list.length + " " + (list.length > 1 ? "people" : "person") + " saved.</b> Anyone can sign in; saved people are greeted by name."
      : "<b>Nobody saved yet.</b> Anyone can sign in, and is asked for their first name the first time.";
    box.innerHTML = "";
    list.forEach((c) => {
      const row = document.createElement("div"); row.className = "cand-item";
      row.innerHTML = "<b>" + A.escapeHtml(c.name || "Unnamed") + "</b><span class=\"set\">" + (c.updated_at ? "Saved " + new Date(c.updated_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "") + "</span>";
      const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn danger"; del.textContent = "✕";
      del.title = "Remove " + (c.name || "person"); del.setAttribute("aria-label", "Remove " + (c.name || "person"));
      del.onclick = async () => { try { await peopleCall("DELETE", null, c.email_sha256); loadPeople(); } catch (e) { setState(e.message, "dirty"); } };
      row.append(del); box.append(row);
    });
  }
  $("cAdd").onclick = async () => {
    const name = $("cName").value.trim(), email = A.normEmail($("cEmail").value);
    if (!name || !email) { setState("Enter a first name and an email.", "dirty"); return; }
    try { await peopleCall("POST", { name, email_sha256: await A.sha256(email) }); } catch (e) { setState(e.message, "dirty"); return; }
    $("cName").value = ""; $("cEmail").value = ""; loadPeople();
  };

  // ---------- questions ----------
  const TYPES = [["single", "Single choice"], ["multi", "Multi choice"], ["fill", "Fill in the blank"], ["short", "Short answer"]];
  const isChoice = (t) => t === "single" || t === "multi";

  function problems(q) {
    const p = [];
    if (!String(q.prompt || "").trim()) p.push("Add the question text.");
    if (isChoice(q.type)) {
      const opts = (q.options || []).filter((o) => String(o).trim());
      if (opts.length < 2) p.push("Add at least two options.");
      if (!(q.correct || []).length) p.push("Mark the correct option.");
      if (q.type === "single" && (q.correct || []).length > 1) p.push("A single-choice question can only have one correct option.");
    } else {
      if (!(q.answers || []).some((a) => A.normalize(a))) p.push("Add at least one accepted answer.");
      if (q.type === "fill" && !/_{3,}/.test(q.prompt || "")) p.push("Put ___ where the blank goes.");
    }
    return p;
  }

  function newId() { let n = D.questions.length + 1, id; do { id = "q" + String(n++).padStart(2, "0"); } while (D.questions.some((q) => q.id === id)); return id; }
  function blank(type) {
    const q = { id: newId(), type, category: A.categoriesOf(D.settings)[0], prompt: type === "fill" ? "Our stand-up is on ___." : "" };
    if (isChoice(type)) { q.options = ["", "", "", ""]; q.correct = []; } else q.answers = [];
    return q;
  }

  function renderList() {
    const box = $("qList"); box.innerHTML = "";
    $("qCount").textContent = `· ${D.questions.length}`; $("tabQCount").textContent = D.questions.length; renderBank();
    D.questions.forEach((q, i) => box.append(renderQuestion(q, i)));
  }

  function renderQuestion(q, i) {
    const el = document.createElement("div"); el.className = "qe";
    const head = document.createElement("div"); head.className = "qe-head";
    head.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>`;
    const sel = document.createElement("select"); sel.className = "input"; sel.id = "type-" + q.id; sel.setAttribute("aria-label", "Question type");
    for (const [v, l] of TYPES) sel.add(new Option(l, v, false, v === q.type));
    sel.onchange = () => {
      const t = sel.value;
      if (isChoice(t) && !q.options) { q.options = ["", "", "", ""]; q.correct = []; delete q.answers; }
      if (!isChoice(t) && !q.answers) { q.answers = []; delete q.options; delete q.correct; }
      if (t === "single" && q.correct && q.correct.length > 1) q.correct = q.correct.slice(0, 1);
      q.type = t; markDirty(); renderList();
    };
    const cat = document.createElement("select"); cat.className = "input cat"; cat.id = "cat-" + q.id; cat.setAttribute("aria-label", "Category");
    const catList = A.categoriesOf(D.settings), cur = A.categoryOf(q);
    for (const c of catList.includes(cur) ? catList : [...catList, cur]) cat.add(new Option(c, c, false, c === cur));
    cat.onchange = () => { q.category = cat.value; markDirty(); renderBank(); };
    const crit = document.createElement("label"); crit.className = "crit-toggle"; crit.title = "A wrong answer on a critical question loses extra marks";
    crit.innerHTML = '<input type="checkbox"> Critical'; const cb = crit.querySelector("input"); cb.checked = !!q.critical;
    el.classList.toggle("critical", !!q.critical);
    cb.onchange = () => { if (cb.checked) q.critical = true; else delete q.critical; el.classList.toggle("critical", cb.checked); markDirty(); renderBank(); };
    const tools = document.createElement("div"); tools.className = "tools";
    const tool = (label, title, fn, danger) => { const b = document.createElement("button"); b.type = "button"; b.className = "icon-btn" + (danger ? " danger" : ""); b.textContent = label; b.title = title; b.setAttribute("aria-label", title); b.onclick = fn; tools.append(b); };
    tool("↑", "Move up", () => { if (i > 0) { [D.questions[i - 1], D.questions[i]] = [D.questions[i], D.questions[i - 1]]; markDirty(); renderList(); } });
    tool("↓", "Move down", () => { if (i < D.questions.length - 1) { [D.questions[i + 1], D.questions[i]] = [D.questions[i], D.questions[i + 1]]; markDirty(); renderList(); } });
    tool("⧉", "Duplicate", () => { const c = JSON.parse(JSON.stringify(q)); c.id = newId(); D.questions.splice(i + 1, 0, c); markDirty(); renderList(); });
    tool("✕", "Delete question", () => { D.questions.splice(i, 1); markDirty(); renderList(); }, true);
    head.append(sel, cat, crit, tools); el.append(head);

    const prompt = document.createElement("textarea"); prompt.className = "input"; prompt.id = "prompt-" + q.id; prompt.value = q.prompt || "";
    prompt.placeholder = q.type === "fill" ? "Sentence with ___ where the blank goes" : "Question text";
    const probBox = document.createElement("p"); probBox.className = "problems";
    const refreshProblems = () => { const p = problems(q); probBox.textContent = p.join(" "); el.classList.toggle("invalid", p.length > 0); };
    prompt.oninput = () => { q.prompt = prompt.value; markDirty(); refreshProblems(); };
    el.append(prompt);

    if (isChoice(q.type)) {
      const opts = document.createElement("div"); opts.className = "opts";
      q.options.forEach((o, k) => {
        const row = document.createElement("div"); row.className = "opt-row" + ((q.correct || []).includes(k) ? " correct" : "");
        const mark = document.createElement("input"); mark.type = q.type === "single" ? "radio" : "checkbox"; mark.name = "c-" + q.id; mark.id = `c-${q.id}-${k}`;
        mark.checked = (q.correct || []).includes(k); mark.title = "Correct answer"; mark.setAttribute("aria-label", "Correct answer");
        mark.onchange = () => {
          if (q.type === "single") q.correct = [k];
          else q.correct = mark.checked ? [...new Set([...(q.correct || []), k])] : (q.correct || []).filter((x) => x !== k);
          markDirty(); renderList();
        };
        const txt = document.createElement("input"); txt.className = "input"; txt.id = `o-${q.id}-${k}`; txt.value = o; txt.placeholder = `Option ${String.fromCharCode(65 + k)}`;
        txt.oninput = () => { q.options[k] = txt.value; markDirty(); refreshProblems(); };
        const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn danger"; del.textContent = "✕"; del.title = "Remove option"; del.setAttribute("aria-label", "Remove option");
        del.onclick = () => {
          q.options.splice(k, 1);
          q.correct = (q.correct || []).filter((x) => x !== k).map((x) => (x > k ? x - 1 : x));
          markDirty(); renderList();
        };
        row.append(mark, txt, del); opts.append(row);
      });
      el.append(opts);
      const sub = document.createElement("div"); sub.className = "sub-actions";
      const add = document.createElement("button"); add.type = "button"; add.className = "btn ghost small"; add.textContent = "+ Add option";
      add.onclick = () => { q.options.push(""); markDirty(); renderList(); };
      sub.append(add, document.createTextNode(q.type === "single" ? "Tick the one correct option." : "Tick every correct option. She must select exactly these."));
      el.append(sub);
    } else {
      const lab = document.createElement("label"); lab.className = "answers-label"; lab.htmlFor = "ans-" + q.id; lab.textContent = "Accepted answers (one per line; the first is shown as the correct answer)";
      const ta = document.createElement("textarea"); ta.className = "input"; ta.id = "ans-" + q.id; ta.value = (q.answers || []).join("\n");
      ta.oninput = () => { q.answers = ta.value.split("\n").map((s) => s.trim()).filter(Boolean); markDirty(); refreshProblems(); };
      const tester = document.createElement("div"); tester.className = "tester";
      tester.innerHTML = `<label for="t-${q.id}">Try an answer:</label><input class="input" id="t-${q.id}" placeholder="e.g. thursday."><span class="res"></span>`;
      const ti = tester.querySelector("input"), tr = tester.querySelector(".res");
      ti.oninput = () => { if (!ti.value) { tr.textContent = ""; return; } const ok = A.isCorrect(q, ti.value); tr.textContent = ok ? "Accepted" : "Not accepted"; tr.className = "res " + (ok ? "yes" : "no"); };
      el.append(lab, ta, tester);
    }
    el.append(probBox); refreshProblems();
    return el;
  }

  for (const b of document.querySelectorAll("[data-add]")) b.onclick = () => { D.questions.push(blank(b.dataset.add)); markDirty(); renderList(); scrollTo(0, document.body.scrollHeight); };

  // ---------- save / load ----------
  async function collect() {
    const bad = D.questions.map((q, i) => [i + 1, problems(q)]).filter(([, p]) => p.length);
    if (bad.length) throw new Error(`Fix question ${bad.map(([n]) => n).join(", ")} first.`);
    D.questions.forEach((q) => { if (isChoice(q.type)) { q.options = q.options.map((o) => String(o).trim()); } });
    return D;
  }
  function download(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "questions.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function save(force) {
    let data;
    try { data = await collect(); } catch (e) { setState(e.message, "dirty"); return; }
    $("saveBtn").disabled = true; setState("Saving…");
    let res;
    try {
      res = await fetch("/api/questions" + (force ? "?force=1" : ""), {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
    } catch (e) { res = null; }
    if (!res || res.status === 404 || res.status === 405 || !(res.headers.get("content-type") || "").includes("json")) {
      download(data); setBaseline();
      setState("There's no save API on this host, so questions.json was downloaded. Replace data/questions.json with it.", "dirty");
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) { showConflict(); $("saveBtn").disabled = false; return; }
    if (!res.ok) { setState(body.error || "Save failed (" + res.status + ").", "dirty"); $("saveBtn").disabled = false; return; }
    D.revision = body.revision; setBaseline(); hideConflict();
    setState(`Saved · revision ${body.revision} · ${new Date().toLocaleTimeString()}`, "ok");
  }
  function showConflict() {
    setState("Someone else saved while you were editing.", "dirty");
    $("conflict").hidden = false;
  }
  function hideConflict() { $("conflict").hidden = true; }
  $("saveBtn").onclick = () => save(false);
  $("reloadLatest").onclick = async () => { D = await A.loadData(); renderAll(); setBaseline(); hideConflict(); setState("Loaded the latest version · revision " + (D.revision || 0), "ok"); };
  $("overwrite").onclick = () => save(true);
  $("edRetry").onclick = () => location.reload();
  // ---------- tabs: Questions is always the default ----------
  function setTab(name) {
    document.querySelectorAll(".ed-tabs .tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    document.querySelectorAll("[data-panel]").forEach((el) => { el.hidden = el.dataset.panel !== name; });
    scrollTo(0, 0);
  }
  document.querySelectorAll(".ed-tabs .tab").forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });

  function renderAll() { renderSettings(); renderList(); }
  (async () => {
    try {
      D = await A.loadData(); renderAll(); setBaseline(); setState("Up to date · revision " + (D.revision || 0), "ok");
      const missing = D.questions.filter((q) => !q.category);
      if (missing.length) {
        missing.forEach((q) => { q.category = A.categoryOf(q); });
        renderList(); markDirty();
        setState(`${missing.length} questions were given a category from their topic. Check them, then save to keep them.`, "dirty");
      }
      loadPeople();
    }
    catch (e) {
      setState(e.message, "dirty");
      $("edLoading").classList.add("failed");
      $("edLoadTitle").textContent = "Couldn't load the question bank.";
      $("edLoadMsg").textContent = e.message || "Check your connection and try again.";
      $("edRetry").hidden = false;
      return;
    }
    $("edLoading").hidden = true;
  })();
})();
