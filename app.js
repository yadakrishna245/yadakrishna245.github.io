import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

window.__fieldLoading = true;
const params = new URLSearchParams(location.search);
const SHOT = params.has('shot');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const N = small ? 12000 : 26000;
const L = 16; // lattice side: 16^3 = 4096 points
const CAM_Z = 18, FOV = 45;

function webgl() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
if (webgl()) init().catch((e) => { console.error(e); document.body.classList.add('no-webgl'); });
else document.body.classList.add('no-webgl');

// deterministic random so every visit builds the same shapes
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(245);
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---------- shapes ----------
function nameShape(aspect) {
  const W = 2000, H = 760;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const lines = ['krishna', 'chaithanya'];
  let size = 300;
  g.font = `500 ${size}px Unbounded, "Segoe UI", sans-serif`;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  size = Math.floor(size * Math.min(1, (W * 0.94) / widest));
  g.font = `500 ${size}px Unbounded, "Segoe UI", sans-serif`;
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(lines[0], W / 2, H * 0.3);
  g.fillText(lines[1], W / 2, H * 0.72);
  const data = g.getImageData(0, 0, W, H).data;
  const pts = [];
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (data[(y * W + x) * 4 + 3] > 140) { pts.push(x, y); if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const visW = 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect;
  const worldW = Math.min(14.5, visW * 0.88);
  const k = worldW / (maxX - minX), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const out = new Float32Array(N * 3), cnt = pts.length / 2;
  for (let i = 0; i < N; i++) {
    const j = (rnd() * cnt) | 0;
    out[i * 3] = (pts[j * 2] - cx + (rnd() - 0.5) * 2) * k;
    out[i * 3 + 1] = -(pts[j * 2 + 1] - cy + (rnd() - 0.5) * 2) * k;
    out[i * 3 + 2] = (rnd() - 0.5) * 0.5;
  }
  return out;
}

function globeShape() {
  const R = 4.6, out = new Float32Array(N * 3), v = new THREE.Vector3();
  const arcs = [];
  for (let a = 0; a < 18; a++) {
    const p = new THREE.Vector3().randomDirection(), q = new THREE.Vector3().randomDirection();
    if (p.dot(q) < -0.4) { a--; continue; } // near-opposite ends would cut through the middle
    arcs.push([p, q]);
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    if (rnd() < 0.74) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
      v.set(Math.cos(th) * r, y, Math.sin(th) * r).multiplyScalar(R * (1 + gauss() * 0.006));
    } else {
      const [p, q] = arcs[(rnd() * arcs.length) | 0];
      const t = rnd();
      v.copy(p).lerp(q, t).normalize().multiplyScalar(R * (1 + 0.28 * Math.sin(Math.PI * t)));
    }
    out.set([v.x, v.y, v.z], i * 3);
  }
  return out;
}

function latticeShape() {
  const s = 0.56, off = ((L - 1) * s) / 2, out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const n = i % (L * L * L);
    let x = n % L, y = ((n / L) | 0) % L, z = (n / (L * L)) | 0;
    let px = x * s - off, py = y * s - off, pz = z * s - off;
    if (rnd() < 0.28) {
      const axis = (rnd() * 3) | 0, t = rnd();
      if (axis === 0 && x < L - 1) px += t * s;
      else if (axis === 1 && y < L - 1) py += t * s;
      else if (z < L - 1) pz += t * s;
    } else { px += gauss() * 0.03; py += gauss() * 0.03; pz += gauss() * 0.03; }
    out.set([px, py, pz], i * 3);
  }
  return out;
}

function helixShape() {
  const R = 2.1, len = 12.5, turns = 3.4, rungs = 30, out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    let x, y, z;
    if (rnd() < 0.66) {
      const t = rnd(), a = t * turns * Math.PI * 2 + (i % 2) * Math.PI;
      x = Math.cos(a) * R + gauss() * 0.07; y = (t - 0.5) * len; z = Math.sin(a) * R + gauss() * 0.07;
    } else {
      const r = (rnd() * rungs) | 0, t = (r + 0.5) / rungs, a = t * turns * Math.PI * 2, u = rnd();
      x = Math.cos(a) * R * (1 - 2 * u); y = (t - 0.5) * len + gauss() * 0.03; z = Math.sin(a) * R * (1 - 2 * u);
    }
    out.set([x, y, z], i * 3);
  }
  return out;
}

function haloShape() {
  // (2,5) torus knot seen face-on: a five-lobed star rosette
  const out = new Float32Array(N * 3), p = 2, q = 5, S = 1.75;
  for (let i = 0; i < N; i++) {
    const t = rnd() * Math.PI * 2, r = 0.6 * Math.cos(q * t) + 2;
    const tube = 0.16 * Math.abs(gauss());
    const d = new THREE.Vector3().randomDirection().multiplyScalar(tube);
    out.set([(r * Math.cos(p * t)) * S + d.x, (r * Math.sin(p * t)) * S + d.y, -Math.sin(q * t) * S + d.z], i * 3);
  }
  return out;
}

