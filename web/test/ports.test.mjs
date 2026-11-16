// JS ports vs the Python reference written by pipeline/verify.py (web/test/oracle.json).
import { readFileSync } from "node:fs";
import { simulate } from "../js/ascent.js";
import { decay } from "../js/drag.js";
const oracle = JSON.parse(readFileSync(new URL("./oracle.json", import.meta.url)));
let worst = 0, fails = 0;
for (const o of oracle.ascent) {
  const s = simulate(o.burn);
  const dr = Math.hypot(s.r[0] - o.r[0], s.r[1] - o.r[1]), dv = Math.hypot(s.v[0] - o.v[0], s.v[1] - o.v[1]);
  worst = Math.max(worst, dr);
  if (dr > 1e-6 || dv > 1e-9 || Math.abs(s.tCutoff - o.t) > 1e-9) { fails += 1; console.log("ascent mismatch", o.burn, dr, dv); }
}
for (const o of oracle.drag) {
  const d = decay(o.h0, o.B);
  if (Math.abs(d.days - o.days) > 1e-6) { fails += 1; console.log("drag days mismatch", o, d.days); }
  const k = d.t.findIndex((t) => t >= 100);
  if (o.h_day100 != null && Math.abs(d.h[k] - o.h_day100) > 1e-6) { fails += 1; console.log("drag h mismatch", o, d.h[k]); }
}
console.log(`${fails === 0 ? "ok" : "FAILED"}: ascent worst position gap ${worst.toExponential(1)} km; ${oracle.drag.length} drag runs`);
process.exit(fails ? 1 : 0);
