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
  // Critical questions count double, both ways. With nobody else in the room, a right answer is +1 and a wrong one 0.
  const RULES = {
    taker: [
      { right: true, others: "wrong", pts: 10, text: "Right, and everyone else got it wrong" },
      { right: true, others: "some", pts: 2, text: "Right, and some others got it wrong" },
      { right: true, others: "right", pts: 1, text: "Right, and so did everyone else" },
      { right: false, others: "wrong", pts: 0, text: "Wrong, and so was everyone else" },
      { right: false, others: "some", pts: -3, text: "Wrong, and some others got it right" },
      { right: false, others: "right", pts: -5, text: "Wrong, and everyone else got it right" },
    ],
    member: [
      { right: true, pts: 1, text: "Right, whatever the taker answered" },
      { right: false, taker: false, pts: -5, text: "Wrong, and so was the taker" },
      { right: false, taker: true, pts: -10, text: "Wrong, but the taker got it right" },
    ],
  };
  /** Points for one question. takerRight: bool; memberRights: bools (an unanswered member counts as wrong). */
  function points(critical, takerRight, memberRights) {
    const k = critical ? 2 : 1, n = memberRights.length, r = memberRights.filter(Boolean).length;
    let t;
    if (!n) t = takerRight ? 1 : 0;
    else {
      const others = r === n ? "right" : r === 0 ? "wrong" : "some";
      t = RULES.taker.find((x) => x.right === !!takerRight && x.others === others).pts;
    }
    return { taker: t * k, members: memberRights.map((ok) => (ok ? 1 : takerRight ? -10 : -5) * k) };
  }
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");

  // ---------- QR code (assets/qrcode.js), drawn as SVG so it stays sharp when projected ----------
  function qrSvg(text) {
    const qr = global.qrcode(0, "M"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), q = 2; // 2-module quiet zone
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + q},${y + q}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" role="img" aria-label="QR code to join" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000054"/></svg>`;
  }

  global.Group = { TAKER_COLOUR, PALETTE, colourName, deviceId, get, post, serverNow, remaining, RULES, points, signed, qrSvg };
})(window);
