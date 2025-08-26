// AR + Diagnose + Zielmodus + Trigger-Placement + Schiffe-Editor (Setup)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import { Board } from "./board.js";
import { Picker } from "./picking.js";
import { FleetManager } from "./ships.js";

const canvas = document.getElementById("xr-canvas");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnStartSafe = document.getElementById("btnStartSafe");
const btnReset = document.getElementById("btnReset");
const hoverCellEl = document.getElementById("hoverCell");
const lastPickEl = document.getElementById("lastPick");
const btnAimGaze = document.getElementById("btnAimGaze");
const btnAimController = document.getElementById("btnAimController");
const aimInfoEl = document.getElementById("aimInfo");
const debugEl = document.getElementById("debug");
const btnDiag = document.getElementById("btnDiag");
const btnPerms = document.getElementById("btnPerms");

// Setup UI
const phaseEl = document.getElementById("phase");
const fleetEl = document.getElementById("fleet");
const btnRotate = document.getElementById("btnRotate");
const btnUndo = document.getElementById("btnUndo");
const btnStartGame = document.getElementById("btnStartGame");

let renderer, scene, camera;
let xrSession = null;
let localRefSpace = null;
let viewerSpace = null;
let hitTestSource = null;
let reticle = null;
let lastHitPose = null;

let board = null;
let picker = null;
let fleet = null;

// Zielmodus: "gaze" | "controller"
let aimMode = "gaze";

// Game-Phase: "placement" -> Brett platzieren; "setup" -> Schiffe setzen; "play" -> Spiel
let phase = "placement";

// Setup-State
let orientation = "H"; // "H" oder "V"

initGL();
wireUI();
diagnose().catch(()=>{});

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
  setPhase("placement");
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function wireUI() {
  btnStart.addEventListener("click", () => startAR("regular"));
  btnStartSafe.addEventListener("click", () => startAR("safe"));
  btnReset.addEventListener("click", resetAll);

  btnAimGaze.addEventListener("click", () => setAimMode("gaze"));
  btnAimController.addEventListener("click", () => setAimMode("controller"));

  btnDiag.addEventListener("click", () => diagnose());
  btnPerms.addEventListener("click", () => {
    statusEl.textContent = "Quest-Browser → Seiteneinstellungen: 'Passthrough/AR' & 'Bewegung/Tracking' erlauben. Falls früher abgelehnt: Berechtigungen zurücksetzen und Seite neu laden.";
  });

  btnRotate.addEventListener("click", rotateShip);
  btnUndo.addEventListener("click", undoShip);
  btnStartGame.addEventListener("click", startGame);
}

function setAimMode(mode) {
  aimMode = mode;
  btnAimGaze.classList.toggle("active", aimMode === "gaze");
  btnAimController.classList.toggle("active", aimMode === "controller");
  aimInfoEl.textContent = aimMode === "gaze" ? "Zielen über Kopfblick." : "Zielen über Hand/Controller-Ray.";
}

function setPhase(p) {
  phase = p;
  phaseEl.textContent = p;
}

async function diagnose() {
  const lines = [];
  const ua = navigator.userAgent || "n/a";
  lines.push(`User-Agent: ${ua}`);
  lines.push(`Secure Context: ${window.isSecureContext} (${location.protocol})`);
  lines.push(`navigator.xr: ${!!navigator.xr}`);
  try {
    const arSup = await navigator.xr?.isSessionSupported?.("immersive-ar");
    const vrSup = await navigator.xr?.isSessionSupported?.("immersive-vr");
    lines.push(`isSessionSupported('immersive-ar'): ${arSup}`);
    lines.push(`isSessionSupported('immersive-vr'): ${vrSup}`);
  } catch (e) {
    lines.push(`isSessionSupported() Fehler: ${e?.name} – ${e?.message}`);
  }
  debugEl.innerHTML = `<strong>Diagnose</strong>\n${lines.join("\n")}\n\nTipps:\n• HTTPS nötig (https:// oder https://localhost)\n• Quest-Browser aktuell?\n• Berechtigungen erteilt?`;
}

