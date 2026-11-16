// The Speed Decision II: one shared state, ten linked views.
import { mountGlobe } from "./globe.js";
import { setTip, hideTip, fmt } from "./svg.js";
import { DEFAULTS, experiment } from "./model.js";
import { VIEWS } from "./views/index.js";
import { runLiveChecks } from "./checks.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
setTip($("tip"), stage);

const reducedPref = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const S = {
  view: 1,
  ...DEFAULTS,
  selected: 25544, selectedName: "ISS (ZARYA)", stateSource: "default teaching state (420 km, sideways)",
  pins: [],
  brush: null,
  B: 0.01,
  types: { PAY: true, "R/B": true, DEB: true, UNK: true },
  regimes: { leo: true, meo: true, geo: true, heo: true },
  skyMin: 0, launchT: 0, burn: 1, launchMode: "rocket", clockT: 0, residualMin: 93, decayDay: 0,
  decayStartH: null, endsMode: "both",
  playing: false, reduced: reducedPref,
};
const DEFAULT_S = JSON.parse(JSON.stringify(S));

const data = {};
let globe = null;
let ctx = null;
let current = null;
let renderQueued = false;

export function set(patch, opts = {}) {
  Object.assign(S, patch);
  if (opts.silent) return;
  queueRender();
}
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

/* ---------------- shell rendering ---------------- */
function passLine(tag, cls, bits) {
  const row = document.createElement("div"); row.className = "pass";
  const t = document.createElement("span"); t.className = `tag ${cls}`; t.textContent = tag; row.append(t);
  for (const b of bits) {
    const s = document.createElement("span");
    if (typeof b === "object") { s.className = b.cls || ""; if (b.dot) { const i = document.createElement("i"); i.className = "dot"; i.style.background = b.dot; s.append(i); } s.append(b.text); }
    else s.textContent = b;
    row.append(s);
  }
  return row;
}
function kpis(items = []) {
  const root = $("kpis"); root.replaceChildren();
  for (const it of items) {
    const box = document.createElement("div"); box.className = `kpi${it.wide ? " wide" : ""}`;
    const v = document.createElement("div"); v.className = "v";
    if (it.dot) { const i = document.createElement("i"); i.className = "dot"; i.style.background = it.dot; v.append(i); }
    v.append(it.value);
    if (it.unit) { const s = document.createElement("small"); s.textContent = it.unit; v.append(s); }
    const l = document.createElement("div"); l.className = "l"; l.textContent = it.label;
    box.append(v, l); root.append(box);
  }
}
function inspector(pairs = []) {
  const root = $("inspector"); root.replaceChildren();
  for (const [k, v] of pairs) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    root.append(dt, dd);
  }
}
function checks(list = []) {
  const root = $("checks"); root.replaceChildren();
  if (!list.length) return;
  const h = document.createElement("h3"); h.textContent = "Checks behind this view"; root.append(h);
  for (const c of list) {
    const row = document.createElement("div"); row.className = "check";
    const st = document.createElement("span"); st.className = `st ${c.status}`; st.textContent = c.status === "pass" ? "PASS" : c.status === "fail" ? "FAIL" : "NOTE";
    const t = document.createElement("span"); t.textContent = c.name;
    row.append(st, t);
    if (c.detail) { const d = document.createElement("span"); d.className = "d"; d.textContent = c.detail; row.append(d); }
    root.append(row);
  }
}
function legend(items = []) {
  const root = $("legend"); root.replaceChildren();
  for (const it of items) {
    const s = document.createElement("span");
    const i = document.createElement("i"); if (it.point) i.className = "pt";
    i.style.background = it.color; if (it.dashed) i.style.background = `repeating-linear-gradient(90deg, ${it.color} 0 5px, transparent 5px 8px)`;
    s.append(i, it.label); root.append(s);
  }
}

