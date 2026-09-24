/* Shared helpers for the assessment and the editor. */
(function (global) {
  "use strict";

  /** Loose answer key: case, accents (Vietnamese included), spaces and punctuation don't matter. */
  function normalize(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const normEmail = (v) => String(v || "").trim().toLowerCase();
  const normStaffId = (v) => String(v || "").replace(/\s+/g, "").toUpperCase();

  /** The live question document: /api/questions (Vercel + Supabase, or the local server),
      falling back to the bundled data/questions.json on a plain static host. */
  async function loadData() {
    try {
      const res = await fetch("/api/questions", { cache: "no-store" });
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) return await res.json();
    } catch (e) { /* no API here: use the bundled file */ }
    const res = await fetch("data/questions.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load the questions (" + res.status + ").");
    return res.json();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Image questions are choice questions: the picture is either with the question (text options) or the options
  // themselves (mode "answers": each option is an image URL). `multiple` makes them pick-all-that-apply.
  const isChoiceQ = (q) => q.type === "single" || q.type === "multi" || q.type === "image";
  const isMultiPick = (q) => q.type === "multi" || (q.type === "image" && !!q.multiple);
  const imageAnswers = (q) => q.type === "image" && q.mode === "answers";
  // image options have no text, so they're referred to as Picture 1, 2… (their order in the editor)
  const optionText = (q, i) => (imageAnswers(q) ? "Picture " + (i + 1) : q.options[i]);

  /** Is this response correct for this question? `response` is an array of option indices or a string. */
  function isCorrect(q, response) {
    if (q.type === "match") {
      // response[i] is the Column B item picked for the i-th pair's Column A item; every pair must be right
      const n = (q.pairs || []).length;
      return n > 0 && Array.isArray(response) && response.length === n && response.every((r, i) => r === i);
    }
    if (isChoiceQ(q)) {
      if (!Array.isArray(response)) return false;
      const want = [...(q.correct || [])].sort((a, b) => a - b).join(",");
      const got = [...response].sort((a, b) => a - b).join(",");
      return want !== "" && want === got;
    }
    const given = normalize(response);
    if (!given) return false;
    return (q.answers || []).some((a) => normalize(a) === given);
  }

  function correctText(q) {
    if (q.type === "match") return (q.pairs || []).map((p) => p.left + " → " + p.right).join(" · ");
    if (isChoiceQ(q)) return (q.correct || []).map((i) => optionText(q, i)).join(" · ");
    return (q.answers || [])[0] || "";
  }

  function responseText(q, response) {
    if (response == null || response === "" || (Array.isArray(response) && !response.length)) return "No answer";
    if (q.type === "match") return (q.pairs || []).map((p, i) => p.left + " → " + (q.pairs[response[i]] ? q.pairs[response[i]].right : "—")).join(" · ");
    if (Array.isArray(response)) return response.map((i) => optionText(q, i)).join(" · ");
    return String(response);
  }

  const TYPE_LABEL = { single: "Single choice", multi: "Select all that apply", fill: "Fill in the blank", short: "Short answer", match: "Match the pairs", image: "Image question" };

  // ---------- categories ----------
  const DEFAULT_CATEGORIES = ["Team", "Culture", "Work", "Platforms", "Brand", "RMIT", "Glossary", "Aussie English", "Misc"];
  // Used only for questions saved before categories existed: their old topic decides the category.
  const TOPIC_CATEGORY = {
    "team structure": "Team", "squads": "Team",
    "team culture": "Culture", "meetings": "Culture", "working with melbourne": "Culture",
    "workflow": "Work", "definition of done": "Work", "quality control": "Work", "stakeholders": "Work",
    "asset trackers": "Work", "workload dashboard": "Work", "digital display": "Work",
    "platforms": "Platforms", "communication": "Platforms",
    "rmit history": "RMIT", "melbourne campuses": "RMIT", "rmit melbourne": "RMIT", "academic calendar": "RMIT",
    "glossary": "Glossary", "aussie english": "Aussie English",
  };
  function categoriesOf(settings) {
    const c = settings && Array.isArray(settings.categories) && settings.categories.filter(Boolean);
    return c && c.length ? c : DEFAULT_CATEGORIES.slice();
  }
  function categoryOf(q) {
    if (q.category) return q.category;
    const t = String(q.topic || "").toLowerCase();
    if (TOPIC_CATEGORY[t]) return TOPIC_CATEGORY[t];
    if (/brand|inton style|mascot|photograph|indigenous/.test(t)) return "Brand";
    return "Misc";
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /** Share of each attempt (in %) that is critical questions, from the settings; 15 when unset. */
  function criticalShareOf(settings) {
    const v = settings && settings.criticalShare;
    return v == null || v === "" || isNaN(+v) ? 15 : Math.max(0, Math.min(100, +v));
  }

  /** Questions per attempt from the settings: at least 10, and never more than the bank holds. */
  const MIN_PER_ATTEMPT = 10;
  function perAttemptOf(settings, bankSize) {
    const v = +(settings && settings.questionsPerAttempt) || 30;
    return Math.min(bankSize, Math.max(MIN_PER_ATTEMPT, v));
  }

  /** Draw n questions: every "always include" one first (a random n of them if there are more), then at least one from
      every category (when n allows), with about `criticalShare`% critical (as many as the bank has), the rest at random,
      in random order. */
  function drawQuestions(questions, n, criticalShare) {
    const pool = shuffle(questions.slice());
    n = Math.min(n, pool.length);
    const crit = pool.filter((q) => q.critical), plain = pool.filter((q) => !q.critical);
    const share = criticalShare == null ? 15 : criticalShare;
    // how many critical: the share of n, but never more than the bank has, and enough to fill n if plain ones run out
    const k = Math.max(n - plain.length, Math.min(crit.length, Math.round((n * share) / 100)));
    const picked = new Set(), taken = { crit: 0, plain: 0 };
    const take = (q) => { picked.add(q.id); taken[q.critical ? "crit" : "plain"]++; };
    const room = () => picked.size < n;
    for (const q of pool) { if (!room()) break; if (q.always) take(q); }
    const byCat = new Map();
    for (const q of pool) { const c = categoryOf(q); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(q); }
    if (n >= byCat.size) {
      for (const list of byCat.values()) {
        if (!room() || list.some((q) => picked.has(q.id))) continue; // already covered (by an always-included question)
        // cover the category with whichever kind still has room, so the critical count stays on target
        const wantCrit = taken.crit < k && (taken.plain >= n - k || !list.some((q) => !q.critical));
        take(list.find((q) => !!q.critical === wantCrit) || list[0]);
      }
    }
    for (const q of crit) { if (taken.crit >= k || !room()) break; if (!picked.has(q.id)) take(q); }
    for (const q of plain) { if (picked.size >= n) break; if (!picked.has(q.id)) take(q); }
    for (const q of pool) { if (picked.size >= n) break; if (!picked.has(q.id)) take(q); }
    return shuffle([...picked]).slice(0, n);
  }

  global.Assess = { normalize, sha256, normEmail, normStaffId, loadData, escapeHtml, isCorrect, correctText, responseText, TYPE_LABEL, isChoiceQ, isMultiPick, imageAnswers,
    DEFAULT_CATEGORIES, categoriesOf, categoryOf, drawQuestions, criticalShareOf, MIN_PER_ATTEMPT, perAttemptOf, shuffle };
})(window);
