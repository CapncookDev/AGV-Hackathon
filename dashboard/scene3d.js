// 3D "island" view of the neighbourhood: a cut-out block of ground with see-through surface,
// BGT roads / paths / green / water on top, 3DBAG buildings, trees, and the sewer pipes underneath.
// Depth below ground is exaggerated so the pipes are readable; heights above ground are true.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const DEPTH_EXAG = 6;   // metres below ground drawn 6× deeper
const PIPE_VIS = 5;            // pipes drawn 5× thicker
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let S = null;

export async function initScene(container, { onPick, onStation, diameters }) {
  if (S) { S.resize(); return S; }
  const data = await (await fetch('data/scene.json', { cache: 'no-cache' })).json();
  const [bx0, by0, bx1, by1] = data.bounds;
  const W = bx1 - bx0, D = by1 - by0;
  const strataData = data.strata || [];
  const bottom = strataData.length ? Math.min(...strataData.map(r => r[4])) * DEPTH_EXAG : data.min_z * DEPTH_EXAG - 8;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b2a6, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-W * 0.4, W * 0.8, D * 0.3);
  scene.add(sun);

  const toXZ = ([x, y]) => new THREE.Vector2(x, y); // shape coords; rotateX(-90°) maps y → -z

  // ground block: see-through top, soil sides
  const soil = new THREE.MeshLambertMaterial({ color: 0xc9c1b3 });
  const soilDark = new THREE.MeshLambertMaterial({ color: 0xa79f92 });
  const top = new THREE.MeshLambertMaterial({ color: 0xdedbd4, transparent: true, opacity: 0.3, depthWrite: false });
  // with GeoTOP strata the soil layers form the sides; the block keeps only its see-through top
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const sides = strataData.length ? [hidden, hidden, top, hidden, hidden, hidden] : [soil, soil, top, soilDark, soil, soil];
  const block = new THREE.Mesh(new THREE.BoxGeometry(W, -bottom, D), sides);
  block.position.set((bx0 + bx1) / 2, bottom / 2, -(by0 + by1) / 2);
  block.renderOrder = 2;
  scene.add(block);

  // GeoTOP soil layers (TNO): peat, clay and sand as solid layers under the network;
  // made ground (the fill the pipes lie in) only along the edges and see-through, so the pipes stay visible
  const SOIL_COL = { 0: 0xd9d3c7, 1: 0x6b4a2b, 2: 0x7f8f6c, 3: 0xa39d72, 5: 0xe0c779, 6: 0xd8b65a, 7: 0xcfa64a, 8: 0xa39f97, 9: 0xefe9dc };
  const soilMeshes = [];
  const addStrata = (rows, material) => {
    if (!rows.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, rows.length);
    const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3();
    rows.forEach(([x0, y0, x1, y1, zb, zt, code], i) => {
      const top_ = Math.min(zt, 0) * DEPTH_EXAG, bot = zb * DEPTH_EXAG;
      mm.compose(pp.set((x0 + x1) / 2, (top_ + bot) / 2, -(y0 + y1) / 2), qq.identity(), ss.set(x1 - x0, Math.max(0.01, top_ - bot), y1 - y0));
      mesh.setMatrixAt(i, mm);
      mesh.setColorAt(i, new THREE.Color(SOIL_COL[code] ?? 0xcccccc));
    });
    scene.add(mesh); soilMeshes.push(mesh);
  };
  addStrata(strataData.filter(r => r[6] !== 0 && Math.min(r[5], 0) > r[4]), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  addStrata(strataData.filter(r => r[6] === 0 && r[7] && Math.min(r[5], 0) > r[4]),
    new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));

  // surface layers
  const flat = (rings, y) => {
    const geoms = rings.filter(r => r.length >= 3).map(r => {
      const g = new THREE.ShapeGeometry(new THREE.Shape(r.map(toXZ)));
      g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
      return g;
    });
    return geoms.length ? mergeGeometries(geoms) : null;
  };
  const surfMat = (color, opacity) => new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const surfaces = [];
  for (const [key, color, opacity, y] of [['green', 0x9cc48a, 0.55, 0.05], ['path', 0xcfcac1, 0.5, 0.06], ['road', 0x8e959b, 0.55, 0.07], ['water', 0x4aa3df, 0.75, 0.08]]) {
    const g = flat(data.surface[key] || [], y);
    if (!g) continue;
    const m = new THREE.Mesh(g, surfMat(color, opacity));
    m.userData.opacity = opacity;
    m.material.opacity = opacity * 0.45;
    m.renderOrder = 3;
    scene.add(m); surfaces.push(m);
  }

  // buildings
  const bGeoms = data.buildings.map(b => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(b.r.map(toXZ)), { depth: Math.max(3, b.h), bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  });
  const buildings = new THREE.Mesh(mergeGeometries(bGeoms), new THREE.MeshLambertMaterial({ color: 0xf4f2ee }));
  scene.add(buildings);

  // trees: canopy spheres
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  const treeMesh = new THREE.InstancedMesh(sphere, new THREE.MeshLambertMaterial({ color: 0xffffff }), data.trees.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  data.trees.forEach(([x, y, h, prot], i) => {
    const r = Math.max(1.5, h * 0.28);
    m4.compose(v.set(x, h * 0.65, -y), q.identity(), s.set(r, r * 0.9, r));
    treeMesh.setMatrixAt(i, m4);
    treeMesh.setColorAt(i, new THREE.Color(prot ? 0x2e6b3a : 0x6fa760));
  });
  scene.add(treeMesh);

  // manholes: thin grey shafts from ground to pipe bottom
  const shaft = new THREE.CylinderGeometry(1, 1, 1, 8);
  const mh = new THREE.InstancedMesh(shaft, new THREE.MeshLambertMaterial({ color: 0x9aa1a6, transparent: true, opacity: 0.6 }), data.manholes.length);
  data.manholes.forEach(([x, y, g, b], i) => {
    const y0 = g * DEPTH_EXAG, y1 = b * DEPTH_EXAG - 1;
    m4.compose(v.set(x, (y0 + y1) / 2, -y), q.identity(), s.set(0.7, Math.max(0.5, y0 - y1), 0.7));
    mh.setMatrixAt(i, m4);
  });
  scene.add(mh);

  // pipes: one instanced cylinder per segment
  const segs = [];
  for (const [id, pts] of Object.entries(data.pipes)) {
    const r = ((diameters[id] || 300) / 2000) * PIPE_VIS;
    for (let i = 0; i < pts.length - 1; i++) segs.push([id, pts[i], pts[i + 1], r]);
  }
  const pipeMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222, transparent: true, opacity: 1 }), segs.length);
  const up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b2 = new THREE.Vector3(), dir = new THREE.Vector3();
  const segOf = [], segsById = {};
  segs.forEach(([id, p0, p1, r], i) => {
    a.set(p0[0], p0[2] * DEPTH_EXAG, -p0[1]); b2.set(p1[0], p1[2] * DEPTH_EXAG, -p1[1]);
    dir.subVectors(b2, a); const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    m4.compose(v.addVectors(a, b2).multiplyScalar(0.5), q, s.set(r, len, r));
    pipeMesh.setMatrixAt(i, m4);
    pipeMesh.setColorAt(i, new THREE.Color(0x888888));
    segOf[i] = id; (segsById[id] ||= []).push(i);
  });
  pipeMesh.renderOrder = 10;
  pipeMesh.material.depthTest = false; // X-ray: pipes stay visible through the ground while see-through is on
  scene.add(pipeMesh);

  // pumping station marker
  let station = null;
  if (data.station) {
    station = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 10), new THREE.MeshLambertMaterial({ color: new THREE.Color(css('--accent') || '#0b6bcb') }));
    station.position.set(data.station[0], 4, -data.station[1]);
    scene.add(station);
  }

  // camera: three-quarter view of the island
  const R = Math.max(W, D);
  camera.position.set(-R * 0.8, R * 0.42, R * 1.05); // low enough to see the soil layers on the sides
  controls.target.set(0, bottom * 0.3, 0);
  controls.update();

  // picking (pipes, then station), with a few pixels of tolerance
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // was a drag
    const rect = renderer.domElement.getBoundingClientRect();
    for (const rr of [0, 3, 6, 9]) {
      for (let k = 0; k < (rr ? 8 : 1); k++) {
        mouse.set(((e.clientX + rr * Math.cos(k * Math.PI / 4) - rect.left) / rect.width) * 2 - 1,
          -((e.clientY + rr * Math.sin(k * Math.PI / 4) - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(mouse, camera);
        if (station && ray.intersectObject(station)[0]) { onStation(); return; }
        const hit = ray.intersectObject(pipeMesh)[0];
        if (hit) { onPick(segOf[hit.instanceId]); return; }
      }
    }
  });

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  let colours = {}, selected = null;
  const paint = () => {
    const c = new THREE.Color();
    for (const [id, idxs] of Object.entries(segsById)) {
      c.set(id === selected ? 0x1a73e8 : (colours[id] || '#888888'));
      idxs.forEach(i => pipeMesh.setColorAt(i, c));
    }
    pipeMesh.instanceColor.needsUpdate = true;
  };
  S = {
    resize,
    recolor(map) { colours = map; paint(); },
    select(id) { selected = id; paint(); },
    setGround(seeThrough) {
      top.opacity = seeThrough ? 0.3 : 0.97;
      pipeMesh.material.depthTest = !seeThrough; pipeMesh.material.needsUpdate = true;
      surfaces.forEach(m => { m.material.opacity = m.userData.opacity * (seeThrough ? 0.45 : 1); });
    },
    show(layer, on) {
      if (layer === 'soil') { soilMeshes.forEach(m => { m.visible = on; }); return; }
      ({ buildings, trees: treeMesh, manholes: mh })[layer].visible = on;
    },
    // hide pipes whose id fails the filter (zero-scale instances are not drawn and not pickable)
    filter(keep) {
      if (!S._orig) S._orig = Array.from({ length: segs.length }, (_, i) => { const m = new THREE.Matrix4(); pipeMesh.getMatrixAt(i, m); return m; });
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      segOf.forEach((id, i) => pipeMesh.setMatrixAt(i, keep(id) ? S._orig[i] : zero));
      pipeMesh.instanceMatrix.needsUpdate = true;
      pipeMesh.computeBoundingSphere();
    },
  };
  resize();
  return S;
}
