/**
 * Procedural 3D guitar neck (three.js, no third-party model files): fretboard with wood grain,
 * binding, neck back, nut, headstock with tuners, frets, inlays and strings that light up and
 * vibrate when struck. Rendered into its own WebGL OffscreenCanvas and composited into the
 * frame. Everything is derived from (view, skin, theme, timeline, ms): no clocks, no randomness.
 */
import * as THREE from 'three';
import { lastNotePerString, type Timeline } from '../../engine/timeline';
import type { Ctx2D } from '../drawFrame';
import type { View3D } from '../layouts';
import { vibrationAmplitude } from '../neck2d';
import type { NeckRenderer } from '../neck3dRegistry';
import type { Skin, SkinId } from '../skins';
import type { Theme } from '../theme';
import type { NeckModel } from '../view3d';

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const LAST_FRET = 24;
/** Neck back / headstock colour per guitar (the fretboard uses skin.wood). */
const NECK_WOOD: Record<SkinId, string> = {
  strat: '#e7bf82',
  lespaul: '#5b2d16',
  acoustic: '#6e4224',
  classical: '#7b4a26',
  bass4: '#6e4224',
  seven: '#2b2420',
};

/** Deterministic PRNG (mulberry32) for wood grain. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function woodTexture(base: string, grain: string, seed: number): THREE.CanvasTexture {
  const c = new OffscreenCanvas(1024, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  const rnd = prng(seed);
  g.strokeStyle = grain;
  for (let k = 0; k < 70; k++) {
    const y0 = rnd() * c.height;
    g.globalAlpha = 0.15 + rnd() * 0.35;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 16) {
      const y = y0 + 3 * Math.sin(x * 0.006 + k) + 1.5 * Math.sin(x * 0.021 + k * 2.3);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c as unknown as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

type StringMesh = { mesh: THREE.Mesh; base: Float32Array; mat: THREE.MeshStandardMaterial; color: THREE.Color; xs: Float32Array };

type Scene = {
  key: string;
  scene: THREE.Scene;
  strings: StringMesh[];
  light: THREE.DirectionalLight;
  dispose: () => void;
};

/** Map a unit box/cylinder (x in [-0.5, 0.5]) onto the neck between world x0 and x1, tapering y. */
function alongNeck(geo: THREE.BufferGeometry, x0: number, x1: number, yScale: (x: number) => number, z: (zu: number) => number): void {
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const X = x0 + (p.getX(i) + 0.5) * (x1 - x0);
    p.setXYZ(i, X, p.getY(i) * yScale(X), z(p.getZ(i)));
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}

