// The points rules and the meter. Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { load, rng, sit, stats } = require("./load");

const { A, G, Meter } = load();
const N = 45, CRIT = 9; // the live settings: 45 questions an attempt, 20% of them critical

// ---------- the rules, exactly as specified ----------
test("taker: the six cases", () => {
  const T = (right, team) => G.points(false, right, team).taker;
  assert.equal(T(false, [true, true]), -5, "wrong, all others right");
  assert.equal(T(false, [false, false]), 0, "wrong, all others wrong");
  assert.equal(T(false, [true, false]), -3, "wrong, some others wrong");
  assert.equal(T(true, [true, true]), 1, "right, all others right");
  assert.equal(T(true, [false, false]), 10, "right, all others wrong");
  assert.equal(T(true, [false, true]), 2, "right, some others wrong");
});

test("taker: with one teammate it's always 'all' one way or the other", () => {
  assert.equal(G.points(false, true, [true]).taker, 1);
  assert.equal(G.points(false, true, [false]).taker, 10);
  assert.equal(G.points(false, false, [true]).taker, -5);
  assert.equal(G.points(false, false, [false]).taker, 0);
});

test("teammates: the four cases", () => {
  const M = (right, takerRight) => G.points(false, takerRight, [right]).members[0];
  assert.equal(M(false, true), -10, "wrong, taker right");
  assert.equal(M(false, false), -5, "wrong, taker wrong");
  assert.equal(M(true, true), 1, "right, taker right");
  assert.equal(M(true, false), 1, "right, taker wrong");
});

test("each teammate is scored on their own answer", () => {
  assert.deepEqual([...G.points(false, true, [true, false, true]).members], [1, -10, 1]);
  assert.deepEqual([...G.points(false, false, [false, true]).members], [-5, 1]);
});

test("critical questions double everything, both ways", () => {
  for (const takerRight of [true, false])
    for (const team of [[true, true], [false, false], [true, false], [true], [false]]) {
      const plain = G.points(false, takerRight, team), crit = G.points(true, takerRight, team);
      assert.equal(crit.taker, plain.taker * 2);
      assert.deepEqual([...crit.members], [...plain.members].map((x) => x * 2));
    }
});

test("on your own: +1 right, 0 wrong (×2 when critical)", () => {
  assert.equal(G.points(false, true, []).taker, 1);
  assert.equal(G.points(false, false, []).taker, 0);
  assert.equal(G.points(true, true, []).taker, 2);
  assert.equal(G.points(true, false, []).taker, 0);
});

test("the rules table shown on the start page matches the scoring", () => {
  for (const r of G.RULES.taker) {
    const team = r.others === "right" ? [true, true] : r.others === "wrong" ? [false, false] : [true, false];
    assert.equal(G.points(false, r.right, team).taker, r.pts, r.text);
  }
  for (const r of G.RULES.member) {
    const takers = r.right ? [true, false] : [r.taker];
    for (const t of takers) assert.equal(G.points(false, t, [r.right]).members[0], r.pts, r.text);
  }
});

test("per question, points stay within −5…+10 (taker) and −10…+1 (teammate), doubled when critical", () => {
  for (const critical of [false, true])
    for (const takerRight of [true, false])
      for (let size = 1; size <= 8; size++)
        for (let mask = 0; mask < 1 << size; mask++) {
          const team = [...Array(size)].map((_, i) => !!(mask & (1 << i))), k = critical ? 2 : 1;
          const p = G.points(critical, takerRight, team);
          assert.ok(p.taker >= -5 * k && p.taker <= 10 * k);
          for (const m of p.members) assert.ok(m >= -10 * k && m <= 1 * k);
        }
});

