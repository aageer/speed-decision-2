"""Launch-to-orbit ascent (Project 2, View 3). ILLUSTRATIVE SIMULATION.

A generic two-stage rocket as a point mass in one plane through the launch
site, inertial frame, inverse-square gravity, no air drag, flat Earth rotation
term only in the starting speed (latitude 28.5 deg). It is a teaching model of
*how* a satellite gets its state (r, v, gamma); it is not any real vehicle.

Stage 1: vertical rise, pitch kick, then gravity turn (thrust along the
Earth-relative velocity). Stage 2: altitude-rate guidance that aims to reach
420 km when the propellant runs out, while building horizontal speed.
The parameter `burn` (0-1) is the fraction of stage-2 propellant used.
"""
from __future__ import annotations

import math

MU = 398600.4418
R = 6378.137
G0 = 9.80665e-3  # km/s^2
OMEGA = 7.292115e-5
LAT = math.radians(28.5)

P = dict(tw1=1.45, isp1=300.0, m1end=0.30, m2=0.24, m2dry=0.04, tw2=0.7, isp2=345.0,
         tv=12.0, tk=10.0, kick=8.0, ht=420.0, kh=1.5, kv=0.02, dt=0.5)


def simulate(burn: float = 1.0, p: dict = P, record: bool = True):
    burn = min(max(burn, 0.0), 1.0)
    x, y = R, 0.0
    vx, vy = 0.0, OMEGA * R * math.cos(LAT)
    m, t, dt = 1.0, 0.0, p["dt"]
    t1 = p["tw1"] * G0
    md1 = t1 / (p["isp1"] * G0)
    t2 = p["tw2"] * G0 * p["m2"]
    md2 = t2 / (p["isp2"] * G0)
    m2end = p["m2"] - (p["m2"] - p["m2dry"]) * burn
    phase, t_sep = 1, None
    rows = []
    while t < 4000:
        r = math.hypot(x, y)
        ur = (x / r, y / r)
        ut = (-ur[1], ur[0])
        vr = vx * ur[0] + vy * ur[1]
        vt = vx * ut[0] + vy * ut[1]
        h = r - R
        if record:
            rows.append((t, x, y, vx, vy, phase, m))
        if h < -1e-6:
            break
        g = MU / r**2
        if phase == 1:
            if t < p["tv"]:
                d = ur
            elif t < p["tv"] + p["tk"]:
                ang = math.radians(p["kick"]) * (t - p["tv"]) / p["tk"]
                d = (ur[0] * math.cos(ang) + ut[0] * math.sin(ang), ur[1] * math.cos(ang) + ut[1] * math.sin(ang))
            else:
                rvt = vt - OMEGA * r * math.cos(LAT)
                n = math.hypot(vr, rvt)
                d = ((vr * ur[0] + rvt * ut[0]) / n, (vr * ur[1] + rvt * ut[1]) / n)
            a = t1 / m
            m -= md1 * dt
            if m <= p["m1end"]:
                phase, m, t_sep = 2, p["m2"], t + dt
                if burn <= 0:
                    phase = 3
        elif phase == 2:
            a = t2 / m
            tgo = max(20.0, (m - p["m2dry"]) / md2)
            vcmd = max(-0.3, min(1.0, (p["ht"] - h) / tgo * p["kh"]))
            need = g - vt * vt / r + p["kv"] * (vcmd - vr)
            th = math.asin(max(-0.6, min(0.95, need / a)))
            d = (ur[0] * math.sin(th) + ut[0] * math.cos(th), ur[1] * math.sin(th) + ut[1] * math.cos(th))
            m -= md2 * dt
            if m <= m2end + 1e-12:
                phase = 3
        else:
            break
        ax = -g * ur[0] + a * d[0]
        ay = -g * ur[1] + a * d[1]
        vx += ax * dt; vy += ay * dt
        x += vx * dt; y += vy * dt
        t += dt
    return {"t_cutoff": t, "r": [x, y, 0.0], "v": [vx, vy, 0.0], "t_sep": t_sep, "rows": rows}