async function startAR(mode = "regular") {
  if (!navigator.xr) {
    statusEl.textContent = "WebXR nicht verfügbar. Bitte Meta/Quest-Browser verwenden.";
    await diagnose();
    return;
  }
  try {
    const supported = await navigator.xr.isSessionSupported?.("immersive-ar");
    if (supported === false) {
      statusEl.textContent = "Dieser Browser unterstützt 'immersive-ar' nicht. Bitte Quest-Browser updaten.";
      await diagnose();
      return;
    }
    const configs = mode === "safe"
      ? [
          { note: "SAFE: minimale Features", init: { requiredFeatures: [], optionalFeatures: [] } },
          { note: "SAFE: optional hit-test", init: { requiredFeatures: [], optionalFeatures: ["hit-test"] } },
        ]
      : [
          { note: "regular: hit-test + optional dom-overlay", init: { requiredFeatures: ["hit-test"], optionalFeatures: ["dom-overlay", "anchors", "hand-tracking"], domOverlay: { root: overlay } } },
          { note: "regular-fallback: hit-test (kein dom-overlay)", init: { requiredFeatures: ["hit-test"], optionalFeatures: ["anchors", "hand-tracking"] } },
        ];

    let lastErr = null;
    for (const cfg of configs) {
      try {
        xrSession = await navigator.xr.requestSession("immersive-ar", cfg.init);
        console.log("[XR] gestartet mit:", cfg.note);
        statusEl.textContent = `AR gestartet (${cfg.note}).`;
        break;
      } catch (e) { lastErr = e; }
    }
    if (!xrSession) throw lastErr || new Error("requestSession fehlgeschlagen (unbekannt)");

    renderer.xr.setReferenceSpaceType("local");
    await renderer.xr.setSession(xrSession);

    xrSession.addEventListener("end", onSessionEnd);
    xrSession.addEventListener("select", onSelect);
    xrSession.addEventListener("squeezestart", onSqueeze);
    xrSession.addEventListener("inputsourceschange", onInputSourcesChange);

    localRefSpace = await xrSession.requestReferenceSpace("local");
    viewerSpace = await xrSession.requestReferenceSpace("viewer");

    try {
      hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });
      statusEl.textContent += " | hit-test aktiv.";
    } catch {
      hitTestSource = null;
      statusEl.textContent += " | hit-test NICHT verfügbar.";
    }

    btnStart.disabled = true; btnStartSafe.disabled = true;
    btnReset.disabled = true;
    setAimMode(aimMode);
    setPhase("placement");
    renderer.setAnimationLoop(onXRFrame);
  } catch (err) {
    statusEl.textContent = `AR-Start fehlgeschlagen: ${err?.name || "Error"} – ${err?.message || err}`;
  }
}

function onSessionEnd() {
  renderer.setAnimationLoop(null);
  xrSession?.removeEventListener("select", onSelect);
  xrSession?.removeEventListener("squeezestart", onSqueeze);
  xrSession?.removeEventListener("inputsourceschange", onInputSourcesChange);
  xrSession = null; hitTestSource = null; lastHitPose = null;
  reticle.visible = false;
  btnStart.disabled = false; btnStartSafe.disabled = false;
  btnReset.disabled = !!board;
  aimInfoEl.textContent = "";
  setPhase("placement");
}

function onInputSourcesChange() {
  if (!xrSession) return;
  const src = pickActiveInputSource();
  aimInfoEl.textContent = src
    ? (aimMode === "controller" ? `Ray aktiv: ${src.handedness || "neutral"}` : "Zielen über Kopfblick.")
    : (aimMode === "controller" ? "Kein Hand/Controller-Ray." : "Zielen über Kopfblick.");
}

function onXRFrame(time, frame) {
  if (!frame) return;

  if (phase === "placement") {
    const results = hitTestSource ? frame.getHitTestResults(hitTestSource) : [];
    if (results.length > 0) {
      const pose = results[0].getPose(localRefSpace);
      lastHitPose = pose && pose.transform;
      if (lastHitPose) {
        const m = new THREE.Matrix4().fromArray(lastHitPose.matrix ?? matrixFromTransform(lastHitPose));
        reticle.visible = true; reticle.matrix.copy(m);
      }
    } else { reticle.visible = false; }
  } else {
    // Hover je nach Zielmodus
    const cell = updateHover();
    if (phase === "setup" && board && cell) {
      const L = fleet.currentLength();
      const valid = board.canPlaceShip(cell.row, cell.col, L, orientation);
      board.showGhost(cell.row, cell.col, L, orientation, valid);
    } else if (phase === "setup" && board) {
      board.clearGhost();
    }
  }

  renderer.render(scene, camera);
}

