// server.js - Stelle sicher, dass der Server richtig läuft
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');

const server = https.createServer({
  cert: fs.readFileSync('/etc/letsencrypt/live/sportaktivfitness.de/fullchain.pem'),
  key:  fs.readFileSync('/etc/letsencrypt/live/sportaktivfitness.de/privkey.pem')
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

wss.on('connection', ws => {
  console.log('WebSocket connection established');
  
  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      console.log('Received:', data.type);
      
      if (data.type === 'create') {
        const code = Math.random().toString(36).slice(2, 7).toUpperCase();
        rooms.set(code, [ws]);
        ws.send(JSON.stringify({ type: 'created', code }));
        console.log('Room created:', code);
      } else if (data.type === 'join') {
        const peers = rooms.get(data.code);
        if (peers && peers.length === 1) {
          peers.push(ws);
          ws.send(JSON.stringify({ type: 'joined', code: data.code }));
          peers[0].send(JSON.stringify({ type: 'peerJoined' }));
          console.log('Peer joined room:', data.code);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found or full' }));
        }
      } else {
        // offer/answer/ice durchreichen
        const peer = rooms.get(data.code)?.find(p => p !== ws);
        if (peer && peer.readyState === WebSocket.OPEN) {
          const text = typeof msg === 'string' ? msg : msg.toString();
          peer.send(text);
        }
      }
    } catch (error) {
      console.error('Message handling error:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    for (const [code, peers] of rooms.entries()) {
      const index = peers.indexOf(ws);
      if (index !== -1) {
        peers.splice(index, 1);
        if (peers.length === 0) {
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