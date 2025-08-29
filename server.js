// server.js - Stelle sicher, dass der Server richtig läuft
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');

const server = https.createServer({
  cert: fs.readFileSync('/etc/letsencrypt/live/sportaktivfitness.de/fullchain.pem'),
  key:  fs.readFileSync('/etc/letsencrypt/live/sportaktivfitness.de/privkey.pem')
});

const wss = new WebSocket.Server({ server });
// Map room code -> { peers: WebSocket[], buffer: string[] }
const rooms = new Map();

wss.on('connection', ws => {
  console.log('WebSocket connection established');
  
  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      console.log('Received:', data.type);
      
      if (data.type === 'create') {
        const code = Math.random().toString(36).slice(2, 7).toUpperCase();
        rooms.set(code, { peers: [ws], buffer: [] });
        ws.send(JSON.stringify({ type: 'created', code }));
        console.log('Room created:', code);
      } else if (data.type === 'join') {
        const room = rooms.get(data.code);
        if (room && room.peers.length === 1) {
          room.peers.push(ws);
          ws.send(JSON.stringify({ type: 'joined', code: data.code }));
          // host informieren
          room.peers[0].send(JSON.stringify({ type: 'peerJoined' }));
          // gepufferte Nachrichten an neuen Peer senden
          for (const buffered of room.buffer) {
            if (ws.readyState === WebSocket.OPEN) ws.send(buffered);
          }
          room.buffer = [];
          console.log('Peer joined room:', data.code);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found or full' }));
        }
      } else {
        // offer/answer/ice durchreichen oder puffern
        const room = rooms.get(data.code);
        if (!room) return;

        if (room.peers.length === 1 && (data.type === 'offer' || data.type === 'candidate')) {
          const text = typeof msg === 'string' ? msg : msg.toString();
          room.buffer.push(text);
        } else {
          const peer = room.peers.find(p => p !== ws);
          if (peer && peer.readyState === WebSocket.OPEN) {
            const text = typeof msg === 'string' ? msg : msg.toString();
            peer.send(text);
          }
        }
      }
    } catch (error) {
      console.error('Message handling error:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    for (const [code, room] of rooms.entries()) {
      const index = room.peers.indexOf(ws);
      if (index !== -1) {
        room.peers.splice(index, 1);
        if (room.peers.length === 0) {
          rooms.delete(code);
          console.log('Room deleted:', code);
        }
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(1234, '0.0.0.0', () => {
  console.log('Signaling-Server läuft auf Port 1234 (WSS)');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    process.exit(0);
  });
});