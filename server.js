const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// 靜態檔案伺服器
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// 房間管理
const rooms = new Map();

function genRoomId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function broadcast(room, msg, exclude) {
  room.players.forEach(p => {
    if (p !== exclude && p.readyState === WebSocket.OPEN) p.send(JSON.stringify(msg));
  });
}

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // 建立房間
    if (msg.type === 'create') {
      const roomId = genRoomId();
      rooms.set(roomId, { players: [ws], hostRole: msg.role, state: {} });
      ws.roomId = roomId;
      ws.role = msg.role;
      ws.send(JSON.stringify({ type: 'roomCreated', roomId, role: msg.role }));
      return;
    }

    // 加入房間
    if (msg.type === 'join') {
      const room = rooms.get(msg.roomId);
      if (!room) { ws.send(JSON.stringify({ type: 'error', msg: '房間不存在' })); return; }
      if (room.players.length >= 2) { ws.send(JSON.stringify({ type: 'error', msg: '房間已滿' })); return; }
      room.players.push(ws);
      ws.roomId = msg.roomId;
      ws.role = room.hostRole === 'setter' ? 'guesser' : 'setter';
      ws.send(JSON.stringify({ type: 'roomJoined', roomId: msg.roomId, role: ws.role }));
      broadcast(room, { type: 'opponentJoined', opponentRole: room.hostRole }, ws);
      return;
    }

    // 轉發遊戲訊息
    const room = rooms.get(ws.roomId);
    if (room) {
      broadcast(room, { ...msg, from: ws.role }, ws);
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (room) {
      broadcast(room, { type: 'opponentLeft' }, ws);
      room.players = room.players.filter(p => p !== ws);
      if (room.players.length === 0) rooms.delete(ws.roomId);
    }
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
