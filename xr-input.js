// XR Input Helpers (Ray, Select, Matrix utils)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

export function pickActiveInputSource(xrSession) {
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

export function getCellFromSelectEvent(e, board, refSpace, currentFrame) {
  try {
    if (!e || !board || !refSpace) return null;
    const frame = e.frame || currentFrame;
    if (!frame || !e.inputSource?.targetRaySpace) return null;

    const pose = frame.getPose(e.inputSource.targetRaySpace, refSpace);
    if (!pose) return null;

    const m = new THREE.Matrix4().fromArray(pose.transform.matrix ?? matrixFromTransform(pose.transform));
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();

    const hit = board.raycastCell(origin, dir);
    return hit.hit ? { row: hit.row, col: hit.col } : null;
  } catch {
    return null;
  }
}

export function originDirFromXRPose(pose) {
  const m = new THREE.Matrix4().fromArray(pose.transform.matrix ?? matrixFromTransform(pose.transform));
  const origin = new THREE.Vector3().setFromMatrixPosition(m);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
  return { origin, dir };
}

export function matrixFromTransform(t) {
  return (new XRRigidTransform(t.position, t.orientation)).matrix;
}
