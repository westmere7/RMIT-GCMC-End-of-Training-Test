/* "Examiners online": a purely decorative panel. People from settings.examiners drift in and out,
   one change at a time, every minute or so. At least one examiner is always present.
   State lives in the caller's session object so a page refresh doesn't reshuffle the room. */
(function (global) {
  "use strict";
  const DEFAULT = [
    "Danh, Creative Services Lead", "Đức, Creative & Production Manager", "Trinh, Senior Designer", "Trân, Senior Designer",
    "Eden, Multimedia Designer", "Trúc, Multimedia Designer", "Roy, Mascot (platypus)", "Milo, Mascot (wombat)",
  ];
  const STATUS = ["Observing", "Reviewing answers", "Taking notes", "Observing", "Cross-checking", "Observing", "On a call", "Sipping coffee"];
  const MAX = 4;

  function parse(list) {
    const src = Array.isArray(list) && list.filter((x) => String(x).trim()).length ? list : DEFAULT;
    return src.map((line) => {
      const [name, ...rest] = String(line).split(",");
      return { name: name.trim(), role: rest.join(",").trim() || "Examiner" };
    }).filter((p) => p.name);
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  function Examiners(listEl, countEl, people, state, onChange) {
    this.ul = listEl; this.countEl = countEl; this.people = parse(people); this.onChange = onChange || (() => {});
    const known = new Set(this.people.map((p) => p.name));
    this.s = state && Array.isArray(state.on) ? state : { on: [], st: {} };
    this.s.on = this.s.on.filter((n) => known.has(n));
    if (!this.s.on.length) { // open with two in the room (or one, if that's all we have)
      const pool = this.people.map((p) => p.name);
      for (let i = 0; i < Math.min(2, pool.length); i++) this.s.on.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      this.s.on.forEach((n) => (this.s.st[n] = "Observing"));
    }
    this.render(null);
  }

  Examiners.prototype.start = function () {
    this.stop();
    const next = () => { this.timer = setTimeout(() => { this.step(); next(); }, 45000 + Math.random() * 45000); };
    next();
  };
  Examiners.prototype.stop = function () { clearTimeout(this.timer); };

  // one small change: someone joins, someone leaves, or someone's status changes
  Examiners.prototype.step = function () {
    const on = this.s.on, off = this.people.map((p) => p.name).filter((n) => !on.includes(n));
    const cap = Math.min(MAX, this.people.length), r = Math.random();
    let changed = null;
    if (on.length < cap && off.length && (on.length === 1 || r < 0.4)) {
      changed = pick(off); on.push(changed); this.s.st[changed] = "Joined";
      this.render(changed, "in");
      setTimeout(() => { if (this.s.st[changed] === "Joined") { this.s.st[changed] = "Observing"; this.render(null); this.onChange(this.s); } }, 8000);
    } else if (on.length > 1 && r < 0.75) {
      const who = pick(on);
      const li = this.ul.querySelector(`[data-name="${CSS.escape(who)}"]`);
      if (li) li.classList.add("out");
      setTimeout(() => { this.s.on = this.s.on.filter((n) => n !== who); delete this.s.st[who]; this.render(null); this.onChange(this.s); }, 450);
      return;
    } else {
      const who = pick(on); this.s.st[who] = pick(STATUS.filter((x) => x !== this.s.st[who])); this.render(null);
    }
    this.onChange(this.s);
  };

  Examiners.prototype.render = function (fresh, how) {
    const by = new Map(this.people.map((p) => [p.name, p]));
    this.ul.innerHTML = "";
    for (const n of this.s.on) {
      const p = by.get(n); if (!p) continue;
      const li = document.createElement("li"); li.dataset.name = n;
      if (n === fresh && how === "in") li.className = "in";
      const mascot = /mascot/i.test(p.role);
      li.innerHTML = `<span class="av${mascot ? " mascot" : ""}"></span><span class="who"><b></b><small></small></span><span class="st"></span>`;
      li.querySelector(".av").textContent = initials(p.name);
      li.querySelector("b").textContent = p.name;
      li.querySelector("small").textContent = p.role;
      li.querySelector(".st").textContent = this.s.st[n] || "Observing";
      this.ul.append(li);
    }
    if (this.countEl) this.countEl.textContent = this.s.on.length;
  };

  Examiners.DEFAULT = DEFAULT;
  global.Examiners = Examiners;
})(window);
