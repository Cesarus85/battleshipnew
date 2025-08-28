// AR + Diagnose + Zielmodus + Trigger-Placement + Setup + KI-Runden + AUTO-START
// + Audio-Earcons + Haptik + Treffer-Animationen + präziser Select-Ray
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
import { Board } from "./board.js";
import { Picker } from "./picking.js";
import { FleetManager } from "./ships.js";

const canvas = document.getElementById("xr-canvas");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnStartSafe = document.getElementById("btnStartSafe");
const btnReset = document.getElementById("btnReset");
const hoverCellEl = document.getElementById("hoverCell");
const lastPickEl = document.getElementById("lastPick");
const btnAimGaze = document.getElementById("btnAimGaze");
const btnAimController = document.getElementById("btnAimController");
const aimInfoEl = document.getElementById("aimInfo");
const debugEl = document.getElementById("debug");
const btnDiag = document.getElementById("btnDiag");
const btnPerms = document.getElementById("btnPerms");

// Setup UI
const phaseEl = document.getElementById("phase");
const fleetEl = document.getElementById("fleet");
const btnRotate = document.getElementById("btnRotate");
const btnUndo = document.getElementById("btnUndo");
const btnStartGame = document.getElementById("btnStartGame"); // optional (evtl. hidden)
const turnEl = document.getElementById("turn");

let renderer, scene, camera;
let xrSession = null;
let localRefSpace = null;
let viewerSpace = null;
let hitTestSource = null;
let reticle = null;
let lastHitPose = null;

let prevTime = null;

// Zwei Boards
let playerBoard = null;
let enemyBoard = null;

let picker = null;
let fleet = null;

// Zielmodus: "gaze" | "controller"
let aimMode = "gaze";

// Game-Phase
let phase = "placement";

// Setup-State
let orientation = "H"; // "H" oder "V"

// Runden-State
let turn = "player"; // "player" | "ai"
let aiCandidates = null;

// Audio/Haptik
let audioCtx = null, masterGain = null;
let audioEnabled = true, hapticsEnabled = true;

initGL();
wireUI();
diagnose().catch(()=>{});

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

function wireUI() {
  btnStart.addEventListener("click", () => { initAudio(); startAR("regular"); });
  btnStartSafe.addEventListener("click", () => { initAudio(); startAR("safe"); });
  btnReset.addEventListener("click", resetAll);

  btnAimGaze.addEventListener("click", () => setAimMode("gaze"));
  btnAimController.addEventListener("click", () => setAimMode("controller"));

  btnDiag.addEventListener("click", () => diagnose());
  btnPerms.addEventListener("click", () => {
    statusEl.textContent = "Quest-Browser → Seiteneinstellungen: 'Passthrough/AR' & 'Bewegung/Tracking' erlauben. Falls abgelehnt: Berechtigungen zurücksetzen und Seite neu laden.";
  });

  btnRotate.addEventListener("click", () => { initAudio(); rotateShip(); });
  btnUndo.addEventListener("click", () => { initAudio(); undoShip(); });
  if (btnStartGame) btnStartGame.addEventListener("click", () => { initAudio(); startGame(); });
}

function setAimMode(mode) {
  aimMode = mode;
  btnAimGaze.classList.toggle("active", aimMode === "gaze");
  btnAimController.classList.toggle("active", aimMode === "controller");
  aimInfoEl.textContent = aimMode === "gaze" ? "Zielen über Kopfblick." : "Zielen über Hand/Controller-Ray.";
}

function setPhase(p) {
  phase = p;
  phaseEl.textContent = p;
}

async function diagnose() {
  const lines = [];
  const ua = navigator.userAgent || "n/a";
  lines.push(`User-Agent: ${ua}`);
  lines.push(`Secure Context: ${window.isSecureContext} (${location.protocol})`);
  lines.push(`navigator.xr: ${!!navigator.xr}`);
  try {
    const arSup = await navigator.xr?.isSessionSupported?.("immersive-ar");
    const vrSup = await navigator.xr?.isSessionSupported?.("immersive-vr");
    lines.push(`isSessionSupported('immersive-ar'): ${arSup}`);
    lines.push(`isSessionSupported('immersive-vr'): ${vrSup}`);
  } catch (e) {
    lines.push(`isSessionSupported() Fehler: ${e?.name} – ${e?.message}`);
  }
  debugEl.innerHTML = `<strong>Diagnose</strong>\n${lines.join("\n")}\n\nTipps:\n• HTTPS nötig (https:// oder https://localhost)\n• Quest-Browser aktuell?\n• Berechtigungen erteilt?`;
}

