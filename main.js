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
import { send, onDisconnect, reconnect, onLatency } from "./net.js";
import {
  renderer, setRenderer,
  scene, setScene,
  camera, setCamera,
  reticle, setReticle,
  picker, setPicker,
  playerBoard, setPlayerBoard,
  enemyBoard, setEnemyBoard,
  remoteBoard,
  remoteTurn, setRemoteTurn,
  netPlayerId,
  fleet, setFleet,
  orientation, setOrientation,
  turn,
  aiState, setAIState,
  markAroundShip,
  gameOver
} from "./state.js";

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
  setRenderer(new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.xr.enabled = true;

  setScene(new THREE.Scene());
  setCamera(new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 20));
  scene.add(camera);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x222244, 0.8);
  scene.add(ambient);

  // Reticle (für Platzierung)
  const ringGeo = new THREE.RingGeometry(0.07, 0.075, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x7bdcff, transparent: true, opacity: 0.9 });
  setReticle(new THREE.Mesh(ringGeo, ringMat));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Picker
  setPicker(new Picker(scene));

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

onLatency((ms) => {
  if (ms && ms > 0) {
    statusEl.textContent = `Netzwerk-Verzögerung: ${Math.round(ms)} ms`;
  } else {
    statusEl.textContent = '';
  }
});

onDisconnect(async () => {
  statusEl.textContent = 'Verbindung getrennt – versuche Reconnect…';
  for (let i = 0; i < 3; i++) {
    try {
      await reconnect();
      statusEl.textContent = 'Verbindung wiederhergestellt';
      return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  statusEl.textContent = 'Reconnect fehlgeschlagen';
});

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
    send({ type: 'place', row, col, length: L, orientation });
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
    if (netPlayerId !== null) {
      if (remoteTurn) { statusEl.textContent = "Gegner ist dran …"; playEarcon("error"); return; }
      const cellEvt = getCellFromSelectEvent(e, remoteBoard) || picker.hoverCell;
      if (!cellEvt) {
        const hover = picker.hoverCell;
        if (hover) {
          remoteBoard.pulseAtCell(hover.row, hover.col, 0xff4d4f, 0.6);
          picker.flashHover(0xff4d4f);
        }
        statusEl.textContent = "Kein gültiges Feld getroffen – minimal nach unten neigen.";
        playEarcon("error"); buzzFromEvent(e, 0.1, 30); return;
      }
      const { row, col } = cellEvt;
      if (remoteBoard.shots[row][col] === 1) {
        remoteBoard.pulseAtCell(row, col, 0xff4d4f, 0.6);
        picker.flashHover(0xff4d4f);
        statusEl.textContent = "Schon beschossen. Wähle eine andere Zelle.";
        playEarcon("error"); buzzFromEvent(e, 0.1, 40); return;
      }
      send({ type: 'shot', row, col });
      lastPickEl.textContent = remoteBoard.cellLabel(row, col);
      setRemoteTurn(true);
      setTurn('ai');
      return;
    }

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


/* ---------- Reset ---------- */
export function resetAll() {
  picker.setBoard(null);
  if (playerBoard) { playerBoard.removeFromScene(scene); playerBoard.dispose(); }
  if (enemyBoard)  { enemyBoard.removeFromScene(scene);  enemyBoard.dispose();  }

  setPlayerBoard(null); setEnemyBoard(null);
  setFleet(null); setAIState(null);
  setOrientation("H");
  hoverCellEl.textContent = "–";
  lastPickEl.textContent = "–";
  setPhase("placement");
  setTurn("player");
  btnReset.disabled = true;
  if (btnMoveBoards) btnMoveBoards.disabled = true;
  statusEl.textContent = "Zurückgesetzt. Richte Reticle auf die Fläche und drücke Trigger zum Platzieren.";
  playEarcon("reset");
}

export function requestLoad() {
  if (!xrSession) { markPendingLoad(); startAR("regular"); return; }
  loadState();
}
