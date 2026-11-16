import { simulate, series, LAT_DEG, OMEGA } from "../ascent.js";
import { MU_NGA, REQ_WGS84, classify, family, propagate, samplePath, stateFromSpeed, thresholds } from "../kepler.js";
import { experiment, STAGE_COLOR, CLASS_COLOR } from "../model.js";
import { frame, el, path } from "../svg.js";
import { pick as pickChecks } from "../checks.js";
import { fmt, seg, button, row, statePassport, speedBands } from "./common.js";

const LAT = (LAT_DEG * Math.PI) / 180;
const E1 = [Math.cos(LAT), 0, Math.sin(LAT)], E2 = [0, 1, 0];
const to3 = (x, y) => [x * E1[0] + y * E2[0], x * E1[1] + y * E2[1], x * E1[2] + y * E2[2]];
const THETA0 = (80.6 * Math.PI) / 180; // puts Cape Canaveral (80.6° W) under the start point
const COAST_MAX = 2 * 3600;
const FAN = [6.0, 7.0, 7.4, 7.534, 7.62, 7.75, 8.2, 9.0, 10.0, 10.9, 11.6];

let simKey = null, sim = null;
function getSim(burn) {
  const key = burn.toFixed(4);
  if (key !== simKey) {
    const s = simulate(burn);
    const ser = series(s.rows);
    const el0 = classify(s.r, s.v, MU_NGA, REQ_WGS84);
    const coast = samplePath(s.r, s.v, MU_NGA, REQ_WGS84, 721);
    const coastEnd = Math.min(coast.horizon, el0.periodS ? el0.periodS * 1.25 : COAST_MAX, COAST_MAX);
    sim = { s, ser, el: el0, fam: family(el0.kind), coast, coastEnd, total: s.tCutoff + coastEnd };
    simKey = key;
  }
  return sim;
}
function rocketAt(sm, t) {
  if (t <= sm.s.tCutoff) {
    const rows = sm.s.rows; const dt = rows[1][0] - rows[0][0];
    const k = Math.min(rows.length - 1, Math.max(0, Math.round(t / dt)));
    return { p: [rows[k][1], rows[k][2]], v: [rows[k][3], rows[k][4]], phase: rows[k][5], row: k };
  }
  const st = propagate(sm.s.r, sm.s.v, t - sm.s.tCutoff, MU_NGA);
  return { p: [st.r[0], st.r[1]], v: [st.v[0], st.v[1]], phase: 3 };
}

