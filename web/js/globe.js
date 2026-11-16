// Equal-scale 3D globe for The Speed Decision II (shaders reused from the midterm scene.js).
// the orbits, and the real satellites. Frame: z up, kilometers, inertial axes.
// The Earth group is turned by an angle the caller sets (GMST for the catalog,
// omega * t for the teaching experiment), so continents sit where they were.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

// Local copies first (offline demo); the same NASA images from a pinned public
// mirror if a local file is missing (the hosted build ships code and data only).
const MIRROR = "https://raw.githubusercontent.com/vasturiano/three-globe/1e1f4400b80179809f761e632e207d9a3cfc298e/example/img/";
const pair = (local, remote) => [local, remote];
const TEXTURES = {
  day: pair("assets/earth/blue-marble-4096.jpg", `${MIRROR}earth-blue-marble.jpg`),
  night: pair("assets/earth/black-marble-2048.jpg", `${MIRROR}earth-night.jpg`),
  water: pair("assets/earth/water-mask-2048.jpg", `${MIRROR}earth-water.png`),
};

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D waterMap;
  uniform vec3 sunDir;
  uniform float realSun;
  uniform float ready;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    float water = texture2D(waterMap, vUv).r;
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float d = dot(n, sunDir);
    float lambert = max(d, 0.0);
    vec3 halfV = normalize(sunDir + viewDir);
    float spec = pow(max(dot(n, halfV), 0.0), 48.0) * water * 0.45;
    vec3 color;
    if (realSun > 0.5) {
      float dayMix = smoothstep(-0.10, 0.16, d);
      vec3 lit = day * (0.10 + 1.05 * lambert) + spec * vec3(1.0, 0.94, 0.82) * step(0.0, d);
      vec3 dark = night * vec3(1.0, 0.82, 0.55) * 1.6 + day * 0.035;
      color = mix(dark, lit, dayMix);
    } else {
      float studio = 0.58 + 0.62 * lambert;
      color = day * studio + spec * 0.6;
    }
    vec3 fallback = vec3(0.07, 0.19, 0.30) * (0.4 + 0.6 * lambert);
    color = mix(fallback, color, ready);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const atmosphereFragment = /* glsl */ `
  uniform vec3 sunDir;
  uniform float realSun;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float rim = 1.0 - abs(dot(normalize(vNormalW), viewDir));
    float glow = pow(rim, 3.2);
    float side = realSun > 0.5 ? 0.25 + 0.75 * smoothstep(-0.35, 0.35, dot(normalize(vNormalW), sunDir)) : 1.0;
    gl_FragColor = vec4(vec3(0.36, 0.62, 1.0) * glow * side, glow * side * 0.85);
  }
`;

const satVertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size;
    gl_Position = projectionMatrix * mv;
  }
