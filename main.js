// AR + Diagnose + Zielmodus + Trigger-Placement + Setup + KI-Runden (Hunt/Target) + AUTO-START
// + Audio-Earcons + Haptik + Treffer-Animationen + präziser Select-Ray + Persistenz
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import { Board } from "./board.js";
import { Picker } from "./picking.js";
import { FleetManager } from "./ships.js";
import {
  canvas,
  overlay,
  statusEl,
  btnStart,
  btnStartSafe,
  btnReset,
  hoverCellEl,
  lastPickEl,
  btnMoveBoards,
  turnEl,
  wireUI,
  setAimMode,
  setPhase,
  diagnose,
  updateFleetUI,
  aimMode,
  phase
} from "./ui.js";

import {
  startAR,
  getCellFromSelectEvent,
  offsetLocalXZ,
  xrSession
} from "./xrSession.js";

import {
  onSqueeze,
  placeBoardsFromReticle,
  moveBoards,
  rotateShip,
  undoShip,
  startGame,
  setTurn
} from "./gameSetup.js";

import { aiTurn, makeAIState } from "./ai.js";
import { initAudio, playEarcon, buzzFromEvent } from "./audio.js";
import { saveState, loadState } from "./storage.js";

export { startAR };
export {
  onSqueeze,
  placeBoardsFromReticle,
  moveBoards,
  rotateShip,
  undoShip,
  startGame,
  setTurn
};

export let renderer, scene, camera;
export let reticle = null;

// Zwei Boards
export let playerBoard = null;
export function setPlayerBoard(v) { playerBoard = v; }
export let enemyBoard = null;
export function setEnemyBoard(v) { enemyBoard = v; }

export let picker = null;
export let fleet = null;
export function setFleet(v) { fleet = v; }

// Setup-State
export let orientation = "H"; // "H" oder "V"
export function setOrientation(v) { orientation = v; }

// Runden-State
export let turn = "player"; // "player" | "ai"
export function setTurnValue(v) { turn = v; }

// --- NEU: KI-Zustand (Hunt/Target) ---
export let aiState = null;
export function setAIState(v) { aiState = v; }

// Laden vorm AR-Start vormerken
let pendingLoad = false;

export function markPendingLoad() { pendingLoad = true; }
export function checkPendingLoad() {
  if (pendingLoad) {
    pendingLoad = false;
    setTimeout(() => loadState(), 200);
  }
}