async function startAR(mode = "regular") {
  if (!navigator.xr) { statusEl.textContent = "WebXR nicht verfügbar. Bitte Meta/Quest-Browser verwenden."; await diagnose(); return; }
  try {
    const supported = await navigator.xr.isSessionSupported?.("immersive-ar");
    if (supported === false) { statusEl.textContent = "Dieser Browser unterstützt 'immersive-ar' nicht. Bitte Quest-Browser updaten."; await diagnose(); return; }
    const configs = mode === "safe"
      ? [
          { note: "SAFE: minimale Features", init: { requiredFeatures: [], optionalFeatures: [] } },
          { note: "SAFE: optional hit-test", init: { requiredFeatures: [], optionalFeatures: ["hit-test"] } },
        ]
      : [
          { note: "regular: hit-test + optional dom-overlay", init: { requiredFeatures: ["hit-test"], optionalFeatures: ["dom-overlay", "anchors", "hand-tracking"], domOverlay: { root: overlay } } },
          { note: "regular-fallback: hit-test (kein dom-overlay)", init: { requiredFeatures: ["hit-test"], optionalFeatures: ["anchors", "hand-tracking"] } },
        ];
    let lastErr = null;
    for (const cfg of configs) {
      try { xrSession = await navigator.xr.requestSession("immersive-ar", cfg.init); statusEl.textContent = `AR gestartet (${cfg.note}).`; break; }
      catch (e) { lastErr = e; }
    }
    if (!xrSession) throw lastErr || new Error("requestSession fehlgeschlagen (unbekannt)");

    renderer.xr.setReferenceSpaceType("local");
    await renderer.xr.setSession(xrSession);

    xrSession.addEventListener("end", onSessionEnd);
    xrSession.addEventListener("select", onSelect);
    xrSession.addEventListener("squeezestart", onSqueeze);
    xrSession.addEventListener("inputsourceschange", onInputSourcesChange);

    localRefSpace = await xrSession.requestReferenceSpace("local");
    viewerSpace = await xrSession.requestReferenceSpace("viewer");

    try { hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace }); statusEl.textContent += " | hit-test aktiv."; }
    catch { hitTestSource = null; statusEl.textContent += " | hit-test NICHT verfügbar."; }

    btnStart.disabled = true; btnStartSafe.disabled = true;
    btnReset.disabled = true;
    setAimMode(aimMode);
    setPhase("placement");
    prevTime = null;
    renderer.setAnimationLoop(onXRFrame);
  } catch (err) {
    statusEl.textContent = `AR-Start fehlgeschlagen: ${err?.name || "Error"} – ${err?.message || err}`;
  }
}

function onSessionEnd() {
  renderer.setAnimationLoop(null);
  xrSession?.removeEventListener("select", onSelect);
  xrSession?.removeEventListener("squeezestart", onSqueeze);
  xrSession?.removeEventListener("inputsourceschange", onInputSourcesChange);
  xrSession = null; hitTestSource = null; lastHitPose = null;
  reticle.visible = false;
  btnStart.disabled = false; btnStartSafe.disabled = false;
  btnReset.disabled = !!playerBoard;
  aimInfoEl.textContent = "";
  setPhase("placement");
}

function onInputSourcesChange() {
  if (!xrSession) return;
  const src = pickActiveInputSource();
  aimInfoEl.textContent = src
    ? (aimMode === "controller" ? `Ray aktiv: ${src.handedness || "neutral"}` : "Zielen über Kopfblick.")
    : (aimMode === "controller" ? "Kein Hand/Controller-Ray." : "Zielen über Kopfblick.");
}

