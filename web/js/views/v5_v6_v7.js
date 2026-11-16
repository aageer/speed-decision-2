import { frame, el, path, showTip, hideTip } from "../svg.js";
import { MU_NGA, REQ_WGS84, thresholds, stateFromSpeed, classify, propagate } from "../kepler.js";
import { experiment, CLASS_COLOR } from "../model.js";
import { fmt, statePassport, button, row, speedBands } from "./common.js";
import { conicInset } from "./v4_map.js";

function speedDock(ctx) {
  const { S } = ctx; const cuts = thresholds(S.radius, MU_NGA, REQ_WGS84);
  return { a: { label: "Speed", min: 0, max: 12.5, step: 0.001, value: S.speed, format: (v) => `${fmt(v, 3)}<small> km/s</small>`, onInput: (v) => ctx.set({ speed: v, stateSource: "speed slider" }), bands: speedBands(cuts), ticks: [[cuts.vimp, fmt(cuts.vimp, 3)], [cuts.vesc, fmt(cuts.vesc, 3)]] } };
}
function pinControls(ctx, root) {
  const r = row(root);
  button(r, "Pin this speed (P)", () => ctx.pin());
  button(r, "Clear pins", () => ctx.set({ pins: [] }));
  for (const [v, t] of [[7.534241599, "grazing"], [7.657269485, "circle"], [8.040132959, "ellipse 1.05 v_c"], [10.829014356, "escape"]]) button(r, t, () => ctx.set({ speed: v, gamma: 0, radius: 6798.137, stateSource: `worked example: ${t}` }), "chip");
}
const famOf = (k) => (k === "impact" ? "impact" : k === "circle" || k === "ellipse" ? "closed" : "escape");
const elemsAt = (r, v, g) => { const s = stateFromSpeed(r, v, g); return classify(s.r, s.v, MU_NGA, REQ_WGS84); };

