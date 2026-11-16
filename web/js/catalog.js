// Active-object catalog (D1) with SGP4 in a Web Worker.
import { parseUtc } from "./sgp4time.js";

export const REGIME_COLOR = { leo: "#c9c8c0", meo: "#e0a32e", geo: "#2fc48e", heo: "#9b8ff0" };
export const TYPE_COLOR = { PAY: "#5fa0f0", "R/B": "#e0a32e", DEB: "#b9b8b0", UNK: "#9b8ff0" };
export const REGIME_NAME = { leo: "LEO", meo: "MEO", geo: "GEO", heo: "HEO" };

export class Catalog {
  constructor(json, prov) {
    this.cols = json.columns;
    this.c = Object.fromEntries(json.columns.map((k, i) => [k, i]));
    this.rows = json.rows;
    this.n = this.rows.length;
    this.byId = new Map(this.rows.map((r, i) => [r[this.c.norad], i]));
    const ref = prov.gp.retrieved_utc || prov.gp.epoch_max;
    this.t0 = parseUtc(ref.replace("Z", ""));
    this.t0Iso = ref;
    this.worker = new Worker(new URL("./sgp4worker.js", import.meta.url), { type: "module" });
    this.pending = new Map();
    this.cache = new Map();
    this.seq = 0;
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "ready") { this.bad = m.bad; resolve(); }
        else if (m.type === "pos") {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          const val = { pos: m.pos, spd: m.spd, fail: m.fail, ms: m.ms };
          this.cache.set(m.ms, val);
          if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
          p?.(val);
        }
      };
    });
    this.worker.postMessage({ type: "init", rows: this.rows, cols: this.cols });
    this.latest = null;
  }
  get(i, key) { return this.rows[i][this.c[key]]; }
  /** Positions of every object at absolute time ms (TEME, km). Cached, async. */
  at(ms) {
    const key = Math.round(ms);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, (v) => { this.latest = v; resolve(v); });
      this.worker.postMessage({ type: "at", ms: key, id });
    });
  }
  regime(i) { return this.rows[i][this.c.regime]; }
  type(i) { return this.rows[i][this.c.type] || "UNK"; }
  name(i) { return this.rows[i][this.c.name]; }
  norad(i) { return this.rows[i][this.c.norad]; }
  meanAlt(i) { return (this.rows[i][this.c.hp_km] + this.rows[i][this.c.ha_km]) / 2; }
  /** Objects that pass the type and regime filters (and the altitude brush, if asked). */
  visible(S, useBrush = false) {
    const out = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i += 1) {
      const r = this.rows[i];
      let ok = S.types[r[this.c.type] in S.types ? r[this.c.type] : "UNK"] && S.regimes[r[this.c.regime]];
      if (ok && useBrush && S.brush) { const h = (r[this.c.hp_km] + r[this.c.ha_km]) / 2; ok = h >= S.brush[0] && h <= S.brush[1]; }
      out[i] = ok ? 1 : 0;
    }
    return out;
  }
}
