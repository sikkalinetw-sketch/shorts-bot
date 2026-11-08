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
    let sampleCanvas = null;
    if (img) {
      earthTex = new THREE.Texture(img);
      earthTex.needsUpdate = true;
      sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 1024; sampleCanvas.height = 512;
      sampleCanvas.getContext('2d').drawImage(img, 0, 0, 1024, 512);
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
      sampleCanvas = c;
    }
    const texPix = sampleCanvas.getContext('2d').getImageData(0, 0, 1024, 512).data;
    const isLand = (lat, lon) => {
      if (Math.abs(lat) > 1.2) return false;
      let u = (Math.PI - lon) / (2 * Math.PI);
      u = u - Math.floor(u);
      const v = 0.5 + lat / Math.PI;
      const px = Math.min(1023, Math.floor(u * 1024));
      const py = Math.min(511, Math.max(0, Math.floor((1 - v) * 512)));
      const k = (py * 1024 + px) * 4;
      const r = texPix[k], g = texPix[k + 1], b = texPix[k + 2];
      return !(b > r * 1.25 && b > g * 0.95);
    };

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

    // low-poly models, merged into one geometry each
    const mergeParts = (parts) => {
      const pos = [], nor = [], col = [];
      parts.forEach(p => {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
        g.applyMatrix4(p.m);
        const c = new THREE.Color(p.c);
        const pa = g.attributes.position, na = g.attributes.normal;
        for (let i = 0; i < pa.count; i++) {
          pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
          nor.push(na.getX(i), na.getY(i), na.getZ(i));
          col.push(c.r, c.g, c.b);
        }
      });
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return out;
    };
    const Tm = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
    const Rx = (a, x, y, z) => new THREE.Matrix4().makeRotationX(a).setPosition(x, y, z);
    const Ry = (a, x, y, z) => new THREE.Matrix4().makeRotationY(a).setPosition(x, y, z);
    const cyl = (r, h, seg) => new THREE.CylinderGeometry(r, r, h, seg || 8);
    const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);

    const shirts = [0xe53935, 0xfdd835, 0x1e88e5, 0x43a047, 0xffffff, 0xff7043];
    const skins = [0xf1c27d, 0xc68642, 0x8d5524, 0xffdbac];
    const carCols = [0xe53935, 0xfdd835, 0x1e88e5, 0xffffff, 0x222222, 0xff7043];
    const wallCols = [0xf2d0a4, 0xd9e4ec, 0xf4a6a0, 0xb8d8c8, 0xe8e0c0];

    const personGeo = (i) => mergeParts([
      { geo: cyl(0.2, 0.55, 6), m: Tm(0, 0.28, 0), c: 0x333344 },
      { geo: cyl(0.26, 0.7, 6), m: Tm(0, 0.9, 0), c: shirts[i % shirts.length] },
      { geo: new THREE.SphereGeometry(0.22, 8, 6), m: Tm(0, 1.45, 0), c: skins[i % skins.length] }
    ]);
    const treeGeo = () => mergeParts([
      { geo: cyl(0.15, 1.0, 6), m: Tm(0, 0.5, 0), c: 0x6b4a2a },
      { geo: new THREE.ConeGeometry(0.85, 1.8, 7), m: Tm(0, 1.8, 0), c: 0x2e8b3d },
      { geo: new THREE.ConeGeometry(0.6, 1.3, 7), m: Tm(0, 2.6, 0), c: 0x3aa04a }
    ]);
    const carGeo = (i) => mergeParts([
      { geo: bx(2.2, 0.5, 1.0), m: Tm(0, 0.5, 0), c: carCols[i % carCols.length] },
      { geo: bx(1.1, 0.45, 0.9), m: Tm(-0.1, 0.97, 0), c: 0xbfe3ff },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, 0.7, 0.26, 0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, -0.7, 0.26, 0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, 0.7, 0.26, -0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, -0.7, 0.26, -0.5), c: 0x111111 }
    ]);
    const houseGeo = (i) => mergeParts([
      { geo: bx(2, 1.3, 2), m: Tm(0, 0.65, 0), c: wallCols[i % wallCols.length] },
      { geo: new THREE.ConeGeometry(1.7, 1.0, 4), m: Ry(Math.PI / 4, 0, 1.8, 0), c: 0xb5483a },
      { geo: bx(0.4, 0.7, 0.06), m: Tm(0, 0.35, 1.02), c: 0x5a3a22 }
    ]);

    const things = [];
    const up = new THREE.Vector3(0, 1, 0);
    const launchStage = (lat) => {
      const tcrit = 2 * Math.PI * Math.sqrt(R_M * Math.cos(lat) / G);
      for (let s = 0; s < DAYS.length; s++) if (DAYS[s] <= tcrit) return s;
      return -1;
    };
    let crashStage = -1;
    for (let s = 0; s < DAYS.length; s++) { if (DAYS[s] <= 10200) { crashStage = s; break; } }

    const kinds = ['person', 'person', 'person', 'tree', 'tree', 'tree', 'house', 'house', 'car'];
    const kScale = { person: 0.07, tree: 0.085, house: 0.085, car: 0.07 };
    let made = 0, tries = 0;
    while (made < 900 && tries < 20000) {
      tries++;
      const lat = Math.asin(rnd() * 2 - 1);
      const lon = rnd() * Math.PI * 2;
      if (!isLand(lat, lon)) continue;
      const kind = kinds[made % kinds.length];
      const geo = kind === 'person' ? personGeo(made) : kind === 'tree' ? treeGeo() : kind === 'car' ? carGeo(made) : houseGeo(made);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.scale.setScalar(kScale[kind] * (0.85 + rnd() * 0.3));
      scene.add(m);
      const ls = launchStage(lat);
      const launchT = ls < 0 ? 1e9 : ls * STAGE + 0.6 + rnd() * 2.2;
      const crashT = crashStage < 0 ? 1e9 : crashStage * STAGE + 0.4 + rnd() * 2.0 + (Math.abs(lat) / (Math.PI / 2)) * 2.5;
      things.push({
        m, kind, lat, lon, launchT, crashT, yaw: rnd() * Math.PI * 2, tiltDir: rnd() * Math.PI * 2,
        tiltMax: kind === 'car' ? 2.6 : kind === 'house' ? 0.5 : 1.35, base: kScale[kind],
        spinAxis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spinSpeed: 2 + rnd() * 5,
        launched: false, p0: null, v: null, qL: new THREE.Quaternion()
      });
      made++;
    }
    // in the last stage, big chunks of the planet break away from the equator
    const lastStart = (DAYS.length - 1) * STAGE;
    for (let i = 0; i < 260; i++) {
      const lat = (rnd() - 0.5) * 0.9;
      const lon = rnd() * Math.PI * 2;
      const col = rnd() < 0.5 ? 0x8a6a3c : (rnd() < 0.5 ? 0x3c8f48 : 0x2a6fb8);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: col, flatShading: true }));
      const sc = 0.12 + rnd() * 0.22;
      m.scale.set(sc, sc * (0.6 + rnd() * 0.6), sc * (0.7 + rnd() * 0.5));
      scene.add(m);
      things.push({
        m, kind: 'chunk', lat, lon, launchT: lastStart + 0.3 + rnd() * 1.8, crashT: 1e9, yaw: 0, tiltDir: 0, tiltMax: 0, base: sc,
        spinAxis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spinSpeed: 1.5 + rnd() * 4,
        launched: false, p0: null, v: null, qL: new THREE.Quaternion()
      });
    }
    const qA = new THREE.Quaternion(), qY = new THREE.Quaternion(), qT = new THREE.Quaternion(), qS = new THREE.Quaternion();
    const nV = new THREE.Vector3(), axV = new THREE.Vector3();
    const stateQuat = (o, th, sh, t, out) => {
      const nl = [Math.cos(o.lat) * Math.cos(o.lon), Math.sin(o.lat), Math.cos(o.lat) * Math.sin(o.lon)];
      const nw = tiltV(spinV(nl, th));
      nV.set(nw[0], nw[1], nw[2]).normalize();
      qA.setFromUnitVectors(up, nV);
      qY.setFromAxisAngle(up, o.yaw);
      out.copy(qA).multiply(qY);
      if (o.kind !== 'chunk') {
        const c = smooth(Math.min(1, Math.max(0, (t - o.crashT) / 0.9)));
        if (c > 0) {
          axV.set(Math.cos(o.tiltDir), 0, Math.sin(o.tiltDir));
          qT.setFromAxisAngle(axV, o.tiltMax * c);
          out.multiply(qT);
        }
        return c;
      }
      return 0;
    };

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
        : T <= 10200 ? 'Cars, trees and houses crash.'
        : T < 86400 ? 'Everything stays on the ground.' : 'A normal day.';
      const pop = 1 + 0.22 * Math.max(0, 1 - local / 0.3);
      bigwrap.style.transform = 'scale(' + pop.toFixed(3) + ')';

      things.forEach(o => {
        const tmpQ = new THREE.Quaternion();
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
          o.v = tiltV([vt[0] + nrm[0] * 1.6, vt[1] + nrm[1] * 1.6, vt[2] + nrm[2] * 1.6]);
          o.p0 = toWorld(sp);
          stateQuat(o, thl, shl, tl, o.qL);
          o.launched = true;
        }
        if (o.launched) {
          const dt = Math.max(0, t - o.launchT);
          o.m.position.set(o.p0[0] + o.v[0] * dt, o.p0[1] + o.v[1] * dt, o.p0[2] + o.v[2] * dt);
          qS.setFromAxisAngle(o.spinAxis, dt * o.spinSpeed);
          o.m.quaternion.copy(qS).multiply(o.qL);
        } else {
          const p = toWorld(spinV(surface(o.lat, o.lon, sh.f, sh.b), th));
          o.m.position.set(p[0], p[1], p[2]);
          stateQuat(o, th, sh, t, tmpQ);
          o.m.quaternion.copy(tmpQ);
          if (o.kind === 'house') {
            const c = smooth(Math.min(1, Math.max(0, (t - o.crashT) / 0.9)));
            o.m.scale.y = o.m.scale.x * (1 - 0.55 * c);
          }
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
