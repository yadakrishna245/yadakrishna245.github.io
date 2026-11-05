import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PAL = {
  midnight: 0x10070c, wine: 0x190b12, burgundy: 0x451126, accent: 0x701a3d,
  rose: 0xc77b9b, pale: 0xe5b5c7, ivory: 0xf8f0f3,
};

const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const RACKS = small ? 1500 : 4000;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

if (webglAvailable()) {
  init().catch((err) => {
    console.error(err);
    document.body.classList.add('no-webgl');
    window.__hideLoader?.();
  });
} else {
  document.body.classList.add('no-webgl');
  window.__hideLoader?.();
}

async function init() {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const isGL2 = renderer.capabilities.isWebGL2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.midnight);
  scene.fog = new THREE.FogExp2(PAL.midnight, 0.017);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 420);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(PAL.pale, PAL.midnight, 0.5));
  const moon = new THREE.DirectionalLight(PAL.pale, 0.9);
  moon.position.set(-30, 60, 25);
  scene.add(moon);
  const coreLight = new THREE.PointLight(PAL.rose, 260, 70, 1.6);
  coreLight.position.set(0, 9, 0);
  scene.add(coreLight);
  const galleryLight = new THREE.PointLight(PAL.pale, 120, 40, 1.6);
  galleryLight.position.set(0, 9, -32);
  scene.add(galleryLight);

  const uniforms = { uTime: { value: 0 } };

  // ---------- floor grid with expanding pulse ----------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: uniforms.uTime,
        uColor: { value: new THREE.Color(PAL.accent) },
        uPulse: { value: new THREE.Color(PAL.rose) },
        uBg: { value: new THREE.Color(PAL.midnight) },
      },
      vertexShader: /* glsl */`
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uColor, uPulse, uBg; varying vec3 vW;
        float grid(vec2 p, float s) {
          vec2 q = p / s;
          vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
          return 1.0 - min(min(g.x, g.y), 1.0);
        }
        void main() {
          float d = length(vW.xz);
          float g = grid(vW.xz, 2.0) * 0.28 + grid(vW.xz, 10.0) * 0.55;
          float ring = smoothstep(1.4, 0.0, abs(d - mod(uTime * 16.0, 180.0)));
          float fade = exp(-d * 0.02);
          vec3 col = uBg + uColor * g * fade * 0.9 + uPulse * ring * fade * (0.35 + g);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ---------- rack front texture ----------
  function rackTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
    const leds = ['#C77B9B', '#E5B5C7', '#701A3D', '#F8F0F3', '#C77B9B', '#E5B5C7'];
    for (let r = 0; r < 16; r++) {
      const y = 6 + r * 15.5;
      g.fillStyle = '#1c0a12'; g.fillRect(8, y, 112, 11);
      for (let k = 0; k < 3; k++) { g.fillStyle = leds[(r * 3 + k * 5) % leds.length]; g.fillRect(14 + k * 8, y + 4, 4, 3); }
      g.fillStyle = 'rgba(199,123,155,0.45)'; g.fillRect(56, y + 5, 12 + ((r * 37) % 9) * 6, 1.5);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  const rackTex = rackTexture();

  // LED material: per-row blinking that differs per instance.
  function ledMaterial(tex, intensity) {
    const m = new THREE.MeshStandardMaterial({
      color: 0x0c0509, metalness: 0.7, roughness: 0.4,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: intensity,
    });
    if (!isGL2) return m;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vSeed;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vSeed = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
          #else
            vSeed = 0.5;
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vSeed;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float row = floor(vEmissiveMapUv.y * 16.0);
            float h = fract(sin(row * 12.9898 + vSeed * 78.233) * 43758.5453);
            float blink = step(0.3, fract(h * 10.0 + uTime * (0.15 + h * 0.6)));
            totalEmissiveRadiance *= mix(0.15, 1.0, blink) * (0.45 + vSeed);
          }`);
    };
    return m;
  }

  // ---------- rack city ----------
  const GALLERY = new THREE.Vector3(0, 0, -36);
  const cells = [];
  const sx = 1.7, sz = 2.1;
  for (let i = -62; i <= 62; i++) {
    for (let j = -62; j <= 62; j++) {
      if (i % 6 === 0 || j % 5 === 0) continue; // streets
      const x = i * sx, z = j * sz;
      const d = Math.hypot(x, z);
      if (d < 16) continue;                                         // core plaza
      if (Math.hypot(x - GALLERY.x, z - GALLERY.z) < 12) continue;  // project gallery plaza
      cells.push({ x, z, d: d + Math.random() * 3 });
    }
  }
  cells.sort((a, b) => a.d - b.d);
  const used = cells.slice(0, RACKS);

  const sideMat = new THREE.MeshStandardMaterial({ color: 0x1d0c15, metalness: 0.6, roughness: 0.55 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0x2c1220, metalness: 0.5, roughness: 0.5 });
  const frontMat = ledMaterial(rackTex, 2.6);
  // BoxGeometry groups: +x, -x, +y, -y, +z, -z
  const racks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), [sideMat, sideMat, topMat, topMat, frontMat, frontMat], used.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  used.forEach((c, k) => {
    const h = 1.3 + Math.pow(Math.random(), 2) * 1.7;
    s.set(1.05, h, 1.25);
    p.set(c.x, h / 2, c.z);
    m4.compose(p, q, s);
    racks.setMatrixAt(k, m4);
  });
  racks.instanceMatrix.needsUpdate = true;
  scene.add(racks);

  const note = document.getElementById('rack-note');
  if (note) {
    note.textContent = used.length >= 4000
      ? `${used.length.toLocaleString()} racks rendered below: one for every server I manage.`
      : `Shown here as ${used.length.toLocaleString()} racks to stay smooth on this device. The full view renders one rack per server (4,000).`;
  }

  // ---------- data packets moving along the streets ----------
  {
    const N = small ? 450 : 1000;
    const lanesX = [], lanesZ = [];
    for (let i = -10; i <= 10; i++) lanesX.push(i * 6 * sx);
    for (let j = -12; j <= 12; j++) lanesZ.push(j * 5 * sz);
    const geo = new THREE.BufferGeometry();
    const aLane = new Float32Array(N), aAxis = new Float32Array(N), aSpeed = new Float32Array(N), aOffset = new Float32Array(N), aSeed = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const axis = Math.random() < 0.5 ? 0 : 1;
      const lanes = axis === 0 ? lanesX : lanesZ;
      aAxis[n] = axis;
      aLane[n] = lanes[(Math.random() * lanes.length) | 0] + (Math.random() - 0.5) * 0.5;
      aSpeed[n] = (4 + Math.random() * 10) * (Math.random() < 0.5 ? -1 : 1) * (reduced ? 0.3 : 1);
      aOffset[n] = Math.random() * 200;
      aSeed[n] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aLane', new THREE.BufferAttribute(aLane, 1));
    geo.setAttribute('aAxis', new THREE.BufferAttribute(aAxis, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(aOffset, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uPR: { value: renderer.getPixelRatio() }, uA: { value: new THREE.Color(PAL.rose) }, uB: { value: new THREE.Color(PAL.ivory) } },
      vertexShader: /* glsl */`
        uniform float uTime, uPR;
        attribute float aLane, aAxis, aSpeed, aOffset, aSeed;
        varying float vSeed, vFade;
        void main() {
          float t = mod(aOffset + uTime * aSpeed, 200.0) - 100.0;
          vec3 p = aAxis < 0.5 ? vec3(aLane, 0.22, t) : vec3(t, 0.22, aLane);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPR * (30.0 / -mv.z) * (0.6 + aSeed);
          vSeed = aSeed;
          vFade = exp(-length(p.xz) * 0.018);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uA, uB; varying float vSeed, vFade;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(mix(uA, uB, vSeed) * 2.2 * a * vFade, a * vFade);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pts.frustumCulled = false;
    scene.add(pts);
  }

  // ---------- floating dust ----------
  {
    const N = small ? 500 : 1400;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      pos[n * 3] = (Math.random() - 0.5) * 160;
      pos[n * 3 + 1] = Math.random() * 40;
      pos[n * 3 + 2] = (Math.random() - 0.5) * 160;
      seed[n] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const dust = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uPR: { value: renderer.getPixelRatio() }, uC: { value: new THREE.Color(PAL.pale) } },
      vertexShader: /* glsl */`
        uniform float uTime, uPR; attribute float aSeed; varying float vA;
        void main() {
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.3 + aSeed * 0.6), 40.0);
          p.x += sin(uTime * 0.2 + aSeed * 30.0) * 1.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPR * (10.0 / -mv.z) * (0.5 + aSeed);
          vA = (0.25 + 0.5 * aSeed) * smoothstep(0.0, 4.0, p.y) * smoothstep(40.0, 30.0, p.y);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uC; varying float vA;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
          gl_FragColor = vec4(uC * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    dust.frustumCulled = false;
    scene.add(dust);
  }

  // ---------- core tower ----------
  const core = new THREE.Group();
  scene.add(core);
  const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
  {
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.8, 0.6, 72), new THREE.MeshStandardMaterial({ color: 0x1d0c15, metalness: 0.85, roughness: 0.3 }));
    ped.position.y = 0.3;
    core.add(ped);
    const pedRing = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.05, 8, 160), new THREE.MeshBasicMaterial({ color: glow(PAL.rose, 3), toneMapped: false }));
    pedRing.rotation.x = Math.PI / 2; pedRing.position.y = 0.62;
    core.add(pedRing);

    const towerTex = rackTex.clone();
    towerTex.wrapT = THREE.RepeatWrapping;
    towerTex.repeat.set(1, 4);
    towerTex.needsUpdate = true;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 12, 2.6), ledMaterial(towerTex, 3.2));
    tower.position.y = 6.6;
    core.add(tower);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tower.geometry), new THREE.LineBasicMaterial({ color: glow(PAL.pale, 2.5), toneMapped: false }));
    edges.position.copy(tower.position);
    core.add(edges);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 2.9), new THREE.MeshBasicMaterial({ color: glow(PAL.pale, 3), toneMapped: false }));
    cap.position.y = 12.7;
    core.add(cap);
  }
  const rings = [];
  [[3.8, 0.35, 0.8], [4.9, -0.5, -0.5], [6.1, 0.15, 0.35]].forEach(([r, tilt, spin], i) => {
    const g = new THREE.Group();
    g.position.y = 6.6;
    g.rotation.x = Math.PI / 2 + tilt;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 220), new THREE.MeshBasicMaterial({ color: glow(i === 1 ? PAL.pale : PAL.rose, 2.6), toneMapped: false }));
    g.add(ring);
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), new THREE.MeshBasicMaterial({ color: glow(PAL.ivory, 4), toneMapped: false }));
    sat.position.x = r;
    g.add(sat);
    g.userData.spin = spin;
    core.add(g);
    rings.push(g);
  });
  // light beam
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uC: { value: new THREE.Color(PAL.rose) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uC; varying vec2 vUv;
      void main(){ float a = pow(1.0 - vUv.y, 2.0) * (0.55 + 0.45 * sin(uTime * 2.0 - vUv.y * 30.0)) * 0.1;
        gl_FragColor = vec4(uC * a * 2.0, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 90, 32, 1, true), beamMat);
  beam.position.y = 12.8 + 45;
  core.add(beam);

  // ground halos
  function halo(radius, color, strength) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, `rgba(255,255,255,${strength})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.03;
    return m;
  }
  scene.add(halo(13, PAL.accent, 0.9));
  const gHalo = halo(11, PAL.burgundy, 0.9); gHalo.position.set(GALLERY.x, 0.03, GALLERY.z); scene.add(gHalo);

  // ---------- project screens ----------
  if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* draw with system fonts */ } }

  function wrap(g, text, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function screenTexture({ title, desc, tags, repo }, hover) {
    const W = 1024, H = 640, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, 'rgba(69,17,38,0.94)'); bg.addColorStop(1, 'rgba(16,7,12,0.94)');
    roundRect(g, 6, 6, W - 12, H - 12, 34); g.fillStyle = bg; g.fill();
    g.lineWidth = hover ? 8 : 4; g.strokeStyle = hover ? '#F8F0F3' : '#C77B9B'; g.stroke();
    g.fillStyle = 'rgba(112,26,61,0.6)'; g.fillRect(8, 8, W - 16, 64);
    ['#C77B9B', '#701A3D', '#451126'].forEach((col, i) => { g.beginPath(); g.arc(50 + i * 34, 40, 10, 0, Math.PI * 2); g.fillStyle = col; g.fill(); });
    g.font = '500 26px "JetBrains Mono", Consolas, monospace'; g.fillStyle = '#E5B5C7'; g.textAlign = 'center';
    g.fillText('~/projects/' + (repo.length > 34 ? repo.slice(0, 32) + '…' : repo), W / 2, 49);
    g.textAlign = 'left';
    g.font = '700 64px "Space Grotesk", "Segoe UI", sans-serif'; g.fillStyle = '#F8F0F3';
    let y = 158;
    wrap(g, title, W - 120).slice(0, 2).forEach((l) => { g.fillText(l, 60, y); y += 70; });
    g.font = '400 34px "Space Grotesk", "Segoe UI", sans-serif'; g.fillStyle = '#E5B5C7';
    y += 8;
    wrap(g, desc, W - 120).slice(0, 4).forEach((l) => { g.fillText(l, 60, y); y += 46; });
    g.font = '500 26px "JetBrains Mono", Consolas, monospace';
    let x = 60;
    tags.split('·').map((t) => t.trim()).forEach((t) => {
      const w = g.measureText(t).width + 36;
      roundRect(g, x, H - 112, w, 48, 24); g.fillStyle = 'rgba(112,26,61,0.75)'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(199,123,155,0.7)'; g.stroke();
      g.fillStyle = '#F8F0F3'; g.fillText(t, x + 18, H - 79);
      x += w + 14;
    });
    g.font = '500 24px "JetBrains Mono", Consolas, monospace'; g.fillStyle = hover ? '#F8F0F3' : '#C77B9B'; g.textAlign = 'right';
    g.fillText(hover ? 'click to open ↗' : 'github ↗', W - 60, H - 79);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  const projects = [...document.querySelectorAll('.project')].map((li) => ({
    title: li.querySelector('h3').textContent.trim(),
    desc: li.querySelector('p').textContent.trim(),
    tags: li.querySelector('.tags').textContent.trim(),
    repo: li.dataset.repo,
    href: li.querySelector('a').href,
  }));
  const FOCUS = new THREE.Vector3(0, 0, -26);
  const slots = [[-34, 6.4], [0, 6.4], [34, 6.4], [-34, 3.1], [0, 3.1], [34, 3.1]];
  const screens = projects.slice(0, 6).map((pr, i) => {
    const [deg, h] = slots[i];
    const a = THREE.MathUtils.degToRad(deg);
    const texN = screenTexture(pr, false), texH = screenTexture(pr, true);
    const mat = new THREE.MeshBasicMaterial({ map: texN, transparent: true, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(0.86, 0.86, 0.86) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 2.69), mat);
    mesh.position.set(FOCUS.x + Math.sin(a) * 11.5, h, FOCUS.z - Math.cos(a) * 11.5);
    mesh.lookAt(FOCUS.x, h, FOCUS.z);
    mesh.userData = { ...pr, texN, texH, baseY: h, phase: i * 0.9, hover: 0 };
    scene.add(mesh);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(4.42, 2.81)), new THREE.LineBasicMaterial({ color: glow(PAL.rose, 2), toneMapped: false, transparent: true, opacity: 0.8 }));
    mesh.add(frame);
    return mesh;
  });

  // ---------- post-processing ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), small ? 0.8 : 1.0, 0.55, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- camera path (one key per section) ----------
  const sections = [...document.querySelectorAll('.section')];
  let posCurve, tgtCurve;
  function buildPath() {
    const aspect = innerWidth / innerHeight;
    const pull = THREE.MathUtils.clamp(1.55 / aspect, 1, 1.7); // back off on tall screens
    const portrait = aspect < 1;
    const keys = [
      { p: [0, 5.5, 30 * pull], t: portrait ? [0, 0, 0] : [-7, 6.5, 0] }, // hero
      { p: [15, 4.6, 17 * pull], t: [portrait ? 0 : -4.5, 7, 0] }, // about
      { p: [10, 50, 36], t: [0, 0, -6] },                           // fleet
      { p: [0, 5.6, -18 + 4 * (pull - 1)], t: [-1.8, 4.6, -37.5] }, // projects
      { p: [-16, 3.6, 18 * pull], t: [portrait ? 0 : 4.5, 7.5, 0] }, // recognition
      { p: [22, 26, 44 * pull], t: [0, 1, 0] },                     // contact
    ];
    posCurve = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.p)), false, 'centripetal');
    tgtCurve = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.t)), false, 'centripetal');
  }
  buildPath();

  function scrollT() {
    const y = scrollY;
    const n = sections.length;
    let i = 0;
    for (let k = 0; k < n; k++) if (sections[k].offsetTop <= y + 1) i = k;
    if (i >= n - 1) return 1;
    const a = sections[i].offsetTop, b = sections[i + 1].offsetTop;
    const frac = THREE.MathUtils.clamp((y - a) / Math.max(1, b - a), 0, 1);
    return (i + frac) / (n - 1);
  }

  // ---------- interaction ----------
  const mouse = new THREE.Vector2(), mouseSmooth = new THREE.Vector2(), ndc = new THREE.Vector2(-9, -9);
  const ray = new THREE.Raycaster();
  let hovered = null;
  addEventListener('pointermove', (e) => {
    mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  }, { passive: true });
  addEventListener('click', (e) => {
    if (!hovered || e.target.closest('a, button, .card, .project')) return;
    window.open(hovered.userData.href, '_blank', 'noopener');
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloom.setSize(innerWidth, innerHeight);
    buildPath();
  });

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let tCur = scrollT();
  const intro = { k: SHOT || reduced ? 1 : 0, from: new THREE.Vector3(0, 90, 130), fromT: new THREE.Vector3(0, 0, 0) };
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  let introStart = null;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    uniforms.uTime.value = time;

    // window.__tOverride lets the preview recorder place the camera anywhere on the path
    if (typeof window.__tOverride === 'number') tCur = window.__tOverride;
    else tCur += (scrollT() - tCur) * (1 - Math.exp(-dt * (SHOT ? 60 : 3.2)));
    posCurve.getPoint(tCur, camPos);
    tgtCurve.getPoint(tCur, camTgt);

    if (intro.k < 1) {
      if (introStart === null) introStart = time;
      intro.k = Math.min(1, (time - introStart) / 3.8);
      const e = ease(intro.k);
      camPos.lerpVectors(intro.from, camPos, e);
      camTgt.lerpVectors(intro.fromT, camTgt, e);
    }

    if (!reduced) mouseSmooth.lerp(mouse, 1 - Math.exp(-dt * 4));
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    camera.position.addScaledVector(right, mouseSmooth.x * 1.2).addScaledVector(up, -mouseSmooth.y * 0.7);
    camera.lookAt(camTgt);

    rings.forEach((g, i) => { g.rotation.z += dt * g.userData.spin; g.rotation.y = Math.sin(time * 0.3 + i) * 0.08; });

    // hover only when the gallery is in view
    const inGallery = Math.abs(tCur - 3 / 5) < 0.09;
    let hit = null;
    if (inGallery) {
      ray.setFromCamera(ndc, camera);
      hit = ray.intersectObjects(screens, false)[0]?.object || null;
    }
    if (hit !== hovered) {
      if (hovered) hovered.material.map = hovered.userData.texN;
      if (hit) hit.material.map = hit.userData.texH;
      hovered = hit;
      document.body.style.cursor = hit ? 'pointer' : '';
    }
    screens.forEach((m) => {
      const u = m.userData;
      u.hover += ((m === hovered ? 1 : 0) - u.hover) * (1 - Math.exp(-dt * 8));
      m.position.y = u.baseY + Math.sin(time * 0.9 + u.phase) * 0.08;
      m.scale.setScalar(1 + u.hover * 0.07);
    });

    composer.render();
    requestAnimationFrame(frame);
  }

  window.__sceneReady = true;
  requestAnimationFrame(frame);
  window.__hideLoader?.();
}
