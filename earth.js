// Earth spin series: one video, the day gets shorter and shorter.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const W = 540, H = 960, FPS = 30;
const STAGE_SECONDS = 6;
const DAYS = (process.env.DAYS || '86400,50000,20000,10000,5000,1000,500')
  .split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
const TOTAL_SECONDS = DAYS.length * STAGE_SECONDS;
const N_FRAMES = Math.round(TOTAL_SECONDS * FPS);
const BASE_DEG_PER_SEC = 6; // how fast the Earth turns on screen when a day is 86,400 s

(async () => {
  fs.mkdirSync('frames', { recursive: true });
  fs.mkdirSync('videos', { recursive: true });

  let texData = null;
  if (fs.existsSync('earth.jpg') && fs.statSync('earth.jpg').size > 20000) {
    texData = 'data:image/jpeg;base64,' + fs.readFileSync('earth.jpg').toString('base64');
    console.log('Using earth.jpg texture');
  } else {
    console.log('No earth.jpg, using generated planet');
  }

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<html><body style="margin:0;position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000">
    <canvas id="c" width="${W}" height="${H}" style="position:absolute;left:0;top:0"></canvas>
    <div id="bigwrap" style="position:absolute;left:0;right:0;top:120px;text-align:center;color:#fff;font-family:'Arial Black',Arial,sans-serif;font-weight:900;text-shadow:0 4px 10px #000,0 0 3px #000;transform-origin:50% 50%;white-space:nowrap">
      <div id="num" style="font-size:92px;line-height:96px"></div>
      <div id="lbl" style="font-size:44px;line-height:48px;letter-spacing:2px">s/day</div>
    </div>
    <div id="l1" style="position:absolute;left:16px;right:16px;bottom:168px;text-align:center;color:#fff;font:700 24px Arial,sans-serif;text-shadow:0 3px 8px #000;white-space:nowrap"></div>
    <div id="l2" style="position:absolute;left:16px;right:16px;bottom:136px;text-align:center;color:#fff;font:700 24px Arial,sans-serif;text-shadow:0 3px 8px #000;white-space:nowrap"></div>
    <div id="l3" style="position:absolute;left:16px;right:16px;bottom:96px;text-align:center;color:#ffd54a;font:800 27px Arial,sans-serif;text-shadow:0 3px 8px #000;white-space:nowrap"></div>
  </body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, 'node_modules/three/build/three.min.js') });

  const info = await page.evaluate(async ({ W, H, DAYS, STAGE, BASE, texData }) => {
    const R = 4;
    const G = 9.8, R_M = 6378000, R_KM = 6378;
    const TILT = 23.4 * Math.PI / 180;
    const OFFY = -1.0;

    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000005);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xffffff, 0.95);
    sun.position.set(10, 4, 12);
    scene.add(sun);

    let seed = 5;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    // stars
    const starPos = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      starPos[i * 3] = Math.cos(a) * s * 300;
      starPos[i * 3 + 1] = u * 300;
      starPos[i * 3 + 2] = Math.sin(a) * s * 300;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false })));

    // texture: real image if available, otherwise a generated planet
    const loadImg = () => new Promise(res => {
      if (!texData) return res(null);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = texData;
    });
    let earthTex;
    const img = await loadImg();
    if (img) {
      earthTex = new THREE.Texture(img);
      earthTex.needsUpdate = true;
    } else {
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 512;
      const g = c.getContext('2d');
      const id = g.createImageData(1024, 512);
      const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
      const vnoise = (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const a = hash(xi, yi), b = hash(xi + 1, yi), c2 = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
        return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v;
      };
      const fbm = (x, y) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < 5; o++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; } return s; };
      for (let py = 0; py < 512; py++) {
        const lat = (0.5 - py / 512) * 180;
        for (let px = 0; px < 1024; px++) {
          const ang = (px / 1024) * Math.PI * 2;
          const n = fbm(Math.cos(ang) * 2.2 + 20, Math.sin(ang) * 2.2 + (py / 512) * 4 + 20);
          let r, gg, b;
          if (Math.abs(lat) > 76) { r = 240; gg = 245; b = 250; }
          else if (n > 0.52) { if (n > 0.64) { r = 140; gg = 118; b = 72; } else { r = 58; gg = 142; b = 72; } }
          else { r = 18; gg = 78 + n * 40; b = 150 + n * 40; }
          const k = (py * 1024 + px) * 4;
          id.data[k] = r; id.data[k + 1] = gg; id.data[k + 2] = b; id.data[k + 3] = 255;
        }
      }
      g.putImageData(id, 0, 0);
      earthTex = new THREE.CanvasTexture(c);
    }

    // Earth: tilt group > spin group > sphere
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = TILT;
    tiltGroup.position.set(0, OFFY, 0);
    scene.add(tiltGroup);
    const spinGroup = new THREE.Group();
    tiltGroup.add(spinGroup);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), new THREE.MeshLambertMaterial({ map: earthTex }));
    spinGroup.add(earth);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.16, side: THREE.BackSide }));
    tiltGroup.add(glow);

    // shape of the planet at each stage (exaggerated): flatter poles, wider equator
    const flatY = [1, 0.995, 0.98, 0.95, 0.9, 0.78, 0.6];
    const bulge = [1, 1, 1.005, 1.015, 1.04, 1.1, 1.2];
    const pick = (arr, s) => arr[Math.min(s, arr.length - 1)];
    const smooth = (x) => x * x * (3 - 2 * x);
    const lerp = (a, b, t) => a + (b - a) * t;

    // speed per stage in rad/s on screen
    const omega = DAYS.map(d => (BASE * Math.PI / 180) * (86400 / d));
    const thetaAt = (t) => {
      const s = Math.min(DAYS.length - 1, Math.floor(t / STAGE));
      let th = 0;
      for (let k = 0; k < s; k++) th += omega[k] * STAGE;
      return th + omega[s] * (t - s * STAGE);
    };
    const shapeAt = (t) => {
      const s = Math.min(DAYS.length - 1, Math.floor(t / STAGE));
      const k = smooth(Math.min(1, (t - s * STAGE) / 1.0));
      const ps = s === 0 ? 0 : s - 1;
      return { f: lerp(pick(flatY, ps), pick(flatY, s), k), b: lerp(pick(bulge, ps), pick(bulge, s), k), s };
    };

    // point on the (squashed) planet -> world position, plus helpers
    const surface = (lat, lon, f, b) => [R * Math.cos(lat) * Math.cos(lon) * b, R * Math.sin(lat) * f, R * Math.cos(lat) * Math.sin(lon) * b];
    const spinV = (p, th) => [p[0] * Math.cos(th) + p[2] * Math.sin(th), p[1], -p[0] * Math.sin(th) + p[2] * Math.cos(th)];
    const tiltV = (p) => [p[0] * Math.cos(TILT) - p[1] * Math.sin(TILT), p[0] * Math.sin(TILT) + p[1] * Math.cos(TILT), p[2]];
    const toWorld = (p) => { const q = tiltV(p); return [q[0], q[1] + OFFY, q[2]]; };

    // things on Earth: they lift off when the day is shorter than the critical value for their latitude
    const objColors = [0xff3b30, 0xffd60a, 0xffffff, 0x00e5ff, 0xff9500, 0xff2d92, 0x34c759];
    const things = [];
    const mkThing = (size, color, lat, lon, launchT, kind) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshLambertMaterial({ color }));
      scene.add(m);
      things.push({ m, lat, lon, launchT, kind, launched: false, p0: null, v: null });
    };
    const launchStage = (lat) => {
      const tcrit = 2 * Math.PI * Math.sqrt(R_M * Math.cos(lat) / G);
      for (let s = 0; s < DAYS.length; s++) if (DAYS[s] <= tcrit) return s;
      return -1;
    };
    for (let i = 0; i < 700; i++) {
      const u = rnd() * 2 - 1;
      const lat = Math.asin(u);
      const lon = rnd() * Math.PI * 2;
      const ls = launchStage(lat);
      const lt = ls < 0 ? 1e9 : ls * STAGE + 0.6 + rnd() * 2.2;
      mkThing(0.16 + rnd() * 0.14, objColors[i % objColors.length], lat, lon, lt, 'thing');
    }
    // in the last stage, big chunks of the planet break away from the equator
    const lastStart = (DAYS.length - 1) * STAGE;
    for (let i = 0; i < 260; i++) {
      const lat = (rnd() - 0.5) * 0.9;
      const lon = rnd() * Math.PI * 2;
      const col = rnd() < 0.5 ? 0x8a6a3c : (rnd() < 0.5 ? 0x3c8f48 : 0x2a6fb8);
      mkThing(0.35 + rnd() * 0.45, col, lat, lon, lastStart + 0.3 + rnd() * 1.8, 'chunk');
    }

    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
    camera.position.set(0, 0, 26);
    camera.lookAt(0, 0, 0);

    const numEl = document.getElementById('num');
    const bigwrap = document.getElementById('bigwrap');
    const l1 = document.getElementById('l1');
    const l2 = document.getElementById('l2');
    const l3 = document.getElementById('l3');
    const fmtSpeed = (v) => v < 1 ? v.toFixed(2) : (v < 10 ? v.toFixed(1) : String(Math.round(v)));
    const fmtDay = (d) => d >= 7200 ? (d / 3600).toFixed(d >= 72000 ? 0 : 1) + ' hours' : Math.round(d / 60) + ' minutes';

    window.setFrame = (t) => {
      const s = Math.min(DAYS.length - 1, Math.floor(t / STAGE));
      const local = t - s * STAGE;
      const T = DAYS[s];
      const th = thetaAt(t);
      const sh = shapeAt(t);

      spinGroup.rotation.y = th;
      earth.scale.set(sh.b, sh.f, sh.b);
      glow.scale.set(sh.b, sh.f, sh.b);

      numEl.textContent = T.toLocaleString('en-US');
      const vEq = 2 * Math.PI * R_KM / T;
      l1.textContent = 'Equator speed: ' + fmtSpeed(vEq) + ' km/s';
      l2.textContent = 'A day lasts ' + fmtDay(T);
      l3.textContent = T <= 600 ? 'Earth would not stay in one piece.'
        : T <= 2500 ? 'Almost everything leaves the ground.'
        : T <= 5100 ? 'Objects at the equator float away.'
        : T < 86400 ? 'Everything stays on the ground.' : 'A normal day.';
      const pop = 1 + 0.22 * Math.max(0, 1 - local / 0.3);
      bigwrap.style.transform = 'scale(' + pop.toFixed(3) + ')';

      const w = omega[s];
      things.forEach(o => {
        if (!o.launched && t >= o.launchT) {
          const tl = o.launchT;
          const shl = shapeAt(tl);
          const thl = thetaAt(tl);
          const sp = spinV(surface(o.lat, o.lon, shl.f, shl.b), thl);
          const sl = Math.min(DAYS.length - 1, Math.floor(tl / STAGE));
          const wl = omega[sl];
          let vt = [wl * sp[2], 0, -wl * sp[0]];
          const mag = Math.sqrt(vt[0] * vt[0] + vt[2] * vt[2]);
          const cap = 9;
          if (mag > cap) { vt = [vt[0] * cap / mag, 0, vt[2] * cap / mag]; }
          const len = Math.sqrt(sp[0] * sp[0] + sp[1] * sp[1] + sp[2] * sp[2]) || 1;
          const nrm = [sp[0] / len, sp[1] / len, sp[2] / len];
          const v = tiltV([vt[0] + nrm[0] * 1.6, vt[1] + nrm[1] * 1.6, vt[2] + nrm[2] * 1.6]);
          o.p0 = toWorld(sp);
          o.v = v;
          o.launched = true;
        }
        if (o.launched) {
          const dt = Math.max(0, t - o.launchT);
          o.m.position.set(o.p0[0] + o.v[0] * dt, o.p0[1] + o.v[1] * dt, o.p0[2] + o.v[2] * dt);
          o.m.rotation.set(dt * 2.1, dt * 3.3, 0);
        } else {
          const p = toWorld(spinV(surface(o.lat, o.lon, sh.f, sh.b), th));
          o.m.position.set(p[0], p[1], p[2]);
          o.m.rotation.set(0, 0, 0);
        }
      });
      renderer.render(scene, camera);
    };
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }, { W, H, DAYS, STAGE: STAGE_SECONDS, BASE: BASE_DEG_PER_SEC, texData });
  console.log('GL renderer:', info);
  console.log('Days:', DAYS.join(', '), '| frames:', N_FRAMES);

  const t0 = Date.now();
  for (let i = 0; i < N_FRAMES; i++) {
    await page.evaluate((t) => window.setFrame(t), i / FPS);
    await page.screenshot({ path: `frames/f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
    if (i % 60 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`frame ${i}/${N_FRAMES}  elapsed ${el.toFixed(0)}s  (${(el / (i + 1)).toFixed(2)}s/frame)`);
    }
  }
  console.log(`Rendered ${N_FRAMES} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await browser.close();

  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i frames/f%05d.jpg -vf scale=1080:1920:flags=lanczos -c:v libx264 -pix_fmt yuv420p -crf 20 videos/earth_speed.mp4`, { stdio: 'inherit' });
  console.log('made videos/earth_speed.mp4');
})();
