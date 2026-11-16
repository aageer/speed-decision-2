import { gmst, sunDir } from "../astro.js";
import { REGIME_COLOR, TYPE_COLOR, REGIME_NAME } from "../catalog.js";
import { showTip, hideTip } from "../svg.js";
import { pick as pickChecks } from "../checks.js";
import { fmt, skyPositions, skyMs, betweenCuts, orbitOf, selectObject, chips, seg } from "./common.js";

const TYPE_NAME = { PAY: "Payload", "R/B": "Rocket body", DEB: "Debris", UNK: "Unknown" };
let colorBy = "regime";
let zoom = "near";
let colors = null, sizes = null, colorKey = "";
let orbitKey = "", orbitPts = [];
let handlers = null;

function hexToLin(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
}

export default {
  id: 1, act: "I", name: "Sky now", stage: "globe",
  question: "Where does everything in orbit sit right now?",
  body: "Every active object in the CelesTrak catalog, placed by SGP4 at the snapshot time over a real Earth turned to its sidereal angle, with the Sun lighting the day side. Low orbits crowd close to the planet; navigation satellites form a middle shell; geostationary ones sit in a far ring. Click any dot to make its state the shared state of every view.",
  limits: "Positions are SGP4 theory from fitted catalog elements, not live tracking. Dots are enlarged far beyond true size.",
  controls(ctx, root) {
    const { S } = ctx;
    seg(root, "Colour by", [["regime", "Orbit regime"], ["type", "Object type"]], colorBy, (k) => { colorBy = k; colorKey = ""; ctx.render(); });
    chips(root, "Orbit regime", Object.keys(REGIME_NAME).map((k) => ({ key: k, label: REGIME_NAME[k], color: REGIME_COLOR[k], on: S.regimes[k] })), (k, on) => { S.regimes[k] = on; colorKey = ""; ctx.render(); });
    chips(root, "Object type (from SATCAT)", Object.keys(TYPE_NAME).map((k) => ({ key: k, label: TYPE_NAME[k], color: TYPE_COLOR[k], on: S.types[k] })), (k, on) => { S.types[k] = on; colorKey = ""; ctx.render(); });
    seg(root, "Frame", [["near", "Near Earth"], ["all", "All orbits"]], zoom, (k) => { zoom = k; ctx.globe?.frameTo(k === "near" ? 15000 : 52000); });
    const find = document.createElement("div"); find.className = "ctl";
    find.innerHTML = '<span class="eb">Find an object</span>';
    const inp = document.createElement("input"); inp.type = "search"; inp.placeholder = "Name or NORAD number, e.g. HUBBLE"; inp.setAttribute("list", "objlist"); inp.setAttribute("aria-label", "Find an object by name or NORAD number");
    const dl = document.createElement("datalist"); dl.id = "objlist";
    inp.addEventListener("input", () => {
      const q = inp.value.trim().toUpperCase(); dl.replaceChildren(); if (q.length < 2) return;
      const { cat } = ctx.data; let n = 0;
      for (let i = 0; i < cat.n && n < 12; i += 1) { const nm = cat.name(i); if (nm.toUpperCase().includes(q) || String(cat.norad(i)) === q) { const o = document.createElement("option"); o.value = `${nm} · ${cat.norad(i)}`; dl.append(o); n += 1; } }
    });
    inp.addEventListener("change", () => {
      const m = inp.value.match(/(\d+)\s*$/); if (!m) return;
      const i = ctx.data.cat.byId.get(Number(m[1])); if (i != null) selectObject(ctx, i);
    });
    find.append(inp, dl); root.append(find);
  },
  dock(ctx) {
    return { a: { label: "Minutes from snapshot", min: 0, max: 1440, step: 1, value: ctx.S.skyMin, format: (v) => `${fmt(v)}<small> min</small>`, onInput: (v) => ctx.set({ skyMin: v }) } };
  },
  enter(ctx) {
    const g = ctx.globe; if (!g) return;
    g.frameTo(zoom === "near" ? 15000 : 52000);
    colorKey = ""; orbitKey = "";
    const canvas = document.getElementById("gl");
    const move = (e) => {
      const i = g.pick(e.clientX, e.clientY);
      if (i < 0) { hideTip(); canvas.style.cursor = ""; return; }
      canvas.style.cursor = "pointer";
      const { cat } = ctx.data; const p = skyPositions(ctx);
      const r = Math.hypot(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
      showTip(e.clientX, e.clientY, cat.name(i), [["NORAD", String(cat.norad(i))], ["type", TYPE_NAME[cat.type(i)] || cat.type(i)], ["regime", REGIME_NAME[cat.regime(i)]], ["altitude", `${fmt(r - 6378.137, 0)} km`], ["speed", `${fmt(p.spd[i], 3)} km/s`]]);
    };
    const click = (e) => { const i = g.pick(e.clientX, e.clientY); if (i >= 0) selectObject(ctx, i); };
    canvas.addEventListener("pointermove", move); canvas.addEventListener("click", click); canvas.addEventListener("pointerleave", hideTip);
    handlers = { canvas, move, click };
  },
  leave(ctx) {
    if (handlers) { handlers.canvas.removeEventListener("pointermove", handlers.move); handlers.canvas.removeEventListener("click", handlers.click); handlers.canvas.removeEventListener("pointerleave", hideTip); handlers.canvas.style.cursor = ""; }
    ctx.globe?.hideSatellites(); ctx.globe?.setLines([]); ctx.globe?.setMarkers([]); ctx.globe?.setParticles([]);
  },
  play: { can: () => true, tick(ctx, dt) { ctx.S.skyMin = (ctx.S.skyMin + dt * (ctx.S.reduced ? 2 : 12)) % 1440; } },
  step(ctx, sign) { ctx.S.skyMin = Math.max(0, Math.min(1440, ctx.S.skyMin + sign)); },
  render(ctx) {
    const { S, data, globe } = ctx; const { cat } = data;
    const ms = skyMs(ctx);
    const p = skyPositions(ctx);
    const vis = cat.visible(S, true);
    let shown = 0, inBand = 0, measured = 0;
    if (globe) {
      globe.setEarthAngle(gmst(ms)); globe.setSun(sunDir(ms), true);
      const key = `${colorBy}|${JSON.stringify(S.types)}|${JSON.stringify(S.regimes)}|${JSON.stringify(S.brush)}|${S.selected}`;
      if (key !== colorKey) {
        colors = new Float32Array(cat.n * 3); sizes = new Float32Array(cat.n);
        for (let i = 0; i < cat.n; i += 1) {
          const hex = colorBy === "regime" ? REGIME_COLOR[cat.regime(i)] : TYPE_COLOR[cat.type(i)] || TYPE_COLOR.UNK;
          colors.set(hexToLin(hex), i * 3);
          sizes[i] = vis[i] ? (cat.regime(i) === "leo" ? 3.2 : 4.6) : 0;
        }
        colorKey = key;
      }
      if (p) globe.setSatellites(p.pos, colors, sizes, cat.n);
      const si = cat.byId.get(S.selected);
      if (si != null) {
        const okey = `${S.selected}|${Math.round(S.skyMin / 5)}`;
        if (okey !== orbitKey) { orbitPts = orbitOf(cat, si, ms); orbitKey = okey; }
        const pos = p ? [p.pos[si * 3], p.pos[si * 3 + 1], p.pos[si * 3 + 2]] : null;
        globe.setLines([{ points: orbitPts, color: "#ffffff", width: 1.6, opacity: 0.85 }]);
        globe.setMarkers(pos && Number.isFinite(pos[0]) ? [{ p: pos, color: "#ffffff", label: S.selectedName }] : []);
      }
    }
    if (p) for (let i = 0; i < cat.n; i += 1) {
      if (!vis[i]) continue; shown += 1;
      const r = Math.hypot(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
      if (Number.isFinite(r)) { measured += 1; if (betweenCuts(r, p.spd[i])) inBand += 1; }
    }
    const reg = data.prov.regimes;
    return {
      passport: [{ tag: "catalog", cls: "catalog", bits: [`CelesTrak GP active · ${fmt(cat.n)} objects`, `snapshot ${cat.t0Iso.slice(0, 16).replace("T", " ")} UTC`, `t + ${fmt(S.skyMin)} min`] },
        { tag: "SGP4 / WGS72", cls: "sgp", bits: ["TEME → Earth turned by GMST", { text: "theory, not tracking", cls: "dim" }] }],
      kpis: [
        { value: fmt(shown), unit: ` of ${fmt(cat.n)}`, label: "objects shown (filters, brush)" },
        { value: fmt(inBand), unit: ` of ${fmt(measured)}`, label: "between impact cut and escape" },
        { value: S.selectedName, label: "selected object (click a dot)", wide: true },
      ],
      inspector: [["LEO / MEO / GEO / HEO", `${fmt(reg.leo || 0)} / ${fmt(reg.meo || 0)} / ${fmt(reg.geo || 0)} / ${fmt(reg.heo || 0)}`], ["SGP4 failures at this time", p ? fmt(p.fail) : "…"], ["Altitude brush (View 2)", S.brush ? `${fmt(S.brush[0])}–${fmt(S.brush[1])} km` : "none"], ["Shared state from", S.stateSource]],
      legend: Object.keys(REGIME_NAME).map((k) => (colorBy === "regime" ? { label: REGIME_NAME[k], color: REGIME_COLOR[k], point: true } : null)).filter(Boolean)
        .concat(colorBy === "type" ? Object.keys(TYPE_NAME).map((k) => ({ label: TYPE_NAME[k], color: TYPE_COLOR[k], point: true })) : [])
        .concat([{ label: "selected object, one orbit (SGP4)", color: "#ffffff" }]),
      note: "Equal scale. Dots are enlarged. Hover for values, click to select, drag to rotate.",
      checks: pickChecks(data.live, ["P1", "P2"]).concat(p ? [{ name: "Every shown object is between its cuts", status: inBand === measured ? "pass" : "info", detail: `${fmt(inBand)} of ${fmt(measured)} at this minute` }] : []),
      syncA: S.skyMin,
    };
  },
};
