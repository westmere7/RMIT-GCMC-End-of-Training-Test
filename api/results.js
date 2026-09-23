// POST /api/results -> store one finished attempt in assessment_results.
const { configured, insertResult, readJson, send } = require("./_store");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed" }); }
  try {
    if (!configured()) return send(res, 200, { ok: false, skipped: "Supabase isn't set up yet" });
    await insertResult(await readJson(req));
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
