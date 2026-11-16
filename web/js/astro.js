// Small geometry helpers shared by the views. No physics model lives here:
// the two-body solution is in kepler.js and SGP4 runs in Python.

export const OMEGA_EARTH = 7.292115e-5; // rad/s, WGS 84 nominal

export function wrapLon(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

/** Earth-fixed longitude and geocentric latitude of an inertial point, Earth turned by `angle` rad. */
export function lonLat(r, angle) {
  const rho = Math.hypot(r[0], r[1]);
  const lat = (Math.atan2(r[2], rho) * 180) / Math.PI;
  const lon = wrapLon(((Math.atan2(r[1], r[0]) - angle) * 180) / Math.PI);
  return [lon, lat];
}

/** Subsolar longitude and latitude for a Sun unit vector in the inertial frame. */
export function subsolar(sun, angle) {
  return lonLat(sun, angle);
}

/**
 * Cubic Lagrange interpolation on a uniform grid of 3D samples.
 * `track` is an array of [x, y, z] at times 0, step, 2*step, ... (minutes).
 */
export function interpTrack(track, step, tMin) {
  const n = track.length;
  const u = Math.min(Math.max(tMin / step, 0), n - 1);
  let i = Math.floor(u) - 1;
  i = Math.max(0, Math.min(n - 4, i));
  const s = u - i;
  const w0 = (-(s - 1) * (s - 2) * (s - 3)) / 6;
  const w1 = (s * (s - 2) * (s - 3)) / 2;
  const w2 = (-s * (s - 1) * (s - 3)) / 2;
  const w3 = (s * (s - 1) * (s - 2)) / 6;
  const a = track[i];
  const b = track[i + 1];
  const c = track[i + 2];
  const d = track[i + 3];
  return [
    w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0],
    w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1],
    w0 * a[2] + w1 * b[2] + w2 * c[2] + w3 * d[2],
  ];
}

/** Split a lon/lat polyline where it jumps across the date line. */
export function splitDateLine(points) {
  const segments = [];
  let current = [];
  for (const p of points) {
    const prev = current[current.length - 1];
    if (prev && Math.abs(p[0] - prev[0]) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/** Julian date (UT1 ~ UTC) from a JS millisecond time. */
export function julian(ms) { return ms / 86400000 + 2440587.5; }
/** Greenwich mean sidereal time, IAU-82 (Vallado Algorithm 15), radians. */
export function gmst(ms) {
  const tut1 = (julian(ms) - 2451545.0) / 36525;
  let s = -6.2e-6 * tut1 ** 3 + 0.093104 * tut1 ** 2 + (876600 * 3600 + 8640184.812866) * tut1 + 67310.54841;
  s = ((s % 86400) + 86400) % 86400;
  return ((s / 240) * Math.PI) / 180;
}
/** Low-precision Sun unit vector (Astronomical Almanac), mean equator of date. */
export function sunDir(ms) {
  const n = julian(ms) - 2451545.0;
  const rad = Math.PI / 180;
  const L = ((280.46 + 0.9856474 * n) % 360) * rad;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lam = L + 1.915 * rad * Math.sin(g) + 0.02 * rad * Math.sin(2 * g);
  const eps = (23.439 - 0.0000004 * n) * rad;
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}
