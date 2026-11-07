const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  fs.mkdirSync('frames', { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  await page.setContent('<html><body style="margin:0"><canvas id="c" width="540" height="960"></canvas></body></html>');
  await page.addScriptTag({ path: path.join(__dirname, 'node_modules/three/build/three.min.js') });

  const info = await page.evaluate(() => {
    const canvas = document.getElementById('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(540, 960, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(10, 20, 10);
    scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ color: 0xe8d8a0 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 80),
      new THREE.MeshLambertMaterial({ color: 0x1ca3c4 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.05, -60);
    scene.add(sea);
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const colors = [0xe53935, 0xfdd835, 0x43a047, 0x1e88e5, 0x8e24aa];
    for (let i = 0; i < 120; i++) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 1.7, 0.4),
        new THREE.MeshLambertMaterial({ color: colors[i % 5] })
      );
      p.position.set((rnd() - 0.5) * 30, 0.85, -rnd() * 25);
      scene.add(p);
    }
    const camera = new THREE.PerspectiveCamera(55, 540 / 960, 0.1, 500);
    window.setFrame = (t) => {
      camera.position.set(Math.sin(t) * 3, 3 + t * 0.3, 14 - t * 3);
      camera.lookAt(0, 1.5, -30);
      renderer.render(scene, camera);
    };
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('GL renderer:', info);

  const N = 60;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await page.evaluate((t) => window.setFrame(t), i / 30);
    await page.screenshot({ path: `frames/f${String(i).padStart(4, '0')}.png` });
  }
  const sec = (Date.now() - t0) / 1000;
  console.log(`Rendered ${N} frames in ${sec.toFixed(1)}s, ${(sec / N).toFixed(2)}s per frame`);
  console.log(`Estimate for 61s video at 30fps: ${((sec / N) * 61 * 30 / 60).toFixed(1)} minutes`);
  await browser.close();
})();
