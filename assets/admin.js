/* Assessment editor: edits data/questions.json. Saves through the local server, or downloads the file. */
(function () {
  "use strict";
  const A = window.Assess;
  const $ = (id) => document.getElementById(id);
  const esc = A.escapeHtml;
  let D = null, dirty = false;

  // ---------- private links (no sign-in): the editor's key rides in its link; each team member has their own page link ----------
  const CONTRIB = document.body.dataset.mode === "contribute"; // contribute.html: one question at a time, never the bank
  const TEAM_TOKEN = CONTRIB ? new URLSearchParams(location.search).get("t") || "" : "";
  let editorKey = "";
  if (!CONTRIB) {
    const m = location.hash.match(/[#&]key=([^&]+)/), fromLink = m ? decodeURIComponent(m[1]) : "";
    try { if (fromLink) localStorage.setItem("gcmc-editor-key", fromLink); editorKey = fromLink || localStorage.getItem("gcmc-editor-key") || ""; }
    catch (e) { editorKey = fromLink; }
    if (m) history.replaceState(null, "", location.pathname + location.search); // keep the key out of the address bar
  }
  const keyHeader = () => (editorKey ? { "x-editor-key": editorKey } : {});

  function setState(text, cls) { const el = $("saveState"); if (!el) return; el.textContent = text; el.className = "save-state " + (cls || ""); }
  let baseline = "";
  const snapshot = () => JSON.stringify(D, (k, v) => (k === "revision" || k === "updatedAt" ? undefined : v));
  function setBaseline() { baseline = snapshot(); dirty = false; $("saveBtn").disabled = true; }
  function markDirty() {
    if (CONTRIB) return saveDraft(); // the draft is kept in this browser until it's sent
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
    $("sPer").value = Math.max(A.MIN_PER_ATTEMPT, s.questionsPerAttempt || 30);
    $("sPer").oninput = (e) => { s.questionsPerAttempt = Math.max(A.MIN_PER_ATTEMPT, +e.target.value || 30); markDirty(); renderBank(); };
    $("sPer").onchange = (e) => { e.target.value = s.questionsPerAttempt; }; // below 10 snaps back to 10
    // stored as the reading the zone starts at (95 = the top 5%); shown as the zone's size
    $("sConf").value = 100 - (s.confettiThreshold == null ? 95 : s.confettiThreshold);
    $("sConf").oninput = (e) => { const v = Math.max(1, Math.min(40, +e.target.value || 5)); s.confettiThreshold = 100 - v; markDirty(); };
    $("sConf").onchange = (e) => { e.target.value = 100 - s.confettiThreshold; };
    $("sCritShare").value = A.criticalShareOf(s);
    $("sCritShare").oninput = (e) => { const v = e.target.value; s.criticalShare = v === "" ? 15 : Math.max(0, Math.min(100, +v || 0)); markDirty(); renderBank(); };
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
    if (CONTRIB) return;
    const n = D.questions.length, per = A.perAttemptOf(D.settings, n), na = D.questions.filter((q) => q.always).length;
    const cats = new Set(D.questions.map(A.categoryOf));
    const nc = D.questions.filter((q) => q.critical).length;
    const stat = (v, k, sub) => `<div class="bstat"><b>${v}</b><span>${k}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
    $("bankStats").innerHTML = stat(n, "Questions in the bank") + stat(cats.size, "Categories") + stat(per, "Per attempt", Math.round((100 * per) / Math.max(1, n)) + "% of the bank")
      + stat(nc, "Critical", "points count double");
    const share = A.criticalShareOf(D.settings), want = Math.round((per * share) / 100), k = Math.min(nc, want);
    $("critShareHelp").textContent = `About ${k} of ${per} questions` + (want > nc ? `. Only ${nc} critical ${nc === 1 ? "question is" : "questions are"} in the bank, so that's the most an attempt can have.` : `, picked from the ${nc} critical ones in the bank.`);
    $("perHelp").textContent = `At least ${A.MIN_PER_ATTEMPT}. `
      + (na ? (na > per ? `${na} questions are marked "Always include", more than an attempt holds, so a random ${per} of them are drawn. ` : `Includes the ${na} marked "Always include". `) : "")
      + (per >= cats.size ? "At least one from every category, the rest at random." : `Fewer than the ${cats.size} categories, so some categories won't appear.`);
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
  if (!CONTRIB) $("cAdd").onclick = async () => {
    const name = $("cName").value.trim(), email = A.normEmail($("cEmail").value);
    if (!name || !email) { setState("Enter a first name and an email.", "dirty"); return; }
    try { await peopleCall("POST", { name, email_sha256: await A.sha256(email) }); } catch (e) { setState(e.message, "dirty"); return; }
    $("cName").value = ""; $("cEmail").value = ""; loadPeople();
  };

  // ---------- questions ----------
  const TYPES = [["single", "Single choice"], ["multi", "Multi choice"], ["match", "Match pairs"], ["image", "Image question"], ["fill", "Fill in the blank"], ["short", "Short answer"]];
  const TYPE_NAME = Object.fromEntries(TYPES.map(([v, l]) => [v, l]));
  const LETTERS = "ABCDEFGHIJ", MAX_OPTS = 8, MAX_PAIRS = 8;
  const narrow = () => matchMedia("(max-width: 640px)").matches; // phone layout: pair rows stack, so blank rows need labels
  const isChoice = (t) => t === "single" || t === "multi";
  const isText = (t) => t === "fill" || t === "short";

  function problems(q) {
    const p = [];
    if (!String(q.prompt || "").trim()) p.push("Write the question.");
    if (q.type === "image") {
      const opts = q.options || [], correct = q.correct || [];
      if (A.imageAnswers(q)) {
        if (opts.filter(Boolean).length < 2) p.push("Upload at least two picture options.");
        if (opts.some((o) => !o)) p.push("Every option needs a picture, or remove the empty one.");
      } else {
        if (!q.image) p.push("Upload the picture for the question.");
        if (opts.filter((o) => String(o).trim()).length < 2) p.push("Add at least two options.");
        if (opts.some((o, k) => !String(o).trim() && correct.includes(k))) p.push("A correct option is empty.");
      }
      if (!correct.length) p.push(q.multiple ? "Tick every correct option." : "Mark the correct option.");
      if (!q.multiple && correct.length > 1) p.push("Only one option can be correct unless “More than one correct” is on.");
    } else if (isChoice(q.type)) {
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
    else if (type === "image") Object.assign(q, { mode: "question", image: "", options: ["", "", "", ""], correct: [] });
    else if (type === "match") q.pairs = [{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }];
    else q.answers = [];
    return q;
  }

  // ----- state: selection, filters, and fields set aside when a question changes type -----
  let selId = null, lastType = "single", ansRows = null;
  const F = { q: "", cat: "", type: "", crit: false, always: false, bad: false };
  // the list: grouped by category, or the whole bank in number order (remembered in this browser)
  let view = "cat";
  try { view = localStorage.getItem("gcmc-editor-view") === "order" ? "order" : "cat"; } catch (e) { /* storage blocked: default */ }
  const stash = new Map(); // id → { options, correct, pairs, answers } kept while editing, so switching back restores them
  const byId = (id) => D.questions.find((q) => q.id === id);
  const numOf = (q) => D.questions.indexOf(q) + 1;

  function matches(q) {
    if (F.cat && A.categoryOf(q) !== F.cat) return false;
    if (F.type && q.type !== F.type) return false;
    if (F.crit && !q.critical) return false;
    if (F.always && !q.always) return false;
    if (F.bad && !problems(q).length) return false;
    if (/^#?\d+$/.test(F.q)) return numOf(q) === +F.q.replace("#", ""); // a number finds that question
    if (F.q) {
      const hay = [q.id, q.prompt, ...(q.options || []), ...(q.answers || []), ...(q.pairs || []).flatMap((x) => [x.left, x.right])].join(" ").toLowerCase();
      if (!F.q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }
  const filtering = () => !!(F.q || F.cat || F.type || F.crit || F.always || F.bad);

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
    const na = D.questions.filter((q) => q.always).length;
    $("fAlways").querySelector("b").textContent = na; $("fAlways").setAttribute("aria-pressed", String(F.always));
    $("fAlways").hidden = !na && !F.always;
    $("fBad").hidden = !nb && !F.bad;
    $("fClear").hidden = !filtering();
  }

  function renderList() {
    if (CONTRIB) return;
    const n = D.questions.length;
    $("tabQCount").textContent = n; $("qCount").textContent = n;
    renderBank(); renderFilters();
    const box = $("qList"); box.innerHTML = "";
    $("qLast").textContent = n;
    document.querySelectorAll(".qx-view [data-view]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === view)));
    box.classList.toggle("in-order", view === "order");
    let shown = 0;
    if (view === "order") {
      const g = el("div.qgroup", { role: "group", "aria-label": "All questions, in order" });
      D.questions.forEach((q) => { if (matches(q)) { shown++; g.append(renderRow(q)); } });
      if (shown) box.append(g);
    } else {
      const cats = A.categoriesOf(D.settings), groups = new Map(cats.map((c) => [c, []]));
      D.questions.forEach((q) => { if (!matches(q)) return; const c = A.categoryOf(q); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(q); });
      for (const [c, list] of groups) {
        if (!list.length) continue;
        shown += list.length;
        const g = el("div.qgroup", { role: "group", "aria-label": c });
        g.append(el("div.qgroup-h", { html: `<span>${esc(c)}</span><b>${list.length}</b>` }));
        list.forEach((q) => g.append(renderRow(q)));
        box.append(g);
      }
    }
    if (!shown) box.append(el("div.qx-empty", {}, el("p", { text: n ? "No questions match these filters." : "The bank is empty." }),
      n ? el("button.btn.ghost.small", { type: "button", text: "Clear filters", onclick: clearFilters }) : null));
    $("qShown").textContent = filtering() ? ` · showing ${shown}` : "";
  }
  function renderRow(q) {
    const b = el("button.qrow", { type: "button" }); b.dataset.id = q.id;
    b.onclick = () => select(q.id, { fromList: true });
    paintRow(b, q);
    return b;
  }
  function paintRow(b, q) {
    const bad = problems(q).length, text = String(q.prompt || "").trim();
    b.classList.toggle("sel", q.id === selId); b.classList.toggle("bad", !!bad); b.classList.toggle("crit", !!q.critical);
    b.setAttribute("aria-current", q.id === selId ? "true" : "false");
    b.innerHTML = `<span class="qrow-n">${numOf(q)}</span>
      <span class="qrow-body"><span class="qrow-text${text ? "" : " empty"}">${esc(text || "New question")}</span>
      <span class="qrow-meta"><span class="qrow-cat">${esc(A.categoryOf(q))}</span><span class="qrow-type t-${q.type}">${TYPE_NAME[q.type] || q.type}</span>${q.critical ? '<span class="qrow-crit">Critical</span>' : ""}${q.always ? '<span class="qrow-always">Always</span>' : ""}${bad ? '<span class="qrow-bad">Needs fixing</span>' : ""}</span></span>`;
  }
  function refreshRow(q) { if (CONTRIB) return; const b = rowOf(q.id); if (b) paintRow(b, q); renderFilterCounts(); }
  const rowOf = (id) => $("qList") && $("qList").querySelector(`.qrow[data-id="${CSS.escape(id)}"]`);
  const visibleIds = () => [...($("qList") ? $("qList").querySelectorAll(".qrow") : [])].map((b) => b.dataset.id);

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
    // one column (phones, small tablets): the editor sits under the list, so go to it
    else if (opts.fromList && innerWidth <= 980) $("qEditor").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function step(dir) {
    const ids = visibleIds(); if (!ids.length) return;
    const k = ids.indexOf(selId);
    select(ids[k < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, k + dir))]);
  }

  function clearFilters() {
    Object.assign(F, { q: "", cat: "", type: "", crit: false, always: false, bad: false });
    $("qSearch").value = ""; renderList();
    const row = selId && rowOf(selId); if (row) row.scrollIntoView({ block: "nearest" });
  }
  if (!CONTRIB) $("qSearch").oninput = (e) => { F.q = e.target.value.trim().toLowerCase(); renderList(); };
  if (!CONTRIB) $("fCat").onchange = (e) => { F.cat = e.target.value; renderList(); };
  if (!CONTRIB) $("fType").onchange = (e) => { F.type = e.target.value; renderList(); };
  if (!CONTRIB) $("fCrit").onclick = () => { F.crit = !F.crit; renderList(); };
  if (!CONTRIB) $("fBad").onclick = () => { F.bad = !F.bad; renderList(); };
  if (!CONTRIB) $("fAlways").onclick = () => { F.always = !F.always; renderList(); };
  if (!CONTRIB) $("fClear").onclick = clearFilters;
  document.querySelectorAll(".qx-view [data-view]").forEach((b) => { b.onclick = () => {
    view = b.dataset.view; try { localStorage.setItem("gcmc-editor-view", view); } catch (e) { /* not remembered */ }
    renderList(); const r = selId && rowOf(selId); if (r) r.scrollIntoView({ block: "center" });
  }; });

  // ----- adding, duplicating, deleting -----
  function newQuestion(o) {
    o = o || {};
    const cur = byId(selId), cats = A.categoriesOf(D.settings);
    const cat = o.cat || F.cat || (cur && A.categoryOf(cur)) || cats[0];
    const q = blank(o.type || lastType, cat);
    D.questions.push(q);
    // make sure the new question is visible in the list: keep the category filter only if it matches
    Object.assign(F, { q: "", type: "", crit: false, always: false, bad: false, cat: F.cat === cat ? F.cat : "" }); $("qSearch").value = "";
    markDirty(); renderList(); select(q.id, { focus: true });
    toast(`Added question ${numOf(q)} to ${cat}.`);
  }
  if (!CONTRIB) $("newQ").onclick = () => newQuestion();

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
    if (approvals.has(q.id)) loadTeam(); // a team question taken back out goes back to the inbox
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
    const keep = stash.get(q.id) || {}, from = q.type;
    // picture options aren't text, so they're set aside separately from text options
    if (A.imageAnswers(q)) { keep.picOptions = q.options; keep.picCorrect = q.correct; delete q.options; delete q.correct; }
    for (const k of ["options", "correct", "pairs", "answers", "image", "mode", "multiple"]) if (q[k] !== undefined) { keep[k] = q[k]; delete q[k]; }
    if (isChoice(t) || t === "image") {
      q.options = keep.options || ["", "", "", ""];
      q.correct = (keep.correct || []).slice(0, t === "single" ? 1 : undefined);
    }
    if (t === "image") {
      q.mode = "question"; q.image = keep.image || "";
      if (from === "multi" || (from !== "single" && keep.multiple)) q.multiple = true;
    } else if (t === "match") q.pairs = keep.pairs || [{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }];
    else if (!isChoice(t)) q.answers = keep.answers || [];
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
    if (CONTRIB) card.append(el("header.qed-head", {},
      el("div.qed-where", {}, el("p.eyebrow", { text: "Your question" }), el("span.qed-id", { text: "Saved in this browser until you send it" })),
      el("div.qed-tools", {},
        el("button.btn.ghost.small", { type: "button", text: "Preview", title: "See it as candidates will (Alt+P)", onclick: () => openPreview(q, "Your question") }),
        el("button.btn.quiet.small.danger", { type: "button", text: "Start over", onclick: () => { if (confirm("Clear this question and start again?")) startOver(q); } }))));
    const nav = el("div.qed-nav", {},
      el("button.icon-btn", { type: "button", text: "‹", title: "Previous question", "aria-label": "Previous question", disabled: k <= 0, onclick: () => step(-1) }),
      el("button.icon-btn", { type: "button", text: "›", title: "Next question", "aria-label": "Next question", disabled: k < 0 || k >= ids.length - 1, onclick: () => step(1) }));
    if (!CONTRIB) card.append(el("header.qed-head", {},
      el("div.qed-where", {}, el("p.eyebrow", { text: `Question ${numOf(q)} of ${D.questions.length}` }), el("span.qed-id", { text: "ID " + q.id })),
      el("div.qed-tools", {}, nav,
        el("button.btn.ghost.small", { type: "button", text: "Preview", title: "See it as candidates will (Alt+P)", onclick: () => openPreview(q) }),
        el("button.btn.quiet.small", { type: "button", text: "Duplicate", onclick: () => duplicate(q) }),
        el("button.btn.quiet.small.danger", { type: "button", text: "Delete", onclick: () => remove(q) }))));

    // details: category, type and critical on one row
    const cat = el("select.input", { id: "qCat" });
    const catList = A.categoriesOf(D.settings), cur = A.categoryOf(q);
    for (const c of catList.includes(cur) ? catList : [...catList, cur]) cat.add(new Option(c, c, false, c === cur));
    cat.onchange = () => { q.category = cat.value; markDirty(); renderList(); const aa = $("addAnother"); if (aa) aa.textContent = `+ Add another to ${q.category}`; const r = rowOf(q.id); if (r) r.scrollIntoView({ block: "nearest" }); };
    const flag = (cls, key, html, title, after) => {
      const box = el("input", { type: "checkbox", checked: !!q[key] });
      box.onchange = () => { if (box.checked) q[key] = true; else delete q[key]; if (after) after(box.checked); markDirty(); refreshRow(q); renderBank(); };
      return el("label.flag." + cls, { title }, box, el("span", { html }));
    };
    const flags = el("div.flags", {},
      flag("crit", "critical", "<b>Critical</b> ×2", "Points count double on this question, right or wrong", (on) => card.classList.toggle("critical", on)),
      CONTRIB ? null : flag("always", "always", "<b>Always in</b>", "Always include: this question is in every attempt, whatever the random draw picks"));
    const type = el("select.input", { id: "qType" });
    for (const [v, l] of TYPES) type.add(new Option(l, v, false, v === q.type));
    type.onchange = () => { setType(q, type.value); const t = $("qType"); if (t) t.focus(); };
    card.append(el("div.qed-sec.qed-details", {},
      el("div.field", {}, el("label", { for: "qCat", text: "Category" }), cat),
      el("div.field", {}, el("label", { for: "qType", text: "Type" }), type),
      el("div.field", {}, el("span.lbl", { text: "In the test" }), flags)));

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
    if (q.type === "image" && !A.imageAnswers(q)) {
      psec.append(el("span.qed-label.qed-label-gap", { text: "Picture" }),
        imageSlot(q.image, (url) => { q.image = url; changed(q); }, { big: true, label: "the question's picture" }));
    }
    card.append(psec);
    requestAnimationFrame(grow);

    // the answer: what counts as right
    const ans = el("div.qed-answers", { id: "qAnswers" });
    card.append(el("div.qed-sec", {}, el("span.qed-label", { text: "Answer" }), ans));
    renderAnswers(q, ans);

    // footer: is it ready, and a quick way to keep going
    if (CONTRIB) card.append(el("footer.qed-foot", {}, el("div.qed-status", { id: "qStatus", role: "status" }),
      el("button.btn", { type: "button", id: "sendBtn", text: "Send to the bank", onclick: sendQuestion })));
    else card.append(el("footer.qed-foot", {}, el("div.qed-status", { id: "qStatus", role: "status" }),
      el("button.btn.ghost.small", { type: "button", id: "addAnother", text: `+ Add another to ${A.categoryOf(q)}`, title: "Same category and type (Alt+N)", onclick: () => newQuestion({ cat: A.categoryOf(q), type: q.type }) })));
    box.append(card);
    refreshStatus();
  }

  function refreshStatus() {
    const q = byId(selId), box = $("qStatus"); if (!q || !box) return;
    const p = problems(q);
    box.className = "qed-status " + (p.length ? "bad" : "ok");
    box.innerHTML = p.length ? `<b>Needs fixing</b><ul>${p.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<b>Ready</b><span>${CONTRIB ? "You can send it." : "This question can go in the test."}</span>`;
    const send = $("sendBtn"); if (send) send.disabled = p.length > 0;
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
    if (q.type === "image") return renderImageAnswers(q, box);
    if (isChoice(q.type)) return renderOptions(q, box);
    if (q.type === "match") return renderPairs(q, box);
    renderAccepted(q, box);
  }

  function renderOptions(q, box) {
    const multi = A.isMultiPick(q), correct = q.correct || [];
    box.append(el("p.qed-how.t-" + (multi ? "multi" : "single"), { html: multi
      ? `<span><b>Tick every correct option.</b> Candidates see “Select all that apply” and must pick exactly these.</span>`
      : `<span><b>Choose the one correct option.</b> Candidates see “Choose one answer”.</span>` }));
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

  // ----- image questions -----
  const MAX_IMAGE = 3 * 1024 * 1024;
  // resize (longest side) and re-encode as WebP, stepping the quality down until it's under 3 MB
  async function toWebp(file, maxSide) {
    if (!/^image\//.test(file.type)) throw new Error("That file isn't an image.");
    if (file.size > 40 * 1024 * 1024) throw new Error("That image is too big to open (over 40 MB).");
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error("This browser can't open that image. Try a JPG, PNG or WebP."); }
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); if (bmp.close) bmp.close();
    for (const quality of [0.85, 0.75, 0.6, 0.45, 0.3]) {
      const out = await new Promise((r) => c.toBlob(r, "image/webp", quality));
      if (!out || out.type !== "image/webp") throw new Error("This browser can't save WebP images. Use Chrome or Edge.");
      if (out.size <= MAX_IMAGE) return out;
    }
    throw new Error("Even compressed, that image is over 3 MB. Try a smaller one.");
  }
  async function uploadImage(file, maxSide) {
    const blob = await toWebp(file, maxSide);
    let res;
    const url = "/api/images" + (CONTRIB ? "?t=" + encodeURIComponent(TEAM_TOKEN) : "");
    try { res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...keyHeader() }, body: blob }); }
    catch (e) { throw new Error("Couldn't reach the server to upload the image."); }
    if (!(res.headers.get("content-type") || "").includes("json")) throw new Error("Images can only be uploaded where the live API runs (the Vercel site or the local server).");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed (" + res.status + ").");
    return { url: data.url, bytes: blob.size };
  }
  const kb = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  // one picture: an empty drop zone, or a preview with Replace / Remove. Click, or drop a file on it.
  function imageSlot(url, onChange, o) {
    o = o || {};
    const slot = el("div.img-slot" + (o.big ? ".big" : ""));
    const file = el("input", { type: "file", accept: "image/*", hidden: true, "aria-label": "Upload " + (o.label || "a picture") });
    const note = el("span.img-note", { role: "status" });
    const pick = () => file.click();
    async function take(f) {
      if (!f) return;
      slot.classList.add("busy"); note.className = "img-note"; note.textContent = "Compressing to WebP and uploading…";
      try {
        const up = await uploadImage(f, o.big ? 1600 : 1000);
        url = up.url; onChange(url); draw(); note.textContent = `Saved as WebP · ${kb(up.bytes)}`;
      } catch (e) { note.className = "img-note bad"; note.textContent = e.message; }
      slot.classList.remove("busy");
    }
    file.onchange = () => { take(file.files[0]); file.value = ""; };
    slot.ondragover = (e) => { e.preventDefault(); slot.classList.add("over"); };
    slot.ondragleave = () => slot.classList.remove("over");
    slot.ondrop = (e) => { e.preventDefault(); slot.classList.remove("over"); take(e.dataTransfer.files[0]); };
    function draw() {
      slot.classList.toggle("has", !!url);
      [...slot.children].forEach((c) => { if (c !== file && c !== note) c.remove(); });
      if (url) {
        slot.prepend(el("img", { src: url, alt: "" }),
          el("div.img-tools", {},
            el("button.btn.ghost.small", { type: "button", text: "Replace", onclick: pick }),
            el("button.btn.quiet.small.danger", { type: "button", text: "Remove", onclick: () => { url = ""; onChange(""); note.textContent = ""; draw(); } })));
      } else {
        slot.prepend(el("button.img-drop", { type: "button", onclick: pick,
          html: "<b>Upload a picture</b><span>or drop one here · JPG, PNG or WebP · saved as WebP under 3 MB</span>" }));
      }
    }
    slot.append(file, note); draw();
    return slot;
  }

  function setImageMode(q, mode) {
    if ((q.mode || "question") === mode) return;
    const keep = stash.get(q.id) || {};
    if (mode === "answers") {
      keep.textOptions = q.options; keep.textCorrect = q.correct; keep.image = q.image; delete q.image;
      q.options = keep.picOptions || ["", "", "", ""]; q.correct = keep.picCorrect || [];
    } else {
      keep.picOptions = q.options; keep.picCorrect = q.correct;
      q.options = keep.textOptions || ["", "", "", ""]; q.correct = keep.textCorrect || []; q.image = keep.image || "";
    }
    stash.set(q.id, keep); q.mode = mode;
    markDirty(); refreshRow(q); renderEditor();
  }

  function renderImageAnswers(q, box) {
    const pics = A.imageAnswers(q);
    const mode = el("div.mode-seg", { role: "radiogroup", "aria-label": "Where the picture goes" });
    for (const [v, l, d] of [["question", "Picture with the question", "Text options below it"], ["answers", "Pictures as the answers", "Each option is a picture, no text"]]) {
      mode.append(el("button.mode-b", { type: "button", role: "radio", "aria-checked": String((q.mode || "question") === v), html: `<b>${l}</b><small>${d}</small>`, onclick: () => setImageMode(q, v) }));
    }
    const many = el("label.many-toggle", {}, el("input", { type: "checkbox", checked: !!q.multiple, onchange: (e) => {
      if (e.target.checked) q.multiple = true; else { delete q.multiple; q.correct = (q.correct || []).slice(0, 1); }
      redrawAnswers(q);
    } }), el("span", { html: "<b>More than one correct</b> · candidates select all that apply" }));
    box.append(el("div.img-controls", {}, mode, many));
    if (pics) renderPicOptions(q, box); else renderOptions(q, box);
  }

  function renderPicOptions(q, box) {
    const multi = A.isMultiPick(q), correct = q.correct || [], MAX_PICS = 6;
    box.append(el("p.qed-how.t-" + (multi ? "multi" : "single"), { html: `<span><b>Upload a picture for each option, then click ${multi ? "every correct letter" : "the correct letter"}.</b> Picture options can't have text.</span>` }));
    const grid = el("div.pic-opts" + (multi ? ".multi" : ".single"), { role: multi ? "group" : "radiogroup", "aria-label": "Picture options" });
    q.options.forEach((url, k) => {
      const on = correct.includes(k);
      const mark = el("button.opt-mark", { type: "button", role: multi ? "checkbox" : "radio", "aria-checked": String(on), id: `m-${q.id}-${k}`,
        title: on ? "Correct answer" : "Mark as correct", "aria-label": `Picture ${LETTERS[k]} is correct`, html: `<span class="l">${LETTERS[k]}</span>` });
      mark.onclick = () => { q.correct = multi ? (on ? correct.filter((x) => x !== k) : [...correct, k].sort((a, b) => a - b)) : [k]; redrawAnswers(q, mark.id); };
      const x = el("button.icon-btn.danger", { type: "button", text: "✕", title: "Remove this option", "aria-label": `Remove picture ${LETTERS[k]}`, disabled: q.options.length <= 2 });
      x.onclick = () => { q.options.splice(k, 1); q.correct = correct.filter((c) => c !== k).map((c) => (c > k ? c - 1 : c)); redrawAnswers(q); };
      grid.append(el("div.pic-tile" + (on ? ".correct" : ""), {},
        el("div.pic-top", {}, mark, on ? el("span.opt-tag", { text: "Correct" }) : el("span.opt-tag"), x),
        imageSlot(url, (u) => { q.options[k] = u; changed(q); }, { label: "picture " + LETTERS[k] })));
    });
    box.append(grid);
    box.append(el("div.qed-sub", {},
      el("button.btn.ghost.small", { type: "button", text: "+ Add picture option", disabled: q.options.length >= MAX_PICS, onclick: () => { q.options.push(""); redrawAnswers(q); } }),
      el("span", { text: `Up to ${MAX_PICS} pictures. Candidates see them shuffled when shuffling is on.` })));
  }

  function renderPairs(q, box) {
    box.append(el("p.qed-how.t-match", { html: `<span><b>Write each pair on one row.</b> Candidates see Column B shuffled and match every A to its B. All pairs must be right for the mark.</span>` }));
    const list = el("div.pairs");
    list.append(el("div.pair-head", { html: '<span></span><span><i>A</i> Item</span><span></span><span><i>B</i> Its match</span><span></span>' }));
    const idOf = (k) => `pl-${q.id}-${k}`;
    const add = (at) => { if (q.pairs.length >= MAX_PAIRS) return; q.pairs.splice(at, 0, { left: "", right: "" }); redrawAnswers(q, idOf(at)); };
    const del = (k, focusK) => { q.pairs.splice(k, 1); redrawAnswers(q, idOf(Math.min(focusK, q.pairs.length - 1)), true); };
    q.pairs.forEach((pr, k) => {
      const l = el("input.input", { id: idOf(k), value: pr.left, placeholder: k ? (narrow() ? "A · item" : "") : "e.g. Frame.io", "aria-label": `Pair ${k + 1}, Column A` });
      const r = el("input.input", { id: `pr-${q.id}-${k}`, value: pr.right, placeholder: k ? (narrow() ? "B · its match" : "") : "e.g. Reviewing designs with stakeholders", "aria-label": `Pair ${k + 1}, Column B` });
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
    box.append(el("p.qed-how.t-" + q.type, { html: `<span><b>List every answer you'll accept.</b> Capitals, accents, spaces and punctuation are ignored, so “Thursday.”, “thursday” and “THURSDAY” all match.</span>` }));
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

  // ----- preview: the open question in the real test page, unsaved edits included; nothing is recorded -----
  let closePreview = () => {};
  function openPreview(q, title) {
    closePreview();
    title = title || "Question " + numOf(q);
    // the test's desktop layout, scaled down to fit; on a phone, the phone layout at full size
    const widthFor = () => (holder.clientWidth < 760 ? holder.clientWidth : 1280);
    const frame = el("iframe", { src: "./?preview=1", title: "Preview: " + title });
    const holder = el("div.pv-frame", {}, frame);
    const p = problems(q);
    const shut = el("button.btn.small", { type: "button", text: "Close" });
    const shell = el("div.pv", { role: "dialog", "aria-modal": "true", "aria-label": "Preview: " + title },
      el("div.pv-in", {},
        el("div.pv-bar", {},
          el("div.pv-title", { html: `<b>Preview · ${esc(title)}</b><span>As candidates see it, with your unsaved changes. Answer it to check the marking; nothing is recorded.</span>` }),
          shut),
        p.length ? el("p.pv-warn", { text: "Still needs fixing: " + p.join(" ") }) : null,
        holder));
    const fit = () => { const W = widthFor(), k = Math.min(1, holder.clientWidth / W); frame.style.width = W + "px"; frame.style.height = holder.clientHeight / k + "px"; frame.style.transform = `scale(${k})`; };
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow || !e.data || e.data.type !== "preview-ready") return;
      frame.contentWindow.postMessage({ type: "preview", question: JSON.parse(JSON.stringify(q)), settings: D.settings, name: "Preview" }, location.origin);
    };
    const onKey = (e) => { if (e.key === "Escape") closePreview(); };
    closePreview = () => {
      shell.remove(); document.body.classList.remove("pv-open");
      removeEventListener("message", onMsg); removeEventListener("keydown", onKey, true); removeEventListener("resize", fit);
      closePreview = () => {};
    };
    shut.onclick = closePreview;
    shell.onclick = (e) => { if (e.target === shell) closePreview(); };
    addEventListener("message", onMsg); addEventListener("keydown", onKey, true); addEventListener("resize", fit);
    document.body.append(shell); document.body.classList.add("pv-open");
    fit(); shut.focus();
  }

  // ---------- private links: the editor's key check, and the Team tab (inbox of sent-in questions, team links) ----------
  async function checkKey() {
    let res;
    try { res = await fetch("/api/editor", { headers: keyHeader(), cache: "no-store" }); } catch (e) { return true; }
    if (res.status !== 401) return true; // the key is fine, or there's no API here (offline)
    showLock(editorKey ? "That key doesn't open the editor. Paste the current editor link." : "");
    return false;
  }
  function showLock(msg) {
    const box = $("edLoading"); box.hidden = false; box.classList.add("failed", "locked");
    $("edLoadTitle").textContent = "This editor opens from its private link";
    $("edLoadMsg").textContent = msg || "Open it from the link you were given, or paste that link (or its key) here.";
    $("edRetry").hidden = true;
    const inner = box.querySelector(".ed-loading-in"), old = inner.querySelector(".lock-form"); if (old) old.remove();
    const input = el("input.input", { id: "lockKey", type: "password", placeholder: "Paste the editor link or key", autocomplete: "off", "aria-label": "Editor link or key" });
    const form = el("form.lock-form", {}, input, el("button.btn.small", { type: "submit", text: "Open the editor" }));
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim(), m = v.match(/key=([^&\s]+)/), k = m ? decodeURIComponent(m[1]) : v;
      if (!k) return;
      try { localStorage.setItem("gcmc-editor-key", k); location.reload(); } catch (er) { location.hash = "key=" + encodeURIComponent(k); location.reload(); }
    };
    inner.append(form); input.focus();
  }

  let inbox = [], team = [], teamErr = "";
  const approvals = new Map(); // bank question id → submission id, confirmed as approved once the bank is saved
  async function teamCall(method, url, body) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...keyHeader() }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (!(res.headers.get("content-type") || "").includes("json")) throw new Error("no api");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ").");
    return data;
  }
  async function loadTeam() {
    try {
      [inbox, team] = await Promise.all([teamCall("GET", "/api/submissions?status=pending"), teamCall("GET", "/api/contributors")]);
      teamErr = "";
      // ones added to the bank but not saved yet stay out of the inbox, unless they were deleted again
      const taken = new Set([...approvals].filter(([qid]) => byId(qid)).map(([, sid]) => sid)); inbox = inbox.filter((s) => !taken.has(s.id));
    } catch (e) { teamErr = e.message === "no api" ? "Team links and the inbox need the live site (Vercel) or the local dev server." : e.message; inbox = []; team = []; }
    renderTeam();
  }
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  };
  const linkFor = (token) => `${location.origin}/contribute.html?t=${token}`;
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); toast(`Copied ${what}.`); }
    catch (e) { prompt("Copy this " + what + ":", text); }
  }

  function renderTeam() {
    $("tabTCount").textContent = inbox.length || "";
    const ibox = $("inboxList"), lbox = $("teamLinks");
    ibox.innerHTML = ""; lbox.innerHTML = "";
    $("teamState").textContent = teamErr;
    $("teamAdd").disabled = !!teamErr;
    if (!teamErr && !inbox.length) ibox.append(el("p.team-empty", { text: "Nothing waiting. Questions sent through a team link show up here." }));
    for (const s of inbox) {
      const q = s.question || {};
      const answer = A.imageAnswers(q) ? `Picture ${(q.correct || []).map((i) => i + 1).join(", ")}` : A.correctText(q);
      const pics = A.imageAnswers(q) ? el("div.sub-pics", {}, ...(q.options || []).map((u, i) => el("img" + ((q.correct || []).includes(i) ? ".right" : ""), { src: u, alt: "Picture " + (i + 1) }))) : null;
      const qpic = q.type === "image" && !A.imageAnswers(q) && q.image ? el("img.sub-qpic", { src: q.image, alt: "" }) : null;
      ibox.append(el("article.sub-item", {},
        el("div.sub-meta", { html: `<b>${esc(s.contributor_name)}</b><span>${esc(ago(s.created_at))}</span><span>${esc(A.categoryOf(q))}</span><span class="qrow-type t-${esc(q.type)}">${esc(TYPE_NAME[q.type] || q.type)}</span>${q.critical ? '<span class="qrow-crit">Critical</span>' : ""}` }),
        el("p.sub-q", { text: q.prompt || "" }), qpic,
        el("p.sub-a", {}, el("span", { text: "Answer: " }), el("b", { text: answer })), pics,
        el("div.sub-actions", {},
          el("button.btn.small", { type: "button", text: "Add to the bank", onclick: () => approve(s) }),
          el("button.btn.ghost.small", { type: "button", text: "Preview", onclick: () => openPreview(q, "From " + s.contributor_name) }),
          el("button.btn.quiet.small.danger", { type: "button", text: "Reject", onclick: () => reject(s) }))));
    }
    const live = team.filter((c) => !c.revoked_at), off = team.filter((c) => c.revoked_at);
    if (!teamErr && !live.length) lbox.append(el("p.team-empty", { text: "No links yet. Add someone above to make their link." }));
    for (const c of [...live, ...off]) {
      const url = linkFor(c.token), dead = !!c.revoked_at;
      lbox.append(el("div.link-item" + (dead ? ".off" : ""), {},
        el("div.link-who", { html: `<b>${esc(c.name)}</b><span>${dead ? "Link turned off" : `${c.sent} sent${c.pending ? ` · ${c.pending} waiting` : ""}`}</span>` }),
        dead ? el("span") : el("input.input.link-url", { value: url, readonly: true, "aria-label": `${c.name}'s link`, onfocus: (e) => e.target.select() }),
        dead ? el("span") : el("div.link-tools", {},
          el("button.btn.ghost.small", { type: "button", text: "Copy link", onclick: () => copy(url, c.name + "'s link") }),
          el("button.btn.quiet.small.danger", { type: "button", text: "Turn off", title: "Their link stops working. What they already sent stays.", onclick: () => revoke(c) }))));
    }
    const mine = $("editorLink");
    if (mine) {
      mine.hidden = !editorKey || !!teamErr;
      if (editorKey) $("editorLinkCopy").onclick = () => copy(`${location.origin}/admin.html#key=${encodeURIComponent(editorKey)}`, "the editor link");
    }
  }
  function approve(s) {
    const q = JSON.parse(JSON.stringify(s.question || {}));
    q.id = newId();
    if (!q.category) q.category = A.categoriesOf(D.settings)[0];
    D.questions.push(q); approvals.set(q.id, s.id);
    inbox = inbox.filter((x) => x.id !== s.id);
    markDirty(); renderTeam(); setTab("questions"); renderList(); select(q.id);
    toast(`Added ${s.contributor_name}'s question as number ${numOf(q)}. Check it, then save.`);
  }
  async function reject(s) {
    try { await teamCall("PATCH", "/api/submissions", { ids: [s.id], status: "rejected" }); }
    catch (e) { toast(e.message); return; }
    inbox = inbox.filter((x) => x.id !== s.id); renderTeam();
    toast(`Rejected ${s.contributor_name}'s question.`, { label: "Undo", fn: async () => { await teamCall("PATCH", "/api/submissions", { ids: [s.id], status: "pending" }).catch(() => {}); loadTeam(); } });
  }
  async function revoke(c) {
    if (!confirm(`Turn off ${c.name}'s link? It stops working straight away. What they already sent stays.`)) return;
    try { await teamCall("DELETE", "/api/contributors?t=" + encodeURIComponent(c.token)); } catch (e) { toast(e.message); return; }
    loadTeam();
  }
  // approved questions are only confirmed once they're actually saved into the bank
  async function confirmApprovals() {
    const ids = [...approvals].filter(([qid]) => byId(qid)).map(([, sid]) => sid);
    approvals.clear();
    if (ids.length) await teamCall("PATCH", "/api/submissions", { ids, status: "approved" }).catch(() => {});
    loadTeam();
  }
  if (!CONTRIB) {
    $("teamForm").onsubmit = async (e) => {
      e.preventDefault();
      const name = $("teamName").value.trim(); if (!name) return;
      let out;
      try { out = await teamCall("POST", "/api/contributors", { name }); } catch (er) { toast(er.message); return; }
      $("teamName").value = ""; await loadTeam();
      copy(linkFor(out.token), out.name + "'s link");
    };
  }

  // ---------- the team's "Submit a question" page (contribute.html): the same question form, one question at a time ----------
  const DRAFT_KEY = "gcmc-contrib-draft-" + TEAM_TOKEN;
  const sentHere = [];
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(byId(selId))); } catch (e) { /* not kept */ } }
  async function contribCall(method, body) {
    const res = await fetch("/api/contribute?t=" + encodeURIComponent(TEAM_TOKEN), { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (!(res.headers.get("content-type") || "").includes("json")) throw new Error("This page needs the live site.");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong (" + res.status + ").");
    return data;
  }
  const sentText = (n) => (n ? `You've sent ${n} ${n === 1 ? "question" : "questions"} so far. Thank you.` : "");
  function startOver(q) {
    const next = blank(q ? q.type : lastType, q ? A.categoryOf(q) : A.categoriesOf(D.settings)[0]);
    next.id = "draft"; stash.clear(); ansRows = null; D.questions = [next]; selId = next.id; saveDraft(); renderEditor();
    const p = $("qPrompt"); if (p) p.focus();
  }
  async function sendQuestion() {
    const q = byId(selId), p = problems(q);
    if (p.length) { toast(p[0]); return; }
    const btn = $("sendBtn"); btn.disabled = true; btn.textContent = "Sending…";
    const out = JSON.parse(JSON.stringify(q)); delete out.id;
    let res;
    try { res = await contribCall("POST", { question: out }); }
    catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "Send to the bank"; return; }
    $("cSent").textContent = sentText(res.sent);
    sentHere.unshift(q.prompt); $("cDone").hidden = false;
    $("cDoneList").innerHTML = ""; sentHere.forEach((t) => $("cDoneList").append(el("li", { text: t })));
    toast("Sent. It's waiting for review.");
    startOver(q); scrollTo({ top: 0, behavior: "smooth" });
  }
  async function startContrib() {
    let info;
    try {
      if (!TEAM_TOKEN) throw new Error("This page opens from your personal link. Ask for one if you don't have it.");
      info = await contribCall("GET");
    } catch (e) {
      $("edLoading").classList.add("failed");
      $("edLoadTitle").textContent = "This link isn't working";
      $("edLoadMsg").textContent = e.message;
      return;
    }
    D = { settings: { categories: info.categories }, questions: [] };
    $("cHello").textContent = `Hi ${info.name}.`;
    $("cSent").textContent = sentText(info.sent);
    let q = null;
    try { q = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { q = null; }
    if (!q || !q.type || !TYPE_NAME[q.type]) q = blank("single", A.categoriesOf(D.settings)[0]);
    q.id = "draft"; D.questions = [q]; selId = q.id;
    renderEditor();
    $("edLoading").hidden = true;
  }

  // ---------- save / load ----------
  async function collect() {
    const bad = D.questions.filter((q) => problems(q).length);
    if (bad.length) {
      Object.assign(F, { q: "", cat: "", type: "", crit: false, always: false, bad: true }); $("qSearch").value = "";
      setTab("questions"); renderList(); select(bad[0].id);
      throw new Error(`${bad.length} ${bad.length > 1 ? "questions need" : "question needs"} fixing before saving. They're listed on the left.`);
    }
    D.questions.forEach((q) => {
      if (isChoice(q.type) || (q.type === "image" && !A.imageAnswers(q))) q.options = q.options.map((o) => String(o).trim());
      if (q.type === "image" && !q.multiple) delete q.multiple;
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
        method: "PUT", headers: { "Content-Type": "application/json", ...keyHeader() }, body: JSON.stringify(data),
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
    D.revision = body.revision; setBaseline(); hideConflict(); stash.clear(); confirmApprovals();
    setState(`Saved · revision ${body.revision} · ${new Date().toLocaleTimeString()}`, "ok");
  }
  function showConflict() {
    setState("Someone else saved while you were editing.", "dirty");
    $("conflict").hidden = false;
  }
  function hideConflict() { $("conflict").hidden = true; }
  if (!CONTRIB) $("saveBtn").onclick = () => save(false);
  if (!CONTRIB) $("reloadLatest").onclick = async () => { D = await A.loadData(); stash.clear(); ansRows = null; renderAll(); setBaseline(); hideConflict(); setState("Loaded the latest version · revision " + (D.revision || 0), "ok"); };
  if (!CONTRIB) $("overwrite").onclick = () => save(true);
  if (!CONTRIB) $("edRetry").onclick = () => location.reload();

  // ---------- dark theme switch ----------
  function initTheme() {
    const btn = $("themeToggle");
    const label = $("themeLabel");
    if (!btn) return;
    function updateUI(isDark) {
      btn.setAttribute("aria-checked", String(isDark));
      if (label) label.textContent = isDark ? "Light theme" : "Dark theme";
      btn.title = isDark ? "Switch to light theme" : "Switch to dark theme";
    }
    updateUI(document.documentElement.getAttribute("data-theme") === "dark");
    btn.onclick = () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const nextDark = !isDark;
      if (nextDark) {
        document.documentElement.setAttribute("data-theme", "dark");
        try { localStorage.setItem("gcmc_theme", "dark"); } catch (e) {}
      } else {
        document.documentElement.removeAttribute("data-theme");
        try { localStorage.setItem("gcmc_theme", "light"); } catch (e) {}
      }
      updateUI(nextDark);
    };
  }
  initTheme();

  // Ctrl/⌘+S saves; Alt+N starts a new question (same category and type as the open one)
  addEventListener("keydown", (e) => {
    if (CONTRIB) { if (e.altKey && e.code === "KeyP" && D && byId(selId)) { e.preventDefault(); openPreview(byId(selId), "Your question"); } return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!$("saveBtn").disabled) save(false); }
    else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyP" && D && byId(selId)) { e.preventDefault(); openPreview(byId(selId)); }
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
  const stick = () => !CONTRIB && document.documentElement.style.setProperty("--stick", document.querySelector(".topbar").offsetHeight + document.querySelector(".savebar").offsetHeight + "px");
  addEventListener("resize", stick);

  function renderAll() {
    renderSettings(); renderList();
    const want = decodeURIComponent(location.hash.slice(1));
    select(byId(selId) ? selId : byId(want) ? want : (D.questions[0] || {}).id || null, { keepScroll: true });
  }
  if (CONTRIB) startContrib();
  else (async () => {
    try {
      if (!(await checkKey())) return;
      D = await A.loadData(); stick(); renderAll(); setBaseline(); setState("Up to date · revision " + (D.revision || 0), "ok");
      const missing = D.questions.filter((q) => !q.category);
      if (missing.length) {
        missing.forEach((q) => { q.category = A.categoryOf(q); });
        renderList(); renderEditor(); markDirty();
        setState(`${missing.length} questions were given a category from their topic. Check them, then save to keep them.`, "dirty");
      }
      loadPeople(); loadTeam();
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