// ---------- the meter ----------
test("meter: stays within −1…1 and never goes down for more right answers", () => {
  for (let c = 0; c <= N; c++)
    for (let crit = 0; crit <= Math.min(CRIT, N - c); crit++) {
      const p = A.meterReading(c, N - c, crit, N);
      assert.ok(p >= -1 && p <= 1);
      if (c < N && crit <= N - c - 1) assert.ok(A.meterReading(c + 1, N - c - 1, crit, N) >= p);
    }
  assert.equal(A.meterReading(N, 0, 0, N), 1, "a perfect paper pins it at the green end");
  assert.equal(A.meterReading(0, N, CRIT, N), -1, "all wrong pins it at the red end");
});

test("meter: the zones line up with sensible accuracy bands (critical misses in proportion)", () => {
  const meter = new Meter(null, null, { left: "red", right: "welcome" });
  const at = (c) => { const w = N - c; return A.meterReading(c, w, Math.round((w * CRIT) / N), N); };
  assert.equal(meter.zone(at(Math.round(N * 0.45))), "red", "45% right: HR would like a word");
  assert.equal(meter.zone(at(Math.round(N * 0.62))), "Too close to call", "62% right: the middle");
  assert.equal(meter.zone(at(Math.round(N * 0.8))), "welcome", "80% right: welcome to the team");
});

test("meter: confetti (the green end) needs about 95%, and a critical miss keeps you out", () => {
  const meterGreen = (c, crit) => { const m = new Meter(null, null, {}); m.setThreshold(95); return A.meterReading(c, N - c, crit, N) >= m.pg; };
  assert.ok(meterGreen(45, 0) && meterGreen(44, 0) && meterGreen(43, 0), "43+ right with no critical miss");
  assert.ok(!meterGreen(42, 0), "42 of 45 (93%) falls just short");
  assert.ok(!meterGreen(44, 1), "one critical miss is enough to miss the green");
});

test("meter: early on, one answer moves it a small, steady step", () => {
  const first = A.meterReading(1, 0, 0, N);
  assert.ok(first > 0 && first < 0.06, "one right answer is a nudge, not a jump");
  assert.ok(A.meterReading(5, 0, 0, N) < 0.25, "five in a row is still well short of the welcome zone");
  assert.ok(A.meterReading(10, 0, 0, N) >= 1 / 3, "ten in a row reaches it");
  assert.ok(A.meterReading(0, 1, 1, N) > -0.2, "one early critical miss isn't the end of the world");
});

// ---------- reasonable ranges, from simulated sittings ----------
const RUNS = 3000;
const simulate = (opts, seed = 1) => { const r = rng(seed); return [...Array(RUNS)].map(() => sit({ A, G }, r, { n: N, crit: CRIT, ...opts })); };

test("simulated: on your own, points track right answers (0…54)", () => {
  const runs = simulate({ taker: 0.8 });
  for (const s of runs) assert.ok(s.takerPoints >= s.takerRight && s.takerPoints <= s.takerRight + CRIT && s.takerPoints <= N + CRIT);
});

test("simulated: a stronger taker scores more, whatever the team", () => {
  for (const team of [[0.7], [0.7, 0.7, 0.7], [0.9, 0.6, 0.5, 0.8, 0.7]]) {
    const mean = (taker) => stats(simulate({ taker, team }).map((s) => s.takerPoints)).mean;
    const weak = mean(0.5), mid = mean(0.75), strong = mean(0.95);
    assert.ok(weak < mid && mid < strong, `team ${team}: ${weak.toFixed(0)} < ${mid.toFixed(0)} < ${strong.toFixed(0)}`);
  }
});

test("simulated: a stronger teammate scores more", () => {
  const mean = (p) => stats(simulate({ taker: 0.8, team: [p, 0.7] }).map((s) => s.memberPoints[0])).mean;
  assert.ok(mean(0.5) < mean(0.75) && mean(0.75) < mean(0.95));
});

test("simulated: a good taker (80%) comes out ahead with a room of any size", () => {
  for (const size of [1, 3, 6]) {
    const st = stats(simulate({ taker: 0.8, team: Array(size).fill(0.7) }).map((s) => s.takerPoints));
    assert.ok(st.p5 > 0, `team of ${size}: 5th percentile ${st.p5}`);
  }
});
