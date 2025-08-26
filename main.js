// AR-Bootstrap + Brett-Platzierung + Zell-Picking + Zielmodus (Kopf/Hand/Controller)
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
const btnAimGaze = document.getElementById("btnAimGaze");
const btnAimController = document.getElementById("btnAimController");
const aimInfoEl = document.getElementById("aimInfo");

let renderer, scene, camera;
let xrSession = null;
let localRefSpace = null;
let viewerSpace = null;
let hitTestSource = null;
let reticle = null;
let lastHitPose = null;

let board = null;
let picker = null;

// Zielmodus: "gaze" | "controller"
let aimMode = "gaze";

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

  // Reticle (für Platzierung)
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

  btnAimGaze.addEventListener("click", () => setAimMode("gaze"));
  btnAimController.addEventListener("click", () => setAimMode("controller"));
}

function setAimMode(mode) {
  aimMode = mode;
  btnAimGaze.classList.toggle("active", aimMode === "gaze");
  btnAimController.classList.toggle("active", aimMode === "controller");
  aimInfoEl.textContent = aimMode === "gaze"
    ? "Zielen über Kopfblick."
    : "Zielen über Hand/Controller-Ray.";
}

async function startAR() {
  if (!navigator.xr) {
    statusEl.textContent = "WebXR nicht verfügbar. Bitte Quest-Browser nutzen.";
    return;
  }
  try {
    const sessionInit = {
      requiredFeatures: ["hit-test", "dom-overlay"],
      optionalFeatures: ["anchors", "hand-tracking"], // Hand-Tracking optional
      domOverlay: { root: overlay }
    };
    xrSession = await navigator.xr.requestSession("immersive-ar", sessionInit);
    renderer.xr.setReferenceSpaceType("local");
    await renderer.xr.setSession(xrSession);

    xrSession.addEventListener("end", onSessionEnd);
    xrSession.addEventListener("select", onSelect);
    xrSession.addEventListener("inputsourceschange", onInputSourcesChange);

    localRefSpace = await xrSession.requestReferenceSpace("local");
    viewerSpace = await xrSession.requestReferenceSpace("viewer");
    hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });

    statusEl.textContent = "Bewege dich, bis das Reticle stabil erscheint. Dann „Hier platzieren“.";
    btnPlace.disabled = true;
    btnReset.disabled = true;
    btnStart.disabled = true;

    setAimMode(aimMode); // UI-Text initialisieren

    renderer.setAnimationLoop(onXRFrame);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "AR-Start fehlgeschlagen. HTTPS/Quest-Browser verwenden?";
  }
}

function onSessionEnd() {
  renderer.setAnimationLoop(null);
  xrSession?.removeEventListener("select", onSelect);
  xrSession?.removeEventListener("inputsourceschange", onInputSourcesChange);
  xrSession = null;
  hitTestSource = null;
  lastHitPose = null;
  reticle.visible = false;
  btnStart.disabled = false;
  btnPlace.disabled = true;
  btnReset.disabled = !!board;
  statusEl.textContent = "Session beendet.";
  aimInfoEl.textContent = "";
}

function onInputSourcesChange() {
  // Kurze Info aktualisieren (z. B. wenn Controller verbunden/gelöst werden)
  if (!xrSession) return;
  const src = pickActiveInputSource();
  if (!src) {
    if (aimMode === "controller") {
      aimInfoEl.textContent = "Kein Hand/Controller-Ray. Bitte Controller anziehen oder Handtracking aktivieren.";
    }
    return;
  }
  aimInfoEl.textContent = aimMode === "controller"
    ? `Ray aktiv: ${src.handedness === "right" ? "rechts" : src.handedness === "left" ? "links" : "neutral"}`
    : "Zielen über Kopfblick.";
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
    // Zell-Hover je nach Zielmodus
    if (aimMode === "gaze") {
      const { changed, cell } = picker.updateFromCamera(camera);
      if (changed) hoverCellEl.textContent = cell ? board.cellLabel(cell.row, cell.col) : "–";
      aimInfoEl.textContent = "Zielen über Kopfblick.";
    } else {
      const src = pickActiveInputSource();
      if (!src) {
        aimInfoEl.textContent = "Kein Hand/Controller-Ray. Bitte Controller/Handtracking nutzen.";
        // Hover ausblenden
        picker.updateWithRay(new THREE.Vector3(1e6,1e6,1e6), new THREE.Vector3(0,-1,0)); // garantiert kein Hit
      } else {
        const pose = frame.getPose(src.targetRaySpace, localRefSpace);
        if (pose) {
          const { origin, dir } = originDirFromXRPose(pose);
          const { changed, cell } = picker.updateWithRay(origin, dir);
          if (changed) hoverCellEl.textContent = cell ? board.cellLabel(cell.row, cell.col) : "–";
          aimInfoEl.textContent = `Ray aktiv: ${src.handedness === "right" ? "rechts" : src.handedness === "left" ? "links" : "neutral"}`;
        } else {
          aimInfoEl.textContent = "Ray-Pose nicht verfügbar.";
        }
      }
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
  statusEl.textContent = "Brett gesetzt. Zielen: Kopf oder Hand/Controller. Trigger/Pinch zum Markieren.";
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

function onSelect(event) {
  if (!board || !picker.hoverCell) return;
  const { row, col } = picker.hoverCell;
  board.markCell(row, col, 0xffffff, 0.55);
  lastPickEl.textContent = board.cellLabel(row, col);
}

/* ---------- Helpers ---------- */

function pickActiveInputSource() {
  if (!xrSession) return null;
  let right = null, left = null, any = null;
  for (const src of xrSession.inputSources) {
    // Controller UND Hände liefern "tracked-pointer"
    if (src.targetRayMode === "tracked-pointer") {
      any = any || src;
      if (src.handedness === "right") right = src;
      else if (src.handedness === "left") left = src;
    }
  }
  return right || left || any;
}

function originDirFromXRPose(pose) {
  const m = new THREE.Matrix4().fromArray(pose.transform.matrix ?? matrixFromTransform(pose.transform));
  const origin = new THREE.Vector3().setFromMatrixPosition(m);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
  return { origin, dir };
}

// Fallback falls transform.matrix nicht direkt verfügbar ist
function matrixFromTransform(t) {
  return (new XRRigidTransform(t.position, t.orientation)).matrix;
}
