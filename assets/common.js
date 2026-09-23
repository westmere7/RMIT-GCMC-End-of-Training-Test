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

  /** Is this response correct for this question? `response` is an array of option indices or a string. */
  function isCorrect(q, response) {
    if (q.type === "single" || q.type === "multi") {
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
    if (q.type === "single" || q.type === "multi") return (q.correct || []).map((i) => q.options[i]).join(" · ");
    return (q.answers || [])[0] || "";
  }

  function responseText(q, response) {
    if (response == null || response === "" || (Array.isArray(response) && !response.length)) return "No answer";
    if (Array.isArray(response)) return response.map((i) => q.options[i]).join(" · ");
    return String(response);
  }

  const TYPE_LABEL = { single: "Single choice", multi: "Select all that apply", fill: "Fill in the blank", short: "Short answer" };

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

  /** Draw n questions: at least one from every category (when n allows), the rest at random, in random order. */
  function drawQuestions(questions, n) {
    const pool = shuffle(questions.slice()), byCat = new Map();
    for (const q of pool) { const c = categoryOf(q); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(q); }
    const picked = new Set();
    if (n >= byCat.size) for (const list of byCat.values()) picked.add(list[0].id);
    for (const q of pool) { if (picked.size >= n) break; picked.add(q.id); }
    return shuffle([...picked]).slice(0, n);
  }

  global.Assess = { normalize, sha256, normEmail, normStaffId, loadData, escapeHtml, isCorrect, correctText, responseText, TYPE_LABEL,
    DEFAULT_CATEGORIES, categoriesOf, categoryOf, drawQuestions, shuffle };
})(window);
