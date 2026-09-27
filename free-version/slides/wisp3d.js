// The Wisp 3D icon from wispformac.com (glossy squircle plate, tube brackets, crystal star),
// ported so every frame is a pure function of time: render(t) draws the scene at t seconds.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const outBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const outElastic = (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1);

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function radial(stops, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d"), grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function ringTex() {
  const s = 256, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(200,180,255,1)"; g.lineWidth = 5; g.shadowColor = "rgba(173,145,255,1)"; g.shadowBlur = 18;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 24, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function squircle(half, n = 5, steps = 180) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    pts.push(new THREE.Vector2(half * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), half * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)));
  }
  return new THREE.Shape(pts);
}
function crystal(R, waist, depth) {
  const ring = [];
  for (let i = 0; i < 8; i++) { const a = Math.PI / 2 - (i * Math.PI) / 4, r = i % 2 ? waist : R; ring.push([Math.cos(a) * r, Math.sin(a) * r, 0]); }
  const F = [0, 0, depth], B = [0, 0, -depth], pos = [];
  for (let i = 0; i < 8; i++) { const a = ring[i], b = ring[(i + 1) % 8]; pos.push(...b, ...a, ...F, ...a, ...b, ...B); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function bracket(S, L, rc, rad, mat) {
  const A = new THREE.Vector3(S - L, S, 0), B1 = new THREE.Vector3(S - rc, S, 0), C = new THREE.Vector3(S, S, 0), B2 = new THREE.Vector3(S, S - rc, 0), D = new THREE.Vector3(S, S - L, 0);
  const path = new THREE.CurvePath();
  path.add(new THREE.LineCurve3(A, B1)); path.add(new THREE.QuadraticBezierCurve3(B1, C, B2)); path.add(new THREE.LineCurve3(B2, D));
  const g = new THREE.Group(), cap = new THREE.SphereGeometry(rad, 24, 16);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(path, 64, rad, 20, false), mat));
  const c1 = new THREE.Mesh(cap, mat); c1.position.copy(A);
  const c2 = new THREE.Mesh(cap, mat); c2.position.copy(D);
  g.add(c1, c2);
  return g;
}

