// Shared two-body helpers for the views. The physics is kepler.js (midterm, tested).
import { MU_NGA, REQ_WGS84, classify, family, propagate, samplePath, stateFromSpeed, thresholds } from "./kepler.js";

export { MU_NGA, REQ_WGS84, classify, family, propagate, samplePath, stateFromSpeed, thresholds };
export const MU72 = 398600.8;
export const DEFAULTS = { radius: 6798.137, speed: 7.657269485, gamma: 0 };
export const CLASS_COLOR = { impact: "#eb6834", closed: "#2a78d6", escape: "#c0399a" };
export const STAGE_COLOR = { impact: "#f07a45", closed: "#4f97ec", escape: "#e06cbd" };
export const KIND_WORD = { impact: "impact", circle: "circle", ellipse: "ellipse", parabola: "parabola", hyperbola: "hyperbola" };

const cache = new Map();
/** Elements and sampled path for the shared state (radius, speed, gamma). */
export function experiment(S) {
  const key = `${S.radius}|${S.speed}|${S.gamma}`;
  let hit = cache.get(key);
  if (!hit) {
    const init = stateFromSpeed(S.radius, S.speed, S.gamma);
    const sample = samplePath(init.r, init.v, MU_NGA, REQ_WGS84, 361);
    hit = { init, sample, el: sample.elements, fam: family(sample.elements.kind) };
    cache.set(key, hit);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return hit;
}

/** Class of a state given only (r, v, gamma) — the analytic rule used on the decision map. */
export function classOf(r, v, gDeg) {
  const g = (gDeg * Math.PI) / 180;
  const eps = (v * v) / 2 - MU_NGA / r;
  const h = r * v * Math.cos(g);
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (MU_NGA * MU_NGA)));
  const rp = h < 1e-9 ? 0 : (h * h) / MU_NGA / (1 + e);
  if (eps < -1e-8) return rp <= REQ_WGS84 + 0.001 ? "impact" : "closed";
  if (gDeg >= 0) return "escape";
  return rp <= REQ_WGS84 + 0.001 ? "impact" : "escape";
}

export const norm = (v) => Math.hypot(v[0], v[1], v[2] ?? 0);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + (a[2] ?? 0) * (b[2] ?? 0);
export function flightPathDeg(r, v) {
  const R = norm(r), V = norm(v);
  const vr = dot(r, v) / R;
  return (Math.atan2(vr, Math.sqrt(Math.max(V * V - vr * vr, 0))) * 180) / Math.PI;
}
