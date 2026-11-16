// Web Worker: SGP4 (satellite.js 7.1.0, WGS72) for every active object.
// In: {type:"init", rows, cols}  {type:"at", ms, id}
// Out: {type:"ready", n, bad}     {type:"pos", id, ms, pos: Float32Array(3n) km TEME, spd: Float32Array(n) km/s}
import { json2satrec, sgp4 } from "../vendor/satellite.esm.js";

let recs = [], epochMs = [];
import { parseUtc } from "./sgp4time.js";
function _parseUtcUnused(iso) {
  const [date, time] = iso.replace("Z", "").split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":");
  return Date.UTC(y, m - 1, d, Number(hh), Number(mm), 0) + Number(ss) * 1000;
}
self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    const c = Object.fromEntries(msg.cols.map((k, i) => [k, i]));
    let bad = 0;
    recs = msg.rows.map((r) => {
      try {
        return json2satrec({
          NORAD_CAT_ID: r[c.norad], EPOCH: r[c.epoch], MEAN_MOTION: r[c.n_rev_day], ECCENTRICITY: r[c.ecc],
          INCLINATION: r[c.inc_deg], RA_OF_ASC_NODE: r[c.raan_deg], ARG_OF_PERICENTER: r[c.argp_deg], MEAN_ANOMALY: r[c.M_deg],
          BSTAR: r[c.bstar], MEAN_MOTION_DOT: r[c.ndot_half], MEAN_MOTION_DDOT: r[c.nddot_sixth],
          EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0,
        });
      } catch (e) { bad += 1; return null; }
    });
    epochMs = msg.rows.map((r) => parseUtc(r[c.epoch]));
    self.postMessage({ type: "ready", n: recs.length, bad });
    return;
  }
  if (msg.type === "at") {
    const n = recs.length;
    const pos = new Float32Array(n * 3), spd = new Float32Array(n);
    let fail = 0;
    for (let i = 0; i < n; i += 1) {
      const rec = recs[i];
      let ok = false;
      if (rec) {
        const out = sgp4(rec, (msg.ms - epochMs[i]) / 60000);
        if (out && out.position && typeof out.position !== "boolean") {
          const p = out.position, v = out.velocity;
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          spd[i] = Math.hypot(v.x, v.y, v.z); ok = Number.isFinite(p.x);
        }
      }
      if (!ok) { pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = NaN; spd[i] = NaN; fail += 1; }
    }
    self.postMessage({ type: "pos", id: msg.id, ms: msg.ms, pos, spd, fail }, [pos.buffer, spd.buffer]);
  }
};

