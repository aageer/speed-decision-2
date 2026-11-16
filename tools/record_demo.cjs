// Frame-by-frame demo recorder: drives the app's shared state, screenshots each
// frame, and leaves PNGs for ffmpeg. Usage: node tools/record_demo.cjs http://127.0.0.1:8790 /tmp/frames
const { chromium } = require("playwright");
const fs = require("fs");
const [url, outDir] = [process.argv[2] || "http://127.0.0.1:8790", process.argv[3] || "/tmp/frames"];
const FPS = 30;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__sd2 && window.__sd2.ready, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: `
    #cap { position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 99; max-width: 1180px;
      background: rgba(16,16,18,.86); color: #fff; font: 500 26px/1.35 "IBM Plex Sans", sans-serif; padding: 14px 24px; border-radius: 14px; text-align: center; }
    #cap small { display:block; font-size: 17px; color: #cfcfca; margin-top: 4px; }
    #card { position: fixed; inset: 0; z-index: 100; background: #f6f6f3; display: none; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
    #card h1 { font: 600 76px/1.1 "Source Serif 4", Georgia, serif; margin: 0; } #card h1 em { font-style: normal; color: #2a78d6; }
    #card p { font: 400 30px "IBM Plex Sans", sans-serif; color: #55544f; margin: 16px 0 0; } #card .m { font-size: 22px; color: #8b8a84; margin-top: 34px; }` });
  await page.evaluate(() => { const c = document.createElement("div"); c.id = "cap"; c.hidden = true; document.body.append(c); const k = document.createElement("div"); k.id = "card"; document.body.append(k); });

  let n = 0;
  const shot = async () => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.screenshot({ path: `${outDir}/f${String(n).padStart(5, "0")}.png` }); n += 1; };
  const caption = (text, sub = "") => page.evaluate(([t, s]) => { const c = document.getElementById("cap"); c.hidden = !t; c.innerHTML = t + (s ? `<small>${s}</small>` : ""); }, [text, sub]);
  const card = (html) => page.evaluate((h) => { const k = document.getElementById("card"); k.style.display = h ? "flex" : "none"; k.innerHTML = h || ""; }, html);
  const view = (v) => page.evaluate((x) => window.__sd2.enterView(x), v);
  const set = (patch) => page.evaluate((p) => { Object.assign(window.__sd2.S, p); window.__sd2.render(); }, patch);
  const hold = async (sec) => { for (let i = 0; i < Math.round(sec * FPS); i += 1) await shot(); };
  const anim = async (sec, fn) => { const N = Math.round(sec * FPS); for (let i = 0; i < N; i += 1) { await page.evaluate(fn.toString().startsWith("async") ? `(${fn})(${i / (N - 1)})` : `(${fn})(${i / (N - 1)})`); await shot(); } };
  const sky = (minutes) => page.evaluate(async (m) => { const s = window.__sd2; s.S.skyMin = m; await s.data.cat.at(s.data.cat.t0 + m * 60000); s.render(); }, minutes);

  // 1. Title
  await card(`<h1>The <em>Speed</em> Decision II</h1><p>What keeps an orbit, and for how long?</p><p class="m">CPS 5745 · Project 2 · Akhil Ageer · Kean University</p>`);
  await hold(3.2); await card(null);

  // 2. Sky now
  await view(1); await page.waitForTimeout(1500);
  await caption("Act I · Every active object in orbit, placed by SGP4 over the real Earth", "CelesTrak catalog snapshot · colour = orbit regime · click any dot to make it the shared state");
  for (let i = 0; i < 9 * FPS; i += 1) { await sky(i * 0.35); await shot(); }

  // 3. Speed band
  await view(2); await page.waitForTimeout(800);
  await caption("At its own height, every object flies between the impact cut and escape", "Drag to brush heights · the brush filters other views");
  await hold(2.5);
  await anim(2.5, (u) => { window.__sd2.S.brush = [300, 300 + 300 * u + 1]; window.__sd2.render(); });
  await hold(1.5);

  // 4. Launch to orbit
  await set({ brush: null });
  await page.evaluate(() => { const s = window.__sd2; s.S.launchMode = "rocket"; s.S.burn = 1; s.S.launchT = 0; s.enterView(3); });
  await page.waitForTimeout(1200);
  await caption("Act II · How does a satellite get into orbit?", "Climbing is easy. The hard part is sideways speed: about 7.66 km/s at 420 km");
  await anim(11, (u) => { const s = window.__sd2; s.S.launchT = 556 * u; s.render(); });
  await caption("Engine cutoff: sideways speed reaches the circular speed, so the path closes", "Full burn → a closed orbit at about 412 × 435 km");
  await anim(5, (u) => { const s = window.__sd2; s.S.launchT = 556 + 5200 * u; s.render(); });
  await page.evaluate(() => { const s = window.__sd2; s.S.burn = 0.99; s.S.launchT = 0; s.enterView(3); });
  await page.waitForTimeout(600);
  await caption("Same rocket, stage 2 stopped 1 % early", "160 m/s short of circular speed: the path meets the Earth");
  await anim(8, (u) => { const s = window.__sd2; s.S.launchT = 1700 * u; s.render(); });

  // 5. Newton's cannon
  await page.evaluate(() => { const s = window.__sd2; s.S.launchMode = "cannon"; s.S.burn = 1; s.S.launchT = 0; s.enterView(3); });
  await page.waitForTimeout(800);
  await caption("Newton's cannon: one start, eleven speeds, three fates", "Each dot keeps model time, so faster paths pull ahead");
  await anim(7, (u) => { const s = window.__sd2; s.S.launchT = 5400 * u; s.render(); });

  // 6. Decision map
  await page.evaluate(() => { const s = window.__sd2; s.S.launchMode = "rocket"; s.enterView(4); });
  await caption("The midterm locked the angle at zero. Aim a little down and a closed orbit becomes an impact", "Regions are analytic two-body boundaries, not fitted");
  await anim(6, (u) => { const s = window.__sd2; s.S.speed = 8.6; s.S.gamma = 12 - 26 * u; s.S.stateSource = "decision map"; s.render(); });

  // 7. Energy, shape, clock
  await page.evaluate(() => { const s = window.__sd2; Object.assign(s.S, { speed: 7.657269485, gamma: 0 }); s.enterView(5); });
  await caption("Energy explains escape: it reaches zero only at 10.829 km/s", "A grazing path still has negative energy, so energy cannot be the impact test");
  await anim(4.5, (u) => { const s = window.__sd2; s.S.speed = 6 + 5.4 * u; s.render(); });
  await page.evaluate(() => window.__sd2.enterView(6));
  await caption("The lowest point decides impact: it crosses the ground at the impact cut");
  await anim(4, (u) => { const s = window.__sd2; s.S.speed = 9 - 2.2 * u; s.render(); });
  await page.evaluate(() => { const s = window.__sd2; Object.assign(s.S, { speed: 9.2, gamma: 0, clockT: 0 }); s.enterView(7); });
  await caption("Kepler's second law: equal times sweep equal areas", "Fast near the Earth, slow far away");
  await anim(6, (u) => { const s = window.__sd2; s.S.clockT = 23000 * u; s.render(); });

  // 8. Residual
  await page.evaluate(() => { const s = window.__sd2; Object.assign(s.S, { speed: 7.657269485, residualMin: 0 }); s.enterView(8); });
  await caption("Act III · The textbook path drifts from the catalog theory", "Same start; the gap grows mostly along the track");
  await anim(6, (u) => { const s = window.__sd2; s.S.residualMin = Math.round(180 * u * 2) / 2; s.render(); });

  // 9. Drag decay
  await page.evaluate(() => { const s = window.__sd2; Object.assign(s.S, { decayStartH: 420, B: 0.01, decayDay: 0 }); s.enterView(9); });
  await caption("Drag: a 'closed' orbit at 420 km lasts about 15 months for B = 0.01 m²/kg", "Right: the model against decay rates read from real catalog elements");
  await anim(7, (u) => { const s = window.__sd2; s.S.decayDay = 460 * u; s.render(); });

  // 10. Where orbits end
  await page.evaluate(() => window.__sd2.enterView(10));
  await caption("Where real orbits end: decayed objects pile up at 140–200 km", "SATCAT: 71,323 objects, 35,808 already decayed · purple: model days left");
  await hold(5);

  await caption("");
  await card(`<h1>Speed decides. Drag decides how long.</h1><p>Ten linked views · real CelesTrak data · two-body, SGP4 and drag models</p><p class="m">github.com/aageer/speed-decision-2</p>`);
  await hold(3.5);
  console.log(`frames ${n}, errors ${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await browser.close();
})();
