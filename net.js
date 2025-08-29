import { playerBoard, remoteBoard, markAroundShip, gameOver, setRemoteTurn, setNetPlayerId } from './state.js';
import { setTurn } from './gameSetup.js';

const WS_URL = "ws://localhost:1234";

let socket;
let pc;
let channel;
let msgHandler = () => {};
let disconnectHandler = () => {};
let connectHandler = () => {};

function handleMessage(obj) {
  if (!obj || typeof obj !== 'object') return;
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
  socket.onclose = () => disconnectHandler();
  socket.onerror = () => disconnectHandler();
}

export async function createRoom() {
  ensureSocket();
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise(res => socket.addEventListener("open", res, { once: true }));
  }
  pc = new RTCPeerConnection();
  channel = pc.createDataChannel("data");
  channel.onopen = () => { setRemoteTurn(false); setTurn('player'); connectHandler(); };
  channel.onmessage = (e) => { try { const obj = JSON.parse(e.data); handleMessage(obj); } catch {} msgHandler(e.data); };
  channel.onclose = () => disconnectHandler();
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.send(JSON.stringify({ type: "offer", offer }));
  setNetPlayerId(0);
}

export async function joinRoom(code) {
  ensureSocket();
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise(res => socket.addEventListener("open", res, { once: true }));
  }
  pc = new RTCPeerConnection();
  pc.ondatachannel = (e) => {
    channel = e.channel;
    channel.onopen = () => { setRemoteTurn(true); setTurn('ai'); connectHandler(); };
    channel.onmessage = (ev) => { try { const obj = JSON.parse(ev.data); handleMessage(obj); } catch {} msgHandler(ev.data); };
    channel.onclose = () => disconnectHandler();
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
  };
  socket.send(JSON.stringify({ type: "join", code }));
  setNetPlayerId(1);
}

export function send(data) {
  if (!channel || channel.readyState !== "open") return;
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  channel.send(payload);
}

export function onMessage(cb) { msgHandler = cb; }
export function onDisconnect(cb) { disconnectHandler = cb; }
export function onConnect(cb) { connectHandler = cb; }
