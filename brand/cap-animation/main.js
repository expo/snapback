import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import snapbackLogoUrl from "./assets/snapback-logo-dark.png?url";

// The first place to make creative adjustments. Geometry-specific dimensions
// live close to their builders below.
const ART_DIRECTION = {
  background: 0xe9e3d8,
  capColor: 0x090a0a,
  seamColor: 0x171819,
  frontAngle: -0.17,
  rearAngleOffset: 0.08,
  capScale: 1.18,
  camera: { fov: 31, x: 0, y: 1.35, z: 8.25, targetY: 0.92 },
  timing: {
    frontHold: 2.15,
    turn: 3.15,
    rearHold: 0.8,
    morph: 1.45,
    revealHold: 2.35,
    return: 2.15,
  },
};

const TOTAL_DURATION = Object.values(ART_DIRECTION.timing).reduce((sum, value) => sum + value, 0);
const canvas = document.querySelector("#cap-canvas");
const playButton = document.querySelector("#play");
const restartButton = document.querySelector("#restart");
const exportButton = document.querySelector("#export");
const scrubber = document.querySelector("#scrubber");
const loading = document.querySelector("#loading");
const hint = document.querySelector("#hint");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(ART_DIRECTION.background);
scene.fog = new THREE.Fog(ART_DIRECTION.background, 10, 22);

const camera = new THREE.PerspectiveCamera(
  ART_DIRECTION.camera.fov,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(ART_DIRECTION.camera.x, ART_DIRECTION.camera.y, ART_DIRECTION.camera.z);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 11;
controls.minPolarAngle = Math.PI * 0.29;
controls.maxPolarAngle = Math.PI * 0.61;
controls.target.set(0, ART_DIRECTION.camera.targetY, 0.35);
controls.update();

scene.add(new THREE.HemisphereLight(0xfffbf4, 0x25221f, 2.15));

const keyLight = new THREE.DirectionalLight(0xfff6e8, 5.2);
keyLight.position.set(-4.5, 6.2, 5.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -5;
keyLight.shadow.camera.right = 5;
keyLight.shadow.camera.top = 5;
keyLight.shadow.camera.bottom = -3;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 18;
keyLight.shadow.bias = -0.0003;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xcbd7dc, 3.2);
rimLight.position.set(5.2, 3.2, -4.2);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0xffe4c6, 1.6);
fillLight.position.set(3, 1.2, 6);
scene.add(fillLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShadowMaterial({ color: 0x3f372e, opacity: 0.17 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.28, 0.55);
ground.receiveShadow = true;
scene.add(ground);

const clothTexture = makeClothTexture();
clothTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const crownMaterial = new THREE.MeshStandardMaterial({
  color: ART_DIRECTION.capColor,
  roughness: 0.9,
  metalness: 0,
  bumpMap: clothTexture,
  bumpScale: 0.028,
});
const undersideMaterial = new THREE.MeshStandardMaterial({
  color: 0x050606,
  roughness: 0.94,
  bumpMap: clothTexture,
  bumpScale: 0.02,
});
const seamMaterial = new THREE.MeshStandardMaterial({
  color: ART_DIRECTION.seamColor,
  roughness: 0.86,
});

const cap = new THREE.Group();
cap.name = "Expo_Snapback_Cap";
cap.scale.setScalar(ART_DIRECTION.capScale);
cap.position.y = 0.02;
scene.add(cap);

const crown = createCrown();
const brim = createBrim();
const seams = createCrownSeams();
const eyelets = createEyelets();
const frontLockup = createFrontLockup();
const rearIdentity = await createRearIdentity();

cap.add(crown, brim, seams, eyelets, frontLockup, rearIdentity.group);

const button = new THREE.Mesh(new THREE.SphereGeometry(0.13, 28, 16), crownMaterial);
button.name = "Crown_button";
button.scale.y = 0.58;
button.position.set(0, 2.06, 0);
button.castShadow = true;
cap.add(button);

cap.traverse((object) => {
  if (object.isMesh) {
    object.castShadow = true;
    object.receiveShadow = true;
  }
});

let playing = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let playhead = 0;
let lastTime = performance.now();
let scrubbing = false;
let userInspecting = false;

if (!playing) {
  playButton.textContent = "Play";
  playButton.setAttribute("aria-label", "Play animation");
}

renderer.domElement.addEventListener("pointerdown", () => {
  userInspecting = true;
  playing = false;
  setPlayButtonState();
  hint.classList.add("hidden");
});

scrubber.addEventListener("pointerdown", () => {
  scrubbing = true;
});

window.addEventListener("pointerup", () => {
  scrubbing = false;
});

scrubber.addEventListener("input", (event) => {
  playhead = Number(event.target.value) * TOTAL_DURATION;
  playing = false;
  setPlayButtonState();
  updateAnimation(playhead);
});

playButton.addEventListener("click", () => {
  playing = !playing;
  userInspecting = false;
  setPlayButtonState();
});

restartButton.addEventListener("click", () => {
  playhead = 0;
  playing = true;
  userInspecting = false;
  camera.position.set(ART_DIRECTION.camera.x, ART_DIRECTION.camera.y, ART_DIRECTION.camera.z);
  controls.target.set(0, ART_DIRECTION.camera.targetY, 0.35);
  controls.update();
  setPlayButtonState();
  updateAnimation(playhead);
});

exportButton.addEventListener("click", exportCurrentModel);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target === document.body) {
    event.preventDefault();
    playButton.click();
  }
});

