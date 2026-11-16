import { frame, el, path, overlayCanvas, showTip, hideTip } from "../svg.js";
import { MU_NGA, REQ_WGS84, thresholds } from "../kepler.js";
import { classOf, experiment, CLASS_COLOR } from "../model.js";
import { fmt, statePassport, button, row, speedBands } from "./common.js";

const FILL = { impact: [246, 210, 192], closed: [207, 224, 241], escape: [238, 213, 230] };
let rasterKey = "", raster = null;

export function conicInset(svg, x0, y0, size, ex, title = "The path of this state") {
  const g = svg.appendChild(el("g", { transform: `translate(${x0},${y0})` }));
  g.append(el("rect", { x: 0, y: 0, width: size, height: size, rx: 12, fill: "#fbfbf9", stroke: "#dcdbd5" }));
  g.append(el("text", { x: 12, y: 20, class: "ttl" }, title));
  const pts = ex.sample.r;
  let ext = REQ_WGS84 * 1.25;
  for (const p of pts) ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1]));
  ext = Math.min(ext, REQ_WGS84 * 4.2);
  const c = size / 2, s = (size / 2 - 18) / ext;
  const P = (p) => [c + p[0] * s, c + 8 - p[1] * s];
  g.append(el("circle", { cx: c, cy: c + 8, r: REQ_WGS84 * s, fill: "#dfe9f2", stroke: "#9cb6cc" }));
  g.append(el("text", { x: c, y: c + 12, "text-anchor": "middle", class: "cap" }, "Earth"));
  const clip = `ci${Math.random().toString(36).slice(2, 7)}`;
  const defs = svg.querySelector("defs") || svg.insertBefore(el("defs"), svg.firstChild);
  defs.appendChild(el("clipPath", { id: clip })).append(el("rect", { x: 0, y: 26, width: size, height: size - 26 }));
  const fam = ex.fam;
  g.append(path(pts.map(P), { stroke: CLASS_COLOR[fam], "stroke-width": 2.4, "clip-path": `url(#${clip})` }));
  const st = P(pts[0]);
  g.append(el("circle", { cx: st[0], cy: st[1], r: 4.5, fill: "#101012" }));
  g.append(el("text", { x: 12, y: size - 10, class: "cap" }, `${ex.el.kind} · equal scale`));
  return g;
}