export default {
  id: 3, act: "II", name: "Launch to orbit", stage: "globe", lower: (ctx) => ctx.S.launchMode === "rocket",
  question: "How does a satellite get into orbit, and when does it stay up?",
  body: "A rocket's real job is to give the satellite a state: a height, a speed and a direction. Climbing 400 km is the easy part. The hard part is the sideways speed: the satellite stays up only when its sideways speed reaches the circular speed for its height (about 7.66 km/s at 420 km). Drag the burn slider: stop the second stage one percent early and the same rocket falls back to Earth.",
  limits: "Illustrative simulation of a generic two-stage rocket: point mass, one plane, no air drag. It is not a real vehicle. After engine cutoff the path is the two-body model.",
  controls(ctx, root) {
    const { S } = ctx;
    seg(root, "Mode", [["rocket", "Rocket ascent"], ["cannon", "Newton's cannon (fan)"]], S.launchMode, (k) => { S.launchMode = k; S.launchT = 0; ctx.enterView(3); });
    if (S.launchMode === "rocket") {
      const box = document.createElement("div"); box.className = "ctl"; box.innerHTML = '<span class="eb">Stage-2 burn presets</span>'; root.append(box);
      const r = row(box);
      for (const f of [0.6, 0.95, 0.99, 1.0]) button(r, `${Math.round(f * 100)} %`, () => { S.burn = f; S.launchT = 0; ctx.enterView(3); });
      const b2 = row(root);
      button(b2, "Hand this state to Views 4–7", () => {
        const sm = getSim(S.burn); const r0 = Math.hypot(sm.s.r[0], sm.s.r[1]);
        ctx.set({ radius: r0, speed: Math.hypot(sm.s.v[0], sm.s.v[1]), gamma: sm.el.gammaDeg, stateSource: `rocket at engine cutoff (stage-2 burn ${Math.round(S.burn * 100)} %)`, pins: [] });
      });
    } else {
      const r = row(root); button(r, "Pin this speed (P)", () => ctx.pin()); button(r, "Clear pins", () => ctx.set({ pins: [] }));
    }
  },
  dock(ctx) {
    const { S } = ctx;
    if (S.launchMode === "rocket") {
      const sm = getSim(S.burn);
      return {
        a: { label: "Mission time", min: 0, max: sm.total, step: 0.5, value: S.launchT, format: (v) => (v < 600 ? `${fmt(v)}<small> s</small>` : `${fmt(v / 60, 1)}<small> min</small>`), onInput: (v) => ctx.set({ launchT: v }) },
        b: { label: "Stage-2 burn", min: 0, max: 1, step: 0.001, value: S.burn, format: (v) => `${fmt(v * 100, 1)}<small> %</small>`, onInput: (v) => { S.burn = v; S.launchT = Math.min(S.launchT, getSim(v).total); ctx.render(); },
        },
      };
    }
    const cuts = thresholds(S.radius, MU_NGA, REQ_WGS84);
    return {
      a: { label: "Time since launch", min: 0, max: 7200, step: 10, value: S.launchT, format: (v) => `${fmt(v / 60, 1)}<small> min</small>`, onInput: (v) => ctx.set({ launchT: v }) },
      b: { label: "Speed", min: 0, max: 12.5, step: 0.001, value: S.speed, format: (v) => `${fmt(v, 3)}<small> km/s</small>`, onInput: (v) => ctx.set({ speed: v, stateSource: "speed slider" }), bands: speedBands(cuts), ticks: [[cuts.vimp, fmt(cuts.vimp, 3)], [cuts.vesc, fmt(cuts.vesc, 3)]] },
    };
  },
  enter(ctx) { ctx.globe?.setShift(ctx.S.launchMode === "rocket" ? 0.17 : 0); ctx.globe?.frameTo(ctx.S.launchMode === "rocket" ? 10500 : 21000, ctx.S.launchMode === "rocket" ? [0.55, -1.1, 1.05] : [0.2, -0.4, 1.4]); },
  leave(ctx) { ctx.globe?.setShift(0); ctx.globe?.setLines([]); ctx.globe?.setMarkers([]); ctx.globe?.setParticles([]); },
  play: {
    can: () => true,
    start(ctx) { const S = ctx.S; const end = S.launchMode === "rocket" ? getSim(S.burn).total : 7200; if (S.launchT >= end - 1) S.launchT = 0; },
    tick(ctx, dt) {
      const S = ctx.S;
      if (S.launchMode === "rocket") {
        const sm = getSim(S.burn);
        const rate = S.reduced ? 20 : S.launchT < sm.s.tCutoff ? 40 : 300;
        S.launchT = Math.min(sm.total, S.launchT + dt * rate);
        if (S.launchT >= sm.total) S.playing = false;
      } else S.launchT = (S.launchT + dt * (S.reduced ? 60 : 300)) % 7200;
    },
  },
  step(ctx, sign) { const S = ctx.S; S.launchT = Math.max(0, S.launchT + sign * (S.launchMode === "rocket" ? 10 : 60)); },
  render(ctx) { return ctx.S.launchMode === "rocket" ? renderRocket(ctx) : renderCannon(ctx); },
};

