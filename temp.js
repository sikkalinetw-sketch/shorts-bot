// Temperature: one street, the heat keeps rising until everything is gone.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const W = 540, H = 960, FPS = 30;
const STAGE_SECONDS = 7;
const TEMPS = (process.env.TEMPS || '50,100,300,1000,3000,5500')
  .split(',').map(s => parseFloat(s.trim())).filter(n => n > 0);
const TOTAL_SECONDS = TEMPS.length * STAGE_SECONDS;
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
    <div id="flash" style="position:absolute;left:0;top:0;right:0;bottom:0;background:#fff;opacity:0"></div>
    <div id="bigwrap" style="position:absolute;left:0;right:0;top:120px;text-align:center;color:#fff;font-family:'Arial Black',Arial,sans-serif;font-weight:900;text-shadow:0 4px 10px #000,0 0 4px #000,0 0 4px #000;transform-origin:50% 50%;white-space:nowrap">
      <span id="num" style="font-size:104px;line-height:110px"></span><span style="font-size:60px"> &deg;C</span>
    </div>
  </body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, 'node_modules/three/build/three.min.js') });

  const info = await page.evaluate(({ W, H, TEMPS, STAGE, TOTAL }) => {
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fd3f5);
    scene.fog = new THREE.Fog(0x9fd3f5, 45, 150);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x887766, 0.6));
    const sun = new THREE.DirectionalLight(0xfff4d6, 0.6);
    sun.position.set(20, 40, 25);
    scene.add(sun);

    let seed = 31;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    const lerp = (a, b, t) => a + (b - a) * t;
    const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

    // colour ramps by temperature (interpolated in log space)
    const ramp = (keys, T) => {
      if (T <= keys[0][0]) return keys[0][1];
      for (let i = 0; i < keys.length - 1; i++) {
        if (T <= keys[i + 1][0]) {
          const u = (Math.log(T) - Math.log(keys[i][0])) / (Math.log(keys[i + 1][0]) - Math.log(keys[i][0]));
          return lerp3(keys[i][1], keys[i + 1][1], u);
        }
      }
      return keys[keys.length - 1][1];
    };
    const GROUND = [[20, [0.30, 0.62, 0.25]], [50, [0.48, 0.62, 0.24]], [100, [0.62, 0.55, 0.28]], [300, [0.38, 0.28, 0.18]],
      [600, [0.16, 0.11, 0.08]], [1000, [0.28, 0.08, 0.04]], [1500, [0.75, 0.18, 0.03]], [3000, [1.0, 0.42, 0.08]], [5500, [1.0, 0.95, 0.75]]];
    const SKY = [[20, [0.62, 0.82, 0.96]], [50, [0.80, 0.88, 0.94]], [100, [0.90, 0.85, 0.72]], [300, [0.85, 0.62, 0.40]],
      [1000, [0.45, 0.20, 0.12]], [3000, [1.0, 0.55, 0.22]], [5500, [1.0, 0.90, 0.70]]];

    // temperature over time: rises smoothly (log space), never stops, never drops
    const keys = [[0, 20]];
    TEMPS.forEach((T, k) => keys.push([k * STAGE + 3.0, T]));
    const tempAt = (t) => {
      const last = keys[keys.length - 1];
      if (t >= last[0]) return last[1];
      for (let k = 0; k < keys.length - 1; k++) {
        if (t < keys[k + 1][0]) {
          const a = keys[k], b = keys[k + 1];
          const u = (t - a[0]) / (b[0] - a[0]);
          return Math.exp(lerp(Math.log(a[1]), Math.log(b[1]), u));
        }
      }
      return last[1];
    };

    // ground (unlit, vertex colours with static noise)
    const gg = new THREE.PlaneGeometry(400, 400, 64, 64);
    gg.rotateX(-Math.PI / 2);
    const gcount = gg.attributes.position.count;
    const gnoise = new Float32Array(gcount);
    for (let i = 0; i < gcount; i++) gnoise[i] = 0.85 + rnd() * 0.3;
    const gcol = new Float32Array(gcount * 3);
    gg.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
    const ground = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ vertexColors: true }));
    scene.add(ground);

    // road
    const roadMat = new THREE.MeshBasicMaterial({ color: 0x3a3a3e });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 5), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.03, 5);
    scene.add(road);

    // lake + mud
    const LAKE = { x: -5, z: -4, r: 3.8 };
    const mud = new THREE.Mesh(new THREE.CylinderGeometry(LAKE.r + 0.3, LAKE.r + 0.3, 0.1, 24), new THREE.MeshBasicMaterial({ color: 0x6b4f35 }));
    mud.position.set(LAKE.x, 0.05, LAKE.z);
    scene.add(mud);
    const lakeMat = new THREE.MeshLambertMaterial({ color: 0x2a8fc0 });
    const lake = new THREE.Mesh(new THREE.CylinderGeometry(LAKE.r, LAKE.r, 0.2, 24), lakeMat);
    lake.position.set(LAKE.x, 0.12, LAKE.z);
    scene.add(lake);

    // sun
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff2a0, fog: false }));
    sunMesh.position.set(-35, 38, -70);
    scene.add(sunMesh);

    // ---- low-poly models (metres) ----
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
    const cyl = (r, h, seg) => new THREE.CylinderGeometry(r, r, h, seg || 8);

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
    const carCols = [0xe53935, 0x1e88e5];
    const carG = (i) => mergeParts([
      { geo: new THREE.CylinderGeometry(0.55, 0.6, 2.2, 10), m: new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, 0.5, 0), c: carCols[i % 2] },
      { geo: new THREE.CylinderGeometry(0.45, 0.6, 0.45, 8), m: Tm(-0.1, 1.0, 0), c: 0xbfe3ff },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, 0.7, 0.26, 0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, -0.7, 0.26, 0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, 0.7, 0.26, -0.5), c: 0x111111 },
      { geo: cyl(0.26, 0.2, 8), m: Rx(Math.PI / 2, -0.7, 0.26, -0.5), c: 0x111111 }
    ]);
    const houseG = (i) => mergeParts([
      { geo: new THREE.CylinderGeometry(1.35, 1.45, 1.3, 8), m: Tm(0, 0.65, 0), c: [0xf2d0a4, 0xd9e4ec, 0xf4a6a0][i % 3] },
      { geo: new THREE.ConeGeometry(1.7, 1.1, 8), m: Tm(0, 1.85, 0), c: 0xb5483a },
      { geo: new THREE.CylinderGeometry(0.12, 0.12, 0.7, 6), m: Tm(0.7, 2.1, 0.3), c: 0x7a4a3a }
    ]);

    // objects: kind, geometry, position, scale, model height, flame spread
    const objs = [];
    const addObj = (kind, geo, x, z, s, h, yaw) => {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = yaw || 0;
      mesh.scale.setScalar(s);
      scene.add(mesh);
      objs.push({ kind, mesh, mat, x, z, s, h: h * s, rad: kind === 'house' ? 1.4 * s : kind === 'tree' ? 0.7 * s : kind === 'car' ? 1.0 * s : 0.25 * s });
    };
    addObj('house', houseG(0), 4.5, -3.5, 3.2, 2.5);
    addObj('house', houseG(1), -1, -8, 3.0, 2.5);
    addObj('house', houseG(2), 7.5, 0.5, 2.8, 2.5);
    [[-8, 1.5, 3.4], [-3.2, 0.5, 3.0], [1.2, -5.8, 3.3], [7.8, -6, 3.2], [3, -1, 2.8], [-8.5, -8, 3.0]].forEach(p => addObj('tree', treeG, p[0], p[1], p[2], 3.2));
    addObj('car', carG(0), -3, 5, 2.3, 1.3, 0);
    addObj('car', carG(1), 3.5, 5.4, 2.3, 1.3, Math.PI);
    [[0, 2.5], [1.4, 3.0], [-1.4, 3.3]].forEach(p => addObj('person', personG, p[0], p[1], 1.25, 1.7));

    // flames (cones), smoke and steam (soft spheres), bubbles
    const flames = [];
    objs.forEach((o, oi) => {
      for (let k = 0; k < 3; k++) {
        const a = rnd() * Math.PI * 2, rr = rnd() * o.rad * 0.7;
        const outer = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.7, 6), new THREE.MeshBasicMaterial({ color: 0xff6a00 }));
        const inner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.1, 6), new THREE.MeshBasicMaterial({ color: 0xffd54a }));
        outer.visible = false; inner.visible = false;
        scene.add(outer); scene.add(inner);
        flames.push({ outer, inner, oi, dx: Math.cos(a) * rr, dz: Math.sin(a) * rr, hf: 0.55 + rnd() * 0.45, ph: rnd() * 6.28, sp: 9 + rnd() * 6 });
      }
    });
    const smoke = [];
    objs.forEach((o, oi) => {
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0, depthWrite: false }));
        m.visible = false;
        scene.add(m);
        smoke.push({ m, oi, ph: rnd(), dr: rnd() * 6.28 });
      }
    });
    const steam = [];
    for (let k = 0; k < 28; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * LAKE.r * 0.9;
      steam.push({ m, x: LAKE.x + Math.cos(a) * rr, z: LAKE.z + Math.sin(a) * rr, ph: rnd(), dr: rnd() * 6.28 });
    }
    const bubbles = [];
    for (let k = 0; k < 22; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false;
      scene.add(m);
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * LAKE.r * 0.85;
      bubbles.push({ m, x: Math.cos(a) * rr, z: Math.sin(a) * rr, ph: rnd() * 6.28 });
    }

    const camera = new THREE.PerspectiveCamera(60, W / H, 0.3, 400);
    const bigwrap = document.getElementById('bigwrap');
    const numEl = document.getElementById('num');
    const flash = document.getElementById('flash');
    const c3 = new THREE.Color();

    window.setFrame = (t) => {
      const T = tempAt(t);
      let s = 0;
      for (let k = 0; k < TEMPS.length; k++) { if (T >= TEMPS[k] * 0.985) s = k; }
      const local = t - keys[s + 1][0];
      numEl.textContent = TEMPS[s].toLocaleString('en-US');
      bigwrap.style.transform = 'scale(' + (1 + 0.2 * Math.max(0, 1 - Math.abs(local) / 0.3) * (local >= 0 ? 1 : 0)).toFixed(3) + ')';
      flash.style.opacity = (0.55 * smooth((T - 4600) / 900)).toFixed(3);

      // sky, ground, road
      const sk = ramp(SKY, T);
      scene.background.setRGB(sk[0], sk[1], sk[2]);
      scene.fog.color.setRGB(sk[0], sk[1], sk[2]);
      const gc = ramp(GROUND, T);
      const ca = gg.attributes.color.array;
      for (let i = 0; i < gcount; i++) { ca[i * 3] = Math.min(1, gc[0] * gnoise[i]); ca[i * 3 + 1] = Math.min(1, gc[1] * gnoise[i]); ca[i * 3 + 2] = Math.min(1, gc[2] * gnoise[i]); }
      gg.attributes.color.needsUpdate = true;
      const rg = lerp3([0.23, 0.23, 0.25], gc, smooth((T - 200) / 600));
      roadMat.color.setRGB(rg[0], rg[1], rg[2]);
      const mg = lerp3([0.42, 0.31, 0.21], gc, smooth((T - 500) / 400));
      mud.material.color.setRGB(mg[0], mg[1], mg[2]);
      sunMesh.scale.setScalar(1 + 1.6 * smooth((Math.log(T) - Math.log(20)) / (Math.log(5500) - Math.log(20))));

      // lake: boils at 100, gone by ~300
      const lakeS = 1 - smooth((T - 110) / 190);
      lake.visible = lakeS > 0.02;
      lake.scale.set(Math.max(0.01, lakeS), 1, Math.max(0.01, lakeS));
      const lc = lerp3([0.16, 0.56, 0.75], [0.6, 0.82, 0.92], smooth((T - 90) / 30));
      lakeMat.color.setRGB(lc[0], lc[1], lc[2]);
      const boil = smooth((T - 98) / 6) * (1 - smooth((T - 250) / 60));
      bubbles.forEach(b => {
        b.m.visible = boil > 0.05;
        const y = 0.2 + Math.abs(Math.sin(t * 9 + b.ph)) * 0.55;
        b.m.position.set(LAKE.x + b.x * lakeS, y, LAKE.z + b.z * lakeS);
        b.m.scale.setScalar(0.5 + 0.5 * Math.abs(Math.sin(t * 9 + b.ph)));
      });
      const steamAmt = smooth((T - 96) / 14) * (1 - smooth((T - 280) / 120));
      steam.forEach(p => {
        const u = (t * 0.35 + p.ph) % 1;
        p.m.visible = steamAmt > 0.02;
        p.m.position.set(p.x + Math.sin(p.dr + u * 3) * u * 1.5, 0.5 + u * 9, p.z + Math.cos(p.dr + u * 3) * u * 1.5);
        p.m.scale.setScalar(1 + u * 3);
        p.m.material.opacity = steamAmt * 0.45 * (1 - u);
      });

      // objects
      const state = objs.map(o => {
        let scy = 1, scxz = 1, glow = 0, burn = 0, charv = 0, tint = [1, 1, 1];
        if (o.kind === 'tree') {
          const dry = smooth((T - 30) / 60);
          tint = lerp3([1, 1, 1], [1.45, 1.15, 0.45], dry);
          charv = smooth((T - 300) / 120);
          const cons = smooth((T - 650) / 350), gone = smooth((T - 1300) / 300);
          scy = (1 - 0.85 * cons) * (1 - gone); scxz = scy;
          glow = smooth((T - 600) / 500) * (1 - gone) * 0.6;
          burn = smooth((T - 300) / 25) * (1 - smooth((T - 900) / 500));
        } else if (o.kind === 'house' || o.kind === 'car') {
          charv = smooth((T - 300) / 150);
          const melt = smooth((T - 900) / 700), puddle = smooth((T - 2000) / 1200), vap = smooth((T - 4300) / 900);
          scy = (1 - 0.55 * melt) * (1 - 0.8 * puddle) * (1 - vap);
          scxz = (1 + 0.3 * puddle) * (1 - vap);
          glow = smooth((T - 700) / 900);
          burn = smooth((T - 300) / 25) * (1 - smooth((T - 1700) / 500));
        } else {
          const poof = smooth((T - 290) / 40);
          scy = 1 - poof; scxz = scy;
          burn = smooth((T - 290) / 10) * (1 - smooth((T - 335) / 20));
        }
        const k = 1 - 0.9 * charv;
        o.mat.color.setRGB(tint[0] * k, tint[1] * k, tint[2] * k);
        const e = lerp3([1.0, 0.35, 0.05], [1.0, 0.75, 0.35], smooth((T - 2000) / 2500));
        o.mat.emissive.setRGB(e[0] * glow, e[1] * glow, e[2] * glow);
        o.mesh.scale.set(o.s * scxz, o.s * Math.max(0.001, scy), o.s * scxz);
        o.mesh.visible = scy > 0.01 && scxz > 0.01;
        return { scy, burn };
      });
      flames.forEach(f => {
        const o = objs[f.oi], st = state[f.oi];
        const on = st.burn > 0.05;
        f.outer.visible = on; f.inner.visible = on;
        if (!on) return;
        const fl = 0.7 + 0.5 * Math.sin(t * f.sp + f.ph);
        const size = Math.max(0.5, o.h * 0.22) * st.burn;
        const y = o.h * Math.max(0.2, st.scy) * f.hf;
        f.outer.position.set(o.x + f.dx, y, o.z + f.dz);
        f.inner.position.set(o.x + f.dx, y - 0.1, o.z + f.dz);
        f.outer.scale.set(size * 0.8, size * fl, size * 0.8);
        f.inner.scale.set(size * 0.7, size * fl * 0.9, size * 0.7);
      });
      smoke.forEach(p => {
        const o = objs[p.oi], st = state[p.oi];
        const amt = (o.kind === 'person') ? st.burn : smooth((T - 290) / 30) * (1 - smooth((T - 2600) / 600));
        const u = (t * 0.55 + p.ph) % 1;
        p.m.visible = amt > 0.03;
        p.m.position.set(o.x + Math.sin(p.dr + u * 2) * u * 2, o.h * Math.max(0.2, st.scy) + u * 11, o.z + Math.cos(p.dr + u * 2) * u * 2);
        p.m.scale.setScalar((0.6 + u * 3.2) * (o.kind === 'person' ? 0.6 : 1));
        p.m.material.opacity = amt * 0.55 * (1 - u);
      });

      // camera: slow orbit, street in front
      const a = -0.5 + (t / TOTAL) * 1.05;
      const D = 28;
      camera.position.set(Math.sin(a) * D, 9, Math.cos(a) * D);
      camera.lookAt(0, 3.5, -2);
      renderer.render(scene, camera);
    };
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }, { W, H, TEMPS, STAGE: STAGE_SECONDS, TOTAL: TOTAL_SECONDS });
  console.log('GL renderer:', info);
  console.log('Temps:', TEMPS.join(', '), '| frames:', N_FRAMES);

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

  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i frames/f%05d.jpg -vf scale=1080:1920:flags=lanczos -c:v libx264 -pix_fmt yuv420p -crf 20 videos/temperature.mp4`, { stdio: 'inherit' });
  console.log('made videos/temperature.mp4');
})();