window.addEventListener("resize", onResize);

updateAnimation(0);
loading.classList.add("done");
requestAnimationFrame(renderFrame);

function renderFrame(now) {
  const delta = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (playing && !scrubbing) {
    playhead = (playhead + delta) % TOTAL_DURATION;
    updateAnimation(playhead);
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(renderFrame);
}

function updateAnimation(time) {
  const { frontHold, turn, rearHold, morph, revealHold, return: returnDuration } = ART_DIRECTION.timing;
  const turnStart = frontHold;
  const turnEnd = turnStart + turn;
  const morphStart = turnEnd + rearHold;
  const morphEnd = morphStart + morph;
  const revealEnd = morphEnd + revealHold;
  const returnEnd = revealEnd + returnDuration;
  const front = ART_DIRECTION.frontAngle;
  const back = front + Math.PI + ART_DIRECTION.rearAngleOffset;

  let rotation;
  let morphAmount = 0;

  if (time < turnStart) {
    const breathe = Math.sin((time / frontHold) * Math.PI) * 0.018;
    rotation = front + breathe;
  } else if (time < turnEnd) {
    rotation = THREE.MathUtils.lerp(front, back, easeInOutCubic((time - turnStart) / turn));
  } else if (time < morphStart) {
    rotation = back;
  } else if (time < morphEnd) {
    rotation = back;
    morphAmount = easeInOutCubic((time - morphStart) / morph);
  } else if (time < revealEnd) {
    rotation = back;
    morphAmount = 1;
  } else {
    const progress = THREE.MathUtils.clamp((time - revealEnd) / returnDuration, 0, 1);
    rotation = THREE.MathUtils.lerp(back, front + Math.PI * 2, easeInOutCubic(progress));
    morphAmount = 1 - smoothstep(0.02, 0.42, progress);
  }

  if (!userInspecting) {
    cap.rotation.y = rotation;
    cap.rotation.z = -0.015 + Math.sin((time / TOTAL_DURATION) * Math.PI * 2) * 0.008;
  }

  rearIdentity.update(morphAmount);
  scrubber.value = String(time / TOTAL_DURATION);
}

function createCrown() {
  const radialSegments = 144;
  const verticalSegments = 42;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let yIndex = 0; yIndex <= verticalSegments; yIndex += 1) {
    const elevation = yIndex / verticalSegments;
    for (let angleIndex = 0; angleIndex <= radialSegments; angleIndex += 1) {
      const theta = (angleIndex / radialSegments) * Math.PI * 2;
      const point = crownPoint(theta, elevation, 0);
      positions.push(point.x, point.y, point.z);
      uvs.push(angleIndex / radialSegments, elevation * 2.6);
    }
  }

  const stride = radialSegments + 1;
  for (let yIndex = 0; yIndex < verticalSegments; yIndex += 1) {
    for (let angleIndex = 0; angleIndex < radialSegments; angleIndex += 1) {
      const a = yIndex * stride + angleIndex;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      const centerElevation = (yIndex + 0.5) / verticalSegments;
      const centerTheta = ((angleIndex + 0.5) / radialSegments) * Math.PI * 2;
      const centerPoint = crownPoint(centerTheta, centerElevation, 0);

      if (!isRearOpening(centerTheta, centerPoint.y)) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, crownMaterial);
  mesh.name = "Low_profile_six_panel_crown";
  return mesh;
}

function crownPoint(theta, elevation, surfaceOffset = 0) {
  const shapedElevation = Math.pow(Math.sin(elevation * Math.PI * 0.5), 0.88);
  const taper = Math.pow(Math.cos(elevation * Math.PI * 0.5), 0.72);
  const radiusX = 1.5 * taper + 0.025;
  const radiusZ = 1.57 * taper + 0.025;
  const front = Math.max(0, Math.sin(theta));
  const x = (radiusX + surfaceOffset) * Math.cos(theta);
  const z = (radiusZ * (1 - front * 0.035) + surfaceOffset) * Math.sin(theta);
  const y = 0.27 + 1.75 * shapedElevation + 0.025 * Math.cos(theta * 2) * (1 - elevation);
  return new THREE.Vector3(x, y + surfaceOffset * 0.25, z);
}

function isRearOpening(theta, y) {
  const distance = angularDistance(theta, Math.PI * 1.5);
  const halfWidth = 0.62;
  if (distance >= halfWidth) return false;
  const normalized = distance / halfWidth;
  const openingTop = 0.39 + 0.61 * (1 - normalized * normalized);
  return y < openingTop;
}

function createCrownSeams() {
  const group = new THREE.Group();
  group.name = "Tonal_panel_seams";
  const tubeMaterial = seamMaterial;

  for (let seam = 0; seam < 6; seam += 1) {
    const theta = Math.PI * 0.5 + seam * (Math.PI / 3);
    const points = [];
    for (let index = 0; index <= 18; index += 1) {
      const elevation = 0.04 + (index / 18) * 0.91;
      const point = crownPoint(theta, elevation, 0.018);
      if (!isRearOpening(theta, point.y)) points.push(point);
    }
    if (points.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.015, 5, false), tubeMaterial);
    tube.castShadow = true;
    group.add(tube);
  }

  const lowerEdgePoints = [];
  const start = Math.PI * 1.5 + 0.63;
  const end = Math.PI * 1.5 + Math.PI * 2 - 0.63;
  for (let index = 0; index <= 96; index += 1) {
    const theta = start + (index / 96) * (end - start);
    lowerEdgePoints.push(crownPoint(theta, 0.018, 0.022));
  }
  const lowerCurve = new THREE.CatmullRomCurve3(lowerEdgePoints);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(lowerCurve, 128, 0.026, 7, false), tubeMaterial));

  const openingPoints = [];
  for (let index = 0; index <= 48; index += 1) {
    const theta = Math.PI * 1.5 - 0.62 + (index / 48) * 1.24;
    const distance = angularDistance(theta, Math.PI * 1.5);
    const normalized = distance / 0.62;
    const targetY = 0.39 + 0.61 * (1 - normalized * normalized);
    openingPoints.push(pointAtCrownHeight(theta, targetY, 0.022));
  }
  const openingCurve = new THREE.CatmullRomCurve3(openingPoints);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(openingCurve, 72, 0.022, 7, false), tubeMaterial));
  return group;
}

