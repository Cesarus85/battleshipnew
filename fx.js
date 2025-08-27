// Audio Earcons, Haptik, GameOver-Banner
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";

let audioCtx = null, masterGain = null;
let audioEnabled = true;

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
  const actuators = e?.inputSource?.gamepad?.hapticActuators;
  if (!actuators) return;
  try {
    for (const h of actuators) {
      h?.pulse?.(Math.min(1, Math.max(0, intensity)), Math.max(1, durationMs));
    }
  } catch {}
}

/* ------------ Banner (GameOver) ------------ */
let bannerMesh = null;

export const Banner = {
  show(scene, positionVec3, text="GEWONNEN!", colorHex="#19b26b") {
    this.hide(scene);
    bannerMesh = makeLabelPlane(text, colorHex);
    bannerMesh.position.copy(positionVec3);
    scene.add(bannerMesh);
  },
  hide(scene) {
    if (!bannerMesh) return;
    scene.remove(bannerMesh);
    if (bannerMesh.material?.map) bannerMesh.material.map.dispose();
    bannerMesh.material?.dispose?.();
    bannerMesh.geometry?.dispose();
    bannerMesh = null;
  },
  update(camera) {
    if (bannerMesh) bannerMesh.lookAt(camera.position);
  }
};

function makeLabelPlane(text, colorHex = "#19b26b") {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 384;
  const ctx = canvas.getContext("2d");

  roundRect(ctx, 16, 16, canvas.width-32, canvas.height-32, 32, "rgba(0,0,0,0.65)");

  ctx.fillStyle = colorHex;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 180px system-ui, -apple-system, Roboto, Arial, sans-serif";
  ctx.fillText(text, canvas.width/2, canvas.height/2 + 10);

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 6;
  ctx.strokeText(text, canvas.width/2, canvas.height/2 + 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const widthMeters = 0.80, heightMeters = widthMeters * (canvas.height/canvas.width);
  const geo = new THREE.PlaneGeometry(widthMeters, heightMeters);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 10;
  return mesh;
}

function roundRect(ctx, x, y, w, h, r, fillStyle) {
  const rr = Math.min(r, w*0.5, h*0.5);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}
