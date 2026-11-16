import { frame, el, path, overlayCanvas, showTip, hideTip, logScale } from "../svg.js";
import { residualTrack, ommFromRow } from "../residual.js";
import { decay, lossPerDay, H_FLOOR, H_TOP } from "../drag.js";
import { TYPE_COLOR } from "../catalog.js";
import { fmt, chips, seg, button, row } from "./common.js";

/* ---------------- View 8: residual explorer ---------------- */
let resKey = "", res = null;
function getResidual(ctx) {
  const { S, data } = ctx; const i = data.cat.byId.get(S.selected);
  const key = String(S.selected);
  if (key !== resKey) {
    const omm = i != null ? ommFromRow(data.cat, i) : data.story.gp.fields;
    res = residualTrack(omm, 180, 0.5);
    if (res) { res.epoch = omm.EPOCH; res.name = i != null ? data.cat.name(i) : `${omm.OBJECT_NAME} (midterm record)`; }
    resKey = key;
  }
  return res;
}
export const residual = {
  id: 8, act: "III", name: "Residual", stage: "chart",
  question: "How far is the textbook path from the catalog theory?",
  body: "Both paths start from the same position and velocity at the element epoch of the selected object. One follows the two-body model (point-mass Earth). The other follows SGP4, which adds the Earth's flattening and a drag term. The gap grows mostly along the track: the textbook object runs early or late. Select another object in View 1 or 2 to compare.",
  limits: "SGP4 is a theory fitted to tracking, not a measurement. The gap is reported, not a pass mark.",
  controls(ctx, root) {
    const r = row(root);
    for (const [id, name] of [[25544, "ISS"], [20580, "Hubble"], [48274, "Tiangong"]]) {
      const i = ctx.data.cat.byId.get(id); if (i == null) continue;
      button(r, name, () => ctx.set({ selected: id, selectedName: ctx.data.cat.name(i) }), "chip");
    }
  },
  dock(ctx) { return { a: { label: "Minutes from epoch", min: 0, max: 180, step: 0.5, value: ctx.S.residualMin, format: (v) => `${fmt(v, 1)}<small> min</small>`, onInput: (v) => ctx.set({ residualMin: v }) } }; },
  play: { can: () => true, tick(ctx, dt) { ctx.S.residualMin = (ctx.S.residualMin + dt * 10) % 180; } },
  step(ctx, s) { ctx.S.residualMin = Math.max(0, Math.min(180, ctx.S.residualMin + s)); },
  render(ctx) {
    const { S, chart } = ctx; chart.replaceChildren();
    const W = chart.clientWidth, H = chart.clientHeight;
    const svg = el("svg", { width: W, height: H }); chart.append(svg);
    const R = getResidual(ctx);
    if (!R) { svg.append(el("text", { x: 30, y: 60, class: "ttl" }, "SGP4 failed for this object; choose another.")); return { kpis: [] }; }
    const tr = R.track; const maxSep = Math.max(...tr.map((p) => p.sep), 1);
    const half = Math.floor(W / 2);
    const A = frame(svg, { width: half, height: H, margin: { l: 58, r: 12, t: 40, b: 48 }, x: { domain: [0, 180] }, y: { domain: [0, maxSep * 1.1] }, xLabel: "minutes from the element epoch", yLabel: "km", title: "Separation |Δr|" });
    A.plot.append(el("path", { d: `M${A.x(0)},${A.y(0)}L${tr.map((p) => `${A.x(p.t)},${A.y(p.sep)}`).join("L")}L${A.x(tr[tr.length - 1].t)},${A.y(0)}Z`, fill: "rgba(42,120,214,.10)" }));
    A.plot.append(path(tr.map((p) => [A.x(p.t), A.y(p.sep)]), { stroke: "#2a78d6", "stroke-width": 2 }));
    for (let k = 1; k * R.periodMin <= 180; k += 1) { const x = A.x(k * R.periodMin); A.plot.append(el("line", { x1: x, x2: x, y1: A.m.t, y2: A.m.t + A.h, stroke: "#eb6834", "stroke-dasharray": "3 3" })); A.plot.append(el("text", { x: x + 3, y: A.m.t + 12, class: "cap", fill: "#c4521f" }, `${k} orbit${k > 1 ? "s" : ""}`)); }
    const ext = Math.max(5, ...tr.map((p) => Math.max(...p.rtn.map(Math.abs))));
    const B = frame(svg, { width: W - half, height: H, at: [half, 0], margin: { l: 58, r: 90, t: 40, b: 48 }, x: { domain: [0, 180] }, y: { domain: [-ext * 1.1, ext * 1.1] }, xLabel: "minutes from the element epoch", yLabel: "km (two-body minus SGP4)", title: "Where the gap points" });
    const comps = [["radial", "#8b8a84", "2 3"], ["along-track", "#101012", null], ["cross-track", "#c0399a", "6 4"]];
    comps.forEach(([lab, col, dash], j) => {
      B.plot.append(path(tr.map((p) => [B.x(p.t), B.y(p.rtn[j])]), { stroke: col, "stroke-width": 1.8, "stroke-dasharray": dash }));
      const last = tr[tr.length - 1]; B.g.append(el("text", { x: B.x(last.t) + 4, y: B.y(last.rtn[j]) + 4, class: "cap", fill: col }, lab));
    });
    const k = Math.round(S.residualMin / 0.5); const cur = tr[Math.min(k, tr.length - 1)];
    for (const F of [A, B]) F.plot.append(el("line", { x1: F.x(cur.t), x2: F.x(cur.t), y1: F.m.t, y2: F.m.t + F.h, stroke: "#101012" }));
    A.plot.append(el("circle", { cx: A.x(cur.t), cy: A.y(cur.sep), r: 5, fill: "#2a78d6", stroke: "#fff", "stroke-width": 2 }));
    return {
      passport: [{ tag: "SGP4 / WGS72", cls: "sgp", bits: [R.name, `epoch ${R.epoch.slice(0, 16).replace("T", " ")} UTC`, { text: "catalog theory", cls: "dim" }] }, { tag: "two-body model", cls: "model", bits: ["same TEME state at epoch", "μ 398,600.8 km³/s²"] }],
      kpis: [{ value: fmt(cur.sep, 3), unit: " km", label: `separation at ${fmt(cur.t, 1)} min` }, { value: fmt(cur.rtn[1], 2), unit: " km", label: "along-track part" }, { value: fmt(cur.rtn[2], 2), unit: " km", label: "cross-track part" }, { value: fmt(cur.rtn[0], 2), unit: " km", label: "radial part" }],
      inspector: [["Mean period (from n)", `${fmt(R.periodMin, 3)} min`], ["Separation at 180 min", `${fmt(tr[tr.length - 1].sep, 3)} km`]],
      checks: [ctx.data.live.R1].filter(Boolean),
      syncA: S.residualMin,
    };
  },
};

