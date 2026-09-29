// Shared Supabase access for the Vercel functions. Uses the REST API directly (no SDK, no build step).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DOC_ID = "main";

function configured() {
  return Boolean(URL_ && KEY);
}

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** The current question document, or null when the table has no row yet. */
async function readDoc() {
  const rows = await rest(`assessment_config?id=eq.${DOC_ID}&select=data,revision,updated_at`);
  if (!rows || !rows.length) return null;
  return { ...rows[0].data, revision: rows[0].revision, updatedAt: rows[0].updated_at };
}

/** Saves the document; keeps the previous version in assessment_config_history. */
async function writeDoc(doc, revision, previous) {
  const { revision: _r, updatedAt: _u, ...data } = doc;
  if (previous) {
    const { revision: pr, updatedAt: _pu, ...prevData } = previous;
    await rest("assessment_config_history", { method: "POST", body: JSON.stringify({ config_id: DOC_ID, revision: pr, data: prevData }) });
  }
  const rows = await rest("assessment_config?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ id: DOC_ID, data, revision, updated_at: new Date().toISOString() }),
  });
  return rows && rows[0];
}

async function insertResult(r) {
  await rest("assessment_results", {
    method: "POST",
    body: JSON.stringify({
      email: r.email || null,
      name: r.name || null,
      assessment: r.assessment || null,
      correct: r.correct ?? null,
      total: r.total ?? null,
      timed_out: !!r.timedOut,
      started_at: r.startedAt || null,
      finished_at: r.finishedAt || null,
      by_category: Array.isArray(r.byCategory) ? r.byCategory : null,
      payload: r,
    }),
  });
}

// First names: assessment_people, keyed by the SHA-256 of the lower-cased email (migration 002).
const people = {
  async list() {
    return (await rest("assessment_people?select=email_sha256,name,updated_at&order=name.asc")) || [];
  },
  async get(h) {
    const rows = await rest(`assessment_people?email_sha256=eq.${h}&select=name`);
    return (rows && rows[0]) || null;
  },
  async upsert(h, name) {
    await rest("assessment_people?on_conflict=email_sha256", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ email_sha256: h, name, updated_at: new Date().toISOString() }),
    });
  },
  async remove(h) {
    await rest(`assessment_people?email_sha256=eq.${h}`, { method: "DELETE" });
  },
};

// ---------- private links: the editor's key, and one link per team member (no sign-in anywhere) ----------
const crypto = require("crypto");
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** Is this request from the editor? It carries the editor's key in `x-editor-key`. With no key set yet, the editor is open. */
async function isEditor(req) {
  const rows = await rest("assessment_secrets?name=eq.editor_key&select=value");
  const want = rows && rows[0] && rows[0].value;
  if (!want) return true;
  const got = String(req.headers["x-editor-key"] || "");
  if (!got) return false;
  const a = Buffer.from(sha256(got)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function setEditorKey(key) {
  await rest("assessment_secrets?on_conflict=name", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ name: "editor_key", value: sha256(key), updated_at: new Date().toISOString() }),
  });
}

const contributors = {
  async list() {
    return (await rest("assessment_contributors?select=token,name,created_at,revoked_at&order=created_at.asc")) || [];
  },
  /** The person a link belongs to, or null if the link is unknown or was turned off. */
  async byToken(t) {
    if (!TOKEN.test(String(t || ""))) return null;
    const rows = await rest(`assessment_contributors?token=eq.${t}&revoked_at=is.null&select=token,name`);
    return (rows && rows[0]) || null;
  },
  async create(name) {
    const token = crypto.randomBytes(18).toString("base64url");
    await rest("assessment_contributors", { method: "POST", body: JSON.stringify({ token, name }) });
    return token;
  },
  async revoke(t) {
    if (!TOKEN.test(String(t || ""))) return;
    await rest(`assessment_contributors?token=eq.${t}`, { method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
  },
};

const submissions = {
  async add(who, question) {
    const rows = await rest("assessment_submissions", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ contributor_token: who.token, contributor_name: who.name, question }),
    });
    return rows && rows[0];
  },
  async list(status) {
    const q = status ? `&status=eq.${encodeURIComponent(status)}` : "";
    return (await rest(`assessment_submissions?select=id,contributor_token,contributor_name,question,status,created_at,reviewed_at&order=created_at.desc&limit=300${q}`)) || [];
  },
  async count(token) {
    const rows = await rest(`assessment_submissions?contributor_token=eq.${token}&select=id`);
    return (rows || []).length;
  },
  async setStatus(ids, status) {
    const list = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!list.length) return;
    await rest(`assessment_submissions?id=in.(${list.join(",")})`, {
      method: "PATCH", body: JSON.stringify({ status, reviewed_at: status === "pending" ? null : new Date().toISOString() }),
    });
  },
};

