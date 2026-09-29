// What scores look like in practice: simulated sittings at different skill levels and room sizes.
// Run: node tests/simulate.js
const { load, rng, sit, stats } = require("./load");

const lib = load(), N = 45, CRIT = 9, RUNS = 5000;
const pad = (s, n) => String(s).padStart(n);
const run = (opts, seed) => { const r = rng(seed); return [...Array(RUNS)].map(() => sit(lib, r, { n: N, crit: CRIT, ...opts })); };
const row = (label, xs, dp = 0) => { const s = stats(xs); return `${label.padEnd(34)}${pad(s.mean.toFixed(dp), 6)}${pad(s.p5, 7)}${pad(s.p50, 7)}${pad(s.p95, 7)}`; };
const head = (t) => console.log(`\n${t}\n${"".padEnd(34)}${pad("mean", 6)}${pad("5%", 7)}${pad("50%", 7)}${pad("95%", 7)}`);

head(`On your own (${N} questions, ${CRIT} critical): taker's points`);
for (const t of [0.5, 0.65, 0.8, 0.9, 0.97]) console.log(row(`taker ${t * 100}%`, run({ taker: t }, 1).map((s) => s.takerPoints)));

for (const size of [1, 3, 6]) {
  head(`With ${size} ${size === 1 ? "teammate" : "teammates"} at 70%: taker's points`);
  for (const t of [0.5, 0.65, 0.8, 0.9, 0.97]) console.log(row(`taker ${t * 100}%`, run({ taker: t, team: Array(size).fill(0.7) }, 2).map((s) => s.takerPoints)));
}

head("A teammate's points (taker at 80%, 2 others at 70%)");
for (const m of [0.5, 0.7, 0.85, 0.95]) console.log(row(`teammate ${m * 100}%`, run({ taker: 0.8, team: [m, 0.7, 0.7] }, 3).map((s) => s.memberPoints[0])));

head("The meter at the end, on your own (−1 red end … 0 middle … 1 green end)");
for (const t of [0.3, 0.5, 0.65, 0.8, 0.95]) console.log(row(`taker ${t * 100}%`, run({ taker: t }, 4).map((s) => +s.meter.toFixed(2)), 2));
head("The meter at the end, with 3 teammates at 70%");
for (const t of [0.3, 0.5, 0.65, 0.8, 0.95]) console.log(row(`taker ${t * 100}%`, run({ taker: t, team: [0.7, 0.7, 0.7] }, 5).map((s) => +s.meter.toFixed(2)), 2));

console.log(`\nPer question: taker −3…+10, teammate −3…+1, both doubled on critical questions.`);
console.log(`Most possible in a room: ${(N - CRIT) * 10 + CRIT * 20} (taker right every time, everyone else wrong every time).`);
console.log(`Least possible in a room: −${(N - CRIT) * 3 + CRIT * 6} (taker wrong every time, everyone else right).`);
