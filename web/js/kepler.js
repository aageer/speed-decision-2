// Browser port of model/physics.py. data/kepler_oracle.json must match to 1 m.

export const MU_NGA = 398600.4418;
export const REQ_WGS84 = 6378.137;
export const PARABOLA_EPS = 1e-8;
export const IMPACT_TOL_KM = 0.001;

export function stumpff(z) {
  if (Math.abs(z) < 1e-4) {
    const z2 = z * z;
    const z3 = z2 * z;
    const z4 = z2 * z2;
    const c = 0.5 - z / 24 + z2 / 720 - z3 / 40320 + z4 / 3628800;
    const s = 1 / 6 - z / 120 + z2 / 5040 - z3 / 362880 + z4 / 39916800;
    return [c, s];
  }
  if (z > 0) {
    const root = Math.sqrt(z);
    return [(1 - Math.cos(root)) / z, (root - Math.sin(root)) / root ** 3];
  }
  const root = Math.sqrt(-z);
  return [(Math.cosh(root) - 1) / -z, (Math.sinh(root) - root) / root ** 3];
}

function chiGuess(dt, r0, vr0, alpha, mu) {
  const sqrtMu = Math.sqrt(mu);
  if (alpha > 1e-8) return sqrtMu * dt * alpha;
  if (alpha < -1e-8) {
    const aAbs = -1 / alpha;
    const sign = dt < 0 ? -1 : 1;
    const denom = vr0 + sign * Math.sqrt(mu * aAbs) * (1 - r0 * alpha);
    const numer = -2 * mu * alpha * dt;
    if (denom !== 0 && numer / denom > 0) {
      return sign * Math.sqrt(aAbs) * Math.log(numer / denom);
    }
    return sqrtMu * dt * Math.abs(alpha);
  }
  return (sqrtMu * dt) / r0;
}

