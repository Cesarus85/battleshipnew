// server.js
const https = require('https');            // für wss
const fs = require('fs');
const WebSocket = require('ws');

// TLS-Zertifikat (z.B. Let's Encrypt)
const server = https.createServer({
  cert: fs.readFileSync('/etc/letsencrypt/live/sportaktivfitness.de/fullchain.pem'),
  key:  fs.readFileSync('/etc/letsencrypt/live/sportaktivfitness.de/privkey.pem')
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();                   // roomCode → [ws1, ws2]

wss.on('connection', ws => {
  ws.on('message', msg => {
    const data = JSON.parse(msg);
    if (data.type === 'create') {
      const code = Math.random().toString(36).slice(2, 7);
      rooms.set(code, [ws]);
      ws.send(JSON.stringify({ type: 'created', code }));
    } else if (data.type === 'join') {
      const peers = rooms.get(data.code);
      if (peers && peers.length === 1) {
        peers.push(ws);
        ws.send(JSON.stringify({ type: 'joined', code: data.code }));
        peers[0].send(JSON.stringify({ type: 'peerJoined' }));
      }
    } else {
      // offer/answer/ice durchreichen
      const peer = rooms.get(data.code)?.find(p => p !== ws);
      if (peer) peer.send(msg);
    }
  });

  ws.on('close', () => {
    for (const [code, peers] of rooms.entries()) {
      if (peers.includes(ws)) rooms.delete(code);
    }
  });
});

server.listen(1234, () => console.log('Signaling-Server läuft auf Port 1234'));