function pointAtCrownHeight(theta, targetY, offset = 0) {
  let low = 0;
  let high = 1;
  for (let index = 0; index < 14; index += 1) {
    const middle = (low + high) / 2;
    if (crownPoint(theta, middle).y < targetY) low = middle;
    else high = middle;
  }
  return crownPoint(theta, (low + high) / 2, offset);
}

function createEyelets() {
  const group = new THREE.Group();
  group.name = "Embroidered_eyelets";
  const geometry = new THREE.TorusGeometry(0.055, 0.016, 8, 24);
  const normalAxis = new THREE.Vector3(0, 0, 1);
  const angles = [Math.PI * 0.5 - Math.PI / 3, Math.PI * 0.5 + Math.PI / 3, Math.PI * 1.5 - Math.PI / 3, Math.PI * 1.5 + Math.PI / 3];

  for (const theta of angles) {
    const point = crownPoint(theta, 0.58, 0.025);
    const normal = new THREE.Vector3(point.x / 1.5, 0.72, point.z / 1.57).normalize();
    const eyelet = new THREE.Mesh(geometry, seamMaterial);
    eyelet.position.copy(point);
    eyelet.quaternion.setFromUnitVectors(normalAxis, normal);
    group.add(eyelet);
  }
  return group;
}

function createBrim() {
  const group = new THREE.Group();
  group.name = "Curved_brim";
  const segmentsLength = 46;
  const segmentsWidth = 64;
  const positions = [];
  const uvs = [];
  const indices = [];
  const layerStride = (segmentsLength + 1) * (segmentsWidth + 1);

  for (let layer = 0; layer < 2; layer += 1) {
    for (let lengthIndex = 0; lengthIndex <= segmentsLength; lengthIndex += 1) {
      const s = lengthIndex / segmentsLength;
      for (let widthIndex = 0; widthIndex <= segmentsWidth; widthIndex += 1) {
        const t = (widthIndex / segmentsWidth) * 2 - 1;
        const point = brimPoint(s, t, layer === 0 ? 0 : -0.075);
        positions.push(point.x, point.y, point.z);
        uvs.push(widthIndex / segmentsWidth * 3.4, s * 5.5);
      }
    }
  }

  const stride = segmentsWidth + 1;
  for (let layer = 0; layer < 2; layer += 1) {
    const offset = layer * layerStride;
    for (let lengthIndex = 0; lengthIndex < segmentsLength; lengthIndex += 1) {
      for (let widthIndex = 0; widthIndex < segmentsWidth; widthIndex += 1) {
        const a = offset + lengthIndex * stride + widthIndex;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        if (layer === 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
  }

  const edgeLoops = [
    Array.from({ length: segmentsLength + 1 }, (_, index) => index * stride),
    Array.from({ length: segmentsLength + 1 }, (_, index) => index * stride + segmentsWidth),
    Array.from({ length: segmentsWidth + 1 }, (_, index) => segmentsLength * stride + index),
  ];
  for (const loop of edgeLoops) {
    for (let index = 0; index < loop.length - 1; index += 1) {
      const a = loop[index];
      const b = loop[index + 1];
      const c = a + layerStride;
      const d = b + layerStride;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const brimMesh = new THREE.Mesh(geometry, crownMaterial);
  brimMesh.castShadow = true;
  brimMesh.receiveShadow = true;
  group.add(brimMesh);

  for (let stitch = 0; stitch < 6; stitch += 1) {
    const s = 0.38 + stitch * 0.095;
    const points = [];
    for (let index = 0; index <= 34; index += 1) {
      const t = -0.94 + (index / 34) * 1.88;
      points.push(brimPoint(s, t, 0.014));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const thread = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 52, 0.008, 4, false),
      new THREE.MeshStandardMaterial({ color: 0x262728, roughness: 0.88 }),
    );
    group.add(thread);
  }

  const edgePoints = [];
  for (let index = 0; index <= 50; index += 1) {
    const t = -1 + (index / 50) * 2;
    edgePoints.push(brimPoint(1, t, -0.025));
  }
  group.add(new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edgePoints), 72, 0.025, 7, false),
    seamMaterial,
  ));
  return group;
}

function brimPoint(s, t, verticalOffset = 0) {
  const width = 1.32 + 0.52 * s - 0.1 * s * s;
  const x = t * width;
  const z = 1.14 + 2.25 * s - 0.08 * t * t * s;
  const edgeLift = 0.2 * Math.pow(Math.abs(t), 1.75) * (0.3 + 0.7 * s);
  const y = 0.3 - 0.09 * s - 0.19 * s * s + edgeLift + verticalOffset;
  return new THREE.Vector3(x, y, z);
}

function createFrontLockup() {
  const texture = makeExpoLockupTexture();
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.12,
    roughness: 0.66,
    metalness: 0,
    emissive: 0xffffff,
    emissiveIntensity: 0.16,
    side: THREE.DoubleSide,
  });
  const geometry = createCurvedFrontPlane(2.18, 0.54, 1.2, 64, 8);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "White_embroidered_Expo_lockup";
  return mesh;
}

