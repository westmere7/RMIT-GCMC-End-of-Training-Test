/* VU-style performance meter: an arc scale with a sprung needle that never quite sits still.
   setScore(p) moves the rest position (-1 … 1); kick(dir) flicks the needle on each answer.
   The candidate's first name rides on the needle tip. The arc flattens to fit whatever width it's given. */
(function (global) {
  "use strict";
  const C = { red: "#e61e2a", navy: "#000054", grey: "#d3d5cd", muted: "#6b6b8a", tick: "#000054", minor: "#a9a9c4" };
  const TEXT = "'Helvetica Neue LT Pro', 'Helvetica Neue', Arial, sans-serif";

  function Meter(canvas, lamp, labels) {
    this.c = canvas; this.ctx = canvas && canvas.getContext("2d"); this.lamp = lamp;
    this.labels = labels || {}; this.name = ""; this.p = 0; this.theta = 0; this.vel = 0; this.t = 0; this.last = 0;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize = this.resize.bind(this); this.frame = this.frame.bind(this);
    if (canvas) { addEventListener("resize", this.resize); this.resize(); }
  }
  Meter.prototype.resize = function () {
    const r = this.c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    this.w = Math.max(300, r.width); this.h = Math.max(140, r.height);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // arc through three points: apex at `top`, ends at ±half-chord near the bottom; the sides hold the zone labels
    this.top = 64; this.ends = this.h - 46; const half = this.w * 0.33, sag = Math.max(40, this.ends - this.top);
    this.half = half;
    this.R = (half * half + sag * sag) / (2 * sag);
    this.span = Math.asin(Math.min(0.99, half / this.R));
    this.cx = this.w / 2; this.cy = this.top + this.R;
  };
  Meter.prototype.setScore = function (p) { this.p = Math.max(-1, Math.min(1, p)); };
  Meter.prototype.setName = function (n) { this.name = String(n || "").trim(); };
  Meter.prototype.kick = function (dir) { this.vel += dir * (this.reduced ? 0.3 : 1.0) * (this.span / 0.52) * 1.6; };
  // a harder bounce now and then: a big flick while the spring goes loose, so the needle swings through
  // a few decaying oscillations; the looseness then fades and the needle is back to its usual steady self
  Meter.prototype.jolt = function (dir) {
    if (this.reduced) return this.kick(dir);
    const k = this.span / 0.52;
    this.looseT = 0;
    this.vel += dir * k * (2.0 + Math.random() * 0.7);
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
    // how close the needle is to either end: 0 in the middle, 1 at the stops (eased, so the middle stays calm)
    const e = Math.min(1, Math.abs(this.theta) / S), edge = e * e;
    // the "signal": a slow, relaxed wobble in the middle that turns into a quicker, finer vibration towards the ends
    // (a phase accumulator, so changing speed never makes the wobble jump)
    this.ph = (this.ph || 0) + dt * (1 + 2.4 * edge);
    const ph = this.ph, calm = 1 - 0.55 * edge;
    const sig = amp * k * (calm * (0.009 * Math.sin(ph * 5.3) + 0.005 * Math.sin(ph * 9.7 + 1.3) + 0.004 * Math.sin(ph * 2.1 + 2))
      + edge * 0.0035 * Math.sin(this.t * 31 + Math.sin(this.t * 3.1)));
    if (!this.reduced && Math.random() < dt * (0.7 + 1.6 * edge)) this.vel += (Math.random() - 0.5) * 0.25 * k * calm;
    const target = this.p * S * 0.9 + sig;
    // stiffer (so quicker to bounce back) towards the ends, relaxed in the middle; damping scales with it so the feel stays the same.
    // After a jolt the spring goes soft and barely damped for about a second, then tightens up over the next two or three.
    let L = 0;
    if (this.looseT != null) { this.looseT += dt; L = this.looseT < 1.1 ? 1 : Math.exp(-(this.looseT - 1.1) / 1.2); if (L < 0.01) this.looseT = null; }
    const Kn = 90 * (1 + 1.6 * edge), Dn = 11.8 * Math.sqrt(1 + 1.6 * edge);
    const K = Kn - (Kn - 56) * L, D = Dn - (Dn - 2) * L;
    const acc = K * (target - this.theta) - D * this.vel;
    this.vel += acc * dt; this.theta += this.vel * dt;
    const lim = S + 0.04;
    if (this.theta > lim) { this.theta = lim; this.vel *= -0.35; }
    if (this.theta < -lim) { this.theta = -lim; this.vel *= -0.35; }
    if (this.lamp) this.lamp.classList.toggle("on", Math.abs(this.vel) > 0.55 * k);
    this.draw();
    requestAnimationFrame(this.frame);
  };

  Meter.prototype.draw = function () {
    const g = this.ctx, w = this.w, h = this.h, cx = this.cx, cy = this.cy, R = this.R, S = this.span;
    g.clearRect(0, 0, w, h);
    const ang = (a) => -Math.PI / 2 + a; // 0 = straight up
    const pt = (a, r) => [cx + r * Math.cos(ang(a)), cy + r * Math.sin(ang(a))];
    // zone bands
    const gap = 3 / R; // a hairline break between the zones
    const bands = [[-S, -S / 3 - gap, C.red], [-S / 3 + gap, S / 3 - gap, C.grey], [S / 3 + gap, S, C.navy]];
    g.lineWidth = 10; g.lineCap = "butt";
    for (const [a, b, col] of bands) { g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, R - 5, ang(a), ang(b)); g.stroke(); }
    // ticks
    for (let i = 0; i <= 40; i++) {
      const a = -S + (2 * S * i) / 40, major = i % 5 === 0;
      const [x1, y1] = pt(a, R + 6), [x2, y2] = pt(a, R + (major ? 18 : 11));
      g.strokeStyle = major ? C.tick : C.minor; g.lineWidth = major ? 1.5 : 1;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    g.textAlign = "center"; g.textBaseline = "middle";
    let x, y;
    // zone labels, beside the arc ends (wrapped to the space available)
    const size = Math.round(Math.max(15, Math.min(24, w * 0.017))), lh = size * 1.2;
    const room = Math.min(cx - this.half - 36, size * 8); // narrow column: up to four lines
    g.font = `700 ${size}px ` + TEXT; g.textBaseline = "alphabetic";
    const wrap = (text) => {
      const words = String(text || "").toUpperCase().split(/\s+/).filter(Boolean), lines = [];
      for (const wd of words) { const last = lines[lines.length - 1]; if (last && g.measureText(last + " " + wd).width <= room) lines[lines.length - 1] = last + " " + wd; else lines.push(wd); }
      return lines;
    };
    for (const [side, text, col] of [[-1, this.labels.left, C.red], [1, this.labels.right, C.navy]]) {
      const lines = wrap(text).slice(0, 4); if (!lines.length) continue;
      g.fillStyle = col; g.textAlign = side < 0 ? "right" : "left";
      const lx = side < 0 ? cx - this.half - 26 : cx + this.half + 26, y0 = this.ends - (lines.length - 1) * lh + 6;
      lines.forEach((ln, i) => g.fillText(ln, lx, y0 + i * lh));
    }
    g.textAlign = "center"; g.textBaseline = "middle";
    // needle
    // needle: flat, fading out towards the (unseen) pivot
    const [nx, ny] = pt(this.theta, R + 20), [bx, by] = pt(this.theta, R - (this.h - 4 - this.top));
    const ng = g.createLinearGradient(nx, ny, bx, by);
    ng.addColorStop(0, C.red); ng.addColorStop(0.55, C.red); ng.addColorStop(1, "rgba(230,30,42,0)");
    g.strokeStyle = ng; g.lineWidth = 2.6; g.lineCap = "round";
    g.beginPath(); g.moveTo(bx, by); g.lineTo(nx, ny); g.stroke();
    // the candidate's first name, riding on the needle tip
    if (this.name) {
      g.font = "700 13px " + TEXT;
      const tw = g.measureText(this.name).width, pw = tw + 22, ph = 24;
      const [tx, ty] = pt(this.theta, R + 22);
      const px = Math.max(pw / 2 + 4, Math.min(w - pw / 2 - 4, tx)), py = Math.max(ph / 2 + 2, ty - 18);
      g.fillStyle = C.navy; g.beginPath();
      if (g.roundRect) g.roundRect(px - pw / 2, py - ph / 2, pw, ph, ph / 2); else g.rect(px - pw / 2, py - ph / 2, pw, ph);
      g.fill();
      g.beginPath(); g.moveTo(tx - 5, py + ph / 2 - 1); g.lineTo(tx + 5, py + ph / 2 - 1); g.lineTo(tx, py + ph / 2 + 6); g.closePath(); g.fill();
      g.fillStyle = "#fff"; g.fillText(this.name, px, py + 1);
    }
  };

  global.Meter = Meter;
})(window);
