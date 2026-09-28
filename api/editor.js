// GET /api/editor  (with the x-editor-key header) -> 200 { ok: true } when the key opens the editor, 401 when it doesn't.
const { configured, isEditor, send } = require("./_store");

module.exports = async (req, res) => {
  try {
    if (!configured()) return send(res, 200, { ok: true, offline: true });
    return (await isEditor(req)) ? send(res, 200, { ok: true }) : send(res, 401, { error: "This editor link isn't valid." });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