function renderRocket(ctx) {
  const { S, globe, lower } = ctx;
  const sm = getSim(S.burn);
  const t = Math.min(S.launchT, sm.total);
  const now = rocketAt(sm, t);
  const rows = sm.s.rows;
  if (globe) {
    globe.setEarthAngle(THETA0 + OMEGA * t);
    globe.setSun([0.9, 0.35, 0.55], true);
    const s1 = [], s2 = [];
    for (const r of rows) (r[5] === 1 ? s1 : s2).push(to3(r[1], r[2]));
    if (s1.length && s2.length) s2.unshift(s1[s1.length - 1]);
    const coastPts = [];
    for (let i = 0; i < sm.coast.t.length; i += 1) { if (sm.coast.t[i] > sm.coastEnd) break; coastPts.push(to3(sm.coast.r[i][0], sm.coast.r[i][1])); }
    const famColor = STAGE_COLOR[sm.fam];
    globe.setLines([
      { points: s1, color: "#ffb347", width: 3 },
      { points: s2, color: "#ffe07a", width: 3 },
      { points: coastPts, color: famColor, width: 2.2, dashed: t < sm.s.tCutoff, opacity: t < sm.s.tCutoff ? 0.55 : 1 },
    ]);
    const trail = [];
    if (!S.reduced) for (let k = 1; k <= 14; k += 1) { const q = rocketAt(sm, Math.max(0, t - k * (t < sm.s.tCutoff ? 4 : 30))); trail.push({ p: to3(q.p[0], q.p[1]), color: "#fff2c4", size: Math.max(1.5, 7 - k * 0.4) }); }
    globe.setParticles(trail);
    globe.setMarkers([{ p: to3(now.p[0], now.p[1]), color: now.phase < 3 ? "#ffd166" : famColor, label: now.phase === 1 ? "stage 1 burning" : now.phase === 2 ? "stage 2 burning" : `coasting · ${sm.el.kind}` }]);
  }
  // Lower chart: altitude and speeds vs time.
  const ser = sm.ser;
  lower.replaceChildren();
  const W = lower.clientWidth, H = lower.clientHeight;
  const svg = el("svg", { width: W, height: H }); lower.append(svg);
  const tMax = sm.s.tCutoff + 60;
  const half = Math.floor(W * 0.5);
  const A = frame(svg, { width: half, height: H, margin: { l: 52, r: 12, t: 26, b: 34 }, x: { domain: [0, tMax] }, y: { domain: [0, 500], n: 5 }, xLabel: "seconds after lift-off", yLabel: "km", title: "Altitude" });
  A.plot.append(path(ser.filter((q) => q.t <= tMax).map((q) => [A.x(q.t), A.y(q.h)]), { stroke: "#101012", "stroke-width": 2 }));
  const B = frame(svg, { width: W - half, height: H, at: [half, 0], margin: { l: 46, r: 14, t: 26, b: 34 }, x: { domain: [0, tMax] }, y: { domain: [0, 8.5], n: 5 }, xLabel: "seconds after lift-off", yLabel: "km/s", title: "Sideways speed vs the speed needed to stay up" });
  B.plot.append(path(ser.filter((q) => q.t <= tMax).map((q) => [B.x(q.t), B.y(q.vc)]), { stroke: "#2a78d6", "stroke-width": 2, "stroke-dasharray": "6 4" }));
  B.plot.append(path(ser.filter((q) => q.t <= tMax).map((q) => [B.x(q.t), B.y(q.vh)]), { stroke: "#eb6834", "stroke-width": 2.2 }));
  B.plot.append(path(ser.filter((q) => q.t <= tMax).map((q) => [B.x(q.t), B.y(Math.max(q.vr, 0))]), { stroke: "#8b8a84", "stroke-width": 1.2 }));
  B.plot.append(el("text", { x: B.m.l + 8, y: B.y(7.0), class: "cap", style: "fill:#2a78d6" }, "dashed blue: circular speed needed at the current height"));
  B.plot.append(el("text", { x: B.m.l + 8, y: B.y(6.2), class: "cap", style: "fill:#c4521f" }, "orange: sideways speed · grey: upward speed"));
  for (const F of [A, B]) {
    const xt = F.x(Math.min(t, tMax));
    F.plot.append(el("line", { x1: xt, x2: xt, y1: F.m.t, y2: F.m.t + F.h, stroke: "#101012", "stroke-width": 1 }));
    if (sm.s.tSep) F.plot.append(el("line", { x1: F.x(sm.s.tSep), x2: F.x(sm.s.tSep), y1: F.m.t, y2: F.m.t + F.h, stroke: "#c9c8c0", "stroke-dasharray": "2 3" }));
    F.plot.append(el("line", { x1: F.x(sm.s.tCutoff), x2: F.x(sm.s.tCutoff), y1: F.m.t, y2: F.m.t + F.h, stroke: "#c0399a", "stroke-dasharray": "2 3" }));
  }
  A.plot.append(el("text", { x: A.x(sm.s.tSep || 0) + 3, y: A.y(470), class: "cap" }, "staging"));
  A.plot.append(el("text", { x: A.x(sm.s.tCutoff) - 3, y: A.y(470), class: "cap", "text-anchor": "end" }, "cutoff"));
  const k = Math.min(ser.length - 1, now.row ?? ser.length - 1);
  const q = t <= sm.s.tCutoff ? ser[k] : null;
  const rNow = Math.hypot(now.p[0], now.p[1]);
  const vNow = Math.hypot(now.v[0], now.v[1]);
  const vhNow = (-now.v[0] * now.p[1] + now.v[1] * now.p[0]) / rNow;
  const vcNow = Math.sqrt(MU_NGA / rNow);
  const famColor = CLASS_COLOR[sm.fam];
  const hp = sm.el.periapsis - REQ_WGS84, ha = sm.el.apoapsis ? sm.el.apoapsis - REQ_WGS84 : null;
  return {
    passport: [{ tag: "simulation", cls: "sim", bits: ["generic two-stage rocket", "no air drag", `lat ${LAT_DEG}°`, { text: "illustrative, not a real vehicle", cls: "dim" }] },
      { tag: "two-body model", cls: "model", bits: [`after cutoff: ${sm.el.kind}`, `r ${fmt(sm.el.radius, 1)} km`, `v ${fmt(sm.el.speed, 3)} km/s`, `γ ${fmt(sm.el.gammaDeg, 2)}°`] }],
    kpis: [
      { value: fmt(rNow - REQ_WGS84, 1), unit: " km", label: "altitude now" },
      { value: fmt(vhNow, 3), unit: ` / ${fmt(vcNow, 3)}`, label: "sideways speed / needed (km/s)" },
      { value: sm.el.kind, dot: famColor, label: `after cutoff at ${fmt(sm.s.tCutoff, 0)} s` },
      { value: fmt(hp, 0), unit: " km", label: "lowest point of that path (perigee)" },
    ],
    inspector: [["Stage-2 burn", `${fmt(S.burn * 100, 1)} % of propellant`], ["Cutoff speed", `${fmt(sm.el.speed, 4)} km/s`], ["Cutoff flight-path angle", `${fmt(sm.el.gammaDeg, 3)}°`], ["Apogee altitude", ha != null ? `${fmt(ha, 1)} km` : "none (open path)"], ["Period", sm.el.periodS ? `${fmt(sm.el.periodS / 60, 2)} min` : "not offered"], ["Speed from Earth's spin", "0.409 km/s at 28.5°"], ["Phase now", now.phase === 1 ? "stage 1" : now.phase === 2 ? "stage 2" : "coast (two-body)"]],
    legend: [{ label: "stage 1 (gravity turn)", color: "#ffb347" }, { label: "stage 2 (builds sideways speed)", color: "#ffe07a" }, { label: `path after cutoff: ${sm.el.kind}`, color: STAGE_COLOR[sm.fam] }],
    note: "Equal scale. Earth turns at its real rate under the launch site (28.5° N, 80.6° W).",
    checks: pickChecks(ctx.data.live, ["A1", "P3"]),
    syncA: t,
  };
}

