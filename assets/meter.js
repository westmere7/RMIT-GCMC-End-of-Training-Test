/* The performance meter: a vibrant arc, red through amber to green, with a sprung needle that never quite sits still.
   setScore(p) moves the rest position (-1 … 1); kick(dir) flicks the needle on each answer; setStats() fills the
   readout under the arc (points, question, streak); pulse(delta, right) marks an answer with a ripple and a points chip
   at the needle tip. The candidate's first name rides on the needle tip. The arc flattens to fit whatever width it's given. */
(function (global) {
  "use strict";
  const C = { red: "#e61e2a", green: "#12a150", navy: "#000054", track: "#e8e9f0", muted: "#6b6b8a", tick: "#b9bacd" };
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
    // arc through three points: apex at `top`, ends at ±half-chord near the bottom; the sides hold the zone labels
    // on a phone there's no room beside the arc, so it widens and the labels sit under its ends instead
    this.compact = this.w < 600;
    this.top = this.compact ? 52 : 64; this.ends = this.h - (this.compact ? 70 : 52);
    const half = this.w * (this.compact ? 0.4 : 0.33), sag = Math.max(40, this.ends - this.top);
    this.half = half;
    this.R = (half * half + sag * sag) / (2 * sag);
    this.span = Math.asin(Math.min(0.99, half / this.R));
    this.cx = this.w / 2; this.cy = this.top + this.R;
  };
  Meter.prototype.setScore = function (p) { this.p = Math.max(-1, Math.min(1, p)); };
  // The last 5% of the arc is the confetti zone. `pct` is the confetti threshold (e.g. 95), so the reading that
  // earns confetti lands exactly on its edge, and a perfect run parks the needle in the middle of it.
  const GREEN = 0.9; // it starts at 90% of the half-span, i.e. the last 5% of the whole arc
  Meter.prototype.setThreshold = function (pct) { this.pg = Math.max(0.05, Math.min(0.99, 2 * (pct == null ? 95 : pct) / 100 - 1)); };
  Meter.prototype.aim = function (p) { // reading (-1…1) → share of the half-span
    const pg = this.pg || 0.9;
    if (p <= 0) return p * GREEN;
    if (p < pg) return (p / pg) * GREEN;
    return GREEN + ((p - pg) / (1 - pg)) * 0.055;
  };
  Meter.prototype.greenPoint = function () { // page coordinates of the middle of the confetti zone
    const a = this.span * 0.95, r = this.c.getBoundingClientRect(), rr = this.R - 9;
    return { x: r.left + this.cx + rr * Math.sin(a), y: r.top + this.cy - rr * Math.cos(a) };
  };
  Meter.prototype.inGreen = function () { return this.theta >= this.span * GREEN; };
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
    const g = this.ctx, w = this.w, cx = this.cx, cy = this.cy, R = this.R, S = this.span;
    g.clearRect(0, 0, w, this.h);
    const ang = (a) => -Math.PI / 2 + a; // 0 = straight up
    const pt = (a, r) => [cx + r * Math.cos(ang(a)), cy + r * Math.sin(ang(a))];
    const frac = (a) => (a + S) / (2 * S); // 0 at the left end, 1 at the right
    const lw = this.compact ? 12 : 16, rr = R - 9; // the arc: its width and its radius
    const grad = g.createLinearGradient(cx - this.half - lw, 0, cx + this.half + lw, 0);
    for (const [o, col] of STOPS) grad.addColorStop(o, col);

    // the track: the whole scale, softly; then the reading, bright, from the middle out to the needle
    g.lineCap = "round"; g.lineWidth = lw;
    g.strokeStyle = C.track; g.beginPath(); g.arc(cx, cy, rr, ang(-S), ang(S)); g.stroke();
    g.globalAlpha = 0.5; g.strokeStyle = grad; g.beginPath(); g.arc(cx, cy, rr, ang(-S), ang(S)); g.stroke(); g.globalAlpha = 1;
    const th = Math.max(-S, Math.min(S, this.theta)), here = colourAt(frac(th));
    if (Math.abs(th) > 0.004) {
      g.save(); g.shadowColor = here; g.shadowBlur = 18;
      g.strokeStyle = grad; g.beginPath(); g.arc(cx, cy, rr, ang(Math.min(0, th)), ang(Math.max(0, th))); g.stroke(); g.restore();
    }
    // zone marks: fine white breaks at the thirds, and the confetti zone at the green end
    g.lineCap = "butt";
    for (const a of [-S / 3, S / 3, S * GREEN]) {
      const [x1, y1] = pt(a, rr - lw / 2 - 1), [x2, y2] = pt(a, rr + lw / 2 + 1);
      g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    { // a small star over the confetti zone
      const [sx, sy] = pt(S * 0.95, rr + lw / 2 + 12), r1 = this.compact ? 5 : 6, r2 = r1 * 0.45;
      g.fillStyle = this.p >= (this.pg || 0.9) ? "#fac800" : C.tick; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? r2 : r1; g.lineTo(sx + r * Math.cos(a), sy + r * Math.sin(a)); }
      g.closePath(); g.fill();
    }
    // ticks, inside the arc
    for (let i = 0; i <= 40; i++) {
      const a = -S + (2 * S * i) / 40, major = i % 5 === 0;
      const [x1, y1] = pt(a, rr - lw / 2 - 5), [x2, y2] = pt(a, rr - lw / 2 - (major ? 13 : 9));
      g.strokeStyle = major ? "#8e8fae" : C.tick; g.lineWidth = major ? 1.5 : 1;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }

    // zone labels, beside the arc ends (wrapped to the space available)
    g.textAlign = "center"; g.textBaseline = "alphabetic";
    const size = Math.round(Math.max(15, Math.min(24, w * 0.017))), lh = size * 1.2;
    const room = Math.min(cx - this.half - 36, size * 8); // narrow column: up to four lines
    const wrapTo = (text, width, max) => {
      const words = String(text || "").toUpperCase().split(/\s+/).filter(Boolean), lines = [];
      for (const wd of words) { const last = lines[lines.length - 1]; if (last && g.measureText(last + " " + wd).width <= width) lines[lines.length - 1] = last + " " + wd; else lines.push(wd); }
      return lines.slice(0, max);
    };
    if (this.compact) { // under the arc ends, centred, up to two lines
      g.font = "700 12px " + TEXT;
      for (const [side, text, col] of [[-1, this.labels.left, C.red], [1, this.labels.right, C.green]]) {
        const lines = wrapTo(text, w * 0.3, 2); if (!lines.length) continue;
        const widest = Math.max(...lines.map((l) => g.measureText(l).width));
        const lx = Math.max(widest / 2 + 4, Math.min(w - widest / 2 - 4, cx + side * this.half));
        g.fillStyle = col; lines.forEach((ln, i) => g.fillText(ln, lx, this.ends + 36 + i * 14));
      }
    } else {
      g.font = `700 ${size}px ` + TEXT;
      for (const [side, text, col] of [[-1, this.labels.left, C.red], [1, this.labels.right, C.green]]) {
        const lines = wrapTo(text, room, 4); if (!lines.length) continue;
        g.fillStyle = col; g.textAlign = side < 0 ? "right" : "left";
        const lx = side < 0 ? cx - this.half - 30 : cx + this.half + 30, y0 = this.ends - (lines.length - 1) * lh + 6;
        lines.forEach((ln, i) => g.fillText(ln, lx, y0 + i * lh));
      }
    }

    // the readout, under the arc: points (counting up), then where we are
    const drop = this.ends - this.top;
    if (this.stats) {
      const s = this.stats, big = this.compact ? 34 : 48, y = this.top + drop * (this.compact ? 0.9 : 0.86);
      g.textAlign = "center"; g.textBaseline = "alphabetic";
      g.font = "700 10px " + TEXT; g.fillStyle = C.muted;
      g.fillText("POINTS", cx, y - big - 6);
      const val = Math.round(this.pointsNow());
      g.font = `700 ${big}px ` + DISPLAY; g.fillStyle = val > 0 ? C.green : val < 0 ? C.red : C.navy;
      g.fillText(signed(val), cx, y);
      const bits = [`Question ${Math.min(s.total, s.answered + 1)} of ${s.total}`];
      if (s.streak >= 2) bits.push(`${s.streak} in a row`);
      g.font = "700 12px " + TEXT; g.fillStyle = C.muted;
      g.fillText(bits.join("  ·  "), cx, y + (this.compact ? 18 : 22));
    }

    // the needle: tapered, from well below the readout up to the arc, with a soft glow in the colour it points at
    const inner = R - drop * 0.34, [nx, ny] = pt(this.theta, rr + lw / 2 + 4), [bx, by] = pt(this.theta, inner);
    const px = Math.cos(ang(this.theta) + Math.PI / 2), py = Math.sin(ang(this.theta) + Math.PI / 2), wb = this.compact ? 3 : 4;
    const ng = g.createLinearGradient(bx, by, nx, ny);
    ng.addColorStop(0, "rgba(0,0,84,0)"); ng.addColorStop(0.35, C.navy); ng.addColorStop(1, C.navy);
    g.save(); g.shadowColor = here; g.shadowBlur = 10;
    g.fillStyle = ng; g.beginPath(); g.moveTo(bx + px * wb, by + py * wb); g.lineTo(nx, ny); g.lineTo(bx - px * wb, by - py * wb); g.closePath(); g.fill();
    g.restore();
    const [hx, hy] = pt(this.theta, rr); // a bead where the needle crosses the arc
    g.fillStyle = "#fff"; g.beginPath(); g.arc(hx, hy, lw / 2 - 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = here; g.beginPath(); g.arc(hx, hy, lw / 2 - 5, 0, Math.PI * 2); g.fill();

    // each answer: a ripple from the bead, and its points floating up from the tip
    for (const p of this.pulses) {
      const age = this.t - p.t0, col = p.right ? C.green : C.red;
      if (age < 0.9) {
        const k = age / 0.9;
        g.strokeStyle = col; g.globalAlpha = (1 - k) * 0.8; g.lineWidth = 3;
        g.beginPath(); g.arc(hx, hy, lw / 2 + k * 34, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      }
      const rise = 1 - Math.pow(1 - Math.min(1, age / 1.2), 3), fade = age < 1.1 ? 1 : 1 - (age - 1.1) / 0.5;
      const label = p.delta == null ? (p.right ? "✓" : "✕") : signed(p.delta);
      g.font = `700 ${this.compact ? 16 : 20}px ` + DISPLAY;
      const tw = g.measureText(label).width + 20, chh = this.compact ? 26 : 30;
      const [tx, ty] = pt(this.theta, rr + 40 + rise * 26);
      const cxp = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, tx + (this.theta >= 0 ? 44 : -44))), cyp = Math.max(chh / 2 + 2, ty);
      g.globalAlpha = Math.max(0, fade); g.fillStyle = col; g.beginPath();
      if (g.roundRect) g.roundRect(cxp - tw / 2, cyp - chh / 2, tw, chh, chh / 2); else g.rect(cxp - tw / 2, cyp - chh / 2, tw, chh);
      g.fill(); g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, cxp, cyp + 1);
      g.globalAlpha = 1;
    }

    // the candidate's first name, riding on the needle tip
    if (this.name) {
      g.font = "700 13px " + TEXT; g.textAlign = "center"; g.textBaseline = "middle";
      const tw = g.measureText(this.name).width, pw = tw + 22, ph = 24;
      const [tx, ty] = pt(this.theta, R + 18);
      const pxx = Math.max(pw / 2 + 4, Math.min(w - pw / 2 - 4, tx)), pyy = Math.max(ph / 2 + 2, ty - 18);
      g.fillStyle = C.navy; g.beginPath();
      if (g.roundRect) g.roundRect(pxx - pw / 2, pyy - ph / 2, pw, ph, ph / 2); else g.rect(pxx - pw / 2, pyy - ph / 2, pw, ph);
      g.fill();
      g.beginPath(); g.moveTo(tx - 5, pyy + ph / 2 - 1); g.lineTo(tx + 5, pyy + ph / 2 - 1); g.lineTo(tx, pyy + ph / 2 + 6); g.closePath(); g.fill();
      g.fillStyle = "#fff"; g.fillText(this.name, pxx, pyy + 1);
    }
  };

  global.Meter = Meter;
})(window);