function onXRFrame(time, frame) {
  if (!frame) return;
  // delta
  if (prevTime == null) prevTime = time;
  const dt = Math.min(0.1, (time - prevTime) / 1000);
  prevTime = time;

  if (phase === "placement") {
    const results = hitTestSource ? frame.getHitTestResults(hitTestSource) : [];
    if (results.length > 0) {
      const pose = results[0].getPose(localRefSpace);
      lastHitPose = pose && pose.transform;
      if (lastHitPose) {
        const m = new THREE.Matrix4().fromArray(lastHitPose.matrix ?? matrixFromTransform(lastHitPose));
        reticle.visible = true; reticle.matrix.copy(m);
      }
    } else { reticle.visible = false; }
  } else if (phase === "setup") {
    picker.setBoard(playerBoard);
    const cell = updateHover();
    if (playerBoard && cell) {
      const L = fleet.currentLength();
      const valid = playerBoard.canPlaceShip(cell.row, cell.col, L, orientation);
      playerBoard.showGhost(cell.row, cell.col, L, orientation, valid);
    } else if (playerBoard) { playerBoard.clearGhost(); }
  } else if (phase === "play") {
    if (turn === "player") {
      picker.setBoard(enemyBoard);
      const cell = updateHover();
      if (cell) enemyBoard.setHoverCell(cell.row, cell.col);
      else enemyBoard.clearHover();
    } else {
      picker.setBoard(null);
      enemyBoard?.clearHover();
    }
  }

  // FX updaten
  playerBoard?.updateEffects?.(dt);
  enemyBoard?.updateEffects?.(dt);

  renderer.render(scene, camera);
}

function updateHover() {
  if (!picker.board) return null;
  if (aimMode === "gaze") {
    const { changed, cell } = picker.updateFromCamera(camera);
    if (changed) hoverCellEl.textContent = cell ? picker.board.cellLabel(cell.row, cell.col) : "–";
    return picker.hoverCell || null;
  } else {
    const src = pickActiveInputSource();
    if (!src) { picker.updateWithRay(new THREE.Vector3(1e6,1e6,1e6), new THREE.Vector3(0,-1,0)); return null; }
    const pose = renderer.xr.getFrame().getPose(src.targetRaySpace, localRefSpace);
    if (!pose) return null;
    const { origin, dir } = originDirFromXRPose(pose);
    const { changed, cell } = picker.updateWithRay(origin, dir);
    if (changed) hoverCellEl.textContent = cell ? picker.board.cellLabel(cell.row, cell.col) : "–";
    return picker.hoverCell || null;
  }
}

