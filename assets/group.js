/* Group play: the room client (see api/room.js), the colours people pick, the QR code, and the points rules. */
(function (global) {
  "use strict";

  // Colours people can pick in the lobby (no two alike in a room). The test taker is always RMIT red.
  const TAKER_COLOUR = "#e61e2a";
  const PALETTE = [
    ["#2563eb", "Blue"], ["#0d9488", "Teal"], ["#16a34a", "Green"], ["#65a30d", "Lime"], ["#ca8a04", "Mustard"], ["#ea580c", "Orange"],
    ["#db2777", "Pink"], ["#9333ea", "Purple"], ["#4f46e5", "Indigo"], ["#0284c7", "Sky"], ["#92400e", "Brown"], ["#475569", "Slate"],
  ].map(([c, n]) => ({ c, n }));
  const colourName = (c) => (c === TAKER_COLOUR ? "Red" : (PALETTE.find((p) => p.c === c) || {}).n || "");

  /** This browser's id: kept in localStorage (so closing the tab and scanning again finds the same seat) and in
      sessionStorage (so a refresh does, even where localStorage is blocked). */
  const DEVICE_KEY = "gcmc-device";
  function deviceId() {
    let id = null;
    try { id = sessionStorage.getItem(DEVICE_KEY) || localStorage.getItem(DEVICE_KEY); } catch (e) { /* storage blocked */ }
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const b = crypto.getRandomValues(new Uint8Array(18));
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    try { sessionStorage.setItem(DEVICE_KEY, id); localStorage.setItem(DEVICE_KEY, id); } catch (e) {}
    return id;
  }

  // ---------- talking to the room: the server's clock is the one that counts ----------
  let offset = 0; // server time − local time
  const serverNow = () => Date.now() + offset;
  async function call(init, query) {
    const t0 = Date.now();
    const res = await fetch("/api/room" + (query ? "?" + new URLSearchParams(query) : ""), { cache: "no-store", ...init });
    const t1 = Date.now();
    let data = null;
    try { data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null; } catch (e) {}
    if (!res.ok || !data) throw Object.assign(new Error((data && data.error) || "The room isn't reachable right now."), { status: res.status });
    if (data.now) offset = data.now - (t0 + t1) / 2;
    return data;
  }
  const get = (query) => call({}, query);
  const post = (body) => call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  /** Time left on a room clock (ms); frozen while an answer is on show. */
  function remaining(clock) {
    if (!clock) return 0;
    const used = clock.runningSince ? clock.usedMs + (serverNow() - clock.runningSince) : clock.usedMs;
    return Math.max(0, clock.limitMs - used);
  }

  // ---------- points ----------
  // The taker's points depend on how the rest of the room did; each member's on how the taker did.
  // The taker's run between two ends, by the share of the team that got it wrong: right, +1 (the whole team right too)
  // up to +10 (the whole team wrong); wrong, −5 (the whole team right) up to 0 (the whole team wrong too). In between,
  // each teammate who got it wrong is worth the same, so a bigger room doesn't change what a taker scores on average.
  // Teammates: +1 right; wrong costs 3 if the taker got it right, 2 if the taker was wrong too.
  // Critical questions count double, both ways. With nobody else in the room, a right answer is +1 and a wrong one −1.
  const RULES = {
    solo: { right: 1, wrong: -1 },
    taker: { right: { allRight: 1, allWrong: 10 }, wrong: { allRight: -5, allWrong: 0 } },
    member: { right: 1, wrongTakerRight: -3, wrongTakerWrong: -2 },
  };
  /** Points for one question. takerRight: bool; memberRights: bools (an unanswered member counts as wrong). */
  function points(critical, takerRight, memberRights) {
    const k = critical ? 2 : 1, n = memberRights.length, share = n ? memberRights.filter((x) => !x).length / n : 0;
    const ends = takerRight ? RULES.taker.right : RULES.taker.wrong, M = RULES.member;
    const t = !n ? (takerRight ? RULES.solo.right : RULES.solo.wrong) : Math.round(ends.allRight + (ends.allWrong - ends.allRight) * share) || 0;
    return { taker: t * k, members: memberRights.map((ok) => (ok ? M.right : takerRight ? M.wrongTakerRight : M.wrongTakerWrong) * k) };
  }
  // ---------- powerups (the taker, with the team in the room) ----------
  // Every run of three right answers in a row earns a charge; the taker holds two at most (a run that ends with two
  // already held earns nothing). A charge buys one powerup on the question on screen:
  //   double: the taker's points on this question count twice, win or lose, and it can't be taken back.
  //   gauge:  one teammate's pick, as it stands right now (they can still change it, and they may be wrong).
  // They only change the room's scoreboard: the recorded points, the meter and the award are worked out without them.
  const POWER = { run: 3, hold: 2 };
  const spentAt = (p) => (p ? (p.double ? 1 : 0) + (p.gauge ? 1 : 0) : 0);
  /** Charges in hand on question k, after anything spent on it. takerRight[i]: the taker got question i right (for
      the questions before k); powers[i]: what was used on question i. `run` is the current run toward the next charge. */
  function charges(takerRight, powers, k) {
    let held = 0, run = 0;
    for (let i = 0; i < k; i++) {
      held -= spentAt(powers && powers[i]);
      if (!takerRight[i]) { run = 0; continue; }
      if (++run === POWER.run) { run = 0; if (held < POWER.hold) held++; }
    }
    return { held: Math.max(0, held - spentAt(powers && powers[k])), run };
  }
  /** The taker's points on the room's scoreboard for one question: the points, doubled when they doubled down. */
  const gamePoints = (points, power) => (power && power.double ? points * 2 : points);

  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");

  // ---------- QR code (assets/qrcode.js), drawn as SVG so it stays sharp when projected ----------
  function qrSvg(text) {
    const qr = global.qrcode(0, "M"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), q = 2; // 2-module quiet zone
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + q},${y + q}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" role="img" aria-label="QR code to join" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000054"/></svg>`;
  }

  global.Group = { TAKER_COLOUR, PALETTE, colourName, deviceId, get, post, serverNow, remaining, RULES, points, POWER, charges, gamePoints, signed, qrSvg };
})(window);
