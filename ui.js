// UI elements and helpers
import {
  startAR,
  resetAll,
  rotateShip,
  moveBoards,
  undoShip,
  startGame,
  requestLoad
} from './main.js';
import { orientation, fleet } from './state.js';
import { saveState, clearState } from './storage.js';
import { initAudio } from './audio.js';
import { createRoom, joinRoom, onConnect, onDisconnect, onRoomCode, onStatus } from './net.js';

export const canvas = document.getElementById('xr-canvas');
export const overlay = document.getElementById('overlay');
export const resultBanner = document.getElementById('resultBanner');
export const statusEl = document.getElementById('status');
export const btnStartSolo = document.getElementById('btnStartSolo');
export const btnStartSafeSolo = document.getElementById('btnStartSafeSolo');
export const btnStartMulti = document.getElementById('btnStartMulti');
export const btnStartSafeMulti = document.getElementById('btnStartSafeMulti');
export const btnReset = document.getElementById('btnReset');
export const hoverCellEl = document.getElementById('hoverCell');
export const lastPickEl = document.getElementById('lastPick');
export const btnAimGaze = document.getElementById('btnAimGaze');
export const btnAimController = document.getElementById('btnAimController');
export const aimInfoEl = document.getElementById('aimInfo');
export const debugEl = document.getElementById('debug');
export const btnDiag = document.getElementById('btnDiag');
export const btnPerms = document.getElementById('btnPerms');

export const roomCodeEl = document.getElementById('roomCode');
export const btnCreateRoom = document.getElementById('btnCreateRoom');
export const btnJoinRoom = document.getElementById('btnJoinRoom');

export const phaseEl = document.getElementById('phase');
export const fleetEl = document.getElementById('fleet');
export const btnRotate = document.getElementById('btnRotate');
export const btnMoveBoards = document.getElementById('btnMoveBoards');
export const btnUndo = document.getElementById('btnUndo');
export const btnStartGame = document.getElementById('btnStartGame');
export const turnEl = document.getElementById('turn');

export const btnSave = document.getElementById('btnSave');
export const btnLoad = document.getElementById('btnLoad');
export const btnClear = document.getElementById('btnClear');

export let aimMode = 'controller';
export let phase = 'placement';
let connected = false;

export function wireUI() {
  btnStartSolo.addEventListener('click', () => { initAudio(); startAR('regular'); });
  btnStartSafeSolo.addEventListener('click', () => { initAudio(); startAR('safe'); });
  btnStartMulti.addEventListener('click', () => { initAudio(); startAR('regular'); });
  btnStartSafeMulti.addEventListener('click', () => { initAudio(); startAR('safe'); });
  btnReset.addEventListener('click', resetAll);

  btnAimGaze.addEventListener('click', () => { setAimMode('gaze'); saveState(); });
  btnAimController.addEventListener('click', () => { setAimMode('controller'); saveState(); });

  btnDiag.addEventListener('click', () => diagnose());
  btnPerms.addEventListener('click', () => {
    statusEl.textContent = "Quest-Browser → Seiteneinstellungen: 'Passthrough/AR' & 'Bewegung/Tracking' erlauben. Falls abgelehnt: Berechtigungen zurücksetzen und Seite neu laden.";
  });

  btnRotate.addEventListener('click', () => { initAudio(); rotateShip(); saveState(); });
  btnMoveBoards?.addEventListener('click', () => { initAudio(); moveBoards(); });
  btnUndo.addEventListener('click', () => { initAudio(); undoShip(); saveState(); });
  if (btnStartGame) btnStartGame.addEventListener('click', () => { initAudio(); startGame(); });

  btnSave?.addEventListener('click', () => { saveState(true); });
  btnLoad?.addEventListener('click', () => { requestLoad(); });
  btnClear?.addEventListener('click', () => { clearState(); });

  btnCreateRoom?.addEventListener('click', async () => {
    statusEl.textContent = 'Warte auf Gegner…';
    try { await createRoom(); } catch (e) { statusEl.textContent = 'Fehler: ' + e.message; }
  });

  btnJoinRoom?.addEventListener('click', async () => {
    const code = roomCodeEl?.value.trim();
    if (!code) { statusEl.textContent = 'Code eingeben'; return; }
    statusEl.textContent = 'Verbinde…';
    try { await joinRoom(code); } catch (e) { statusEl.textContent = 'Fehler: ' + e.message; }
  });

  onConnect(() => {
    connected = true;
    statusEl.textContent = 'Verbunden';
    hideAIOptions();
  });
  onDisconnect((reason) => {
    statusEl.textContent = reason === 'timeout' || !connected ? 'Verbindung fehlgeschlagen' : 'Verbindung getrennt';
    connected = false;
  });
  onStatus(msg => { statusEl.textContent = msg; });
  onRoomCode(code => {
    if (roomCodeEl) roomCodeEl.value = code;
    if (statusEl.textContent.startsWith('Warte')) {
      statusEl.textContent = `Warte auf Gegner… Code: ${code}`;
    }
  });
}

export function setAimMode(mode) {
  aimMode = mode;
  btnAimGaze.classList.toggle('active', aimMode === 'gaze');
  btnAimController.classList.toggle('active', aimMode === 'controller');
  aimInfoEl.textContent = aimMode === 'gaze' ? 'Zielen über Kopfblick.' : 'Zielen über Hand/Controller-Ray.';
}

export function setPhase(p) {
  phase = p;
  phaseEl.textContent = p;
}

export async function diagnose() {
  const lines = [];
  const ua = navigator.userAgent || 'n/a';
  lines.push(`User-Agent: ${ua}`);
  lines.push(`Secure Context: ${window.isSecureContext} (${location.protocol})`);
  lines.push(`navigator.xr: ${!!navigator.xr}`);
  try {
    const arSup = await navigator.xr?.isSessionSupported?.('immersive-ar');
    const vrSup = await navigator.xr?.isSessionSupported?.('immersive-vr');
    lines.push(`isSessionSupported('immersive-ar'): ${arSup}`);
    lines.push(`isSessionSupported('immersive-vr'): ${vrSup}`);
  } catch (e) {
    lines.push(`isSessionSupported() Fehler: ${e?.name} – ${e?.message}`);
  }
  debugEl.innerHTML = `<strong>Diagnose</strong>\n${lines.join("\n")}\n\nTipps:\n• HTTPS nötig (https:// oder https://localhost)\n• Quest-Browser aktuell?\n• Berechtigungen erteilt?`;
}

export function updateFleetUI() {
  phaseEl.textContent = phase + (phase === 'setup' ? ` (Ori: ${orientation})` : '');
  if (!fleet) { fleetEl.innerHTML = ''; btnUndo.disabled = true; if (btnStartGame) btnStartGame.disabled = true; return; }
  const remain = fleet.summary();
  const orderStr = fleet.order.length ? `Als Nächstes: ${fleet.order[0]}er` : '–';
  const parts = [];
  for (const L of [5,4,3,2]) {
    const n = remain[L] || 0;
    parts.push(`<span class="pill">${L}er × ${n}</span>`);
  }
  fleetEl.innerHTML = `${parts.join(' ')} &nbsp; | &nbsp; <strong>${orderStr}</strong>`;
  btnUndo.disabled = fleet.placed.length === 0;
  if (btnStartGame) btnStartGame.disabled = !fleet.complete();
}

function hideAIOptions() {
  if (btnStartGame) btnStartGame.style.display = 'none';
}