// opts: fit (world units visible vertically), speed (intro speed-up), particles, seed
export function createWisp(canvas, opts = {}) {
  const speed = opts.speed ?? 1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const root = new THREE.Group(), icon = new THREE.Group();
  scene.add(root); root.add(icon);

  const half = 3.3, depth = 0.34, bev = 0.16;
  const plateGeo = new THREE.ExtrudeGeometry(squircle(half), { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: 0.14, bevelSegments: 8, curveSegments: 12 });
  plateGeo.translate(0, 0, -(depth + bev) - 0.04);
  const pos = plateGeo.attributes.position, cols = [], cA = new THREE.Color("#4a3d73"), cB = new THREE.Color("#141120"), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const t = clamp(((pos.getX(i) - pos.getY(i)) / half) * 0.25 + 0.5); tmp.copy(cA).lerp(cB, t); cols.push(tmp.r, tmp.g, tmp.b); }
  plateGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  icon.add(new THREE.Mesh(plateGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.75 })));

  const bMat = new THREE.MeshPhysicalMaterial({ color: "#bba6ff", metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, emissive: "#6b4bff", emissiveIntensity: 0.5 });
  const brackets = [];
  for (let k = 0; k < 4; k++) {
    const b = new THREE.Group(); b.add(bracket(1.9, 1.02, 0.24, 0.1, bMat)); b.rotation.z = (k * Math.PI) / 2;
    const holder = new THREE.Group(); holder.add(b);
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    holder.userData = { dx: Math.cos(a), dy: Math.sin(a) };
    icon.add(holder); brackets.push(holder);
  }
  const starMat = new THREE.MeshPhysicalMaterial({ color: "#e0d6ff", metalness: 0.12, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 1, iridescenceIOR: 1.7,
    iridescenceThicknessRange: [120, 620], emissive: "#7b5cff", emissiveIntensity: 0.32, flatShading: true, envMapIntensity: 1.7 });
  const star = new THREE.Mesh(crystal(1.28, 0.4, 0.5), starMat);
  star.position.z = 0.3; icon.add(star);
  const glowIn = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial([[0, "rgba(190,165,255,.9)"], [0.3, "rgba(140,110,255,.35)"], [1, "rgba(123,92,255,0)"]]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 }));
  glowIn.scale.setScalar(4.4); glowIn.position.z = 0.02; icon.add(glowIn);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial([[0, "rgba(123,92,255,.55)"], [0.45, "rgba(123,92,255,.16)"], [1, "rgba(123,92,255,0)"]]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
  halo.scale.setScalar(15); halo.position.z = -1.6; root.add(halo);
  const shock = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  shock.position.z = 0.5; icon.add(shock);

  const r = rng(opts.seed ?? 7);
  const PN = opts.particles ?? 260;
  const pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(PN * 3), base = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pSpd = new Float32Array(PN), pPh = new Float32Array(PN);
  const palette = ["#ad91ff", "#ffffff", "#7b5cff", "#d6c9ff"].map((c) => new THREE.Color(c));
  for (let i = 0; i < PN; i++) {
    const rad = 4.2 + r() * 5.5, th = r() * Math.PI * 2;
    base.set([Math.cos(th) * rad, (r() - 0.5) * 11, Math.sin(th) * rad - 2.5], i * 3);
    const c = palette[i % 4]; pCol.set([c.r, c.g, c.b], i * 3);
    pSpd[i] = 0.18 + r() * 0.5; pPh[i] = r() * 6.28;
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.12, map: radial([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,.5)"], [1, "rgba(255,255,255,0)"]], 64),
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.95 }));
  scene.add(points);

  scene.add(new THREE.AmbientLight("#8a74ff", 0.35));
  const key = new THREE.PointLight("#b9a2ff", 55, 40, 2); key.position.set(4.5, 3.5, 7); scene.add(key);
  const rim = new THREE.DirectionalLight("#ffffff", 1.6); rim.position.set(-6, 7, -2); scene.add(rim);
  const fill = new THREE.PointLight("#ff8fd8", 22, 30, 2); fill.position.set(-5, -4, 5); scene.add(fill);

  const fit = opts.fit ?? 12.5;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const dist = fit / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect);
  camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();

  const starDone = (0.9 + 1.4) / speed; // when the star has fully popped (slide seconds)

  function render(t) {
    const it = t * speed;
    // intro: the plate spins in, the brackets snap shut around the star, the star pops
    icon.rotation.y = (1 - outCubic(clamp(it / 1.7))) * -Math.PI * 0.95;
    icon.scale.setScalar(0.55 + 0.45 * outCubic(clamp(it / 1.3)));
    const since = t - starDone * 0.55; // shockwave + glow pulse as the star lands
    const pulse = since > 0 && since < 0.4 ? Math.sin((since / 0.4) * Math.PI) : 0;
    brackets.forEach((b, k) => {
      const e = outBack(clamp((it - 0.45 - k * 0.09) / 0.95));
      const off = (1 - e) * 2.4 + pulse * 0.2;
      b.position.set(b.userData.dx * off, b.userData.dy * off, 0);
    });
    star.scale.setScalar(Math.max(0.001, outElastic(clamp((it - 0.9) / 1.4))));
    star.rotation.y = t * 1.1; star.rotation.z = Math.sin(t * 0.6) * 0.08;
    starMat.emissiveIntensity = 0.32 + pulse * 0.6;
    const sp = since > 0 ? since / 0.9 : -1;
    shock.material.opacity = sp >= 0 && sp < 1 ? (1 - sp) * 0.6 : 0;
    shock.scale.setScalar(3.2 + Math.max(0, sp) * 12);
    glowIn.material.opacity = 0.62 + Math.sin(t * 2.1) * 0.12 + pulse * 0.25;
    // idle float
    root.rotation.y = Math.sin(t * 1.1) * 0.28;
    root.rotation.x = Math.sin(t * 0.8) * 0.1;
    root.position.y = Math.sin(t * 1.6) * 0.12;
    for (let i = 0; i < PN; i++) {
      const y0 = base[i * 3 + 1], ph = pPh[i];
      pPos[i * 3] = base[i * 3] + 0.1 * (Math.cos(ph) - Math.cos(t * 0.6 + ph));
      pPos[i * 3 + 1] = ((((y0 + 5.5 + pSpd[i] * t) % 11) + 11) % 11) - 5.5;
      pPos[i * 3 + 2] = base[i * 3 + 2];
    }
    pGeo.attributes.position.needsUpdate = true;
    points.rotation.y = t * 0.12;
    renderer.render(scene, camera);
  }
  return { render };
}