function galaxyShape() {
  const out = new Float32Array(N * 3), arms = 3;
  for (let i = 0; i < N; i++) {
    if (rnd() < 0.12) {
      const d = new THREE.Vector3().randomDirection().multiplyScalar(Math.pow(rnd(), 2) * 1.1);
      out.set([d.x, d.y * 0.6, d.z], i * 3); continue;
    }
    const r = 0.6 + Math.pow(rnd(), 1.5) * 9;
    const a = ((i % arms) / arms) * Math.PI * 2 + r * 0.55 + gauss() * 0.32 * (1.1 - r / 11);
    out.set([Math.cos(a) * r, gauss() * 0.22 * (1 - r / 11), Math.sin(a) * r], i * 3);
  }
  return out;
}

// ---------- scene ----------
async function init() {
  try { await Promise.race([document.fonts.load('500 300px Unbounded'), new Promise((r) => setTimeout(r, 2500))]); } catch { /* system font */ }

  const canvas = document.getElementById('field');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1030);
  const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 0, CAM_Z);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const shapes = [nameShape(camera.aspect), globeShape(), latticeShape(), helixShape(), haloShape(), galaxyShape()];
  shapes.forEach((s, i) => geo.setAttribute('aP' + i, new THREE.BufferAttribute(s, 3)));
  const rand = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) rand[i] = rnd();
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));

  const uniforms = {
    uProg: { value: 0 }, uTime: { value: 0 }, uIntro: { value: SHOT || reduced ? 1 : 0 },
    uPR: { value: renderer.getPixelRatio() }, uSize: { value: small ? 58 : 52 },
    uMouse: { value: new THREE.Vector2(9, 9) }, uAspect: { value: camera.aspect }, uDim: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      uniform float uProg, uTime, uIntro, uPR, uSize, uAspect, uDim;
      uniform vec2 uMouse;
      attribute vec3 aP0, aP1, aP2, aP3, aP4, aP5;
      attribute vec4 aRand;
      varying vec3 vCol; varying float vA;
      vec3 shape(float i) {
        if (i < 0.5) return aP0; if (i < 1.5) return aP1; if (i < 2.5) return aP2;
        if (i < 3.5) return aP3; if (i < 4.5) return aP4; return aP5;
      }
      vec3 spectrum(float t) {
        vec3 c1 = vec3(0.435, 0.906, 1.0), c2 = vec3(0.612, 0.482, 1.0), c3 = vec3(1.0, 0.722, 0.42);
        return t < 0.55 ? mix(c1, c2, t / 0.55) : mix(c2, c3, (t - 0.55) / 0.45);
      }
      vec3 swirl(vec3 p, float s) {
        return vec3(sin(p.y * 0.9 + uTime * 0.7 + aRand.y * 6.28),
                    sin(p.z * 0.8 + uTime * 0.9 + aRand.z * 6.28),
                    sin(p.x * 0.85 + uTime * 0.6 + aRand.w * 6.28)) * s;
      }
      void main() {
        float seg = clamp(floor(uProg), 0.0, 4.0);
        float f = clamp(uProg - seg, 0.0, 1.0);
        float d = aRand.x * 0.4;
        float k = smoothstep(d, d + 0.6, f);
        vec3 p = mix(shape(seg), shape(seg + 1.0), k);
        p += swirl(p, sin(k * 3.14159) * 1.6);

        float ki = smoothstep(aRand.x * 0.45, aRand.x * 0.45 + 0.55, uIntro);
        vec3 from = aP5 * 1.3 + vec3(0.0, -1.0, 0.0);
        p = mix(from, p, ki) + swirl(p, sin(ki * 3.14159) * 1.4);

        p += 0.045 * vec3(sin(uTime * 1.3 + aRand.y * 40.0), cos(uTime * 1.1 + aRand.z * 40.0), sin(uTime * 0.9 + aRand.w * 40.0));

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec4 clip = projectionMatrix * mv;
        vec2 ndc = clip.xy / clip.w;
        vec2 dv = (ndc - uMouse) * vec2(uAspect, 1.0);
        float dist = length(dv);
        float push = smoothstep(0.3, 0.0, dist);
        if (dist > 1e-4) ndc += (dv / dist) / vec2(uAspect, 1.0) * push * 0.075;
        clip.xy = ndc * clip.w;
        gl_Position = clip;

        gl_PointSize = uSize * uPR * (0.55 + aRand.z * 0.9) / -mv.z * (1.0 + push * 1.2);
        float spec = clamp(0.5 + mv.x / 15.0 + (aRand.y - 0.5) * 0.45, 0.0, 1.0);
        vCol = spectrum(spec) * (0.75 + push * 1.1);
        vA = (0.5 + 0.5 * aRand.w) * uDim;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.16, 0.0, d);
        gl_FragColor = vec4(vCol * (a * 0.55 + core * 0.9) * vA, a * vA);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  scene.add(group);

  // faint far stars for depth
  {
    const M = small ? 600 : 1500, pos = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) pos.set([(rnd() - 0.5) * 120, (rnd() - 0.5) * 70, -20 - rnd() * 40], i * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xb9bee6, size: 0.12, transparent: true, opacity: 0.5, depthWrite: false })));
  }

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), small ? 0.5 : 0.6, 0.45, 0.12);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const note = document.getElementById('lattice-note');
  if (note && small) note.textContent = 'On this screen the field is lighter, but the lattice still holds all 4,096 points, sixteen on each side.';

  // ---------- per-section placement ----------
  function placement(i, t, portrait) {
    const sx = portrait ? 0 : 1, sc = portrait ? 0.62 : 1;
    switch (i) {
      case 0: return { p: [0, portrait ? 2.2 : 1.1, 0], r: [0, 0, 0], s: 1 };
      case 1: return { p: [4.0 * sx, portrait ? 1.5 : 0, 0], r: [0.35, t * 0.12, 0.1], s: sc };
      case 2: return { p: [-4.4 * sx, portrait ? 2 : 0, 0], r: [0.5, 0.7 + t * 0.07, 0], s: 0.72 * sc };
      case 3: return { p: [4.4 * sx, 0, 0], r: [0, t * 0.22, 0.16], s: sc };
      case 4: return { p: [-4.3 * sx, portrait ? 2 : 0, 0], r: [0.35 + Math.sin(t * 0.3) * 0.12, Math.sin(t * 0.23) * 0.2, t * 0.12], s: sc };
      default: return { p: [0, portrait ? 3.5 : 2.6, -2], r: [-1.08, t * 0.045, 0], s: portrait ? 0.8 : 1.15 };
    }
  }
  const ease = (x) => x * x * (3 - 2 * x);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const eA = new THREE.Euler(), qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
  function applyPlacement(prog, t) {
    const portrait = camera.aspect < 0.9;
    const i0 = Math.min(5, Math.floor(prog)), i1 = Math.min(5, i0 + 1), f = ease(prog - i0);
    const a = placement(i0, t, portrait), b = placement(i1, t, portrait);
    group.position.copy(tmpA.fromArray(a.p).lerp(tmpB.fromArray(b.p), f));
    qA.setFromEuler(eA.set(...a.r)); qB.setFromEuler(eA.set(...b.r));
    group.quaternion.copy(qA.slerp(qB, f));
    group.scale.setScalar(THREE.MathUtils.lerp(a.s, b.s, f));
    // dim the field behind text on narrow screens
    const dimA = portrait && i0 > 0 && i0 < 5 ? 0.55 : 1, dimB = portrait && i1 > 0 && i1 < 5 ? 0.55 : 1;
    uniforms.uDim.value = THREE.MathUtils.lerp(dimA, dimB, f);
  }

  const panels = [...document.querySelectorAll('.panel')];
  function scrollProg() {
    const y = scrollY, n = panels.length;
    let i = 0;
    for (let k = 0; k < n; k++) if (panels[k].offsetTop <= y + 1) i = k;
    if (i >= n - 1) return n - 1;
    const a = panels[i].offsetTop, b = panels[i + 1].offsetTop;
    return i + THREE.MathUtils.clamp((y - a) / Math.max(1, b - a), 0, 1);
  }

  // ---------- input ----------
  const mouseTarget = new THREE.Vector2(9, 9), tilt = new THREE.Vector2(), tiltTarget = new THREE.Vector2();
  addEventListener('pointermove', (e) => {
    mouseTarget.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    tiltTarget.set(mouseTarget.x, mouseTarget.y);
  }, { passive: true });
  addEventListener('pointerleave', () => mouseTarget.set(9, 9));

  let lastPortrait = camera.aspect < 0.9;
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    uniforms.uAspect.value = camera.aspect;
    const portrait = camera.aspect < 0.9;
    if (portrait !== lastPortrait) {
      lastPortrait = portrait;
      geo.getAttribute('aP0').array.set(nameShape(camera.aspect));
      geo.getAttribute('aP0').needsUpdate = true;
    }
  });

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let prog = scrollProg();
  let introStart = null;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    uniforms.uTime.value = reduced ? t * 0.3 : t;

    if (typeof window.__pOverride === 'number') prog = window.__pOverride;
    else prog += (scrollProg() - prog) * (1 - Math.exp(-dt * (SHOT ? 60 : 2.6)));
    uniforms.uProg.value = prog;

    if (uniforms.uIntro.value < 1) {
      if (introStart === null) introStart = t;
      uniforms.uIntro.value = Math.min(1, (t - introStart) / 2.8);
    }

    uniforms.uMouse.value.lerp(mouseTarget, 1 - Math.exp(-dt * 10));
    applyPlacement(prog, reduced ? 0 : t);
    if (!reduced) {
      tilt.lerp(tiltTarget, 1 - Math.exp(-dt * 3));
      camera.position.set(tilt.x * 0.9, tilt.y * 0.6, CAM_Z);
      camera.lookAt(0, 0, 0);
    }

    composer.render();
    requestAnimationFrame(frame);
  }
  window.__fieldReady = window.__sceneReady = true;
  requestAnimationFrame(frame);
}
