/* The performance meter: a vibrant arc, red through amber to green and a gold award zone at the top end, with a sprung
   needle that never quite sits still.
   setScore(p) moves the rest position (-1 … 1); kick(dir) flicks the needle on each answer; setStats() fills the
   readout under the arc (points, question, streak); pulse(delta, right) marks an answer with a ripple and a points chip
   at the needle tip. The candidate's first name rides on the needle tip. The arc flattens to fit whatever width it's given. */
(function (global) {
  "use strict";
  const C = { red: "#e61e2a", green: "#12a150", navy: "#000054", track: "#e8e9f0", muted: "#6b6b8a", tick: "#b9bacd", gold: "#f5b400", goldInk: "#9a6a00" };
  const GOLD = [[0, "#ffe07a"], [0.5, "#f5b400"], [1, "#e08e00"]];
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
    this.stats = null; this.tween = null; this.pulses = [];
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
    this.lw = this.compact ? 22 : 34; // the arc's thickness
    this.top = this.compact ? 60 : 78; this.ends = this.h - (this.compact ? 26 : 30);
    const half = this.w * (this.compact ? 0.42 : 0.36), sag = Math.max(40, this.ends - this.top);
    this.half = half;
    this.R = (half * half + sag * sag) / (2 * sag);
    this.span = Math.asin(Math.min(0.99, half / this.R));
    this.cx = this.w / 2; this.cy = this.top + this.R;
    this.rr = this.R - this.lw / 2; // the arc's centre line
  };
  Meter.prototype.setScore = function (p) { this.p = Math.max(-1, Math.min(1, p)); };
  // The award zone: the top of the meter, from the reading `pg` up. `pct` is the editor's setting (95 = the top 5% of
  // the arc). A reading maps straight onto the arc, so the zone on screen is exactly that share of it; inside the zone
  // it runs a little slower, so a perfect run sits well inside it rather than against the stop.
  Meter.prototype.setThreshold = function (pct) { this.pg = Math.max(0.2, Math.min(0.98, 2 * (pct == null ? 95 : pct) / 100 - 1)); };
  Meter.prototype.aim = function (p) { // reading (-1…1) → share of the half-span
    const pg = this.pg || 0.9;
    if (p <= 0) return p * 0.97;
    if (p < pg) return p;
    return pg + (p - pg) * 0.6;
  };
  Meter.prototype.greenPoint = function () { // page coordinates of the middle of the award zone
    const a = this.span * ((this.pg || 0.9) + 1) / 2, r = this.c.getBoundingClientRect(), rr = this.rr;
    return { x: r.left + this.cx + rr * Math.sin(a), y: r.top + this.cy - rr * Math.cos(a) };
  };
  Meter.prototype.inGreen = function () { return this.theta >= this.span * (this.pg || 0.9); };
  Meter.prototype.setName = function (n) { this.name = String(n || "").trim(); };
  /** The readout under the arc: { points, answered, total, streak }. */
  Meter.prototype.setStats = function (s) {
    const now = this.pointsNow();
    if (s && (!this.stats || s.points !== this.stats.points)) this.tween = { from: this.stats ? now : s.points, to: s.points, t0: performance.now() };
    this.stats = s;
  };
  // the readout counts up (or down) to a new total over about 0.7s, timed by the clock rather than by frames
  Meter.prototype.pointsNow = function () {
    const tw = this.tween; if (!tw) return this.stats ? this.stats.points : 0;
    const k = this.reduced ? 1 : Math.min(1, (performance.now() - tw.t0) / 700);
    return tw.from + (tw.to - tw.from) * (1 - Math.pow(1 - k, 3));
  };
  /** An answer just landed: a ripple at the needle tip and a points chip that floats up from it. */
  Meter.prototype.pulse = function (delta, right) { if (this.reduced) return; this.pulses.push({ t0: this.t, delta, right }); };
  // flicks towards the end the needle is already near are softened, so it can hold the green (or the red) instead of rattling off the stop
  Meter.prototype.soften = function (dir) { const e = Math.abs(this.theta) / this.span; return dir * this.theta > 0 ? 1 - 0.75 * smooth(0.6, 0.9, e) : 1; };
  Meter.prototype.kick = function (dir) { this.vel += dir * (this.reduced ? 0.3 : 1.0) * (this.span / 0.52) * 1.6 * this.soften(dir); };
  // a harder bounce now and then: a big flick while the spring goes loose, so the needle swings through
  // a few decaying oscillations; the looseness then fades and the needle is back to its usual steady self
  Meter.prototype.jolt = function (dir) {
    if (this.reduced) return this.kick(dir);
    const k = this.span / 0.52;
    this.looseT = 0;
    this.vel += dir * k * (2.0 + Math.random() * 0.7) * this.soften(dir);
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
    // After a jolt the spring goes soft and barely damped for about a second, then tightens up over the next two or three.
    let L = 0;
    if (this.looseT != null) { this.looseT += dt; L = this.looseT < 1.1 ? 1 : Math.exp(-(this.looseT - 1.1) / 1.2); if (L < 0.01) this.looseT = null; }
    const stiff = 1 + 1.6 * edge + 1.4 * near;
    const Kn = 90 * stiff, Dn = 11.8 * Math.sqrt(stiff) * (1 + 0.25 * near);
    const K = Kn - (Kn - 56) * L, D = Dn - (Dn - 2) * L;
    const acc = K * (target - this.theta) - D * this.vel;
    this.vel += acc * dt; this.theta += this.vel * dt;
    const lim = S + 0.04;
    if (this.theta > lim) { this.theta = lim; this.vel *= -0.35; }
    if (this.theta < -lim) { this.theta = -lim; this.vel *= -0.35; }
    if (this.lamp) this.lamp.classList.toggle("on", Math.abs(this.vel) > 0.55 * k);
    const earned = this.p >= (this.pg || 0.9);
    if (earned && this.inGreen() && !this.greenLit) { this.greenLit = true; if (this.onGreen) this.onGreen(this.greenPoint()); }
    if (!earned) this.greenLit = false;
    this.pulses = this.pulses.filter((p) => this.t - p.t0 < 1.6);
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
    const grad = g.createLinearGradient(cx - this.half - lw, 0, cx + this.half + lw, 0);
    for (const [o, col] of STOPS) grad.addColorStop(o, col);
    const pg = this.pg || 0.9, zs = S * pg, inAward = this.p >= pg;
    const th = Math.max(-S, Math.min(S, this.theta)), here = th >= zs ? C.gold : colourAt(frac(th));
    const [hx, hy] = pt(th, rr); // where the needle meets the arc

    // a soft halo of light behind the needle, in the colour it points at
    const halo = g.createRadialGradient(hx, hy, 0, hx, hy, lw * 6);
    halo.addColorStop(0, here); halo.addColorStop(1, "rgba(255,255,255,0)");
    g.globalAlpha = 0.16; g.fillStyle = halo; g.fillRect(0, 0, w, this.h); g.globalAlpha = 1;

    // instrument rings: a hairline outside the arc, and the tick ring inside it
    g.lineWidth = 1; g.strokeStyle = "rgba(0,0,84,0.12)";
    arc(-S - 0.02, S + 0.02, rr + lw / 2 + 7); g.stroke();
    for (let i = 0; i <= 60; i++) {
      const a = -S + (2 * S * i) / 60, major = i % 10 === 0, mid = i % 5 === 0;
      const [x1, y1] = pt(a, rr - lw / 2 - 7), [x2, y2] = pt(a, rr - lw / 2 - (major ? 20 : mid ? 14 : 11));
      g.strokeStyle = major ? "#6b6b8a" : mid ? "#9a9bb6" : "#c9cad9"; g.lineWidth = major ? 2 : 1;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }

    // the arc: a deep track, the whole scale softly over it, then the reading from the middle out to the needle, glowing
    g.lineCap = "round"; g.lineWidth = lw;
    g.strokeStyle = "#e7e8f0"; arc(-S, S); g.stroke();
    g.globalAlpha = 0.42; g.strokeStyle = grad; arc(-S, S); g.stroke(); g.globalAlpha = 1;
    if (Math.abs(th) > 0.004) {
      g.save(); g.shadowColor = here; g.shadowBlur = 26; g.strokeStyle = grad;
      arc(Math.min(0, th), Math.max(0, th)); g.stroke(); g.restore();
    }
    // depth: a shine along the outer edge, a shade along the inner one (a glossy tube)
    g.lineWidth = lw * 0.16; g.strokeStyle = "rgba(255,255,255,0.45)"; arc(-S, S, rr + lw * 0.26); g.stroke();
    g.lineWidth = lw * 0.12; g.strokeStyle = "rgba(0,0,84,0.08)"; arc(-S, S, rr - lw * 0.34); g.stroke();
    // fine white breaks at the thirds
    g.lineCap = "butt";
    for (const a of [-S / 3, S / 3]) {
      const [x1, y1] = pt(a, rr - lw / 2 - 1), [x2, y2] = pt(a, rr + lw / 2 + 1);
      g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }

    // the award zone: gold, a touch proud of the arc; glowing, pulsing and sparkling once the reading is in it
    {
      const [ax, ay] = pt(zs, rr), [bx2, by2] = pt(S, rr), gg = g.createLinearGradient(ax, ay, bx2, by2);
      for (const [o, col] of GOLD) gg.addColorStop(o, col);
      g.save();
      if (inAward) { g.shadowColor = C.gold; g.shadowBlur = 24 + 10 * Math.sin(this.t * 4); }
      g.lineCap = "round"; g.lineWidth = lw + 6; g.strokeStyle = gg; arc(zs + 0.006, S); g.stroke(); g.restore();
      g.lineCap = "round"; g.lineWidth = lw * 0.16; g.strokeStyle = "rgba(255,255,255,0.6)"; arc(zs + 0.01, S, rr + lw * 0.26); g.stroke();
      g.lineCap = "butt"; g.strokeStyle = "#fff"; g.lineWidth = 3;
      const [x1, y1] = pt(zs, rr - lw / 2 - 4), [x2, y2] = pt(zs, rr + lw / 2 + 4);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      const star = (x, y, r1, fill) => {
        g.fillStyle = fill; g.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? r1 * 0.45 : r1; g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
        g.closePath(); g.fill();
      };
      if (inAward && !this.reduced) for (let i = 0; i < 6; i++) { // twinkles around the zone
        const k = (this.t * 0.9 + i / 6) % 1, a = zs + (S - zs) * ((i * 0.37) % 1), r = rr + (i % 2 ? 1 : -1) * (lw / 2 + 6 + k * 14);
        const [sx, sy] = pt(a, r); g.globalAlpha = Math.sin(k * Math.PI); star(sx, sy, 3 + 3 * Math.sin(k * Math.PI), "#ffd24a"); g.globalAlpha = 1;
      }
      // its label: a star and AWARD, just outside the arc
      const mid = (zs + S) / 2, [lx, ly] = pt(mid, rr + lw / 2 + (this.compact ? 16 : 20)), r1 = this.compact ? 5.5 : 7;
      g.save(); g.translate(lx, ly); g.rotate(ang(mid) + Math.PI / 2);
      g.font = `700 ${this.compact ? 10 : 12}px ` + TEXT; g.textAlign = "left"; g.textBaseline = "middle";
      if ("letterSpacing" in g) g.letterSpacing = "1.5px";
      const word = "AWARD", ww = g.measureText(word).width + r1 * 2 + 5, x0 = -ww / 2;
      star(x0 + r1, 0, r1, inAward ? C.gold : "#e3b23c");
      g.fillStyle = C.goldInk; g.fillText(word, x0 + r1 * 2 + 5, 0.5);
      g.restore();
    }

    // the readout, under the arc: points (counting up), then where we are
    const drop = this.ends - this.top;
    if (this.stats) {
      const st = this.stats, big = this.compact ? 40 : 62, y = this.top + drop * 0.9;
      g.textAlign = "center"; g.textBaseline = "alphabetic";
      if ("letterSpacing" in g) g.letterSpacing = "2.5px";
      g.font = "700 11px " + TEXT; g.fillStyle = C.muted; g.fillText("POINTS", cx, y - big - 4);
      if ("letterSpacing" in g) g.letterSpacing = "0px";
      const val = Math.round(this.pointsNow());
      g.font = `700 ${big}px ` + DISPLAY; g.fillStyle = val > 0 ? C.green : val < 0 ? C.red : C.navy;
      g.fillText(signed(val), cx, y);
      const bits = [`Question ${Math.min(st.total, st.answered + 1)} of ${st.total}`];
      if (st.streak >= 2) bits.push(`${st.streak} in a row`);
      g.font = "700 13px " + TEXT; g.fillStyle = C.muted;
      g.fillText(bits.join("   ·   "), cx, y + (this.compact ? 20 : 26));
    }

    // the needle: bold and tapered, outlined in white, glowing in the colour it points at
    const inner = rr - drop * 0.3, [nx, ny] = pt(this.theta, rr + lw / 2 + 8), [bx, by] = pt(this.theta, inner);
    const px = Math.cos(ang(this.theta) + Math.PI / 2), py = Math.sin(ang(this.theta) + Math.PI / 2), wb = this.compact ? 4.5 : 7;
    const ng = g.createLinearGradient(bx, by, nx, ny);
    ng.addColorStop(0, "rgba(0,0,84,0)"); ng.addColorStop(0.3, C.navy); ng.addColorStop(1, C.navy);
    g.save(); g.shadowColor = here; g.shadowBlur = 16;
    g.beginPath(); g.moveTo(bx + px * wb, by + py * wb); g.lineTo(nx, ny); g.lineTo(bx - px * wb, by - py * wb); g.closePath();
    g.fillStyle = ng; g.fill(); g.restore();
    g.lineWidth = 1.5; g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineJoin = "round"; g.stroke();
    // the bead: a white ring with a jewel of colour and a glint
    g.save(); g.shadowColor = "rgba(0,0,40,0.35)"; g.shadowBlur = 8; g.shadowOffsetY = 2;
    g.fillStyle = "#fff"; g.beginPath(); g.arc(hx, hy, lw / 2 - 1, 0, Math.PI * 2); g.fill(); g.restore();
    const jewel = g.createRadialGradient(hx - lw * 0.12, hy - lw * 0.12, 1, hx, hy, lw / 2 - 5);
    jewel.addColorStop(0, "#fff"); jewel.addColorStop(0.25, here); jewel.addColorStop(1, here);
    g.fillStyle = jewel; g.beginPath(); g.arc(hx, hy, Math.max(3, lw / 2 - 5), 0, Math.PI * 2); g.fill();

    // each answer: a ripple from the bead, and its points floating up from the tip
    for (const p of this.pulses) {
      const age = this.t - p.t0, col = p.right ? C.green : C.red;
      if (age < 0.9) {
        const k = age / 0.9;
        g.strokeStyle = col; g.globalAlpha = (1 - k) * 0.8; g.lineWidth = 4;
        g.beginPath(); g.arc(hx, hy, lw / 2 + k * 56, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      }
      const rise = 1 - Math.pow(1 - Math.min(1, age / 1.2), 3), fade = age < 1.1 ? 1 : 1 - (age - 1.1) / 0.5;
      const label = p.delta == null ? (p.right ? "✓" : "✕") : signed(p.delta);
      g.font = `700 ${this.compact ? 17 : 22}px ` + DISPLAY;
      const tw = g.measureText(label).width + 22, chh = this.compact ? 28 : 34;
      const [tx, ty] = pt(this.theta, rr + lw / 2 + 30 + rise * 26);
      const cxp = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, tx + (this.theta >= 0 ? 58 : -58))), cyp = Math.max(chh / 2 + 2, ty);
      g.globalAlpha = Math.max(0, fade);
      g.save(); g.shadowColor = col; g.shadowBlur = 12;
      g.fillStyle = col; g.beginPath();
      if (g.roundRect) g.roundRect(cxp - tw / 2, cyp - chh / 2, tw, chh, chh / 2); else g.rect(cxp - tw / 2, cyp - chh / 2, tw, chh);
      g.fill(); g.restore();
      g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, cxp, cyp + 1);
      g.globalAlpha = 1;
    }

    // the candidate's first name, riding on the needle tip
    if (this.name) {
      g.font = "700 13px " + TEXT; g.textAlign = "center"; g.textBaseline = "middle";
      const tw = g.measureText(this.name).width, pw = tw + 24, ph = 26;
      const [tx, ty] = pt(this.theta, rr + lw / 2 + 12);
      const pxx = Math.max(pw / 2 + 4, Math.min(w - pw / 2 - 4, tx)), pyy = Math.max(ph / 2 + 2, ty - 20);
      g.save(); g.shadowColor = "rgba(0,0,40,0.3)"; g.shadowBlur = 8; g.shadowOffsetY = 2;
      g.fillStyle = C.navy; g.beginPath();
      if (g.roundRect) g.roundRect(pxx - pw / 2, pyy - ph / 2, pw, ph, ph / 2); else g.rect(pxx - pw / 2, pyy - ph / 2, pw, ph);
      g.fill(); g.restore();
      g.fillStyle = C.navy; g.beginPath(); g.moveTo(tx - 5, pyy + ph / 2 - 1); g.lineTo(tx + 5, pyy + ph / 2 - 1); g.lineTo(tx, pyy + ph / 2 + 6); g.closePath(); g.fill();
      g.fillStyle = "#fff"; g.fillText(this.name, pxx, pyy + 1);
    }
  };

  global.Meter = Meter;
})(window);