/* ---------- Select: präziser Ray + Audio/Haptik/FX ---------- */
function onSelect(e) {
  initAudio();

  if (phase === "placement") { placeBoardsFromReticle(); buzzFromEvent(e, 0.2, 30); playEarcon("placeBoard"); return; }

  if (phase === "setup") {
    const cellEvt = getCellFromSelectEvent(e, playerBoard) || picker.hoverCell;
    if (!cellEvt) { statusEl.textContent = "Kein gültiges Feld getroffen – minimal nach unten neigen."; playEarcon("error"); buzzFromEvent(e, 0.1, 30); return; }
    const { row, col } = cellEvt;

    const L = fleet.currentLength(); if (!L) return;
    const ok = playerBoard.canPlaceShip(row, col, L, orientation);
    if (!ok) { statusEl.textContent = "Ungültige Position (außerhalb oder Kollision)."; playEarcon("error"); buzzFromEvent(e, 0.1, 40); return; }

    playerBoard.placeShip(row, col, L, orientation);
    fleet.advance(row, col, L, orientation);
    lastPickEl.textContent = playerBoard.cellLabel(row, col);
    updateFleetUI();
    playerBoard.clearGhost();
    // leichte Bestätigung
    playEarcon("placeShip"); buzzFromEvent(e, 0.15, 40);

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
    if (!cellEvt) { statusEl.textContent = "Kein gültiges Feld getroffen – minimal nach unten neigen."; playEarcon("error"); buzzFromEvent(e, 0.1, 30); return; }
    const { row, col } = cellEvt;

    const res = enemyBoard.receiveShot(row, col);
    if (res.result === "repeat") { statusEl.textContent = "Schon beschossen. Wähle eine andere Zelle."; playEarcon("error"); buzzFromEvent(e, 0.1, 40); return; }

    if (res.result === "hit" || res.result === "sunk") {
      enemyBoard.markCell(row, col, 0x2ecc71, 0.9);
      enemyBoard.pulseAtCell(row, col, 0x2ecc71, 0.6);
      playEarcon(res.result === "sunk" ? "sunk" : "hit");
      buzzFromEvent(e, res.result === "sunk" ? 0.9 : 0.6, res.result === "sunk" ? 220 : 120);
      if (res.result === "sunk" && res.ship) enemyBoard.flashShip(res.ship, 1.0);
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

function onSqueeze() {
  if (phase === "setup") { rotateShip(); playEarcon("rotate"); }
}

/* ---------- Boards platzieren ---------- */
function placeBoardsFromReticle() {
  if (!lastHitPose || playerBoard || enemyBoard) return;

  const baseM = new THREE.Matrix4().fromArray(lastHitPose.matrix ?? matrixFromTransform(lastHitPose));

  playerBoard = new Board(0.50, 10, { baseColor: 0x0d1b2a, shipColor: 0x5dade2, showShips: true });
  playerBoard.placeAtMatrix(baseM);
  playerBoard.addToScene(scene);

  const gap = 0.12;
  const dx = playerBoard.size + gap;
  const enemyM = offsetLocalXZ(baseM, dx, 0);
  enemyBoard = new Board(0.50, 10, { baseColor: 0x1b1430, shipColor: 0xaa66ff, showShips: false });
  enemyBoard.placeAtMatrix(enemyM);
  enemyBoard.addToScene(scene);

  picker.setBoard(playerBoard);

  reticle.visible = false;
  btnReset.disabled = false;

  fleet = new FleetManager([5,4,3,3,2]);
  setPhase("setup");
  updateFleetUI();
  statusEl.textContent = "Schiffe setzen (linkes Brett): Ziel → Trigger, Squeeze rotiert (H/V).";
}

/* ---------- Spielsteuerung ---------- */
function rotateShip() {
  orientation = (orientation === "H") ? "V" : "H";
  updateFleetUI();
}

function undoShip() {
  if (!playerBoard || !fleet) return;
  const last = playerBoard.undoLastShip();
  if (!last) return;
  fleet.undo();
  updateFleetUI();
}

function startGame() {
  if (!fleet || !playerBoard || !enemyBoard) return;
  randomizeFleet(enemyBoard, [5,4,3,3,2]);
  setPhase("play");
  setTurn("player");
  picker.setBoard(enemyBoard);
  playerBoard.clearGhost();
  statusEl.textContent = "Spielphase: Ziel auf das rechte Brett und Trigger drücken.";
  playEarcon("start");
}

function setTurn(t) {
  turn = t;
  turnEl.textContent = (t === "player") ? "Du bist dran" : "KI ist dran …";
  if (t !== "player") enemyBoard?.clearHover();
}

/* ---------- KI (Random, ohne Wiederholung) ---------- */
function aiTurn() {
  if (phase !== "play" || !playerBoard) return;

  if (!aiCandidates) aiCandidates = allCells(playerBoard.cells);
  aiCandidates = aiCandidates.filter(([r, c]) => playerBoard.shots[r][c] === 0);
  if (aiCandidates.length === 0) return;

  const idx = Math.floor(Math.random() * aiCandidates.length);
  const [row, col] = aiCandidates[idx];

  const res = playerBoard.receiveShot(row, col);
  if (res.result === "hit" || res.result === "sunk") {
    playerBoard.markCell(row, col, 0xe74c3c, 0.95);
    playerBoard.pulseAtCell(row, col, 0xe74c3c, 0.6);
    if (res.result === "sunk" && res.ship) playerBoard.flashShip(res.ship, 1.0);
    playEarcon(res.result === "sunk" ? "sunk_enemy" : "hit_enemy");
  } else if (res.result === "miss") {
    playerBoard.markCell(row, col, 0x95a5a6, 0.9);
    playerBoard.pulseAtCell(row, col, 0x95a5a6, 0.5);
    playEarcon("miss_enemy");
  } else {
    return setTimeout(aiTurn, 0);
  }

  if (playerBoard.allShipsSunk()) return gameOver("ai");

  setTurn("player");
  statusEl.textContent += " Dein Zug.";
}

/* ---------- Game Over ---------- */
function gameOver(winner) {
  enemyBoard?.clearHover();
  setPhase("gameover");
  picker.setBoard(null);
  const msg = (winner === "player") ? "Du hast gewonnen! 🎉" : "KI hat gewonnen.";
  statusEl.textContent = msg + " Tippe 'Zurücksetzen' für ein neues Spiel.";
  playEarcon(winner === "player" ? "win" : "lose");
}

/* ---------- Reset ---------- */
function resetAll() {
  enemyBoard?.clearHover();
  picker.setBoard(null);
  if (playerBoard) { playerBoard.removeFromScene(scene); playerBoard.dispose(); }
  if (enemyBoard)  { enemyBoard.removeFromScene(scene);  enemyBoard.dispose();  }

  playerBoard = null; enemyBoard = null;
  fleet = null; aiCandidates = null;
  orientation = "H";
  hoverCellEl.textContent = "–";
  lastPickEl.textContent = "–";
  setPhase("placement");
  setTurn("player");
  btnReset.disabled = true;
  statusEl.textContent = "Zurückgesetzt. Richte Reticle auf die Fläche und drücke Trigger zum Platzieren.";
  playEarcon("reset");
}

/* ---------- UI Helfer ---------- */
function updateFleetUI() {
  phaseEl.textContent = phase + (phase === "setup" ? ` (Ori: ${orientation})` : "");
  if (!fleet) { fleetEl.innerHTML = ""; btnUndo.disabled = true; if (btnStartGame) btnStartGame.disabled = true; return; }
  const remain = fleet.summary();
  const orderStr = fleet.order.length ? `Als Nächstes: ${fleet.order[0]}er` : "–";
  const parts = [];
  for (const L of [5,4,3,2]) {
    const n = remain[L] || 0;
    parts.push(`<span class="pill">${L}er × ${n}</span>`);
  }
  fleetEl.innerHTML = `${parts.join(" ")} &nbsp; | &nbsp; <strong>${orderStr}</strong>`;
  btnUndo.disabled = fleet.placed.length === 0;
  if (btnStartGame) btnStartGame.disabled = !fleet.complete();
}

/* ---------- XR Helpers ---------- */
function pickActiveInputSource() {
  if (!xrSession) return null;
  let right = null, left = null, any = null;
  for (const src of xrSession.inputSources) {
    if (src.targetRayMode === "tracked-pointer") {
      any = any || src;
      if (src.handedness === "right") right = src;
      else if (src.handedness === "left") left = src;
    }
  }
  return right || left || any;
}

function getCellFromSelectEvent(e, board) {
  try {
    if (!e || !board || !localRefSpace) return null;
    const frame = e.frame || renderer.xr.getFrame?.();
    if (!frame || !e.inputSource?.targetRaySpace) return null;
    const pose = frame.getPose(e.inputSource.targetRaySpace, localRefSpace);
    if (!pose) return null;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix ?? matrixFromTransform(pose.transform));
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
    const hit = board.raycastCell(origin, dir);
    return hit.hit ? { row: hit.row, col: hit.col } : null;
  } catch { return null; }
}

function originDirFromXRPose(pose) {
  const m = new THREE.Matrix4().fromArray(pose.transform.matrix ?? matrixFromTransform(pose.transform));
  const origin = new THREE.Vector3().setFromMatrixPosition(m);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
  return { origin, dir };
}

function matrixFromTransform(t) { return (new XRRigidTransform(t.position, t.orientation)).matrix; }

function offsetLocalXZ(baseMatrix, dx, dz) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  new THREE.Matrix4().copy(baseMatrix).decompose(pos, quat, scl);
  const offsetLocal = new THREE.Vector3(dx, 0, dz).applyQuaternion(quat);
  pos.add(offsetLocal);
  const out = new THREE.Matrix4();
  out.compose(pos, quat, scl);
  return out;
}

function allCells(n) { const arr = []; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) arr.push([r, c]); return arr; }

/* ---------- KI-Flottenplatzierung ---------- */
function randomizeFleet(board, lengths) {
  for (const L of lengths) {
    let placed = false, guard = 0;
    while (!placed && guard++ < 500) {
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

/* ---------- Audio: Mini-Synth (ohne Dateien) ---------- */
function initAudio() {
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

function playEarcon(kind) {
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
    case "win":        chord([392,494,587],0.55,0.24); break;   // G B D
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