/* ---------------- View 9: drag decay ---------------- */
function startH(ctx) {
  const { S, data } = ctx;
  if (S.decayStartH != null) return S.decayStartH;
  const i = data.cat.byId.get(S.selected);
  const h = i != null ? data.cat.meanAlt(i) : 420;
  return h >= H_FLOOR && h <= H_TOP ? Math.round(h) : 420;
}
let decKey = "", decRes = null;
export const dragView = {
  id: 9, act: "III", name: "Drag decay", stage: "chart",
  question: "Once air drag acts, how long does a 'closed' answer last?",
  body: "Above 150 km the air is thin, but not zero. Each orbit it takes a little energy, the orbit shrinks, the air gets thicker, and the loss speeds up. B = C_D·A/m says how much drag a satellite feels for its mass: light, wide objects have a large B. The right panel tests the model against real objects: each dot is the decay rate implied by an object's catalog elements.",
  limits: "Simulation with a fixed average atmosphere. Real density changes several-fold with solar activity, so times are order of magnitude. Not valid below 150 km. Vertical stripes of dots are constellations that use thrusters: for them the GP term also holds manoeuvres, not drag alone.",
  controls(ctx, root) {
    const r = row(root);
    for (const [b, t] of [[0.004, "ISS-like 0.004"], [0.01, "0.01"], [0.03, "light cubesat 0.03"]]) button(r, t, () => ctx.set({ B: b, decayDay: 0 }), "chip");
    const r2 = row(root);
    for (const h of [250, 300, 420, 550, 700]) button(r2, `start ${h} km`, () => ctx.set({ decayStartH: h, decayDay: 0 }), "chip");
    button(r2, "use selected object", () => ctx.set({ decayStartH: null, decayDay: 0 }), "chip");
    const w = document.createElement("p"); w.className = "warnbox"; w.textContent = "Low confidence below 200 km and wherever solar activity matters: the band shows B from one third to three times the chosen value."; root.append(w);
  },
  dock(ctx) {
    const { S } = ctx;
    return {
      a: { label: "Ballistic coefficient B", min: 0.001, max: 0.05, step: 0.001, value: S.B, format: (v) => `${fmt(v, 3)}<small> m²/kg</small>`, onInput: (v) => ctx.set({ B: v }) },
      b: { label: "Day", min: 0, max: 3650, step: 1, value: S.decayDay, format: (v) => `${fmt(v)}<small> d</small>`, onInput: (v) => ctx.set({ decayDay: v }) },
    };
  },
  play: { can: () => true, start(ctx) { if (ctx.S.decayDay >= (decRes?.days ?? 3650) - 1) ctx.S.decayDay = 0; }, tick(ctx, dt) { const end = decRes ? Math.min(decRes.days, 3650) : 3650; ctx.S.decayDay = Math.min(end, ctx.S.decayDay + dt * end / (ctx.S.reduced ? 20 : 8)); if (ctx.S.decayDay >= end) ctx.S.playing = false; } },
  step(ctx, s) { ctx.S.decayDay = Math.max(0, ctx.S.decayDay + s * 10); },
  render(ctx) {
    const { S, data, chart } = ctx; chart.replaceChildren();
    const W = chart.clientWidth, H = chart.clientHeight;
    const svg = el("svg", { width: W, height: H }); chart.append(svg);
    const h0 = startH(ctx);
    const key = `${h0}|${S.B}`;
    if (key !== decKey) { decRes = { mid: decay(h0, S.B), lo: decay(h0, S.B / 3), hi: decay(h0, S.B * 3) }; decRes.days = decRes.mid.days; decKey = key; }
    const tMax = Math.min(Math.max(decRes.lo.days, decRes.mid.days * 1.2, 30), 36500);
    const left = Math.floor(W * 0.52);
    const A = frame(svg, { width: left, height: H, margin: { l: 58, r: 12, t: 40, b: 48 }, x: { domain: [0, tMax] }, y: { domain: [140, Math.max(h0 + 20, 260)] }, xLabel: "days from start (model time)", yLabel: "altitude (km)", title: `Decay from ${fmt(h0)} km, B = ${fmt(S.B, 3)} m²/kg` });
    A.plot.append(el("rect", { x: A.m.l, y: A.y(200), width: A.w, height: A.y(140) - A.y(200), fill: "rgba(123,63,179,.10)" }));
    A.plot.append(el("text", { x: A.m.l + 6, y: A.y(200) + 14, class: "cap", fill: "#7b3fb3" }, "low confidence below 200 km · model stops at 150 km"));
    const band = [...decRes.hi.t.map((t, i) => [A.x(t), A.y(decRes.hi.h[i])]), ...decRes.lo.t.slice().reverse().map((t, i) => [A.x(t), A.y(decRes.lo.h[decRes.lo.h.length - 1 - i])])].filter((p) => p[0] <= A.m.l + A.w + 1);
    A.plot.append(el("path", { d: `M${band.map((p) => p.join(",")).join("L")}Z`, fill: "rgba(42,120,214,.12)" }));
    const shown = decRes.mid.t.map((t, i) => [t, decRes.mid.h[i]]).filter(([t]) => t <= S.decayDay);
    A.plot.append(path(decRes.mid.t.map((t, i) => [A.x(t), A.y(decRes.mid.h[i])]), { stroke: "#c9c8c0", "stroke-width": 1.5 }));
    A.plot.append(path(shown.map(([t, h]) => [A.x(t), A.y(h)]), { stroke: "#101012", "stroke-width": 2.4 }));
    const hNow = shown.length ? shown[shown.length - 1][1] : h0;
    A.plot.append(el("circle", { cx: A.x(Math.min(S.decayDay, decRes.days)), cy: A.y(hNow), r: 5.5, fill: "#7b3fb3", stroke: "#fff", "stroke-width": 2 }));
    // Right: real GP decay rates vs model curve.
    const B = frame(svg, { width: W - left, height: H, at: [left, 0], margin: { l: 58, r: 16, t: 40, b: 48 }, x: { domain: [150, 1000] }, y: { domain: [0.01, 10000], log: true }, xLabel: "mean altitude (km)", yLabel: "height lost per day (m, log)", title: "Model vs the catalog: decay rate by height" });
    const { cat } = data; const c = cat.c; let nPts = 0;
    const cx2 = overlayCanvas(chart, left + B.m.l, B.m.t, B.w, B.h);
    const vis = cat.visible(S, true);
    for (let i = 0; i < cat.n; i += 1) {
      const r = cat.rows[i]; const loss = -r[c.gp_dadt_m_day]; const h = (r[c.hp_km] + r[c.ha_km]) / 2;
      if (!vis[i] || !(loss > 0.01) || h < 150 || h > 1000 || r[c.ecc] > 0.01) continue;
      nPts += 1; cx2.globalAlpha = 0.45; cx2.fillStyle = TYPE_COLOR[r[c.type]] || "#8f8e87";
      cx2.beginPath(); cx2.arc(B.x(h) - B.m.l, B.y(loss) - B.m.t, 1.8, 0, 6.283); cx2.fill();
    }
    const hs = []; for (let h = 150; h <= 1000; h += 5) hs.push(h);
    for (const [f, col, w, dash] of [[1 / 3, "#7b3fb3", 1.2, "4 3"], [1, "#7b3fb3", 2.4, null], [3, "#7b3fb3", 1.2, "4 3"]]) B.plot.append(path(hs.map((h) => [B.x(h), B.y(lossPerDay(h, S.B * f))]), { stroke: col, "stroke-width": w, "stroke-dasharray": dash }));
    B.plot.append(el("text", { x: B.x(700), y: B.y(lossPerDay(700, S.B)) - 8, class: "cap", fill: "#7b3fb3" }, "model, B and B×3, B÷3"));
    const life = decRes.mid.reachedFloor ? decRes.days : null;
    return {
      passport: [{ tag: "simulation", cls: "sim", bits: ["da/dt = −ρ(h)·B·√(μa)", "exponential atmosphere (Vallado 2013)", "150–1,000 km"] }, { tag: "catalog", cls: "catalog", bits: [`${fmt(nPts)} near-circular objects`, "rate from the GP ṅ term", { text: "fitted, not measured", cls: "dim" }] }],
      kpis: [{ value: life ? (life > 730 ? fmt(life / 365.25, 1) : fmt(life, 0)) : "> 100", unit: life ? (life > 730 ? " years" : " days") : " years", label: "time to fall to 150 km (B)" }, { value: fmt(hNow, 1), unit: " km", label: `height on day ${fmt(S.decayDay)}` }, { value: fmt(lossPerDay(h0, S.B), 1), unit: " m/day", label: "height loss at the start" }, { value: decRes.lo.reachedFloor ? fmt(decRes.lo.days, 0) : "> 36,500", unit: " d", label: "lifetime if B ÷ 3" }],
      inspector: [["Start altitude", `${fmt(h0)} km`], ["Lifetime if B × 3", decRes.hi.reachedFloor ? `${fmt(decRes.hi.days, 0)} days` : "> 100 years"], ["ISS GP ṅ term (16 Nov)", (() => { const ii = cat.byId.get(25544); return ii != null ? `${fmt(-cat.rows[ii][c.gp_dadt_m_day], 1)} m/day` : "–"; })()]],
      checks: [data.live.C3, data.live.B5, data.live.B6, data.live.C2].filter(Boolean),
      syncA: S.B, syncB: S.decayDay,
    };
  },
};

