import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

export class Picker {
  constructor(scene) {
    this.scene = scene;
    this.board = null;
    this.hoverCell = null;
    this._lastLabel = "";
  }

  setBoard(board) {
    this.board = board || null;
    this.hoverCell = null;
  }

  updateFromCamera(camera) {
    if (!this.board) return {changed:false, cell:null};
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(origin);
    camera.getWorldDirection(dir);
    const hit = this.board.raycastCell(origin, dir);
    const cell = hit.hit ? {row: hit.row, col: hit.col} : null;
    const label = cell ? this.board.cellLabel(cell.row, cell.col) : "–";
    const changed = label !== this._lastLabel;
    this._lastLabel = label;
    this.hoverCell = cell;
    return {changed, cell};
  }

  updateWithRay(origin, dir) {
    if (!this.board) return {changed:false, cell:null};
    const hit = this.board.raycastCell(origin, dir);
    const cell = hit.hit ? {row: hit.row, col: hit.col} : null;
    const label = cell ? this.board.cellLabel(cell.row, cell.col) : "–";
    const changed = label !== this._lastLabel;
    this._lastLabel = label;
    this.hoverCell = cell;
    return {changed, cell};
  }
}
