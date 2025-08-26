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

    // Matritzen
    this.matrix = new THREE.Matrix4();
    this.inverseMatrix = new THREE.Matrix4();

    // Belegung: 0=leer, 1=Schiff
    this.grid = Array.from({ length: this.cells }, () => Array(this.cells).fill(0));
    this.ships = []; // {row,col,length,orientation,mesh}

    // Marker (Treffer/Miss)
    this.markers = new Map();

    // Ghost-Mesh (Vorschau)
    this.ghost = null;
  }

  _buildGeometry() {
    const baseGeo = new THREE.PlaneGeometry(this.size, this.size);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0d1b2a, metalness: 0.0, roughness: 1.0,
      transparent: true, opacity: 0.7,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.receiveShadow = false;
    base.renderOrder = 0;
    this.group.add(base);

    const lines = this._makeGridLines();
    lines.position.y += 0.001;
    lines.renderOrder = 1;
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
    this.markers.forEach(m => { m.geometry?.dispose(); m.material?.dispose?.(); });
    this.markers.clear();
    if (this.ghost) { this.group.remove(this.ghost); this.ghost.geometry.dispose(); this.ghost.material.dispose(); this.ghost = null; }
  }

  /* ---------- Koordinaten & Ray ---------- */
  raycastCell(worldRayOrigin, worldRayDir) {
    const o = worldRayOrigin.clone().applyMatrix4(this.inverseMatrix);
    const d = worldRayDir.clone().transformDirection(this.inverseMatrix);

    const denom = d.y;
    if (Math.abs(denom) < 1e-6) return { hit: false };
    const t = -o.y / denom;
    if (t < 0) return { hit: false };

    const x = o.x + d.x * t;
    const z = o.z + d.z * t;

    const half = this.size / 2;
    if (x < -half || x > half || z < -half || z > half) return { hit: false };

    const u = (x + half) / this.size;
    const v = (z + half) / this.size;

    let col = Math.floor(u * this.cells);
    let row = Math.floor(v * this.cells);
    if (col === this.cells) col = this.cells - 1;
    if (row === this.cells) row = this.cells - 1;

    const centerLocal = this.cellCenterLocal(row, col);
    const centerWorld = centerLocal.clone().applyMatrix4(this.group.matrixWorld);
    return { hit: true, row, col, centerLocal, centerWorld };
  }

  cellCenterLocal(row, col) {
    const half = this.size / 2;
    return new THREE.Vector3(
      -half + (col + 0.5) * this.cellSize,
      0,
      -half + (row + 0.5) * this.cellSize
    );
  }
  cellCenterWorld(row, col) {
    return this.cellCenterLocal(row, col).applyMatrix4(this.group.matrixWorld);
  }
  cellLabel(row, col) {
    const letter = String.fromCharCode(65 + col);
    return `${letter}-${row + 1}`;
  }

  /* ---------- Ghost-Vorschau ---------- */
  showGhost(row, col, length, orientation, valid) {
    const w = orientation === "H" ? length * this.cellSize : this.cellSize;
    const h = orientation === "H" ? this.cellSize : length * this.cellSize;

    if (!this.ghost) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: valid ? 0x19b26b : 0xff4d4f,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        depthWrite: false
      });
      this.ghost = new THREE.Mesh(geo, mat);
      this.ghost.renderOrder = 2.5;
      this.group.add(this.ghost);
    }
    // Größe
    this.ghost.scale.set(w, 1, h); // Y-Skala egal (liegt im XZ)
    // Position (Mitte des belegten Streifens)
    const base = this.cellCenterLocal(row, col);
    const dx = orientation === "H" ? (length - 1) * 0.5 * this.cellSize : 0;
    const dz = orientation === "V" ? (length - 1) * 0.5 * this.cellSize : 0;
    this.ghost.position.set(base.x + dx, 0.002, base.z + dz);
    // Farbe je Validität
    this.ghost.material.color.set(valid ? 0x19b26b : 0xff4d4f);
    this.ghost.visible = true;
    this.group.updateMatrixWorld(true);
  }

  clearGhost() {
    if (this.ghost) this.ghost.visible = false;
  }

  /* ---------- Platzierung & Validierung ---------- */
  canPlaceShip(row, col, length, orientation) {
    if (orientation === "H") {
      if (col + length - 1 >= this.cells) return false;
      for (let c = col; c < col + length; c++) if (this.grid[row][c] !== 0) return false;
    } else {
      if (row + length - 1 >= this.cells) return false;
      for (let r = row; r < row + length; r++) if (this.grid[r][col] !== 0) return false;
    }
    return true;
  }

  placeShip(row, col, length, orientation) {
    if (!this.canPlaceShip(row, col, length, orientation)) return null;

    // Belegung markieren
    if (orientation === "H") {
      for (let c = col; c < col + length; c++) this.grid[row][c] = 1;
    } else {
      for (let r = row; r < row + length; r++) this.grid[r][col] = 1;
    }

    // Visuelle Repräsentation: ein Streifen (ein Mesh)
    const w = orientation === "H" ? length * this.cellSize : this.cellSize;
    const h = orientation === "H" ? this.cellSize : length * this.cellSize;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5dade2, transparent: true, opacity: 0.85,
      depthTest: true, depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2; // über Grid

    const base = this.cellCenterLocal(row, col);
    const dx = orientation === "H" ? (length - 1) * 0.5 * this.cellSize : 0;
    const dz = orientation === "V" ? (length - 1) * 0.5 * this.cellSize : 0;
    mesh.position.set(base.x + dx, 0.0015, base.z + dz);

    this.group.add(mesh);
    const ship = { row, col, length, orientation, mesh };
    this.ships.push(ship);
    this.group.updateMatrixWorld(true);
    return ship;
  }

  undoLastShip() {
    const last = this.ships.pop();
    if (!last) return null;
    const { row, col, length, orientation, mesh } = last;
    // Belegung zurücksetzen
    if (orientation === "H") {
      for (let c = col; c < col + length; c++) this.grid[row][c] = 0;
    } else {
      for (let r = row; r < row + length; r++) this.grid[r][col] = 0;
    }
    // Mesh löschen
    this.group.remove(mesh);
    mesh.geometry?.dispose();
    mesh.material?.dispose?.();
    return last;
  }

  resetFleet() {
    // alle Schiffe entfernen
    while (this.ships.length) this.undoLastShip();
  }

  /* ---------- Treffer/Miss Marker (wie zuvor) ---------- */
  markCell(row, col, color = 0xffffff, opacity = 0.9) {
    const key = `${row},${col}`;
    if (this.markers.has(key)) return;

    const r = (this.cellSize * 0.45);
    const geo = new THREE.CircleGeometry(r, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);

    const local = this.cellCenterLocal(row, col);
    mesh.position.copy(local);
    mesh.position.y += 0.002;

    mesh.renderOrder = 3; // über Schiffen
    this.group.add(mesh);
    this.markers.set(key, mesh);
    this.group.updateMatrixWorld(true);
  }

  clearMarkers() {
    this.markers.forEach(m => { this.group.remove(m); m.geometry?.dispose(); m.material?.dispose?.(); });
    this.markers.clear();
  }
}
