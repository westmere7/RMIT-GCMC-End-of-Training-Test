// Loads the browser scripts (assets/common.js, group.js, meter.js) into a sandbox, so the tests use the real code.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load() {
  const ctx = { matchMedia: () => ({ matches: false }), crypto: require("crypto").webcrypto, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["common.js", "group.js", "meter.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", f), "utf8"), ctx, { filename: f });
  }
  return { A: ctx.Assess, G: ctx.Group, Meter: ctx.Meter };
}

// A seeded random number generator, so the simulations give the same numbers every run.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One simulated sitting: `n` questions, the first `crit` of them critical. Each question has a difficulty that moves
 * everyone's chance up or down together (a hard question tends to catch the whole room), within ±`spread`.
 * Returns the taker's and each teammate's points and right answers, and the meter's reading at the end.
 */
function sit({ A, G }, random, { n = 45, crit = 9, taker = 0.8, team = [], spread = 0.2 }) {
  let tp = 0, tc = 0, tw = 0, tcrit = 0;
  const mp = team.map(() => 0), mc = team.map(() => 0);
  for (let i = 0; i < n; i++) {
    const critical = i < crit, shift = (random() * 2 - 1) * spread;
    const right = (p) => random() < Math.max(0.02, Math.min(0.98, p + shift));
    const tr = right(taker), mr = team.map(right);
    const pts = G.points(critical, tr, mr);
    tp += pts.taker; pts.members.forEach((d, k) => { mp[k] += d; if (mr[k]) mc[k]++; });
    if (tr) tc++; else { tw++; if (critical) tcrit++; }
  }
  return { takerPoints: tp, takerRight: tc, meter: A.meterReading(tc, tw, tcrit, n), memberPoints: mp, memberRight: mc };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b), q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, p5: q(0.05), p50: q(0.5), p95: q(0.95), min: s[0], max: s[s.length - 1] };
}

module.exports = { load, rng, sit, stats };