function initGL() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.xr.enabled = true;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 20);
  scene.add(camera);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x222244, 0.8);
  scene.add(ambient);

  // Reticle (für Platzierung)
  const ringGeo = new THREE.RingGeometry(0.07, 0.075, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x7bdcff, transparent: true, opacity: 0.9 });
  reticle = new THREE.Mesh(ringGeo, ringMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Picker
  picker = new Picker(scene);

  window.addEventListener("resize", onResize);
  setPhase("placement");
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

initGL();
wireUI();
diagnose().catch(()=>{});

/* ---------- Select: präziser Ray + Audio/Haptik/FX ---------- */
export function onSelect(e) {
  initAudio();

  if (phase === "placement") { placeBoardsFromReticle(); buzzFromEvent(e, 0.2, 30); playEarcon("placeBoard"); saveState(); return; }

  if (phase === "setup") {
    const cellEvt = getCellFromSelectEvent(e, playerBoard) || picker.hoverCell;
    if (!cellEvt) { statusEl.textContent = "Kein gültiges Feld getroffen – minimal nach unten neigen."; playEarcon("error"); buzzFromEvent(e, 0.1, 30); return; }
    const { row, col } = cellEvt;

    const L = fleet.currentLength(); if (!L) return;
    const ok = playerBoard.canPlaceShip(row, col, L, orientation);
    if (!ok) { statusEl.textContent = "Ungültige Position (außerhalb, Kollision oder Berührung)."; playEarcon("error"); buzzFromEvent(e, 0.1, 40); return; }

    playerBoard.placeShip(row, col, L, orientation);
    fleet.advance(row, col, L, orientation);
    lastPickEl.textContent = playerBoard.cellLabel(row, col);
    updateFleetUI();
    playerBoard.clearGhost();
    // leichte Bestätigung
    playEarcon("placeShip"); buzzFromEvent(e, 0.15, 40);
    saveState();

    // Auto-Start
    if (fleet.complete()) {
      statusEl.textContent = "Flotte komplett – Spiel startet …";
      playEarcon("start");
      setTimeout(() => { if (phase === "setup") startGame(); }, 300);
    }
    return;
  }

  if (phase === "play") {
    if (turn !== "player") { statusEl.textContent = "KI ist dran …"; playEarcon("error"); return; }
    const cellEvt = getCellFromSelectEvent(e, enemyBoard) || picker.hoverCell;
    if (!cellEvt) {
      const hover = picker.hoverCell;
      if (hover) {
        enemyBoard.pulseAtCell(hover.row, hover.col, 0xff4d4f, 0.6);
        picker.flashHover(0xff4d4f);
      }
      statusEl.textContent = "Kein gültiges Feld getroffen – minimal nach unten neigen.";
      playEarcon("error"); buzzFromEvent(e, 0.1, 30); return;
    }
    const { row, col } = cellEvt;

    const res = enemyBoard.receiveShot(row, col);
    if (res.result === "repeat") {
      const hover = picker.hoverCell;
      if (hover) {
        enemyBoard.pulseAtCell(hover.row, hover.col, 0xff4d4f, 0.6);
        picker.flashHover(0xff4d4f);
      }
      statusEl.textContent = "Schon beschossen. Wähle eine andere Zelle.";
      playEarcon("error"); buzzFromEvent(e, 0.1, 40); return;
    }

    if (res.result === "hit" || res.result === "sunk") {
      enemyBoard.markCell(row, col, 0x2ecc71, 0.9);
      enemyBoard.pulseAtCell(row, col, 0x2ecc71, 0.6);
      playEarcon(res.result === "sunk" ? "sunk" : "hit");
      buzzFromEvent(e, res.result === "sunk" ? 0.9 : 0.6, res.result === "sunk" ? 220 : 120);
      if (res.result === "sunk" && res.ship) {
        enemyBoard.flashShip(res.ship, 1.0);
        // umliegende Felder beim Gegner markieren (Spieler-Ansicht)
        markAroundShip(enemyBoard, res.ship, true);
      }
    } else {
      enemyBoard.markCell(row, col, 0xd0d5de, 0.9);
      enemyBoard.pulseAtCell(row, col, 0xd0d5de, 0.5);
      playEarcon("miss");
      buzzFromEvent(e, 0.2, 60);
    }
    lastPickEl.textContent = enemyBoard.cellLabel(row, col);

    if (enemyBoard.allShipsSunk()) return gameOver("player");

    setTurn("ai");
    setTimeout(aiTurn, 650);
  }
}


/* ---------- Game Over ---------- */
export function gameOver(winner) {
  setPhase("gameover");
  picker.setBoard(null);
  const msg = (winner === "player") ? "Du hast gewonnen! 🎉" : "KI hat gewonnen.";
  statusEl.textContent = msg + " Tippe 'Zurücksetzen' für ein neues Spiel.";
  playEarcon(winner === "player" ? "win" : "lose");
}

/* ---------- Reset ---------- */
export function resetAll() {
  picker.setBoard(null);
  if (playerBoard) { playerBoard.removeFromScene(scene); playerBoard.dispose(); }
  if (enemyBoard)  { enemyBoard.removeFromScene(scene);  enemyBoard.dispose();  }

  playerBoard = null; enemyBoard = null;
  fleet = null; aiState = null;
  orientation = "H";
  hoverCellEl.textContent = "–";
  lastPickEl.textContent = "–";
  setPhase("placement");
  setTurn("player");
  btnReset.disabled = true;
  if (btnMoveBoards) btnMoveBoards.disabled = true;
  statusEl.textContent = "Zurückgesetzt. Richte Reticle auf die Fläche und drücke Trigger zum Platzieren.";
  playEarcon("reset");
}

/* ---------- Sunk: umliegende Felder markieren ---------- */
export function markAroundShip(board, ship, setShots=true) {
  const r0 = ship.row, c0 = ship.col;
  const len = ship.length;
  const horiz = ship.orientation === "H";

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

export function requestLoad() {
  if (!xrSession) { markPendingLoad(); startAR("regular"); return; }
  loadState();
}
