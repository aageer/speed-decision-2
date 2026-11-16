"""Two-body state, universal-variable propagation, and trajectory class.

The teaching model is the initial-value problem

    r_dot = v
    v_dot = -mu * r / |r|^3

with no drag, no third body, and no Earth oblateness. Propagation uses the
universal-variable solution of that ODE (Curtis, Algorithm 3.4; Vallado,
Algorithm 8), not a second force model. A separate DOP853 integration is the
pre-registered numerical check in ``model.verify``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

MU_NGA = 398600.4418  # km^3/s^2, WGS 84 defining value, NIMA TR8350.2
MU_WGS72 = 398600.8  # km^3/s^2, SGP4 WGS72 pairing
REQ_WGS84 = 6378.137  # km
REQ_WGS72 = 6378.135  # km
FLATTENING_WGS84 = 298.257223563
R_POLAR_WGS84 = REQ_WGS84 * (1.0 - 1.0 / FLATTENING_WGS84)
OMEGA_EARTH = 7.292115e-5  # rad/s, WGS 84 nominal mean angular velocity
R0 = REQ_WGS84 + 420.0  # km, teaching radius, not a measurement of the ISS
PARABOLA_EPS = 1e-8  # km^2/s^2, pre-registered escape tolerance
IMPACT_TOL_KM = 0.001  # 1 m

# Speeds printed in the proposal table. They are inputs, already rounded to 1e-9 km/s.
TABLE_SPEEDS = {
    "radial": 0.0,
    "under_impact": 7.533241599,
    "grazing": 7.534241599,
    "circular": 7.657269485,
    "ellipse": 8.040132959,
    "escape": 10.829014356,
    "hyperbola": 11.370465074,
}


def stumpff(z: float) -> tuple[float, float]:
    """Stumpff C(z) and S(z). Series near zero, closed form otherwise."""
    if abs(z) < 1e-4:
        z2 = z * z
        z3 = z2 * z
        z4 = z2 * z2
        c = 0.5 - z / 24.0 + z2 / 720.0 - z3 / 40320.0 + z4 / 3628800.0
        s = 1.0 / 6.0 - z / 120.0 + z2 / 5040.0 - z3 / 362880.0 + z4 / 39916800.0
        return c, s
    if z > 0.0:
        root = math.sqrt(z)
        return (1.0 - math.cos(root)) / z, (root - math.sin(root)) / (root ** 3)
    root = math.sqrt(-z)
    # C = (cosh(root) - 1) / (-z); S = (sinh(root) - root) / (root^3)
    return (math.cosh(root) - 1.0) / (-z), (math.sinh(root) - root) / (root ** 3)


def _chi_guess(dt: float, r0: float, vr0: float, alpha: float, mu: float) -> float:
    sqrt_mu = math.sqrt(mu)
    if alpha > 1e-8:
        return sqrt_mu * dt * alpha
    if alpha < -1e-8:
        a_abs = -1.0 / alpha
        denom = vr0 + math.copysign(math.sqrt(mu * a_abs) * (1.0 - r0 * alpha), dt if dt != 0 else 1.0)
        numer = -2.0 * mu * alpha * dt
        if denom != 0.0 and numer / denom > 0.0:
            return math.copysign(math.sqrt(a_abs) * math.log(numer / denom), dt if dt != 0 else 1.0)
        return sqrt_mu * dt * abs(alpha)
    return sqrt_mu * dt / r0


def solve_chi(dt: float, r0: float, vr0: float, alpha: float, mu: float) -> float:
    """Universal anomaly chi for an elapsed time dt, in km^{1/2}."""
    if dt == 0.0:
        return 0.0
    sqrt_mu = math.sqrt(mu)
    chi = _chi_guess(dt, r0, vr0, alpha, mu)
    last_delta = None
    for _ in range(80):
        z = alpha * chi * chi
        c_coef, s_coef = stumpff(z)
        chi2 = chi * chi
        chi3 = chi2 * chi
        residual = (
            (r0 * vr0 / sqrt_mu) * chi2 * c_coef
            + (1.0 - alpha * r0) * chi3 * s_coef
            + r0 * chi
            - sqrt_mu * dt
        )
        slope = (
            (r0 * vr0 / sqrt_mu) * chi * (1.0 - z * s_coef)
            + (1.0 - alpha * r0) * chi2 * c_coef
            + r0
        )
        if slope == 0.0 or not math.isfinite(slope):
            raise RuntimeError("universal-variable derivative vanished")
        delta = residual / slope
        accepted = False
        trial = delta
        for _damp in range(16):
            chi_try = chi - trial
            z_try = alpha * chi_try * chi_try
            c2, s2 = stumpff(z_try)
            residual_try = (
                (r0 * vr0 / sqrt_mu) * chi_try * chi_try * c2
                + (1.0 - alpha * r0) * chi_try ** 3 * s2
                + r0 * chi_try
                - sqrt_mu * dt
            )
            if math.isfinite(residual_try) and abs(residual_try) <= abs(residual) * 1.0000001:
                chi = chi_try
                residual = residual_try
                delta = trial
                accepted = True
                break
            trial *= 0.5
        if not accepted:
            chi = chi - delta
        if abs(delta) < 1e-12 * max(1.0, abs(chi)):
            return chi
        if last_delta is not None and abs(delta) > abs(last_delta) * 10 and abs(residual) < 1e-8:
            return chi
        last_delta = delta
    raise RuntimeError(f"universal variable did not converge (dt={dt}, alpha={alpha})")


def propagate(r0: np.ndarray, v0: np.ndarray, dt: float, mu: float) -> tuple[np.ndarray, np.ndarray]:
    """Advance a two-body state by dt seconds. Returns kilometers and km/s."""
    r0 = np.asarray(r0, dtype=float)
    v0 = np.asarray(v0, dtype=float)
    if dt == 0.0:
        return r0.copy(), v0.copy()
    radius = float(np.linalg.norm(r0))
    speed = float(np.linalg.norm(v0))
    if radius == 0.0:
        raise ValueError("position is the origin")
    vr0 = float(np.dot(r0, v0) / radius)
    alpha = 2.0 / radius - speed * speed / mu
    chi = solve_chi(dt, radius, vr0, alpha, mu)
    z = alpha * chi * chi
    c_coef, s_coef = stumpff(z)
    sqrt_mu = math.sqrt(mu)
    f_coef = 1.0 - chi * chi / radius * c_coef
    g_coef = dt - chi ** 3 / sqrt_mu * s_coef
    r = f_coef * r0 + g_coef * v0
    r_norm = float(np.linalg.norm(r))
    if r_norm < 1e-8:
        raise RuntimeError("propagation reached the origin")
    fdot = sqrt_mu / (r_norm * radius) * chi * (z * s_coef - 1.0)
    gdot = 1.0 - chi * chi / r_norm * c_coef
    v = fdot * r0 + gdot * v0
    return r, v


def state_from_speed(radius: float, speed: float, gamma_deg: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Place the state on +x with flight-path angle gamma from the local horizontal."""
    gamma = math.radians(gamma_deg)
    r = np.array([radius, 0.0, 0.0])
    v = np.array([speed * math.sin(gamma), speed * math.cos(gamma), 0.0])
    return r, v