// ---------- group play: rooms, the people in them, and their answers (migration 005) ----------
const isDuplicate = (e) => /\b409\b|23505|duplicate key/.test(String(e && e.message));
const rooms = {
  async get(code, withPaper) {
    const cols = "code,host_hash,host_name,host_busy_q,host_seen_at,state,version,updated_at" + (withPaper ? ",paper" : "");
    const rows = await rest(`assessment_rooms?code=eq.${code}&select=${cols}`);
    return (rows && rows[0]) || null;
  },
  async create(code, hostHash, hostName) {
    await rest("assessment_rooms", { method: "POST", body: JSON.stringify({ code, host_hash: hostHash, host_name: hostName, state: { phase: "lobby" } }) });
  },
  /** Writes the room's state if nobody else did since `version`; null when they did. */
  async setState(code, version, state, paper) {
    const body = { state, version: version + 1, updated_at: new Date().toISOString() };
    if (paper !== undefined) body.paper = paper;
    const rows = await rest(`assessment_rooms?code=eq.${code}&version=eq.${version}&select=code,host_hash,host_name,host_busy_q,host_seen_at,state,version,updated_at`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body),
    });
    return (rows && rows[0]) || null;
  },
  async patchHost(code, patch) {
    await rest(`assessment_rooms?code=eq.${code}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async remove(code) {
    await rest(`assessment_rooms?code=eq.${code}`, { method: "DELETE" });
  },
  /** Rooms left behind: a lobby its taker walked away from (30 minutes), a test its taker stopped driving (3 hours),
      a finished one (12 hours: long enough for everyone to look at the results), and anything untouched for 2 days.
      Their people and answers go with them. */
  async prune() {
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString(), del = { method: "DELETE" };
    await Promise.all([
      rest(`assessment_rooms?state->>phase=eq.lobby&host_seen_at=lt.${ago(0.5)}`, del),
      rest(`assessment_rooms?state->>phase=in.(question,reveal)&host_seen_at=lt.${ago(3)}`, del),
      rest(`assessment_rooms?state->>phase=eq.finished&updated_at=lt.${ago(12)}`, del),
      rest(`assessment_rooms?updated_at=lt.${ago(48)}`, del),
    ]);
  },
  /** Teammates whose page has gone quiet in the lobby (a closed tab, a locked phone) give their seat and colour back. */
  async pruneMembers(code) {
    await rest(`assessment_room_members?room=eq.${code}&seen_at=lt.${new Date(Date.now() - 120e3).toISOString()}`, { method: "DELETE" });
  },
  async members(code) {
    return (await rest(`assessment_room_members?room=eq.${code}&select=id,device_hash,name,color,busy_q,seen_at,draft,draft_q&order=id.asc`)) || [];
  },
  /** A new seat; throws with `code: 409` when the colour is taken. */
  async join(code, deviceHash, name, color) {
    try {
      const rows = await rest("assessment_room_members", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ room: code, device_hash: deviceHash, name, color }) });
      return rows && rows[0];
    } catch (e) { if (isDuplicate(e)) e.code = 409; throw e; }
  },
  async patchMember(code, id, patch) {
    try { await rest(`assessment_room_members?room=eq.${code}&id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) }); }
    catch (e) { if (isDuplicate(e)) e.code = 409; throw e; }
  },
  async removeMember(code, id) {
    await rest(`assessment_room_members?room=eq.${code}&id=eq.${id}`, { method: "DELETE" });
  },
  /** Teammates' unsubmitted picks for question q. */
  async drafts(code, q) {
    return (await rest(`assessment_room_members?room=eq.${code}&draft_q=eq.${q}&draft=not.is.null&select=id,draft`)) || [];
  },
  async answers(code, fromQ) {
    return (await rest(`assessment_room_answers?room=eq.${code}&qidx=gte.${fromQ}&select=member_id,qidx,response,at&order=qidx.asc`)) || [];
  },
  /** The first answer counts: a second one for the same question is ignored. */
  async answer(code, memberId, qidx, response, at) {
    await rest("assessment_room_answers?on_conflict=room,member_id,qidx", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ room: code, member_id: memberId, qidx, response: response == null ? null : response, at: new Date(at || Date.now()).toISOString() }),
    });
  },
};

// Question images: WebP files in a public Storage bucket, named by their SHA-256 (the same image is stored once).
const BUCKET = "assessment-images";
const MAX_IMAGE = 3 * 1024 * 1024;
async function storeImage(buf) {
  const name = require("crypto").createHash("sha256").update(buf).digest("hex").slice(0, 32) + ".webp";
  const upload = () => fetch(`${URL_}/storage/v1/object/${BUCKET}/${name}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "image/webp", "x-upsert": "true", "Cache-Control": "max-age=31536000" },
    body: buf,
  });
  let res = await upload();
  if (!res.ok && /bucket not found/i.test(await res.clone().text())) {
    // first image ever: make the bucket (public to read; WebP only, 3 MB each)
    const made = await fetch(`${URL_}/storage/v1/bucket`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: MAX_IMAGE, allowed_mime_types: ["image/webp"] }),
    });
    if (!made.ok && made.status !== 409) throw new Error(`Supabase storage ${made.status}: ${await made.text()}`);
    res = await upload();
  }
  if (!res.ok) throw new Error(`Supabase storage ${res.status}: ${await res.text()}`);
  return `${URL_}/storage/v1/object/public/${BUCKET}/${name}`;
}

/** The raw request body as a Buffer (Vercel gives octet-stream bodies as a Buffer already). Rejects past `max` bytes. */
function readRaw(req, max) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readJson(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function send(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

module.exports = { configured, readDoc, writeDoc, insertResult, people, storeImage, MAX_IMAGE, readRaw, readJson, send,
  isEditor, setEditorKey, contributors, submissions, rooms, sha256 };