function buildScene(m: NeckModel, skin: Skin, theme: Theme): Scene {
  const scene = new THREE.Scene();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(o: T) => (disposables.push(o), o);
  const W = m.width;
  const xNut = m.x(0);
  const xEnd = m.x(LAST_FRET + 0.6);
  const sign = m.mirror ? -1 : 1;
  const boardT = W * 0.07;

  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x30343c, 1.15));
  const light = new THREE.DirectionalLight(0xffffff, 2.2);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.002;
  scene.add(light, light.target);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.5);
  fill.position.set(sign * 8, -6, 6);
  scene.add(fill);

  // Fretboard (top = wood grain, long sides = binding).
  const wood = keep(woodTexture(skin.wood, skin.woodGrain, skin.id.length * 7919));
  wood.repeat.set(3, 1);
  const top = keep(new THREE.MeshStandardMaterial({ map: wood, roughness: 0.72, metalness: 0, side: THREE.DoubleSide }));
  const side = keep(new THREE.MeshStandardMaterial({ color: skin.binding ?? skin.woodGrain, roughness: 0.5, side: THREE.DoubleSide }));
  const bottom = keep(new THREE.MeshStandardMaterial({ color: '#111111', side: THREE.DoubleSide }));
  const boardGeo = keep(new THREE.BoxGeometry(1, 1, 1, 64, 1, 1));
  alongNeck(boardGeo, xNut, xEnd, (x) => m.widthAt(x), (zu) => (zu + 0.5) * boardT - boardT);
  const board = new THREE.Mesh(boardGeo, [side, side, side, side, top, bottom]);
  board.receiveShadow = true;
  scene.add(board);

  // Neck back: half cylinder under the board.
  const neckMat = keep(new THREE.MeshStandardMaterial({ color: NECK_WOOD[skin.id], roughness: 0.45, side: THREE.DoubleSide }));
  const backGeo = keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 48, true, Math.PI / 2, Math.PI));
  backGeo.rotateZ(-Math.PI / 2); // axis along x; the half shell now points down (-z)
  {
    const p = backGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const X = xNut + (p.getX(i) + 0.5) * (xEnd - xNut);
      const w = m.widthAt(X) * 0.98;
      p.setXYZ(i, X, p.getY(i) * w, -boardT + Math.min(0, p.getZ(i)) * W * 0.75);
    }
    p.needsUpdate = true;
    backGeo.computeVertexNormals();
  }
  scene.add(new THREE.Mesh(backGeo, neckMat));

  // Nut.
  const nutW = W * 0.06;
  const nutGeo = keep(new THREE.BoxGeometry(nutW, m.widthAt(xNut), m.stringZ * 1.25 + boardT * 0.1));
  const nut = new THREE.Mesh(nutGeo, keep(new THREE.MeshStandardMaterial({ color: skin.nut, roughness: 0.35 })));
  nut.position.set(xNut - (sign * nutW) / 2, 0, (m.stringZ * 1.25) / 2 - boardT * 0.05);
  nut.castShadow = true;
  scene.add(nut);

  // Headstock: shaped, tilted back, with tuner posts and the strings running to them.
  buildHeadstock(scene, keep, m, skin, neckMat, { xNut, nutW, boardT, sign });

  // Frets (rounded wire) and inlays.
  const fretMat = keep(new THREE.MeshStandardMaterial({ color: skin.fretWire, metalness: 0.75, roughness: 0.28 }));
  const inlayMat = keep(new THREE.MeshStandardMaterial({ color: skin.inlay, roughness: 0.3, metalness: 0.1 }));
  const fretR = W * 0.012;
  for (let f = 1; f <= LAST_FRET; f++) {
    const x = m.x(f);
    const g = keep(new THREE.CylinderGeometry(fretR, fretR, m.widthAt(x), 10, 1));
    const fret = new THREE.Mesh(g, fretMat);
    fret.position.set(x, 0, 0);
    fret.castShadow = true;
    fret.receiveShadow = true;
    scene.add(fret);
    if (skin.inlayShape === 'none') continue;
    const isDouble = f % 12 === 0;
    if (!isDouble && !INLAYS.includes(f)) continue;
    const xc = (m.x(f - 1) + m.x(f)) / 2;
    const fw = Math.abs(m.x(f) - m.x(f - 1));
    const w = m.widthAt(xc);
    const add = (geo: THREE.BufferGeometry, y: number) => {
      keep(geo);
      const mesh = new THREE.Mesh(geo, inlayMat);
      mesh.position.set(xc, y, 0.0015 * W);
      mesh.receiveShadow = true;
      scene.add(mesh);
    };
    if (skin.inlayShape === 'dot') {
      const r = Math.min(W * 0.06, fw * 0.18);
      if (isDouble) {
        add(new THREE.CircleGeometry(r, 32), w * 0.22);
        add(new THREE.CircleGeometry(r, 32), -w * 0.22);
      } else add(new THREE.CircleGeometry(r, 32), 0);
    } else if (skin.inlayShape === 'block') {
      add(new THREE.PlaneGeometry(fw * 0.44, w * 0.4), 0);
    } else {
      const sh = new THREE.Shape();
      sh.moveTo(-fw * 0.16, w * 0.24);
      sh.lineTo(fw * 0.16, w * 0.24);
      sh.lineTo(fw * 0.22, -w * 0.24);
      sh.lineTo(-fw * 0.22, -w * 0.24);
      sh.closePath();
      add(new THREE.ShapeGeometry(sh), 0);
    }
  }

  // Strings: thin cylinders along x, vertices kept so a struck string can vibrate.
  const strings: StringMesh[] = [];
  const firstWound = skin.firstWound(m.strings);
  for (let s = 0; s < m.strings; s++) {
    const r = Math.max(W * 0.0045, (skin.gauge(s, m.strings) / 6) * W * 0.013);
    const g = keep(new THREE.CylinderGeometry(r, r, 1, 8, 160, true));
    g.rotateZ(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    const xs = new Float32Array(p.count);
    const xStart = xNut - sign * nutW * 0.5;
    for (let i = 0; i < p.count; i++) {
      const X = xStart + (p.getX(i) + 0.5) * (xEnd - xStart);
      xs[i] = X;
      p.setXYZ(i, X, p.getY(i) + m.stringYAt(s, X), p.getZ(i) + m.stringZ);
    }
    p.needsUpdate = true;
    const color = new THREE.Color(s >= firstWound ? skin.wound : skin.plain);
    const mat = keep(new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.32, emissive: new THREE.Color(theme.stringActive), emissiveIntensity: 0 }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    strings.push({ mesh, base: Float32Array.from(p.array as Float32Array), mat, color, xs });
  }

  return {
    key: '',
    scene,
    strings,
    light,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}

const HEAD_FACE: Partial<Record<SkinId, string>> = { lespaul: '#141414', seven: '#141414' };

/** Headstock in its own group: local x runs away from the nut (negative), mirrored via scale. */
function buildHeadstock(
  scene: THREE.Scene,
  keep: <T extends { dispose: () => void }>(o: T) => T,
  m: NeckModel,
  skin: Skin,
  neckMat: THREE.MeshStandardMaterial,
  d: { xNut: number; nutW: number; boardT: number; sign: number },
): void {
  const w = m.widthAt(d.xNut);
  const L = w * 3.6;
  const inline = skin.id === 'strat' || skin.id === 'seven' || skin.id === 'bass4';
  const sh = new THREE.Shape();
  if (inline) {
    // Six-in-line: tuners along the top edge, a rounded bulb at the end.
    sh.moveTo(0, -w / 2);
    sh.quadraticCurveTo(-L * 0.3, -w * 0.5, -L * 0.62, -w * 0.42);
    sh.quadraticCurveTo(-L * 1.02, -w * 0.38, -L, w * 0.2);
    sh.quadraticCurveTo(-L * 0.98, w * 0.85, -L * 0.82, w * 0.86);
    sh.quadraticCurveTo(-L * 0.4, w * 0.82, -L * 0.12, w * 0.55);
    sh.lineTo(0, w / 2);
  } else {
    // Three-a-side paddle with a slightly flared, rounded end.
    sh.moveTo(0, -w / 2);
    sh.quadraticCurveTo(-L * 0.5, -w * 0.82, -L * 0.95, -w * 0.72);
    sh.quadraticCurveTo(-L * 1.05, 0, -L * 0.95, w * 0.72);
    sh.quadraticCurveTo(-L * 0.5, w * 0.82, 0, w / 2);
  }
  sh.closePath();
  const thick = d.boardT * 1.15;
  const geo = keep(new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.15, bevelSize: thick * 0.15, bevelSegments: 2, curveSegments: 24 }));
  geo.translate(0, 0, -thick);
  const face = keep(new THREE.MeshStandardMaterial({ color: HEAD_FACE[skin.id] ?? NECK_WOOD[skin.id], roughness: 0.8, side: THREE.DoubleSide }));
  const head = new THREE.Mesh(geo, [face, neckMat]);
  head.castShadow = true;
  head.receiveShadow = true;

  const group = new THREE.Group();
  group.add(head);
  const chrome = keep(new THREE.MeshStandardMaterial({ color: '#cfd4db', metalness: 0.9, roughness: 0.22 }));
  const postGeo = keep(new THREE.CylinderGeometry(w * 0.035, w * 0.05, thick * 1.8, 14));
  postGeo.rotateX(Math.PI / 2);
  const keyGeo = keep(new THREE.BoxGeometry(w * 0.09, w * 0.2, thick * 0.5));
  const n = m.strings;
  const posts: THREE.Vector3[] = [];
  for (let s = 0; s < n; s++) {
    let px: number, py: number, keyY: number;
    if (inline) {
      px = -L * (0.22 + (0.62 * (n - 1 - s)) / Math.max(1, n - 1));
      py = w * 0.62;
      keyY = w * 0.98;
    } else {
      const side = s < n / 2 ? -1 : 1; // treble strings on the high-e (lower) side, bass on the top side
      const k = side > 0 ? s : n - 1 - s;
      px = -L * (0.3 + 0.24 * k);
      py = side * w * 0.42;
      keyY = side * w * 0.95;
    }
    const post = new THREE.Mesh(postGeo, chrome);
    post.position.set(px, py, thick * 0.5);
    post.castShadow = true;
    const key = new THREE.Mesh(keyGeo, chrome);
    key.position.set(px, keyY, -thick * 0.5);
    group.add(post, key);
    posts.push(new THREE.Vector3(px, py, thick * 1.2));
  }

  const tilt = (13 * Math.PI) / 180;
  group.scale.x = d.sign;
  group.rotation.y = -d.sign * tilt;
  group.position.set(d.xNut - d.sign * d.nutW, 0, -d.boardT * 0.15);
  scene.add(group);
  group.updateMatrixWorld(true);

  // Strings from the nut to their posts.
  const strMat = keep(new THREE.MeshStandardMaterial({ color: skin.plain, metalness: 0.8, roughness: 0.3 }));
  for (let s = 0; s < n; s++) {
    const a = new THREE.Vector3(d.xNut - d.sign * d.nutW * 0.5, m.stringYAt(s, d.xNut), m.stringZ);
    const b = posts[s]!.clone().applyMatrix4(group.matrixWorld);
    const len = a.distanceTo(b);
    const g = keep(new THREE.CylinderGeometry(w * 0.006, w * 0.006, len, 6));
    const mesh = new THREE.Mesh(g, strMat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    scene.add(mesh);
  }
}