export function solveChi(dt, r0, vr0, alpha, mu) {
  if (dt === 0) return 0;
  const sqrtMu = Math.sqrt(mu);
  let chi = chiGuess(dt, r0, vr0, alpha, mu);
  let lastDelta = null;
  for (let iter = 0; iter < 80; iter += 1) {
    const z = alpha * chi * chi;
    const [cCoef, sCoef] = stumpff(z);
    const chi2 = chi * chi;
    const chi3 = chi2 * chi;
    let residual =
      (r0 * vr0 / sqrtMu) * chi2 * cCoef +
      (1 - alpha * r0) * chi3 * sCoef +
      r0 * chi -
      sqrtMu * dt;
    const slope =
      (r0 * vr0 / sqrtMu) * chi * (1 - z * sCoef) +
      (1 - alpha * r0) * chi2 * cCoef +
      r0;
    if (slope === 0 || !Number.isFinite(slope)) {
      throw new Error("universal-variable derivative vanished");
    }
    let delta = residual / slope;
    let accepted = false;
    let trial = delta;
    for (let damp = 0; damp < 16; damp += 1) {
      const chiTry = chi - trial;
      const zTry = alpha * chiTry * chiTry;
      const [c2, s2] = stumpff(zTry);
      const residualTry =
        (r0 * vr0 / sqrtMu) * chiTry * chiTry * c2 +
        (1 - alpha * r0) * chiTry ** 3 * s2 +
        r0 * chiTry -
        sqrtMu * dt;
      if (Number.isFinite(residualTry) && Math.abs(residualTry) <= Math.abs(residual) * 1.0000001) {
        chi = chiTry;
        residual = residualTry;
        delta = trial;
        accepted = true;
        break;
      }
      trial *= 0.5;
    }
    if (!accepted) chi -= delta;
    if (Math.abs(delta) < 1e-12 * Math.max(1, Math.abs(chi))) return chi;
    if (lastDelta !== null && Math.abs(delta) > Math.abs(lastDelta) * 10 && Math.abs(residual) < 1e-8) {
      return chi;
    }
    lastDelta = delta;
  }
  throw new Error(`universal variable did not converge (dt=${dt}, alpha=${alpha})`);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function stateFromSpeed(radius, speed, gammaDeg = 0) {
  const gamma = (gammaDeg * Math.PI) / 180;
  return {
    r: [radius, 0, 0],
    v: [speed * Math.sin(gamma), speed * Math.cos(gamma), 0],
  };
}

export function propagate(r0, v0, dt, mu) {
  if (dt === 0) return { r: r0.slice(), v: v0.slice() };
  const radius = norm(r0);
  const speed = norm(v0);
  const vr0 = dot(r0, v0) / radius;
  const alpha = 2 / radius - (speed * speed) / mu;
  const chi = solveChi(dt, radius, vr0, alpha, mu);
  const z = alpha * chi * chi;
  const [cCoef, sCoef] = stumpff(z);
  const sqrtMu = Math.sqrt(mu);
  const f = 1 - ((chi * chi) / radius) * cCoef;
  const g = dt - (chi ** 3 / sqrtMu) * sCoef;
  const r = add(scale(r0, f), scale(v0, g));
  const rNorm = norm(r);
  const fdot = (sqrtMu / (rNorm * radius)) * chi * (z * sCoef - 1);
  const gdot = 1 - ((chi * chi) / rNorm) * cCoef;
  const v = add(scale(r0, fdot), scale(v0, gdot));
  return { r, v };
}

function eccentricityFromState(r, v, mu) {
  const radius = norm(r);
  const speed = norm(v);
  const hVec = cross(r, v);
  const h = norm(hVec);
  const epsilon = (speed * speed) / 2 - mu / radius;
  if (h === 0 && speed === 0) {
    return { e: 1, h: 0, epsilon, eVec: scale(r, -1 / radius) };
  }
  const eVec = add(scale(cross(v, hVec), 1 / mu), scale(r, -1 / radius));
  return { e: norm(eVec), h, epsilon, eVec };
}

function periapsisRadius(h, eccentricity, mu, radius) {
  if (h < 1e-8) return 0;
  return eccentricity > 0 ? h * h / mu / (1 + eccentricity) : radius;
}

export function forwardMinRadius(r, v, mu) {
  const radius = norm(r);
  const { e, h, epsilon } = eccentricityFromState(r, v, mu);
  const vr = dot(r, v) / radius;
  if (h < 1e-6) {
    if (epsilon < -PARABOLA_EPS || vr <= 1e-8) return 0;
    return radius;
  }
  const rp = periapsisRadius(h, e, mu, radius);
  const outboundOrRest = vr >= -1e-8;
  const bound = epsilon < -PARABOLA_EPS;
  if (outboundOrRest && !bound) return radius;
  return rp;
}

export function thresholds(radius, mu, req = REQ_WGS84) {
  const vc = Math.sqrt(mu / radius);
  const vesc = Math.sqrt((2 * mu) / radius);
  const vimp = Math.sqrt(2 * mu * (1 / radius - 1 / (radius + req)));
  return { vc, vesc, vimp };
}

export function classify(r, v, mu, req = REQ_WGS84) {
  const radius = norm(r);
  const speed = norm(v);
  const { e, h, epsilon } = eccentricityFromState(r, v, mu);
  const vr = radius ? dot(r, v) / radius : 0;
  const vHoriz = Math.sqrt(Math.max(speed * speed - vr * vr, 0));
  const gammaDeg = speed > 0 ? (Math.atan2(vr, vHoriz) * 180) / Math.PI : 0;
  const forwardMin = forwardMinRadius(r, v, mu);
  const conicRp = h < 1e-8 ? (epsilon < 0 || vr <= 0 ? 0 : radius) : periapsisRadius(h, e, mu, radius);
  const impacts = forwardMin <= req + IMPACT_TOL_KM;
  let kind;
  let semiMajor = null;
  let invA = 0;
  let apoapsis = null;
  let periodS = null;
  if (Math.abs(epsilon) <= PARABOLA_EPS) {
    kind = impacts ? "impact" : "parabola";
  } else {
    semiMajor = -mu / (2 * epsilon);
    invA = 1 / semiMajor;
    if (impacts) kind = "impact";
    else if (epsilon < 0) {
      kind = e < 1e-7 ? "circle" : "ellipse";
      periodS = 2 * Math.PI * Math.sqrt(semiMajor ** 3 / mu);
    } else kind = "hyperbola";
    if (epsilon < 0 && e <= 1 + 1e-12) apoapsis = semiMajor * (1 + e);
  }
  let apsis = "neither";
  if (h < 1e-6) apsis = "radial";
  else if (kind === "circle") apsis = "either";
  else if (Math.abs(gammaDeg) <= 0.05) {
    if (apoapsis == null) apsis = "periapsis";
    else if (Math.abs(radius - conicRp) <= 1e-3) apsis = "periapsis";
    else if (Math.abs(radius - apoapsis) <= 1e-3) apsis = "apoapsis";
  }
  return {
    radius,
    speed,
    gammaDeg,
    epsilon,
    h,
    eccentricity: e,
    semiMajor,
    invA,
    periapsis: conicRp,
    apoapsis,
    forwardMin,
    periodS,
    kind,
    apsis,
  };
}

export function family(kind) {
  if (kind === "impact") return "impact";
  if (kind === "circle" || kind === "ellipse") return "closed";
  return "escape";
}

export function samplePath(r0, v0, mu, req = REQ_WGS84, count = 361) {
  const elements = classify(r0, v0, mu, req);
  const bound = elements.semiMajor != null && elements.epsilon < -PARABOLA_EPS;
  const mathPeriod = bound ? 2 * Math.PI * Math.sqrt(Math.abs(elements.semiMajor) ** 3 / mu) : null;
  const crosses = elements.kind === "impact" && elements.periapsis < req - 1e-4;
  const horizon = 120 * 60;
  let tEnd = horizon;
  if (elements.periodS != null) tEnd = elements.periodS;
  else if (crosses && mathPeriod != null) tEnd = mathPeriod;
  else if (!crosses && mathPeriod != null) tEnd = mathPeriod;
  const times = [];
  const positions = [];
  let hitTime = null;
  let previousT = 0;
  for (let i = 0; i < count; i += 1) {
    const t = (tEnd * i) / (count - 1);
    const { r, v } = i === 0 ? { r: r0.slice(), v: v0.slice() } : propagate(r0, v0, t, mu);
    const radius = norm(r);
    if (crosses && radius < req) {
      let lo = previousT;
      let hi = t;
      for (let step = 0; step < 60; step += 1) {
        const mid = 0.5 * (lo + hi);
        const probe = propagate(r0, v0, mid, mu).r;
        if (norm(probe) > req) lo = mid;
        else hi = mid;
      }
      hitTime = hi;
      const hit = propagate(r0, v0, hitTime, mu);
      times.push(hitTime);
      positions.push(hit.r);
      break;
    }
    times.push(t);
    positions.push(r);
    previousT = t;
  }
  return { elements, t: times, r: positions, hitTime, horizon: hitTime ?? tEnd };
}
