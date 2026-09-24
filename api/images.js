// POST /api/images  (body: one WebP image, up to 3 MB, sent as application/octet-stream) -> { url }
// The editor compresses to WebP before uploading; this only checks it really is a WebP and stores it.
const { configured, storeImage, MAX_IMAGE, readRaw, send } = require("./_store");

const isWebp = (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(res, 405, { error: "Method not allowed" }); }
    if (!configured()) return send(res, 503, { error: "Supabase isn't set up yet (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." });
    let buf;
    try { buf = await readRaw(req, MAX_IMAGE); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? "Images can be up to 3 MB." : "Couldn't read the image." }); }
    if (buf.length > MAX_IMAGE) return send(res, 413, { error: "Images can be up to 3 MB." });
    if (!isWebp(buf)) return send(res, 415, { error: "Only WebP images can be uploaded." });
    return send(res, 200, { url: await storeImage(buf), bytes: buf.length });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
