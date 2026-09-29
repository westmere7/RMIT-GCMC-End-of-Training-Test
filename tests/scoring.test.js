// The points rules and the meter. Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { load, rng, sit, stats } = require("./load");

const { A, G, Meter } = load();
const N = 45, CRIT = 9; // the live settings: 45 questions an attempt, 20% of them critical

// ---------- the rules ----------
test("taker: the ends of each range", () => {
  const T = (right, team) => G.points(false, right, team).taker;
  assert.equal(T(true, [false, false, false]), 10, "right, the whole team wrong");
  assert.equal(T(true, [true, true, true]), 1, "right, the whole team right too");
  assert.equal(T(false, [false, false, false]), 0, "wrong, the whole team wrong too");
  assert.equal(T(false, [true, true, true]), -5, "wrong, the whole team right");
});

test("taker: in between, each teammate who got it wrong is worth the same", () => {
  const T = (right, wrongOf3) => G.points(false, right, [0, 1, 2].map((i) => i >= wrongOf3)).taker;
  assert.deepEqual([0, 1, 2, 3].map((w) => T(true, w)), [1, 4, 7, 10], "right: +3 for each of 3 teammates who missed it");
  assert.deepEqual([0, 1, 2, 3].map((w) => T(false, w)), [-5, -3, -2, 0], "wrong: less of a loss for each one who missed it too");
  assert.equal(G.points(false, true, [true, false]).taker, 6, "1 of 2 wrong: halfway, rounded");
  assert.equal(G.points(false, false, [true, false]).taker, -2);
});

test("taker: with one teammate it's one end or the other", () => {
  assert.equal(G.points(false, true, [true]).taker, 1);
  assert.equal(G.points(false, true, [false]).taker, 10);
  assert.equal(G.points(false, false, [true]).taker, -5);
  assert.equal(G.points(false, false, [false]).taker, 0);
});

test("teammates: +1 right; wrong costs 3 if the taker got it right, 2 if the taker didn't", () => {
  const M = (right, takerRight) => G.points(false, takerRight, [right]).members[0];
  assert.equal(M(true, true), 1);
  assert.equal(M(true, false), 1);
  assert.equal(M(false, true), -3);
  assert.equal(M(false, false), -2);
});

test("each teammate is scored on their own answer", () => {
  assert.deepEqual([...G.points(false, true, [true, false, true]).members], [1, -3, 1]);
  assert.deepEqual([...G.points(false, false, [false, true]).members], [-2, 1]);
});

test("critical questions double everything, both ways", () => {
  for (const takerRight of [true, false])
    for (const team of [[true, true], [false, false], [true, false], [true], [false], [true, false, false]]) {
      const plain = G.points(false, takerRight, team), crit = G.points(true, takerRight, team);
      assert.equal(crit.taker, plain.taker * 2);
      assert.deepEqual([...crit.members], [...plain.members].map((x) => x * 2));
    }
});

test("on your own: +1 right, −1 wrong (×2 when critical)", () => {
  assert.equal(G.points(false, true, []).taker, 1);
  assert.equal(G.points(false, false, []).taker, -1);
  assert.equal(G.points(true, true, []).taker, 2);
  assert.equal(G.points(true, false, []).taker, -2);
});

test("the numbers on the start page are the ones the scoring uses", () => {
  const { taker: T, member: M } = G.RULES;
  assert.equal(G.points(false, true, [false, false]).taker, T.right.allWrong);
  assert.equal(G.points(false, true, [true, true]).taker, T.right.allRight);
  assert.equal(G.points(false, false, [false, false]).taker, T.wrong.allWrong);
  assert.equal(G.points(false, false, [true, true]).taker, T.wrong.allRight);
  assert.equal(G.points(false, true, [true]).members[0], M.right);
  assert.equal(G.points(false, true, [false]).members[0], M.wrongTakerRight);
  assert.equal(G.points(false, false, [false]).members[0], M.wrongTakerWrong);
});

test("powerups: every run of 3 right in a row earns a charge, up to 2 held", () => {
  const R = (str) => [...str].map((c) => c === "x"); // x = right, . = wrong
  const at = (str, powers = {}, k = str.length) => G.charges(R(str), powers, k);
  assert.deepEqual({ ...at("") }, { held: 0, run: 0 });
  assert.deepEqual({ ...at("xx") }, { held: 0, run: 2 });
  assert.equal(at("xxx").held, 1);
  assert.equal(at("xx.x").held, 0, "a wrong answer breaks the run");
  assert.equal(at("xxxxxx").held, 2);
  assert.equal(at("xxxxxxxxx").held, 2, "no more than 2 held; the third run earns nothing");
  assert.equal(at("xxxxxxxxx", { 6: { double: true } }).held, 2, "spend one, and the next run fills it again");
  assert.equal(at("xxxx", { 3: { gauge: { m: 1 } } }).held, 0, "spent on question 3");
  assert.equal(at("xxxxx", { 3: { double: true, gauge: { m: 1 } } }).held, 0, "both on one question costs two");
  assert.equal(at("xxx", { 3: { double: true } }, 3).held, 0, "what's spent on the question on screen counts straight away");
});

