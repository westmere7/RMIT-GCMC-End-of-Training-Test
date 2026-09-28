// The team's private "Submit a question" links (editor key required).
// GET    /api/contributors          -> [{ token, name, created_at, revoked_at, sent, pending }]
// POST   /api/contributors {name}   -> { token }   a new link for that person
// DELETE /api/contributors?t=…      -> turns that link off (what they already sent stays)
const { configured, isEditor, contributors, submissions, readJson, send } = require("./_store");

module.exports = async (req, res) => {
  try {
    if (!configured()) return send(res, 503, { error: "Team links need the live site (Supabase isn't set up here)." });
    if (!(await isEditor(req))) return send(res, 401, { error: "Open the editor from its private link." });
    if (req.method === "GET") {
      const [list, subs] = await Promise.all([contributors.list(), submissions.list("")]);
      const tally = {};
      for (const s of subs) {
        const t = (tally[s.contributor_token] = tally[s.contributor_token] || { sent: 0, pending: 0 });
        t.sent++; if (s.status === "pending") t.pending++;
      }
      return send(res, 200, list.map((c) => ({ ...c, ...(tally[c.token] || { sent: 0, pending: 0 }) })));
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const name = String((body && body.name) || "").trim().replace(/\s+/g, " ").slice(0, 60);
      if (!name) return send(res, 400, { error: "Enter their name." });
      return send(res, 200, { token: await contributors.create(name), name });
    }
    if (req.method === "DELETE") {
      await contributors.revoke(new URL(req.url, "http://local").searchParams.get("t"));
      return send(res, 200, { ok: true });
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
