import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import { setPhase, statusEl } from './ui.js';
import { playEarcon } from './audio.js';
import { xrSession } from './xrSession.js';

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
let statusBadge = null;

function createStatusBadge(message, isWin) {
  if (statusBadge) {
    scene.remove(statusBadge);
    statusBadge = null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = isWin ? '#2ecc71' : '#e74c3c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, canvas.width/2, canvas.height/2);
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ 
    map: texture, 
    transparent: true, 
    opacity: 0.9,
    side: THREE.DoubleSide
  });
  const geometry = new THREE.PlaneGeometry(1.0, 0.5);
  statusBadge = new THREE.Mesh(geometry, material);
  
  if (camera) {
    const cameraPos = camera.position.clone();
    const cameraDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    statusBadge.position.copy(cameraPos).add(cameraDir.multiplyScalar(2));
    statusBadge.lookAt(cameraPos);
  } else {
    statusBadge.position.set(0, 1.5, -2);
  }
  
  scene.add(statusBadge);
  return statusBadge;
}

export function gameOver(winner) {
  setPhase('gameover');
  if (picker) picker.setBoard(null);
  
  const isWin = winner === 'player';
  const enemyTxt = netPlayerId !== null ? 'Verloren' : 'KI Gewonnen';
  const message = isWin ? 'GEWONNEN!' : enemyTxt;
  const statusMsg = netPlayerId !== null ? 'Gegner hat gewonnen.' : 'KI hat gewonnen.';
  const msg = isWin ? 'Du hast gewonnen! 🎉' : statusMsg;
  
  statusEl.textContent = msg;
  playEarcon(isWin ? 'win' : 'lose');
  
  if (scene && xrSession) {
    createStatusBadge(message, isWin);
    
    setTimeout(() => {
      if (xrSession) {
        xrSession.end();
      }
    }, 3000);
  }
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
