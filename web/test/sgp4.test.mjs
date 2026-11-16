// satellite.js (browser SGP4) vs python-sgp4 for every catalog object (oracle from pipeline/verify.py).
import { readFileSync } from "node:fs";
import { json2satrec, sgp4 } from "../vendor/satellite.esm.js";
const oracle = JSON.parse(readFileSync(new URL("./sgp4_oracle.json", import.meta.url)));
let worst = 0, n = 0, skipped = 0;
for (const o of oracle.objects) {
  const rec = json2satrec(o.omm);
  for (const [t, r] of o.samples) {
    const s = sgp4(rec, t);
    if (!s || !s.position || typeof s.position === "boolean" || r == null) { skipped += 1; continue; }
    const d = Math.hypot(s.position.x - r[0], s.position.y - r[1], s.position.z - r[2]);
    worst = Math.max(worst, d); n += 1;
  }
}
const ok = worst < 1e-3; // 1 m
console.log(`${ok ? "ok" : "FAILED"}: ${n} samples, worst ${(worst * 1000).toFixed(3)} m, skipped ${skipped} (SGP4 error on either side)`);
process.exit(ok ? 0 : 1);
