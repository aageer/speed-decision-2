import { frame, el, path, overlayCanvas, showTip, hideTip, fmtTick } from "../svg.js";
import { thresholds, MU_NGA, REQ_WGS84 } from "../kepler.js";
import { REGIME_COLOR, REGIME_NAME } from "../catalog.js";
import { fmt, skyPositions, betweenCuts, selectObject, seg, button, row } from "./common.js";

let mode = "points";
export default {
  id: 2, act: "I", name: "Speed band", stage: "chart",
  question: "At its own height, is every object between the cuts?",
  body: "Each dot is one active object: its height and its speed at the snapshot time. The three curves are the analytic cuts at every height: below the orange curve a sideways path meets the Earth, above the pink curve it escapes. Drag across the chart to brush a band of heights; the brush filters Views 1, 9 and 10.",
  limits: "Speeds are SGP4 values at one instant. The cuts assume a sideways start (γ = 0); an object with γ ≠ 0 is judged by View 4.",
  controls(ctx, root) {
    seg(root, "Marks", [["points", "Points"], ["bins", "Density bins (counts)"]], mode, (k) => { mode = k; ctx.render(); });
    const r = row(root);
    button(r, "Clear brush", () => ctx.set({ brush: null }));
    button(r, "Brush: 300–600 km", () => ctx.set({ brush: [300, 600] }));
  },
  dock: () => ({}),
  render(ctx) {
    const { S, data, chart } = ctx; const { cat } = data;
    const p = skyPositions(ctx);
    chart.replaceChildren();
    const W = chart.clientWidth, H = chart.clientHeight;
    const svg = el("svg", { width: W, height: H }); chart.append(svg);
    const F = frame(svg, { width: W, height: H, margin: { l: 62, r: 22, t: 40, b: 48 }, x: { domain: [150, 60000], log: true }, y: { domain: [0, 12] }, xLabel: "altitude above 6,378 km (km, log scale)", yLabel: "speed (km/s)", title: "Real objects against the speed cuts at their own height" });
    const hs = []; for (let i = 0; i <= 200; i += 1) hs.push(150 * (60000 / 150) ** (i / 200));
    const cutsAt = hs.map((h) => thresholds(REQ_WGS84 + h, MU_NGA, REQ_WGS84));
    const band = [...hs.map((h, i) => [F.x(h), F.y(cutsAt[i].vimp)]), ...hs.slice().reverse().map((h, i) => [F.x(h), F.y(cutsAt[hs.length - 1 - i].vesc)])];
    F.plot.append(el("path", { d: `M${band.map((q) => q.join(",")).join("L")}Z`, fill: "rgba(42,120,214,.06)" }));
    for (const [k, c, lab] of [["vimp", "#eb6834", "impact cut"], ["vc", "#55544f", "circular"], ["vesc", "#c0399a", "escape"]]) {
      F.plot.append(path(hs.map((h, i) => [F.x(h), F.y(cutsAt[i][k])]), { stroke: c, "stroke-width": 2 }));
      const i0 = k === "vc" ? 60 : 18; const dy = k === "vimp" ? 16 : -7;
      F.plot.append(el("text", { x: F.x(hs[i0]) + 4, y: F.y(cutsAt[i0][k]) + dy, class: "lbl", fill: c }, lab));
    }
    for (const [h, t] of [[20200, "GPS"], [35786, "GEO"], [420, "ISS"]]) {
      F.plot.append(el("line", { x1: F.x(h), x2: F.x(h), y1: F.m.t, y2: F.m.t + F.h, stroke: "#c9c8c0", "stroke-dasharray": "3 4" }));
      F.plot.append(el("text", { x: F.x(h) + 3, y: F.m.t + 12, class: "cap" }, t));
    }
    if (S.brush) {
      const x0 = F.x(Math.max(150, S.brush[0])), x1 = F.x(Math.min(60000, S.brush[1]));
      F.plot.append(el("rect", { x: x0, y: F.m.t, width: Math.max(1, x1 - x0), height: F.h, class: "brush" }));
    }
    let n = 0, inBand = 0, inBrush = 0, inBrushBand = 0;
    const pts = [];
    if (p) {
      const vis = cat.visible(S, false);
      for (let i = 0; i < cat.n; i += 1) {
        if (!vis[i]) continue;
        const r = Math.hypot(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); const v = p.spd[i];
        if (!Number.isFinite(r)) continue;
        const h = r - REQ_WGS84; n += 1;
        const ok = betweenCuts(r, v); if (ok) inBand += 1;
        const inB = S.brush && h >= S.brush[0] && h <= S.brush[1]; if (inB) { inBrush += 1; if (ok) inBrushBand += 1; }
        pts.push([i, h, v, inB]);
      }
      const ctx2 = overlayCanvas(chart, F.m.l, F.m.t, F.w, F.h);
      const X = (h) => F.x(h) - F.m.l, Y = (v) => F.y(v) - F.m.t;
      if (mode === "points") {
        for (const [i, h, v, inB] of pts) {
          ctx2.globalAlpha = S.brush && !inB ? 0.15 : 0.55;
          ctx2.fillStyle = REGIME_COLOR[cat.regime(i)] === "#c9c8c0" ? "#8f8e87" : REGIME_COLOR[cat.regime(i)];
          ctx2.beginPath(); ctx2.arc(X(h), Y(v), 1.7, 0, 6.283); ctx2.fill();
        }
      } else {
        const nx = 70, ny = 48, grid = new Map();
        for (const [, h, v] of pts) { const gx = Math.floor((X(h) / F.w) * nx), gy = Math.floor((Y(v) / F.h) * ny); const k = gx * 1000 + gy; grid.set(k, (grid.get(k) || 0) + 1); }
        const max = Math.max(...grid.values());
        for (const [k, c] of grid) {
          const gx = Math.floor(k / 1000), gy = k % 1000; const t = Math.log(1 + c) / Math.log(1 + max);
          ctx2.globalAlpha = 1; ctx2.fillStyle = `rgba(31,107,199,${0.12 + 0.85 * t})`;
          ctx2.fillRect((gx * F.w) / nx, (gy * F.h) / ny, F.w / nx - 1, F.h / ny - 1);
          if (c >= 50) { ctx2.fillStyle = t > 0.6 ? "#fff" : "#123"; ctx2.font = "10px IBM Plex Sans, sans-serif"; ctx2.fillText(String(c), (gx * F.w) / nx + 1, (gy * F.h) / ny + 10); }
        }
      }
      const si = cat.byId.get(S.selected);
      if (si != null) {
        const r = Math.hypot(p.pos[si * 3], p.pos[si * 3 + 1], p.pos[si * 3 + 2]);
        F.plot.append(el("circle", { cx: F.x(r - REQ_WGS84), cy: F.y(p.spd[si]), r: 6, fill: "none", stroke: "#101012", "stroke-width": 2 }));
        F.plot.append(el("text", { x: F.x(r - REQ_WGS84) + 9, y: F.y(p.spd[si]) - 8, class: "lbl" }, S.selectedName));
      }
    }
    // Brush and hover.
    const hit = el("rect", { x: F.m.l, y: F.m.t, width: F.w, height: F.h, fill: "transparent", style: "cursor: crosshair" }); svg.append(hit);
    let drag = null;
    const nearest = (mx, my) => {
      let best = null, bd = 64;
      for (const q of pts) { const dx = F.x(q[1]) - mx, dy = F.y(q[2]) - my; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = q; } }
      return best;
    };
    hit.addEventListener("pointerdown", (e) => { const b = svg.getBoundingClientRect(); drag = { x0: e.clientX - b.left, moved: false }; hit.setPointerCapture(e.pointerId); });
    hit.addEventListener("pointermove", (e) => {
      const b = svg.getBoundingClientRect(); const mx = e.clientX - b.left, my = e.clientY - b.top;
      if (drag) { if (Math.abs(mx - drag.x0) > 4) { drag.moved = true; const a = F.x.invert(Math.min(drag.x0, mx)), c = F.x.invert(Math.max(drag.x0, mx)); S.brush = [Math.round(a), Math.round(c)]; } return; }
      const q = nearest(mx, my);
      if (!q) { hideTip(); return; }
      const ok = betweenCuts(q[1] + REQ_WGS84, q[2]);
      showTip(e.clientX, e.clientY, cat.name(q[0]), [["altitude", `${fmt(q[1], 0)} km`], ["speed", `${fmt(q[2], 3)} km/s`], ["regime", REGIME_NAME[cat.regime(q[0])]], ["between cuts", ok ? "yes" : "no"]]);
    });
    hit.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved) { const b = svg.getBoundingClientRect(); const q = nearest(e.clientX - b.left, e.clientY - b.top); if (q) selectObject(ctx, q[0]); }
      drag = null; ctx.render();
    });
    hit.addEventListener("pointerleave", hideTip);
    return {
      passport: [{ tag: "catalog", cls: "catalog", bits: [`${fmt(cat.n)} active objects`, "SGP4 |r|, |v| at the snapshot"] }, { tag: "two-body model", cls: "model", bits: ["cut curves: impact, circular, escape", "γ = 0"] }],
      kpis: [
        { value: fmt(inBand), unit: ` of ${fmt(n)}`, label: "objects between the cuts" },
        { value: S.brush ? fmt(inBrush) : "–", unit: S.brush ? " objects" : "", label: S.brush ? `in brush ${fmt(S.brush[0])}–${fmt(S.brush[1])} km` : "no brush (drag on the chart)" },
      ],
      inspector: [["Share between cuts", n ? `${fmt((100 * inBand) / n, 2)} % (from counts)` : "–"], ["In brush and between cuts", S.brush ? `${fmt(inBrushBand)} of ${fmt(inBrush)}` : "–"], ["Selected", S.selectedName]],
      note: "Hover for values · click a dot to select · drag to brush heights",
      checks: [{ name: "Points are counted, not averaged", status: "pass", detail: "every share is computed from counts" }, { name: "SGP4 failures excluded and counted", status: "pass", detail: p ? `${fmt(p.fail)} at this time` : "…" }],
    };
  },
};
