// Zell-Hover via Ray (generisch), Hover-Mesh als Kind des Boards (lokal), klares Render-Layering
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

export class Picker {
  constructor(scene) {
    this.scene = scene;
    this.board = null;
    this.hoverCell = null;

    // Hover-Highlight (Geometrie wird nach setBoard an Zellgröße angepasst)
    this.hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.1),
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.5,
        depthTest: false,   // immer sichtbar über Base
        depthWrite: false
      })
    );
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.visible = false;
    this.hoverMesh.renderOrder = 3; // über Marker
    // WICHTIG: Wir hängen den Hover NICHT mehr an die Scene, sondern an das Board (siehe setBoard)
  }

  setBoard(board) {
    // Vorherigen Hover ggf. aus Szene entfernen
    if (this.hoverMesh.parent) {
      this.hoverMesh.parent.remove(this.hoverMesh);
    }

    this.board = board;
    if (board) {
      const s = board.cellSize * 0.98;
      this.hoverMesh.geometry.dispose();
      this.hoverMesh.geometry = new THREE.PlaneGeometry(s, s);
      this.hoverMesh.rotation.x = -Math.PI / 2;
      this.hoverMesh.visible = false;

      // Hover als Kind des Boards → lokale Koordinaten
      board.group.add(this.hoverMesh);
      board.group.updateMatrixWorld(true);
    } else {
      this.hoverMesh.visible = false;
      this.hoverCell = null;
      // Kein Parent – bleibt „losgelöst“
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

    const { row, col, centerLocal } = hit;
    const key = `${row},${col}`;

    // Position in LOKALEN Board-Koordinaten setzen
    const needReparent = this.hoverMesh.parent !== this.board.group;
    if (needReparent) this.board.group.add(this.hoverMesh);

    if (!this.hoverCell || this.hoverCell.key !== key || needReparent) {
      this.hoverCell = { row, col, key };
      this.hoverMesh.position.copy(centerLocal);
      this.hoverMesh.position.y += 0.002;
      this.hoverMesh.visible = true;
      this.board.group.updateMatrixWorld(true);
      return { changed: true, cell: this.hoverCell };
    } else {
      this.hoverMesh.position.copy(centerLocal);
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
    if (this.hoverMesh.parent) this.hoverMesh.parent.remove(this.hoverMesh);
    this.hoverMesh.geometry?.dispose();
    this.hoverMesh.material?.dispose?.();
  }
}