export const energy = {
  id: 5, act: "II", name: "Energy", stage: "chart",
  question: "Why does escape happen at one speed only?",
  body: "Specific energy ε = v²/2 − μ/r is kinetic plus potential energy on one zero. Escape is exactly where ε crosses zero. The impact cut does not flip the sign: a path that grazes the Earth still has negative energy, so it is bound and still hits. Energy explains escape; it cannot be the impact test.",
  limits: "Derived scalar from the two-body model. Bars share one fixed scale so the axis never moves with the slider.",
  controls: pinControls, dock: speedDock,
  step(ctx, s) { ctx.S.speed = Math.max(0, Math.min(12.5, ctx.S.speed + s * 0.01)); },
  render(ctx) {
    const { S, chart } = ctx; chart.replaceChildren();
    const W = chart.clientWidth, H = chart.clientHeight;
    const svg = el("svg", { width: W, height: H }); chart.append(svg);
    const ex = experiment(S);
    const pe = -MU_NGA / S.radius, lim = Math.ceil(Math.max(-pe, (12.5 ** 2) / 2) / 10) * 10;
    const left = Math.floor(W * 0.42);
    const states = [...S.pins.map((p, i) => ({ ...p, label: `pin ${"ABC"[i]}` })), { speed: S.speed, gamma: S.gamma, radius: S.radius, label: "now" }];
    const A = frame(svg, { width: left, height: H, margin: { l: 58, r: 10, t: 40, b: 48 }, x: { domain: [0, states.length] }, y: { domain: [-lim, lim], n: 8 }, xFmt: () => "", grid: true, yLabel: "km²/s²", title: "Energy ledger (fixed scale)" });
    A.plot.append(el("line", { x1: A.m.l, x2: A.m.l + A.w, y1: A.y(0), y2: A.y(0), stroke: "#101012", "stroke-width": 1.4 }));
    states.forEach((st, i) => {
      const ke = (st.speed ** 2) / 2, p = -MU_NGA / st.radius, e = ke + p;
      const el0 = elemsAt(st.radius, st.speed, st.gamma); const fam = famOf(el0.kind);
      const bw = (A.w / states.length) * 0.22, x0 = A.x(i + 0.5);
      for (const [k, val, col] of [[-1, ke, "#8fb8de"], [0, p, "#bdbcb6"], [1, e, CLASS_COLOR[fam]]]) {
        const y0 = A.y(Math.max(0, val)), y1 = A.y(Math.min(0, val));
        A.plot.append(el("rect", { x: x0 + k * bw * 1.15 - bw / 2, y: y0, width: bw, height: Math.max(1, y1 - y0), fill: col }));
      }
      A.plot.append(el("text", { x: x0, y: A.m.t + A.h + 16, "text-anchor": "middle", class: "lbl" }, `${st.label} ${fmt(st.speed, 3)}`));
      A.plot.append(el("text", { x: x0 + bw * 1.15, y: A.y(e) + (e >= 0 ? -6 : 14), "text-anchor": "middle", class: "cap" }, fmt(e, 3)));
    });
    A.g.append(el("text", { x: 60, y: 34, class: "cap" }, "blue: kinetic v²/2 · grey: potential −μ/r · coloured: total ε"));
    const B = frame(svg, { width: W - left, height: H, at: [left, 0], margin: { l: 56, r: 18, t: 40, b: 48 }, x: { domain: [0, 12.5] }, y: { domain: [-lim, 30], n: 6 }, xLabel: "speed v (km/s)", yLabel: "ε (km²/s²)", title: "Total energy against speed at this height" });
    const pts = []; for (let i = 0; i <= 250; i += 1) { const v = (12.5 * i) / 250; pts.push([B.x(v), B.y((v * v) / 2 - MU_NGA / S.radius)]); }
    B.plot.append(path(pts, { stroke: "#101012", "stroke-width": 2 }));
    B.plot.append(el("line", { x1: B.m.l, x2: B.m.l + B.w, y1: B.y(0), y2: B.y(0), stroke: "#c0399a", "stroke-dasharray": "5 4" }));
    const cuts = thresholds(S.radius, MU_NGA, REQ_WGS84);
    for (const [v, t, c] of [[cuts.vimp, "impact cut: ε still < 0", "#eb6834"], [cuts.vesc, "escape: ε = 0", "#c0399a"]]) {
      B.plot.append(el("line", { x1: B.x(v), x2: B.x(v), y1: B.m.t, y2: B.m.t + B.h, stroke: c, "stroke-dasharray": "3 3" }));
      B.plot.append(el("text", { x: B.x(v) - 4, y: B.m.t + 14, "text-anchor": "end", class: "cap", fill: c }, t));
    }
    B.plot.append(el("circle", { cx: B.x(S.speed), cy: B.y(ex.el.epsilon), r: 6, fill: CLASS_COLOR[ex.fam], stroke: "#fff", "stroke-width": 2 }));
    return {
      passport: statePassport(S, ex.el, { tag: "derived scalar", cls: "derived" }),
      kpis: [{ value: fmt(ex.el.epsilon, 3), unit: " km²/s²", label: "specific energy ε" }, { value: ex.el.kind, dot: CLASS_COLOR[ex.fam], label: "class" }, { value: fmt((S.speed ** 2) / 2, 3), unit: "", label: "kinetic v²/2" }, { value: fmt(-MU_NGA / S.radius, 3), unit: "", label: "potential −μ/r" }],
      inspector: [["Escape speed here", `${fmt(cuts.vesc, 6)} km/s`], ["Impact cut here", `${fmt(cuts.vimp, 6)} km/s`], ["ε at the impact cut", fmt((cuts.vimp ** 2) / 2 - MU_NGA / S.radius, 3)]],
      checks: [ctx.data.live.C1].filter(Boolean),
      syncA: S.speed,
    };
  },
};

