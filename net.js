import { playerBoard, remoteBoard, markAroundShip, gameOver, setRemoteTurn, setNetPlayerId, remoteTurn } from './state.js';
import { setTurn } from './gameSetup.js';

const WS_URL = "ws://localhost:1234";

let socket;
let pc;
let channel;
let msgHandler = () => {};
const disconnectHandlers = [];
const connectHandlers = [];

let msgCounter = 0;
const pending = new Map();
const received = new Set();
const RESEND_MS = 1000;
const LATENCY_THRESHOLD = 1500;
let latencyHandler = () => {};
let latencyHigh = false;
let prevRemoteTurn = false;
let connInfo = null;

function emitConnect() { connectHandlers.forEach(cb => { try { cb(); } catch {} }); }
function emitDisconnect() {
  pending.forEach(p => clearTimeout(p.timer));
  pending.clear();
  received.clear();
  latencyHigh = false;
  socket = null;
  pc = null;
  channel = null;
  disconnectHandlers.forEach(cb => { try { cb(); } catch {} });
}

function sendAck(id) {
  if (!channel || channel.readyState !== 'open') return;
  channel.send(JSON.stringify({ type: 'ack', id }));
}

function handleLatency(rtt) {
  if (rtt > LATENCY_THRESHOLD) {
    if (!latencyHigh) {
      latencyHigh = true;
      prevRemoteTurn = remoteTurn;
      setRemoteTurn(true);
    }
    latencyHandler(rtt);
  } else {
    if (latencyHigh) {
      latencyHigh = false;
      setRemoteTurn(prevRemoteTurn);
    }
    latencyHandler(null);
  }
}

function ackReceived(id) {
  const entry = pending.get(id);
  if (!entry) return;
  const rtt = performance.now() - entry.sentAt;
  console.log(`RTT ${id}: ${Math.round(rtt)}ms`);
  clearTimeout(entry.timer);
  pending.delete(id);
  handleLatency(rtt);
}

function handleMessage(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.type === 'ack') {
    ackReceived(obj.id);
    return;
  }
  if (obj.id !== undefined) {
    sendAck(obj.id);
    if (received.has(obj.id)) return;
    received.add(obj.id);
  }
  if (obj.type === 'place') {
    remoteBoard?.placeShip(obj.row, obj.col, obj.length, obj.orientation);
  } else if (obj.type === 'shot') {
    if (!playerBoard) return;
    const { row, col } = obj;
    const res = playerBoard.receiveShot(row, col);
    if (res.result === 'hit' || res.result === 'sunk') {
      playerBoard.markCell(row, col, 0xe74c3c, 0.95);
      playerBoard.pulseAtCell(row, col, 0xe74c3c, 0.6);
      if (res.result === 'sunk' && res.ship) {
        playerBoard.flashShip?.(res.ship, 1.0);
        markAroundShip(playerBoard, res.ship, true);
      }
    } else if (res.result === 'miss') {
      playerBoard.markCell(row, col, 0x95a5a6, 0.9);
      playerBoard.pulseAtCell(row, col, 0x95a5a6, 0.5);
    }
    send({ type: 'result', row, col, result: res.result });
    if (playerBoard.allShipsSunk()) gameOver('enemy');
    setRemoteTurn(false);
    setTurn('player');
  } else if (obj.type === 'result') {
    const { row, col, result } = obj;
    if (!remoteBoard) return;
    if (result === 'hit' || result === 'sunk') {
      remoteBoard.markCell(row, col, 0x2ecc71, 0.9);
      remoteBoard.pulseAtCell(row, col, 0x2ecc71, 0.6);
      if (result === 'sunk') {
        const ship = remoteBoard.getShipAt(row, col);
        if (ship) {
          remoteBoard.flashShip?.(ship, 1.0);
          markAroundShip(remoteBoard, ship, true);
        }
      }
    } else if (result === 'miss') {
      remoteBoard.markCell(row, col, 0xd0d5de, 0.9);
      remoteBoard.pulseAtCell(row, col, 0xd0d5de, 0.5);
    }
    if (remoteBoard.allShipsSunk()) gameOver('player');
    setRemoteTurn(true);
    setTurn('ai');
  }
}

function ensureSocket() {
  if (socket) return;
  socket = new WebSocket(WS_URL);
  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (!pc) return;
    if (msg.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.send(JSON.stringify({ type: "answer", answer }));
    } else if (msg.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
    } else if (msg.type === "candidate") {
      try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (err) { console.error(err); }
    }
  };
  socket.onclose = () => emitDisconnect();
  socket.onerror = () => emitDisconnect();
}

export async function createRoom() {
  ensureSocket();
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise(res => socket.addEventListener("open", res, { once: true }));
  }
  pc = new RTCPeerConnection();
  channel = pc.createDataChannel("data");
  channel.onopen = () => { setRemoteTurn(false); setTurn('player'); emitConnect(); };
  channel.onmessage = (e) => { try { const obj = JSON.parse(e.data); handleMessage(obj); } catch {} msgHandler(e.data); };
  channel.onclose = () => emitDisconnect();
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.send(JSON.stringify({ type: "offer", offer }));
  setNetPlayerId(0);
  connInfo = { mode: 'host' };
}

export async function joinRoom(code) {
  ensureSocket();
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise(res => socket.addEventListener("open", res, { once: true }));
  }
  pc = new RTCPeerConnection();
  pc.ondatachannel = (e) => {
    channel = e.channel;
    channel.onopen = () => { setRemoteTurn(true); setTurn('ai'); emitConnect(); };
    channel.onmessage = (ev) => { try { const obj = JSON.parse(ev.data); handleMessage(obj); } catch {} msgHandler(ev.data); };
    channel.onclose = () => emitDisconnect();
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
  };
  socket.send(JSON.stringify({ type: "join", code }));
  setNetPlayerId(1);
  connInfo = { mode: 'join', code };
}

export function send(data) {
  if (!channel || channel.readyState !== "open") return;
  const id = msgCounter++;
  const msg = { ...data, id };
  const payload = JSON.stringify(msg);
  channel.send(payload);
  const entry = {
    payload,
    sentAt: performance.now(),
    timer: null,
    retries: 0
  };
  const schedule = () => {
    entry.timer = setTimeout(() => {
      if (!channel || channel.readyState !== 'open') return;
      channel.send(entry.payload);
      entry.sentAt = performance.now();
      entry.retries++;
      schedule();
    }, RESEND_MS);
  };
  schedule();
  pending.set(id, entry);
}

export function onMessage(cb) { msgHandler = cb; }
export function onDisconnect(cb) { disconnectHandlers.push(cb); }
export function onConnect(cb) { connectHandlers.push(cb); }
export function onLatency(cb) { latencyHandler = cb; }
export async function reconnect() {
  if (!connInfo) return;
  if (connInfo.mode === 'host') return await createRoom();
  if (connInfo.mode === 'join') return await joinRoom(connInfo.code);
}
