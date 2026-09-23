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
      payload: r,
    }),
  });
}

// First names live in their own row of assessment_config (id "people"), so no extra table is needed:
// { entries: { <sha256 of email>: { name, updated_at } } }. Kept apart from the question bank so that
// adding a name never bumps the bank's revision or clashes with someone editing questions.
const PEOPLE_ID = "people";
const people = {
  async all() {
    const rows = await rest(`assessment_config?id=eq.${PEOPLE_ID}&select=data`);
    return (rows && rows[0] && rows[0].data && rows[0].data.entries) || {};
  },
  async save(entries) {
    await rest("assessment_config?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: PEOPLE_ID, data: { entries }, revision: 1, updated_at: new Date().toISOString() }),
    });
  },
  async list() {
    const e = await people.all();
    return Object.entries(e).map(([email_sha256, v]) => ({ email_sha256, ...v })).sort((a, b) => a.name.localeCompare(b.name));
  },
  async get(h) {
    return (await people.all())[h] || null;
  },
  async upsert(h, name) {
    const e = await people.all();
    e[h] = { name, updated_at: new Date().toISOString() };
    await people.save(e);
  },
  async remove(h) {
    const e = await people.all();
    delete e[h];
    await people.save(e);
  },
};

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

module.exports = { configured, readDoc, writeDoc, insertResult, people, readJson, send };
