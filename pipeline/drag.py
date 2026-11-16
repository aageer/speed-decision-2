"""Drag decay of a near-circular orbit (Project 2, model M3). SIMULATION.

    da/dt = -rho(h) * B * sqrt(mu * a),     B = C_D * A / m   [m^2/kg]

rho(h) is the exponential atmosphere of Vallado (2013), Table 8-4:
rho = rho0 * exp(-(h - h0) / H) for h0 <= h < next h0.
Assumptions: e < 0.01, fixed average atmosphere (no solar or geomagnetic
activity), no atmosphere rotation, no lift, constant B.
Valid range: 150 km <= h <= 1000 km, 0.001 <= B <= 0.05 m^2/kg.
"""
from __future__ import annotations

import math

MU_SI = 398600.4418e9  # m^3/s^2
REQ_KM = 6378.137
H_FLOOR = 150.0
H_TOP = 1000.0

# (h0 km, rho0 kg/m^3, H km), Vallado 2013 Table 8-4, rows from 150 km up.
TABLE = [
    (150, 2.070e-9, 22.523), (180, 5.464e-10, 29.740), (200, 2.789e-10, 37.105),
    (250, 7.248e-11, 45.546), (300, 2.418e-11, 53.628), (350, 9.518e-12, 53.298),
    (400, 3.725e-12, 58.515), (450, 1.585e-12, 60.828), (500, 6.967e-13, 63.822),
    (600, 1.454e-13, 71.835), (700, 3.614e-14, 88.667), (800, 1.170e-14, 124.64),
    (900, 5.245e-15, 181.05), (1000, 3.019e-15, 268.00),
]


def rho(h_km: float) -> float:
    if not (H_FLOOR <= h_km <= H_TOP + 1e-9):
        raise ValueError(f"altitude {h_km:.1f} km is outside 150-1000 km")
    row = TABLE[0]
    for r in TABLE:
        if h_km >= r[0]:
            row = r
    return row[1] * math.exp(-(h_km - row[0]) / row[2])


def dadt_m_per_s(h_km: float, b: float) -> float:
    a = (REQ_KM + h_km) * 1e3
    return -rho(h_km) * b * math.sqrt(MU_SI * a)


def decay(h0_km: float, b: float, dt_s: float | None = None, max_days: float = 36500.0):
    """RK4 in a; returns list of (day, h_km) samples once per day and the end."""
    if b < 0:
        raise ValueError("B must be >= 0")
    if not (H_FLOOR <= h0_km <= H_TOP):
        raise ValueError("start altitude outside 150-1000 km")
    if dt_s is None:
        dt_s = 3600.0 if h0_km > 500 else 600.0  # same rule as web/js/drag.js
    a = (REQ_KM + h0_km) * 1e3
    t = 0.0
    out = [(0.0, h0_km)]
    next_day = 86400.0

    def f(a_m):
        h = a_m / 1e3 - REQ_KM
        h = max(h, H_FLOOR)
        return -rho(h) * b * math.sqrt(MU_SI * a_m)

    while t < max_days * 86400 and a / 1e3 - REQ_KM > H_FLOOR and b > 0:
        k1 = f(a); k2 = f(a + 0.5 * dt_s * k1); k3 = f(a + 0.5 * dt_s * k2); k4 = f(a + dt_s * k3)
        a += dt_s * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        t += dt_s
        if t >= next_day:
            out.append((t / 86400, a / 1e3 - REQ_KM))
            next_day += 86400.0
    out.append((t / 86400, max(a / 1e3 - REQ_KM, H_FLOOR)))
    return out


def lifetime_days(h0_km: float, b: float) -> float | None:
    """Days to reach 150 km, or None if more than 100 years."""
    if b == 0:
        return None
    path = decay(h0_km, b)
    return path[-1][0] if path[-1][1] <= H_FLOOR + 1e-6 else None


def constant_density_sqrt_a(a0_m: float, rho0: float, b: float, t_s: float) -> float:
    """Closed form for constant density: sqrt(a) = sqrt(a0) - 0.5*rho*B*sqrt(mu)*t."""
    return math.sqrt(a0_m) - 0.5 * rho0 * b * math.sqrt(MU_SI) * t_s


def gp_dadt_m_per_day(mean_motion_rev_day: float, ndot_half_rev_day2: float, mu_km3=398600.8) -> float:
    """Decay rate implied by the GP first-derivative term (MEAN_MOTION_DOT = ndot/2)."""
    n = mean_motion_rev_day * 2 * math.pi / 86400
    a_km = (mu_km3 / n**2) ** (1 / 3)
    ndot = 2 * ndot_half_rev_day2
    return -(2.0 / 3.0) * a_km / mean_motion_rev_day * ndot * 1000.0
