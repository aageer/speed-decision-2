// Live checks run in the browser at load. Python checks come from data/checks.json.
import { thresholds, MU_NGA, REQ_WGS84 } from "./kepler.js";
import { simulate } from "./ascent.js";
import { decay, rho } from "./drag.js";
import { residualTrack } from "./residual.js";
import { classOf } from "./model.js";

export function runLiveChecks(data) {
  const out = {};
  const add = (id, name, ok, detail) => { out[id] = { id, name, status: ok === null ? "info" : ok ? "pass" : "fail", detail }; };
  const c = thresholds(6798.137, MU_NGA, REQ_WGS84);
  const e = [Math.abs(c.vimp - 7.534241599), Math.abs(c.vc - 7.657269485), Math.abs(c.vesc - 10.829014356)];
  add("C1", "Cuts at 420 km match the midterm table", e.every((x) => x < 1e-9), `7.534241599 · 7.657269485 · 10.829014356 km/s (max error ${Math.max(...e).toExponential(1)})`);
  add("B1", "Class flips at the impact cut (±1 mm/s)", classOf(6798.137, c.vimp - 1e-6, 0) === "impact" && classOf(6798.137, c.vimp + 2e-6, 0) === "closed", "7.534240599 impact · 7.534243599 closed");
  add("B2", "Near-vertical states (γ = ±89.9°)", classOf(6798.137, 9, 89.9) === "impact" && classOf(6798.137, 9, -89.9) === "impact" && classOf(6798.137, 11, 89.9) === "escape", "9 km/s up or down: impact · 11 km/s up: escape");
  add("B3", "v = 0 is a radial fall (impact)", classOf(6798.137, 0, 0) === "impact", "e = 1, no period");
  const full = simulate(1), short = simulate(0.99);
  const cls = (s) => { const r = Math.hypot(s.r[0], s.r[1]), v = Math.hypot(s.v[0], s.v[1]); const g = Math.atan2((s.r[0] * s.v[0] + s.r[1] * s.v[1]) / r, (-s.v[0] * s.r[1] + s.v[1] * s.r[0]) / r) * 180 / Math.PI; return classOf(r, v, g); };
  add("A1", "Ascent: full burn reaches a closed orbit; 99 % falls back", cls(full) === "closed" && cls(short) === "impact", `cutoff ${full.tCutoff.toFixed(1)} s, ${(Math.hypot(full.r[0], full.r[1]) - 6378.137).toFixed(1)} km, ${Math.hypot(full.v[0], full.v[1]).toFixed(3)} km/s`);
  const d0 = decay(420, 0, 365);
  add("B5", "Drag with B = 0 keeps the height constant", d0.h[d0.h.length - 1] === 420, "420 km after the whole run");
  let refused = false; try { decay(120, 0.01); } catch (err) { refused = true; }
  add("B6", "Start below 150 km is refused", refused, "\"start altitude outside 150-1000 km\"");
  // C3: constant-density closed form vs RK4 (done here at 400 km for 10 days).
  const a0 = (6378.137 + 400) * 1e3, r0 = rho(400), B = 0.01, T = 10 * 86400, MU = 398600.4418e9;
  let a = a0; const dt = 600; const f = (x) => -r0 * B * Math.sqrt(MU * x);
  for (let t = 0; t < T; t += dt) { const k1 = f(a), k2 = f(a + 0.5 * dt * k1), k3 = f(a + 0.5 * dt * k2), k4 = f(a + dt * k3); a += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6; }
  const exact = (Math.sqrt(a0) - 0.5 * r0 * B * Math.sqrt(MU) * T) ** 2;
  add("C3", "Drag integrator vs closed form (constant density)", Math.abs(a - exact) / exact < 1e-9, `relative error ${(Math.abs(a - exact) / exact).toExponential(1)}`);
  const iss = data.story?.gp?.fields;
  if (iss) {
    const tr = residualTrack(iss, 180, 0.5);
    const at93 = tr?.track.find((p) => Math.abs(p.t - 93) < 1e-9);
    add("R1", "This page reproduces the midterm residual (ISS, 5 Oct 2026)", at93 && Math.abs(at93.sep - 72.206) < 0.01, at93 ? `${at93.sep.toFixed(3)} km at 93.0 min (midterm 72.206 km)` : "not computed");
  }
  for (const pc of data.checksFile?.checks || []) out[pc.id] = { id: pc.id, name: pc.name, status: pc.pass ? "pass" : "fail", detail: pc.detail };
  return out;
}
export const pick = (live, ids) => ids.map((id) => live[id]).filter(Boolean);
