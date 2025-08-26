// Board-Modell & Geometrie (10x10 Grid), Welt<->Zell-Koordinaten, Marker
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

export class Board {
  constructor(sizeMeters = 0.50, cells = 10) {
    this.size = sizeMeters;
    this.cells = cells;
    this.cellSize = this.size / this.cells;

    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;

    // Geometrie
    this._buildGeometry();

    // Matritzen (werden bei Platzierung gesetzt)
    this.matrix = new THREE.Matrix4();
    this.inverseMatrix = new THREE.Matrix4();

    // Marker-Map "r,c" -> Mesh
    this.markers = new Map();
  }

  _buildGeometry() {
    // Base
    const baseGeo = new THREE.PlaneGeometry(this.size, this.size);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0d1b2a, metalness: 0.0, roughness: 1.0, transparent: true, opacity: 0.7
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.receiveShadow = false;
    this.group.add(base);

    // Grid-Linien
    const lines = this._makeGridLines();
    lines.position.y += 0.001;
    this.group.add(lines);
  }

  _makeGridLines() {
    const half = this.size / 2;
    const step = this.cellSize;
    const points = [];

    for (let i = 0; i <= this.cells; i++) {
      const x = -half + i * step;
      points.push(new THREE.Vector3(x, 0, -half), new THREE.Vector3(x, 0, half));
    }
    for (let j = 0; j <= this.cells; j++) {
      const z = -half + j * step;
      points.push(new THREE.Vector3(-half, 0, z), new THREE.Vector3(half, 0, z));
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x7bdcff, transparent: true, opacity: 0.9 });
    const lines = new THREE.LineSegments(geo, mat);
    lines.rotation.x = -Math.PI / 2;
    return lines;
  }

  placeAtMatrix(matrix4) {
    this.matrix.copy(matrix4);
    this.group.matrix.copy(matrix4);
    this.group.updateMatrixWorld(true);
    this.inverseMatrix.copy(this.group.matrixWorld).invert();
  }

  addToScene(scene) { scene.add(this.group); }
  removeFromScene(scene) { scene.remove(this.group); }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
    this.markers.forEach(m => {
      m.geometry?.dispose();
      m.material?.dispose?.();
    });
    this.markers.clear();
  }

  // Rechnet den Schnitt eines Weltstrahls mit der Brett-Ebene (lokal y=0) und liefert Zellindex
  raycastCell(worldRayOrigin, worldRayDir) {
    // In Board-Lokalkoordinaten umrechnen
    const o = worldRayOrigin.clone().applyMatrix4(this.inverseMatrix);
    const d = worldRayDir.clone().transformDirection(this.inverseMatrix);

    // Schnitt mit Ebene y=0 -> o.y + t*d.y = 0
    const denom = d.y;
    if (Math.abs(denom) < 1e-6) return { hit: false };

    const t = -o.y / denom;
    if (t < 0) return { hit: false };

    const x = o.x + d.x * t;
    const z = o.z + d.z * t;

    const half = this.size / 2;
    if (x < -half || x > half || z < -half || z > half) return { hit: false };

    const u = (x + half) / this.size;  // 0..1
    const v = (z + half) / this.size;  // 0..1

    let col = Math.floor(u * this.cells);
    let row = Math.floor(v * this.cells);

    // Kantenfall bei exakt 1.0 abfangen
    if (col === this.cells) col = this.cells - 1;
    if (row === this.cells) row = this.cells - 1;

    const centerLocal = new THREE.Vector3(
      -half + (col + 0.5) * this.cellSize,
      0,
      -half + (row + 0.5) * this.cellSize
    );
    const centerWorld = centerLocal.clone().applyMatrix4(this.group.matrixWorld);

    return {
      hit: true,
      row, col,
      centerWorld
    };
  }

  cellLabel(row, col) {
    const letter = String.fromCharCode(65 + col); // A..J
    return `${letter}-${row + 1}`;               // 1..10
  }

  markCell(row, col, color = 0xffffff, opacity = 0.6) {
    const key = `${row},${col}`;
    if (this.markers.has(key)) return; // doppelt vermeiden

    const r = (this.cellSize * 0.45);
    const geo = new THREE.CircleGeometry(r, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
    const mesh = new THREE.Mesh(geo, mat);

    const c = this.cellCenterWorld(row, col);
    mesh.position.copy(c);
    mesh.position.y += 0.002;

    this.group.add(mesh);
    this.markers.set(key, mesh);
  }

  cellCenterWorld(row, col) {
    const half = this.size / 2;
    const local = new THREE.Vector3(
      -half + (col + 0.5) * this.cellSize,
      0,
      -half + (row + 0.5) * this.cellSize
    );
    return local.applyMatrix4(this.group.matrixWorld);
  }

  clearMarkers() {
    this.markers.forEach(m => {
      this.group.remove(m);
      m.geometry?.dispose();
      m.material?.dispose?.();
    });
    this.markers.clear();
  }
}
