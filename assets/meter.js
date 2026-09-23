/* VU-style performance meter: an arc scale with a sprung needle that never quite sits still.
   setScore(p) moves the rest position (-1 … 1); kick(dir) flicks the needle on each answer.
   The candidate's first name rides on the needle tip. The arc flattens to fit whatever width it's given. */
(function (global) {
  "use strict";
  const C = { red: "#e61e2a", navy: "#000054", grey: "#cfd1c9", muted: "#6b6b8a", tick: "#000054" };
  const DISPLAY = "'Museo-RMITVN 700', 'Museo 700', 'Museo', 'Helvetica Neue LT Pro', 'Helvetica Neue', Arial, sans-serif";
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
    // arc through three points: apex at `top`, ends at ±half-chord near the bottom
    this.top = 60; const ends = this.h - 44, half = this.w * 0.4, sag = Math.max(40, ends - this.top);
    this.R = (half * half + sag * sag) / (2 * sag);
    this.span = Math.asin(Math.min(0.99, half / this.R));
    this.cx = this.w / 2; this.cy = this.top + this.R;
  };
  Meter.prototype.setScore = function (p) { this.p = Math.max(-1, Math.min(1, p)); };
  Meter.prototype.setName = function (n) { this.name = String(n || "").trim(); };
  Meter.prototype.kick = function (dir) { this.vel += dir * (this.reduced ? 0.3 : 1.0) * (this.span / 0.52) * 1.6; };
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
    // the "signal": a gentle layered wobble plus the odd soft transient, like programme audio on a VU
    const sig = amp * k * (0.009 * Math.sin(this.t * 5.3) + 0.005 * Math.sin(this.t * 9.7 + 1.3) + 0.004 * Math.sin(this.t * 2.1 + 2));
    if (!this.reduced && Math.random() < dt * 0.7) this.vel += (Math.random() - 0.5) * 0.25 * k;
    const target = this.p * S * 0.9 + sig;
    const acc = 110 * (target - this.theta) - 13 * this.vel; // under-damped: a small overshoot, then settles
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
    const bands = [[-S, -S / 3, C.red], [-S / 3, S / 3, C.grey], [S / 3, S, C.navy]];
    g.lineWidth = 9; g.lineCap = "butt";
    for (const [a, b, col] of bands) { g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, R - 4, ang(a), ang(b)); g.stroke(); }
    // ticks
    g.strokeStyle = C.tick;
    for (let i = 0; i <= 40; i++) {
      const a = -S + (2 * S * i) / 40, major = i % 5 === 0;
      const [x1, y1] = pt(a, R + 3), [x2, y2] = pt(a, R + (major ? 17 : 9));
      g.lineWidth = major ? 2 : 1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    g.textAlign = "center"; g.textBaseline = "middle";
    // end marks
    g.font = "700 18px " + DISPLAY;
    let [x, y] = pt(-S, R + 10); g.fillStyle = C.red; g.fillText("–", x - 14, y);
    [x, y] = pt(S, R + 10); g.fillStyle = C.navy; g.fillText("+", x + 14, y);
    // zone labels, under the arc
    g.font = "700 14px " + DISPLAY;
    for (const [a, text, col] of [[-S * 0.5, this.labels.left, C.red], [S * 0.5, this.labels.right, C.navy]]) {
      if (!text) continue; [x, y] = pt(a, R - 44); g.fillStyle = col; g.fillText(text.toUpperCase(), x, y);
    }
    // needle
    const [nx, ny] = pt(this.theta, R + 20), [bx, by] = pt(this.theta, R - 110);
    g.save(); g.shadowColor = "rgba(0,0,84,0.25)"; g.shadowBlur = 3; g.shadowOffsetX = 1.5; g.shadowOffsetY = 1;
    g.strokeStyle = C.red; g.lineWidth = 2.6; g.lineCap = "round";
    g.beginPath(); g.moveTo(bx, by); g.lineTo(nx, ny); g.stroke(); g.restore();
    // the candidate's first name, riding on the needle tip
    if (this.name) {
      g.font = "700 13px " + DISPLAY;
      const tw = g.measureText(this.name).width, pw = tw + 22, ph = 24;
      const [tx, ty] = pt(this.theta, R + 22);
      const px = Math.max(pw / 2 + 4, Math.min(w - pw / 2 - 4, tx)), py = Math.max(ph / 2 + 2, ty - 18);
      g.fillStyle = C.navy; g.beginPath();
      if (g.roundRect) g.roundRect(px - pw / 2, py - ph / 2, pw, ph, ph / 2); else g.rect(px - pw / 2, py - ph / 2, pw, ph);
      g.fill();
      g.beginPath(); g.moveTo(tx - 5, py + ph / 2 - 1); g.lineTo(tx + 5, py + ph / 2 - 1); g.lineTo(tx, py + ph / 2 + 6); g.closePath(); g.fill();
      g.fillStyle = "#fff"; g.fillText(this.name, px, py + 1);
    }
    // hood over the pivot side
    const grad = g.createLinearGradient(0, h - 40, 0, h);
    grad.addColorStop(0, "rgba(241,242,236,0)"); grad.addColorStop(1, "rgba(227,229,224,1)");
    g.fillStyle = grad; g.fillRect(0, h - 40, w, 40);
    g.fillStyle = C.muted; g.font = "700 10px " + TEXT;
    g.fillText("P E R F O R M A N C E", cx, h - 13);
  };

  global.Meter = Meter;
})(window);
