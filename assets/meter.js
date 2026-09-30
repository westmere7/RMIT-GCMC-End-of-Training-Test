/* The performance meter: a vibrant arc, red through amber to green and a purple award zone at the top end (which starts
   to glow and shimmer as the needle nears it, and bursts into life the moment the needle touches it), with a straight,
   sprung needle that never quite sits still and leaves a motion trail when it swings.
   setScore(p) moves the rest position (-1 … 1); kick(dir) flicks the needle on each answer; setStats() fills the
   readout under the arc (points, question, streak); pulse(delta, right) marks an answer with a ripple and a points chip
   at the needle tip; setMarks() puts the rest of the room on the arc as small marks that glide (no spring, no bounce).
   The candidate's first name rides on the needle tip; the room's names ride on badges that keep clear of each other. The arc flattens to fit whatever width it's given. */
(function (global) {
  "use strict";
  // drawn on a dark gradient card: light lines and text, bright colours
  const C = { red: "#e61e2a", green: "#12a150", navy: "#000054", award: "#a445ff", awardInk: "#e6ccff", spark: "#ecd2ff",
    up: "#34d77b", down: "#ff5a61", boost: "#fac800", ink: "#ffffff", soft: "rgba(255,255,255,0.64)", faint: "rgba(255,255,255,0.14)", tease: "#cf96ff" };
  const AWARD = [[0, "#d9a6ff"], [0.5, "#a445ff"], [1, "#7a1fd6"]];
  const STOPS = [[0, "#e61e2a"], [0.24, "#ff5b36"], [0.5, "#ffb000"], [0.74, "#6fcf3c"], [1, "#12a150"]]; // left end → right end
  const TEXT = "'Helvetica Neue LT Pro', 'Helvetica Neue', Arial, sans-serif";
  const DISPLAY = "'Museo-RMITVN 700', 'Museo 700', 'Museo', " + TEXT;

  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function colourAt(f) { // the arc's colour at a point along it (0 = left end, 1 = right end)
    f = Math.max(0, Math.min(1, f));
    for (let i = 1; i < STOPS.length; i++) if (f <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], k = (f - a) / (b - a), x = hex(ca), y = hex(cb);
      return `rgb(${x.map((v, j) => Math.round(v + (y[j] - v) * k)).join(",")})`;
    }
    return STOPS[STOPS.length - 1][1];
  }

  function Meter(canvas, lamp, labels) {
    this.c = canvas; this.ctx = canvas && canvas.getContext("2d"); this.lamp = lamp;
    this.labels = labels || {}; this.name = ""; this.p = 0; this.theta = 0; this.vel = 0; this.t = 0; this.last = 0;
    this.stats = null; this.tween = null; this.pulses = []; this.marks = []; this.sparks = []; this.trail = []; this.moves = [];
    this.card = canvas && canvas.closest ? canvas.closest(".meter-card") : null;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize = this.resize.bind(this); this.frame = this.frame.bind(this);
    if (canvas) { addEventListener("resize", this.resize); this.resize(); }
  }
  Meter.prototype.resize = function () {
    const r = this.c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    this.w = Math.max(240, r.width); this.h = Math.max(140, r.height);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // arc through three points: apex at `top`, ends at ±half-chord near the bottom; on a phone it's narrower and thinner
    this.compact = this.w < 600;
    // on a wide screen it's a slice of a bigger circle: wider, the same height, so flatter, and thicker
    this.lw = this.compact ? 22 : 46; // the arc's thickness
    this.nw = this.compact ? 5 : 8; // the needle's
    this.top = this.compact ? 60 : 82; this.ends = this.h - (this.compact ? 34 : 40);
    const half = this.w * (this.compact ? 0.42 : 0.44), sag = Math.max(40, this.ends - this.top);
    this.half = half;
    this.R = (half * half + sag * sag) / (2 * sag);
    this.span = Math.asin(Math.min(0.99, half / this.R));
    this.cx = this.w / 2; this.cy = this.top + this.R;
    this.rr = this.R - this.lw / 2; // the arc's centre line
  };
  // every change of reading, however small, is marked on the arc: the stretch it moved over lights up (green up, red
  // down) and fades, a ghost tick stays where it was for a moment, and a wave of light runs out along the reading
  Meter.prototype.setScore = function (p) {
    p = Math.max(-1, Math.min(1, p));
    if (this.span && Math.abs(p - this.p) > 1e-6 && !this.reduced) {
      this.moves.push({ t0: this.t, from: this.aim(this.p) * this.span, to: this.aim(p) * this.span, up: p > this.p });
      if (this.moves.length > 4) this.moves.shift();
    }
    this.p = p;
  };
  // The award zone: the top of the meter, from the reading `pg` up. `pct` is the editor's setting (95 = the top 5% of
  // the arc). A reading maps straight onto the arc, so the zone on screen is exactly that share of it; inside the zone
  // it runs only a touch slower, so answers there still move the needle almost as far, but a perfect run rests just
  // inside the top end rather than against the stop.
  Meter.prototype.setThreshold = function (pct) { this.pg = Math.max(0.2, Math.min(0.98, 2 * (pct == null ? 95 : pct) / 100 - 1)); };
  Meter.prototype.aim = function (p) { // reading (-1…1) → share of the half-span
    const pg = this.pg || 0.9;
    return p <= 0 ? p * 0.97 : p < pg ? p : pg + (p - pg) * 0.85;
  };
  Meter.prototype.at = function (a, r) { return [this.cx + r * Math.sin(a), this.cy - r * Math.cos(a)]; }; // angle (0 = up) → canvas point
  Meter.prototype.greenPoint = function () { // page coordinates of the middle of the award zone
    const a = this.span * ((this.pg || 0.9) + 1) / 2, r = this.c.getBoundingClientRect(), rr = this.rr;
    return { x: r.left + this.cx + rr * Math.sin(a), y: r.top + this.cy - rr * Math.cos(a) };
  };
  // the needle touches the zone: its edge, not its middle, reaches the zone's line
  Meter.prototype.inGreen = function () { return this.theta + (this.nw || 6) / 2 / (this.rr || 300) >= this.span * (this.pg || 0.9); };
  Meter.prototype.setName = function (n) { this.name = String(n || "").trim(); };
  /** The readout under the arc: { points, answered, total, streak }. */
  Meter.prototype.setStats = function (s) {
    const now = this.pointsNow(), old = this.stats;
    if (s && (!old || s.points !== old.points)) this.tween = { from: old ? now : s.points, to: s.points, t0: performance.now() };
    // the line under the points pops when it changes; a streak growing flashes gold, one ending flashes red
    if (s && old && (s.answered !== old.answered || s.streak !== old.streak)) this.statT = { t0: this.t, streak: s.streak > old.streak ? 1 : s.streak < old.streak ? -1 : 0 };
    // the streak boost (see Assess.meterRun): a new or bigger boost flares its badge; a climb it sped up glows gold
    const boost = (s && s.boost) || 1, was = this.boost || 1;
    if (boost > 1.01 && (was <= 1.01 || (old && s.streak > old.streak && [3, 5].includes(s.streak)))) this.boostT = this.t;
    const mv = this.moves[this.moves.length - 1];
    if (mv && mv.up && boost > 1.01 && this.t - mv.t0 < 0.05) mv.boost = true;
    this.boost = boost;
    this.stats = s;
  };
  // the readout counts up (or down) to a new total over about 0.7s, timed by the clock rather than by frames
  Meter.prototype.pointsNow = function () {
    const tw = this.tween; if (!tw) return this.stats ? this.stats.points : 0;
    const k = this.reduced ? 1 : Math.min(1, (performance.now() - tw.t0) / 700);
    return tw.from + (tw.to - tw.from) * (1 - Math.pow(1 - k, 3));
  };
  /** The rest of the room: [{ id, name, color, initial, p }] with p a reading (−1 … 1). Each mark glides to its place. */
  Meter.prototype.setMarks = function (marks) {
    const old = new Map(this.marks.map((m) => [m.id, m]));
    // a mark whose reading changed sends out a small ring as it sets off
    this.marks = (marks || []).map((m) => {
      const o = old.get(m.id);
      return { ...m, a: o ? o.a : 0, t0: o && Math.abs(o.p - m.p) > 1e-6 ? this.t : o ? o.t0 : null, up: o && Math.abs(o.p - m.p) > 1e-6 ? m.p > o.p : o && o.up };
    });
  };
  /** An answer just landed: a ripple at the needle tip and a points chip that floats up from it. Both are pinned to
      where the needle is heading, and the chip's side is picked once, so they hold still while the needle bounces. */
  Meter.prototype.pulse = function (delta, right) {
    if (this.reduced) return;
    const a = this.aim(this.p) * this.span;
    this.pulses.push({ t0: this.t, delta, right, a, side: a >= 0 ? 1 : -1 });
    // a right answer while in the award zone throws a little shower of sparks from the needle tip
    if (right && this.greenLit && this.rr) { const [x, y] = this.at(a, this.rr); this.burst(x, y, 16, 0.6); }
  };
  /** Sparks flung out from a point (canvas coordinates), away from the arc's centre; `power` scales speed and size. */
  Meter.prototype.burst = function (x, y, n, power) {
    if (this.reduced) return;
    const out = Math.atan2(y - this.cy, x - this.cx), cols = [C.award, C.spark, "#ffffff", "#fac800", "#d9a6ff"];
    for (let i = 0; i < n; i++) {
      const a = out + (Math.random() - 0.5) * 2.6, v = (140 + Math.random() * 340) * power;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: this.t, life: 0.8 + Math.random() * 0.9,
        r: (2 + Math.random() * 3.5) * (0.6 + 0.4 * power), star: Math.random() < 0.45, c: cols[(Math.random() * cols.length) | 0], spin: Math.random() * 6 });
    }
  };
  // the needle has just touched the award zone: shock rings, a surge of light along the arc, sparks and a banner
  Meter.prototype.hit = function () {
    this.hitT = this.t;
    if (this.rr) {
      const zs = this.span * (this.pg || 0.9), [x, y] = this.at(Math.max(zs, this.theta), this.rr);
      this.burst(x, y, 46, 1);
      for (let i = 0; i < 10; i++) { const [sx, sy] = this.at(zs + (this.span - zs) * (i / 9), this.rr); this.burst(sx, sy, 3, 0.55); }
    }
    if (this.card && !this.reduced) { this.card.classList.remove("award-hit"); void this.card.offsetWidth; this.card.classList.add("award-hit"); }
  };
  // flicks towards the end the needle is already near are softened a little, so it doesn't rattle off the stop, but
  // only a little: a right answer up in the award zone still gets a proper flick, like a wrong one does the other way
  Meter.prototype.soften = function (dir) { const e = Math.abs(this.theta) / this.span; return dir * this.theta > 0 ? 1 - 0.35 * smooth(0.8, 1, e) : 1; };
  // on a streak boost, the flick up is a little livelier too
  Meter.prototype.kick = function (dir) { this.vel += dir * (this.reduced ? 0.3 : 1.0) * (this.span / 0.52) * 1.6 * this.soften(dir) * (dir > 0 ? 1 + 0.8 * ((this.boost || 1) - 1) : 1); };
  // a harder bounce now and then: a big flick while the spring goes loose, so the needle swings through
  // a few decaying oscillations; the looseness then fades and the needle is back to its usual steady self
  Meter.prototype.jolt = function (dir) {
    if (this.reduced) return this.kick(dir);
    const k = this.span / 0.52;
    this.looseT = 0; this.joltT = this.t;
    this.vel += dir * k * (2.0 + Math.random() * 0.7) * this.soften(dir);
    if (this.card) { this.card.classList.remove("jolt"); void this.card.offsetWidth; this.card.classList.add("jolt"); }
  };
  Meter.prototype.zone = function (p) {
    const v = p == null ? this.p : p;
    return v <= -1 / 3 ? this.labels.left : v >= 1 / 3 ? this.labels.right : "Too close to call";
  };
  Meter.prototype.start = function () { if (!this.running) { this.running = true; requestAnimationFrame(this.frame); } };
  Meter.prototype.stop = function () { this.running = false; };

  Meter.prototype.frame = function (ts) {
    if (!this.running) return;
    const dt = Math.min(0.05, this.last ? (ts - this.last) / 1000 : 0.016); this.last = ts; this.t += dt;
    const S = this.span, k = S / 0.52, amp = this.reduced ? 0.12 : 1;
    // how close the needle is to either end: 0 in the middle, 1 at the stops (eased, so the middle stays calm);
    // `near` switches on over the last stretch before the ends, where the needle all but settles
    const e = Math.min(1, Math.abs(this.theta) / S), edge = e * e, near = smooth(0.68, 0.88, e);
    // the "signal": a slow, relaxed wobble in the middle that turns into a quicker, finer vibration towards the ends,
    // and only a faint, fast shimmer right at the ends (phase accumulators, so changing speed never makes it jump)
    this.ph = (this.ph || 0) + dt * (1 + 2.4 * edge);
    this.bz = (this.bz || 0) + dt * (31 + 16 * near);
    const ph = this.ph, calm = (1 - 0.55 * edge) * (1 - 0.8 * near);
    const sig = amp * k * (calm * (0.009 * Math.sin(ph * 5.3) + 0.005 * Math.sin(ph * 9.7 + 1.3) + 0.004 * Math.sin(ph * 2.1 + 2))
      + edge * (1 - 0.55 * near) * 0.0035 * Math.sin(this.bz + Math.sin(this.t * 3.1)));
    if (!this.reduced && Math.random() < dt * (0.7 + 1.6 * edge) * (1 - 0.85 * near)) this.vel += (Math.random() - 0.5) * 0.25 * k * calm;
    const target = this.aim(this.p) * S + sig;
    // stiffer (so quicker to bounce back) towards the ends and stiffer still right at them; damping scales with it.
    // (Only somewhat stiffer: much more and a flick near the top would barely show.)
    // After a jolt the spring goes soft and barely damped for about a second, then tightens up over the next two or three.
    let L = 0;
    if (this.looseT != null) { this.looseT += dt; L = this.looseT < 1.1 ? 1 : Math.exp(-(this.looseT - 1.1) / 1.2); if (L < 0.01) this.looseT = null; }
    const stiff = 1 + 1.1 * edge + 0.8 * near;
    const Kn = 90 * stiff, Dn = 11.8 * Math.sqrt(stiff) * (1 + 0.25 * near);
    const K = Kn - (Kn - 56) * L, D = Dn - (Dn - 2) * L;
    const acc = K * (target - this.theta) - D * this.vel;
    this.vel += acc * dt; this.theta += this.vel * dt;
    const lim = S + 0.04;
    if (this.theta > lim) { this.theta = lim; this.vel *= -0.35; }
    if (this.theta < -lim) { this.theta = -lim; this.vel *= -0.35; }
    if (this.lamp) this.lamp.classList.toggle("on", Math.abs(this.vel) > 0.55 * k);
    // the award zone registers the moment the needle touches it (with the reading in it, so a flick that only grazes
    // the line on its way back doesn't count), and lets go once the reading drops out of it
    const earned = this.p >= (this.pg || 0.9);
    if (earned && this.inGreen() && !this.greenLit) { this.greenLit = true; this.hit(); if (this.onGreen) this.onGreen(this.greenPoint()); }
    if (!earned) this.greenLit = false;
    if (this.card && this.cardLit !== !!this.greenLit) { this.cardLit = !!this.greenLit; this.card.classList.toggle("in-award", this.cardLit); }
    this.pulses = this.pulses.filter((p) => this.t - p.t0 < 1.6);
    this.moves = this.moves.filter((m) => this.t - m.t0 < 1.6);
    // sparks fly and fall; the trail keeps where the needle was over the last moment (longer just after a jolt)
    this.sparks = this.sparks.filter((s) => this.t - s.t0 < s.life);
    for (const s of this.sparks) { s.vy += 420 * dt; s.vx *= 1 - 1.6 * dt; s.vy *= 1 - 1.2 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.spin += dt * 5; }
    const jo = this.joltT != null ? Math.max(0, 1 - (this.t - this.joltT) / 1.4) : 0;
    this.trail.push({ t: this.t, th: this.theta });
    while (this.trail.length && this.t - this.trail[0].t > 0.09 + 0.1 * jo) this.trail.shift();
    // the room's marks ease to their places: smooth, no overshoot
    for (const m of this.marks) m.a += (this.aim(m.p) * S - m.a) * (this.reduced ? 1 : Math.min(1, dt * 2.2));
    this.draw();
    requestAnimationFrame(this.frame);
  };

  Meter.prototype.draw = function () {
    const g = this.ctx, w = this.w, cx = this.cx, cy = this.cy, R = this.R, S = this.span, lw = this.lw, rr = this.rr;
    g.clearRect(0, 0, w, this.h);
    const ang = (a) => -Math.PI / 2 + a; // 0 = straight up
    const pt = (a, r) => [cx + r * Math.cos(ang(a)), cy + r * Math.sin(ang(a))];
    const frac = (a) => (a + S) / (2 * S); // 0 at the left end, 1 at the right
    const arc = (a0, a1, r) => { g.beginPath(); g.arc(cx, cy, r == null ? rr : r, ang(a0), ang(a1)); };
    const star = (x, y, r1, fill, turn) => {
      g.fillStyle = fill; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (turn || 0) + (i * Math.PI) / 5, r = i % 2 ? r1 * 0.45 : r1; g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
      g.closePath(); g.fill();
    };
    const grad = g.createLinearGradient(cx - this.half - lw, 0, cx + this.half + lw, 0);
    for (const [o, col] of STOPS) grad.addColorStop(o, col);
    // in the award zone from the moment the needle touches it (see frame)
    const pg = this.pg || 0.9, zs = S * pg, inAward = !!this.greenLit;
    // the tease: 0 while the reading is well short of the award zone, rising to 1 as it reaches the zone's edge
    const tease = inAward ? 1 : this.reduced ? 0 : smooth(zs - S * 0.3, zs, this.aim(this.p) * S);
    const th = Math.max(-S, Math.min(S, this.theta)), here = th >= zs ? C.award : colourAt(frac(th));
    const [hx, hy] = pt(th, rr); // where the needle meets the arc
    // how long since the needle reached the award zone (the entrance show runs for about two and a half seconds)
    const hitAge = this.hitT != null && !this.reduced ? this.t - this.hitT : 99, show = hitAge < 2.6;
    const zmid = (zs + S) / 2, [zx, zy] = pt(zmid, rr);

    // a soft halo of light behind the needle, in the colour it points at (brighter, and breathing, in the award zone)
    // (no wider than the room to the canvas's nearest edge, so it fades out instead of being cut off there)
    const halo = g.createRadialGradient(hx, hy, 0, hx, hy, Math.max(lw * 1.5, Math.min(lw * 6, hx, w - hx, hy + lw * 3, this.h - hy)));
    halo.addColorStop(0, here); halo.addColorStop(1, "rgba(255,255,255,0)");
    g.globalAlpha = inAward ? 0.28 + 0.06 * Math.sin(this.t * 4) + (show ? 0.2 * Math.max(0, 1 - hitAge / 1.2) : 0) : 0.24;
    g.fillStyle = halo; g.fillRect(0, 0, w, this.h); g.globalAlpha = 1;

    // in the award zone: slow-turning rays of purple light fanning out behind the zone (a burst of them on arrival)
    if (inAward && !this.reduced) {
      // (kept short of the canvas edges, so they fade out rather than being cut off)
      const rays = 14, spin = this.t * 0.35, room = Math.max(lw, Math.min(w - zx, zx, zy + lw * 2, this.h - zy) - 4);
      const len = Math.min(room, lw * (6 + (show ? 4 * Math.max(0, 1 - hitAge / 1.5) : 0)));
      const rg = g.createRadialGradient(zx, zy, lw * 0.6, zx, zy, len);
      rg.addColorStop(0, "rgba(207,150,255,0.5)"); rg.addColorStop(1, "rgba(164,69,255,0)");
      g.save(); g.fillStyle = rg; g.globalAlpha = 0.5 + 0.2 * Math.sin(this.t * 2.3) + (show ? 0.5 * Math.max(0, 1 - hitAge / 1.5) : 0);
      g.beginPath();
      for (let i = 0; i < rays; i++) {
        const a = spin + (i * 2 * Math.PI) / rays, wd = 0.09;
        g.moveTo(zx, zy); g.lineTo(zx + len * Math.cos(a - wd), zy + len * Math.sin(a - wd)); g.lineTo(zx + len * Math.cos(a + wd), zy + len * Math.sin(a + wd)); g.closePath();
      }
      g.fill(); g.restore();
    }

    // instrument rings: a hairline outside the arc, and the tick ring inside it
    g.lineWidth = 1; g.strokeStyle = C.faint;
    arc(-S - 0.02, S + 0.02, rr + lw / 2 + 7); g.stroke();
    // the ticks near the needle light up and stretch as it passes, like a scanner following it
    for (let i = 0; i <= 60; i++) {
      const a = -S + (2 * S * i) / 60, major = i % 10 === 0, mid = i % 5 === 0;
      const near = this.reduced ? 0 : Math.max(0, 1 - Math.abs(a - this.theta) / (S * 0.09)), glow = near * near;
      const [x1, y1] = pt(a, rr - lw / 2 - 7), [x2, y2] = pt(a, rr - lw / 2 - (major ? 20 : mid ? 14 : 11) - 9 * glow);
      const base = major ? 0.6 : mid ? 0.36 : 0.18;
      g.strokeStyle = `rgba(255,255,255,${(base + (1 - base) * glow).toFixed(3)})`;
      g.lineWidth = (major ? 2 : 1) + 1.5 * glow;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }

    // the arc: a deep track, the whole scale softly over it, then the reading from the middle out to the needle, glowing
    g.lineCap = "round"; g.lineWidth = lw;
    g.strokeStyle = "rgba(255,255,255,0.08)"; arc(-S, S); g.stroke();
    g.globalAlpha = 0.58; g.strokeStyle = grad; arc(-S, S); g.stroke(); g.globalAlpha = 1;
    if (Math.abs(th) > 0.004) {
      g.save(); g.shadowColor = here; g.shadowBlur = 26; g.strokeStyle = grad;
      arc(Math.min(0, th), Math.max(0, th)); g.stroke(); g.restore();
    }
    // depth: a shine along the outer edge, a shade along the inner one (a glossy tube)
    g.lineWidth = lw * 0.16; g.strokeStyle = "rgba(255,255,255,0.45)"; arc(-S, S, rr + lw * 0.26); g.stroke();
    g.lineWidth = lw * 0.12; g.strokeStyle = "rgba(0,0,0,0.2)"; arc(-S, S, rr - lw * 0.34); g.stroke();
    // each change of reading: the stretch it moved over glows green (up) or red (down) and fades; a ghost tick marks
    // where it was; a wave of light runs from the middle out to the new reading
    for (const mv of this.moves) {
      const age = this.t - mv.t0, k = age / 1.6, col = mv.boost ? C.boost : mv.up ? C.up : C.down;
      const a0 = Math.max(-S, Math.min(S, Math.min(mv.from, mv.to))), a1 = Math.max(-S, Math.min(S, Math.max(mv.from, mv.to)));
      g.save(); g.lineCap = "round"; g.shadowColor = col; g.shadowBlur = 18 * (1 - k);
      g.globalAlpha = 0.85 * (1 - k) * (1 - k); g.lineWidth = lw + 8 * (1 - k); g.strokeStyle = col;
      arc(a0, Math.max(a1, a0 + 0.004)); g.stroke(); g.restore();
      if (age < 1.1) { // the ghost tick, where the reading was
        const [x1, y1] = pt(mv.from, rr - lw / 2 - 4), [x2, y2] = pt(mv.from, rr + lw / 2 + 4);
        g.globalAlpha = 0.8 * (1 - age / 1.1); g.strokeStyle = "#fff"; g.lineWidth = 2; g.lineCap = "round";
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.globalAlpha = 1;
      }
      if (age < 0.6) { // the wave
        const e = age / 0.6, head = mv.to * (1 - Math.pow(1 - e, 2)), wd = S * 0.06, h0 = head - Math.sign(mv.to || 1) * wd;
        g.globalAlpha = 0.7 * (1 - e); g.strokeStyle = "#fff"; g.lineWidth = lw * 0.5; g.lineCap = "round";
        arc(Math.min(head, h0), Math.max(head, h0)); g.stroke(); g.globalAlpha = 1;
      }
    }
    // fine white breaks at the thirds
    g.lineCap = "butt";
    for (const a of [-S / 3, S / 3]) {
      const [x1, y1] = pt(a, rr - lw / 2 - 1), [x2, y2] = pt(a, rr + lw / 2 + 1);
      g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }

    // the award zone: purple, a touch proud of the arc. As the needle nears it, it starts to breathe and shimmer
    // (more the closer it gets); once the reading is in it, it glows, pulses and sparkles
    {
      const [ax, ay] = pt(zs, rr), [bx2, by2] = pt(S, rr), gg = g.createLinearGradient(ax, ay, bx2, by2);
      for (const [o, col] of AWARD) gg.addColorStop(o, col);
      const beat = 0.5 + 0.5 * Math.sin(this.t * (inAward ? 4 : 3 + 4 * tease));
      g.save();
      if (tease > 0) { g.shadowColor = C.award; g.shadowBlur = inAward ? 24 + 12 * beat : tease * (8 + 18 * beat); }
      g.lineCap = "round"; g.lineWidth = lw + 6 + (inAward ? 2 + 3 * beat : 3 * tease * beat); g.strokeStyle = gg; arc(zs + 0.006, S); g.stroke(); g.restore();
      if (show) { // arrival: a surge of light races up the whole arc into the zone, and the zone flashes white
        const k = Math.min(1, hitAge / 0.55);
        if (k < 1) {
          const head = -S + 2 * S * (1 - Math.pow(1 - k, 2)), tail = Math.max(-S, head - S * 0.6);
          g.lineCap = "butt"; g.lineWidth = lw * 0.6;
          for (let i = 0; i < 8; i++) { g.strokeStyle = `rgba(255,255,255,${(((i + 1) / 8) * 0.85).toFixed(3)})`; arc(tail + ((head - tail) * i) / 8, tail + ((head - tail) * (i + 1)) / 8); g.stroke(); }
        }
        const f = Math.max(0, 1 - Math.abs(hitAge - 0.5) / 0.45); // peaks as the surge arrives
        if (f > 0) {
          g.save(); g.shadowColor = "#fff"; g.shadowBlur = 34 * f; g.lineCap = "round"; g.lineWidth = lw + 6 + 12 * f;
          g.strokeStyle = `rgba(255,255,255,${(0.8 * f).toFixed(3)})`; arc(zs + 0.006, S); g.stroke(); g.restore();
        }
      }
      g.lineCap = "round"; g.lineWidth = lw * 0.16; g.strokeStyle = "rgba(255,255,255,0.6)"; arc(zs + 0.01, S, rr + lw * 0.26); g.stroke();
      if (tease > 0.05) { // a shimmer sweeping along the zone, towards the top end
        const k = (this.t * (0.6 + 0.6 * tease)) % 1, a0 = zs + (S - zs) * k, a1 = Math.min(S, a0 + (S - zs) * 0.22);
        g.lineWidth = lw * 0.7; g.strokeStyle = `rgba(255,255,255,${0.55 * tease * Math.sin(k * Math.PI)})`; arc(a0, a1); g.stroke();
      }
      g.lineCap = "butt"; g.strokeStyle = "#fff"; g.lineWidth = 3;
      const [x1, y1] = pt(zs, rr - lw / 2 - 4), [x2, y2] = pt(zs, rr + lw / 2 + 4);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      const twinkles = inAward ? 11 : tease > 0.3 ? 3 : 0; // a few faint ones as it nears, the full show once in
      if (!this.reduced) for (let i = 0; i < twinkles; i++) {
        const k = (this.t * (inAward ? 1.2 : 0.9) + i / twinkles) % 1, a = zs + (S - zs) * ((i * 0.37) % 1), r = rr + (i % 2 ? 1 : -1) * (lw / 2 + 6 + k * (inAward ? 24 : 14));
        const [sx, sy] = pt(a, r); g.globalAlpha = Math.sin(k * Math.PI) * (inAward ? 1 : tease * 0.7);
        star(sx, sy, (inAward ? 4 : 3) + 3 * Math.sin(k * Math.PI), i % 3 === 0 ? "#fff" : i % 2 ? C.spark : C.award); g.globalAlpha = 1;
      }
      // its label: a star and AWARD, just outside the arc
      const mid = (zs + S) / 2, [lx, ly] = pt(mid, rr + lw / 2 + (this.compact ? 16 : 20)), r1 = this.compact ? 5.5 : 7;
      g.save(); g.translate(lx, ly); g.rotate(ang(mid) + Math.PI / 2);
      g.font = `700 ${this.compact ? 10 : 12}px ` + TEXT; g.textAlign = "left"; g.textBaseline = "middle";
      if ("letterSpacing" in g) g.letterSpacing = "1.5px";
      const word = "AWARD", ww = g.measureText(word).width + r1 * 2 + 5, x0 = -ww / 2;
      star(x0 + r1, 0, r1 * (1 + 0.3 * tease * beat), tease > 0 ? C.award : "#c79bf0"); // the star beats as the needle nears
      g.fillStyle = C.awardInk; g.fillText(word, x0 + r1 * 2 + 5, 0.5);
      g.restore();
    }

    // the readout, under the arc: points (counting up), then where we are
    const drop = this.ends - this.top;
    if (this.stats) {
      const st = this.stats, big = this.compact ? 40 : 62, y = this.top + drop * 0.9;
      g.textAlign = "center"; g.textBaseline = "alphabetic";
      if ("letterSpacing" in g) g.letterSpacing = "2.5px";
      g.font = "700 11px " + TEXT; g.fillStyle = C.soft; g.fillText("POINTS", cx, y - big - 4);
      if ("letterSpacing" in g) g.letterSpacing = "0px";
      const val = Math.round(this.pointsNow());
      // a change pops the number and makes it glow while it counts: green for a gain, red for a loss
      const tw = this.tween, tk = tw && tw.to !== tw.from && !this.reduced ? Math.min(1, (performance.now() - tw.t0) / 700) : 1;
      const bump = tk < 1 ? Math.sin(Math.PI * tk) : 0;
      // flat, no depth: each digit rolls into place like a counter as it changes (up for a gain, down for a loss), a
      // light sheen sweeps across now and then, and a bar of the same colour sits underneath, stretching on a change
      const str = signed(val), fsz = Math.round(big * (1 + 0.12 * bump)), dir = tw && tw.to < tw.from ? -1 : 1;
      const base = val > 0 ? C.up : val < 0 ? C.down : C.ink, shine = val > 0 ? "#c8ffe0" : val < 0 ? "#ffd0d3" : "#ffffff";
      g.save(); g.font = `700 ${fsz}px ` + DISPLAY; g.textAlign = "left";
      const chars = [...str], cw = chars.map((ch) => g.measureText(ch).width), tot = cw.reduce((a, b) => a + b, 0), nx0 = cx - tot / 2;
      this.dg = this.dg || [];
      const n = chars.length; // matched from the right, so the units digit is always the units digit
      for (let i = 0; i < n; i++) { const ch = chars[n - 1 - i], st = this.dg[i]; if (!st || st.ch !== ch) this.dg[i] = { ch, prev: st ? st.ch : null, t0: this.reduced || !st ? -9 : this.t, dir }; }
      this.dg.length = n;
      const sh = ((this.t * 0.22) % 1.8) - 0.4, fill = g.createLinearGradient(nx0 - 20, 0, nx0 + tot + 20, 0);
      const sp0 = Math.max(0, Math.min(1, bump ? 0.5 : sh));
      fill.addColorStop(0, base); fill.addColorStop(Math.max(0, sp0 - 0.12), base); fill.addColorStop(sp0, bump ? base : shine); fill.addColorStop(Math.min(1, sp0 + 0.12), base); fill.addColorStop(1, base);
      if (bump) { g.shadowColor = base; g.shadowBlur = 18 * bump; }
      g.beginPath(); g.rect(nx0 - 12, y - fsz * 0.86, tot + 24, fsz * 1.02); g.clip();
      let x = nx0;
      for (let j = 0; j < n; j++) {
        const st = this.dg[n - 1 - j], k = Math.min(1, (this.t - st.t0) / 0.22), e = 1 - Math.pow(1 - k, 3), off = fsz * 0.62;
        g.fillStyle = fill;
        if (k < 1 && st.prev != null) { g.globalAlpha = 1 - e; g.fillText(st.prev, x, y - st.dir * off * e); }
        g.globalAlpha = k < 1 ? e : 1; g.fillText(st.ch, x, y + st.dir * off * (1 - e));
        x += cw[j];
      }
      g.restore();
      { // the bar underneath
        const bw = tot * (0.5 + 0.35 * bump) + 10, bh = this.compact ? 3 : 4, by = y + (this.compact ? 6 : 9);
        g.save(); g.fillStyle = base; g.globalAlpha = 0.85; g.beginPath();
        if (g.roundRect) g.roundRect(cx - bw / 2, by, bw, bh, bh / 2); else g.rect(cx - bw / 2, by, bw, bh);
        g.fill(); g.restore();
      }
      const bits = [`Question ${Math.min(st.total, st.answered + 1)} of ${st.total}`];
      if (st.streak >= 2) bits.push(`${st.streak} in a row`);
      // it pops when it changes, glowing gold as a streak grows (red as one ends)
      const sa = this.statT && !this.reduced ? (this.t - this.statT.t0) / 0.7 : 1, sp = sa < 1 ? Math.sin(Math.PI * sa) : 0;
      g.save();
      if (sp) { const sc = this.statT.streak > 0 ? "#fac800" : this.statT.streak < 0 ? C.down : "#fff"; g.shadowColor = sc; g.shadowBlur = 14 * sp; }
      g.font = `700 ${Math.round(13 * (1 + 0.14 * sp))}px ` + TEXT;
      // the streak boost rides at the end of the line, small and gold (it glows for a moment when it lights or steps up)
      const line = bits.join("   ·   "), boosted = (this.boost || 1) > 1.01, bt = boosted ? `   ·   ×${+this.boost.toFixed(2)} boost` : "";
      const ly = y + (this.compact ? 20 : 26), lw1 = g.measureText(line).width, lw2 = bt ? g.measureText(bt).width : 0, x0 = cx - (lw1 + lw2) / 2;
      g.textAlign = "left";
      g.fillStyle = sp && this.statT.streak > 0 ? `rgba(255,236,160,${(0.64 + 0.36 * sp).toFixed(3)})` : C.soft;
      g.fillText(line, x0, ly);
      if (bt) {
        const fa = this.boostT != null && !this.reduced ? this.t - this.boostT : 9, flare = fa < 0.9 ? Math.sin(Math.PI * Math.min(1, fa / 0.9)) : 0;
        g.shadowColor = C.boost; g.shadowBlur = 10 * flare; g.fillStyle = `rgba(250,200,0,${(0.8 + 0.2 * flare).toFixed(3)})`;
        g.fillText(bt, x0 + lw1, ly);
      }
      g.restore();
      if (tease > 0.35) { // the tease, in words
        g.save();
        g.globalAlpha = inAward ? 1 : 0.55 + 0.45 * Math.sin(this.t * 5);
        if (inAward) { g.shadowColor = C.award; g.shadowBlur = 10 + 6 * Math.sin(this.t * 4); }
        g.font = "700 12px " + TEXT; g.fillStyle = inAward ? C.awardInk : C.tease; if ("letterSpacing" in g) g.letterSpacing = "1.5px";
        g.fillText(inAward ? "✦ IN THE AWARD ZONE ✦" : "✦ AWARD ZONE IN REACH ✦", cx, y + (this.compact ? 38 : 48));
        if ("letterSpacing" in g) g.letterSpacing = "0px";
        g.restore();
      }
    }
    // arrival: AWARD ZONE! springs up between the arc and the points, glows, then fades out
    if (show && this.stats) {
      const k = Math.min(1, hitAge / 0.5), c1 = 2.4, pop = 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); // from nothing, overshoot, settle
      const fade = hitAge < 1.9 ? 1 : Math.max(0, 1 - (hitAge - 1.9) / 0.7), by = this.top + drop * (this.compact ? 0.3 : 0.34);
      const fs = (this.compact ? 22 : 34) * Math.max(0.1, pop);
      g.save(); g.globalAlpha = fade * Math.min(1, hitAge / 0.12);
      g.textAlign = "center"; g.textBaseline = "middle"; g.font = `700 ${Math.round(fs)}px ` + DISPLAY;
      if ("letterSpacing" in g) g.letterSpacing = this.compact ? "1px" : "2px";
      const tg = g.createLinearGradient(cx - 120, 0, cx + 120, 0), sh = (hitAge * 0.9) % 1; // a glint runs across it
      tg.addColorStop(0, "#d9a6ff"); tg.addColorStop(Math.max(0, sh - 0.12), "#e6ccff"); tg.addColorStop(sh, "#ffffff"); tg.addColorStop(Math.min(1, sh + 0.12), "#e6ccff"); tg.addColorStop(1, "#d9a6ff");
      g.lineJoin = "round"; g.lineWidth = this.compact ? 5 : 7; g.strokeStyle = "rgba(20,6,70,0.85)"; g.strokeText("AWARD ZONE!", cx, by); // dark rim, so it reads over the arc
      g.shadowColor = C.award; g.shadowBlur = 24; g.fillStyle = tg; g.fillText("AWARD ZONE!", cx, by);
      if ("letterSpacing" in g) g.letterSpacing = "0px";
      g.restore();
    }

    // the taker's name tag rides on the needle tip (drawn last, on top); worked out here so the room's badges can keep clear of it
    const tag = (() => {
      if (!this.name) return null;
      g.font = "700 13px " + TEXT;
      const pw = g.measureText(this.name).width + 24, ph = 26, [tx, ty] = pt(this.theta, rr + lw / 2 + 12);
      return { pw, ph, tx, x: Math.max(pw / 2 + 4, Math.min(w - pw / 2 - 4, tx)), y: Math.max(ph / 2 + 2, ty - 20) };
    })();

    // the rest of the room: a small mark each on the arc (their colour and initial), linked to a name badge. Badges never
    // overlap each other, the taker's tag, the needle or the award label: each takes the nearest free spot. What they
    // avoid only moves when an answer lands (never with the needle's wobble), so the badges stay put in between
    if (this.marks.length) {
      const r = this.compact ? 7 : 10, fs = this.compact ? 10 : 12, bh = this.compact ? 18 : 22;
      const boxes = [], hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
      // the taker's tag and needle are avoided where the needle settles, not where it wobbles to, with room for the
      // wobble: otherwise a nearby badge would hop back and forth with every flick
      const rest = this.aim(this.p) * S, [rtx, rty] = pt(rest, rr + lw / 2 + 12), wob = 14;
      if (tag) {
        const x = Math.max(tag.pw / 2 + 4, Math.min(w - tag.pw / 2 - 4, rtx)), y = Math.max(tag.ph / 2 + 2, rty - 20);
        boxes.push({ x: x - tag.pw / 2 - wob, y: y - tag.ph / 2 - 6, w: tag.pw + 2 * wob, h: tag.ph + 16 });
      }
      { const mid = (zs + S) / 2, [lx, ly] = pt(mid, rr + lw / 2 + (this.compact ? 16 : 20)); boxes.push({ x: lx - 38, y: ly - 13, w: 76, h: 26 }); }
      { // and the needle itself, from the arc down to where it fades out
        const [ix, iy] = pt(rest, rr - drop * 0.4), [sx, sy] = pt(rest, rr), pad = lw / 2 + wob;
        boxes.push({ x: Math.min(sx, ix) - pad, y: Math.min(sy, iy) - pad, w: Math.abs(sx - ix) + 2 * pad, h: Math.abs(sy - iy) + 2 * pad });
      }
      // spots to try, nearest first: rows outwards from the arc, each also a step or two to either side (a crowd at the
      // same reading fans out sideways instead of stacking off the top), then rows inside the arc
      const spots = [];
      for (const ring of [0, 1]) for (const side of [0, -1, 1, -2, 2]) spots.push([ring, side]);
      for (const ring of [-1, -2]) for (const side of [0, -1, 1]) spots.push([ring, side]);
      g.font = `700 ${fs}px ` + TEXT;
      for (const m of [...this.marks].sort((x, y) => x.a - y.a)) {
        const a = Math.max(-S, Math.min(S, m.a)), [mx, my] = pt(a, rr), bw = g.measureText(m.name || "").width + 18;
        const at = ([ring, side]) => {
          const d = ring >= 0 ? rr + lw / 2 + bh / 2 + 10 + ring * (bh + 5) : rr - lw / 2 - 28 - (-ring - 1) * (bh + 5) - bh / 2;
          const [x0, y0] = pt(a, d), x = x0 - bw / 2 + side * (bw + 6);
          return { x: Math.max(4, Math.min(w - bw - 4, x)), y: Math.max(2, Math.min(this.h - bh - 2, y0 - bh / 2)), w: bw, h: bh };
        };
        let box = null;
        for (const spot of spots) { const b = at(spot); if (!hit(b)) { box = b; m.spot = spot; break; } }
        if (!box) box = at(m.spot || spots[0]); // nowhere free (a very full room): the last spot it had
        boxes.push(box);
        const bx0 = box.x + box.w / 2, by0 = box.y + box.h / 2;
        // the link from the mark to its badge
        g.strokeStyle = m.color; g.globalAlpha = 0.6; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(mx, my); g.lineTo(bx0, by0); g.stroke(); g.globalAlpha = 1;
        // a ring off the mark as its reading changes
        const ma = m.t0 != null && !this.reduced ? this.t - m.t0 : 9;
        if (ma < 0.9) {
          g.strokeStyle = m.up ? C.up : C.down; g.globalAlpha = 0.9 * (1 - ma / 0.9); g.lineWidth = 3;
          g.beginPath(); g.arc(mx, my, r + (ma / 0.9) * 24, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
        }
        // the mark, on the arc
        g.save(); g.shadowColor = "rgba(0,0,40,0.35)"; g.shadowBlur = 6; g.shadowOffsetY = 1.5;
        g.fillStyle = m.color; g.beginPath(); g.arc(mx, my, r, 0, Math.PI * 2); g.fill(); g.restore();
        g.lineWidth = 2; g.strokeStyle = "#fff"; g.stroke();
        g.fillStyle = "#fff"; g.font = `700 ${Math.round(r * 1.1)}px ` + DISPLAY; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(m.initial || "", mx, my + 1);
        // the badge, like the taker's tag but smaller and in their colour
        g.save(); g.shadowColor = "rgba(0,0,40,0.28)"; g.shadowBlur = 6; g.shadowOffsetY = 1.5;
        g.fillStyle = m.color; g.beginPath();
        if (g.roundRect) g.roundRect(box.x, box.y, box.w, box.h, box.h / 2); else g.rect(box.x, box.y, box.w, box.h);
        g.fill(); g.restore();
        g.fillStyle = "#fff"; g.font = `700 ${fs}px ` + TEXT; g.fillText(m.name || "", bx0, by0 + 1);
      }
    }

    // the needle: a straight, even bar like a gauge pointer, from deep inside the arc out past its outer edge, with a
    // rounded tip, fading out towards the (unseen) pivot. White with a dark edge, glowing in the colour it points at,
    // and an index line of that colour where it crosses the arc.
    const tipR = rr + lw / 2 + 10, baseR = rr - drop * 0.5, nw = this.nw;
    const needle = (a, width, fill, edge) => {
      const [x1, y1] = pt(a, baseR), [x2, y2] = pt(a, tipR), grd = (col, k, op) => {
        const lg = g.createLinearGradient(x1, y1, x2, y2);
        lg.addColorStop(0, `rgba(${col},0)`); lg.addColorStop(k, `rgba(${col},${op})`); lg.addColorStop(1, `rgba(${col},${op})`);
        return lg;
      };
      g.lineCap = "round"; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
      if (edge) { g.lineWidth = width + 3; g.strokeStyle = grd("0,0,40", 0.45, 0.55); g.stroke(); }
      g.lineWidth = width; g.strokeStyle = grd(fill, 0.4, 1); g.stroke();
    };
    // motion: while the needle swings it leaves ghosts of itself, a comet tail along the arc and speed lines past the
    // tip; all of it scales with the needle's speed, and runs longer and brighter just after a big bounce
    if (!this.reduced && this.trail.length > 1) {
      const k = S / 0.52, jo = this.joltT != null ? Math.max(0, 1 - (this.t - this.joltT) / 1.4) : 0;
      const amt = Math.min(1, (Math.abs(this.vel) / (1.3 * k)) * (1 + 0.8 * jo)), dir = Math.sign(this.vel) || 1;
      if (amt > 0.05) {
        const tr = this.trail, n = tr.length, a0 = Math.max(-S, Math.min(S, tr[0].th));
        // ghosts, the oldest faintest
        for (let i = 0; i < n - 1; i += Math.max(1, Math.floor(n / 6))) {
          g.globalAlpha = amt * (0.08 + 0.28 * (i / n)); needle(tr[i].th, nw, "255,255,255", false);
        }
        g.globalAlpha = 1;
        // the comet tail on the arc, from where it was to where it is
        if (Math.abs(th - a0) > 0.005) {
          g.lineCap = "butt"; g.lineWidth = lw * 0.62;
          for (let i = 0; i < 8; i++) {
            g.strokeStyle = `rgba(255,255,255,${(amt * 0.55 * ((i + 1) / 8)).toFixed(3)})`;
            const b0 = a0 + ((th - a0) * i) / 8, b1 = a0 + ((th - a0) * (i + 1)) / 8; arc(Math.min(b0, b1), Math.max(b0, b1)); g.stroke();
          }
        }
        // speed lines just outside the arc, trailing the tip
        g.lineCap = "round"; g.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const len = (0.05 + 0.1 * amt) * S * (1 - i * 0.25), r = rr + lw / 2 + 12 + i * 7, gap = 0.01 + i * 0.012;
          const e0 = th - dir * gap, e1 = th - dir * (gap + len);
          g.strokeStyle = `rgba(255,255,255,${(amt * (0.6 - i * 0.15)).toFixed(3)})`; arc(Math.min(e0, e1), Math.max(e0, e1), r); g.stroke();
          const r2 = rr - lw / 2 - 12 - i * 7; arc(Math.min(e0, e1), Math.max(e0, e1), r2); g.globalAlpha = 0.6; g.stroke(); g.globalAlpha = 1;
        }
      }
    }
    g.save(); g.shadowColor = here; g.shadowBlur = inAward ? 20 + 10 * Math.sin(this.t * 4) : 14;
    needle(this.theta, nw, "255,255,255", true); g.restore();
    { // the index line of colour, across the arc
      const [x1, y1] = pt(this.theta, rr - lw / 2 - 2), [x2, y2] = pt(this.theta, tipR - 1);
      g.lineCap = "round"; g.lineWidth = Math.max(2, nw * 0.38); g.strokeStyle = here;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }

    // each answer: a ripple where the needle is heading, and its points floating straight up beside it
    for (const p of this.pulses) {
      const age = this.t - p.t0, col = p.right ? C.green : C.red, [rx, ry] = pt(p.a, rr);
      if (age < 0.9) {
        const k = age / 0.9;
        g.strokeStyle = col; g.globalAlpha = (1 - k) * 0.8; g.lineWidth = 4;
        g.beginPath(); g.arc(rx, ry, lw / 2 + k * 56, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      }
      const rise = 1 - Math.pow(1 - Math.min(1, age / 1.2), 3), fade = age < 1.1 ? 1 : 1 - (age - 1.1) / 0.5;
      const label = p.delta == null ? (p.right ? "✓" : "✕") : signed(p.delta);
      g.font = `700 ${this.compact ? 17 : 22}px ` + DISPLAY;
      const tw = g.measureText(label).width + 22, chh = this.compact ? 28 : 34;
      const [tx, ty] = pt(p.a, rr + lw / 2 + 30), lift = rise * 26;
      const cxp = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, tx + p.side * 58)), cyp = Math.max(chh / 2 + 2, ty - lift);
      g.globalAlpha = Math.max(0, fade);
      g.save(); g.shadowColor = col; g.shadowBlur = 12;
      g.fillStyle = col; g.beginPath();
      if (g.roundRect) g.roundRect(cxp - tw / 2, cyp - chh / 2, tw, chh, chh / 2); else g.rect(cxp - tw / 2, cyp - chh / 2, tw, chh);
      g.fill(); g.restore();
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, cxp, cyp + 1);
      g.globalAlpha = 1;
    }

    // arrival in the award zone: shock rings from the needle tip, one after another
    if (show) for (let i = 0; i < 3; i++) {
      const age = hitAge - i * 0.16; if (age <= 0 || age > 1.1) continue;
      const k = age / 1.1, e = 1 - Math.pow(1 - k, 3);
      g.strokeStyle = i === 1 ? "#fff" : C.award; g.globalAlpha = (1 - k) * 0.9; g.lineWidth = 5 * (1 - k) + 1;
      g.beginPath(); g.arc(hx, hy, lw / 2 + e * (this.compact ? 110 : 170), 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
    }
    // sparks: little stars and dots that fly out, tumble and fade
    for (const s of this.sparks) {
      const k = (this.t - s.t0) / s.life;
      g.globalAlpha = Math.max(0, 1 - k * k);
      if (s.star) star(s.x, s.y, s.r * 1.6, s.c, s.spin); else { g.fillStyle = s.c; g.beginPath(); g.arc(s.x, s.y, s.r * (1 - 0.5 * k), 0, Math.PI * 2); g.fill(); }
    }
    g.globalAlpha = 1;

    // the candidate's first name, riding on the needle tip
    if (tag) {
      g.font = "700 13px " + TEXT; g.textAlign = "center"; g.textBaseline = "middle";
      g.save(); g.shadowColor = "rgba(0,0,40,0.3)"; g.shadowBlur = 8; g.shadowOffsetY = 2;
      g.fillStyle = "#fff"; g.beginPath();
      if (g.roundRect) g.roundRect(tag.x - tag.pw / 2, tag.y - tag.ph / 2, tag.pw, tag.ph, tag.ph / 2); else g.rect(tag.x - tag.pw / 2, tag.y - tag.ph / 2, tag.pw, tag.ph);
      g.fill(); g.restore();
      g.fillStyle = "#fff"; g.beginPath(); g.moveTo(tag.tx - 5, tag.y + tag.ph / 2 - 1); g.lineTo(tag.tx + 5, tag.y + tag.ph / 2 - 1); g.lineTo(tag.tx, tag.y + tag.ph / 2 + 6); g.closePath(); g.fill();
      g.fillStyle = C.navy; g.fillText(this.name, tag.x, tag.y + 1);
    }
  };

  global.Meter = Meter;
})(window);
