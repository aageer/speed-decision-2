// Tiny SVG chart kit: scales, axes, marks, tooltips. No dependencies.
const NS = "http://www.w3.org/2000/svg";

export function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

export function linear([d0, d1], [r0, r1]) {
  const f = (x) => r0 + ((x - d0) / (d1 - d0)) * (r1 - r0);
  f.invert = (y) => d0 + ((y - r0) / (r1 - r0)) * (d1 - d0);
  f.domain = [d0, d1]; f.range = [r0, r1]; f.log = false;
  f.ticks = (n = 6) => niceTicks(d0, d1, n);
  return f;
}

export function logScale([d0, d1], [r0, r1]) {
  const l0 = Math.log10(d0), l1 = Math.log10(d1);
  const f = (x) => r0 + ((Math.log10(Math.max(x, 1e-300)) - l0) / (l1 - l0)) * (r1 - r0);
  f.invert = (y) => 10 ** (l0 + ((y - r0) / (r1 - r0)) * (l1 - l0));
  f.domain = [d0, d1]; f.range = [r0, r1]; f.log = true;
  f.ticks = () => {
    const out = [];
    for (let e = Math.floor(l0); e <= Math.ceil(l1); e += 1) for (const m of [1, 2, 5]) {
      const v = m * 10 ** e; if (v >= d0 * 0.999 && v <= d1 * 1.001) out.push(v);
    }
    return out;
  };
  return f;
}

export function niceTicks(a, b, n = 6) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const span = hi - lo || 1;
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtTick = (v) => (Math.abs(v) >= 1000 ? fmt(v, 0) : Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(0) : String(+v.toPrecision(4)));

/** A chart frame inside `host`: returns { svg, g, x, y, w, h, plot } with axes drawn. */
export function frame(host, { width, height, margin = { l: 56, r: 16, t: 30, b: 42 }, x, y, xLabel, yLabel, title, grid = true, xFmt = fmtTick, yFmt = fmtTick, at = [0, 0] }) {
  const svg = host.tagName === "svg" ? host : host.appendChild(el("svg", { width, height, viewBox: `0 0 ${width} ${height}` }));
  const g = svg.appendChild(el("g", { transform: `translate(${at[0]},${at[1]})` }));
  const w = width - margin.l - margin.r, h = height - margin.t - margin.b;
  const xs = x.log ? logScale(x.domain, [margin.l, margin.l + w]) : linear(x.domain, [margin.l, margin.l + w]);
  const ys = y.log ? logScale(y.domain, [margin.t + h, margin.t]) : linear(y.domain, [margin.t + h, margin.t]);
  const ax = g.appendChild(el("g", { class: "ax" }));
  for (const t of xs.ticks(x.n || 7)) {
    const px = xs(t);
    if (grid) ax.append(el("line", { x1: px, x2: px, y1: margin.t, y2: margin.t + h, class: "gridl" }));
    ax.append(el("text", { x: px, y: margin.t + h + 15, "text-anchor": "middle" }, xFmt(t)));
  }
  for (const t of ys.ticks(y.n || 5)) {
    const py = ys(t);
    if (grid) ax.append(el("line", { x1: margin.l, x2: margin.l + w, y1: py, y2: py, class: "gridl" }));
    ax.append(el("text", { x: margin.l - 7, y: py + 4, "text-anchor": "end" }, yFmt(t)));
  }
  ax.append(el("line", { x1: margin.l, x2: margin.l + w, y1: margin.t + h, y2: margin.t + h }));
  ax.append(el("line", { x1: margin.l, x2: margin.l, y1: margin.t, y2: margin.t + h }));
  if (xLabel) g.append(el("text", { x: margin.l + w / 2, y: margin.t + h + 33, "text-anchor": "middle", class: "lbl" }, xLabel));
  if (yLabel) g.append(el("text", { x: 14, y: margin.t + h / 2, "text-anchor": "middle", class: "lbl", transform: `rotate(-90 14 ${margin.t + h / 2})` }, yLabel));
  if (title) g.append(el("text", { x: margin.l, y: 18, class: "ttl" }, title));
  const plot = g.appendChild(el("g"));
  const clipId = `c${Math.random().toString(36).slice(2, 8)}`;
  const defs = svg.querySelector("defs") || svg.insertBefore(el("defs"), svg.firstChild);
  const cp = defs.appendChild(el("clipPath", { id: clipId }));
  cp.append(el("rect", { x: margin.l, y: margin.t - 2, width: w, height: h + 4 }));
  plot.setAttribute("clip-path", `url(#${clipId})`);
  return { svg, g, plot, x: xs, y: ys, w, h, m: margin };
}

export function path(points, attrs) {
  let d = "", pen = false;
  for (const p of points) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`; pen = true;
  }
  return el("path", { d, fill: "none", ...attrs });
}

let tipEl = null, hostEl = null;
export function setTip(tip, host) { tipEl = tip; hostEl = host; }
export function showTip(clientX, clientY, title, rows = []) {
  if (!tipEl) return;
  tipEl.replaceChildren();
  const b = document.createElement("b"); b.textContent = title; tipEl.append(b);
  for (const [k, v] of rows) {
    const r = document.createElement("div"); r.className = "row";
    const a = document.createElement("span"); a.textContent = k;
    const c = document.createElement("span"); c.textContent = v;
    r.append(a, c); tipEl.append(r);
  }
  tipEl.hidden = false;
  const box = hostEl.getBoundingClientRect();
  let x = clientX - box.left + 14, y = clientY - box.top + 14;
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  if (x + tw > box.width - 6) x = clientX - box.left - tw - 14;
  if (y + th > box.height - 6) y = clientY - box.top - th - 14;
  tipEl.style.left = `${x}px`; tipEl.style.top = `${y}px`;
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }

/** Hi-DPI canvas placed exactly over an SVG plot area. */
export function overlayCanvas(host, left, top, w, h) {
  const c = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  Object.assign(c.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, pointerEvents: "none" });
  host.append(c);
  const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
  return ctx;
}
