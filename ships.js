// Flotten-Logik: Reihenfolge, Restzählung, Platzierungen
export class FleetManager {
  // Standard-Flotte: 5,4,3,3,2
  constructor(lengths = [5,4,3,3,2]) {
    this.order = lengths.slice();        // queue
    this.placed = [];                    // {length,row,col,orientation}
  }

  currentLength() {
    return this.order.length ? this.order[0] : null;
  }

  complete() {
    return this.order.length === 0;
  }

  advance(row, col, length, orientation) {
    if (!this.order.length || this.order[0] !== length) return;
    this.placed.push({ row, col, length, orientation });
    this.order.shift();
  }

  undo() {
    if (!this.placed.length) return null;
    const last = this.placed.pop();
    // füge Länge wieder vorn ein, damit Reihenfolge gewahrt bleibt
    this.order.unshift(last.length);
    return last;
  }

  summary() {
    // zähle pro Länge
    const cnt = {};
    for (const L of [2,3,4,5,6]) cnt[L] = 0;
    for (const L of this.order) cnt[L] = (cnt[L] || 0) + 1;
    return cnt;
  }

  reset(lengths = [5,4,3,3,2]) {
    this.order = lengths.slice();
    this.placed = [];
  }
}
