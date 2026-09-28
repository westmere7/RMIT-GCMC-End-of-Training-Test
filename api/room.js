// Group play. The test taker opens a room on the briefing screen; the team joins it from a QR code, answers the same
// questions alongside, and the taker's submit moves everyone on. Everyone polls GET; only the taker (who holds the
// room's host key) changes the room's state. Members are known by a device id their browser keeps, so a refresh finds
// the same seat.
// GET  /api/room?r=CODE&d=DEVICE | &h=HOSTKEY  [&since=N] [&paper=1] [&hb=1]   -> the room as that person sees it
// POST /api/room { action, r, d | h, since, ... }                                 -> the same, after the action
//   create {name}                         -> also { hostKey }
//   join {name, color} · leave            (members, in the lobby)
//   busy {q, busy, draft}                 (anyone: working on question q, not yet submitted; a member's draft is
//                                          their current pick, which counts as their answer when the taker submits)
//   answer {q, response}                  (members, while question q is open)
//   kick {m} · start {paper} · reveal {q, response} · next {q} · finish {q, timedOut} · end   (the taker)
const { configured, rooms, readJson, send, sha256 } = require("./_store");
const crypto = require("crypto");

const CODE = /^[A-Z0-9]{4,8}$/, DEVICE = /^[A-Za-z0-9_-]{16,64}$/, COLOR = /^#[0-9a-f]{6}$/;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const newCode = () => Array.from(crypto.randomBytes(5), (b) => LETTERS[b % LETTERS.length]).join("");
const fail = (code, message) => Object.assign(new Error(message), { code });
const cleanName = (v, max) => String(v || "").trim().replace(/\s+/g, " ").slice(0, max);
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// how many questions have had their answer shown (their answers are no longer secret)
function revealedCount(st) {
  if (st.phase === "reveal") return st.index + 1;
  if (st.phase === "finished") return st.reached || 0;
  if (st.phase === "question") return st.index;
  return 0;
}
function clockNow(clock, now) { return clock.runningSince ? clock.usedMs + (now - clock.runningSince) : clock.usedMs; }
function freeze(clock, now) { return { ...clock, usedMs: Math.min(clock.limitMs, clockNow(clock, now)), runningSince: null }; }

async function who(room, q) {
  if (q.h) {
    if (!sameHash(sha256(q.h), room.host_hash)) throw fail(403, "That isn't this room's host key.");
    return { host: true };
  }
  if (!DEVICE.test(String(q.d || ""))) throw fail(400, "Missing device id.");
  return { device: sha256(q.d) };
}

async function snapshot(room, me, since, withPaper) {
  const st = room.state || {}, code = room.code, now = Date.now();
  const revealed = revealedCount(st), from = Math.max(0, Math.min(+since || 0, st.index || 0));
  const [members, answers] = await Promise.all([rooms.members(code), st.phase === "lobby" ? [] : rooms.answers(code, from)]);
  const mine = me.device ? members.find((m) => m.device_hash === me.device) : null;
  const out = {
    code, now, phase: st.phase || "lobby", index: st.index || 0, total: st.total || 0, clock: st.clock || null,
    roster: st.roster || null, timedOut: !!st.timedOut, revealed,
    host: { name: room.host_name, busy: room.host_busy_q, seen: Date.parse(room.host_seen_at) },
    // teammates are known by colour until the end; names come out on the results
    members: members.map((m) => ({ id: m.id, name: st.phase === "finished" || m === mine ? m.name : "", color: m.color, busy: m.busy_q, seen: Date.parse(m.seen_at) })),
    isHost: !!me.host, me: mine ? { id: mine.id, name: mine.name, color: mine.color } : null,
    answered: [], answers: [], mine: null,
  };
  const cut = st.revealAt || {};
  for (const a of answers) {
    if (a.qidx < revealed) {
      // an answer that arrived after the taker submitted doesn't count
      if (cut[a.qidx] && Date.parse(a.at) > cut[a.qidx]) continue;
      out.answers.push({ m: a.member_id, q: a.qidx, r: a.response });
    } else if (a.qidx === st.index) {
      out.answered.push(a.member_id);
      if (mine && a.member_id === mine.id) out.mine = { r: a.response };
    }
  }
  if (withPaper) out.paper = room.paper || null;
  return out;
}

