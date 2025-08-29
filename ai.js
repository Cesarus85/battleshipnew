import { phase, statusEl } from "./ui.js";
import { setTurn } from "./gameSetup.js";
import {
  playerBoard,
  aiState,
  setAIState,
  markAroundShip,
  playEarcon,
  gameOver,
  inBounds
} from "./main.js";

export function makeAIState(n) {
  return {
    mode: "hunt",                // "hunt" | "target"
    hitTrail: [],               // [{row,col}]
    orientation: null,          // "H" | "V" | null (wenn 2+ Treffer in Linie)
    targetQueue: [],            // priorisierte Ziele (nur orthogonale Nachbarn / Linien-Enden)
    size: n
  };
}

function aiChooseCell(board) {
  // 1) Target-Phase: bevorzuge targetQueue
  while (aiState.targetQueue.length) {
    const {row, col} = aiState.targetQueue.shift();
    if (inBounds(board, row, col) && board.shots[row][col] === 0) return [row, col];
  }

  // 2) Hunt-Phase: wähle bevorzugt Felder mit gleicher Parität (Checkerboard)
  const parityCandidates = [];
  const fallbackCandidates = [];
  for (let r = 0; r < board.cells; r++) {
    for (let c = 0; c < board.cells; c++) {
      if (board.shots[r][c] !== 0) continue;
      if ((r + c) % 2 === 0) parityCandidates.push([r, c]);
      else fallbackCandidates.push([r, c]);
    }
  }
  const candidates = parityCandidates.length ? parityCandidates : fallbackCandidates;
  if (!candidates.length) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

function aiOnHit(row, col) {
  aiState.hitTrail.push({row, col});

  if (aiState.hitTrail.length >= 2) {
    const a = aiState.hitTrail[0], b = aiState.hitTrail[1];
    aiState.orientation = (a.row === b.row) ? "H" : (a.col === b.col ? "V" : aiState.orientation);
  }

  aiState.mode = "target";

  if (!aiState.orientation) {
    enqueueCrossTargets(row, col);
  } else {
    let minR = row, maxR = row, minC = col, maxC = col;
    for (const h of aiState.hitTrail) {
      minR = Math.min(minR, h.row); maxR = Math.max(maxR, h.row);
      minC = Math.min(minC, h.col); maxC = Math.max(maxC, h.col);
    }
    if (aiState.orientation === "H") {
      aiEnqueueUnique({row: aiState.hitTrail[0].row, col: minC - 1});
      aiEnqueueUnique({row: aiState.hitTrail[0].row, col: maxC + 1});
    } else if (aiState.orientation === "V") {
      aiEnqueueUnique({row: minR - 1, col: aiState.hitTrail[0].col});
      aiEnqueueUnique({row: maxR + 1, col: aiState.hitTrail[0].col});
    }
  }
}

function aiOnMiss() {}

function aiOnSunk(ship, board) {
  markAroundShip(board, ship, true);
  setAIState(makeAIState(board.cells)); // Reset auf Hunt
}

function aiEnqueueUnique(cell) {
  if (!cell) return;
  aiState.targetQueue.push(cell);
}

function enqueueCrossTargets(r, c) {
  aiEnqueueUnique({row: r-1, col: c});
  aiEnqueueUnique({row: r+1, col: c});
  aiEnqueueUnique({row: r,   col: c-1});
  aiEnqueueUnique({row: r,   col: c+1});
}

export function aiTurn() {
  if (phase !== "play" || !playerBoard) return;

  const pick = aiChooseCell(playerBoard);
  if (!pick) return;
  const [row, col] = pick;

  const res = playerBoard.receiveShot(row, col);
  if (res.result === "hit" || res.result === "sunk") {
    playerBoard.markCell(row, col, 0xe74c3c, 0.95);
    playerBoard.pulseAtCell(row, col, 0xe74c3c, 0.6);
    if (res.result === "sunk" && res.ship) playerBoard.flashShip(res.ship, 1.0);
    playEarcon(res.result === "sunk" ? "sunk_enemy" : "hit_enemy");

    if (res.result === "sunk" && res.ship) {
      aiOnSunk(res.ship, playerBoard);
    } else {
      aiOnHit(row, col);
    }
  } else if (res.result === "miss") {
    playerBoard.markCell(row, col, 0x95a5a6, 0.9);
    playerBoard.pulseAtCell(row, col, 0x95a5a6, 0.5);
    playEarcon("miss_enemy");
    aiOnMiss();
  } else {
    return setTimeout(aiTurn, 0);
  }

  if (playerBoard.allShipsSunk()) return gameOver("ai");

  setTurn("player");
  statusEl.textContent += " Dein Zug.";
}
