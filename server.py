"""Local server for the End-of-Training Assessment.

Serves the site from this folder and adds a tiny API:
  GET  /api/questions   -> data/questions.json
  PUT  /api/questions   -> overwrite data/questions.json (previous copy kept in data/backups/);
                           409 if someone saved since you loaded (send ?force=1 to overwrite)
  POST /api/results     -> save an attempt to data/results/

Standard library only. Run:  python server.py   (then open http://localhost:8765/)
"""
import json
import os
import shutil
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HOST, PORT = "127.0.0.1", int(os.environ.get("PORT", "8765"))
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
QUESTIONS = os.path.join(DATA, "questions.json")


def stamp():
    return datetime.now().strftime("%Y%m%d-%H%M%S")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path.split("?")[0] == "/api/questions":
            with open(QUESTIONS, encoding="utf-8") as f:
                return self._json(200, json.load(f))
        return super().do_GET()

    def do_PUT(self):
        if self.path.split("?")[0] != "/api/questions":
            return self._json(404, {"error": "Not found"})
        try:
            data = self._read_body()
            if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
                return self._json(400, {"error": "Expected an object with a 'questions' list."})
            current = 0
            if os.path.exists(QUESTIONS):
                with open(QUESTIONS, encoding="utf-8") as f:
                    current = int(json.load(f).get("revision") or 0)
            if "force=1" not in self.path and int(data.get("revision") or 0) != current:
                return self._json(409, {"error": "Someone else saved changes after you opened the editor.", "revision": current})
            data["revision"] = current + 1
            data.pop("updatedAt", None)
            os.makedirs(os.path.join(DATA, "backups"), exist_ok=True)
            if os.path.exists(QUESTIONS):
                shutil.copy2(QUESTIONS, os.path.join(DATA, "backups", f"questions-{stamp()}.json"))
            tmp = QUESTIONS + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, QUESTIONS)
            return self._json(200, {"ok": True, "revision": data["revision"], "count": len(data["questions"])})
        except Exception as e:  # noqa: BLE001 - report any failure back to the editor
            return self._json(500, {"error": str(e)})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/results":
            return self._json(404, {"error": "Not found"})
        try:
            data = self._read_body()
            os.makedirs(os.path.join(DATA, "results"), exist_ok=True)
            with open(os.path.join(DATA, "results", f"attempt-{stamp()}.json"), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return self._json(200, {"ok": True})
        except Exception as e:  # noqa: BLE001
            return self._json(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    print(f"End-of-Training Assessment running at http://localhost:{PORT}/")
    print(f"Question editor: http://localhost:{PORT}/admin.html")
    print("Press Ctrl+C to stop.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
