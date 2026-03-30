require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const wsManager = require('./services/wsManager');

const authRoutes = require('./routes/auth');
const budgetRoutes = require('./routes/budget');
const transactionRoutes = require('./routes/transactions');
const webhookRoutes = require('./routes/webhook');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/budget', budgetRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/webhook', webhookRoutes);
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// HTTP server (shared with WS)
const server = http.createServer(app);

// WebSocket server on same port, path /ws
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname, query } = url.parse(req.url, true);
  if (pathname !== '/ws') { socket.destroy(); return; }

  const token = query.token;
  if (!token) { socket.destroy(); return; }

  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = String(user.id);
    wsManager.register(ws.userId, ws);
    ws.send(JSON.stringify({ event: 'connected', data: { userId: ws.userId } }));
    console.log('WS connected userId:', ws.userId);
  });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    server.listen(process.env.PORT || 4000, () =>
      console.log('Backend + WS on port', process.env.PORT || 4000)
    );
  })
  .catch(err => { console.error(err); process.exit(1); });
