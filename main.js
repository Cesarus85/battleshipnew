// Minimaler AR-Bootstrap mit Hit-Test-Reticle & Board-Platzierung
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

const canvas = document.getElementById("xr-canvas");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnPlace = document.getElementById("btnPlace");
const btnReset = document.getElementById("btnReset");

let renderer, scene, camera;
let xrSession = null;
let localRefSpace = null;
let viewerSpace = null;
let hitTestSource = null;
let reticle = null;
let lastHitPose = null;

let boardGroup = null; // wird nach Platzierung gesetzt
const BOARD_SIZE_M = 0.50; // 50 cm
const BOARD_CELLS = 10;

initGL();
wireUI();

function initGL() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.xr.enabled = true;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 20);
  scene.add(camera);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x222244, 0.8);
  scene.add(ambient);

  // Reticle: dezenter Ring (erscheint auf erkannten Flächen)
  const ringGeo = new THREE.RingGeometry(0.07, 0.075, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x7bdcff, transparent: true, opacity: 0.9 });
  reticle = new THREE.Mesh(ringGeo, ringMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  window.addEventListener("resize", onResize);
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function wireUI() {
  btnStart.addEventListener("click", startAR);
  btnPlace.addEventListener("click", placeBoard);
  btnReset.addEventListener("click", resetBoard);
}

async function startAR() {
  if (!navigator.xr) {
    statusEl.textContent = "WebXR nicht verfügbar. Bitte Quest-Browser nutzen.";
    return;
  }
  try {
    const sessionInit = {
      requiredFeatures: ["hit-test", "dom-overlay"],
      optionalFeatures: ["anchors", "hand-tracking"],
      domOverlay: { root: overlay }
    };
    xrSession = await navigator.xr.requestSession("immersive-ar", sessionInit);
    renderer.xr.setReferenceSpaceType("local");
    await renderer.xr.setSession(xrSession);

    xrSession.addEventListener("end", onSessionEnd);

    // Reference Spaces & Hit-Test
    localRefSpace = await xrSession.requestReferenceSpace("local");
    viewerSpace = await xrSession.requestReferenceSpace("viewer");
    hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });

    statusEl.textContent = "Bewege dich, bis das Reticle stabil erscheint. Dann „Hier platzieren“.";
    btnPlace.disabled = true;
    btnReset.disabled = true;
    btnStart.disabled = true;

    renderer.setAnimationLoop(onXRFrame);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "AR-Start fehlgeschlagen. HTTPS/Quest-Browser verwenden?";
  }
}

function onSessionEnd() {
  renderer.setAnimationLoop(null);
  xrSession = null;
  hitTestSource = null;
  lastHitPose = null;
  reticle.visible = false;
  btnStart.disabled = false;
  btnPlace.disabled = true;
  btnReset.disabled = boardGroup ? false : true;
  statusEl.textContent = "Session beendet.";
}

function onXRFrame(time, frame) {
  if (!frame) return;

  const refSpace = localRefSpace;
  const results = hitTestSource ? frame.getHitTestResults(hitTestSource) : [];

  if (results.length > 0 && !boardGroup) {
    const pose = results[0].getPose(refSpace);
    lastHitPose = pose && pose.transform;
    if (lastHitPose) {
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
      reticle.visible = true;
      reticle.matrix.copy(m);
      btnPlace.disabled = false;
    }
  } else {
    if (!boardGroup) {
      reticle.visible = false;
      btnPlace.disabled = true;
    }
  }

  renderer.render(scene, camera);
}

function placeBoard() {
  if (!lastHitPose || boardGroup) return;

  // Board-Gruppe erstellen (Grid + dünne Platte)
  boardGroup = new THREE.Group();
  const poseM = new THREE.Matrix4().fromArray(matrixFromTransform(lastHitPose));
  boardGroup.matrix.copy(poseM);
  boardGroup.matrixAutoUpdate = false;

  // Dünne halbtransparente Base
  const baseGeo = new THREE.PlaneGeometry(BOARD_SIZE_M, BOARD_SIZE_M);
  baseGeo.rotateX(-Math.PI / 2);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x0d1b2a, metalness: 0.0, roughness: 1.0, transparent: true, opacity: 0.7
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.receiveShadow = false;
  boardGroup.add(base);

  // Grid-Linien (10×10)
  const lines = makeGridLines(BOARD_SIZE_M, BOARD_CELLS);
  lines.position.y += 0.001; // Z-Fighting vermeiden
  boardGroup.add(lines);

  scene.add(boardGroup);

  // UI & Reticle
  reticle.visible = false;
  btnPlace.disabled = true;
  btnReset.disabled = false;
  statusEl.textContent = "Brett gesetzt. Nächster Schritt: Zell-Picking & Schiffe-Editor.";
}

function resetBoard() {
  if (boardGroup) {
    scene.remove(boardGroup);
    boardGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
    boardGroup = null;
    statusEl.textContent = "Brett entfernt. Bewege dich, bis das Reticle wieder erscheint.";
    btnReset.disabled = true;
  }
}

function makeGridLines(size, cells) {
  const half = size / 2;
  const step = size / cells;
  const points = [];

  // Senkrechte Linien
  for (let i = 0; i <= cells; i++) {
    const x = -half + i * step;
    points.push(new THREE.Vector3(x, 0, -half));
    points.push(new THREE.Vector3(x, 0,  half));
  }
  // Waagerechte Linien
  for (let j = 0; j <= cells; j++) {
    const z = -half + j * step;
    points.push(new THREE.Vector3(-half, 0, z));
    points.push(new THREE.Vector3( half, 0, z));
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0x7bdcff, transparent: true, opacity: 0.9 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.rotation.x = -Math.PI / 2; // liegt auf dem Boden
  return lines;
}

function matrixFromTransform(t) {
  // t: XRRigidTransform (position, orientation, matrix)
  return t.matrix ? t.matrix : new XRRigidTransform(t.position, t.orientation).matrix;
}