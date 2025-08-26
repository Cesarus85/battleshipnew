// Zell-Hover via Ray (generisch) + optional: Kopfblick-Fallback
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

export class Picker {
  constructor(scene) {
    this.scene = scene;
    this.board = null;
    this.hoverCell = null;

    // Hover-Highlight
    this.hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.45 })
    );
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
  }

  setBoard(board) {
    this.board = board;
    if (board) {
      const s = board.cellSize * 0.98;
      this.hoverMesh.geometry.dispose();
      this.hoverMesh.geometry = new THREE.PlaneGeometry(s, s);
      this.hoverMesh.rotation.x = -Math.PI / 2;
      this.hoverMesh.visible = false;
    } else {
      this.hoverMesh.visible = false;
      this.hoverCell = null;
    }
  }

  // Allgemein: Update mit beliebigem Ray (Weltkoords)
  updateWithRay(origin, dir) {
    if (!this.board) return { changed: false, cell: null };

    const hit = this.board.raycastCell(origin, dir);
    if (!hit.hit) {
      if (this.hoverMesh.visible) this.hoverMesh.visible = false;
      const changed = !!this.hoverCell;
      this.hoverCell = null;
      return { changed, cell: null };
    }

    const { row, col, centerWorld } = hit;
    const key = `${row},${col}`;
    if (!this.hoverCell || this.hoverCell.key !== key) {
      this.hoverCell = { row, col, key };
      this.hoverMesh.position.copy(centerWorld);
      this.hoverMesh.position.y += 0.002;
      this.hoverMesh.visible = true;
      return { changed: true, cell: this.hoverCell };
    } else {
      this.hoverMesh.position.copy(centerWorld);
      this.hoverMesh.position.y += 0.002;
      this.hoverMesh.visible = true;
      return { changed: false, cell: this.hoverCell };
    }
  }

  // Komfort: Kopfblick (Ray aus Kamera)
  updateFromCamera(camera) {
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    return this.updateWithRay(origin, dir);
  }

  dispose() {
    this.scene.remove(this.hoverMesh);
    this.hoverMesh.geometry?.dispose();
    this.hoverMesh.material?.dispose?.();
  }
}
