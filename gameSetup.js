import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import { Board } from "./board.js";
import { FleetManager } from "./ships.js";
import { getLastHitPose, matrixFromTransform, offsetLocalXZ, resetLastHitPose } from "./xrSession.js";
import { makeAIState } from "./ai.js";
import {
  statusEl,
  btnReset,
  btnMoveBoards,
  hoverCellEl,
  lastPickEl,
  turnEl,
  updateFleetUI,
  setPhase,
  phase
} from "./ui.js";
import {
  playerBoard,
  enemyBoard,
  fleet,
  orientation,
  turn,
  setPlayerBoard,
  setEnemyBoard,
  setFleet,
  setOrientation,
  setTurnValue,
  scene,
  reticle,
  picker,
  aiState,
  setAIState
} from "./state.js";
import { STORAGE_KEY, saveState, loadState, getSaveSnapshot } from "./storage.js";
import { playEarcon } from "./audio.js";

export function onSqueeze() {
  if (phase === "setup") { rotateShip(); playEarcon("rotate"); saveState(); }
}

export function placeBoardsFromReticle() {
  const hitPose = getLastHitPose();
  if (!hitPose || playerBoard || enemyBoard) return;

  const baseM = new THREE.Matrix4().fromArray(hitPose.matrix ?? matrixFromTransform(hitPose));

  setPlayerBoard(new Board(0.50, 10, { baseColor: 0x0d1b2a, shipColor: 0x5dade2, showShips: true }));
  playerBoard.placeAtMatrix(baseM);
  playerBoard.addToScene(scene);

  const gap = 0.12;
  const dx = playerBoard.size + gap;
  const enemyM = offsetLocalXZ(baseM, dx, 0);
  setEnemyBoard(new Board(0.50, 10, { baseColor: 0x1b1430, shipColor: 0xaa66ff, showShips: false }));
  enemyBoard.placeAtMatrix(enemyM);
  enemyBoard.addToScene(scene);

  picker.setBoard(playerBoard);

  reticle.visible = false;
  btnReset.disabled = false;
  if (btnMoveBoards) btnMoveBoards.disabled = false;

  setFleet(new FleetManager([5,4,3,3,2]));
  setPhase("setup");
  updateFleetUI();
  statusEl.textContent = "Schiffe setzen (linkes Brett): Ziel → Trigger, Squeeze rotiert (H/V).";

  // Nach Brett-Verschiebung automatisch Spielzustand wiederherstellen
  setTimeout(() => {
    try {
      const tempData = localStorage.getItem(STORAGE_KEY + "_move_temp");
      if (tempData) {
        const savedState = JSON.parse(tempData);
        localStorage.removeItem(STORAGE_KEY + "_move_temp");

        // Neue Matrix in gespeicherten Daten einsetzen
        if (savedState.playerBoard) {
          savedState.playerBoard.matrix = Array.from(baseM.elements);
        }

        // Temporär speichern und laden
        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
        setTimeout(() => loadState(), 100);
        statusEl.textContent = "Bretter verschoben und Spielzustand wiederhergestellt.";
      }
    } catch (e) {
      console.warn("State restore after move failed:", e);
    }
  }, 200);
}

export function moveBoards() {
  // Aktuellen Spielzustand sichern
  const savedState = getSaveSnapshot();

  picker.setBoard(null);
  if (playerBoard) { playerBoard.removeFromScene(scene); playerBoard.dispose(); }
  if (enemyBoard)  { enemyBoard.removeFromScene(scene);  enemyBoard.dispose();  }

  // Temporary state clearing for repositioning
  const tempFleet = fleet;
  const tempAiState = aiState;
  const tempPhase = phase;
  const tempTurn = turn;

  setPlayerBoard(null); setEnemyBoard(null);
  setFleet(null); setAIState(null);
  resetLastHitPose();
  reticle.visible = true;
  btnReset.disabled = true;
  if (btnMoveBoards) btnMoveBoards.disabled = true;
  setPhase("placement");
  updateFleetUI();
  setTurn("player");
  hoverCellEl.textContent = "–";
  lastPickEl.textContent = "–";
  statusEl.textContent = "Bretter entfernt. Richte Reticle auf die neue Position und drücke Trigger. Der Spielzustand wird wiederhergestellt.";
  playEarcon("reset");

  // Spielzustand für automatische Wiederherstellung speichern
  try {
    localStorage.setItem(STORAGE_KEY + "_move_temp", JSON.stringify(savedState));
  } catch (e) {
    console.warn("Temp save failed:", e);
  }
}

export function rotateShip() {
  setOrientation((orientation === "H") ? "V" : "H");
  updateFleetUI();
}

export function undoShip() {
  if (!playerBoard || !fleet) return;
  const last = playerBoard.undoLastShip();
  if (!last) return;
  fleet.undo();
  updateFleetUI();
}

/* ---------- KI-Flottenplatzierung ---------- */
function randomizeFleet(board, lengths) {
  for (const L of lengths) {
    let placed = false, guard = 0;
    while (!placed && guard++ < 800) {
      const orientation = Math.random() < 0.5 ? "H" : "V";
      const row = Math.floor(Math.random() * board.cells);
      const col = Math.floor(Math.random() * board.cells);
      if (board.canPlaceShip(row, col, L, orientation)) {
        board.placeShip(row, col, L, orientation);
        placed = true;
      }
    }
    if (!placed) {
      outer: for (let r = 0; r < board.cells; r++) {
        for (let c = 0; c < board.cells; c++) {
          for (const o of ["H","V"]) {
            if (board.canPlaceShip(r, c, L, o)) { board.placeShip(r, c, L, o); placed = true; break outer; }
          }
        }
      }
    }
  }
}

export function startGame() {
  if (!fleet || !playerBoard || !enemyBoard) return;
  randomizeFleet(enemyBoard, [5,4,3,3,2]);
  setPhase("play");
  setTurn("player");
  picker.setBoard(enemyBoard);
  playerBoard.clearGhost();
  statusEl.textContent = "Spielphase: Ziel auf das rechte Brett und Trigger drücken.";
  playEarcon("start");

  // KI initialisieren
  setAIState(makeAIState(playerBoard.cells));
}

export function setTurn(t) {
  setTurnValue(t);
  turnEl.textContent = (t === "player") ? "Du bist dran" : "KI ist dran …";
}
