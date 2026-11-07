// One continuous video: the same beach, the crowd keeps growing.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const W = 540, H = 960, FPS = 30;
const STAGE_SECONDS = 6;
const GROW_SECONDS = 0.8;
const MAX_FIGURES = 15000;
const COUNTS = (process.env.COUNTS || '100,500,1000,2000,5000,10000,50000')
  .split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
const TOTAL_SECONDS = COUNTS.length * STAGE_SECONDS;
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
    <div id="bigwrap" style="position:absolute;left:0;right:0;top:130px;text-align:center;color:#fff;font-family:'Arial Black',Arial,sans-serif;font-weight:900;text-shadow:0 4px 10px #000,0 0 3px #000;transform-origin:50% 50%;white-space:nowrap">
      <div id="num" style="font-size:92px;line-height:96px"></div>
      <div id="lbl" style="font-size:40px;line-height:44px;letter-spacing:6px">PEOPLE</div>
    </div>
    <div id="sub" style="position:absolute;left:20px;right:20px;bottom:190px;text-align:center;color:#fff;font:800 28px Arial,sans-serif;text-shadow:0 3px 8px #000;white-space:nowrap"></div>
  </body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, 'node_modules/three/build/three.min.js') });

  const info = await page.evaluate(({ W, H, COUNTS, MAX_FIGURES, STAGE_SECONDS, GROW_SECONDS, TOTAL_SECONDS }) => {
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7ec8f0);
    scene.fog = new THREE.Fog(0xbfe3ff, 150, 520);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x998866, 0.95));
    const sun = new THREE.DirectionalLight(0xfff2cc, 0.8);
    sun.position.set(30, 80, 40);
    scene.add(sun);

    let seed = 23;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const box = (w, h, d, c, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
      m.position.set(x, y, z);
      return m;
    };

    const sand = new THREE.Mesh(new THREE.PlaneGeometry(700, 240), mat(0xe8d8a0));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0, 30);
    scene.add(sand);
    const seaGeo = new THREE.PlaneGeometry(900, 120, 60, 30);
    const sea = new THREE.Mesh(seaGeo, mat(0x1ca3c4));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.05, -150);
    scene.add(sea);

    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 16), new THREE.MeshBasicMaterial({ color: 0xfff6b0 }));
    sunDisc.position.set(90, 110, -380);
    scene.add(sunDisc);

    scene.add(box(6, 0.4, 80, 0xb08a5a, 0, 1.6, -130));
    for (let i = 0; i < 16; i++) {
      scene.add(box(0.5, 2, 0.5, 0x6b4f2a, -2.7, 0.8, -92 - i * 5));
      scene.add(box(0.5, 2, 0.5, 0x6b4f2a, 2.7, 0.8, -92 - i * 5));
    }

    const bcolors = [0xf2d0a4, 0xd9e4ec, 0xf4a6a0, 0xb8d8c8, 0xe8e0c0];
    for (let i = 0; i < 24; i++) {
      const h = 10 + rnd() * 30;
      const side = i % 2 === 0 ? -1 : 1;
      scene.add(box(10 + rnd() * 8, h, 10, bcolors[i % 5], side * (80 + rnd() * 30), h / 2, 60 - Math.floor(i / 2) * 14));
    }
    const palm = (x, z) => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 7, 6), mat(0x8b6b3d));
      trunk.position.y = 3.5;
      g.add(trunk);
      for (let k = 0; k < 6; k++) {
        const leaf = box(0.4, 0.12, 4, 0x2e8b3d, 0, 7.1, 0);
        leaf.geometry.translate(0, 0, 2);
        leaf.rotation.y = (k / 6) * Math.PI * 2;
        leaf.rotation.x = 0.35;
        g.add(leaf);
      }
      g.position.set(x, 0, z);
      scene.add(g);
    };
    for (let i = 0; i < 12; i++) palm((i % 2 ? 1 : -1) * (68 + rnd() * 8), 50 - i * 9);

    const figs = COUNTS.map(c => Math.min(c, MAX_FIGURES));
    const F = Math.max.apply(null, figs);
    const shirt = [0xe53935, 0xfdd835, 0x43a047, 0x1e88e5, 0x8e24aa, 0xff7043, 0xffffff, 0x00acc1];
    const skins = [0xf1c27d, 0xc68642, 0x8d5524, 0xffdbac];
    const parts = [
      { g: new THREE.BoxGeometry(0.55, 0.8, 0.32), o: [0, 1.15, 0], c: 'shirt' },
      { g: new THREE.BoxGeometry(0.36, 0.36, 0.36), o: [0, 1.77, 0], c: 'skin' },
      { g: new THREE.BoxGeometry(0.2, 0.75, 0.22), o: [-0.14, 0.38, 0], c: 'pants' },
      { g: new THREE.BoxGeometry(0.2, 0.75, 0.22), o: [0.14, 0.38, 0], c: 'pants' },
      { g: new THREE.BoxGeometry(0.14, 0.7, 0.16), o: [-0.37, 1.15, 0], c: 'skin' },
      { g: new THREE.BoxGeometry(0.14, 0.7, 0.16), o: [0.37, 1.15, 0], c: 'skin' }
    ];
    const meshes = parts.map(p => {
      const m = new THREE.InstancedMesh(p.g, new THREE.MeshLambertMaterial({ color: 0xffffff }), F);
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    const pm = new THREE.Matrix4(), om = new THREE.Matrix4(), q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (let i = 0; i < F; i++) {
      const depth = Math.min(60, Math.max(12, 10 + i * 0.03));
      const width = Math.min(120, 36 + i * 0.015);
      const px = (rnd() - 0.5) * width;
      const pz = 6 - rnd() * depth;
      q.setFromAxisAngle(up, Math.PI + (rnd() - 0.5) * 0.7);
      const s = 0.9 + rnd() * 0.25;
      pm.compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(s, s, s));
      const sh = shirt[Math.floor(rnd() * shirt.length)];
      const sk = skins[Math.floor(rnd() * 4)];
      parts.forEach((p, k) => {
        om.makeTranslation(p.o[0], p.o[1], p.o[2]);
        meshes[k].setMatrixAt(i, pm.clone().multiply(om));
        col.setHex(p.c === 'shirt' ? sh : p.c === 'skin' ? sk : 0x333344);
        meshes[k].setColorAt(i, col);
      });
    }
    meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });

    const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 1200);
    const numEl = document.getElementById('num');
    const bigwrap = document.getElementById('bigwrap');
    const sub = document.getElementById('sub');
    const pos = seaGeo.attributes.position;
    const smooth = (x) => x * x * (3 - 2 * x);
    const lerp = (a, b, t) => a + (b - a) * t;

    window.setFrame = (t) => {
      const s = Math.min(COUNTS.length - 1, Math.floor(t / STAGE_SECONDS));
      const local = t - s * STAGE_SECONDS;
      const target = figs[s];
      const prev = s === 0 ? 0 : figs[s - 1];
      const k = Math.min(1, local / GROW_SECONDS);
      const visible = Math.round(prev + (target - prev) * smooth(k));
      meshes.forEach(m => { m.count = visible; });

      numEl.textContent = COUNTS[s].toLocaleString('en-US');
      sub.textContent = 'If this beach had ' + COUNTS[s].toLocaleString('en-US') + ' people';
      const pop = 1 + 0.22 * Math.max(0, 1 - local / 0.3);
      bigwrap.style.transform = 'scale(' + pop.toFixed(3) + ')';

      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 0.12 + t * 2) * 0.45 + Math.cos(y * 0.2 + t * 1.6) * 0.4);
      }
      pos.needsUpdate = true;
      seaGeo.computeVertexNormals();

      const p = smooth(Math.min(1, t / TOTAL_SECONDS));
      camera.position.set(Math.sin(t * 0.35) * lerp(5, 20, p), lerp(4, 55, p), lerp(24, 100, p));
      camera.lookAt(0, lerp(2, 0, p), lerp(-15, -25, p));
      renderer.render(scene, camera);
    };
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }, { W, H, COUNTS, MAX_FIGURES, STAGE_SECONDS, GROW_SECONDS, TOTAL_SECONDS });
  console.log('GL renderer:', info);
  console.log('Counts:', COUNTS.join(', '), '| frames:', N_FRAMES);

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

  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i frames/f%05d.jpg -vf scale=1080:1920:flags=lanczos -c:v libx264 -pix_fmt yuv420p -crf 20 videos/beach_escalation.mp4`, { stdio: 'inherit' });
  console.log('made videos/beach_escalation.mp4');
})();