function updateHover() {
  if (!board) return null;
  if (aimMode === "gaze") {
    const { changed, cell } = picker.updateFromCamera(camera);
    if (changed) hoverCellEl.textContent = cell ? board.cellLabel(cell.row, cell.col) : "–";
    return picker.hoverCell || null;
  } else {
    const src = pickActiveInputSource();
    if (!src) { picker.updateWithRay(new THREE.Vector3(1e6,1e6,1e6), new THREE.Vector3(0,-1,0)); return null; }
    const pose = renderer.xr.getFrame().getPose(src.targetRaySpace, localRefSpace);
    if (!pose) return null;
    const { origin, dir } = originDirFromXRPose(pose);
    const { changed, cell } = picker.updateWithRay(origin, dir);
    if (changed) hoverCellEl.textContent = cell ? board.cellLabel(cell.row, cell.col) : "–";
    return picker.hoverCell || null;
  }
}

function placeBoardAtReticle() {
  if (!lastHitPose || board) return;
  const poseM = new THREE.Matrix4().fromArray(lastHitPose.matrix ?? matrixFromTransform(lastHitPose));
  board = new Board(0.50, 10);
  board.placeAtMatrix(poseM);
  board.addToScene(scene);
  picker.setBoard(board);
  reticle.visible = false;
  btnReset.disabled = false;

  // Setup starten
  fleet = new FleetManager([5,4,3,3,2]);
  setPhase("setup");
  updateFleetUI();
  statusEl.textContent = "Schiffe setzen: Ziel auf Zelle → Trigger platziert, Squeeze dreht (H/V).";
}

function onSelect() {
  if (phase === "placement") { placeBoardAtReticle(); return; }
  if (phase === "setup") {
    const cell = picker.hoverCell; if (!cell) return;
    const L = fleet.currentLength(); if (!L) return;
    const ok = board.canPlaceShip(cell.row, cell.col, L, orientation);
    if (!ok) { statusEl.textContent = "Ungültige Position (außerhalb oder Kollision)."; return; }
    board.placeShip(cell.row, cell.col, L, orientation);
    fleet.advance(cell.row, cell.col, L, orientation);
    lastPickEl.textContent = board.cellLabel(cell.row, cell.col);
    updateFleetUI();
    // Ghost verschwindet, wird im nächsten Frame neu berechnet
    board.clearGhost();
    if (fleet.complete()) {
      btnStartGame.disabled = false;
      statusEl.textContent = "Flotte komplett. „Spiel starten“ aktiv.";
    }
    return;
  }
  if (phase === "play") {
    if (!picker.hoverCell) return;
    const { row, col } = picker.hoverCell;
    board.markCell(row, col, 0xffffff, 0.55);
    lastPickEl.textContent = board.cellLabel(row, col);
  }
}

function onSqueeze() {
  if (phase === "setup") rotateShip();
}

function rotateShip() {
  orientation = (orientation === "H") ? "V" : "H";
  updateFleetUI();
}

function undoShip() {
  if (!board || !fleet) return;
  const last = board.undoLastShip();
  if (!last) return;
  fleet.undo(); // fügt die Länge wieder ein
  btnStartGame.disabled = true;
  updateFleetUI();
}

function startGame() {
  if (!fleet || !fleet.complete()) return;
  setPhase("play");
  board.clearGhost();
  statusEl.textContent = "Spielphase: Zielen & Trigger → Schuss markieren (proto).";
}

function resetAll() {
  if (board) {
    picker.setBoard(null);
    board.removeFromScene(scene);
    board.dispose();
    board = null;
  }
  hoverCellEl.textContent = "–";
  lastPickEl.textContent = "–";
  statusEl.textContent = "Zurückgesetzt. Richte Reticle auf die Fläche und starte erneut.";
  btnReset.disabled = true;
  setPhase("placement");
}

function updateFleetUI() {
  // Phase-Text
  phaseEl.textContent = phase + (phase === "setup" ? ` (Ori: ${orientation})` : "");
  // Pillen bauen
  if (!fleet) { fleetEl.innerHTML = ""; btnUndo.disabled = true; btnStartGame.disabled = true; return; }
  const remain = fleet.summary();
  const orderStr = fleet.order.length ? `Als Nächstes: ${fleet.order[0]}er` : "–";
  const parts = [];
  for (const L of [5,4,3,2]) {
    const n = remain[L] || 0;
    parts.push(`<span class="pill">${L}er × ${n}</span>`);
  }
  fleetEl.innerHTML = `${parts.join(" ")} &nbsp; | &nbsp; <strong>${orderStr}</strong>`;
  btnUndo.disabled = fleet.placed.length === 0;
}

function pickActiveInputSource() {
  if (!xrSession) return null;
  let right = null, left = null, any = null;
  for (const src of xrSession.inputSources) {
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
function matrixFromTransform(t) {
  return (new XRRigidTransform(t.position, t.orientation)).matrix;
}
