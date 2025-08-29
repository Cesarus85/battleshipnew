// Board: Geometrie, Ghost, Flotte, Trefferlogik, Siegprüfung + Effekte
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

export class Board {
  /**
   * @param {number} sizeMeters
   * @param {number} cells
   * @param {{baseColor?:number, shipColor?:number, showShips?:boolean}} opts
   */
  constructor(sizeMeters = 0.50, cells = 10, opts = {}) {
    this.size = sizeMeters;
    this.cells = cells;
    this.cellSize = this.size / this.cells;

    this.baseColor = opts.baseColor ?? 0x0d1b2a;
    this.shipColor = opts.shipColor ?? 0x5dade2;
    this.showShips = opts.showShips ?? true;

    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;

    // Geometrie
    this._buildGeometry();

    // Matritzen
    this.matrix = new THREE.Matrix4();
    this.inverseMatrix = new THREE.Matrix4();

    // Belegung & Schüsse
    this.grid = Array.from({ length: this.cells }, () => Array(this.cells).fill(0));   // 1=Schiff
    this.shots = Array.from({ length: this.cells }, () => Array(this.cells).fill(0));  // 1=bereits beschossen
    this.hits  = Array.from({ length: this.cells }, () => Array(this.cells).fill(0));  // 1=Treffer

    this.totalShipCells = 0;
    this.hitCount = 0;

    this.ships = []; // {row,col,length,orientation,mesh,hits}

    // Marker (Treffer/Miss)
    this.markers = new Map();

    // Ghost-Mesh (Vorschau)
    this.ghost = null;

    // FX
    this.effects = []; // { type, mesh, t, life, onUpdate?(e,dt) }
  }

