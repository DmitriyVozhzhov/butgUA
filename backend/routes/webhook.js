const router = require('express').Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Budget = require('../models/Budget');
const wsManager = require('../services/wsManager');

// POST /api/webhook/transaction
router.post('/transaction', async (req, res) => {
  try {
    const apiToken = req.headers['x-api-token'];
    if (!apiToken) return res.status(401).json({ error: 'API токен відсутній' });

    const user = await User.findOne({ apiToken });
    if (!user) return res.status(401).json({ error: 'Невірний API токен' });

    const { amount, category, description, date, rawText, chatId } = req.body;
    if (!amount || isNaN(Number(amount)))
      return res.status(400).json({ error: 'Невірна сума' });

    if (chatId && !user.telegramChatId) {
      user.telegramChatId = String(chatId);
      await user.save();
    }

    // Find most recent budget for this user to attach transaction
    const latestBudget = await Budget.findOne({ userId: user._id }).sort({ createdAt: -1 });

    const tx = await Transaction.create({
      userId: user._id,
      budgetId: latestBudget?._id || null,
      amount: Number(amount),
      category: category || 'Інше',
      description: description || '',
      date: date ? new Date(date) : new Date(),
      source: 'telegram',
      rawText: rawText || '',
    });

    // Broadcast real-time update to all connected browser tabs of this user
    wsManager.broadcast(String(user._id), 'new_transaction', {
      transaction: tx,
      budgetId: latestBudget?._id || null,
    });

    res.json({ success: true, transaction: tx });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/webhook/link-telegram
router.post('/link-telegram', async (req, res) => {
  try {
    const { apiToken, chatId } = req.body;
    if (!apiToken || !chatId)
      return res.status(400).json({ error: 'apiToken та chatId обовязкові' });

    const user = await User.findOneAndUpdate(
      { apiToken },
      { telegramChatId: String(chatId) },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'Користувача не знайдено' });

    res.json({ success: true, name: user.name, email: user.email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// GET /api/webhook/budgets — list budgets by API token (for bot)
router.get('/budgets', async (req, res) => {
  try {
    const apiToken = req.headers['x-api-token'];
    if(!apiToken) return res.status(401).json({ error: 'No token' });
    const user = await User.findOne({ apiToken });
    if(!user) return res.status(401).json({ error: 'Invalid token' });
    const Budget = require('../models/Budget');
    const budgets = await Budget.find({ userId: user._id }).sort({ createdAt: -1 }).select('title month income credits installments categories creditCards');
    res.json(budgets);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/webhook/stats — monthly stats for bot
router.get('/stats', async (req, res) => {
  try {
    const apiToken = req.headers['x-api-token'];
    if(!apiToken) return res.status(401).json({ error: 'No token' });
    const user = await User.findOne({ apiToken });
    if(!user) return res.status(401).json({ error: 'Invalid token' });
    const Transaction = require('../models/Transaction');
    const Budget = require('../models/Budget');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const txs = await Transaction.find({ userId: user._id, date: { $gte: startOfMonth } });
    const monthStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
    const budget = await Budget.findOne({ userId: user._id, month: monthStr });
    res.json({ transactions: txs, budget: budget || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


const TelegramSession = require('../models/TelegramSession');

// GET /api/webhook/session/:chatId
router.get('/session/:chatId', async (req, res) => {
  try {
    const sess = await TelegramSession.findOne({ chatId: req.params.chatId });
    res.json(sess || {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/webhook/session/:chatId
router.post('/session/:chatId', async (req, res) => {
  try {
    const sess = await TelegramSession.findOneAndUpdate(
      { chatId: req.params.chatId },
      { $set: req.body },
      { upsert: true, new: true }
    );
    res.json(sess);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