test("powerups: double down doubles the room's points both ways; the recorded points don't change", () => {
  for (const critical of [false, true])
    for (const takerRight of [true, false])
      for (const team of [[true], [false], [true, false, false]]) {
        const d = G.points(critical, takerRight, team).taker;
        assert.equal(G.gamePoints(d, { double: true }), d * 2);
        assert.equal(G.gamePoints(d, { gauge: { m: 1 } }), d, "a gauge doesn't change the points");
        assert.equal(G.gamePoints(d, undefined), d);
      }
});

test("per question, points stay within −5…+10 (taker) and −3…+1 (teammate), doubled when critical", () => {
  for (const critical of [false, true])
    for (const takerRight of [true, false])
      for (let size = 1; size <= 8; size++)
        for (let mask = 0; mask < 1 << size; mask++) {
          const team = [...Array(size)].map((_, i) => !!(mask & (1 << i))), k = critical ? 2 : 1;
          const p = G.points(critical, takerRight, team);
          assert.ok(Number.isInteger(p.taker) && !Object.is(p.taker, -0));
          assert.ok(p.taker >= -5 * k && p.taker <= 10 * k);
          for (const m of p.members) assert.ok(m >= -3 * k && m <= 1 * k);
        }
});

test("more teammates getting it wrong never lowers the taker's points", () => {
  for (const takerRight of [true, false])
    for (let size = 1; size <= 8; size++) {
      let last = -Infinity;
      for (let wrong = 0; wrong <= size; wrong++) {
        const t = G.points(false, takerRight, [...Array(size)].map((_, i) => i >= wrong)).taker;
        assert.ok(t >= last); last = t;
      }
    }
});

// ---------- the meter ----------
// weighted totals for a finished paper: c right of N, with the critical ones spread in proportion (critical ×2)
const paper = (c, critMisses) => {
  const w = N - c, cm = critMisses == null ? Math.round((w * CRIT) / N) : critMisses, cr = CRIT - cm;
  return [c + cr, w + cm];
};

test("meter on your own: stays within −1…1 and climbs with every extra right answer", () => {
  for (let c = 0; c <= N; c++) {
    const p = A.meterReading(...paper(c), N);
    assert.ok(p >= -1 && p <= 1);
    if (c < N) assert.ok(A.meterReading(...paper(c + 1), N) >= p);
  }
  assert.equal(A.meterReading(N + CRIT, 0, N), 1, "a perfect paper pins it at the green end");
  assert.equal(A.meterReading(0, N + CRIT, N), -1, "all wrong pins it at the red end");
});

test("meter on your own: half right is the middle, two thirds is welcome, a third is red", () => {
  const meter = new Meter(null, null, { left: "red", right: "welcome" });
  const at = (share) => A.meterReading(...paper(Math.round(N * share)), N);
  assert.equal(meter.zone(at(0.3)), "red");
  assert.equal(meter.zone(at(0.5)), "Too close to call");
  assert.ok(Math.abs(at(0.5)) < 0.1, "half right sits in the middle");
  assert.equal(meter.zone(at(0.7)), "welcome");
});

test("meter on your own: confetti needs about 95%, and a critical miss costs as much as two misses", () => {
  const m = new Meter(null, null, {}); m.setThreshold(95);
  const green = (c, cm) => A.meterReading(...paper(c, cm), N) >= m.pg;
  assert.ok(green(45, 0) && green(43, 0), "43 of 45 with no critical miss");
  assert.ok(!green(42, 0), "42 of 45 (93%) falls just short");
  assert.ok(green(44, 1), "44 right, the miss a critical one: like 43 right");
  assert.ok(!green(43, 1), "43 right with a critical miss: like 42 right");
});

test("meter: early on, one answer moves it a small, steady step", () => {
  assert.ok(A.meterReading(1, 0, N) > 0 && A.meterReading(1, 0, N) < 0.06, "one right answer is a nudge, not a jump");
  assert.ok(A.meterReading(5, 0, N) < 0.25, "five in a row is still short of the welcome zone");
  assert.ok(A.meterReading(10, 0, N) >= 1 / 3, "ten in a row reaches it");
  assert.ok(A.meterReading(0, 2, N) > -0.2, "one early critical miss isn't the end of the world");
  assert.ok(A.pointsReading(1, 1, N) < 0.02 && A.pointsReading(10, 1, N) < 0.15, "with a team: one answer is a nudge, even at +10");
});

