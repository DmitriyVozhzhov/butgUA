const router = require('express').Router();
const auth = require('../middleware/auth');
const Transaction = require('../models/Transaction');

// List transactions (optionally filter by budgetId)
router.get('/', auth, async (req, res) => {
  const filter = { userId: req.user.id };
  if (req.query.budgetId) filter.budgetId = req.query.budgetId;
  const txs = await Transaction.find(filter).sort({ date: -1 }).limit(200);
  res.json(txs);
});

// Create transaction manually
router.post('/', auth, async (req, res) => {
  try {
    const tx = await Transaction.create({ ...req.body, userId: req.user.id, source: 'manual' });
    res.status(201).json(tx);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Delete transaction
router.delete('/:id', auth, async (req, res) => {
  await Transaction.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  res.json({ success: true });
});

module.exports = router;