function renderCannon(ctx) {
  const { S, globe, lower } = ctx;
  const ex = experiment(S);
  const t = S.launchT;
  if (globe) {
    globe.setEarthAngle(OMEGA * t);
    globe.setSun([0.9, 0.35, 0.55], true);
    const lines = [], parts = [];
    const speeds = [...FAN, ...S.pins.map((p) => p.speed)];
    for (const v of speeds) {
      const init = stateFromSpeed(S.radius, v, S.gamma);
      const sp = samplePath(init.r, init.v, MU_NGA, REQ_WGS84, 361);
      const fam = family(sp.elements.kind);
      lines.push({ points: sp.r.filter((_, i) => sp.t[i] <= 7200), color: STAGE_COLOR[fam], width: 1.2, opacity: 0.5 });
      const end = sp.hitTime ?? Math.min(sp.horizon, 7200);
      const tt = sp.elements.periodS ? t % sp.elements.periodS : Math.min(t, end);
      const st = propagate(init.r, init.v, tt, MU_NGA);
      parts.push({ p: st.r, color: STAGE_COLOR[fam], size: 6 });
    }
    lines.push({ points: ex.sample.r, color: "#ffffff", width: 3 });
    const end = ex.sample.hitTime ?? ex.sample.horizon;
    const tt = ex.el.periodS ? t % ex.el.periodS : Math.min(t, end);
    const cur = propagate(ex.init.r, ex.init.v, tt, MU_NGA);
    globe.setLines(lines);
    globe.setParticles(S.reduced ? [] : parts);
    globe.setMarkers([{ p: cur.r, color: "#ffffff", label: `${fmt(S.speed, 3)} km/s · ${ex.el.kind}` }, { p: ex.init.r, color: "#ffd166", size: 8 }]);
  }
  lower.replaceChildren();
  const cuts = thresholds(S.radius, MU_NGA, REQ_WGS84);
  return {
    passport: statePassport(S, ex.el),
    kpis: [
      { value: ex.el.kind, dot: CLASS_COLOR[ex.fam], label: "class of the white path" },
      { value: fmt(S.speed, 3), unit: " km/s", label: "launch speed (sideways)" },
      { value: fmt(cuts.vimp, 3), unit: " km/s", label: "impact cut at this height" },
      { value: fmt(cuts.vesc, 3), unit: " km/s", label: "escape cut at this height" },
    ],
    inspector: [["Height of the start", `${fmt(S.radius - REQ_WGS84, 1)} km`], ["Circular speed", `${fmt(cuts.vc, 3)} km/s`], ["Pins", S.pins.length ? S.pins.map((p) => fmt(p.speed, 3)).join(", ") : "none"], ["Dots", "each dot moves at its own path's true speed"]],
    legend: [{ label: "impact", color: STAGE_COLOR.impact }, { label: "closed orbit", color: STAGE_COLOR.closed }, { label: "escape", color: STAGE_COLOR.escape }, { label: "your speed", color: "#ffffff" }],
    note: "Newton's cannon: the same start, eleven speeds. Each moving dot keeps model time, so faster paths pull ahead.",
    checks: pickChecks(ctx.data.live, ["C1", "B1"]),
    syncA: t, syncB: S.speed,
  };
}
