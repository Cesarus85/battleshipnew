const WS_URL = "ws://localhost:1234";

let socket;
let pc;
let channel;
let msgHandler = () => {};
let disconnectHandler = () => {};

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
}

export async function createRoom() {
  ensureSocket();
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise(res => socket.addEventListener("open", res, { once: true }));
  }
  pc = new RTCPeerConnection();
  channel = pc.createDataChannel("data");
  channel.onmessage = (e) => msgHandler(e.data);
  channel.onclose = () => disconnectHandler();
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.send(JSON.stringify({ type: "offer", offer }));
}

export async function joinRoom(code) {
  ensureSocket();
  if (socket.readyState !== WebSocket.OPEN) {
    await new Promise(res => socket.addEventListener("open", res, { once: true }));
  }
  pc = new RTCPeerConnection();
  pc.ondatachannel = (e) => {
    channel = e.channel;
    channel.onmessage = (ev) => msgHandler(ev.data);
    channel.onclose = () => disconnectHandler();
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
  };
  socket.send(JSON.stringify({ type: "join", code }));
}

export function send(data) {
  if (channel && channel.readyState === "open") channel.send(data);
}

export function onMessage(cb) { msgHandler = cb; }
export function onDisconnect(cb) { disconnectHandler = cb; }
