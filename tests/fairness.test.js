// Fairness for everyone in the room, from simulated sittings played with the real scoring code (powerups included).
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { load, rng } = require("./load");

const { A, G, Meter } = load();
const N = 45, CRIT = 9, RUNS = 2000;
const meterAt = new Meter(null, null, {}); meterAt.setThreshold(95);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One room. The taker's strategy with the charges they earn: none | double | bet | gauge (copy teammate 0) | all. */
function play(random, { taker, team, strategy = "none", spread = 0.2 }) {
  const size = team.length, powers = {}, rights = [], guess = Math.round(size * (1 - mean(team.length ? team : [0])));
  let rec = 0, game = 0;
  const run = [];
  const mp = team.map(() => 0), sheets = team.map(() => []);
  for (let i = 0; i < N; i++) {
    const crit = i < CRIT, shift = (random() * 2 - 1) * spread, r = (p) => random() < Math.max(0.02, Math.min(0.98, p + shift));
    const mr = team.map(r);
    let tr = r(taker);
    const held = G.charges(rights, powers, i).held, pw = {};
    if (held > 0 && size && strategy !== "none") {
      if (strategy === "double" || strategy === "all") pw.double = true;
      if (strategy === "bet" || (strategy === "all" && held > 1)) pw.call = { n: guess };
      if (strategy === "gauge") { pw.gauge = { m: 0 }; tr = mr[0]; }
    }
    if (Object.keys(pw).length) powers[i] = pw;
    const p = G.points(crit, tr, mr), missed = mr.filter((x) => !x).length;
    rec += p.taker; game += G.gamePoints(p.taker, pw, missed, size);
    p.members.forEach((d, k) => { mp[k] += d; sheets[k].push(mr[k]); });
    rights.push(tr); run.push({ right: tr, w: crit ? 2 : 1, noBoost: !!pw.gauge });
  }
  return { rec, game, meter: A.meterRun(run, N, N + CRIT).p, mp, sheets };
}
const runs = (opts, seed = 1) => { const r = rng(seed); return [...Array(RUNS)].map(() => play(r, opts)); };
const weighted = (sheet) => sheet.reduce((n, ok, i) => n + (ok ? (i < CRIT ? 2 : 1) : 0), 0);

// ---------- teammates ----------
test("teammates: points follow their own answers alone, whatever the taker does", () => {
  const r = rng(11);
  for (let t = 0; t < 300; t++) {
    const sheet = [...Array(N)].map(() => r() < 0.7);
    const score = (takerRights) => sheet.reduce((n, ok, i) => n + G.points(i < CRIT, takerRights[i], [ok, r() < 0.5]).members[0], 0);
    const a = score([...Array(N)].map(() => r() < 0.3)), b = score([...Array(N)].map(() => r() < 0.95));
    assert.equal(a, b, "the same answers score the same with a weak taker or a strong one");
  }
});

test("teammates: whoever gets more right (critical ×2) ranks higher, and equals tie", () => {
  for (const [taker, mate] of [[0.5, 0.6], [0.8, 0.8], [0.4, 0.9]]) {
    for (const s of runs({ taker, team: [mate, mate, mate] }, 5).slice(0, 500)) {
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
        const dw = weighted(s.sheets[a]) - weighted(s.sheets[b]), dp = s.mp[a] - s.mp[b];
        assert.ok(Math.sign(dw) === Math.sign(dp), `more right answers never means fewer points (${dw} vs ${dp})`);
      }
    }
  }
});

test("teammates: breaking the taker's bet on purpose costs the saboteur against the rest of the team", () => {
  // everyone knows it and the taker bet nobody would miss; one teammate answers wrong on purpose
  const honest = G.points(false, true, [true, true, true]), sab = G.points(false, true, [false, true, true]);
  assert.equal(sab.members[0] - honest.members[0], -3, "the saboteur drops 3");
  assert.deepEqual([sab.members[1], sab.members[2]], [honest.members[1], honest.members[2]], "the others are untouched");
});

// ---------- the taker's record ----------
test("the record: powerups never change the recorded points or the meter", () => {
  for (const strategy of ["double", "bet", "all"]) {
    const plain = runs({ taker: 0.7, team: [0.8, 0.8, 0.8] }, 7), powered = runs({ taker: 0.7, team: [0.8, 0.8, 0.8], strategy }, 7);
    plain.forEach((p, i) => { assert.equal(powered[i].rec, p.rec); assert.equal(powered[i].meter, p.meter); });
  }
});

test("the record: the meter reads the taker's answers, however strong the team", () => {
  for (const taker of [0.4, 0.65, 0.9]) {
    const alone = mean(runs({ taker, team: [] }, 3).map((s) => s.meter));
    for (const team of [[0.5, 0.5, 0.5], [0.95, 0.95, 0.95, 0.95, 0.95]]) assert.ok(Math.abs(mean(runs({ taker, team }, 3).map((s) => s.meter)) - alone) < 0.02);
  }
});

test("the record: copying a teammate with Gauge lifts it only a little, and almost never into the award zone", () => {
  for (const taker of [0.4, 0.5, 0.65]) {
    const own = runs({ taker, team: [0.95, 0.8, 0.8] }, 9), copied = runs({ taker, team: [0.95, 0.8, 0.8], strategy: "gauge" }, 9);
    const lift = mean(copied.map((s) => s.meter)) - mean(own.map((s) => s.meter));
    assert.ok(lift < 0.1, `taker ${taker * 100}%: the meter moves ${lift.toFixed(2)}`);
    // (with the streak boost counting, a lucky hot run can scrape in, but it's rare)
    assert.ok(copied.filter((s) => s.meter >= meterAt.pg).length / copied.length < 0.005, "hardly ever an award from copying");
  }
});

// ---------- the room's scoreboard ----------
test("the scoreboard: powerups reward skill; they don't let a weak taker overtake a strong one", () => {
  const weak = mean(runs({ taker: 0.5, team: [0.8, 0.8, 0.8], strategy: "all" }, 13).map((s) => s.game));
  const strong = mean(runs({ taker: 0.8, team: [0.8, 0.8, 0.8] }, 13).map((s) => s.game));
  assert.ok(weak < strong, `a 50% taker with every powerup (${weak.toFixed(0)}) stays behind an 80% taker with none (${strong.toFixed(0)})`);
  // doubling down pays off for a taker who's usually right, and is a real risk for one who isn't
  const gain = (taker) => mean(runs({ taker, team: [0.8, 0.8, 0.8], strategy: "double" }, 17).map((s) => s.game - s.rec));
  assert.ok(gain(0.9) > gain(0.5), "Double down helps a stronger taker more");
});

