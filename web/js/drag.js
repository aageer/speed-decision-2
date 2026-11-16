// Drag decay of a near-circular orbit; port of pipeline/drag.py. SIMULATION.
// da/dt = -rho(h) B sqrt(mu a); exponential atmosphere, Vallado (2013) Table 8-4.
const MU_SI = 398600.4418e9;
export const REQ_KM = 6378.137;
export const H_FLOOR = 150;
export const H_TOP = 1000;
export const TABLE = [
  [150, 2.070e-9, 22.523], [180, 5.464e-10, 29.740], [200, 2.789e-10, 37.105],
  [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628], [350, 9.518e-12, 53.298],
  [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822],
  [600, 1.454e-13, 71.835], [700, 3.614e-14, 88.667], [800, 1.170e-14, 124.64],
  [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268.00],
];
export function rho(h) {
  if (!(h >= H_FLOOR && h <= H_TOP + 1e-9)) throw new RangeError(`altitude ${h.toFixed(1)} km is outside 150-1000 km`);
  let row = TABLE[0];
  for (const r of TABLE) if (h >= r[0]) row = r;
  return row[1] * Math.exp(-(h - row[0]) / row[2]);
}
/** Height loss in metres per day (positive number) at altitude h for B. */
export function lossPerDay(h, B) {
  const a = (REQ_KM + h) * 1e3;
  return rho(h) * B * Math.sqrt(MU_SI * a) * 86400;
}
/** RK4 decay; samples once per day. Returns { days, h[], t[], reachedFloor }. */
export function decay(h0, B, maxDays = 36500) {
  if (!(h0 >= H_FLOOR && h0 <= H_TOP)) throw new RangeError("start altitude outside 150-1000 km");
  if (!(B >= 0)) throw new RangeError("B must be >= 0");
  const dt = h0 > 500 ? 3600 : 600;
  let a = (REQ_KM + h0) * 1e3, t = 0, next = 86400;
  const f = (am) => -rho(Math.max(am / 1e3 - REQ_KM, H_FLOOR)) * B * Math.sqrt(MU_SI * am);
  const T = [0], H = [h0];
  while (t < maxDays * 86400 && a / 1e3 - REQ_KM > H_FLOOR) {
    const k1 = f(a), k2 = f(a + 0.5 * dt * k1), k3 = f(a + 0.5 * dt * k2), k4 = f(a + dt * k3);
    a += (dt * (k1 + 2 * k2 + 2 * k3 + k4)) / 6; t += dt;
    if (t >= next) { T.push(t / 86400); H.push(a / 1e3 - REQ_KM); next += 86400; }
    if (B === 0) break;
  }
  const hEnd = Math.max(a / 1e3 - REQ_KM, H_FLOOR);
  T.push(B === 0 ? maxDays : t / 86400); H.push(B === 0 ? h0 : hEnd);
  return { t: T, h: H, reachedFloor: hEnd <= H_FLOOR + 1e-6, days: T[T.length - 1] };
}