  _buildGeometry() {
    const baseGeo = new THREE.PlaneGeometry(this.size, this.size);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshStandardMaterial({
      color: this.baseColor, metalness: 0.0, roughness: 1.0,
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
    if (this.ghost) {
      this.group.remove(this.ghost);
      this.ghost.geometry.dispose();
      this.ghost.material.dispose();
      this.ghost = null;
    }
    // FX entsorgen
    this.effects.forEach(e => {
      this.group.remove(e.mesh);
      e.mesh.geometry?.dispose();
      e.mesh.material?.dispose?.();
    });
    this.effects = [];
  }

  /* ---------- Koordinaten & Ray ---------- */
  raycastCell(worldRayOrigin, worldRayDir) {
    const o = worldRayOrigin.clone().applyMatrix4(this.inverseMatrix);
    const d = worldRayDir.clone().transformDirection(this.inverseMatrix);

    const denom = d.y;
    if (Math.abs(denom) < 1e-7) return { hit: false };
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
  cellCenterWorld(row, col) { return this.cellCenterLocal(row, col).applyMatrix4(this.group.matrixWorld); }
  cellLabel(row, col) { return `${String.fromCharCode(65 + col)}-${row + 1}`; }

  /* ---------- Ghost-Vorschau ---------- */
  showGhost(row, col, length, orientation, valid) {
    const w = orientation === "H" ? length * this.cellSize : this.cellSize;
    const h = orientation === "H" ? this.cellSize : length * this.cellSize;

    if (!this.ghost) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: valid ? 0x19b26b : 0xff4d4f, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
      this.ghost = new THREE.Mesh(geo, mat);
      this.ghost.renderOrder = 2.5;
      this.group.add(this.ghost);
    }
    this.ghost.scale.set(w, 1, h);
    const base = this.cellCenterLocal(row, col);
    const dx = orientation === "H" ? (length - 1) * 0.5 * this.cellSize : 0;
    const dz = orientation === "V" ? (length - 1) * 0.5 * this.cellSize : 0;
    this.ghost.position.set(base.x + dx, 0.002, base.z + dz);
    this.ghost.material.color.set(valid ? 0x19b26b : 0xff4d4f);
    this.ghost.visible = true;
    this.group.updateMatrixWorld(true);
  }
  clearGhost() { if (this.ghost) this.ghost.visible = false; }

  /* ---------- Platzierung & Validierung ---------- */

  _inBounds(r, c) { return r >= 0 && r < this.cells && c >= 0 && c < this.cells; }

  // NEU: keine Berührung – auch diagonale Nachbarn sind verboten
  _hasAdjacentOccupied(r, c) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (!this._inBounds(rr, cc)) continue;
        if (this.grid[rr][cc] === 1) return true;
      }
    }
    return false;
  }

  canPlaceShip(row, col, length, orientation) {
    if (orientation === "H") {
      if (col + length - 1 >= this.cells) return false;
      for (let c = col; c < col + length; c++) {
        if (this.grid[row][c] !== 0) return false;            // Belegt?
        if (this._hasAdjacentOccupied(row, c)) return false;  // Berührungsverbot
      }
    } else {
      if (row + length - 1 >= this.cells) return false;
      for (let r = row; r < row + length; r++) {
        if (this.grid[r][col] !== 0) return false;
        if (this._hasAdjacentOccupied(r, col)) return false;
      }
    }
    return true;
  }

  placeShip(row, col, length, orientation) {
    if (!this.canPlaceShip(row, col, length, orientation)) return null;

    if (orientation === "H") for (let c = col; c < col + length; c++) this.grid[row][c] = 1;
    else for (let r = row; r < row + length; r++) this.grid[r][col] = 1;

    this.totalShipCells += length;

    const w = orientation === "H" ? length * this.cellSize : this.cellSize;
    const h = orientation === "H" ? this.cellSize : length * this.cellSize;

    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: this.shipColor, transparent: true, opacity: 0.85, depthTest: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    // Während der Setup-Phase sollen Schiffe über bereits gesetzten Markern liegen,
    // damit Marker die Platzierung nicht verdecken. Nach Spielstart kann die
    // Reihenfolge über setShipRenderOrder wieder auf 2 gesetzt werden.
    mesh.renderOrder = this.showShips ? 4 : 2;

    const base = this.cellCenterLocal(row, col);
    const dx = orientation === "H" ? (length - 1) * 0.5 * this.cellSize : 0;
    const dz = orientation === "V" ? (length - 1) * 0.5 * this.cellSize : 0;
    mesh.position.set(base.x + dx, 0.0015, base.z + dz);

    mesh.visible = this.showShips; // Gegner-Schiffe verstecken

    this.group.add(mesh);
    const ship = { row, col, length, orientation, mesh, hits: 0 };
    this.ships.push(ship);
    this.group.updateMatrixWorld(true);
    return ship;
  }

  undoLastShip() {
    const last = this.ships.pop();
    if (!last) return null;
    const { row, col, length, orientation, mesh } = last;

    if (orientation === "H") for (let c = col; c < col + length; c++) this.grid[row][c] = 0;
    else for (let r = row; r < row + length; r++) this.grid[r][col] = 0;

    this.totalShipCells -= length;

    this.group.remove(mesh);
    mesh.geometry?.dispose();
    mesh.material?.dispose?.();
    return last;
  }

  resetFleet() { while (this.ships.length) this.undoLastShip(); }

  setShipRenderOrder(order) {
    for (const s of this.ships) {
      s.mesh.renderOrder = order;
    }
  }

  /* ---------- Marker ---------- */
  markCell(row, col, color = 0xffffff, opacity = 0.9, order = 3) {
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

    mesh.renderOrder = order;
    this.group.add(mesh);
    this.markers.set(key, mesh);
    this.group.updateMatrixWorld(true);
  }

  clearMarkers() {
    this.markers.forEach(m => { this.group.remove(m); m.geometry?.dispose(); m.material?.dispose?.(); });
    this.markers.clear();
  }

  /* ---------- Schussannahme & Sieg ---------- */
  getShipAt(row, col) {
    for (const s of this.ships) {
      if (s.orientation === "H") {
        if (row === s.row && col >= s.col && col < s.col + s.length) return s;
      } else {
        if (col === s.col && row >= s.row && row < s.row + s.length) return s;
      }
    }
    return null;
  }

  receiveShot(row, col) {
    if (this.shots[row][col] === 1) return { result: "repeat" };
    this.shots[row][col] = 1;

    if (this.grid[row][col] === 1) {
      this.hits[row][col] = 1;
      this.hitCount++;

      const ship = this.getShipAt(row, col);
      if (ship) {
        ship.hits++;
        const sunk = ship.hits >= ship.length;
        return { result: sunk ? "sunk" : "hit", ship };
      }
      return { result: "hit" };
    } else {
      return { result: "miss" };
    }
  }

  registerShot(row, col, result) {
    if (this.shots[row][col] === 1) return;
    this.shots[row][col] = 1;
    if (result === "hit" || result === "sunk") {
      if (this.hits[row][col] !== 1) {
        this.hits[row][col] = 1;
        this.hitCount++;
        const ship = this.getShipAt(row, col);
        if (ship) ship.hits++;
      }
    }
  }

  allShipsSunk() {
    return this.hitCount >= this.totalShipCells && this.totalShipCells > 0;
  }

  /* ---------- FX: Pulse & Flash ---------- */
  pulseAtCell(row, col, color = 0xffffff, life = 0.6) {
    const inner = this.cellSize * 0.12;
    const outer = this.cellSize * 0.48;
    const geo = new THREE.RingGeometry(inner, outer, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.cellCenterLocal(row, col));
    mesh.position.y += 0.003;
    mesh.renderOrder = 4;
    mesh.scale.set(0.75, 0.75, 0.75);

    this.group.add(mesh);
    this.effects.push({
      type: "ring",
      mesh, t: 0, life,
      onUpdate: (e, dt) => {
        e.t += dt;
        const k = Math.min(1, e.t / e.life);
        const s = 0.75 + 0.9 * k;
        e.mesh.scale.set(s, s, s);
        e.mesh.material.opacity = 0.75 * (1 - k);
      }
    });
  }

  flashShip(ship, life = 0.9) {
    const w = ship.orientation === "H" ? ship.length * this.cellSize : this.cellSize;
    const h = ship.orientation === "H" ? this.cellSize : ship.length * this.cellSize;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.0, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    const base = this.cellCenterLocal(ship.row, ship.col);
    const dx = ship.orientation === "H" ? (ship.length - 1) * 0.5 * this.cellSize : 0;
    const dz = ship.orientation === "V" ? (ship.length - 1) * 0.5 * this.cellSize : 0;
    mesh.position.set(base.x + dx, 0.0035, base.z + dz);
    mesh.renderOrder = 4;
    this.group.add(mesh);

    this.effects.push({
      type: "flash",
      mesh, t: 0, life,
      onUpdate: (e, dt) => {
        e.t += dt;
        const k = Math.min(1, e.t / e.life);
        // 2 Pulse mit Ausklingen
        const puls = Math.max(0, Math.sin(k * Math.PI * 4)) * (1 - k);
        e.mesh.material.opacity = 0.55 * puls;
      }
    });
  }

  updateEffects(dt) {
    if (!this.effects.length) return;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.onUpdate?.(e, dt);
      if (e.t >= e.life) {
        this.group.remove(e.mesh);
        e.mesh.geometry?.dispose();
        e.mesh.material?.dispose?.();
        this.effects.splice(i, 1);
      }
    }
  }
}