function slider(rootId, spec) {
  const root = $(rootId);
  root.replaceChildren();
  if (!spec) return;
  const label = document.createElement("div"); label.className = "label";
  const eb = document.createElement("span"); eb.className = "eb"; eb.textContent = spec.label;
  const out = document.createElement("output"); out.innerHTML = spec.format(spec.value);
  label.append(eb, out);
  const track = document.createElement("div"); track.className = "track";
  if (spec.bands) {
    const b = document.createElement("div"); b.className = "bands";
    for (const [w, c] of spec.bands) { const s = document.createElement("span"); s.style.flex = `${Math.max(w, 0)} 0 0`; s.style.background = c; b.append(s); }
    track.append(b);
  }
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min: spec.min, max: spec.max, step: spec.step ?? "any", value: spec.value });
  input.setAttribute("aria-label", spec.aria || spec.label);
  input.addEventListener("input", () => { const v = Number(input.value); out.innerHTML = spec.format(v); spec.onInput(v); });
  track.append(input);
  if (spec.ticks) {
    const tk = document.createElement("div"); tk.className = "ticks";
    for (const [v, txt] of spec.ticks) { const s = document.createElement("span"); s.style.left = `${((v - spec.min) / (spec.max - spec.min)) * 100}%`; s.textContent = txt; tk.append(s); }
    track.append(tk);
  }
  root.append(label, track);
  root._sync = (v) => { input.value = v; out.innerHTML = spec.format(v); };
}

function setStageMode(mode, lower) {
  stage.classList.toggle("light", mode === "chart");
  stage.classList.toggle("withlower", Boolean(lower));
  globe?.setActive(mode === "globe");
  if (mode !== "globe") { $("markers").replaceChildren(); }
}

function enterView(id) {
  if (current?.leave) current.leave(ctx);
  hideTip();
  S.playing = false; $("play").textContent = "Play";
  current = VIEWS.find((v) => v.id === id);
  S.view = id;
  for (const b of document.querySelectorAll("[data-view]")) b.setAttribute("aria-selected", String(Number(b.dataset.view) === id));
  $("kicker").innerHTML = `Act ${current.act} · View ${id} · ${current.name}`;
  $("q-title").textContent = current.question;
  $("q-body").textContent = current.body;
  $("limits").textContent = current.limits || "";
  setStageMode(current.stage, typeof current.lower === "function" ? current.lower(ctx) : current.lower);
  $("chart").replaceChildren(); $("lower").replaceChildren();
  const ctl = $("controls"); ctl.replaceChildren();
  current.controls?.(ctx, ctl);
  const dock = current.dock?.(ctx) || {};
  slider("slider-a", dock.a); slider("slider-b", dock.b);
  current.enter?.(ctx);
  history.replaceState(null, "", `#view=${id}`);
  render();
}

function render() {
  if (!current) return;
  const out = current.render(ctx) || {};
  const pass = $("passport"); pass.replaceChildren();
  for (const p of out.passport || []) pass.append(passLine(p.tag, p.cls, p.bits));
  kpis(out.kpis); inspector(out.inspector); legend(out.legend);
  checks([...(out.checks || [])]);
  $("frame-note").textContent = out.note || "";
  const canPlay = current.play ? current.play.can?.(ctx) ?? true : false;
  $("play").disabled = !canPlay; $("step").disabled = !(current.step);
  if (!canPlay && S.playing) { S.playing = false; $("play").textContent = "Play"; }
  if (out.syncA != null) $("slider-a")._sync?.(out.syncA);
  if (out.syncB != null) $("slider-b")._sync?.(out.syncB);
}

/* ---------------- play loop ---------------- */
let last = null;
function tick(now) {
  if (S.playing && current?.play) {
    const dt = last == null ? 0 : Math.min((now - last) / 1000, 0.1);
    current.play.tick(ctx, dt);
    render();
  }
  last = now;
  requestAnimationFrame(tick);
}

function reset() {
  const keep = { view: S.view, reduced: S.reduced };
  Object.assign(S, JSON.parse(JSON.stringify(DEFAULT_S)), keep);
  enterView(S.view);
}

