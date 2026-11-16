// SGP4 vs two-body from the same Cartesian state (View 8). Same method as the midterm View 6.
import { json2satrec, sgp4 } from "../vendor/satellite.esm.js";
import { propagate } from "./kepler.js";
import { parseUtc } from "./sgp4time.js";
const MU72 = 398600.8;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = nrm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function ommFromRow(cat, i) {
  const r = cat.rows[i], c = cat.c;
  return { NORAD_CAT_ID: r[c.norad], OBJECT_NAME: r[c.name], EPOCH: r[c.epoch], MEAN_MOTION: r[c.n_rev_day], ECCENTRICITY: r[c.ecc],
    INCLINATION: r[c.inc_deg], RA_OF_ASC_NODE: r[c.raan_deg], ARG_OF_PERICENTER: r[c.argp_deg], MEAN_ANOMALY: r[c.M_deg],
    BSTAR: r[c.bstar], MEAN_MOTION_DOT: r[c.ndot_half], MEAN_MOTION_DDOT: r[c.nddot_sixth], EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0 };
}

/** Track from the element epoch, 0..minutes, step 0.5 min. */
export function residualTrack(omm, minutes = 180, step = 0.5) {
  const rec = json2satrec(omm);
  const s0 = sgp4(rec, 0);
  if (!s0 || !s0.position || typeof s0.position === "boolean") return null;
  const r0 = [s0.position.x, s0.position.y, s0.position.z], v0 = [s0.velocity.x, s0.velocity.y, s0.velocity.z];
  const out = [];
  for (let t = 0; t <= minutes + 1e-9; t += step) {
    const s = sgp4(rec, t);
    if (!s || !s.position || typeof s.position === "boolean") break;
    const rs = [s.position.x, s.position.y, s.position.z], vs = [s.velocity.x, s.velocity.y, s.velocity.z];
    const tb = propagate(r0, v0, t * 60, MU72);
    const d = [tb.r[0] - rs[0], tb.r[1] - rs[1], tb.r[2] - rs[2]];
    const R = unit(rs), N = unit(cross(rs, vs)), T = cross(N, R);
    out.push({ t, rs, rt: tb.r, sep: nrm(d), rtn: [dot(d, R), dot(d, T), dot(d, N)] });
  }
  const n = omm.MEAN_MOTION;
  return { track: out, periodMin: 1440 / n, epochMs: parseUtc(omm.EPOCH) };
}
