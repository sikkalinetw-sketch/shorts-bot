const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const W = 540, H = 960, N = 90, FPS = 30;

(async () => {
  fs.mkdirSync('frames', { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<html><body style="margin:0;position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#000">
    <canvas id="c" width="${W}" height="${H}" style="position:absolute;left:0;top:0"></canvas>
    <div id="label" style="position:absolute;left:0;right:0;top:60px;text-align:center;color:#fff;font:700 18px sans-serif;letter-spacing:3px;text-shadow:0 2px 6px #000">GAS RELEASED</div>
    <div id="counter" style="position:absolute;left:0;right:0;top:86px;text-align:center;color:#fff;font:800 46px sans-serif;text-shadow:0 3px 8px #000">0 L</div>
    <div id="sub" style="position:absolute;left:24px;right:24px;bottom:190px;text-align:center;color:#fff;font:800 32px sans-serif;text-shadow:0 3px 8px #000"></div>
  </body></html>`);
  await page.addScriptTag({ path: path.join(__dirname, 'node_modules/three/build/three.min.js') });

  const info = await page.evaluate(({ W, H }) => {
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7ec8f0);
    scene.fog = new THREE.Fog(0xbfe3ff, 60, 220);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x998866, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2cc, 0.8);
    sun.position.set(30, 50, 20);
    scene.add(sun);

    let seed = 11;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const box = (w, h, d, c, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
      m.position.set(x, y, z);
      return m;
    };

    const sand = new THREE.Mesh(new THREE.PlaneGeometry(400, 200), mat(0xe8d8a0));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0, 40);
    scene.add(sand);

    const seaGeo = new THREE.PlaneGeometry(400, 120, 60, 30);
    const sea = new THREE.Mesh(seaGeo, mat(0x1ca3c4));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.05, -70);
    scene.add(sea);

    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 16), new THREE.MeshBasicMaterial({ color: 0xfff6b0 }));
    sunDisc.position.set(60, 70, -200);
    scene.add(sunDisc);

    scene.add(box(6, 0.4, 60, 0xb08a5a, -14, 1.6, -25));
    for (let i = 0; i < 12; i++) {
      scene.add(box(0.5, 2, 0.5, 0x6b4f2a, -16.5, 0.8, -2 - i * 5));
      scene.add(box(0.5, 2, 0.5, 0x6b4f2a, -11.5, 0.8, -2 - i * 5));
    }

    const bcolors = [0xf2d0a4, 0xd9e4ec, 0xf4a6a0, 0xb8d8c8, 0xe8e0c0];
    for (let i = 0; i < 14; i++) {
      const h = 8 + rnd() * 22;
      const side = i % 2 === 0 ? -1 : 1;
      scene.add(box(8 + rnd() * 6, h, 8, bcolors[i % 5], side * (36 + rnd() * 20), h / 2, 20 - i * 6));
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
    [[-22, 6], [22, 4], [-30, -8], [30, -10], [-8, 12]].forEach(p => palm(p[0], p[1]));

    const shirt = [0xe53935, 0xfdd835, 0x43a047, 0x1e88e5, 0x8e24aa, 0xff7043];
    const skins = [0xf1c27d, 0xc68642, 0x8d5524, 0xffdbac];
    const people = [];
    for (let i = 0; i < 90; i++) {
      const g = new THREE.Group();
      g.add(box(0.55, 0.8, 0.32, shirt[i % 6], 0, 1.15, 0));
      g.add(box(0.36, 0.36, 0.36, skins[Math.floor(rnd() * 4)], 0, 1.77, 0));
      g.add(box(0.2, 0.75, 0.22, 0x333344, -0.14, 0.38, 0));
      g.add(box(0.2, 0.75, 0.22, 0x333344, 0.14, 0.38, 0));
      g.add(box(0.14, 0.7, 0.16, skins[i % 4], -0.37, 1.15, 0));
      g.add(box(0.14, 0.7, 0.16, skins[i % 4], 0.37, 1.15, 0));
      g.position.set((rnd() - 0.5) * 36, 0, 2 - rnd() * 22);
      g.rotation.y = Math.PI + (rnd() - 0.5) * 0.6;
      scene.add(g);
      people.push({ g, phase: rnd() * 6 });
    }

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 600);
    const counter = document.getElementById('counter');
    const sub = document.getElementById('sub');
    const pos = seaGeo.attributes.position;

    window.setFrame = (t) => {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        pos.setZ(i, Math.sin(x * 0.15 + t * 2) * 0.35 + Math.cos(y * 0.25 + t * 1.6) * 0.3);
      }
      pos.needsUpdate = true;
      seaGeo.computeVertexNormals();
      people.forEach(p => { p.g.position.y = Math.abs(Math.sin(t * 3 + p.phase)) * 0.05; });
      camera.position.set(Math.sin(t * 0.6) * 4, 4 + t * 0.5, 20 - t * 5);
      camera.lookAt(-4, 2.5, -35);
      const prog = Math.min(1, t / 3);
      counter.textContent = Math.floor(738000000 * prog).toLocaleString('en-US') + ' L';
      sub.textContent = t < 1.5 ? 'Everyone on Earth.' : "And yes. There's a tsunami.";
      renderer.render(scene, camera);
    };
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }, { W, H });
  console.log('GL renderer:', info);

  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await page.evaluate((t) => window.setFrame(t), i / FPS);
    await page.screenshot({ path: `frames/f${String(i).padStart(4, '0')}.png` });
  }
  const sec = (Date.now() - t0) / 1000;
  console.log(`Rendered ${N} frames in ${sec.toFixed(1)}s, ${(sec / N).toFixed(2)}s per frame`);
  console.log(`Estimate for 61s video at 30fps: ${((sec / N) * 61 * 30 / 60).toFixed(1)} minutes`);
  await browser.close();
})();