export const shape = {
  id: 6, act: "II", name: "Shape", stage: "chart",
  question: "Is the shape of the path its fate? Where does the lowest point reach the ground?",
  body: "Eccentricity e measures how stretched the path is. It is 1 for a straight fall at v = 0 and again at escape: the same number for opposite fates, so shape is not the class. The perigee (lowest point) is the impact test: it crosses the ground exactly at the impact cut. Pins appear on both panels.",
  limits: "Two-body model at the current height and angle.",
  controls: pinControls, dock: speedDock,
  step(ctx, s) { ctx.S.speed = Math.max(0, Math.min(12.5, ctx.S.speed + s * 0.01)); },
  render(ctx) {
    const { S, chart } = ctx; chart.replaceChildren();
    const W = chart.clientWidth, H = chart.clientHeight;
    const svg = el("svg", { width: W, height: H }); chart.append(svg);
    const inset = Math.min(300, Math.floor(W * 0.3));
    const pw = W - inset - 16, ph = Math.floor(H / 2);
    const vs = []; for (let i = 1; i <= 300; i += 1) vs.push((12.4 * i) / 300);
    const rows = vs.map((v) => { const e = elemsAt(S.radius, v, S.gamma); return { v, e: e.eccentricity, hp: e.periapsis - REQ_WGS84 }; });
    const A = frame(svg, { width: pw, height: ph, margin: { l: 58, r: 12, t: 36, b: 26 }, x: { domain: [0, 12.5] }, y: { domain: [0, 1.6], n: 4 }, xFmt: () => "", title: "Eccentricity e (dimensionless)" });
    A.plot.append(path(rows.map((r) => [A.x(r.v), A.y(Math.min(r.e, 1.6))]), { stroke: "#101012", "stroke-width": 2 }));
    A.plot.append(el("line", { x1: A.m.l, x2: A.m.l + A.w, y1: A.y(1), y2: A.y(1), stroke: "#8b8a84", "stroke-dasharray": "4 4" }));
    A.plot.append(el("text", { x: A.x(0.2), y: A.y(1) - 6, class: "cap" }, "e = 1: radial fall here, escape there"));
    const B = frame(svg, { width: pw, height: H - ph, at: [0, ph], margin: { l: 58, r: 12, t: 30, b: 46 }, x: { domain: [0, 12.5] }, y: { domain: [-6500, 2500], n: 6 }, xLabel: "speed v (km/s)", title: "Perigee altitude h_p (km) — below 0 the path meets the Earth" });
    B.plot.append(el("rect", { x: B.m.l, y: B.y(0), width: B.w, height: B.y(-6500) - B.y(0), fill: "rgba(235,104,52,.07)" }));
    B.plot.append(path(rows.map((r) => [B.x(r.v), B.y(Math.max(-6500, Math.min(2500, r.hp)))]), { stroke: "#eb6834", "stroke-width": 2 }));
    B.plot.append(el("line", { x1: B.m.l, x2: B.m.l + B.w, y1: B.y(0), y2: B.y(0), stroke: "#eb6834", "stroke-dasharray": "4 4" }));
    const ex = experiment(S);
    for (const F of [A, B]) {
      for (const p of S.pins) F.plot.append(el("line", { x1: F.x(p.speed), x2: F.x(p.speed), y1: F.m.t, y2: F.m.t + F.h, stroke: "#8b8a84", "stroke-dasharray": "3 3" }));
      F.plot.append(el("line", { x1: F.x(S.speed), x2: F.x(S.speed), y1: F.m.t, y2: F.m.t + F.h, stroke: CLASS_COLOR[ex.fam], "stroke-width": 2 }));
    }
    const cuts = thresholds(S.radius, MU_NGA, REQ_WGS84);
    if (Math.abs(S.gamma) < 1e-9) B.plot.append(el("text", { x: B.x(cuts.vimp) + 4, y: B.y(0) - 6, class: "cap", fill: "#c4521f" }, `h_p = 0 at ${fmt(cuts.vimp, 3)} km/s (impact cut)`));
    conicInset(svg, W - inset - 8, 36, inset, ex);
    return {
      passport: statePassport(S, ex.el, { tag: "derived scalar", cls: "derived" }),
      kpis: [{ value: fmt(ex.el.eccentricity, 4), label: "eccentricity e" }, { value: fmt(ex.el.periapsis - REQ_WGS84, 1), unit: " km", label: "perigee altitude" }, { value: ex.el.apoapsis ? fmt(ex.el.apoapsis - REQ_WGS84, 1) : "none", unit: ex.el.apoapsis ? " km" : "", label: "apogee altitude" }, { value: ex.el.kind, dot: CLASS_COLOR[ex.fam], label: "class" }],
      inspector: [["Pins", S.pins.length ? S.pins.map((p) => `${fmt(p.speed, 3)} (${p.kind})`).join(", ") : "none"], ["Angle γ", `${fmt(S.gamma, 2)}°`]],
      checks: [ctx.data.live.B3, ctx.data.live.B1].filter(Boolean),
      syncA: S.speed,
    };
  },
};

