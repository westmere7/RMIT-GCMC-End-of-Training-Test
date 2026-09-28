// Makes a new private key for the editor and prints the editor's link. The previous link stops working at once.
// Run from this folder, with .env filled in:   node scripts/editor-key.js https://your-site.vercel.app
// Only the key's SHA-256 is stored (Supabase table assessment_secrets); the link is the only copy of the key itself.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) { /* no .env: rely on the environment */ }

const { configured, setEditorKey } = require("../api/_store");
if (!configured()) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first."); process.exit(1); }

const site = (process.argv[2] || "https://gcmc-test.vercel.app").replace(/\/$/, "");
const key = crypto.randomBytes(24).toString("base64url");
setEditorKey(key)
  .then(() => {
    console.log("New editor key set. The old editor link no longer works.\n");
    console.log("Editor link (keep it private):\n  " + site + "/admin.html#key=" + key + "\n");
  })
  .catch((e) => { console.error("Couldn't set the key:", e.message); process.exit(1); });
