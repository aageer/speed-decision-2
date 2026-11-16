// Helpers shared by the views.
import { json2satrec, sgp4 } from "../../vendor/satellite.esm.js";
import { thresholds, MU_NGA, REQ_WGS84 } from "../kepler.js";
import { ommFromRow } from "../residual.js";
import { parseUtc } from "../sgp4time.js";
import { flightPathDeg, norm } from "../model.js";

export const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

let wanted = null, have = null;
/** Positions at the sky time; returns the newest available set and asks the worker for the wanted one. */
export function skyPositions(ctx) {
  const ms = ctx.data.cat.t0 + ctx.S.skyMin * 60000;
  if (have && Math.abs(have.ms - Math.round(ms)) < 1) return have;
  if (wanted !== Math.round(ms)) {
    wanted = Math.round(ms);
    ctx.data.cat.at(ms).then((v) => { have = v; if (Math.round(v.ms) === wanted) ctx.render(); });
  }
  return have;
}
export const skyMs = (ctx) => ctx.data.cat.t0 + ctx.S.skyMin * 60000;

/** Between-cuts test for one object (position r in km, speed v in km/s). */
export function betweenCuts(r, v) {
  const c = thresholds(r, MU_NGA, REQ_WGS84);
  return v > c.vimp && v < c.vesc;
}

const recCache = new Map();
export function satrecOf(cat, i) {
  if (!recCache.has(i)) recCache.set(i, json2satrec(ommFromRow(cat, i)));
  return recCache.get(i);
}
/** SGP4 state of object i at absolute ms. */
export function stateOf(cat, i, ms) {
  const rec = satrecOf(cat, i);
  const epoch = parseUtc(cat.rows[i][cat.c.epoch]);
  const s = sgp4(rec, (ms - epoch) / 60000);
  if (!s || !s.position || typeof s.position === "boolean") return null;
  return { r: [s.position.x, s.position.y, s.position.z], v: [s.velocity.x, s.velocity.y, s.velocity.z] };
}
/** One orbit of object i around ms, sampled with SGP4. */
export function orbitOf(cat, i, ms, n = 240) {
  const period = (1440 / cat.rows[i][cat.c.n_rev_day]) * 60000;
  const pts = [];
  for (let k = 0; k <= n; k += 1) { const s = stateOf(cat, i, ms + (period * k) / n); if (s) pts.push(s.r); }
  return pts;
}

/** Select an object: its SGP4 state at the sky time becomes the shared (r, v, gamma). */
export function selectObject(ctx, i) {
  const { cat } = ctx.data;
  const s = stateOf(cat, i, skyMs(ctx));
  if (!s) return;
  const r = norm(s.r), v = norm(s.v), g = flightPathDeg(s.r, s.v);
  ctx.set({ selected: cat.norad(i), selectedName: cat.name(i), radius: r, speed: v, gamma: g,
    stateSource: `SGP4 state of ${cat.name(i)} at ${new Date(skyMs(ctx)).toISOString().slice(0, 16).replace("T", " ")} UTC`, pins: [] });
}

export function chips(root, label, items, onToggle) {
  const box = document.createElement("div"); box.className = "ctl";
  const eb = document.createElement("span"); eb.className = "eb"; eb.textContent = label; box.append(eb);
  const row = document.createElement("div"); row.className = "row"; box.append(row);
  for (const it of items) {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip";
    b.setAttribute("aria-pressed", String(it.on));
    const i = document.createElement("i"); i.style.background = it.color; b.append(i, it.label);
    b.addEventListener("click", () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); onToggle(it.key, on); });
    row.append(b);
  }
  root.append(box);
  return box;
}
export function seg(root, label, options, value, onPick) {
  const box = document.createElement("div"); box.className = "ctl";
  if (label) { const eb = document.createElement("span"); eb.className = "eb"; eb.textContent = label; box.append(eb); }
  const s = document.createElement("div"); s.className = "seg";
  for (const [key, text] of options) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.setAttribute("aria-pressed", String(key === value));
    b.addEventListener("click", () => { for (const x of s.children) x.setAttribute("aria-pressed", "false"); b.setAttribute("aria-pressed", "true"); onPick(key); });
    s.append(b);
  }
  box.append(s); root.append(box); return box;
}
export function button(root, text, onClick, cls = "btn") {
  const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = text; b.addEventListener("click", onClick); root.append(b); return b;
}
export function row(root) { const r = document.createElement("div"); r.className = "row"; root.append(r); return r; }

/** The common passport for views that use the shared experiment state. */
export function statePassport(S, el, badge = { tag: "two-body model", cls: "model" }) {
  const dotColor = { impact: "#eb6834", closed: "#2a78d6", escape: "#c0399a" };
  const fam = el.kind === "impact" ? "impact" : el.kind === "circle" || el.kind === "ellipse" ? "closed" : "escape";
  return [{ tag: badge.tag, cls: badge.cls, bits: [`r ${fmt(S.radius, 3)} km`, `v ${fmt(S.speed, 6)} km/s`, `γ ${fmt(S.gamma, 2)}°`, `ε ${fmt(el.epsilon, 3)} km²/s²`, { text: el.kind, dot: dotColor[fam] }, { text: S.stateSource, cls: "dim" }] }];
}
export const speedBands = (cuts, max = 12.5) => [
  [cuts.vimp, "#f3b79b"], [cuts.vesc - cuts.vimp, "#a9c8ef"], [max - cuts.vesc, "#e6a9d3"],
];