export default {
  id: 4, act: "II", name: "Decision map", stage: "chart",
  question: "Does the direction of the speed move the cuts?",
  body: "The midterm locked the flight-path angle γ at zero (sideways). Here every speed and every angle at the current height is coloured by its fate, computed from the analytic rule: impact if the forward path reaches the ground, otherwise closed if energy is negative, escape if not. The γ = 0 line is the midterm story. Click or drag anywhere to set the shared state.",
  limits: "Two-body model, point-mass Earth. Boundaries are analytic curves, not fitted.",
  controls(ctx, root) {
    const r = row(root);
    button(r, "γ = 0 (midterm)", () => ctx.set({ gamma: 0, stateSource: "decision map" }));
    button(r, "Aim 5° down", () => ctx.set({ gamma: -5, stateSource: "decision map" }));
    button(r, "Pin (P)", () => ctx.pin());
  },
  dock(ctx) {
    const { S } = ctx; const cuts = thresholds(S.radius, MU_NGA, REQ_WGS84);
    return {
      a: { label: "Speed", min: 0, max: 12.5, step: 0.001, value: S.speed, format: (v) => `${fmt(v, 3)}<small> km/s</small>`, onInput: (v) => ctx.set({ speed: v, stateSource: "speed slider" }), bands: speedBands(cuts) },
      b: { label: "Flight-path angle γ", min: -80, max: 80, step: 0.1, value: S.gamma, format: (v) => `${fmt(v, 1)}<small>°</small>`, onInput: (v) => ctx.set({ gamma: v, stateSource: "angle slider" }) },
    };
  },
  step(ctx, sign) { ctx.S.speed = Math.max(0, Math.min(12.5, ctx.S.speed + sign * 0.01)); },
  render(ctx) {
    const { S, chart } = ctx;
    chart.replaceChildren();
    const W = chart.clientWidth, H = chart.clientHeight;
    const inset = Math.min(300, Math.floor(W * 0.3));
    const svg = el("svg", { width: W, height: H }); chart.append(svg);
    const F = frame(svg, { width: W - inset - 16, height: H, margin: { l: 58, r: 14, t: 40, b: 48 }, x: { domain: [0, 12.5] }, y: { domain: [-80, 80], n: 8 }, xLabel: "speed v (km/s)", yLabel: "flight-path angle γ (degrees, up is positive)", title: `Fate of every (speed, angle) at ${fmt(S.radius - REQ_WGS84, 1)} km` });
    const key = `${S.radius}|${Math.round(F.w)}|${Math.round(F.h)}`;
    const cx = overlayCanvas(chart, F.m.l, F.m.t, F.w, F.h);
    if (key !== rasterKey) {
      const nx = Math.round(F.w), ny = Math.round(F.h);
      raster = new ImageData(nx, ny);
      for (let j = 0; j < ny; j += 1) {
        const g = 80 - (160 * (j + 0.5)) / ny;
        for (let i = 0; i < nx; i += 1) {
          const v = (12.5 * (i + 0.5)) / nx;
          const c = FILL[classOf(S.radius, v, g)];
          const o = (j * nx + i) * 4; raster.data[o] = c[0]; raster.data[o + 1] = c[1]; raster.data[o + 2] = c[2]; raster.data[o + 3] = 255;
        }
      }
      rasterKey = key;
    }
    const off = document.createElement("canvas"); off.width = raster.width; off.height = raster.height; off.getContext("2d").putImageData(raster, 0, 0);
    cx.drawImage(off, 0, 0, F.w, F.h);
    const cuts = thresholds(S.radius, MU_NGA, REQ_WGS84);
    F.plot.append(el("line", { x1: F.x(0), x2: F.x(12.5), y1: F.y(0), y2: F.y(0), stroke: "#101012", "stroke-width": 1.4 }));
    F.plot.append(el("text", { x: F.x(0.2), y: F.y(0) - 6, class: "lbl" }, "γ = 0: the midterm slice"));
    for (const [v, lab] of [[cuts.vimp, "impact cut"], [cuts.vc, "circle"], [cuts.vesc, "escape"]]) {
      F.plot.append(el("circle", { cx: F.x(v), cy: F.y(0), r: 4, fill: "#fff", stroke: "#101012", "stroke-width": 1.5 }));
      F.plot.append(el("text", { x: F.x(v) + 4, y: F.y(0) + (lab === "circle" ? 30 : 16), class: "cap" }, `${lab} ${fmt(v, 3)}`));
    }
    F.plot.append(el("text", { x: F.x(2.2), y: F.y(45), class: "ttl", style: "fill:#c4521f" }, "IMPACT"));
    F.plot.append(el("text", { x: F.x(2.2), y: F.y(45) + 16, class: "cap" }, "the forward path meets the Earth"));
    F.plot.append(el("text", { x: F.x(cuts.vc + 0.5), y: F.y(4), class: "ttl", style: "fill:#1f6bc7" }, "CLOSED"));
    F.plot.append(el("text", { x: F.x(Math.min(cuts.vesc + 0.15, 11.4)), y: F.y(55), class: "ttl", style: "fill:#a12c80" }, "ESCAPE"));
    F.plot.append(el("text", { x: F.x(12.3), y: F.y(-70), "text-anchor": "end", class: "cap" }, "two-body boundaries: analytic, not fitted"));
    for (const p of S.pins) F.plot.append(el("rect", { x: F.x(p.speed) - 4, y: F.y(p.gamma) - 4, width: 8, height: 8, fill: "none", stroke: "#55544f", "stroke-width": 1.5 }));
    F.plot.append(el("circle", { cx: F.x(S.speed), cy: F.y(Math.max(-80, Math.min(80, S.gamma))), r: 7, fill: "#101012", stroke: "#fff", "stroke-width": 2 }));
    const hit = el("rect", { x: F.m.l, y: F.m.t, width: F.w, height: F.h, fill: "transparent", style: "cursor: crosshair" }); svg.append(hit);
    let down = false;
    const setFrom = (e) => { const b = svg.getBoundingClientRect(); const v = Math.max(0, Math.min(12.5, F.x.invert(e.clientX - b.left))), g = Math.max(-80, Math.min(80, F.y.invert(e.clientY - b.top))); S.speed = +v.toFixed(4); S.gamma = +g.toFixed(2); S.stateSource = "decision map click"; ctx.render(); };
    hit.addEventListener("pointerdown", (e) => { down = true; hit.setPointerCapture(e.pointerId); setFrom(e); });
    hit.addEventListener("pointermove", (e) => {
      if (down) { setFrom(e); return; }
      const b = svg.getBoundingClientRect(); const v = F.x.invert(e.clientX - b.left), g = F.y.invert(e.clientY - b.top);
      showTip(e.clientX, e.clientY, classOf(S.radius, v, g), [["speed", `${fmt(v, 3)} km/s`], ["angle", `${fmt(g, 1)}°`]]);
    });
    hit.addEventListener("pointerup", () => { down = false; });
    hit.addEventListener("pointerleave", hideTip);
    const ex = experiment(S);
    conicInset(svg, W - inset - 8, 40, inset, ex);
    return {
      passport: statePassport(S, ex.el),
      kpis: [{ value: ex.el.kind, dot: CLASS_COLOR[ex.fam], label: "fate of the state" }, { value: fmt(ex.el.periapsis - REQ_WGS84, 1), unit: " km", label: "lowest point (perigee)" }],
      inspector: [["Speed", `${fmt(S.speed, 4)} km/s`], ["Angle γ", `${fmt(S.gamma, 2)}°`], ["Energy ε", `${fmt(ex.el.epsilon, 3)} km²/s²`], ["Eccentricity", fmt(ex.el.eccentricity, 4)], ["State from", S.stateSource]],
      note: "Click or drag to set speed and angle · hover for the class",
      checks: [ctx.data.live.B1, ctx.data.live.B2, ctx.data.live.B3].filter(Boolean),
      syncA: S.speed, syncB: S.gamma,
    };
  },
};
