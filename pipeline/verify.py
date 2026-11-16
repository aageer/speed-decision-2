"""Pre-registered checks for Project 2. Exits 1 on any failure; writes web/data/checks.json.

C1  cuts at 420 km equal the midterm table (1e-9 km/s)
C2  ISS decay term from the GP record equals -(2/3)(a/n) n_dot (pipeline vs formula, 0.1 m/day)
C3  drag RK4 vs closed form for constant density (relative 1e-9)
C5  SATCAT audit counts reproduce from the hashed raw file
B5  B = 0 gives no decay;  B6  start below 150 km is refused
A1  ascent: full stage-2 burn closes outside the Earth; 99 % burn is an impact
P1  raw snapshots match their recorded SHA-256
P3  JS ports (ascent.js, drag.js) match the Python reference (node test, run separately)
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pipeline import ascent, drag, physics  # noqa: E402

WEB = ROOT / "web" / "data"
checks = []


def add(cid, name, ok, detail):
    checks.append({"id": cid, "name": name, "pass": bool(ok), "detail": detail})


def main():
    th = physics.thresholds(physics.R0, physics.MU_NGA)
    err = max(abs(th["vimp"] - 7.534241599), abs(th["vc"] - 7.657269485), abs(th["vesc"] - 10.829014356))
    add("C1", "Cuts at 420 km match the midterm table (Python)", err < 1e-9, f"max error {err:.1e} km/s")

    prov = json.loads((WEB / "provenance.json").read_text())
    cat = json.loads((WEB / "catalog.json").read_text())
    c = {k: i for i, k in enumerate(cat["columns"])}
    iss = next((r for r in cat["rows"] if r[c["norad"]] == 25544), None)
    if iss:
        ref = drag.gp_dadt_m_per_day(iss[c["n_rev_day"]], iss[c["ndot_half"]])
        add("C2", "ISS decay term: pipeline = formula", abs(ref - iss[c["gp_dadt_m_day"]]) < 0.1, f"{iss[c['gp_dadt_m_day']]:.2f} m/day (formula {ref:.2f})")

    a0, b, t = (drag.REQ_KM + 400) * 1e3, 0.01, 10 * 86400
    r0 = drag.rho(400)
    a = a0
    dt = 600.0
    f = lambda x: -r0 * b * math.sqrt(drag.MU_SI * x)  # noqa: E731
    for _ in range(int(t / dt)):
        k1 = f(a); k2 = f(a + 0.5 * dt * k1); k3 = f(a + 0.5 * dt * k2); k4 = f(a + dt * k3)
        a += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6
    exact = drag.constant_density_sqrt_a(a0, r0, b, t) ** 2
    add("C3", "Drag RK4 vs closed form, constant density (Python)", abs(a - exact) / exact < 1e-9, f"relative error {abs(a - exact) / exact:.1e}")

    add("C5", "SATCAT audit counts reproduce from raw", prov["audit_satcat"]["rows"] == prov["satcat"]["rows"], f"{prov['satcat']['rows']} rows; {prov['satcat']['decayed']} decayed")
    d0 = drag.decay(420, 0.0, max_days=10)
    add("B5", "B = 0: no decay (Python)", abs(d0[-1][1] - 420) < 1e-12, "420 km kept")
    try:
        drag.decay(120, 0.01)
        add("B6", "Start below 150 km refused (Python)", False, "accepted")
    except ValueError:
        add("B6", "Start below 150 km refused (Python)", True, "ValueError")

    def cls(s):
        r, v = np.array(s["r"]), np.array(s["v"])
        return physics.classify_state(r, v, physics.MU_NGA).kind
    k1, k2 = cls(ascent.simulate(1.0, record=False)), cls(ascent.simulate(0.99, record=False))
    add("A1", "Ascent: 100 % burn closes, 99 % impacts (Python)", k1 in ("ellipse", "circle") and k2 == "impact", f"100 %: {k1}; 99 %: {k2}")

    ok = True
    for key in ("gp", "satcat"):
        raw = gzip.decompress((ROOT / "data" / "raw" / prov[key]["file"]).read_bytes())
        ok &= hashlib.sha256(raw).hexdigest() == prov[key]["sha256"]
    add("P1", "Raw snapshots match their SHA-256", ok, f"GP {prov['gp']['sha256'][:12]}…, SATCAT {prov['satcat']['sha256'][:12]}…")

    # Oracle for the JS port test.
    oracle = {"ascent": [], "drag": []}
    for burn in (0.0, 0.5, 0.99, 1.0):
        s = ascent.simulate(burn, record=False)
        oracle["ascent"].append({"burn": burn, "t": s["t_cutoff"], "r": s["r"], "v": s["v"]})
    for h0, bb in ((420, 0.01), (300, 0.004), (600, 0.03)):
        path = drag.decay(h0, bb)
        oracle["drag"].append({"h0": h0, "B": bb, "days": path[-1][0], "h_day100": next((h for d, h in path if d >= 100), None)})
    (ROOT / "web" / "test").mkdir(exist_ok=True)
    (ROOT / "web" / "test" / "oracle.json").write_text(json.dumps(oracle, indent=1))
    res = subprocess.run(["node", str(ROOT / "web" / "test" / "ports.test.mjs")], capture_output=True, text=True)
    add("P3", "JS ports match the Python reference (ascent, drag)", res.returncode == 0, res.stdout.strip().splitlines()[-1] if res.stdout.strip() else res.stderr.strip()[-200:])
    from sgp4.api import Satrec, WGS72
    from sgp4 import omm as _omm
    objs = []
    for row in cat["rows"]:
        fields = {"OBJECT_NAME": row[c["name"]], "OBJECT_ID": "", "EPOCH": row[c["epoch"]], "MEAN_MOTION": row[c["n_rev_day"]], "ECCENTRICITY": row[c["ecc"]],
                  "INCLINATION": row[c["inc_deg"]], "RA_OF_ASC_NODE": row[c["raan_deg"]], "ARG_OF_PERICENTER": row[c["argp_deg"]], "MEAN_ANOMALY": row[c["M_deg"]],
                  "EPHEMERIS_TYPE": 0, "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": row[c["norad"]], "ELEMENT_SET_NO": 999, "REV_AT_EPOCH": 0,
                  "BSTAR": row[c["bstar"]], "MEAN_MOTION_DOT": row[c["ndot_half"]], "MEAN_MOTION_DDOT": row[c["nddot_sixth"]]}
        sat = Satrec()
        _omm.initialize(sat, {k: str(v) for k, v in fields.items()})
        samples = []
        for tm in (0.0, 90.0, 1440.0):
            e, r, v = sat.sgp4_tsince(tm)
            samples.append([tm, list(r) if e == 0 else None])
        objs.append({"omm": fields, "samples": samples})
    (ROOT / "web" / "test" / "sgp4_oracle.json").write_text(json.dumps({"objects": objs}))
    res2 = subprocess.run(["node", str(ROOT / "web" / "test" / "sgp4.test.mjs")], capture_output=True, text=True)
    add("P2", "Browser SGP4 matches python-sgp4 (all objects)", res2.returncode == 0, res2.stdout.strip().splitlines()[-1] if res2.stdout.strip() else res2.stderr.strip()[-200:])

    WEB.joinpath("checks.json").write_text(json.dumps({"checks": checks}, indent=1))
    for ch in checks:
        print(("PASS " if ch["pass"] else "FAIL ") + ch["id"], ch["name"], "|", ch["detail"])
    sys.exit(0 if all(ch["pass"] for ch in checks) else 1)


if __name__ == "__main__":
    main()
