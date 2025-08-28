import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

export class Board {
  constructor(sizeMeters = 0.50, cells = 10, opts = {}) {
    this.size = sizeMeters;
    this.cells = cells;
    this.baseColor = opts.baseColor ?? 0x0d1b2a;
    this.shipColor = opts.shipColor ?? 0x5dade2;
    this.showShips = opts.showShips ?? true;
    this.noTouching = opts.noTouching ?? true;

    // State
    this.grid = Array.from({length: cells}, () => Array(cells).fill(0)); // 0 empty, 1 ship
    this.shots = Array.from({length: cells}, () => Array(cells).fill(0)); // 0 unknown, 1 shot
    this.ships = []; // {row,col,length,orientation,hits,cells,meshes:[]}

    // 3D
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = true;

    // Base plane
    const baseGeo = new THREE.PlaneGeometry(this.size, this.size, 1, 1);
    baseGeo.rotateX(-Math.PI/2);
    const baseMat = new THREE.MeshStandardMaterial({color:this.baseColor, metalness:0.0, roughness:0.9, transparent:true, opacity:0.95});
    this.baseMesh = new THREE.Mesh(baseGeo, baseMat);
    this.baseMesh.receiveShadow = false;
    this.group.add(this.baseMesh);

    // Grid lines
    const lines = new THREE.Group();
    const g = new THREE.BufferGeometry();
    const verts = [];
    const step = this.size / this.cells;
    const half = this.size/2;
    for (let i=0;i<=this.cells;i++) {
      const x = -half + i*step;
      verts.push(x,0,-half, x,0,half);
      const z = -half + i*step;
      verts.push(-half,0,z, half,0,z);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
    const m = new THREE.LineBasicMaterial({color:0xffffff, opacity:0.12, transparent:true});
    const gridLines = new THREE.LineSegments(g,m);
    gridLines.position.y = 0.002;
    lines.add(gridLines);
    this.group.add(lines);

    // FX containers
    this.marksGroup = new THREE.Group(); // hit/miss discs
    this.marksGroup.position.y = 0.003;
    this.group.add(this.marksGroup);

    this.ghostGroup = new THREE.Group();
    this.ghostGroup.position.y = 0.004;
    this.group.add(this.ghostGroup);

    // Hover marker (Play-Phase Zielhilfe)
    this.hoverGroup = new THREE.Group();
    this.hoverGroup.position.y = 0.0055;
    this.group.add(this.hoverGroup);
    this._hoverMarker = null;

    this._pulses = []; // {mesh, t, dur, baseScale}
  }

  placeAtMatrix(matrix) {
    this.group.matrixAutoUpdate = false;
    this.group.matrix.copy(matrix);
    this.group.updateMatrixWorld(true);
  }

  addToScene(scene) { scene.add(this.group); }
  removeFromScene(scene) { scene.remove(this.group); }
  dispose() {}

  /* ---------- Helpers ---------- */
  cellSize() { return this.size / this.cells; }

  cellLocalCenter(row, col) {
    const step = this.cellSize();
    const half = this.size/2;
    const x = -half + step*(col + 0.5);
    const z = -half + step*(row + 0.5);
    return new THREE.Vector3(x, 0, z);
  }

  worldPosOfCell(row,col) {
    const p = this.cellLocalCenter(row,col).clone();
    p.applyMatrix4(this.group.matrixWorld);
    return p;
  }

  cellLabel(row,col) {
    const letters = "ABCDEFGHIJ";
    const r = letters[row] ?? String(row);
    return r + (col+1);
  }

  inBounds(r,c) {
    return r>=0 && r<this.cells && c>=0 && c<this.cells;
  }

  /* ---------- Placement ---------- */
  canPlaceShip(row, col, length, orientation) {
    // 1) Bounds and overlap
    if (orientation === "H") {
      if (col + length - 1 >= this.cells) return false;
      for (let c=col;c<col+length;c++) if (this.grid[row][c] !== 0) return false;
    } else {
      if (row + length - 1 >= this.cells) return false;
      for (let r=row;r<row+length;r++) if (this.grid[r][col] !== 0) return false;
    }

    // 2) No-touching (including diagonals)
    if (this.noTouching) {
      const checkNeighbors = (rr, cc) => {
        for (let dr=-1; dr<=1; dr++) {
          for (let dc=-1; dc<=1; dc++) {
            if (dr===0 && dc===0) continue;
            const r = rr+dr, c = cc+dc;
            if (!this.inBounds(r,c)) continue;
            if (this.grid[r][c] === 1) return false;
          }
        }
        return true;
      };
      if (orientation === "H") {
        for (let c=col;c<col+length;c++) if (!checkNeighbors(row,c)) return false;
      } else {
        for (let r=row;r<row+length;r++) if (!checkNeighbors(r,col)) return false;
      }
    }
    return true;
  }

  placeShip(row, col, length, orientation) {
    const cells = [];
    if (orientation === "H") {
      for (let c=col;c<col+length;c++) { this.grid[row][c] = 1; cells.push({row, col:c}); }
    } else {
      for (let r=row;r<row+length;r++) { this.grid[r][col] = 1; cells.push({row:r, col}); }
    }
    const ship = {row, col, length, orientation, hits:0, cells, meshes:[]};
    this.ships.push(ship);

    if (this.showShips) {
      for (const cell of cells) {
        const step = this.cellSize();
        const h = Math.min(0.02, step*0.15);
        const geo = new THREE.BoxGeometry(step*0.9, h, step*0.9);
        const mat = new THREE.MeshStandardMaterial({color:this.shipColor, metalness:0.05, roughness:0.55});
        const mesh = new THREE.Mesh(geo, mat);
        const p = this.cellLocalCenter(cell.row, cell.col);
        mesh.position.copy(p);
        mesh.position.y = 0.01 + (Math.random()*0.002);
        mesh.castShadow = false; mesh.receiveShadow = false;
        this.group.add(mesh);
        ship.meshes.push(mesh);
      }
    }
  }

  undoLastShip() {
    const ship = this.ships.pop();
    if (!ship) return null;
    for (const cell of ship.cells) this.grid[cell.row][cell.col] = 0;
    for (const m of ship.meshes) { this.group.remove(m); m.geometry.dispose?.(); m.material.dispose?.(); }
    return ship;
  }

  /* ---------- Ghost Preview ---------- */
  clearGhost() {
    while (this.ghostGroup.children.length) {
      const m = this.ghostGroup.children.pop();
      m.geometry.dispose?.(); m.material.dispose?.();
    }
  }
  showGhost(row, col, length, orientation, valid) {
    this.clearGhost();
    const step = this.cellSize();
    const h = Math.min(0.02, step*0.15);
    const mat = new THREE.MeshStandardMaterial({color: valid ? 0x2ecc71 : 0xe74c3c, transparent:true, opacity:0.35, metalness:0.0, roughness:1.0});
    for (let i=0;i<length;i++) {
      const r = orientation==="H" ? row : row+i;
      const c = orientation==="H" ? col+i : col;
      if (!this.inBounds(r,c)) continue;
      const geo = new THREE.BoxGeometry(step*0.9, h, step*0.9);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(this.cellLocalCenter(r,c));
      mesh.position.y = 0.012;
      this.ghostGroup.add(mesh);
    }
  }

  /* ---------- Raycast in Board Space ---------- */
  raycastCell(worldOrigin, worldDir) {
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const o = worldOrigin.clone().applyMatrix4(inv);
    const d = worldDir.clone().transformDirection(inv);
    if (Math.abs(d.y) < 1e-4) return {hit:false};
    const t = -o.y / d.y;
    if (t < 0) return {hit:false};
    const p = o.clone().addScaledVector(d, t);
    const half = this.size/2;
    if (p.x < -half || p.x > half || p.z < -half || p.z > half) return {hit:false};
    const step = this.cellSize();
    let col = Math.floor((p.x + half) / step);
    let row = Math.floor((p.z + half) / step);
    col = Math.min(this.cells-1, Math.max(0, col));
    row = Math.min(this.cells-1, Math.max(0, row));
    return {hit:true, row, col, pointLocal:p};
  }

  /* ---------- Shots / Combat ---------- */
  receiveShot(row, col) {
    if (!this.inBounds(row,col)) return {result:"repeat"};
    if (this.shots[row][col] === 1) return {result:"repeat"};
    this.shots[row][col] = 1;
    if (this.grid[row][col] === 1) {
      const ship = this.findShipAt(row,col);
      if (ship) {
        ship.hits++;
        if (ship.hits >= ship.length) return {result:"sunk", ship};
        return {result:"hit", ship};
      }
      return {result:"hit"};
    } else {
      return {result:"miss"};
    }
  }

  findShipAt(row,col) {
    for (const s of this.ships) {
      for (const cell of s.cells) if (cell.row===row && cell.col===col) return s;
    }
    return null;
  }

  allShipsSunk() {
    return this.ships.length>0 && this.ships.every(s => s.hits >= s.length);
  }

  /* ---------- Hover (Zielhilfe) ---------- */
clearHover() {
  if (this._hoverMarker) this._hoverMarker.visible = false;
}

setHoverCell(row, col) {
  if (!this.inBounds(row, col)) return this.clearHover();
  if (!this._hoverMarker) {
    const step = this.cellSize();
    const w = step * 0.92;
    const verts = new Float32Array([
      -w/2,0,-w/2,  +w/2,0,-w/2,
      +w/2,0,-w/2,  +w/2,0,+w/2,
      +w/2,0,+w/2,  -w/2,0,+w/2,
      -w/2,0,+w/2,  -w/2,0,-w/2,
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    this._hoverMarker = new THREE.LineSegments(g, m);
    this.hoverGroup.add(this._hoverMarker);
  }
  const p = this.cellLocalCenter(row, col);
  this._hoverMarker.position.set(p.x, 0, p.z);
  this._hoverMarker.visible = true;
}

/* ---------- Visual Markers ---------- */
  markCell(row, col, color=0xffffff, opacity=0.9, scale=1.0) {
    const step = this.cellSize();
    const r = Math.min(step*0.32, 0.026); // etwas kleiner
    const geo = new THREE.CylinderGeometry(r, r, 0.003, 28);
    const mat = new THREE.MeshBasicMaterial({color, opacity, transparent:true});
    const disc = new THREE.Mesh(geo, mat);
    const p = this.cellLocalCenter(row,col);
    // Wichtig: NICHT drehen -> Zylinder bleibt flach auf XZ (Deckflächen oben/unten)
    disc.position.set(p.x, 0.006, p.z);
    disc.scale.multiplyScalar(scale);
    this.marksGroup.add(disc);
    return disc;
  }

  pulseAtCell(row, col, color=0xffffff, intensity=0.6) {
    const disc = this.markCell(row, col, color, 0.9, 1.0);
    this._pulses.push({mesh:disc, t:0, dur:0.45+Math.random()*0.15, baseScale:1.0, baseOpacity:disc.material.opacity});
  }

  flashShip(ship, duration=0.8) {
    if (!ship?.meshes?.length) return;
    for (const m of ship.meshes) {
      this._pulses.push({mesh:m, t:0, dur:duration, baseScale:1.0, baseOpacity:1.0, flash:true});
    }
  }

  updateEffects(dt) {
    if (!this._pulses.length) return;
    const rm = [];
    for (let i=0;i<this._pulses.length;i++) {
      const p = this._pulses[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      if (p.flash) {
        const s = 1.0 + 0.1*Math.sin(k*Math.PI);
        p.mesh.scale.setScalar(s);
        if (p.mesh.material?.opacity !== undefined) p.mesh.material.opacity = 0.8 + 0.2*Math.sin(k*Math.PI);
      } else {
        const s = p.baseScale * (1.0 + 0.7*k);
        p.mesh.scale.setScalar(s);
        if (p.mesh.material?.opacity !== undefined) p.mesh.material.opacity = p.baseOpacity * (1.0 - k);
      }
      if (k>=1) {
        if (p.mesh.parent === this.marksGroup) {
          this.marksGroup.remove(p.mesh);
          p.mesh.geometry.dispose?.(); p.mesh.material.dispose?.();
        } else if (p.flash) {
          p.mesh.scale.setScalar(1.0);
          if (p.mesh.material?.opacity !== undefined) p.mesh.material.opacity = 1.0;
        }
        rm.push(i);
      }
    }
    for (let j=rm.length-1;j>=0;j--) this._pulses.splice(rm[j],1);
  }
}