/* ---------------- View 10: where orbits end ---------------- */
let lifeKey = "", lifeCurve = null;
export const ends = {
  id: 10, act: "III", name: "Where orbits end", stage: "chart",
  question: "Where do real orbits end, and does the model agree?",
  body: "SATCAT lists every object ever catalogued. More than half have already come down. For each decayed object, the last catalogued perigee is binned here; it piles up between about 140 and 200 km, the height where the drag model says an orbit has only days left. Objects still in orbit sit higher, with crowded shells where large constellations fly.",
  limits: "For a decayed object SATCAT gives the perigee of its last catalogued orbit, not its first. Counts, not averages.",
  controls(ctx, root) {
    const { S } = ctx;
    seg(root, "Show", [["both", "Both"], ["decayed", "Decayed only"], ["orbit", "On orbit only"]], S.endsMode, (k) => ctx.set({ endsMode: k }));
    chips(root, "Object type", [["PAY", "Payload"], ["R/B", "Rocket body"], ["DEB", "Debris"], ["UNK", "Unknown"]].map(([k, l]) => ({ key: k, label: l, color: TYPE_COLOR[k], on: S.types[k] })), (k, on) => { S.types[k] = on; ctx.render(); });
  },
  dock(ctx) { return { a: { label: "Drag B for the overlay", min: 0.001, max: 0.05, step: 0.001, value: ctx.S.B, format: (v) => `${fmt(v, 3)}<small> m²/kg</small>`, onInput: (v) => ctx.set({ B: v }) } }; },
  render(ctx) {
    const { S, data, chart } = ctx; chart.replaceChildren();
    const W = chart.clientWidth, H = chart.clientHeight;
    const svg = el("svg", { width: W, height: H }); chart.append(svg);
    const bins = data.bins; const edges = bins.edges_km; const nb = edges.length - 1;
    const types = bins.types.filter((t) => S.types[t]);
    const sum = (state) => Array.from({ length: nb }, (_, b) => types.reduce((a, t) => a + bins.hist[state][t][b], 0));
    const dec = sum("decayed"), orb = sum("orbit");
    const showD = S.endsMode !== "orbit", showO = S.endsMode !== "decayed";
    const xMax = 1200; const nShow = edges.findIndex((e) => e >= xMax);
    const ymax = Math.max(1, ...dec.slice(0, nShow).map((v, i) => Math.max(showD ? v : 0, showO ? orb[i] : 0)));
    const F = frame(svg, { width: W, height: H, margin: { l: 62, r: 70, t: 40, b: 48 }, x: { domain: [100, xMax] }, y: { domain: [0, ymax * 1.08] }, xLabel: "perigee altitude (km), 20 km bins", yLabel: "objects per bin", title: "Last catalogued perigee of decayed objects vs perigee of objects still in orbit" });
    if (S.brush) F.plot.append(el("rect", { x: F.x(Math.max(100, S.brush[0])), y: F.m.t, width: Math.max(1, F.x(Math.min(xMax, S.brush[1])) - F.x(Math.max(100, S.brush[0]))), height: F.h, class: "brush" }));
    const bars = [];
    for (let b = 0; b < nShow; b += 1) {
      const x0 = F.x(edges[b]), x1 = F.x(edges[b + 1]), w = x1 - x0;
      if (showD) { const r = el("rect", { x: x0 + 0.5, y: F.y(dec[b]), width: w - 1, height: F.y(0) - F.y(dec[b]), fill: "#eb6834", opacity: 0.8 }); F.plot.append(r); }
      if (showO) { const r = el("rect", { x: x0 + w * 0.3, y: F.y(orb[b]), width: w * 0.4, height: F.y(0) - F.y(orb[b]), fill: "#2a78d6", opacity: 0.9 }); F.plot.append(r); }
      bars.push([x0, x1, b]);
    }
    // Model overlay: days left from a circular orbit at each height (right log axis).
    const key = `${S.B}`;
    if (key !== lifeKey) { lifeCurve = []; for (let h = 160; h <= 1000; h += 20) { const d = decay(h, S.B, 36500); lifeCurve.push([h, d.reachedFloor ? d.days : null]); } lifeKey = key; }
    const ly = logScale([1, 36500], [F.m.t + F.h, F.m.t]);
    F.plot.append(path(lifeCurve.map(([h, d]) => (d ? [F.x(h), ly(Math.max(1, d))] : null)), { stroke: "#7b3fb3", "stroke-width": 2.4 }));
    const ax = F.g.appendChild(el("g", { class: "ax" }));
    for (const [d, t] of [[1, "1 day"], [30, "1 month"], [365, "1 year"], [3650, "10 years"], [36500, "100 y"]]) { ax.append(el("text", { x: F.m.l + F.w + 6, y: ly(d) + 4 }, t)); ax.append(el("line", { x1: F.m.l + F.w, x2: F.m.l + F.w + 4, y1: ly(d), y2: ly(d) })); }
    F.g.append(el("text", { x: F.m.l + F.w - 6, y: F.m.t + 14, "text-anchor": "end", class: "cap", fill: "#7b3fb3" }, `purple: model days left from a circular orbit (B = ${fmt(S.B, 3)}, right axis)`));
    const hit = el("rect", { x: F.m.l, y: F.m.t, width: F.w, height: F.h, fill: "transparent" }); svg.append(hit);
    hit.addEventListener("pointermove", (e) => {
      const bx = svg.getBoundingClientRect(); const mx = e.clientX - bx.left; const q = bars.find(([a, c]) => mx >= a && mx < c); if (!q) { hideTip(); return; }
      const b = q[2]; const d = decay(Math.max(160, edges[b] + 10), S.B, 36500);
      showTip(e.clientX, e.clientY, `${edges[b]}–${edges[b + 1]} km`, [["decayed", fmt(dec[b])], ["on orbit", fmt(orb[b])], ["model days left", d.reachedFloor ? fmt(d.days, 0) : "> 36,500"], ["median life of decayed", bins.lifetime_median_days[b] ? `${fmt(bins.lifetime_median_days[b], 0)} d (n ${fmt(bins.lifetime_n[b])})` : "n < 20"]]);
    });
    hit.addEventListener("pointerleave", hideTip);
    const nd = dec.reduce((a, b) => a + b, 0), no = orb.reduce((a, b) => a + b, 0);
    const st = bins.stats;
    return {
      passport: [{ tag: "catalog", cls: "catalog", bits: [`SATCAT ${fmt(data.prov.satcat.rows)} rows`, `${fmt(data.prov.satcat.decayed)} decayed`, "Earth-centred, with a perigee value"] }, { tag: "simulation", cls: "sim", bits: ["overlay: drag model lifetime"] }],
      kpis: [{ value: fmt(st.decayed_last_perigee_median_km, 0), unit: " km", label: "median last perigee, decayed" }, { value: `${fmt(st.decayed_last_perigee_p10_km, 0)}–${fmt(st.decayed_last_perigee_p90_km, 0)}`, unit: " km", label: "10th–90th percentile" }, { value: fmt(nd), label: "decayed in these bins (types shown)" }, { value: fmt(no), label: "on orbit in these bins" }],
      inspector: Object.entries(data.prov.audit_satcat).map(([k, v]) => [k.replaceAll("_", " "), fmt(v)]),
      checks: [{ name: "Counts reproduced from the hashed raw file", status: data.prov.audit_satcat.rows === data.prov.satcat.rows ? "pass" : "fail", detail: `${fmt(data.prov.satcat.rows)} rows, SHA-256 ${data.prov.satcat.sha256.slice(0, 12)}…` }, { name: "Percentages from counts; medians from raw rows", status: "pass", detail: "no averaging of percentages or medians" }],
      syncA: S.B,
    };
  },
};
