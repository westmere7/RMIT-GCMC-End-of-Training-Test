// The editor's inbox of questions sent in by the team (editor key required).
// GET   /api/submissions?status=pending          -> [{ id, contributor_name, question, status, created_at, … }]
// PATCH /api/submissions  { ids: [1, 2], status }  status: "approved" | "rejected" | "pending"
const { configured, isEditor, submissions, readJson, send } = require("./_store");

module.exports = async (req, res) => {
  try {
    if (!configured()) return send(res, 503, { error: "The inbox needs the live site (Supabase isn't set up here)." });
    if (!(await isEditor(req))) return send(res, 401, { error: "Open the editor from its private link." });
    if (req.method === "GET") {
      const status = new URL(req.url, "http://local").searchParams.get("status") || "";
      return send(res, 200, await submissions.list(["pending", "approved", "rejected"].includes(status) ? status : ""));
    }
    if (req.method === "PATCH") {
      const body = await readJson(req);
      if (!["approved", "rejected", "pending"].includes(body && body.status)) return send(res, 400, { error: "Unknown status." });
      await submissions.setStatus(body.ids, body.status);
      return send(res, 200, { ok: true });
    }
    res.setHeader("Allow", "GET, PATCH");
    return send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
