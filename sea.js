// Sea level rise: one video, the water keeps rising over a coastal city.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const W = 540, H = 960, FPS = 30;
const STAGE_SECONDS = 6;
const RISE_SECONDS = 3;
const LEVELS = (process.env.LEVELS || '1,10,30,66,200,500,1000')
  .split(',').map(s => parseFloat(s.trim())).filter(n => n > 0);
const TOTAL_SECONDS = LEVELS.length * STAGE_SECONDS;
const N_FRAMES = Math.round(TOTAL_SECONDS * FPS);

(async () => {
  fs.mkdirSync('frames', { recursive: true });
  fs.mkdirSync('videos', { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<html><body style="margin:0;position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000">
    <canvas id="c" width="${W}" height="${H}" style="position:absolute;left:0;top:0"></canvas>
    <div id="bigwrap" style="position:absolute;left:0;right:0;top:100px;text-align:center;color:#fff;font-family:'Arial Black',Arial,sans-serif;font-weight:900;text-shadow:0 4px 10px #000,0 0 3px #000;transform-origin:50% 50%;white-space:nowrap">
      <div style="font-size:24px;line-height:28px;letter-spacing:5px">SEA LEVEL RISE</div>
      <div><span id="num" style="font-size:96px;line-height:104px"></span><span style="font-size:56px"> m</span></div>
    </div>
  </body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, 'node_modules/three/build/three.min.js') });

  const info = await page.evaluate(({ W, H, LEVELS, STAGE, RISE, TOTAL }) => {
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfe0f5);
    scene.fog = new THREE.Fog(0xbfe0f5, 200, 6000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9070, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4d6, 0.55);
    sun.position.set(300, 600, 200);
    scene.add(sun);

    let seed = 77;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const smooth = (x) => x * x * (3 - 2 * x);
    const lerp = (a, b, t) => a + (b - a) * t;
    const up = new THREE.Vector3(0, 1, 0);

    // ground height (metres). The sea is at z > 0, the city is on the plain, hills rise inland (z < 0).
    const elev = (x, z) => {
      if (z > 0) return Math.max(-90, -z * 0.05 - 0.2);
      const d = -z;
      let e = 0.6 + Math.min(d, 800) * 0.0045;
      if (d > 800) {
        const m = 0.62 + 0.28 * Math.sin(x * 0.0009 + 1.3) * Math.cos(x * 0.0017) + 0.1 * Math.sin(x * 0.004 + z * 0.002);
        const ridge = 0.5 + 0.5 * Math.sin(d * 0.0011 + x * 0.0006);
        e += (d - 800) * 0.15 * (m * (0.75 + 0.25 * ridge));
      }
      return e;
    };

    // terrain
    const tg = new THREE.PlaneGeometry(12000, 14000, 160, 280);
    const tp = tg.attributes.position;
    const tcol = new Float32Array(tp.count * 3);
    const cA = new THREE.Color(), cB = new THREE.Color();
    const stops = [
      [-1, 0xb8a878], [1.2, 0xe0cf94], [3, 0x9aa57a], [60, 0x5e9a4e], [250, 0x6f8f46],
      [600, 0x8a7a52], [900, 0x8d8a80], [1200, 0xe8eef2]
    ];
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), y0 = tp.getY(i);
      const z = -y0 - 5000;
      const e = elev(x, z);
      tp.setXYZ(i, x, e, z);
      let k = 0;
      while (k < stops.length - 2 && e > stops[k + 1][0]) k++;
      const t = Math.min(1, Math.max(0, (e - stops[k][0]) / (stops[k + 1][0] - stops[k][0])));
      cA.setHex(stops[k][1]); cB.setHex(stops[k + 1][1]);
      cA.lerp(cB, t);
      const n = 1 + (rnd() - 0.5) * 0.12;
      tcol[i * 3] = cA.r * n; tcol[i * 3 + 1] = cA.g * n; tcol[i * 3 + 2] = cA.b * n;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
    tg.computeVertexNormals();
    scene.add(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

    // seabed far away + water
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), new THREE.MeshLambertMaterial({ color: 0xb8a878 }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -95;
    scene.add(bed);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000),
      new THREE.MeshLambertMaterial({ color: 0x1a8fb5, transparent: true, opacity: 0.78, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    scene.add(water);

    // ---- low-poly models (metres) merged into one geometry each ----
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
    const Sc = (sx, sy, sz, x, y, z) => new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);
    const cyl = (r, h, seg) => new THREE.CylinderGeometry(r, r, h, seg || 8);
    const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);

    const personG = mergeParts([
      { geo: cyl(0.2, 0.55, 6), m: Tm(0, 0.28, 0), c: 0x333344 },
      { geo: cyl(0.26, 0.7, 6), m: Tm(0, 0.9, 0), c: 0xe53935 },
      { geo: new THREE.SphereGeometry(0.22, 8, 6), m: Tm(0, 1.45, 0), c: 0xf1c27d }
    ]);
    const treeG = mergeParts([
      { geo: cyl(0.15, 1.0, 6), m: Tm(0, 0.5, 0), c: 0x6b4a2a },
      { geo: new THREE.ConeGeometry(0.85, 1.8, 7), m: Tm(0, 1.8, 0), c: 0x2e8b3d },
      { geo: new THREE.ConeGeometry(0.6, 1.3, 7), m: Tm(0, 2.6, 0), c: 0x3aa04a }
    ]);
    const palmParts = [{ geo: new THREE.CylinderGeometry(0.12, 0.22, 6, 6), m: Tm(0, 3, 0), c: 0x8b6b3d }];
    for (let k = 0; k < 6; k++) {
      const leaf = new THREE.ConeGeometry(0.2, 2.6, 4);
      leaf.translate(0, 1.3, 0);
      const m = Tm(0, 6, 0).multiply(new THREE.Matrix4().makeRotationY(k * Math.PI / 3)).multiply(new THREE.Matrix4().makeRotationX(1.25));
      palmParts.push({ geo: leaf, m, c: 0x2e9b4a });
    }
    const palmG = mergeParts(palmParts);
    const carG = mergeParts([
      { geo: bx(2.2, 0.5, 1.0), m: Tm(0, 0.5, 0), c: 0xe53935 },
      { geo: new THREE.CylinderGeometry(0.45, 0.6, 0.45, 8), m: Rx(0, -0.1, 0.97, 0), c: 0xbfe3ff },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, 0.7, 0.26, 0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, -0.7, 0.26, 0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, 0.7, 0.26, -0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, -0.7, 0.26, -0.5), c: 0x111111 }
    ]);
    const houseG = mergeParts([
      { geo: new THREE.CylinderGeometry(1.35, 1.45, 1.3, 8), m: Tm(0, 0.65, 0), c: 0xf2d0a4 },
      { geo: new THREE.ConeGeometry(1.7, 1.1, 8), m: Tm(0, 1.85, 0), c: 0xb5483a },
      { geo: new THREE.CylinderGeometry(0.12, 0.12, 0.7, 6), m: Tm(0.7, 2.1, 0.3), c: 0x7a4a3a }
    ]);
    const towerA = mergeParts([
      { geo: new THREE.CylinderGeometry(0.55, 0.9, 8, 7), m: Tm(0, 4, 0), c: 0x7fa9c4 },
      { geo: new THREE.CylinderGeometry(0.35, 0.55, 1.4, 7), m: Tm(0, 8.7, 0), c: 0xcfd8dc },
      { geo: new THREE.ConeGeometry(0.12, 1.8, 6), m: Tm(0, 10.3, 0), c: 0xe53935 }
    ]);
    const towerB = mergeParts([
      { geo: new THREE.CylinderGeometry(0.9, 0.95, 3, 8), m: Tm(0, 1.5, 0), c: 0xb7c4cf },
      { geo: new THREE.CylinderGeometry(0.7, 0.8, 3, 8), m: Tm(0, 4.5, 0), c: 0x9fb4c4 },
      { geo: new THREE.CylinderGeometry(0.5, 0.6, 3, 8), m: Tm(0, 7.5, 0), c: 0x88a4b8 },
      { geo: new THREE.ConeGeometry(0.5, 2.2, 8), m: Tm(0, 10.1, 0), c: 0x607d8b }
    ]);
    const towerC = mergeParts([
      { geo: new THREE.CylinderGeometry(0.8, 0.8, 7, 10), m: Tm(0, 3.5, 0), c: 0xd7ccc8 },
      { geo: new THREE.SphereGeometry(0.85, 10, 8), m: Sc(1, 0.8, 1, 0, 7.2, 0), c: 0x80cbc4 },
      { geo: new THREE.ConeGeometry(0.1, 2, 6), m: Tm(0, 9.2, 0), c: 0xffd54a }
    ]);

    const groups = [];
    const addGroup = (geo, kind, count, make) => {
      const items = [];
      let tries = 0;
      while (items.length < count && tries < count * 40) {
        tries++;
        const it = make();
        if (!it) continue;
        it.gy = elev(it.x, it.z);
        if (it.gy < 0.8) continue;
        it.kind = kind;
        it.yaw = rnd() * Math.PI * 2;
        it.sign = rnd() < 0.5 ? -1 : 1;
        const v = 0.88 + rnd() * 0.12;
        it.col = new THREE.Color(v, v, v);
        items.push(it);
      }
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), items.length);
      mesh.frustumCulled = false;
      items.forEach((it, i) => mesh.setColorAt(i, it.col));
      scene.add(mesh);
      groups.push({ mesh, items });
    };
    const rr = (a, b) => a + rnd() * (b - a);
    addGroup(houseG, 'house', 800, () => { const s = rr(2.6, 4.2); return { x: rr(-1700, 1700), z: -rr(60, 1500), s, h: 2.2 * s }; });
    [towerA, towerB, towerC].forEach(g => addGroup(g, 'tower', 38, () => { const h = rr(50, 320); const s = h / 11; return { x: rr(-850, 850), z: -rr(150, 1000), s, h }; }));
    addGroup(treeG, 'tree', 1000, () => { const s = rr(2.2, 3.6); return { x: rr(-3500, 3500), z: -rr(40, 5000), s, h: 3.2 * s }; });
    addGroup(palmG, 'tree', 70, () => { const s = rr(1.2, 1.7); return { x: rr(-900, 900), z: -rr(8, 70), s, h: 8 * s }; });
    addGroup(carG, 'car', 280, () => ({ x: rr(-950, 950), z: -rr(50, 1000), s: rr(1.8, 2.1), h: 1.4 * 2 }));
    addGroup(personG, 'person', 300, () => ({ x: rr(-350, 350), z: -rr(18, 500), s: rr(1.0, 1.15), h: 1.8 }));

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.5, 60000);
    const bigwrap = document.getElementById('bigwrap');
    const numEl = document.getElementById('num');
    const dummy = new THREE.Object3D();
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    const axX = new THREE.Vector3(1, 0, 0);
    const col = new THREE.Color();
    const wcol = new THREE.Color(0.15, 0.42, 0.55);

    const levelAt = (t) => {
      const s = Math.min(LEVELS.length - 1, Math.floor(t / STAGE));
      const local = t - s * STAGE;
      const prev = s === 0 ? 0 : LEVELS[s - 1];
      return lerp(prev, LEVELS[s], smooth(Math.min(1, local / RISE)));
    };

    window.setFrame = (t) => {
      const s = Math.min(LEVELS.length - 1, Math.floor(t / STAGE));
      const local = t - s * STAGE;
      const level = levelAt(t);
      water.position.y = level;
      numEl.textContent = '+' + LEVELS[s].toLocaleString('en-US');
      const pop = 1 + 0.2 * Math.max(0, 1 - local / 0.3);
      bigwrap.style.transform = 'scale(' + pop.toFixed(3) + ')';

      groups.forEach(g => {
        g.items.forEach((it, i) => {
          const depth = level - it.gy;
          let y = it.gy, tilt = 0, f = 0;
          if (depth > 0) {
            f = Math.min(1, depth / it.h);
            if (it.kind === 'car') {
              if (depth > 0.5) { const k = Math.min(1, (depth - 0.5) / 1.5); y += k * 1.6; tilt = k * 0.7 * it.sign + Math.sin(t * 2 + it.x) * 0.12 * k; }
            } else if (it.kind === 'person') {
              if (depth > 0.9) { const k = Math.min(1, (depth - 0.9) / 1.0); y += k * 0.9; tilt = k * 1.45 * it.sign; }
            } else if (it.kind === 'tower' || it.kind === 'house') {
              if (f > 0.5) tilt = (f - 0.5) * 0.5 * it.sign;
            } else if (it.kind === 'tree') {
              if (f > 0.4) tilt = (f - 0.4) * 0.9 * it.sign;
            }
          }
          dummy.position.set(it.x, y, it.z);
          qa.setFromAxisAngle(up, it.yaw);
          qb.setFromAxisAngle(axX, tilt);
          dummy.quaternion.copy(qa).multiply(qb);
          dummy.scale.setScalar(it.s);
          dummy.updateMatrix();
          g.mesh.setMatrixAt(i, dummy.matrix);
          col.copy(it.col).lerp(wcol, Math.min(1, f * 1.2));
          g.mesh.setColorAt(i, col);
        });
        g.mesh.instanceMatrix.needsUpdate = true;
        g.mesh.instanceColor.needsUpdate = true;
      });

      // camera starts at street level on the beach and rises as the water rises
      const p = Math.min(1, t / TOTAL);
      const camY = 8 * Math.pow(225, p);
      const camZ = 140 * Math.pow(2600 / 140, p);
      camera.position.set(Math.sin(t * 0.3) * camY * 0.15, camY, camZ);
      camera.lookAt(0, 4 * Math.pow(75, p), lerp(-60, -3500, p));
      camera.near = Math.max(0.5, camY * 0.02);
      camera.updateProjectionMatrix();
      scene.fog.near = 200 + camY * 3;
      scene.fog.far = 6000 + camY * 12;
      renderer.render(scene, camera);
    };
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }, { W, H, LEVELS, STAGE: STAGE_SECONDS, RISE: RISE_SECONDS, TOTAL: TOTAL_SECONDS });
  console.log('GL renderer:', info);
  console.log('Levels:', LEVELS.join(', '), '| frames:', N_FRAMES);

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

  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i frames/f%05d.jpg -vf scale=1080:1920:flags=lanczos -c:v libx264 -pix_fmt yuv420p -crf 20 videos/sea_level.mp4`, { stdio: 'inherit' });
  console.log('made videos/sea_level.mp4');
})();
