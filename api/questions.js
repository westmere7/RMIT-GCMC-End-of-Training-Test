// GET  /api/questions  -> the question document (from Supabase; falls back to the bundled data/questions.json)
// PUT  /api/questions  -> save it. Needs the editor key (x-admin-key header) when ADMIN_KEY is set.
//      Send the revision you loaded; if someone saved in between you get 409 (add ?force=1 to overwrite).
const { configured, readDoc, writeDoc, readJson, send } = require("./_store");

const fs = require("fs");
const path = require("path");

// First run (empty table): start from the bundled data/questions.json (included via vercel.json).
async function seed(req) {
  try {
    return { ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "questions.json"), "utf8")), revision: 0 };
  } catch (e) {
    const host = req.headers.host || "";
    const proto = req.headers["x-forwarded-proto"] || (/^(localhost|127\.)/.test(host) ? "http" : "https");
    const res = await fetch(`${proto}://${host}/data/questions.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("Seed file data/questions.json not found");
    return { ...(await res.json()), revision: 0 };
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      if (!configured()) return send(res, 200, await seed(req));
      return send(res, 200, (await readDoc()) || (await seed(req)));
    }
    if (req.method === "PUT") {
      const need = process.env.ADMIN_KEY;
      if (need && req.headers["x-admin-key"] !== need) return send(res, 401, { error: "This editor link is missing its key, or the key is wrong." });
      if (!configured()) return send(res, 503, { error: "Supabase isn't set up yet (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." });
      const doc = await readJson(req);
      if (!doc || !Array.isArray(doc.questions)) return send(res, 400, { error: "Expected an object with a 'questions' list." });
      const current = (await readDoc()) || null;
      const currentRev = current ? current.revision : 0;
      const force = /(^|[?&])force=1(&|$)/.test(req.url.split("?")[1] || "");
      if (!force && Number(doc.revision || 0) !== Number(currentRev)) {
        return send(res, 409, { error: "Someone else saved changes after you opened the editor.", revision: currentRev });
      }
      const row = await writeDoc(doc, currentRev + 1, current);
      return send(res, 200, { ok: true, revision: row ? row.revision : currentRev + 1, count: doc.questions.length });
    }
    res.setHeader("Allow", "GET, PUT");
    return send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
