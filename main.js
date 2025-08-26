// AR-Bootstrap + Brett-Platzierung + Zell-Picking (Schritt 2)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import { Board } from "./board.js";
import { Picker } from "./picking.js";

const canvas = document.getElementById("xr-canvas");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnPlace = document.getElementById("btnPlace");
const btnReset = document.getElementById("btnReset");
const hoverCellEl = document.getElementById("hoverCell");
const lastPickEl = document.getElementById("lastPick");

let renderer, scene, camera;
let xrSession = null;
let localRefSpace = null;
let viewerSpace = null;
let hitTestSource = null;
let reticle = null;
let lastHitPose = null;

let board = null;
let picker = null;

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

  // Reticle
  const ringGeo = new THREE.RingGeometry(0.07, 0.075, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x7bdcff, transparent: true, opacity: 0.9 });
  reticle = new THREE.Mesh(ringGeo, ringMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Picker
  picker = new Picker(scene);

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
    xrSession.addEventListener("select", onSelect); // Trigger zum Markieren

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
  xrSession?.removeEventListener("select", onSelect);
  xrSession = null;
  hitTestSource = null;
  lastHitPose = null;
  reticle.visible = false;
  btnStart.disabled = false;
  btnPlace.disabled = true;
  btnReset.disabled = !!board;
  statusEl.textContent = "Session beendet.";
}

function onXRFrame(time, frame) {
  if (!frame) return;

  // Hit-Test solange kein Board gesetzt ist
  if (!board) {
    const results = hitTestSource ? frame.getHitTestResults(hitTestSource) : [];
    if (results.length > 0) {
      const pose = results[0].getPose(localRefSpace);
      lastHitPose = pose && pose.transform;
      if (lastHitPose) {
        const m = new THREE.Matrix4().fromArray(lastHitPose.matrix ?? matrixFromTransform(lastHitPose));
        reticle.visible = true;
        reticle.matrix.copy(m);
        btnPlace.disabled = false;
      }
    } else {
      reticle.visible = false;
      btnPlace.disabled = true;
    }
  } else {
    // Zell-Hover aktualisieren (Kopfblick)
    const { changed, cell } = picker.update(camera);
    if (changed) {
      hoverCellEl.textContent = cell ? board.cellLabel(cell.row, cell.col) : "–";
    }
  }

  renderer.render(scene, camera);
}

function placeBoard() {
  if (!lastHitPose || board) return;

  const poseM = new THREE.Matrix4().fromArray(lastHitPose.matrix ?? matrixFromTransform(lastHitPose));
  board = new Board(0.50, 10);
  board.placeAtMatrix(poseM);
  board.addToScene(scene);

  picker.setBoard(board);

  reticle.visible = false;
  btnPlace.disabled = true;
  btnReset.disabled = false;
  statusEl.textContent = "Brett gesetzt. Zielen per Kopf; Trigger/Tippen markiert Zelle.";
}

function resetBoard() {
  if (board) {
    picker.setBoard(null);
    board.removeFromScene(scene);
    board.dispose();
    board = null;
    hoverCellEl.textContent = "–";
    lastPickEl.textContent = "–";
    statusEl.textContent = "Brett entfernt. Bewege dich, bis das Reticle wieder erscheint.";
    btnReset.disabled = true;
  }
}

function onSelect() {
  if (!board || !picker.hoverCell) return;
  const { row, col } = picker.hoverCell;
  board.markCell(row, col, 0xffffff, 0.55);
  lastPickEl.textContent = board.cellLabel(row, col);
}

// Helper für ältere XRTransform-Objekte
function matrixFromTransform(t) {
  // Fallback falls t.matrix nicht direkt verfügbar ist
  return (new XRRigidTransform(t.position, t.orientation)).matrix;
}
