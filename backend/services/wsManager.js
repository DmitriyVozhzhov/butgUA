// WebSocket manager — зберігає активні зєднання по userId
const clients = new Map(); // userId -> Set<ws>

function register(userId, ws) {
  const key = String(userId);
  if (!clients.has(key)) clients.set(key, new Set());
  clients.get(key).add(ws);
  ws.on('close', () => {
    clients.get(key)?.delete(ws);
  });
}

function broadcast(userId, event, data) {
  const sockets = clients.get(String(userId));
  if (!sockets || sockets.size === 0) return;
  const payload = JSON.stringify({ event, data });
  for (const ws of sockets) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

module.exports = { register, broadcast };
