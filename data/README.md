# Data

`raw/` holds the exact bytes downloaded from CelesTrak (gzip-compressed), with their SHA-256 in
`web/data/provenance.json` (`pipeline/verify.py` check P1 re-hashes them).

| File | Source | Notes |
|---|---|---|
| `gp_active_<date>.json.gz` | https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json | General-perturbation (mean) elements of active objects. CelesTrak updates GP data every 2 hours and asks users not to download the same group more often. |
| `satcat_2026-11-15.csv.gz` | https://celestrak.org/pub/satcat.csv | Satellite catalog, all objects ever catalogued (file of 15 Nov 2026, 04:33 GMT). |
| `iss_zarya_gp_2026-10-05.json` | CelesTrak, CATNR=25544 | The midterm's story object (SHA-256 7738ac44…). |

Field definitions: https://celestrak.org/NORAD/documentation/gp-data-formats.php and
https://celestrak.org/satcat/satcat-format.php. Data courtesy of CelesTrak (T. S. Kelso).

To refresh: download the two files again, gzip them into `raw/` with a new date, and run
`python3 -m pipeline.prepare && python3 pipeline/verify.py`.
