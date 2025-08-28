export class FleetManager {
  constructor(lengths = [5,4,3,3,2]) {
    this.initial = [...lengths];
    this.order = [...lengths];  // queue of lengths to place
    this.placed = [];           // [{row,col,length,orientation}]
  }

  currentLength() {
    return this.order.length ? this.order[0] : null;
  }

  advance(row, col, length, orientation) {
    // remove one length from the front if matches, else remove first occurrence
    const idx = this.order.indexOf(length);
    if (idx >= 0) this.order.splice(idx,1);
    this.placed.push({row, col, length, orientation});
  }

  undo() {
    const last = this.placed.pop();
    if (!last) return null;
    // put length back to the front so user places it again next
    this.order.unshift(last.length);
    return last;
  }

  complete() {
    return this.order.length === 0;
  }

  summary() {
    const counts = {};
    for (const L of this.initial) counts[L] = (counts[L]||0) + 1;
    for (const p of this.placed) counts[p.length]--;
    return counts;
  }
}
