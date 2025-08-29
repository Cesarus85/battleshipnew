import { playerBoard, remoteBoard, markAroundShip, gameOver, setRemoteTurn, setNetPlayerId, remoteTurn } from './state.js';
import { setTurn } from './gameSetup.js';

const WS_URL = "wss://sportaktivfitness.de:1234";

let socket;
let pc;
let channel;
let msgHandler = () => {};
const disconnectHandlers = [];
const connectHandlers = [];
const roomCodeHandlers = [];

let roomCode = null;
let pendingOffer = null;
const pendingCandidates = [];

let msgCounter = 0;
const pending = new Map();
const received = new Set();
const RESEND_MS = 1000;
const LATENCY_THRESHOLD = 1500;
let latencyHandler = () => {};
let latencyHigh = false;
let prevRemoteTurn = false;
let connInfo = null;

function emitConnect() {
  connectHandlers.forEach(cb => {
    try { cb(); } catch {}
  });
}

function emitRoomCode(code) {
  roomCode = code;
  if (connInfo) connInfo.code = code;
  roomCodeHandlers.forEach(cb => {
    try { cb(code); } catch {}
  });
}

function emitDisconnect() {
  pending.forEach(p => clearTimeout(p.timer));
  pending.clear();
  received.clear();
  latencyHigh = false;
  socket = null;
  pc = null;
  channel = null;
  disconnectHandlers.forEach(cb => { 
    try { cb(); } catch {} 
  });
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

function createSocket() {
  if (socket) return;
  
  console.log('Connecting to:', WS_URL);
  socket = new WebSocket(WS_URL);
  
  socket.onopen = () => {
    console.log('WebSocket connected');
  };
  
  socket.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('Received message:', msg.type);
      
      if (msg.type === 'created') {
        console.log('Room created with code:', msg.code);
        emitRoomCode(msg.code);
        if (pendingOffer) {
          socket.send(JSON.stringify({ type: 'offer', offer: pendingOffer, code: roomCode }));
          pendingOffer = null;
          pendingCandidates.forEach(c => {
            socket.send(JSON.stringify({ type: 'candidate', candidate: c, code: roomCode }));
          });
          pendingCandidates.length = 0;
        }
      } else if (msg.type === 'joined') {
        console.log('Successfully joined room:', msg.code);
        emitRoomCode(msg.code);
      } else if (msg.type === 'error') {
        console.error('Server error:', msg.message);
      } else if (msg.type === 'peerJoined') {
        console.log('Peer joined the room');
      } else if (msg.type === 'peerDisconnected') {
        console.log('Peer disconnected');
        emitDisconnect();
      }
      
      if (!pc) return;
      
      if (msg.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: "answer", answer, code: roomCode }));
      } else if (msg.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
      } else if (msg.type === "candidate") {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (err) { 
          console.error('ICE candidate error:', err); 
        }
      }
    } catch (error) {
      console.error('Message parsing error:', error);
    }
  };
  
  socket.onclose = (event) => {
    console.log('WebSocket closed:', event.code, event.reason);
    emitDisconnect();
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    emitDisconnect();
  };
}

export async function createRoom() {
  createSocket();
  
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise((resolve) => {
      socket.addEventListener("open", resolve, { once: true });
    });
  }
  
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  
  channel = pc.createDataChannel("data");
  
  channel.onopen = () => { 
    console.log('Data channel opened');
    setRemoteTurn(false); 
    setTurn('player'); 
    emitConnect(); 
  };
  
  channel.onmessage = (e) => { 
    try { 
      const obj = JSON.parse(e.data); 
      handleMessage(obj); 
    } catch (error) {
      console.error('Data channel message error:', error);
    } 
    msgHandler(e.data); 
  };
  
  channel.onclose = () => {
    console.log('Data channel closed');
    emitDisconnect();
  };
  
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      if (roomCode) {
        socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate, code: roomCode }));
      } else {
        pendingCandidates.push(e.candidate);
      }
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
  };
  
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  pendingOffer = offer;
  socket.send(JSON.stringify({ type: "create" }));
  
  setNetPlayerId(0);
  connInfo = { mode: 'host' };
}

export async function joinRoom(code) {
  createSocket();
  
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise((resolve) => {
      socket.addEventListener("open", resolve, { once: true });
    });
  }
  
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  
  pc.ondatachannel = (e) => {
    channel = e.channel;
    
    channel.onopen = () => { 
      console.log('Data channel opened (join)');
      setRemoteTurn(true); 
      setTurn('ai'); 
      emitConnect(); 
    };
    
    channel.onmessage = (ev) => { 
      try { 
        const obj = JSON.parse(ev.data); 
        handleMessage(obj); 
      } catch (error) {
        console.error('Data channel message error:', error);
      } 
      msgHandler(ev.data); 
    };
    
    channel.onclose = () => {
      console.log('Data channel closed (join)');
      emitDisconnect();
    };
  };
  
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate, code }));
    }
  };
  
  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
  };
  
  socket.send(JSON.stringify({ type: "join", code }));
  setNetPlayerId(1);
  connInfo = { mode: 'join', code };
}

export function send(data) {
  if (!channel || channel.readyState !== "open") {
    console.warn('Cannot send data: channel not open');
    return;
  }
  
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
      if (entry.retries >= 5) {
        console.warn('Message delivery failed after 5 retries, giving up:', data.type);
        pending.delete(id);
        return;
      }
      channel.send(entry.payload);
      entry.sentAt = performance.now();
      entry.retries++;
      schedule();
    }, RESEND_MS);
  };
  
  schedule();
  pending.set(id, entry);
}

export function onMessage(cb) { 
  msgHandler = cb; 
}

export function onDisconnect(cb) {
  disconnectHandlers.push(cb);
}

export function onConnect(cb) {
  connectHandlers.push(cb);
}

export function onRoomCode(cb) {
  roomCodeHandlers.push(cb);
}

export function onLatency(cb) { 
  latencyHandler = cb; 
}

export async function reconnect() {
  if (!connInfo) return;
  if (connInfo.mode === 'host') return await createRoom();
  if (connInfo.mode === 'join') return await joinRoom(connInfo.code);
}