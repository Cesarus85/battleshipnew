import { setPhase, statusEl } from './ui.js';
import { playEarcon } from './audio.js';

// Rendering and scene objects
export let renderer = null;
export function setRenderer(v) { renderer = v; }
export let scene = null;
export function setScene(v) { scene = v; }
export let camera = null;
export function setCamera(v) { camera = v; }
export let reticle = null;
export function setReticle(v) { reticle = v; }
export let picker = null;
export function setPicker(v) { picker = v; }

// Game boards and fleet
export let playerBoard = null;
const playerBoardHandlers = [];
export function setPlayerBoard(v) {
  playerBoard = v;
  playerBoardHandlers.forEach(cb => {
    try { cb(v); } catch {}
  });
}
export function onPlayerBoardSet(cb) { playerBoardHandlers.push(cb); }
export function getPlayerBoard() { return playerBoard; }
export let enemyBoard = null;
export function setEnemyBoard(v) { enemyBoard = v; }
export let remoteBoard = null;
const remoteBoardHandlers = [];
export function setRemoteBoard(v) {
  remoteBoard = v;
  remoteBoardHandlers.forEach(cb => {
    try { cb(v); } catch {}
  });
}
export function onRemoteBoardSet(cb) { remoteBoardHandlers.push(cb); }
export function getRemoteBoard() { return remoteBoard; }
export let fleet = null;
export function setFleet(v) { fleet = v; }

// Setup state
export let orientation = 'H';
export function setOrientation(v) { orientation = v; }

// Turn state
export let turn = 'player';
export function setTurnValue(v) { turn = v; }
export let remoteTurn = false;
export function setRemoteTurn(v) { remoteTurn = v; }

export let netPlayerId = null;
export function setNetPlayerId(v) { netPlayerId = v; }

// AI state
export let aiState = null;
export function setAIState(v) { aiState = v; }

/* ---------- Game Over ---------- */
export function gameOver(winner) {
  setPhase('gameover');
  if (picker) picker.setBoard(null);
  const enemyTxt = netPlayerId !== null ? 'Gegner hat gewonnen.' : 'KI hat gewonnen.';
  const msg = winner === 'player' ? 'Du hast gewonnen! 🎉' : enemyTxt;
  statusEl.textContent = msg + " Tippe 'Zurücksetzen' für ein neues Spiel.";
  playEarcon(winner === 'player' ? 'win' : 'lose');
}

/* ---------- Sunk: umliegende Felder markieren ---------- */
export function markAroundShip(board, ship, setShots = true) {
  const r0 = ship.row, c0 = ship.col;
  const len = ship.length;
  const horiz = ship.orientation === 'H';

  const rStart = r0 - 1;
  const cStart = c0 - 1;
  const rEnd   = horiz ? r0 + 1 : r0 + len;
  const cEnd   = horiz ? c0 + len : c0 + 1;

  for (let r = rStart; r <= rEnd; r++) {
    for (let c = cStart; c <= cEnd; c++) {
      const isShipCell = horiz
        ? (r === r0 && c >= c0 && c < c0 + len)
        : (c === c0 && r >= r0 && r < r0 + len);
      if (!isShipCell && inBounds(board, r, c)) {
        if (board.shots[r][c] === 0) {
          if (setShots) board.shots[r][c] = 1;
          board.markCell(r, c, 0xb0b6bf, 0.65, 2.8);
        }
      }
    }
  }
}

export function inBounds(board, r, c) {
  return r >= 0 && r < board.cells && c >= 0 && c < board.cells;
}