export const clock = {
  id: 7, act: "II", name: "Clock", stage: "chart",
  question: "What does a closed orbit do over time?",
  body: "A closed orbit repeats. Each coloured wedge is swept in the same time (one twelfth of the period), and every wedge has the same area: this is Kepler's second law. Near the Earth the wedge is short and wide, far away it is long and thin, so the satellite is fast at perigee and slow at apogee. Open paths and impacts get no period.",
  limits: "Two-body model. Reduced motion shows the wedges without the moving dot.",
  controls: pinControls, dock: speedDock,
  play: { can: (ctx) => Boolean(experiment(ctx.S).el.periodS), tick(ctx, dt) { const T = experiment(ctx.S).el.periodS; ctx.S.clockT = (ctx.S.clockT + dt * (T / 12)) % T; } },
  step(ctx, s) { const T = experiment(ctx.S).el.periodS; if (T) ctx.S.clockT = (ctx.S.clockT + s * 30 + T) % T; },
  render(ctx) {
    const { S, chart } = ctx; chart.replaceChildren();
    const W = chart.clientWidth, H = chart.clientHeight;
    const svg = el("svg", { width: W, height: H }); chart.append(svg);
    const ex = experiment(S);
    const T = ex.el.periodS;
    const left = Math.floor(W * 0.55);
    const size = Math.min(left - 20, H - 60);
    const g = svg.appendChild(el("g", { transform: `translate(${(left - size) / 2},${40})` }));
    svg.append(el("text", { x: 16, y: 24, class: "ttl" }, "Equal times sweep equal areas"));
    const pts = ex.sample.r;
    let ext = REQ_WGS84 * 1.25; for (const p of pts) ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1]));
    ext = Math.min(ext, REQ_WGS84 * 6);
    const c = size / 2, s = (size / 2 - 10) / ext, P = (p) => [c + p[0] * s, c - p[1] * s];
    const areas = [];
    if (T) {
      const N = 12;
      for (let k = 0; k < N; k += 1) {
        const arc = []; for (let j = 0; j <= 64; j += 1) arc.push(propagate(ex.init.r, ex.init.v, (T * (k + j / 64)) / N, MU_NGA).r);
        let A2 = 0; for (let j = 0; j < arc.length - 1; j += 1) A2 += arc[j][0] * arc[j + 1][1] - arc[j + 1][0] * arc[j][1];
        areas.push(Math.abs(A2) / 2);
        g.append(el("path", { d: `M${c},${c}L${arc.map((q) => P(q).join(",")).join("L")}Z`, fill: k % 2 ? "rgba(42,120,214,.20)" : "rgba(42,120,214,.38)", stroke: "#fff", "stroke-width": 0.6 }));
      }
    }
    g.append(el("circle", { cx: c, cy: c, r: REQ_WGS84 * s, fill: "#dfe9f2", stroke: "#9cb6cc" }));
    g.append(path(pts.map(P), { stroke: CLASS_COLOR[ex.fam], "stroke-width": 2.2 }));
    const tt = T ? S.clockT % T : 0;
    const now = propagate(ex.init.r, ex.init.v, tt, MU_NGA);
    const np = P(now.r);
    if (T && !S.reduced) g.append(el("circle", { cx: np[0], cy: np[1], r: 6.5, fill: "#101012", stroke: "#fff", "stroke-width": 2 }));
    const B = frame(svg, { width: W - left, height: H, at: [left, 0], margin: { l: 58, r: 16, t: 40, b: 48 }, x: { domain: [0, T ? T / 60 : 100] }, y: { domain: [0, Math.max(500, ...ex.sample.r.map((p) => Math.hypot(p[0], p[1]) - REQ_WGS84)) * 1.08], n: 5 }, xLabel: "minutes", yLabel: "km", title: T ? "Altitude and speed over one period" : "No period: the path does not close" });
    if (T) {
      const alt = [], spd = []; const N = 200; let vmax = 0;
      for (let i = 0; i <= N; i += 1) { const st = propagate(ex.init.r, ex.init.v, (T * i) / N, MU_NGA); const h = Math.hypot(...st.r) - REQ_WGS84, v = Math.hypot(...st.v); vmax = Math.max(vmax, v); alt.push([(T * i) / N / 60, h]); spd.push([(T * i) / N / 60, v]); }
      B.plot.append(path(alt.map(([t, h]) => [B.x(t), B.y(h)]), { stroke: "#101012", "stroke-width": 2 }));
      const yv = (v) => B.m.t + B.h - (v / (vmax * 1.1)) * B.h;
      B.plot.append(path(spd.map(([t, v]) => [B.x(t), yv(v)]), { stroke: "#2a78d6", "stroke-width": 1.6, "stroke-dasharray": "5 3" }));
      B.plot.append(el("text", { x: B.m.l + 6, y: B.m.t + 14, class: "cap", fill: "#2a78d6" }, "dashed: speed (scaled to the panel)"));
      B.plot.append(el("line", { x1: B.x(tt / 60), x2: B.x(tt / 60), y1: B.m.t, y2: B.m.t + B.h, stroke: "#101012" }));
    }
    const v = Math.hypot(...now.v), h = Math.hypot(...now.r) - REQ_WGS84;
    return {
      passport: statePassport(S, ex.el),
      kpis: [{ value: T ? fmt(T / 60, 3) : "none", unit: T ? " min" : "", label: "period" }, { value: T ? fmt(T / 12 / 60, 3) : "–", unit: T ? " min" : "", label: "time per wedge (T/12)" }, { value: fmt(h, 1), unit: " km", label: "altitude now" }, { value: fmt(v, 3), unit: " km/s", label: "speed now" }],
      inspector: [["Speed at perigee", ex.el.apoapsis ? `${fmt(ex.el.h / ex.el.periapsis, 3)} km/s` : "–"], ["Speed at apogee", ex.el.apoapsis ? `${fmt(ex.el.h / ex.el.apoapsis, 3)} km/s` : "–"], ["Time in orbit", `${fmt(tt / 60, 2)} min`]],
      note: T ? "Play moves the dot one wedge per second" : "Play is off: this path has no period",
      checks: areas.length ? [(() => { const mx = Math.max(...areas), mn = Math.min(...areas); const spread = (mx - mn) / mx; return { name: "Wedge areas are equal (Kepler II)", status: spread < 1e-3 ? "pass" : "fail", detail: `12 wedges, area spread ${(spread * 100).toFixed(4)} % (polygon estimate)` }; })()] : [{ name: "No period for an open path or an impact", status: "pass", detail: "play is off" }],
      syncA: S.speed,
    };
  },
};