`;

const satFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float ring = smoothstep(0.34, 0.40, r);
    vec3 col = mix(vColor, vec3(0.03, 0.04, 0.06), ring);
    float alpha = 1.0 - smoothstep(0.46, 0.5, r);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;
function spherePoint(radius, latDeg, lonDeg) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const c = Math.cos(lat);
  return [radius * c * Math.cos(lon), radius * c * Math.sin(lon), radius * Math.sin(lat)];
}

function graticule() {
  const positions = [];
  const push = (pts) => {
    for (let i = 0; i < pts.length - 1; i += 1) positions.push(...pts[i], ...pts[i + 1]);
  };
  for (let lat = -60; lat <= 60; lat += 30) {
    const ring = [];
    for (let lon = 0; lon <= 360; lon += 3) ring.push(spherePoint(1.0015, lat, lon));
    push(ring);
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const meridian = [];
    for (let lat = -90; lat <= 90; lat += 3) meridian.push(spherePoint(1.0015, lat, lon));
    push(meridian);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function starfield(count = 2600) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i += 1) {
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const radius = 900000;
    positions.set([radius * s * Math.cos(phi), radius * s * Math.sin(phi), radius * u], i * 3);
    const b = 0.25 + 0.75 * Math.pow(rand(), 3);
    colors.set([b * 0.92, b * 0.95, b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false });
  return new THREE.Points(geometry, material);
}

function labelSprite(text, color = "#d9d7cf") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const pen = canvas.getContext("2d");
  pen.fillStyle = color;
  pen.font = "500 40px 'IBM Plex Sans', system-ui, sans-serif";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  pen.fillText(text, 128, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(900, 340, 1);
  return sprite;
}

export function mountGlobe(canvas, markerLayer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x070a10, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 10, 3_000_000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 7200; controls.maxDistance = 900000;
  scene.add(starfield());

  const uniforms = {
    dayMap: { value: null }, nightMap: { value: null }, waterMap: { value: null },
    sunDir: { value: new THREE.Vector3(1, -0.4, 0.3).normalize() }, realSun: { value: 1 }, ready: { value: 0 },
  };
  const blank = new THREE.DataTexture(new Uint8Array([20, 40, 60, 255]), 1, 1); blank.needsUpdate = true;
  uniforms.dayMap.value = uniforms.nightMap.value = uniforms.waterMap.value = blank;
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin("anonymous");
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const load = (key, urls, srgb) => new Promise((resolve) => {
    const attempt = (i) => {
      if (i >= urls.length) return resolve(false);
      loader.load(urls[i], (tex) => { if (srgb) tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso; uniforms[key].value = tex; resolve(true); }, undefined, () => attempt(i + 1));
    };
    attempt(0);
  });
  let dirty = true;
  const textureReady = Promise.all([load("dayMap", TEXTURES.day, true), load("nightMap", TEXTURES.night, true), load("waterMap", TEXTURES.water, false)])
    .then((ok) => { uniforms.ready.value = ok[0] ? 1 : 0; dirty = true; return ok.every(Boolean); });

  const R = 6378.137;
  const earthGroup = new THREE.Group(); scene.add(earthGroup);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), new THREE.ShaderMaterial({ uniforms, vertexShader: earthVertex, fragmentShader: earthFragment }));
  earth.rotation.x = Math.PI / 2; earthGroup.add(earth);
  const grid = new THREE.LineSegments(graticule(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }));
  earthGroup.add(grid);
  earthGroup.scale.setScalar(R);
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 48), new THREE.ShaderMaterial({
    uniforms: { sunDir: uniforms.sunDir, realSun: uniforms.realSun }, vertexShader: atmosphereVertex, fragmentShader: atmosphereFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
  atmosphere.scale.setScalar(R); scene.add(atmosphere);

  // ---- lines ----
  const lines = new THREE.Group(); scene.add(lines);
  const lineMats = [];
  function clearLines() {
    for (const c of [...lines.children]) { c.geometry.dispose(); c.material.dispose(); lines.remove(c); }
    lineMats.length = 0;
  }
  function addLine({ points, color = "#ffffff", width = 2, dashed = false, opacity = 1, overlay = false }) {
    const flat = [];
    for (const p of points) if (p && Number.isFinite(p[0])) flat.push(p[0], p[1], p[2] ?? 0);
    if (flat.length < 6) return;
    const geo = new LineGeometry(); geo.setPositions(flat);
    const mat = new LineMaterial({ color, linewidth: width, dashed, dashSize: 260, gapSize: 170, transparent: opacity < 1, opacity, depthTest: !overlay });
    if (dashed) mat.defines.USE_DASH = "";
    mat.resolution.set(canvas.clientWidth || 1, canvas.clientHeight || 1);
    const line = new Line2(geo, mat); if (dashed) line.computeLineDistances();
    line.frustumCulled = false; line.renderOrder = overlay ? 3 : 1;
    lines.add(line); lineMats.push(mat);
  }
  function setLines(list) { clearLines(); for (const l of list) addLine(l); dirty = true; }

  // ---- point clouds (satellites, particles) ----
  function makeCloud(capacity) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(capacity * 3), col = new Float32Array(capacity * 3), size = new Float32Array(capacity);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({ vertexShader: satVertex, fragmentShader: satFragment, transparent: true, depthWrite: false });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 2;
    scene.add(pts);
    return { geo, pos, col, size, pts, capacity, count: 0 };
  }
  let sats = null;
  const particles = makeCloud(4096);
  const tmpColor = new THREE.Color();
  function setCloud(cloud, positions, colors, sizes, count) {
    const n = Math.min(count, cloud.capacity);
    cloud.pos.set(positions.subarray ? positions.subarray(0, n * 3) : positions.slice(0, n * 3));
    if (colors) cloud.col.set(colors.subarray ? colors.subarray(0, n * 3) : colors.slice(0, n * 3));
    if (sizes) cloud.size.set(sizes.subarray ? sizes.subarray(0, n) : sizes.slice(0, n));
    cloud.count = n; cloud.geo.setDrawRange(0, n);
    cloud.geo.attributes.position.needsUpdate = true;
    if (colors) cloud.geo.attributes.color.needsUpdate = true;
    if (sizes) cloud.geo.attributes.size.needsUpdate = true;
    dirty = true;
  }
  function setSatellites(positions, colors, sizes, count) {
    // Objects that SGP4 could not place come as NaN: park them at the centre with size 0.
    let clean = positions, sz = sizes;
    for (let i = 0; i < count; i += 1) {
      if (!Number.isFinite(positions[i * 3])) {
        if (clean === positions) { clean = Float32Array.from(positions); sz = Float32Array.from(sizes); }
        clean[i * 3] = clean[i * 3 + 1] = clean[i * 3 + 2] = 0; sz[i] = 0;
      }
    }
    positions = clean; sizes = sz;
    if (!sats || sats.capacity < count) { if (sats) { scene.remove(sats.pts); sats.geo.dispose(); } sats = makeCloud(Math.max(count, 1024)); }
    setCloud(sats, positions, colors, sizes, count);
  }
  function hideSatellites() { if (sats) { sats.geo.setDrawRange(0, 0); sats.count = 0; dirty = true; } }
  function setParticles(list) {
    const n = Math.min(list.length, particles.capacity);
    const P = new Float32Array(n * 3), C = new Float32Array(n * 3), S = new Float32Array(n);
    list.slice(0, n).forEach((p, i) => {
      P.set([p.p[0], p.p[1], p.p[2] ?? 0], i * 3);
      tmpColor.set(p.color).convertSRGBToLinear(); C.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
      S[i] = p.size ?? 5;
    });
    setCloud(particles, P, C, S, n);
  }

  // ---- HTML markers ----
  let markers = [];
  function setMarkers(list) { markers = list; dirty = true; }
  const v3 = new THREE.Vector3();
  function project(p) {
    v3.set(p[0], p[1], p[2] ?? 0).project(camera);
    return { x: (v3.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v3.y * 0.5 + 0.5) * canvas.clientHeight, front: v3.z < 1 };
  }
  function occluded(p) {
    const cam = camera.position;
    const d = [p[0] - cam.x, p[1] - cam.y, (p[2] ?? 0) - cam.z];
    const L = Math.hypot(...d); const u = d.map((c) => c / L);
    const b = cam.x * u[0] + cam.y * u[1] + cam.z * u[2];
    const c = cam.x ** 2 + cam.y ** 2 + cam.z ** 2 - R * R;
    const disc = b * b - c; if (disc < 0) return false;
    const t = -b - Math.sqrt(disc); return t > 0 && t < L - 1;
  }
  function layoutMarkers() {
    markerLayer.replaceChildren();
    for (const m of markers) {
      const s = project(m.p); if (!s.front) continue;
      const hid = occluded(m.p);
      const dot = document.createElement("div"); dot.className = "mk";
      dot.style.left = `${s.x}px`; dot.style.top = `${s.y}px`; dot.style.background = m.color; dot.style.opacity = hid ? 0.35 : 1;
      if (m.size) { dot.style.width = dot.style.height = `${m.size}px`; }
      markerLayer.append(dot);
      if (m.label && !hid) { const l = document.createElement("div"); l.className = "mk-label"; l.textContent = m.label; l.style.left = `${s.x}px`; l.style.top = `${s.y}px`; markerLayer.append(l); }
    }
  }

  function pick(clientX, clientY, maxPx = 9) {
    if (!sats || !sats.count) return -1;
    const box = canvas.getBoundingClientRect();
    const mx = clientX - box.left, my = clientY - box.top;
    let best = -1, bestD = maxPx * maxPx;
    for (let i = 0; i < sats.count; i += 1) {
      if (sats.size[i] <= 0) continue;
      v3.set(sats.pos[i * 3], sats.pos[i * 3 + 1], sats.pos[i * 3 + 2]).project(camera);
      if (v3.z >= 1) continue;
      const x = (v3.x * 0.5 + 0.5) * box.width, y = (-v3.y * 0.5 + 0.5) * box.height;
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bestD && !occluded([sats.pos[i * 3], sats.pos[i * 3 + 1], sats.pos[i * 3 + 2]])) { bestD = d; best = i; }
    }
    return best;
  }

  function frameTo(radius, dir = [1, -1.1, 0.55]) {
    const L = Math.hypot(...dir);
    const dist = Math.max(radius, R * 1.05) / Math.tan((camera.fov * Math.PI) / 360) * 1.08;
    camera.position.set((dir[0] / L) * dist, (dir[1] / L) * dist, (dir[2] / L) * dist);
    controls.target.set(0, 0, 0); controls.update(); dirty = true;
  }
  let shift = 0;
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    if (shift) camera.setViewOffset(w, h, 0, h * shift, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    for (const m of lineMats) m.resolution.set(w, h);
    dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);
  controls.addEventListener("change", () => { dirty = true; });

  let onFrame = null, active = true;
  function loop(now) {
    if (onFrame) onFrame(now);
    if (controls.update() || dirty) {
      if (active) { renderer.render(scene, camera); layoutMarkers(); }
      dirty = false;
    }
    requestAnimationFrame(loop);
  }
  resize(); frameTo(R * 2.6); requestAnimationFrame(loop);

  return {
    R, textureReady, setLines, setSatellites, hideSatellites, setParticles, setMarkers, pick, frameTo, resize,
    setEarthAngle(a) { earthGroup.rotation.z = a; dirty = true; },
    setSun(dir, real = true) { uniforms.sunDir.value.set(dir[0], dir[1], dir[2]).normalize(); uniforms.realSun.value = real ? 1 : 0; dirty = true; },
    setActive(on) { active = on; dirty = true; },
    setShift(f) { shift = f; resize(); },
    onFrame(cb) { onFrame = cb; },
    touch() { dirty = true; },
    camera,
  };
}
