// AR + Diagnose-Overlay + Safe-Mode-Start
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import { Board } from "./board.js";
import { Picker } from "./picking.js";

const canvas = document.getElementById("xr-canvas");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnStartSafe = document.getElementById("btnStartSafe");
const btnPlace = document.getElementById("btnPlace");
const btnReset = document.getElementById("btnReset");
const hoverCellEl = document.getElementById("hoverCell");
const lastPickEl = document.getElementById("lastPick");
const btnAimGaze = document.getElementById("btnAimGaze");
const btnAimController = document.getElementById("btnAimController");
const aimInfoEl = document.getElementById("aimInfo");
const debugEl = document.getElementById("debug");
const btnDiag = document.getElementById("btnDiag");
const btnPerms = document.getElementById("btnPerms");

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
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function wireUI() {
  btnStart.addEventListener("click", () => startAR("regular"));
  btnStartSafe.addEventListener("click", () => startAR("safe"));
  btnPlace.addEventListener("click", placeBoard);
  btnReset.addEventListener("click", resetBoard);

  btnAimGaze.addEventListener("click", () => setAimMode("gaze"));
  btnAimController.addEventListener("click", () => setAimMode("controller"));

  btnDiag.addEventListener("click", () => diagnose());
  btnPerms.addEventListener("click", () => {
    statusEl.textContent = "Quest-Browser → Seiteneinstellungen: 'Passthrough/AR' & 'Bewegung/Tracking' erlauben. Falls früher abgelehnt: Berechtigungen zurücksetzen und Seite neu laden.";
  });
}

function setAimMode(mode) {
  aimMode = mode;
  btnAimGaze.classList.toggle("active", aimMode === "gaze");
  btnAimController.classList.toggle("active", aimMode === "controller");
  aimInfoEl.textContent = aimMode === "gaze"
    ? "Zielen über Kopfblick."
    : "Zielen über Hand/Controller-Ray.";
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

    // Session-Configs
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
      } catch (e) {
        lastErr = e;
        console.warn("[XR] Startversuch fehlgeschlagen:", cfg.note, e);
      }
    }
    if (!xrSession) throw lastErr || new Error("requestSession fehlgeschlagen (unbekannt)");

    renderer.xr.setReferenceSpaceType("local");
    await renderer.xr.setSession(xrSession);

    xrSession.addEventListener("end", onSessionEnd);
    xrSession.addEventListener("select", onSelect);
    xrSession.addEventListener("inputsourceschange", onInputSourcesChange);

    // Reference Spaces
    localRefSpace = await xrSession.requestReferenceSpace("local");
    viewerSpace = await xrSession.requestReferenceSpace("viewer");

    // Hit-Test versuchen (falls Feature aktiv)
    try {
      hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });
      statusEl.textContent += " | hit-test aktiv.";
    } catch (e) {
      hitTestSource = null;
      statusEl.textContent += " | hit-test NICHT verfügbar.";
    }

    const hasDomOverlay = !!xrSession.domOverlayState;
    statusEl.textContent += hasDomOverlay ? " | DOM-Overlay aktiv." : " | DOM-Overlay nicht verfügbar.";

    btnPlace.disabled = true;
    btnReset.disabled = true;
    btnStart.disabled = true;
    btnStartSafe.disabled = true;
    setAimMode(aimMode);

    renderer.setAnimationLoop(onXRFrame);
  } catch (err) {
    const msg = `AR-Start fehlgeschlagen: ${err?.name || "Error"} – ${err?.message || err}`;
    console.error(msg);
    statusEl.textContent = `${msg}\n• HTTPS/Quest-Browser/Berechtigungen prüfen.`;
    debugEl.textContent = `[Fehlerdetails]\n${msg}\n\nFalls weiterhin Probleme: Seite neu laden, Safe-Mode probieren, dann Diagnose posten.`;
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
  btnStartSafe.disabled = false;
  btnPlace.disabled = true;
  btnReset.disabled = !!board;
  statusEl.textContent = "Session beendet.";
  aimInfoEl.textContent = "";
}

function onInputSourcesChange() {
  if (!xrSession) return;
  const src = pickActiveInputSource();
  aimInfoEl.textContent = src
    ? (aimMode === "controller"
        ? `Ray aktiv: ${src.handedness || "neutral"}`
        : "Zielen über Kopfblick.")
    : (aimMode === "controller"
        ? "Kein Hand/Controller-Ray. Bitte Controller anziehen oder Handtracking aktivieren."
        : "Zielen über Kopfblick.");
}

function onXRFrame(time, frame) {
  if (!frame) return;

  // Platzierungs-Hit-Test (falls verfügbar)
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
    } else {
      const src = pickActiveInputSource();
      if (!src) {
        picker.updateWithRay(new THREE.Vector3(1e6,1e6,1e6), new THREE.Vector3(0,-1,0)); // hide
      } else {
        const pose = frame.getPose(src.targetRaySpace, localRefSpace);
        if (pose) {
          const { origin, dir } = originDirFromXRPose(pose);
          const { changed, cell } = picker.updateWithRay(origin, dir);
          if (changed) hoverCellEl.textContent = cell ? board.cellLabel(cell.row, cell.col) : "–";
        }
      }
    }
  }

  renderer.render(scene, camera);
}

function placeBoard() {
  if (!lastHitPose || board) {
    if (!hitTestSource) statusEl.textContent = "Hit-Test nicht verfügbar. Safe-Mode gestartet? Dann ist Platzierung deaktiviert.";
    return;
  }
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

function onSelect() {
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
