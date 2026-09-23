/* VU-style performance meter: an arc scale with a sprung needle that never quite sits still.
   setScore(p) moves the rest position (-1 … 1); kick(dir) flicks the needle on each answer. */
(function (global) {
  "use strict";
  const C = { red: "#e61e2a", navy: "#000054", grey: "#cfd1c9", muted: "#6b6b8a", tick: "#000054" };
  const DISPLAY = "'Museo-RMITVN 700', 'Museo 700', 'Museo', 'Helvetica Neue LT Pro', 'Helvetica Neue', Arial, sans-serif";
  const SPAN = 30 * Math.PI / 180; // needle travels ±30°

  function Meter(canvas, lamp, labels) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.lamp = lamp;
    this.labels = labels; this.p = 0; this.theta = 0; this.vel = 0; this.t = 0; this.last = 0;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize = this.resize.bind(this); this.frame = this.frame.bind(this);
    addEventListener("resize", this.resize); this.resize();
  }
  Meter.prototype.resize = function () {
    const r = this.c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    this.w = Math.max(300, r.width); this.h = Math.max(120, r.height);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.R = (this.w * 0.39) / Math.sin(SPAN);
    this.top = 74; this.cx = this.w / 2; this.cy = this.top + this.R;
  };
  Meter.prototype.setScore = function (p) { this.p = Math.max(-1, Math.min(1, p)); };
  Meter.prototype.kick = function (dir) { this.vel += dir * (this.reduced ? 0.6 : 2.9); };
  Meter.prototype.zone = function (p) {
    const v = p == null ? this.p : p;
    return v <= -1 / 3 ? this.labels.left : v >= 1 / 3 ? this.labels.right : this.labels.middle;
  };
  Meter.prototype.start = function () { if (!this.running) { this.running = true; requestAnimationFrame(this.frame); } };
  Meter.prototype.stop = function () { this.running = false; };

  Meter.prototype.frame = function (ts) {
    if (!this.running) return;
    const dt = Math.min(0.05, this.last ? (ts - this.last) / 1000 : 0.016); this.last = ts; this.t += dt;
    const amp = this.reduced ? 0.12 : 1;
    // the "signal": layered wobble plus the odd random transient, like programme audio on a VU
    const sig = amp * (0.022 * Math.sin(this.t * 9.1) + 0.014 * Math.sin(this.t * 15.7 + 1.3) + 0.012 * Math.sin(this.t * 4.3 + 2));
    if (!this.reduced && Math.random() < dt * 2.6) this.vel += (Math.random() - 0.5) * 0.9;
    const target = this.p * SPAN * 0.9 + sig;
    const acc = 150 * (target - this.theta) - 11 * this.vel; // under-damped: overshoots, then settles
    this.vel += acc * dt; this.theta += this.vel * dt;
    const lim = SPAN + 0.07;
    if (this.theta > lim) { this.theta = lim; this.vel *= -0.35; }
    if (this.theta < -lim) { this.theta = -lim; this.vel *= -0.35; }
    if (this.lamp) this.lamp.classList.toggle("on", Math.abs(this.vel) > 0.9);
    this.draw();
    requestAnimationFrame(this.frame);
  };

  Meter.prototype.draw = function () {
    const g = this.ctx, w = this.w, h = this.h, cx = this.cx, cy = this.cy, R = this.R;
    g.clearRect(0, 0, w, h);
    const ang = (a) => -Math.PI / 2 + a; // 0 = straight up
    const pt = (a, r) => [cx + r * Math.cos(ang(a)), cy + r * Math.sin(ang(a))];
    // zone bands
    const bands = [[-SPAN, -SPAN / 3, C.red], [-SPAN / 3, SPAN / 3, C.grey], [SPAN / 3, SPAN, C.navy]];
    g.lineWidth = 9; g.lineCap = "butt";
    for (const [a, b, col] of bands) { g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, R - 4, ang(a), ang(b)); g.stroke(); }
    // ticks
    g.strokeStyle = C.tick;
    for (let i = 0; i <= 30; i++) {
      const a = -SPAN + (2 * SPAN * i) / 30, major = i % 5 === 0;
      const [x1, y1] = pt(a, R + 3), [x2, y2] = pt(a, R + (major ? 19 : 10));
      g.lineWidth = major ? 2 : 1; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    // end marks
    g.fillStyle = C.navy; g.font = "700 18px " + DISPLAY; g.textAlign = "center"; g.textBaseline = "middle";
    let [x, y] = pt(-SPAN - 0.035, R + 12); g.fillStyle = C.red; g.fillText("–", x, y);
    [x, y] = pt(SPAN + 0.035, R + 12); g.fillStyle = C.navy; g.fillText("+", x, y);
    // labels
    g.font = "700 14px " + DISPLAY;
    const lab = [[-SPAN * 0.66, this.labels.left, C.red], [0, this.labels.middle, C.muted], [SPAN * 0.66, this.labels.right, C.navy]];
    for (const [a, text, col] of lab) { [x, y] = pt(a, R + 40); g.fillStyle = col; g.fillText(text.toUpperCase(), x, y); }
    // needle
    const [nx, ny] = pt(this.theta, R + 24), [bx, by] = pt(this.theta, R - 70);
    g.save(); g.shadowColor = "rgba(0,0,84,0.25)"; g.shadowBlur = 3; g.shadowOffsetX = 1.5; g.shadowOffsetY = 1;
    g.strokeStyle = C.red; g.lineWidth = 2.6; g.lineCap = "round";
    g.beginPath(); g.moveTo(bx, by); g.lineTo(nx, ny); g.stroke(); g.restore();
    // hood over the pivot side
    const grad = g.createLinearGradient(0, h - 46, 0, h);
    grad.addColorStop(0, "rgba(241,242,236,0)"); grad.addColorStop(1, "rgba(227,229,224,1)");
    g.fillStyle = grad; g.fillRect(0, h - 46, w, 46);
    g.fillStyle = C.muted; g.font = "700 10px 'Helvetica Neue LT Pro', 'Helvetica Neue', Arial, sans-serif";
    g.fillText("P E R F O R M A N C E", cx, h - 13);
  };

  global.Meter = Meter;
})(window);
