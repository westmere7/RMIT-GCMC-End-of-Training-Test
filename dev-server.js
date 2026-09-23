// Local dev server that behaves like the Vercel deployment: serves the site and runs the same api/*.js
// functions, talking to the same Supabase project. Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.
// Run: node dev-server.js   (or double-click "Start Test.bat")   → http://localhost:8765/
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);

// minimal .env loader (KEY=value, # comments, optional quotes)
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) { /* no .env: the API falls back to the bundled questions and can't save */ }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// ---- live reload: open tabs refresh when a file changes (CSS is swapped in place, no reload)
const clients = new Set();
const RELOAD_JS = `<script>(function(){try{var es=new EventSource("/__livereload");es.onmessage=function(e){
  if(e.data==="css"){document.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){var u=new URL(l.href);u.searchParams.set("t",Date.now());l.href=u.href;});}
  else{location.reload();}};}catch(_){}})();</script>`;
let pending = null, kind = "css";
try {
  fs.watch(ROOT, { recursive: true }, (_ev, f) => {
    if (!f || /^(\.git|node_modules|data[\\/](results|backups))|\.env|\.tmp$|~\$/.test(f)) return;
    if (!/\.css$/i.test(f)) kind = "reload";
    clearTimeout(pending);
    pending = setTimeout(() => { for (const c of clients) c.write(`data: ${kind}\n\n`); if (clients.size) console.log(`↻ ${f} changed (${kind})`); kind = "css"; }, 150);
  });
} catch (e) { console.log("Live reload unavailable:", e.message); }

http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/__livereload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": connected\n\n"); clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    return req.on("close", () => { clearInterval(ping); clients.delete(res); });
  }
  const api = p.match(/^\/api\/([a-z0-9-]+)$/i);
  if (api && !api[1].startsWith("_")) {
    const file = path.join(ROOT, "api", api[1] + ".js");
    if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"Not found"}'); }
    delete require.cache[require.resolve(file)]; // pick up edits without a restart
    return Promise.resolve(require(file)(req, res)).catch((e) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
  }
  const file = path.normalize(path.join(ROOT, p === "/" ? "index.html" : p));
  if (!file.startsWith(ROOT) || /[\\/]\.(env|git)/.test(file)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    if (path.extname(file) === ".html") return res.end(String(data).replace("</body>", RELOAD_JS + "</body>"));
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => {
  const live = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.log(`End-of-Training Assessment → http://localhost:${PORT}/   editor → http://localhost:${PORT}/admin.html`);
  console.log(live ? `Connected to Supabase: ${process.env.SUPABASE_URL} (live data, same as the Vercel site)` : "No .env found: serving the bundled questions; saving is disabled.");
});