export function createNeckRenderer(): NeckRenderer | null {
  let canvas: OffscreenCanvas;
  let renderer: THREE.WebGLRenderer;
  try {
    canvas = new OffscreenCanvas(16, 16);
    renderer = new THREE.WebGLRenderer({ canvas: canvas as unknown as HTMLCanvasElement, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 1000);
  let current: Scene | null = null;

  return {
    draw(ctx: Ctx2D, view: View3D, skin: Skin, theme: Theme, t: Timeline, ms: number) {
      const { model: m, pose, region } = view;
      if (canvas.width !== region.w || canvas.height !== region.h) renderer.setSize(region.w, region.h, false);
      const key = [skin.id, m.strings, m.mirror, m.width.toFixed(5), theme.stringActive].join('|');
      if (current?.key !== key) {
        current?.dispose();
        current = buildScene(m, skin, theme);
        current.key = key;
      }
      const sc = current;

      camera.fov = pose.fovDeg;
      camera.aspect = pose.aspect;
      camera.position.set(...pose.eye);
      camera.up.set(...pose.up);
      camera.lookAt(...pose.target);
      const span = Math.hypot(pose.eye[0] - pose.target[0], pose.eye[1] - pose.target[1], pose.eye[2] - pose.target[2]);
      camera.near = span * 0.05;
      camera.far = span * 10;
      camera.updateProjectionMatrix();

      // Key light from above-left of the window, shadows sized to what is in view.
      const [tx] = pose.target;
      const halfLen = Math.abs(m.x(view.toFret) - m.x(view.fromFret)) / 2 + m.width * 3;
      sc.light.position.set(tx - (m.mirror ? -1 : 1) * halfLen * 0.4, m.width * 3, m.width * 6);
      sc.light.target.position.set(tx, 0, 0);
      const sh = sc.light.shadow.camera;
      sh.left = -halfLen;
      sh.right = halfLen;
      sh.top = m.width * 2;
      sh.bottom = -m.width * 2;
      sh.near = 0.01;
      sh.far = m.width * 20;
      sh.updateProjectionMatrix();

      // Struck strings: glow and vibrate from the fretted point to the bridge.
      const per = lastNotePerString(t, ms);
      sc.strings.forEach((st, s) => {
        const e = per[s] ?? null;
        const amp = e ? vibrationAmplitude(ms - e.startMs, e.durationMs) : 0;
        const p = st.mesh.geometry.attributes.position as THREE.BufferAttribute;
        const arr = p.array as Float32Array;
        arr.set(st.base);
        if (amp > 0 && e) {
          const from = e.fret === 0 ? m.x(0) : m.x(e.fret);
          const to = m.x(LAST_FRET + 0.6);
          const a = (amp / 12) * m.spacingAt(from) * 0.22 * Math.cos(((ms - e.startMs) / 1000) * 2 * Math.PI * 11);
          for (let i = 0; i < p.count; i++) {
            const u = (st.xs[i]! - from) / (to - from);
            if (u > 0 && u < 1) arr[i * 3 + 1]! += a * Math.sin(Math.PI * u);
          }
          st.mat.emissiveIntensity = 1.6;
          st.mat.color.set(theme.stringActive);
        } else {
          st.mat.emissiveIntensity = 0;
          st.mat.color.copy(st.color);
        }
        p.needsUpdate = true;
      });

      renderer.render(sc.scene, camera);
      ctx.drawImage(canvas, region.x, region.y);
    },
  };
}
