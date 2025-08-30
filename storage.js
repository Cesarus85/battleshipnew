import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import { Board } from "./board.js";
import { FleetManager } from "./ships.js";
import { offsetLocalXZ, xrSession } from "./xrSession.js";
import {
  statusEl,
  btnReset,
  btnMoveBoards,
  setAimMode,
  setPhase,
  updateFleetUI,
  aimMode,
  phase
} from "./ui.js";
import { makeAIState } from "./ai.js";
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
  aiState,
  setAIState,
  reticle,
  scene,
  picker
} from "./state.js";
import { resetAll } from "./main.js";
import { setTurn } from "./gameSetup.js";

export const STORAGE_KEY = "ar-battleship-v1";

/* ---------- Persistenz (LocalStorage) ---------- */
export function getSaveSnapshot() {
  const snap = { v: 2, aimMode, orientation, phase, turn, playerBoard: null, enemyBoard: null, aiState: null };
  if (playerBoard) {
    snap.playerBoard = {
      size: playerBoard.size,
      cells: playerBoard.cells,
      matrix: Array.from(playerBoard.matrix.elements),
      ships: fleet ? fleet.placed.map(s => ({ row: s.row, col: s.col, length: s.length, orientation: s.orientation })) : [],
      shots: playerBoard.shots.map(row => [...row]),
      hits: playerBoard.hits.map(row => [...row]),
      hitCount: playerBoard.hitCount
    };
  }
  if (enemyBoard) {
    snap.enemyBoard = {
      size: enemyBoard.size,
      cells: enemyBoard.cells,
      ships: enemyBoard.ships.map(s => ({ row: s.row, col: s.col, length: s.length, orientation: s.orientation })),
      shots: enemyBoard.shots.map(row => [...row]),
      hits: enemyBoard.hits.map(row => [...row]),
      hitCount: enemyBoard.hitCount
    };
  }
  if (aiState) {
    snap.aiState = {
      mode: aiState.mode,
      hitTrail: [...aiState.hitTrail],
      orientation: aiState.orientation,
      targetQueue: [...aiState.targetQueue],
      size: aiState.size
    };
  }
  return snap;
}

export function saveState(manual=false) {
  try {
    const data = getSaveSnapshot();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (manual) statusEl.textContent = "Gespeichert.";
  } catch (e) {
    statusEl.textContent = "Speichern fehlgeschlagen: " + (e?.message || e);
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { statusEl.textContent = "Kein gespeicherter Stand gefunden."; return; }
    const data = JSON.parse(raw);
    if (!xrSession) { statusEl.textContent = "Bitte AR starten, dann laden."; return; }

    // Vorhandenes Spiel leeren
    if (playerBoard || enemyBoard) resetAll();

    // Boards aus Matrix wiederherstellen
    const baseM = new THREE.Matrix4().fromArray(data?.playerBoard?.matrix || []);
    if (!baseM || baseM.elements.every(x => x === 0)) { statusEl.textContent = "Ungültige gespeicherte Pose."; return; }

    setPlayerBoard(new Board(0.50, 10, { baseColor: 0x0d1b2a, shipColor: 0x5dade2, showShips: true }));
    playerBoard.placeAtMatrix(baseM);
    playerBoard.addToScene(scene);

    const gap = 0.12;
    const dx = playerBoard.size + gap;
    const enemyM = offsetLocalXZ(baseM, dx, 0);
    setEnemyBoard(new Board(0.50, 10, { baseColor: 0x1b1430, shipColor: 0xaa66ff, showShips: false }));
    enemyBoard.placeAtMatrix(enemyM);
    enemyBoard.addToScene(scene);

    reticle.visible = false;
    btnReset.disabled = false;
    if (btnMoveBoards) btnMoveBoards.disabled = false;

    setAimMode(data.aimMode || "controller");
    setOrientation(data.orientation || "H");

    // Fleet Manager wiederherstellen
    setFleet(new FleetManager([5,4,3,3,2]));
    const placed = (data?.playerBoard?.ships || []);
    for (const s of placed) {
      if (playerBoard.canPlaceShip(s.row, s.col, s.length, s.orientation)) {
        playerBoard.placeShip(s.row, s.col, s.length, s.orientation);
        fleet.advance(s.row, s.col, s.length, s.orientation);
      } else {
        console.warn("Gespeichertes Schiff passt nicht mehr (Berührungsregel aktiv). Übersprungen:", s);
      }
    }

    // Spielzustand wiederherstellen
    const savedPhase = data.phase || "setup";
    const savedTurn = data.turn || "player";

    if (savedPhase === "play" && data.enemyBoard) {
      // Feindliches Board mit Schiffen wiederherstellen
      const enemyShips = data.enemyBoard.ships || [];
      for (const s of enemyShips) {
        if (enemyBoard.canPlaceShip(s.row, s.col, s.length, s.orientation)) {
          enemyBoard.placeShip(s.row, s.col, s.length, s.orientation);
        }
      }

      // Shots und Hits wiederherstellen
      if (data.playerBoard.shots) {
        playerBoard.shots = data.playerBoard.shots.map(row => [...row]);
        playerBoard.hits = data.playerBoard.hits.map(row => [...row]);
        playerBoard.hitCount = data.playerBoard.hitCount || 0;
      }
      if (data.enemyBoard.shots) {
        enemyBoard.shots = data.enemyBoard.shots.map(row => [...row]);
        enemyBoard.hits = data.enemyBoard.hits.map(row => [...row]);
        enemyBoard.hitCount = data.enemyBoard.hitCount || 0;
      }

      // Marker auf den Boards wiederherstellen
      for (let r = 0; r < playerBoard.cells; r++) {
        for (let c = 0; c < playerBoard.cells; c++) {
          if (playerBoard.shots[r][c] === 1) {
            const color = playerBoard.hits[r][c] === 1 ? 0xe74c3c : 0x95a5a6;
            playerBoard.markCell(r, c, color, 0.9);
          }
        }
      }
      for (let r = 0; r < enemyBoard.cells; r++) {
        for (let c = 0; c < enemyBoard.cells; c++) {
          if (enemyBoard.shots[r][c] === 1) {
            const color = enemyBoard.hits[r][c] === 1 ? 0x2ecc71 : 0xd0d5de;
            enemyBoard.markCell(r, c, color, 0.9);
          }
        }
      }

      // KI-Zustand wiederherstellen
      if (data.aiState) {
        setAIState({
          mode: data.aiState.mode,
          hitTrail: [...data.aiState.hitTrail],
          orientation: data.aiState.orientation,
          targetQueue: [...data.aiState.targetQueue],
          size: data.aiState.size
        });
      } else {
        setAIState(makeAIState(playerBoard.cells));
      }

      setPhase("play");
      setTurn(savedTurn);
      picker.setBoard(savedTurn === "player" ? enemyBoard : null);
      statusEl.textContent = "Spielstand geladen. Spiel läuft weiter.";
    } else {
      setPhase("setup");
      picker.setBoard(playerBoard);
      statusEl.textContent = "Spielstand geladen. Du kannst weiter Schiffe setzen oder 'Spiel starten' drücken.";
    }

    updateFleetUI();
  } catch (e) {
    statusEl.textContent = "Laden fehlgeschlagen: " + (e?.message || e);
    console.error("Load error:", e);
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    statusEl.textContent = "Lokaler Speicher gelöscht.";
  } catch (e) {
    statusEl.textContent = "Löschen fehlgeschlagen: " + (e?.message || e);
  }
}
