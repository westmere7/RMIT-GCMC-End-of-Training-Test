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

  global.Assess = { normalize, sha256, normEmail, normStaffId, loadData, escapeHtml, isCorrect, correctText, responseText, TYPE_LABEL };
})(window);
