// Launch-to-orbit ascent, line-by-line port of pipeline/ascent.py.
// ILLUSTRATIVE SIMULATION: generic two-stage rocket, point mass, one plane,
// inverse-square gravity, no air drag. Not a real vehicle.
export const MU = 398600.4418;
export const R = 6378.137;
const G0 = 9.80665e-3;
export const OMEGA = 7.292115e-5;
export const LAT_DEG = 28.5;
const LAT = (LAT_DEG * Math.PI) / 180;

export const P = { tw1: 1.45, isp1: 300, m1end: 0.3, m2: 0.24, m2dry: 0.04, tw2: 0.7, isp2: 345,
  tv: 12, tk: 10, kick: 8, ht: 420, kh: 1.5, kv: 0.02, dt: 0.5 };

export function simulate(burn = 1, p = P) {
  burn = Math.min(Math.max(burn, 0), 1);
  let x = R, y = 0, vx = 0, vy = OMEGA * R * Math.cos(LAT);
  let m = 1, t = 0;
  const dt = p.dt;
  const t1 = p.tw1 * G0, md1 = t1 / (p.isp1 * G0);
  const t2 = p.tw2 * G0 * p.m2, md2 = t2 / (p.isp2 * G0);
  const m2end = p.m2 - (p.m2 - p.m2dry) * burn;
  let phase = 1, tSep = null;
  const rows = [];
  while (t < 4000) {
    const r = Math.hypot(x, y);
    const ur = [x / r, y / r], ut = [-ur[1], ur[0]];
    const vr = vx * ur[0] + vy * ur[1], vt = vx * ut[0] + vy * ut[1];
    const h = r - R;
    rows.push([t, x, y, vx, vy, phase, m]);
    if (h < -1e-6) break;
    const g = MU / (r * r);
    let a = 0, d = [0, 0];
    if (phase === 1) {
      if (t < p.tv) d = ur;
      else if (t < p.tv + p.tk) {
        const ang = ((p.kick * Math.PI) / 180) * (t - p.tv) / p.tk;
        d = [ur[0] * Math.cos(ang) + ut[0] * Math.sin(ang), ur[1] * Math.cos(ang) + ut[1] * Math.sin(ang)];
      } else {
        const rvt = vt - OMEGA * r * Math.cos(LAT);
        const n = Math.hypot(vr, rvt);
        d = [(vr * ur[0] + rvt * ut[0]) / n, (vr * ur[1] + rvt * ut[1]) / n];
      }
      a = t1 / m;
      m -= md1 * dt;
      if (m <= p.m1end) { phase = 2; m = p.m2; tSep = t + dt; if (burn <= 0) phase = 3; }
    } else if (phase === 2) {
      a = t2 / m;
      const tgo = Math.max(20, (m - p.m2dry) / md2);
      const vcmd = Math.max(-0.3, Math.min(1.0, ((p.ht - h) / tgo) * p.kh));
      const need = g - (vt * vt) / r + p.kv * (vcmd - vr);
      const th = Math.asin(Math.max(-0.6, Math.min(0.95, need / a)));
      d = [ur[0] * Math.sin(th) + ut[0] * Math.cos(th), ur[1] * Math.sin(th) + ut[1] * Math.cos(th)];
      m -= md2 * dt;
      if (m <= m2end + 1e-12) phase = 3;
    } else break;
    const ax = -g * ur[0] + a * d[0], ay = -g * ur[1] + a * d[1];
    vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt; t += dt;
  }
  return { tCutoff: t, r: [x, y, 0], v: [vx, vy, 0], tSep, rows };
}

/** Altitude, radial and horizontal speed, and circular speed at that height, per row. */
export function series(rows) {
  return rows.map(([t, x, y, vx, vy, phase]) => {
    const r = Math.hypot(x, y);
    const vr = (vx * x + vy * y) / r;
    const vh = (-vx * y + vy * x) / r;
    return { t, h: r - R, vr, vh, v: Math.hypot(vx, vy), vc: Math.sqrt(MU / r), phase };
  });
}