function createCurvedFrontPlane(width, height, centerY, horizontalSegments, verticalSegments) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let yIndex = 0; yIndex <= verticalSegments; yIndex += 1) {
    const v = yIndex / verticalSegments;
    const y = centerY + (v - 0.5) * height;
    for (let xIndex = 0; xIndex <= horizontalSegments; xIndex += 1) {
      const u = xIndex / horizontalSegments;
      const x = (u - 0.5) * width;
      const elevation = elevationForHeight(y);
      const taper = Math.pow(Math.cos(elevation * Math.PI * 0.5), 0.72);
      const radiusX = 1.5 * taper + 0.025;
      const radiusZ = 1.57 * taper + 0.025;
      const normalizedX = THREE.MathUtils.clamp(x / radiusX, -0.99, 0.99);
      const z = radiusZ * Math.sqrt(1 - normalizedX * normalizedX) + 0.026;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }
  const stride = horizontalSegments + 1;
  for (let yIndex = 0; yIndex < verticalSegments; yIndex += 1) {
    for (let xIndex = 0; xIndex < horizontalSegments; xIndex += 1) {
      const a = yIndex * stride + xIndex;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function elevationForHeight(y) {
  const normalized = THREE.MathUtils.clamp((y - 0.27) / 1.75, 0, 1);
  return (Math.asin(Math.pow(normalized, 1 / 0.88)) / (Math.PI * 0.5));
}

async function createRearIdentity() {
  const group = new THREE.Group();
  group.name = "Adjustable_snaps_to_Snapback_identity";

  const snapMaterial = new THREE.MeshStandardMaterial({ color: 0x111213, roughness: 0.58, metalness: 0.06 });
  const straps = [];
  const strapSpecs = [
    { width: 1.76, height: 0.31, startX: -0.56, endX: -0.38, endWidth: 1.35 },
    { width: 1.34, height: 0.31, startX: 0.68, endX: 0.83, endWidth: 0.82 },
  ];

  for (const spec of strapSpecs) {
    const geometry = new THREE.ShapeGeometry(roundedRectShape(spec.width, spec.height, 0.145, 20));
    const material = snapMaterial.clone();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = Math.PI;
    mesh.position.set(spec.startX, 0.48, -1.585);
    mesh.userData = {
      startX: spec.startX,
      endX: spec.endX,
      startScaleX: 1,
      endScaleX: spec.endWidth / spec.width,
    };
    group.add(mesh);
    straps.push(mesh);
  }

  const snapDots = [];
  const dotStartX = [-0.76, -0.42, -0.08, 0.26, 0.6];
  const dotEnd = [
    { x: -0.64, type: "ring" },
    { x: -0.22, type: "ring" },
    { x: 0.83, type: "solid" },
    { x: 0.83, type: "hidden" },
    { x: 0.83, type: "hidden" },
  ];

  dotStartX.forEach((startX, index) => {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.018, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.48, metalness: 0.15, transparent: true }),
    );
    torus.rotation.y = Math.PI;
    torus.position.set(startX, 0.48, -1.612);
    torus.userData = { startX, endX: dotEnd[index].x, type: dotEnd[index].type };
    group.add(torus);
    snapDots.push(torus);
  });

  const canonicalTexture = await loadTexture(snapbackLogoUrl);
  canonicalTexture.colorSpace = THREE.SRGBColorSpace;
  canonicalTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const canonicalMaterial = new THREE.MeshBasicMaterial({
    map: canonicalTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const canonical = new THREE.Mesh(new THREE.PlaneGeometry(2.62, 1.53), canonicalMaterial);
  canonical.name = "Canonical_Snapback_lockup";
  canonical.rotation.y = Math.PI;
  canonical.position.set(0, 0.82, -1.638);
  canonical.renderOrder = 4;
  group.add(canonical);

  function update(amount) {
    const physicalMorph = smoothstep(0, 0.7, amount);
    const exactReveal = smoothstep(0.68, 1, amount);
    const physicalOpacity = 1 - smoothstep(0.82, 1, amount);

    straps.forEach((strap) => {
      strap.position.x = THREE.MathUtils.lerp(strap.userData.startX, strap.userData.endX, physicalMorph);
      strap.scale.x = THREE.MathUtils.lerp(strap.userData.startScaleX, strap.userData.endScaleX, physicalMorph);
      strap.scale.y = THREE.MathUtils.lerp(1, 1.18, physicalMorph);
      strap.material.color.lerpColors(new THREE.Color(0x111213), new THREE.Color(0xffffff), physicalMorph);
      strap.material.transparent = true;
      strap.material.opacity = physicalOpacity;
    });

    snapDots.forEach((dot) => {
      const { type, startX, endX } = dot.userData;
      dot.position.x = THREE.MathUtils.lerp(startX, endX, physicalMorph);
      dot.material.color.lerpColors(new THREE.Color(0x242627), new THREE.Color(0x0b0c0c), physicalMorph);
      const targetScale = type === "hidden" ? 0.01 : type === "solid" ? 1.45 : 1.25;
      dot.scale.setScalar(THREE.MathUtils.lerp(1, targetScale, physicalMorph));
      dot.material.opacity = physicalOpacity * (type === "hidden" ? 1 - physicalMorph : 1);
    });

    canonicalMaterial.opacity = exactReveal;
  }

  return { group, update };
}

function roundedRectShape(width, height, radius, segments = 12) {
  const shape = new THREE.Shape();
  const left = -width / 2;
  const right = width / 2;
  const bottom = -height / 2;
  const top = height / 2;
  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.absarc(right - radius, bottom + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(right, top - radius);
  shape.absarc(right - radius, top - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(left + radius, top);
  shape.absarc(left + radius, top - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(left, bottom + radius);
  shape.absarc(left + radius, bottom + radius, radius, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}

function makeExpoLockupTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 1536;
  textureCanvas.height = 384;
  const context = textureCanvas.getContext("2d");
  context.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
  context.strokeStyle = "#ffffff";
  context.fillStyle = "#ffffff";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 42;
  context.beginPath();
  context.moveTo(90, 244);
  context.lineTo(170, 116);
  context.lineTo(250, 244);
  context.stroke();
  context.font = "700 224px Inter, Arial, sans-serif";
  context.textBaseline = "middle";
  context.fillText("Expo", 318, 188);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeClothTexture() {
  const size = 192;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  const image = context.createImageData(size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const noise = 95 + Math.floor(Math.random() * 45);
    image.data[index] = noise;
    image.data[index + 1] = noise;
    image.data[index + 2] = noise;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  context.globalAlpha = 0.2;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 1;
  for (let offset = -size; offset < size * 2; offset += 6) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset - size, size);
    context.stroke();
  }
  context.globalAlpha = 0.11;
  context.strokeStyle = "#000000";
  for (let offset = -size; offset < size * 2; offset += 7) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + size, size);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);
  return texture;
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
}

function angularDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function easeInOutCubic(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function setPlayButtonState() {
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-label", playing ? "Pause animation" : "Play animation");
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function exportCurrentModel() {
  const exporter = new GLTFExporter();
  const previousText = exportButton.textContent;
  exportButton.textContent = "Exporting…";
  exporter.parse(
    cap,
    (result) => {
      const blob = new Blob([result], { type: "model/gltf-binary" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "expo-snapback-cap.glb";
      link.click();
      URL.revokeObjectURL(url);
      exportButton.textContent = previousText;
    },
    (error) => {
      console.error(error);
      exportButton.textContent = "Export failed";
      window.setTimeout(() => { exportButton.textContent = previousText; }, 1400);
    },
    { binary: true, onlyVisible: false },
  );
}
