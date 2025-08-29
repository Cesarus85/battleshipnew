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

export const STORAGE_KEY = "ar-battleship-v1";

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

// Audio/Haptik
let audioCtx = null, masterGain = null;
let audioEnabled = true, hapticsEnabled = true;

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

function allCells(n) { const arr = []; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) arr.push([r, c]); return arr; }

/* ---------- KI-Flottenplatzierung ---------- */
export function randomizeFleet(board, lengths) {
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

/* ---------- Audio: Mini-Synth (ohne Dateien) ---------- */
export function initAudio() {
  try {
    if (!audioEnabled) return;
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.25;
      masterGain.connect(audioCtx.destination);
    } else if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  } catch {}
}

function tone(freq=440, type="sine", dur=0.12, vol=0.25) {
  if (!audioCtx || !audioEnabled) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq;
  const now = audioCtx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(vol, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.02, dur));
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

function chord(freqs=[440,550,660], dur=0.35, vol=0.18) {
  if (!audioCtx || !audioEnabled) return;
  freqs.forEach((f,i)=> tone(f, i%2 ? "triangle":"sine", dur, vol));
}

export function playEarcon(kind) {
  switch(kind) {
    case "placeBoard": tone(300, "sine", 0.08, 0.2); break;
    case "placeShip":  tone(520, "triangle", 0.08, 0.2); tone(780,"triangle",0.06,0.12); break;
    case "rotate":     tone(600, "sine", 0.05, 0.16); break;
    case "start":      tone(500,"sine",0.08,0.22); setTimeout(()=>tone(700,"sine",0.08,0.2),80); break;
    case "hit":        tone(220,"sine",0.14,0.26); setTimeout(()=>tone(140,"sine",0.12,0.22),50); break;
    case "sunk":       chord([330,415,495],0.45,0.22); break;
    case "miss":       tone(820,"triangle",0.06,0.16); break;
    case "hit_enemy":  tone(260,"sine",0.12,0.22); break;
    case "miss_enemy": tone(700,"triangle",0.05,0.14); break;
    case "error":      tone(180,"square",0.05,0.18); break;
    case "win":        chord([392,494,587],0.55,0.24); break;
    case "lose":       tone(160,"sine",0.25,0.22); break;
    case "reset":      tone(480,"sine",0.05,0.18); break;
  }
}

/* ---------- Haptik ---------- */
function buzzFromEvent(e, intensity=0.5, durationMs=80) {
  if (!hapticsEnabled || !e?.inputSource?.gamepad?.hapticActuators) return;
  try {
    for (const h of e.inputSource.gamepad.hapticActuators) {
      h?.pulse?.(Math.min(1, Math.max(0, intensity)), Math.max(1, durationMs));
    }
  } catch {}
}

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

    playerBoard = new Board(0.50, 10, { baseColor: 0x0d1b2a, shipColor: 0x5dade2, showShips: true });
    playerBoard.placeAtMatrix(baseM);
    playerBoard.addToScene(scene);

    const gap = 0.12;
    const dx = playerBoard.size + gap;
    const enemyM = offsetLocalXZ(baseM, dx, 0);
    enemyBoard = new Board(0.50, 10, { baseColor: 0x1b1430, shipColor: 0xaa66ff, showShips: false });
    enemyBoard.placeAtMatrix(enemyM);
    enemyBoard.addToScene(scene);

    reticle.visible = false;
    btnReset.disabled = false;
    if (btnMoveBoards) btnMoveBoards.disabled = false;

    setAimMode(data.aimMode || "gaze");
    orientation = data.orientation || "H";

    // Fleet Manager wiederherstellen
    fleet = new FleetManager([5,4,3,3,2]);
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
        aiState = {
          mode: data.aiState.mode,
          hitTrail: [...data.aiState.hitTrail],
          orientation: data.aiState.orientation,
          targetQueue: [...data.aiState.targetQueue],
          size: data.aiState.size
        };
      } else {
        aiState = makeAIState(playerBoard.cells);
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

export function requestLoad() {
  if (!xrSession) { markPendingLoad(); startAR("regular"); return; }
  loadState();
}