async function act(body) {
  const action = String(body.action || "");
  if (action === "create") {
    rooms.prune().catch(() => {});
    const hostKey = crypto.randomBytes(18).toString("base64url"), name = cleanName(body.name, 40) || "Candidate";
    for (let t = 0; ; t++) {
      const code = newCode();
      try { await rooms.create(code, sha256(hostKey), name); return { hostKey, code }; }
      catch (e) { if (t > 4 || !/\b409\b|23505|duplicate/.test(e.message)) throw e; }
    }
  }
  const code = String(body.r || "").toUpperCase();
  if (!CODE.test(code)) throw fail(400, "Bad room code.");
  let room = await rooms.get(code);
  if (!room) throw fail(404, "This room has closed.");
  const me = await who(room, body), st = room.state || {}, now = Date.now();
  const members = me.device || action === "kick" || action === "start" ? await rooms.members(code) : [];
  const mine = me.device ? members.find((m) => m.device_hash === me.device) : null;
  const q = Number.isInteger(body.q) ? body.q : -1;
  const setState = async (next, paper) => {
    const row = await rooms.setState(code, room.version, next, paper);
    if (!row) throw fail(409, "The room just changed. Try again.");
    room = row;
  };

  if (me.device) {
    if (action === "join") {
      const name = cleanName(body.name, 24), color = String(body.color || "").toLowerCase();
      if (!name) throw fail(400, "Tell us your name.");
      if (!COLOR.test(color)) throw fail(400, "Pick a colour.");
      if (st.phase !== "lobby" && !mine) throw fail(409, "This test has already started.");
      if (members.some((m) => m.color === color && m !== mine)) throw fail(409, "Someone just took that colour. Pick another.");
      if (mine) await rooms.patchMember(code, mine.id, { name, color, seen_at: new Date().toISOString() });
      else await rooms.join(code, me.device, name, color);
    } else if (action === "leave") {
      if (mine && st.phase === "lobby") await rooms.removeMember(code, mine.id);
    } else if (action === "busy") {
      if (mine && st.phase === "question" && q === st.index) {
        const draft = body.busy && body.draft != null && JSON.stringify(body.draft).length < 4000 ? body.draft : null;
        await rooms.patchMember(code, mine.id, { busy_q: body.busy ? q : null, draft, draft_q: draft == null ? null : q });
      }
    } else if (action === "answer") {
      if (!mine) throw fail(403, "You're not in this room.");
      if (!(st.roster || []).includes(mine.id)) throw fail(409, "You joined after the start, so you're watching this one.");
      if (st.phase !== "question" || q !== st.index || clockNow(st.clock, now) >= st.clock.limitMs) throw fail(409, "Too late: this question has closed.");
      await rooms.answer(code, mine.id, q, body.response);
      await rooms.patchMember(code, mine.id, { busy_q: null });
    } else throw fail(400, "Unknown action.");
    return { room };
  }

  // the taker
  if (action === "busy") {
    if (st.phase === "question" && q === st.index) await rooms.patchHost(code, { host_busy_q: body.busy ? q : null });
  } else if (action === "kick") {
    if (st.phase === "lobby") await rooms.removeMember(code, +body.m);
  } else if (action === "start") {
    if (st.phase !== "lobby") return { room }; // already started (a second click)
    const paper = body.paper || {};
    if (!Array.isArray(paper.questions) || !paper.questions.length || !Array.isArray(paper.order) || JSON.stringify(paper).length > 800000) throw fail(400, "Bad paper.");
    if (!members.length) { await rooms.remove(code); return { solo: true }; } // nobody joined: the taker sits it alone
    const limitMs = Math.max(60000, Math.min(4 * 3600000, +paper.limitMs || 600000));
    await setState({ phase: "question", index: 0, total: paper.questions.length, roster: members.map((m) => m.id),
      clock: { limitMs, usedMs: 0, runningSince: now }, revealAt: {} }, paper);
  } else if (action === "reveal") {
    if (st.phase === "question" && q === st.index) {
      await rooms.answer(code, 0, q, body.response, now);
      // anyone who picked something but didn't press Submit: their pick counts (a submitted answer stays as it was)
      const drafts = (await rooms.drafts(code, q)).filter((d) => (st.roster || []).includes(d.id));
      await Promise.all(drafts.map((d) => rooms.answer(code, d.id, q, d.draft, now)));
      await setState({ ...st, phase: "reveal", clock: freeze(st.clock, now), revealAt: { ...(st.revealAt || {}), [q]: now } });
      await rooms.patchHost(code, { host_busy_q: null });
    }
  } else if (action === "next") {
    if (st.phase === "reveal" && q === st.index) {
      if (q + 1 >= st.total) await setState({ ...st, phase: "finished", reached: st.total });
      else await setState({ ...st, phase: "question", index: q + 1, clock: { ...st.clock, runningSince: now } });
    }
  } else if (action === "finish") {
    // time ran out: the question on screen wasn't submitted, so it scores like the ones never reached
    if (st.phase === "question" || st.phase === "reveal") {
      await setState({ ...st, phase: "finished", reached: st.phase === "reveal" ? st.index + 1 : st.index, timedOut: !!body.timedOut, clock: freeze(st.clock, now) });
    }
  } else if (action === "end") {
    await rooms.remove(code);
    return { ended: true };
  } else throw fail(400, "Unknown action.");
  return { room };
}

module.exports = async (req, res) => {
  try {
    if (!configured()) return send(res, 503, { error: "Group play needs the live site (Supabase isn't set up here)." });
    if (req.method === "GET") {
      const q = Object.fromEntries(new URL(req.url, "http://x").searchParams);
      const code = String(q.r || "").toUpperCase();
      if (!CODE.test(code)) return send(res, 400, { error: "Bad room code." });
      const room = await rooms.get(code, q.paper === "1");
      if (!room) return send(res, 404, { error: "This room has closed." });
      const me = await who(room, q);
      if (q.hb === "1") {
        const seen = new Date().toISOString();
        if (me.host) await rooms.patchHost(code, { host_seen_at: seen });
        else {
          const m = (await rooms.members(code)).find((x) => x.device_hash === me.device);
          if (m) await rooms.patchMember(code, m.id, { seen_at: seen });
        }
      }
      return send(res, 200, await snapshot(room, me, q.since, q.paper === "1"));
    }
    if (req.method === "POST") {
      const body = await readJson(req);
      const out = await act(body);
      if (out.hostKey) {
        const room = await rooms.get(out.code);
        return send(res, 200, { hostKey: out.hostKey, ...(await snapshot(room, { host: true }, 0, false)) });
      }
      if (out.solo || out.ended) return send(res, 200, out);
      return send(res, 200, await snapshot(out.room, await who(out.room, body), body.since, false));
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    const code = [400, 403, 404, 409].includes(e.code) ? e.code : 500;
    return send(res, code, { error: String(e.message || e) });
  }
};
