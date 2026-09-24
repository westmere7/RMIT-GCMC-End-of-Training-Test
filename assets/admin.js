/* Assessment editor: edits data/questions.json. Saves through the local server, or downloads the file. */
(function () {
  "use strict";
  const A = window.Assess;
  const $ = (id) => document.getElementById(id);
  const esc = A.escapeHtml;
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

  // small DOM helper: el("div.a.b", { text, html, attrs… }, ...children)
  function el(tag, props, ...kids) {
    const [name, ...cls] = tag.split(".");
    const n = document.createElement(name);
    if (cls.length) n.className = cls.join(" ");
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "value") n.value = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n[k] = v;
      else if (k in n && typeof v !== "string") n[k] = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    n.append(...kids.filter((k) => k != null));
    return n;
  }

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
    $("sCats").oninput = (e) => { s.categories = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); markDirty(); renderList(); renderEditor(); };
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
    const stat = (v, k, sub) => `<div class="bstat"><b>${v}</b><span>${k}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
    $("bankStats").innerHTML = stat(n, "Questions in the bank") + stat(cats.size, "Categories") + stat(per, "Per attempt", Math.round((100 * per) / Math.max(1, n)) + "% of the bank")
      + stat(nc, "Critical", "−" + pen + " marks each if wrong");
    $("perHelp").textContent = per >= cats.size ? "At least one from every category, the rest at random." : `Fewer than the ${cats.size} categories, so some categories won't appear.`;
    const counts = new Map(); D.questions.forEach((q) => { const c = A.categoryOf(q); counts.set(c, (counts.get(c) || 0) + 1); });
    const listed = A.categoriesOf(D.settings);
    $("catCounts").innerHTML = [...listed, ...[...counts.keys()].filter((c) => !listed.includes(c))].map((c) =>
      `<span class="cat-count${listed.includes(c) ? "" : " stray"}"${listed.includes(c) ? "" : ' title="Not in the category list"'}>${esc(c)} <b>${counts.get(c) || 0}</b></span>`).join("");
  }
  // ---------- people (first names, saved straight to the live API) ----------
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
      $("gateState").innerHTML = e.message === "no api" ? "<b>People can only be managed where the live API runs</b> (the Vercel site, or the local dev server)." : esc(e.message);
      $("cAdd").disabled = true; box.innerHTML = ""; return;
    }
    $("tabPCount").textContent = list.length || "";
    $("gateState").innerHTML = list.length
      ? "<b>" + list.length + " " + (list.length > 1 ? "people" : "person") + " saved.</b> Anyone can sign in; saved people are greeted by name."
      : "<b>Nobody saved yet.</b> Anyone can sign in, and is asked for their first name the first time.";
    box.innerHTML = "";
    list.forEach((c) => {
      const del = el("button.icon-btn.danger", { type: "button", text: "✕", title: "Remove " + (c.name || "person"), "aria-label": "Remove " + (c.name || "person") });
      del.onclick = async () => { try { await peopleCall("DELETE", null, c.email_sha256); loadPeople(); } catch (e) { setState(e.message, "dirty"); } };
      box.append(el("div.cand-item", {}, el("b", { text: c.name || "Unnamed" }),
        el("span.set", { text: c.updated_at ? "Saved " + new Date(c.updated_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "" }), del));
    });
  }
  $("cAdd").onclick = async () => {
    const name = $("cName").value.trim(), email = A.normEmail($("cEmail").value);
    if (!name || !email) { setState("Enter a first name and an email.", "dirty"); return; }
    try { await peopleCall("POST", { name, email_sha256: await A.sha256(email) }); } catch (e) { setState(e.message, "dirty"); return; }
    $("cName").value = ""; $("cEmail").value = ""; loadPeople();
  };

  // ---------- questions ----------
  // [value, name, what the candidate does]
  const TYPES = [
    ["single", "Single choice", "Picks one"],
    ["multi", "Multi choice", "Ticks all that apply"],
    ["match", "Match pairs", "Links A to B"],
    ["fill", "Fill in the blank", "Types the gap"],
    ["short", "Short answer", "Types a reply"],
  ];
  const TYPE_NAME = Object.fromEntries(TYPES.map(([v, l]) => [v, l]));
  const LETTERS = "ABCDEFGHIJ", MAX_OPTS = 8, MAX_PAIRS = 8;
  const isChoice = (t) => t === "single" || t === "multi";
  const isText = (t) => t === "fill" || t === "short";
  // a small glyph per type, so single and multi (and the rest) read differently at a glance
  const typeIcon = (t) => `<i class="ti ti-${t}" aria-hidden="true"></i>`;

  function problems(q) {
    const p = [];
    if (!String(q.prompt || "").trim()) p.push("Write the question.");
    if (isChoice(q.type)) {
      const opts = (q.options || []).filter((o) => String(o).trim());
      if (opts.length < 2) p.push("Add at least two options.");
      if ((q.options || []).some((o, k) => !String(o).trim() && (q.correct || []).includes(k))) p.push("A correct option is empty.");
      if (!(q.correct || []).length) p.push(q.type === "multi" ? "Tick every correct option." : "Mark the correct option.");
      if (q.type === "single" && (q.correct || []).length > 1) p.push("A single-choice question can only have one correct option.");
    } else if (q.type === "match") {
      const pairs = q.pairs || [];
      if (pairs.filter((x) => String(x.left).trim() && String(x.right).trim()).length < 2) p.push("Add at least two complete pairs.");
      if (pairs.some((x) => !String(x.left).trim() !== !String(x.right).trim())) p.push("Every pair needs both an A and a B side.");
      const dupe = (side) => { const s = pairs.map((x) => A.normalize(x[side])).filter(Boolean); return new Set(s).size !== s.length; };
      if (dupe("left") || dupe("right")) p.push("Two pairs share the same text, so the match would be ambiguous.");
    } else {
      if (!(q.answers || []).some((a) => A.normalize(a))) p.push("Add at least one accepted answer.");
      if (q.type === "fill" && !/_{3,}/.test(q.prompt || "")) p.push("Put ___ where the blank goes.");
    }
    return p;
  }

  function newId() { let n = D.questions.length + 1, id; do { id = "q" + String(n++).padStart(2, "0"); } while (D.questions.some((q) => q.id === id)); return id; }
  function blank(type, category) {
    const q = { id: newId(), type, category, prompt: "" };
    if (isChoice(type)) { q.options = ["", "", "", ""]; q.correct = []; }
    else if (type === "match") q.pairs = [{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }];
    else q.answers = [];
    return q;
  }

  // ----- state: selection, filters, and fields set aside when a question changes type -----
  let selId = null, lastType = "single", ansRows = null;
  const F = { q: "", cat: "", type: "", crit: false, bad: false };
  const stash = new Map(); // id → { options, correct, pairs, answers } kept while editing, so switching back restores them
  const byId = (id) => D.questions.find((q) => q.id === id);
  const numOf = (q) => D.questions.indexOf(q) + 1;

  function matches(q) {
    if (F.cat && A.categoryOf(q) !== F.cat) return false;
    if (F.type && q.type !== F.type) return false;
    if (F.crit && !q.critical) return false;
    if (F.bad && !problems(q).length) return false;
    if (F.q) {
      const hay = [q.id, q.prompt, ...(q.options || []), ...(q.answers || []), ...(q.pairs || []).flatMap((x) => [x.left, x.right])].join(" ").toLowerCase();
      if (!F.q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }
  const filtering = () => !!(F.q || F.cat || F.type || F.crit || F.bad);

  // ----- the list -----
  function renderFilters() {
    const qs = D.questions, cats = A.categoriesOf(D.settings), counts = new Map();
    qs.forEach((q) => { const c = A.categoryOf(q); counts.set(c, (counts.get(c) || 0) + 1); });
    const fc = $("fCat"); fc.innerHTML = "";
    fc.add(new Option(`All categories`, ""));
    for (const c of [...cats, ...[...counts.keys()].filter((c) => !cats.includes(c))]) fc.add(new Option(`${c} (${counts.get(c) || 0})`, c));
    fc.value = F.cat;
    const ft = $("fType"); ft.innerHTML = "";
    ft.add(new Option("All types", ""));
    for (const [v, l] of TYPES) ft.add(new Option(`${l} (${qs.filter((q) => q.type === v).length})`, v));
    ft.value = F.type;
    renderFilterCounts();
  }
  function renderFilterCounts() {
    const nc = D.questions.filter((q) => q.critical).length, nb = D.questions.filter((q) => problems(q).length).length;
    $("fCrit").querySelector("b").textContent = nc; $("fCrit").setAttribute("aria-pressed", String(F.crit));
    $("fBad").querySelector("b").textContent = nb; $("fBad").setAttribute("aria-pressed", String(F.bad));
    $("fBad").hidden = !nb && !F.bad;
    $("fClear").hidden = !filtering();
  }

  function renderList() {
    const n = D.questions.length;
    $("tabQCount").textContent = n; $("qCount").textContent = n;
    renderBank(); renderFilters();
    const box = $("qList"); box.innerHTML = "";
    const cats = A.categoriesOf(D.settings), groups = new Map(cats.map((c) => [c, []]));
    D.questions.forEach((q) => { if (!matches(q)) return; const c = A.categoryOf(q); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(q); });
    let shown = 0;
    for (const [c, list] of groups) {
      if (!list.length) continue;
      shown += list.length;
      const g = el("div.qgroup", { role: "group", "aria-label": c });
      g.append(el("div.qgroup-h", { html: `<span>${esc(c)}</span><b>${list.length}</b>` }));
      list.forEach((q) => g.append(renderRow(q)));
      box.append(g);
    }
    if (!shown) box.append(el("div.qx-empty", {}, el("p", { text: n ? "No questions match these filters." : "The bank is empty." }),
      n ? el("button.btn.ghost.small", { type: "button", text: "Clear filters", onclick: clearFilters }) : null));
    $("qShown").textContent = filtering() ? ` · showing ${shown}` : "";
  }
  function renderRow(q) {
    const b = el("button.qrow", { type: "button" }); b.dataset.id = q.id;
    b.onclick = () => select(q.id);
    paintRow(b, q);
    return b;
  }
  function paintRow(b, q) {
    const bad = problems(q).length, text = String(q.prompt || "").trim();
    b.classList.toggle("sel", q.id === selId); b.classList.toggle("bad", !!bad); b.classList.toggle("crit", !!q.critical);
    b.setAttribute("aria-current", q.id === selId ? "true" : "false");
    b.innerHTML = `<span class="qrow-n">${numOf(q)}</span>
      <span class="qrow-body"><span class="qrow-text${text ? "" : " empty"}">${esc(text || "New question")}</span>
      <span class="qrow-meta"><span class="qrow-type t-${q.type}">${typeIcon(q.type)}${TYPE_NAME[q.type] || q.type}</span>${q.critical ? '<span class="qrow-crit">Critical</span>' : ""}${bad ? '<span class="qrow-bad">Needs fixing</span>' : ""}</span></span>`;
  }
  function refreshRow(q) { const b = rowOf(q.id); if (b) paintRow(b, q); renderFilterCounts(); }
  const rowOf = (id) => $("qList").querySelector(`.qrow[data-id="${CSS.escape(id)}"]`);
  const visibleIds = () => [...$("qList").querySelectorAll(".qrow")].map((b) => b.dataset.id);

  function select(id, opts) {
    opts = opts || {};
    if (id !== selId) ansRows = null;
    selId = id;
    try { history.replaceState(null, "", id ? "#" + id : location.pathname + location.search); } catch (e) { /* file:// or sandboxed */ }
    $("qList").querySelectorAll(".qrow").forEach((b) => { const on = b.dataset.id === id; b.classList.toggle("sel", on); b.setAttribute("aria-current", String(on)); });
    renderEditor();
    const row = id && rowOf(id); if (row) row.scrollIntoView({ block: "nearest" });
    if (opts.focus && $("qPrompt")) $("qPrompt").focus();
    if (!opts.keepScroll && innerWidth > 980) { const ed = $("qEditor"); if (ed.getBoundingClientRect().top < 0) ed.scrollIntoView({ block: "start" }); }
  }
  function step(dir) {
    const ids = visibleIds(); if (!ids.length) return;
    const k = ids.indexOf(selId);
    select(ids[k < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, k + dir))]);
  }

  function clearFilters() {
    Object.assign(F, { q: "", cat: "", type: "", crit: false, bad: false });
    $("qSearch").value = ""; renderList();
    const row = selId && rowOf(selId); if (row) row.scrollIntoView({ block: "nearest" });
  }
  $("qSearch").oninput = (e) => { F.q = e.target.value.trim().toLowerCase(); renderList(); };
  $("fCat").onchange = (e) => { F.cat = e.target.value; renderList(); };
  $("fType").onchange = (e) => { F.type = e.target.value; renderList(); };
  $("fCrit").onclick = () => { F.crit = !F.crit; renderList(); };
  $("fBad").onclick = () => { F.bad = !F.bad; renderList(); };
  $("fClear").onclick = clearFilters;

  // ----- adding, duplicating, deleting -----
  function newQuestion(o) {
    o = o || {};
    const cur = byId(selId), cats = A.categoriesOf(D.settings);
    const cat = o.cat || F.cat || (cur && A.categoryOf(cur)) || cats[0];
    const q = blank(o.type || lastType, cat);
    D.questions.push(q);
    // make sure the new question is visible in the list: keep the category filter only if it matches
    Object.assign(F, { q: "", type: "", crit: false, bad: false, cat: F.cat === cat ? F.cat : "" }); $("qSearch").value = "";
    markDirty(); renderList(); select(q.id, { focus: true });
    toast(`Added question ${numOf(q)} to ${cat}.`);
  }
  $("newQ").onclick = () => newQuestion();

  function duplicate(q) {
    const c = JSON.parse(JSON.stringify(q)); c.id = newId();
    D.questions.splice(D.questions.indexOf(q) + 1, 0, c);
    markDirty(); renderList(); select(c.id, { focus: true });
    toast(`Duplicated as question ${numOf(c)}.`);
  }
  function remove(q) {
    const i = D.questions.indexOf(q), ids = visibleIds(), k = ids.indexOf(q.id);
    const next = ids[k + 1] || ids[k - 1] || null;
    D.questions.splice(i, 1); markDirty(); renderList(); select(next, { keepScroll: true });
    toast(`Deleted question ${i + 1}.`, { label: "Undo", fn: () => { D.questions.splice(i, 0, q); markDirty(); renderList(); select(q.id); } });
  }

  let toastT = 0;
  function toast(msg, action) {
    const t = $("toast"); t.innerHTML = ""; t.append(el("span", { text: msg }));
    if (action) t.append(el("button", { type: "button", text: action.label, onclick: () => { t.hidden = true; action.fn(); } }));
    t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3000);
  }

  // ----- changing type, keeping what was typed -----
  function setType(q, t) {
    if (t === q.type) return;
    const keep = stash.get(q.id) || {};
    for (const k of ["options", "correct", "pairs", "answers"]) if (q[k] !== undefined) { keep[k] = q[k]; delete q[k]; }
    if (isChoice(t)) {
      q.options = keep.options || ["", "", "", ""];
      q.correct = (keep.correct || []).slice(0, t === "single" ? 1 : undefined);
    } else if (t === "match") q.pairs = keep.pairs || [{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }];
    else q.answers = keep.answers || [];
    stash.set(q.id, keep);
    q.type = t; lastType = t; ansRows = null;
    markDirty(); refreshRow(q); renderEditor();
  }

  // ----- the editor -----
  function renderEditor() {
    const box = $("qEditor"), q = byId(selId); box.innerHTML = "";
    if (!q) {
      box.append(el("div.card.qed-empty", {}, el("h3", { text: D.questions.length ? "No question open" : "No questions yet" }),
        el("p", { text: "Pick a question from the list, or start a new one." }),
        el("button.btn.small", { type: "button", html: '<span aria-hidden="true">+</span> New question', onclick: () => newQuestion() })));
      return;
    }
    const card = el("article.card.qed" + (q.critical ? ".critical" : ""), { "aria-label": "Question " + numOf(q) });
    card.dataset.type = q.type;

    // head: where you are, and what you can do with this question
    const ids = visibleIds(), k = ids.indexOf(q.id);
    const nav = el("div.qed-nav", {},
      el("button.icon-btn", { type: "button", text: "‹", title: "Previous question", "aria-label": "Previous question", disabled: k <= 0, onclick: () => step(-1) }),
      el("button.icon-btn", { type: "button", text: "›", title: "Next question", "aria-label": "Next question", disabled: k < 0 || k >= ids.length - 1, onclick: () => step(1) }));
    card.append(el("header.qed-head", {},
      el("div.qed-where", {}, el("p.eyebrow", { text: `Question ${numOf(q)} of ${D.questions.length}` }), el("span.qed-id", { text: "ID " + q.id })),
      el("div.qed-tools", {}, nav,
        el("button.btn.quiet.small", { type: "button", text: "Duplicate", onclick: () => duplicate(q) }),
        el("button.btn.quiet.small.danger", { type: "button", text: "Delete", onclick: () => remove(q) }))));

    // details: category and critical
    const cat = el("select.input", { id: "qCat" });
    const catList = A.categoriesOf(D.settings), cur = A.categoryOf(q);
    for (const c of catList.includes(cur) ? catList : [...catList, cur]) cat.add(new Option(c, c, false, c === cur));
    cat.onchange = () => { q.category = cat.value; markDirty(); renderList(); $("addAnother").textContent = `+ Add another to ${q.category}`; const r = rowOf(q.id); if (r) r.scrollIntoView({ block: "nearest" }); };
    const crit = el("label.crit-toggle", { title: "A wrong or skipped answer on a critical question loses extra marks" });
    const cb = el("input", { type: "checkbox", checked: !!q.critical });
    crit.append(cb, el("span", { html: "<b>Critical</b> · loses " + (D.settings.criticalPenalty == null ? 3 : D.settings.criticalPenalty) + " marks if wrong" }));
    cb.onchange = () => { if (cb.checked) q.critical = true; else delete q.critical; card.classList.toggle("critical", cb.checked); markDirty(); refreshRow(q); renderBank(); };
    card.append(el("div.qed-sec.qed-details", {},
      el("div.field", {}, el("label", { for: "qCat", text: "Category" }), cat),
      el("div.field", {}, el("span.lbl", { text: "Weighting" }), crit)));

    // the question itself
    const prompt = el("textarea.input.qed-prompt", { id: "qPrompt", rows: 2, value: q.prompt || "",
      placeholder: q.type === "fill" ? "e.g. Our stand-up is every ___ morning." : q.type === "match" ? "e.g. Match each platform to what we use it for." : "e.g. Which platform should you never upload files to?" });
    const grow = () => { prompt.style.height = "auto"; prompt.style.height = prompt.scrollHeight + 3 + "px"; };
    prompt.oninput = () => { q.prompt = prompt.value; markDirty(); refreshRow(q); refreshStatus(); grow(); };
    const psec = el("div.qed-sec", {}, el("label.qed-label", { for: "qPrompt", text: "Question" }), prompt);
    if (q.type === "fill") {
      const ins = el("button.btn.ghost.small", { type: "button", text: "Insert blank ___" });
      ins.onclick = () => {
        const a = prompt.selectionStart, b = prompt.selectionEnd, v = prompt.value;
        prompt.value = v.slice(0, a) + "___" + v.slice(b); prompt.focus(); prompt.setSelectionRange(a + 3, a + 3); prompt.oninput();
      };
      psec.append(el("div.qed-hint", {}, ins, el("span", { html: "Candidates type into the gap where <b>___</b> sits." })));
    }
    card.append(psec);
    requestAnimationFrame(grow);

    // the answer: type first, then what counts as right
    const seg = el("div.seg", { role: "radiogroup", "aria-label": "Question type" });
    for (const [v, l, d] of TYPES) {
      const b = el("button.seg-b.t-" + v, { type: "button", role: "radio", "aria-checked": String(v === q.type), html: `${typeIcon(v)}<span><b>${l}</b><small>${d}</small></span>` });
      b.onclick = () => setType(q, v);
      seg.append(b);
    }
    const ans = el("div.qed-answers", { id: "qAnswers" });
    card.append(el("div.qed-sec", {}, el("span.qed-label", { text: "Type" }), seg, ans));
    renderAnswers(q, ans);

    // footer: is it ready, and a quick way to keep going
    card.append(el("footer.qed-foot", {}, el("div.qed-status", { id: "qStatus", role: "status" }),
      el("button.btn.ghost.small", { type: "button", id: "addAnother", text: `+ Add another to ${A.categoryOf(q)}`, title: "Same category and type (Alt+N)", onclick: () => newQuestion({ cat: A.categoryOf(q), type: q.type }) })));
    box.append(card);
    refreshStatus();
  }

  function refreshStatus() {
    const q = byId(selId), box = $("qStatus"); if (!q || !box) return;
    const p = problems(q);
    box.className = "qed-status " + (p.length ? "bad" : "ok");
    box.innerHTML = p.length ? `<b>Needs fixing</b><ul>${p.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<b>Ready</b><span>This question can go in the test.</span>";
  }
  const changed = (q) => { markDirty(); refreshRow(q); refreshStatus(); };
  // re-render only the answer block, and put the cursor back where it's wanted
  function redrawAnswers(q, focusId, caretEnd) {
    const ans = $("qAnswers"); renderAnswers(q, ans); changed(q);
    const f = focusId && $(focusId); if (f) { f.focus(); if (caretEnd && f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length); }
  }

  // Enter adds a row below; Backspace on an empty row removes it; arrows move between rows
  function rowKeys(e, k, n, add, del, idOf, min) {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); add(k + 1); }
    else if (e.key === "Backspace" && !e.target.value && n > min) { e.preventDefault(); del(k, Math.max(0, k - 1)); }
    else if (e.key === "ArrowDown" && k < n - 1) { e.preventDefault(); const f = $(idOf(k + 1)); if (f) f.focus(); }
    else if (e.key === "ArrowUp" && k > 0) { e.preventDefault(); const f = $(idOf(k - 1)); if (f) f.focus(); }
  }

  function renderAnswers(q, box) {
    box.innerHTML = "";
    if (isChoice(q.type)) return renderOptions(q, box);
    if (q.type === "match") return renderPairs(q, box);
    renderAccepted(q, box);
  }

  function renderOptions(q, box) {
    const multi = q.type === "multi", correct = q.correct || [];
    box.append(el("p.qed-how.t-" + q.type, { html: multi
      ? `${typeIcon("multi")}<span><b>Tick every correct option.</b> Candidates see “Select all that apply” and must pick exactly these.</span>`
      : `${typeIcon("single")}<span><b>Choose the one correct option.</b> Candidates see “Choose one answer”.</span>` }));
    const list = el("div.opts" + (multi ? ".multi" : ".single"), { role: multi ? "group" : "radiogroup", "aria-label": "Correct option" });
    const idOf = (k) => `o-${q.id}-${k}`;
    const add = (at) => { if (q.options.length >= MAX_OPTS) return; q.options.splice(at, 0, ""); q.correct = correct.map((x) => (x >= at ? x + 1 : x)); redrawAnswers(q, idOf(at)); };
    const del = (k, focusK) => { q.options.splice(k, 1); q.correct = (q.correct || []).filter((x) => x !== k).map((x) => (x > k ? x - 1 : x)); redrawAnswers(q, idOf(Math.min(focusK, q.options.length - 1)), true); };
    q.options.forEach((o, k) => {
      const on = correct.includes(k);
      const mark = el("button.opt-mark", { type: "button", role: multi ? "checkbox" : "radio", "aria-checked": String(on),
        title: on ? "Correct answer" : "Mark as correct", "aria-label": `Option ${LETTERS[k]} is correct`, html: `<span class="l">${LETTERS[k]}</span>` });
      mark.onclick = () => {
        q.correct = multi ? (on ? correct.filter((x) => x !== k) : [...correct, k].sort((a, b) => a - b)) : [k];
        redrawAnswers(q, "m-" + q.id + "-" + k);
      };
      mark.id = "m-" + q.id + "-" + k;
      const txt = el("input.input", { id: idOf(k), value: o, placeholder: `Option ${LETTERS[k]}`, "aria-label": `Option ${LETTERS[k]}` });
      txt.oninput = () => { q.options[k] = txt.value; changed(q); };
      txt.onkeydown = (e) => rowKeys(e, k, q.options.length, add, del, idOf, 2);
      const x = el("button.icon-btn.danger", { type: "button", text: "✕", title: "Remove option", "aria-label": `Remove option ${LETTERS[k]}`, disabled: q.options.length <= 2 });
      x.onclick = () => del(k, k);
      list.append(el("div.opt-row" + (on ? ".correct" : ""), {}, mark, txt, on ? el("span.opt-tag", { text: "Correct" }) : el("span.opt-tag"), x));
    });
    box.append(list);
    box.append(el("div.qed-sub", {},
      el("button.btn.ghost.small", { type: "button", text: "+ Add option", disabled: q.options.length >= MAX_OPTS, onclick: () => add(q.options.length) }),
      el("span", { text: "Click a letter to mark it correct. Press Enter in an option to add another." })));
  }

  function renderPairs(q, box) {
    box.append(el("p.qed-how.t-match", { html: `${typeIcon("match")}<span><b>Write each pair on one row.</b> Candidates see Column B shuffled and match every A to its B. All pairs must be right for the mark.</span>` }));
    const list = el("div.pairs");
    list.append(el("div.pair-head", { html: '<span></span><span><i>A</i> Item</span><span></span><span><i>B</i> Its match</span><span></span>' }));
    const idOf = (k) => `pl-${q.id}-${k}`;
    const add = (at) => { if (q.pairs.length >= MAX_PAIRS) return; q.pairs.splice(at, 0, { left: "", right: "" }); redrawAnswers(q, idOf(at)); };
    const del = (k, focusK) => { q.pairs.splice(k, 1); redrawAnswers(q, idOf(Math.min(focusK, q.pairs.length - 1)), true); };
    q.pairs.forEach((pr, k) => {
      const l = el("input.input", { id: idOf(k), value: pr.left, placeholder: k ? "" : "e.g. Frame.io", "aria-label": `Pair ${k + 1}, Column A` });
      const r = el("input.input", { id: `pr-${q.id}-${k}`, value: pr.right, placeholder: k ? "" : "e.g. Reviewing designs with stakeholders", "aria-label": `Pair ${k + 1}, Column B` });
      l.oninput = () => { pr.left = l.value; changed(q); };
      r.oninput = () => { pr.right = r.value; changed(q); };
      l.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); r.focus(); } else rowKeys(e, k, q.pairs.length, add, del, idOf, 2); };
      r.onkeydown = (e) => { if (e.key === "Backspace" && !r.value) { e.preventDefault(); l.focus(); } else rowKeys(e, k, q.pairs.length, add, del, (j) => `pr-${q.id}-${j}`, 2); };
      const x = el("button.icon-btn.danger", { type: "button", text: "✕", title: "Remove pair", "aria-label": `Remove pair ${k + 1}`, disabled: q.pairs.length <= 2 });
      x.onclick = () => del(k, k);
      list.append(el("div.pair-row", {}, el("span.pair-n", { text: k + 1 }), l, el("span.pair-arrow", { text: "→", "aria-hidden": "true" }), r, x));
    });
    box.append(list);
    box.append(el("div.qed-sub", {},
      el("button.btn.ghost.small", { type: "button", text: "+ Add pair", disabled: q.pairs.length >= MAX_PAIRS, onclick: () => add(q.pairs.length) }),
      el("span", { text: `Up to ${MAX_PAIRS} pairs. Enter moves from A to B, then to a new pair.` })));
  }

  function renderAccepted(q, box) {
    if (!ansRows) ansRows = (q.answers || []).length ? q.answers.slice() : [""];
    const rows = ansRows, sync = () => { q.answers = rows.map((s) => s.trim()).filter(Boolean); changed(q); tryIt(); };
    box.append(el("p.qed-how.t-" + q.type, { html: `${typeIcon(q.type)}<span><b>List every answer you'll accept.</b> Capitals, accents, spaces and punctuation are ignored, so “Thursday.”, “thursday” and “THURSDAY” all match.</span>` }));
    const list = el("div.accepted");
    const idOf = (k) => `a-${q.id}-${k}`;
    const add = (at) => { rows.splice(at, 0, ""); redrawAnswers(q, idOf(at)); };
    const del = (k, focusK) => { rows.splice(k, 1); sync(); redrawAnswers(q, idOf(Math.min(focusK, rows.length - 1)), true); };
    rows.forEach((v, k) => {
      const inp = el("input.input", { id: idOf(k), value: v, placeholder: k ? "Another way to say it" : "The answer", "aria-label": k ? `Also accepted ${k}` : "Main answer" });
      inp.oninput = () => { rows[k] = inp.value; sync(); };
      inp.onkeydown = (e) => rowKeys(e, k, rows.length, add, del, idOf, 1);
      const x = el("button.icon-btn.danger", { type: "button", text: "✕", title: "Remove", "aria-label": "Remove this answer", disabled: rows.length <= 1 });
      x.onclick = () => del(k, k);
      list.append(el("div.acc-row", {}, el("span.acc-tag" + (k ? "" : ".main"), { text: k ? "Also" : "Shown as answer" }), inp, x));
    });
    box.append(list);
    const test = el("input.input", { id: "tryIt", placeholder: "e.g. thursday.", autocomplete: "off" }), res = el("span.res");
    function tryIt() { if (!test.value) { res.textContent = ""; res.className = "res"; return; } const ok = A.isCorrect(q, test.value); res.textContent = ok ? "✓ Accepted" : "✕ Not accepted"; res.className = "res " + (ok ? "yes" : "no"); }
    test.oninput = tryIt;
    box.append(el("div.qed-sub", {}, el("button.btn.ghost.small", { type: "button", text: "+ Add accepted answer", onclick: () => add(rows.length) }),
      el("div.tester", {}, el("label", { for: "tryIt", text: "Try an answer" }), test, res)));
  }

  // ---------- save / load ----------
  async function collect() {
    const bad = D.questions.filter((q) => problems(q).length);
    if (bad.length) {
      Object.assign(F, { q: "", cat: "", type: "", crit: false, bad: true }); $("qSearch").value = "";
      setTab("questions"); renderList(); select(bad[0].id);
      throw new Error(`${bad.length} ${bad.length > 1 ? "questions need" : "question needs"} fixing before saving. They're listed on the left.`);
    }
    D.questions.forEach((q) => {
      if (isChoice(q.type)) q.options = q.options.map((o) => String(o).trim());
      if (q.type === "match") q.pairs = q.pairs.map((x) => ({ left: String(x.left).trim(), right: String(x.right).trim() })).filter((x) => x.left && x.right);
    });
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
    D.revision = body.revision; setBaseline(); hideConflict(); stash.clear();
    setState(`Saved · revision ${body.revision} · ${new Date().toLocaleTimeString()}`, "ok");
  }
  function showConflict() {
    setState("Someone else saved while you were editing.", "dirty");
    $("conflict").hidden = false;
  }
  function hideConflict() { $("conflict").hidden = true; }
  $("saveBtn").onclick = () => save(false);
  $("reloadLatest").onclick = async () => { D = await A.loadData(); stash.clear(); ansRows = null; renderAll(); setBaseline(); hideConflict(); setState("Loaded the latest version · revision " + (D.revision || 0), "ok"); };
  $("overwrite").onclick = () => save(true);
  $("edRetry").onclick = () => location.reload();

  // Ctrl/⌘+S saves; Alt+N starts a new question (same category and type as the open one)
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!$("saveBtn").disabled) save(false); }
    else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN" && D) {
      e.preventDefault(); setTab("questions"); const q = byId(selId); newQuestion(q ? { cat: A.categoryOf(q), type: q.type } : {});
    }
  });

  // ---------- tabs: Questions is always the default ----------
  function setTab(name) {
    document.querySelectorAll(".ed-tabs .tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
    scrollTo(0, 0);
  }
  document.querySelectorAll(".ed-tabs .tab").forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });

  // the list sticks under the top bar and save bar, so it needs their height
  const stick = () => document.documentElement.style.setProperty("--stick", document.querySelector(".topbar").offsetHeight + document.querySelector(".savebar").offsetHeight + "px");
  addEventListener("resize", stick);

  function renderAll() {
    renderSettings(); renderList();
    const want = decodeURIComponent(location.hash.slice(1));
    select(byId(selId) ? selId : byId(want) ? want : (D.questions[0] || {}).id || null, { keepScroll: true });
  }
  (async () => {
    try {
      D = await A.loadData(); stick(); renderAll(); setBaseline(); setState("Up to date · revision " + (D.revision || 0), "ok");
      const missing = D.questions.filter((q) => !q.category);
      if (missing.length) {
        missing.forEach((q) => { q.category = A.categoryOf(q); });
        renderList(); renderEditor(); markDirty();
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
