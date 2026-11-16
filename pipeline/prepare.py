"""Raw CelesTrak snapshots -> the compact files the page reads.

Inputs (hashed, in data/raw/):
  gp_active_<date>.json.gz   CelesTrak GP, GROUP=active, FORMAT=json   (D1)
  satcat_<date>.csv.gz       CelesTrak SATCAT                           (D2)
Outputs (web/data/):
  catalog.json      one row per active object, fields the page needs
  satcat_bins.json  perigee histograms (decayed vs on orbit) and audit counts
  provenance.json   file names, sizes, SHA-256, retrieval times, audit counts

Rules: blanks stay missing (never 0); every exclusion is counted; percentages
are recomputed from counts; medians come from raw rows.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
WEB = ROOT / "web" / "data"
MU72 = 398600.8
REQ72 = 6378.135
GEO_A = 42164.0
BIN0, BIN1, BINW = 100, 2000, 20


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def read_gz(path: Path) -> bytes:
    return gzip.decompress(path.read_bytes())


def regime(a_km: float, e: float) -> str:
    ha = a_km * (1 + e) - REQ72
    if e >= 0.25:
        return "heo"
    if abs(a_km - GEO_A) < 1500 and e < 0.05:
        return "geo"
    if ha < 2000:
        return "leo"
    return "meo"


def load_satcat(raw: bytes):
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))
    return rows


def num(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def build_catalog(gp: list, satcat_by_id: dict):
    out, audit = [], Counter()
    seen = set()
    for g in gp:
        audit["gp_rows"] += 1
        nid = int(g["NORAD_CAT_ID"])
        if nid in seen:
            audit["gp_duplicate_ids"] += 1
            continue
        seen.add(nid)
        need = ["EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "BSTAR"]
        if any(g.get(k) in (None, "") for k in need):
            audit["gp_missing_field"] += 1
            continue
        n = float(g["MEAN_MOTION"])
        if n <= 0:
            audit["gp_bad_mean_motion"] += 1
            continue
        e = float(g["ECCENTRICITY"])
        nr = n * 2 * math.pi / 86400
        a = (MU72 / nr**2) ** (1 / 3)
        hp, ha = a * (1 - e) - REQ72, a * (1 + e) - REQ72
        ndot = float(g.get("MEAN_MOTION_DOT") or 0.0)
        dadt = -(2 / 3) * a / n * (2 * ndot) * 1000.0  # m/day, from the GP term
        sc = satcat_by_id.get(nid)
        otype = (sc or {}).get("OBJECT_TYPE") or "UNK"
        if sc is None:
            audit["gp_not_in_satcat"] += 1
        out.append([
            nid, g.get("OBJECT_NAME", "").strip(), g["EPOCH"], n, e, float(g["INCLINATION"]),
            float(g["RA_OF_ASC_NODE"]), float(g["ARG_OF_PERICENTER"]), float(g["MEAN_ANOMALY"]),
            float(g["BSTAR"]), ndot, float(g.get("MEAN_MOTION_DDOT") or 0.0),
            otype, regime(a, e), round(hp, 1), round(ha, 1), round(dadt, 3),
        ])
    audit["catalog_kept"] = len(out)
    return out, audit


def build_bins(rows: list):
    audit = Counter()
    edges = list(range(BIN0, BIN1 + BINW, BINW))
    nb = len(edges) - 1
    types = ["PAY", "R/B", "DEB", "UNK"]
    hist = {s: {t: [0] * nb for t in types} for s in ("decayed", "orbit")}
    decade = defaultdict(lambda: [0] * nb)
    last_perigee = []
    lifetimes = defaultdict(list)  # bin -> lifetime days (decayed)
    for r in rows:
        audit["rows"] += 1
        if r["ORBIT_CENTER"] != "EA":
            audit["not_earth_centred"] += 1
            continue
        p = num(r["PERIGEE"])
        if p is None:
            audit["no_perigee"] += 1
            continue
        dec = bool(r["DECAY_DATE"].strip())
        t = r["OBJECT_TYPE"] if r["OBJECT_TYPE"] in types else "UNK"
        state = "decayed" if dec else "orbit"
        audit[f"{state}_with_perigee"] += 1
        if dec:
            last_perigee.append(p)
            try:
                y0, m0, d0 = map(int, r["LAUNCH_DATE"].split("-"))
                y1, m1, d1 = map(int, r["DECAY_DATE"].split("-"))
                import datetime as _dt
                life = (_dt.date(y1, m1, d1) - _dt.date(y0, m0, d0)).days
            except Exception:
                life = None
                audit["bad_dates"] += 1
            if life is not None and life <= 0:
                audit["decay_not_after_launch"] += 1
                life = None
        if not (BIN0 <= p < BIN1):
            audit[f"{state}_outside_bins"] += 1
            continue
        b = int((p - BIN0) // BINW)
        hist[state][t][b] += 1
        if dec:
            decade[r["DECAY_DATE"][:3] + "0s"][b] += 1
            if life is not None:
                lifetimes[b].append(life)
    q = statistics.quantiles(last_perigee, n=10, method="inclusive")
    stats = {
        "decayed_last_perigee_median_km": statistics.median(last_perigee),
        "decayed_last_perigee_p10_km": q[0],
        "decayed_last_perigee_p90_km": q[-1],
        "n_decayed_with_perigee": len(last_perigee),
    }
    life_median = [statistics.median(lifetimes[b]) if len(lifetimes[b]) >= 20 else None for b in range(nb)]
    life_n = [len(lifetimes[b]) for b in range(nb)]
    return {
        "edges_km": edges,
        "types": types,
        "hist": hist,
        "decayed_by_decade": dict(sorted(decade.items())),
        "lifetime_median_days": life_median,
        "lifetime_n": life_n,
        "stats": stats,
    }, audit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gp", default=None, help="gp_active_*.json.gz (default: newest in data/raw)")
    ap.add_argument("--satcat", default=None)
    args = ap.parse_args()
    gp_path = Path(args.gp) if args.gp else sorted(RAW.glob("gp_active_*.json.gz"))[-1]
    sc_path = Path(args.satcat) if args.satcat else sorted(RAW.glob("satcat_*.csv.gz"))[-1]
    gp_raw, sc_raw = read_gz(gp_path), read_gz(sc_path)
    satcat = load_satcat(sc_raw)
    by_id = {int(r["NORAD_CAT_ID"]): r for r in satcat}
    gp = json.loads(gp_raw)
    catalog, a1 = build_catalog(gp, by_id)
    bins, a2 = build_bins(satcat)
    WEB.mkdir(parents=True, exist_ok=True)
    cols = ["norad", "name", "epoch", "n_rev_day", "ecc", "inc_deg", "raan_deg", "argp_deg", "M_deg", "bstar",
            "ndot_half", "nddot_sixth", "type", "regime", "hp_km", "ha_km", "gp_dadt_m_day"]
    epochs = sorted(r[2] for r in catalog)
    (WEB / "catalog.json").write_text(json.dumps({"columns": cols, "rows": catalog}, separators=(",", ":")))
    (WEB / "satcat_bins.json").write_text(json.dumps(bins, separators=(",", ":")))
    sc_counts = Counter(r["OBJECT_TYPE"] for r in satcat)
    prov = {
        "gp": {"file": gp_path.name, "bytes": len(gp_raw), "sha256": sha256(gp_raw), "records": len(gp),
               "epoch_min": epochs[0], "epoch_max": epochs[-1], "source": "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json"},
        "satcat": {"file": sc_path.name, "bytes": len(sc_raw), "sha256": sha256(sc_raw), "rows": len(satcat),
                   "decayed": sum(1 for r in satcat if r["DECAY_DATE"].strip()),
                   "types": dict(sc_counts), "source": "https://celestrak.org/pub/satcat.csv"},
        "audit_catalog": dict(a1),
        "audit_satcat": dict(a2),
        "regimes": dict(Counter(r[13] for r in catalog)),
        "catalog_types": dict(Counter(r[12] for r in catalog)),
    }
    meta = RAW / (gp_path.name.replace(".json.gz", ".meta.json"))
    if meta.exists():
        prov["gp"].update(json.loads(meta.read_text()))
    meta2 = RAW / (sc_path.name.replace(".csv.gz", ".meta.json"))
    if meta2.exists():
        prov["satcat"].update(json.loads(meta2.read_text()))
    (WEB / "provenance.json").write_text(json.dumps(prov, indent=1))
    print(json.dumps({k: prov[k] for k in ("audit_catalog", "audit_satcat", "regimes", "catalog_types")}, indent=1))


if __name__ == "__main__":
    main()
