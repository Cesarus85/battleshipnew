// Audio und Haptik Hilfsfunktionen

let audioCtx = null, masterGain = null;
let audioEnabled = true, hapticsEnabled = true;

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

export function buzzFromEvent(e, intensity=0.5, durationMs=80) {
  if (!hapticsEnabled || !e?.inputSource?.gamepad?.hapticActuators) return;
  try {
    for (const h of e.inputSource.gamepad.hapticActuators) {
      h?.pulse?.(Math.min(1, Math.max(0, intensity)), Math.max(1, durationMs));
    }
  } catch {}
}

