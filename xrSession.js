import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import {
  overlay,
  statusEl,
  btnStartSolo,
  btnStartSafeSolo,
  btnStartMulti,
  btnStartSafeMulti,
  btnReset,
  hoverCellEl,
  aimInfoEl,
  setAimMode,
  setPhase,
  diagnose,
  aimMode,
  phase
} from "./ui.js";

import {
  renderer,
  scene,
  camera,
  reticle,
  picker,
  playerBoard,
  enemyBoard,
  remoteBoard,
  remoteTurn,
  netPlayerId,
  fleet,
  orientation,
  turn
} from "./state.js";
import {
  onSelect,
  onSqueeze,
  checkPendingLoad,
  resetAll
} from "./main.js";

export let xrSession = null;
let localRefSpace = null;
let viewerSpace = null;
let hitTestSource = null;
let prevTime = null;
let lastXRFrame = null;
let lastHitPose = null;

export function getLastHitPose() { return lastHitPose; }
export function resetLastHitPose() { lastHitPose = null; }

export async function startAR(mode = "regular") {
  if (!navigator.xr) { statusEl.textContent = "WebXR nicht verfügbar. Bitte Meta/Quest-Browser verwenden."; await diagnose(); return; }
  try {
    const supported = await navigator.xr.isSessionSupported?.("immersive-ar");
    if (supported === false) { statusEl.textContent = "Dieser Browser unterstützt 'immersive-ar' nicht. Bitte Quest-Browser updaten."; await diagnose(); return; }
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
      try { xrSession = await navigator.xr.requestSession("immersive-ar", cfg.init); statusEl.textContent = `AR gestartet (${cfg.note}).`; break; }
      catch (e) { lastErr = e; }
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

    try { hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace }); statusEl.textContent += " | hit-test aktiv."; }
    catch { hitTestSource = null; statusEl.textContent += " | hit-test NICHT verfügbar."; }

    btnStartSolo.disabled = true; btnStartSafeSolo.disabled = true;
    btnStartMulti.disabled = true; btnStartSafeMulti.disabled = true;
    btnReset.disabled = true;
    setAimMode(aimMode);
    setPhase("placement");
    prevTime = null;
    renderer.setAnimationLoop(onXRFrame);

    checkPendingLoad();
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
  btnStartSolo.disabled = false; btnStartSafeSolo.disabled = false;
  btnStartMulti.disabled = false; btnStartSafeMulti.disabled = false;
  btnReset.disabled = !!playerBoard;
  aimInfoEl.textContent = "";
  setPhase("placement");
  resetAll();
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
  lastXRFrame = frame;
  if (prevTime == null) prevTime = time;
  const dt = Math.min(0.1, (time - prevTime) / 1000);
  prevTime = time;

  if (phase === "placement") {
    const results = hitTestSource ? frame.getHitTestResults(hitTestSource) : [];
    if (results.length > 0) {
      const pose = results[0].getPose(localRefSpace);
      lastHitPose = pose && pose.transform;
      if (lastHitPose) {
        const m = new THREE.Matrix4().fromArray(lastHitPose.matrix ?? matrixFromTransform(lastHitPose));
        reticle.visible = true; reticle.matrix.copy(m);
      }
    } else {
      lastHitPose = null;
      reticle.visible = false;
    }
  } else if (phase === "setup") {
    picker.setBoard(playerBoard);
    const cell = updateHover();
    if (playerBoard && cell) {
      const L = fleet.currentLength();
      const valid = playerBoard.canPlaceShip(cell.row, cell.col, L, orientation);
      playerBoard.showGhost(cell.row, cell.col, L, orientation, valid);
    } else if (playerBoard) { playerBoard.clearGhost(); }
  } else if (phase === "play") {
    if (netPlayerId !== null) {
      // Hover-Indikator nur anzeigen, wenn Gegnerbrett existiert und eigener Zug
      if (remoteBoard && !remoteTurn) {
        picker.setBoard(remoteBoard);
        updateHover();
      } else {
        picker.setBoard(null);
      }
    } else {
      if (turn === "player") { picker.setBoard(enemyBoard); updateHover(); }
      else { picker.setBoard(null); }
    }
  }

  playerBoard?.updateEffects?.(dt);
  enemyBoard?.updateEffects?.(dt);

  renderer.render(scene, camera);
}

function updateHover() {
  if (!picker.board) return null;
  if (aimMode === "gaze") {
    const { changed, cell } = picker.updateFromCamera(camera);
    if (changed) hoverCellEl.textContent = cell ? picker.board.cellLabel(cell.row, cell.col) : "–";
    return picker.hoverCell || null;
  } else {
    const src = pickActiveInputSource();
    if (!src) { picker.updateWithRay(new THREE.Vector3(1e6,1e6,1e6), new THREE.Vector3(0,-1,0)); return null; }
    const pose = renderer.xr.getFrame().getPose(src.targetRaySpace, localRefSpace);
    if (!pose) return null;
    const { origin, dir } = originDirFromXRPose(pose);
    const { changed, cell } = picker.updateWithRay(origin, dir);
    if (changed) hoverCellEl.textContent = cell ? picker.board.cellLabel(cell.row, cell.col) : "–";
    return picker.hoverCell || null;
  }
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

export function getCellFromSelectEvent(e, board) {
  try {
    if (!e || !board || !localRefSpace) return null;
    const frame = e.frame || lastXRFrame;
    if (!frame) return null;
    if (!e.inputSource?.targetRaySpace) return null;
    const pose = frame.getPose(e.inputSource.targetRaySpace, localRefSpace);
    if (!pose) return null;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix ?? matrixFromTransform(pose.transform));
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
    const hit = board.raycastCell(origin, dir);
    return hit.hit ? { row: hit.row, col: hit.col } : null;
  } catch { return null; }
}

function originDirFromXRPose(pose) {
  const m = new THREE.Matrix4().fromArray(pose.transform.matrix ?? matrixFromTransform(pose.transform));
  const origin = new THREE.Vector3().setFromMatrixPosition(m);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
  return { origin, dir };
}

export function matrixFromTransform(t) {
  return (new XRRigidTransform(t.position, t.orientation)).matrix;
}

export function offsetLocalXZ(baseMatrix, dx, dz) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  new THREE.Matrix4().copy(baseMatrix).decompose(pos, quat, scl);
  const offsetLocal = new THREE.Vector3(dx, 0, dz).applyQuaternion(quat);
  pos.add(offsetLocal);
  const out = new THREE.Matrix4();
  out.compose(pos, quat, scl);
  return out;
}
