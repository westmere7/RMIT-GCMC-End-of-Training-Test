// The team's "Submit a question" page. Each person's private link carries their token (?t=…); there's no sign-in.
// GET  /api/contribute?t=…  -> { name, sent, categories, criticalPenalty }  (nothing from the bank itself)
// POST /api/contribute?t=…  -> { ok, id, sent }   body: { question }  → waits in the editor's inbox for review
const fs = require("fs");
const path = require("path");
const { configured, readDoc, contributors, submissions, readJson, send } = require("./_store");

const param = (req, k) => new URL(req.url, "http://local").searchParams.get(k) || "";
const str = (v, max) => String(v == null ? "" : v).slice(0, max);

async function settings() {
  const doc = (await readDoc()) || JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "questions.json"), "utf8"));
  return doc.settings || {};
}

// pictures must be ones uploaded through /api/images (our own storage bucket)
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isOurImage = (u) =>
  new RegExp("^" + escRe((process.env.SUPABASE_URL || "").replace(/\/$/, "")) + "/storage/v1/object/public/assessment-images/[0-9a-f]{32}\\.webp$").test(String(u || ""));

/** Keep only the fields a question can have, at sensible sizes. Returns null for an unknown type. */
function clean(q) {
  q = q || {};
  const t = String(q.type);
  const out = { type: t, category: str(q.category, 60), prompt: str(q.prompt, 600).trim() };
  if (q.critical) out.critical = true;
  const list = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);
  const picks = (a, n) => [...new Set(list(a, 20).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((x, y) => x - y);
  if (t === "single" || t === "multi") {
    out.options = list(q.options, 8).map((o) => str(o, 300).trim());
    out.correct = picks(q.correct, out.options.length);
    if (t === "single") out.correct = out.correct.slice(0, 1);
  } else if (t === "match") {
    out.pairs = list(q.pairs, 8).map((p) => ({ left: str(p && p.left, 200).trim(), right: str(p && p.right, 300).trim() })).filter((p) => p.left && p.right);
  } else if (t === "fill" || t === "short") {
    out.answers = list(q.answers, 12).map((a) => str(a, 120).trim()).filter(Boolean);
  } else if (t === "image") {
    out.mode = q.mode === "answers" ? "answers" : "question";
    if (q.multiple) out.multiple = true;
    if (out.mode === "question") {
      if (isOurImage(q.image)) out.image = q.image;
      out.options = list(q.options, 8).map((o) => str(o, 300).trim());
    } else out.options = list(q.options, 6).filter(isOurImage);
    out.correct = picks(q.correct, out.options.length);
    if (!out.multiple) out.correct = out.correct.slice(0, 1);
  } else return null;
  return out;
}
// the page checks everything as they type; this just refuses the obviously incomplete
function incomplete(q) {
  if (!q) return "Unknown question type.";
  if (!q.prompt) return "Write the question.";
  if (q.options && (q.options.filter(Boolean).length < 2 || !q.correct.length)) return "Add the options and mark the correct one.";
  if (q.type === "image" && q.mode === "question" && !q.image) return "Upload the picture for the question.";
  if (q.type === "match" && q.pairs.length < 2) return "Add at least two complete pairs.";
  if ((q.type === "fill" || q.type === "short") && !q.answers.length) return "Add at least one accepted answer.";
  if (q.type === "fill" && !/_{3,}/.test(q.prompt)) return "Put ___ where the blank goes.";
  return "";
}

module.exports = async (req, res) => {
  try {
    if (!configured()) return send(res, 503, { error: "Contributions need the live site (Supabase isn't set up here)." });
    const who = await contributors.byToken(param(req, "t"));
    if (!who) return send(res, 403, { error: "This link isn't active. Ask for a new one." });
    if (req.method === "GET") {
      const st = await settings();
      return send(res, 200, { name: who.name, sent: await submissions.count(who.token), categories: st.categories || [], criticalPenalty: st.criticalPenalty });
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const q = clean(body && body.question), why = incomplete(q);
      if (why) return send(res, 400, { error: why });
      const row = await submissions.add(who, q);
      return send(res, 200, { ok: true, id: row && row.id, sent: await submissions.count(who.token) });
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
