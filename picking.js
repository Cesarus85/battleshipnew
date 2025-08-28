// Zell-Hover via Ray (generisch), Hover-Mesh als Kind des Boards (lokal)
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

export class Picker {
  constructor(scene) {
    this.scene = scene;
    this.board = null;
    this.hoverCell = null;
    this.hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false })
    );
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.visible = false;
    this.hoverMesh.renderOrder = 3;
  }

  setBoard(board) {
    if (this.hoverMesh.parent) this.hoverMesh.parent.remove(this.hoverMesh);
    this.board = board;
    if (board) {
      board.group.add(this.hoverMesh);
      this.hoverMesh.visible = false;
    }
    this.hoverCell = null;
  }

  updateWithRay(origin, dir) {
    if (!this.board) return { changed:false, cell:null };
    const hit = this.board.raycastCell(origin, dir);
    const prev = this.hoverCell;
    if (hit.hit) {
      this.hoverCell = { row: hit.row, col: hit.col };
      this.hoverMesh.visible = true;
      this.hoverMesh.scale.set(this.board.cellSize, 1, this.board.cellSize);
      this.hoverMesh.position.copy(hit.centerLocal);
      this.hoverMesh.position.y += 0.0025;
    } else {
      this.hoverCell = null;
      this.hoverMesh.visible = false;
    }
    return { changed: JSON.stringify(prev) !== JSON.stringify(this.hoverCell), cell: this.hoverCell };
  }

  updateFromCamera(camera) {
    const origin = new THREE.Vector3(); camera.getWorldPosition(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    return this.updateWithRay(origin, dir);
  }

  flashHover(color, duration = 300) {
    const mat = this.hoverMesh.material;
    if (!mat) return;
    const prev = mat.color.getHex();
    mat.color.set(color);
    setTimeout(() => mat.color.set(prev), duration);
  }

  dispose() {
    if (this.hoverMesh.parent) this.hoverMesh.parent.remove(this.hoverMesh);
    this.hoverMesh.geometry?.dispose();
    this.hoverMesh.material?.dispose?.();
  }
}
