// People: first names keyed by the SHA-256 of their (lower-cased) email. No sign-in; this only personalises the test.
// GET    /api/people?h=<sha256>  -> { name } (null when we don't know them yet)
// GET    /api/people             -> [{ email_sha256, name, updated_at }]   (editor list)
// POST   /api/people             -> { name, email_sha256 } upserts one person
// DELETE /api/people?h=<sha256>  -> removes one person
const { configured, people, readJson, send } = require("./_store");

const HASH = /^[0-9a-f]{64}$/;

module.exports = async (req, res) => {
  try {
    if (!configured()) return send(res, 503, { error: "Supabase isn't set up yet." });
    const h = new URL(req.url, "http://x").searchParams.get("h") || "";
    if (req.method === "GET") {
      if (!h) return send(res, 200, await people.list());
      if (!HASH.test(h)) return send(res, 400, { error: "Bad fingerprint." });
      const p = await people.get(h);
      return send(res, 200, { name: p ? p.name : null });
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const name = String(body.name || "").trim().slice(0, 40);
      if (!name || !HASH.test(body.email_sha256 || "")) return send(res, 400, { error: "Need a first name and an email fingerprint." });
      await people.upsert(body.email_sha256, name);
      return send(res, 200, { ok: true, name });
    }
    if (req.method === "DELETE") {
      if (!HASH.test(h)) return send(res, 400, { error: "Bad fingerprint." });
      await people.remove(h);
      return send(res, 200, { ok: true });
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
