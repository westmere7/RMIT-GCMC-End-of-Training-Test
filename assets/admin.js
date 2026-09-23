/* Assessment editor: edits data/questions.json. Saves through the local server, or downloads the file. */
(function () {
  "use strict";
  const A = window.Assess;
  const $ = (id) => document.getElementById(id);
  let D = null, dirty = false;
  // The editor link carries the key: /admin.html?key=… (only checked when ADMIN_KEY is set on the server).
  const KEY_STORE = "gcmc-admin-key";
  const adminKey = (() => {
    const k = new URLSearchParams(location.search).get("key");
    try { if (k) sessionStorage.setItem(KEY_STORE, k); return k || sessionStorage.getItem(KEY_STORE) || ""; } catch (e) { return k || ""; }
  })();

  function setState(text, cls) { const el = $("saveState"); el.textContent = text; el.className = "save-state " + (cls || ""); }
  function markDirty() { dirty = true; setState("Unsaved changes", "dirty"); }
  addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- settings ----------
  const SETTINGS = [["sTitle", "title"], ["sSubtitle", "subtitle"], ["sCode", "assessmentCode"]];
  function renderSettings() {
    const s = (D.settings = D.settings || {}); s.gauge = s.gauge || {};
    for (const [id, key] of SETTINGS) { $(id).value = s[key] || ""; $(id).oninput = (e) => { s[key] = e.target.value; markDirty(); }; }
    $("sMins").value = s.timeLimitMinutes || 10; $("sMins").oninput = (e) => { s.timeLimitMinutes = Math.max(1, +e.target.value || 10); markDirty(); };
    $("sPer").value = s.questionsPerAttempt || 30; $("sPer").oninput = (e) => { s.questionsPerAttempt = Math.max(1, +e.target.value || 30); markDirty(); renderBank(); };
    $("sConf").value = s.confettiThreshold == null ? 95 : s.confettiThreshold; $("sConf").oninput = (e) => { s.confettiThreshold = +e.target.value; markDirty(); };
    $("sShuffle").checked = !!s.shuffleOptions; $("sShuffle").onchange = (e) => { s.shuffleOptions = e.target.checked; markDirty(); };
    delete s.gauge.middle;
    for (const [id, key, def] of [["gLeft", "left", "HR would like a word"], ["gRight", "right", "Welcome to the team"]]) {
      $(id).value = s.gauge[key] || def; $(id).oninput = (e) => { s.gauge[key] = e.target.value; markDirty(); };
    }
    renderGate();
  }
  function renderBank() {
    const n = D.questions.length, per = Math.min((D.settings || {}).questionsPerAttempt || 30, n);
    $("bankInfo").innerHTML = "<b>" + n + "</b> questions in the bank. Each attempt draws <b>" + per + "</b> at random.";
  }
  function renderGate() {
    // migrate the old single gate into the candidate list
    delete D.auth;
    const list = (D.candidates = D.candidates || []);
    $("gateState").innerHTML = list.length
      ? "<b>" + list.length + " " + (list.length > 1 ? "people" : "person") + " listed.</b> Anyone can still sign in; listed people are greeted by name."
      : "<b>Nobody listed.</b> Anyone can sign in, and is greeted by the first part of their email.";
    const box = $("candList"); box.innerHTML = "";
    list.forEach((c, i) => {
      const row = document.createElement("div"); row.className = "cand-item";
      row.innerHTML = "<b>" + A.escapeHtml(c.name || "Unnamed") + "</b><span class=\"set\">" + (c.emailSha256 ? "Email set" : "No email") + "</span>";
      const del = document.createElement("button"); del.type = "button"; del.className = "icon-btn danger"; del.textContent = "✕";
      del.title = "Remove candidate"; del.setAttribute("aria-label", "Remove " + (c.name || "candidate"));
      del.onclick = () => { list.splice(i, 1); markDirty(); renderGate(); };
      row.append(del); box.append(row);
    });
  }
  $("cAdd").onclick = async () => {
    const name = $("cName").value.trim(), email = A.normEmail($("cEmail").value);
    if (!name || !email) { setState("Enter a first name and an email.", "dirty"); return; }
    D.candidates.push({ name, emailSha256: await A.sha256(email) });
    $("cName").value = ""; $("cEmail").value = "";
    markDirty(); renderGate();
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
    const q = { id: newId(), type, topic: "", prompt: type === "fill" ? "Our stand-up is on ___." : "" };
    if (isChoice(type)) { q.options = ["", "", "", ""]; q.correct = []; } else q.answers = [];
    return q;
  }

  function renderList() {
    const box = $("qList"); box.innerHTML = "";
    $("qCount").textContent = `· ${D.questions.length}`; renderBank();
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
    const topic = document.createElement("input"); topic.className = "input topic"; topic.id = "topic-" + q.id; topic.placeholder = "Topic (e.g. Workflow)"; topic.value = q.topic || "";
    topic.oninput = () => { q.topic = topic.value; markDirty(); };
    const tools = document.createElement("div"); tools.className = "tools";
    const tool = (label, title, fn, danger) => { const b = document.createElement("button"); b.type = "button"; b.className = "icon-btn" + (danger ? " danger" : ""); b.textContent = label; b.title = title; b.setAttribute("aria-label", title); b.onclick = fn; tools.append(b); };
    tool("↑", "Move up", () => { if (i > 0) { [D.questions[i - 1], D.questions[i]] = [D.questions[i], D.questions[i - 1]]; markDirty(); renderList(); } });
    tool("↓", "Move down", () => { if (i < D.questions.length - 1) { [D.questions[i + 1], D.questions[i]] = [D.questions[i], D.questions[i + 1]]; markDirty(); renderList(); } });
    tool("⧉", "Duplicate", () => { const c = JSON.parse(JSON.stringify(q)); c.id = newId(); D.questions.splice(i + 1, 0, c); markDirty(); renderList(); });
    tool("✕", "Delete question", () => { D.questions.splice(i, 1); markDirty(); renderList(); }, true);
    head.append(sel, topic, tools); el.append(head);

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
    let res;
    try {
      res = await fetch("/api/questions" + (force ? "?force=1" : ""), {
        method: "PUT", headers: { "Content-Type": "application/json", "x-admin-key": adminKey }, body: JSON.stringify(data),
      });
    } catch (e) { res = null; }
    if (!res || res.status === 404 || res.status === 405 || !(res.headers.get("content-type") || "").includes("json")) {
      download(data); dirty = false;
      setState("There's no save API on this host, so questions.json was downloaded. Replace data/questions.json with it.", "dirty");
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) { showConflict(); return; }
    if (!res.ok) { setState(body.error || "Save failed (" + res.status + ").", "dirty"); return; }
    D.revision = body.revision; dirty = false; hideConflict();
    setState(`Saved · revision ${body.revision} · ${new Date().toLocaleTimeString()}`, "ok");
  }
  function showConflict() {
    setState("Someone else saved while you were editing.", "dirty");
    $("conflict").hidden = false;
  }
  function hideConflict() { $("conflict").hidden = true; }
  $("saveBtn").onclick = () => save(false);
  $("reloadLatest").onclick = async () => { dirty = false; D = await A.loadData(); renderAll(); hideConflict(); setState("Loaded the latest version · revision " + (D.revision || 0), "ok"); };
  $("overwrite").onclick = () => save(true);
  $("downloadBtn").onclick = async () => { try { download(await collect()); } catch (e) { setState(e.message, "dirty"); } };
  $("importFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.questions)) throw new Error(); D = d; renderAll(); markDirty(); }
    catch (err) { setState("That file isn't a valid questions.json.", "dirty"); }
    e.target.value = "";
  };

  function renderAll() { renderSettings(); renderList(); }
  (async () => {
    try { D = await A.loadData(); renderAll(); setState("Up to date · revision " + (D.revision || 0), "ok"); }
    catch (e) { setState(e.message, "dirty"); }
  })();
})();