@dataclass(frozen=True)
class Elements:
    radius_km: float
    speed_kms: float
    gamma_deg: float
    epsilon: float
    h: float
    eccentricity: float
    semi_major_km: float | None
    inv_a_per_km: float
    periapsis_km: float
    apoapsis_km: float | None
    period_s: float | None
    kind: str  # impact, circle, ellipse, parabola, hyperbola


def specific_energy(speed: float, radius: float, mu: float) -> float:
    return speed * speed / 2.0 - mu / radius


def eccentricity_from_state(r: np.ndarray, v: np.ndarray, mu: float) -> tuple[float, float, float, np.ndarray]:
    """Return e, h, epsilon, and the eccentricity vector."""
    radius = float(np.linalg.norm(r))
    speed = float(np.linalg.norm(v))
    h_vec = np.cross(r, v)
    h = float(np.linalg.norm(h_vec))
    epsilon = specific_energy(speed, radius, mu)
    if h == 0.0 and speed == 0.0:
        e_vec = -r / radius
        return 1.0, 0.0, epsilon, e_vec
    e_vec = np.cross(v, h_vec) / mu - r / radius
    e = float(np.linalg.norm(e_vec))
    return e, h, epsilon, e_vec


def gamma0_eccentricity(radius: float, speed: float, mu: float) -> float:
    """Eccentricity when the flight-path angle is zero."""
    return abs(1.0 - radius * speed * speed / mu)


def thresholds(radius: float, mu: float, req: float = REQ_WGS84) -> dict[str, float]:
    vc = math.sqrt(mu / radius)
    vesc = math.sqrt(2.0 * mu / radius)
    vimp = math.sqrt(2.0 * mu * (1.0 / radius - 1.0 / (radius + req)))
    return {"vc": vc, "vesc": vesc, "vimp": vimp}


def _periapsis_radius(h: float, eccentricity: float, mu: float, radius: float) -> float:
    if h < 1e-8:
        return 0.0
    return (h * h / mu) / (1.0 + eccentricity) if eccentricity > 0.0 else radius


def forward_min_radius(r: np.ndarray, v: np.ndarray, mu: float) -> float:
    """Lowest geocentric radius the forward path reaches, in km.

    A closed orbit is followed until it returns, so an ellipse reaches its
    periapsis. A parabola or hyperbola reaches periapsis only if it is still
    inbound. A radial bound trajectory falls through the center.
    """
    radius = float(np.linalg.norm(r))
    e, h, epsilon, _ = eccentricity_from_state(r, v, mu)
    vr = float(np.dot(r, v) / radius)
    if h < 1e-6:
        if epsilon < -PARABOLA_EPS or vr <= 1e-8:
            return 0.0
        return radius
    rp = _periapsis_radius(h, e, mu, radius)
    outbound_or_rest = vr >= -1e-8
    bound = epsilon < -PARABOLA_EPS
    if outbound_or_rest and not bound:
        return radius
    return rp