function bind() {
  for (const b of document.querySelectorAll("[data-view]")) b.addEventListener("click", () => enterView(Number(b.dataset.view)));
  $("play").addEventListener("click", () => { S.playing = !S.playing; $("play").textContent = S.playing ? "Pause" : "Play"; if (S.playing) current.play?.start?.(ctx); });
  $("step").addEventListener("click", () => { current.step?.(ctx, 1); render(); });
  $("reset").addEventListener("click", reset);
  const motion = $("motion");
  const syncMotion = () => { motion.setAttribute("aria-pressed", String(S.reduced)); motion.textContent = `Reduced motion: ${S.reduced ? "on" : "off"}`; };
  motion.addEventListener("click", () => { S.reduced = !S.reduced; syncMotion(); render(); });
  syncMotion();
  window.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea")) return;
    if (/^[0-9]$/.test(e.key)) { enterView(e.key === "0" ? 10 : Number(e.key)); e.preventDefault(); }
    else if (e.key === " ") { $("play").click(); e.preventDefault(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { current.step?.(ctx, e.key === "ArrowRight" ? 1 : -1); render(); e.preventDefault(); }
    else if (e.key === "r" || e.key === "R") reset();
    else if (e.key === "p" || e.key === "P") { pin(); }
  });
}

export function pin() {
  const ex = experiment(S);
  const p = { radius: S.radius, speed: S.speed, gamma: S.gamma, kind: ex.el.kind };
  S.pins = [...S.pins.filter((q) => Math.abs(q.speed - p.speed) > 1e-9 || q.gamma !== p.gamma).slice(-2), p];
  render();
}

function provenance() {
  const p = data.prov;
  const root = $("prov");
  root.innerHTML = `
  <p><b>D1 active catalog</b> (CelesTrak GP, GROUP=active): ${fmt(p.gp.records)} records, element epochs ${p.gp.epoch_min.slice(0, 10)} to ${p.gp.epoch_max.slice(0, 10)}. SHA-256 <code>${p.gp.sha256}</code>.</p>
  <p><b>D2 satellite catalog</b> (CelesTrak SATCAT): ${fmt(p.satcat.rows)} rows, ${fmt(p.satcat.decayed)} decayed. SHA-256 <code>${p.satcat.sha256}</code>.</p>
  <p><b>Models.</b> Two-body (μ 398,600.4418 km³/s², universal variables, midterm code with its checks); SGP4/WGS72 (satellite.js 7.1.0, catalog theory, not a measurement); drag decay (simulation, Vallado 2013 exponential atmosphere); launch ascent (illustrative simulation of a generic two-stage rocket).</p>
  <p>Source code, raw snapshots and the pipeline: <a href="https://github.com/aageer/speed-decision-2" target="_blank" rel="noopener">github.com/aageer/speed-decision-2</a>. Midterm: <a href="https://the-speed-decision.vercel.app/" target="_blank" rel="noopener">the-speed-decision.vercel.app</a>.</p>`;
}

async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }

async function main() {
  bind();
  try {
    globe = mountGlobe($("gl"), $("markers"));
  } catch (e) {
    globe = null;
    $("frame-note").textContent = "WebGL did not start. The 3D views show their 2D charts only.";
  }
  const [catalog, bins, prov, story, checksFile, land] = await Promise.all([
    getJSON("data/catalog.json"), getJSON("data/satcat_bins.json"), getJSON("data/provenance.json"),
    getJSON("data/story.json"), getJSON("data/checks.json"), getJSON("data/land-110m.json"),
  ]);
  Object.assign(data, { catalog, bins, prov, story, checksFile, land });
  const { Catalog } = await import("./catalog.js");
  data.cat = new Catalog(catalog, prov);
  await data.cat.ready;
  data.live = runLiveChecks(data);
  ctx = { S, set, data, globe, chart: $("chart"), lower: $("lower"), stage, render: () => queueRender(), pin, enterView };
  provenance();
  $("loading").hidden = true;
  const m = location.hash.match(/view=(\d+)/);
  enterView(m ? Math.min(10, Math.max(1, Number(m[1]))) : 1);
  requestAnimationFrame(tick);
  window.__sd2 = { S, data, set, enterView, pin, render: () => render(), ready: true };
}
main().catch((e) => { $("loading").textContent = `Could not load the data: ${e.message}`; console.error(e); });