test("meter with a team: it follows the points, breaking even in the middle", () => {
  assert.equal(A.pointsReading(0, 20, N), 0);
  assert.ok(A.pointsReading(40, 20, N) > 0 && A.pointsReading(-40, 20, N) < 0);
  assert.equal(A.pointsReading(A.POINTS_PAR * N, N, N), 1, "par every question pins the green end");
  assert.equal(A.pointsReading(-1000, N, N), -1);
  for (let pts = -100; pts < 200; pts += 7) assert.ok(A.pointsReading(pts + 1, 30, N) >= A.pointsReading(pts, 30, N));
});

// ---------- reasonable ranges, from simulated sittings ----------
const RUNS = 3000;
const simulate = (opts, seed = 1) => { const r = rng(seed); return [...Array(RUNS)].map(() => sit({ A, G }, r, { n: N, crit: CRIT, ...opts })); };

test("simulated: on your own, points are right answers less wrong ones, critical ×2 (−54…54)", () => {
  const runs = simulate({ taker: 0.8 });
  for (const s of runs) {
    const wrong = N - s.takerRight;
    assert.ok(s.takerPoints >= s.takerRight - wrong - CRIT && s.takerPoints <= s.takerRight - wrong + CRIT);
    assert.ok(Math.abs(s.takerPoints) <= N + CRIT);
  }
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

test("simulated: the size of the room barely changes what a taker scores on average", () => {
  for (const taker of [0.6, 0.8, 0.95]) {
    const means = [1, 2, 3, 6].map((size) => stats(simulate({ taker, team: Array(size).fill(0.7) }).map((s) => s.takerPoints)).mean);
    const lo = Math.min(...means), hi = Math.max(...means);
    // within about a dozen points (whole-number rounding of the in-between cases); it used to swing 119 vs 45
    assert.ok(hi - lo <= Math.max(12, 0.1 * hi), `taker ${taker * 100}%: ${means.map((m) => m.toFixed(0)).join(" / ")}`);
  }
});

test("simulated: teammates land either side of zero (a typical teammate breaks even)", () => {
  const mean = (p) => stats(simulate({ taker: 0.8, team: [p, 0.7, 0.7] }).map((s) => s.memberPoints[0])).mean;
  assert.ok(mean(0.5) < 0, "a weak teammate loses points");
  assert.ok(Math.abs(mean(0.7)) < 20, `a 70% teammate is around zero (${mean(0.7).toFixed(0)})`);
  assert.ok(mean(0.85) > 0, "a strong teammate gains");
});

test("simulated: with a team, the meter spreads players out sensibly", () => {
  const meter = new Meter(null, null, { left: "red", right: "welcome" }); meter.setThreshold(95);
  const mean = (taker) => stats(simulate({ taker, team: [0.7, 0.7, 0.7] }).map((s) => s.meter)).mean;
  assert.ok(mean(0.3) < -1 / 3, `a weak taker lands in the red (${mean(0.3).toFixed(2)})`);
  assert.ok(Math.abs(mean(0.5)) < 0.2, `a coin-flip taker sits in the middle (${mean(0.5).toFixed(2)})`);
  assert.ok(mean(0.8) >= 1 / 3 && mean(0.8) < meter.pg, `a good taker is welcome, short of confetti (${mean(0.8).toFixed(2)})`);
  assert.ok(mean(0.97) >= 0.85, `a near-perfect taker is at the green end (${mean(0.97).toFixed(2)})`);
});

test("simulated: on your own, the meter lands in the same zones by accuracy", () => {
  const mean = (taker) => stats(simulate({ taker }).map((s) => s.meter)).mean;
  assert.ok(mean(0.3) < -1 / 3 && Math.abs(mean(0.5)) < 0.15 && mean(0.8) >= 1 / 3);
});

test("award zone: it's exactly the top share of the arc set in the editor, and a perfect run sits inside it", () => {
  for (const top of [5, 10, 20]) {
    const m = new Meter(null, null, {}); m.setThreshold(100 - top);
    const start = m.aim(m.pg); // where the zone starts, as a share of the half-span
    assert.ok(Math.abs((1 - start) / 2 - top / 100) < 1e-9, `top ${top}%`);
    assert.ok(m.aim(1) > start && m.aim(1) < 1, "a perfect reading lands inside the zone, off the stop");
    for (let p = -1; p < 1; p += 0.01) assert.ok(m.aim(p + 0.01) > m.aim(p), "the needle never runs backwards");
  }
});