def classify_state(r: np.ndarray, v: np.ndarray, mu: float, req: float = REQ_WGS84) -> Elements:
    radius = float(np.linalg.norm(r))
    speed = float(np.linalg.norm(v))
    e, h, epsilon, _ = eccentricity_from_state(r, v, mu)
    vr = float(np.dot(r, v) / radius) if radius else 0.0
    v_horiz = math.sqrt(max(speed * speed - vr * vr, 0.0))
    gamma = math.degrees(math.atan2(vr, v_horiz)) if speed > 0.0 else 0.0
    rp = forward_min_radius(r, v, mu)
    # Geometric periapsis of the conic, even if the forward branch never reaches it.
    if h < 1e-8:
        conic_rp = 0.0 if epsilon < 0.0 or vr <= 0.0 else radius
    else:
        conic_rp = _periapsis_radius(h, e, mu, radius)
    impacts = rp <= req + IMPACT_TOL_KM
    if abs(epsilon) <= PARABOLA_EPS:
        inv_a = 0.0
        semi = None
        kind = "impact" if impacts else "parabola"
        apo = None
        period = None
    else:
        semi = -mu / (2.0 * epsilon)
        inv_a = 1.0 / semi
        if impacts:
            kind = "impact"
            period = None
        elif epsilon < 0.0:
            kind = "circle" if e < 1e-7 else "ellipse"
            period = 2.0 * math.pi * math.sqrt(semi ** 3 / mu)
        else:
            kind = "hyperbola"
            period = None
        if epsilon < 0.0 and e <= 1.0 + 1e-12:
            apo = semi * (1.0 + e)
        else:
            apo = None
    return Elements(
        radius_km=radius,
        speed_kms=speed,
        gamma_deg=gamma,
        epsilon=epsilon,
        h=h,
        eccentricity=e,
        semi_major_km=None if abs(epsilon) <= PARABOLA_EPS else -mu / (2.0 * epsilon),
        inv_a_per_km=0.0 if abs(epsilon) <= PARABOLA_EPS else 1.0 / (-mu / (2.0 * epsilon)),
        periapsis_km=conic_rp,
        apoapsis_km=apo,
        period_s=period,
        kind=kind,
    )


def start_label(elements: Elements) -> str:
    """Whether the initial point is periapsis, apoapsis, or neither."""
    if elements.h < 1e-6:
        return "radial"
    if elements.kind == "circle":
        return "either"
    # Flight-path angle is zero at both apsides.
    if abs(elements.gamma_deg) > 0.05:
        return "neither"
    if elements.apoapsis_km is None:
        return "periapsis"
    if abs(elements.radius_km - elements.periapsis_km) <= 1e-3:
        return "periapsis"
    if abs(elements.radius_km - elements.apoapsis_km) <= 1e-3:
        return "apoapsis"
    return "neither"


def sample_trajectory(
    r0: np.ndarray,
    v0: np.ndarray,
    mu: float,
    req: float = REQ_WGS84,
    horizon_s: float = 120.0 * 60.0,
    n: int = 361,
) -> dict:
    """Time samples of the forward path. Impact arcs stop at the sphere."""
    elements = classify_state(r0, v0, mu, req)
    if elements.period_s is not None:
        t_end = elements.period_s
        stop_at_surface = False
    else:
        t_end = horizon_s
        stop_at_surface = elements.kind == "impact"
    times = np.linspace(0.0, t_end, n)
    positions = []
    velocities = []
    kept_times = []
    hit_time = None
    previous_t = 0.0
    previous_r = r0
    for index, t in enumerate(times):
        if index == 0:
            r, v = r0.copy(), v0.copy()
        else:
            r, v = propagate(r0, v0, float(t), mu)
        radius = float(np.linalg.norm(r))
        if stop_at_surface and radius < req:
            hit_time = _bisect_radius(r0, v0, mu, req, previous_t, float(t), previous_r)
            r_hit, v_hit = propagate(r0, v0, hit_time, mu)
            positions.append(r_hit)
            velocities.append(v_hit)
            kept_times.append(hit_time)
            break
        positions.append(r)
        velocities.append(v)
        kept_times.append(float(t))
        previous_t = float(t)
        previous_r = r
    return {
        "elements": elements,
        "t_s": kept_times,
        "r": positions,
        "v": velocities,
        "hit_time_s": hit_time,
        "horizon_s": t_end if hit_time is None else hit_time,
    }


def _bisect_radius(r0, v0, mu, req, lo, hi, r_lo) -> float:
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        r_mid, _ = propagate(r0, v0, mid, mu)
        if float(np.linalg.norm(r_mid)) > req:
            lo = mid
        else:
            hi = mid
    return hi


def altitude_series(sample: dict, req: float = REQ_WGS84) -> list[tuple[float, float]]:
    series = []
    for t, r in zip(sample["t_s"], sample["r"]):
        series.append((t, float(np.linalg.norm(r)) - req))
    return series
