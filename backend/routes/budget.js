const router = require('express').Router();
const auth = require('../middleware/auth');
const Budget = require('../models/Budget');

// List all budgets for user
router.get('/', auth, async (req, res) => {
  const budgets = await Budget.find({ userId: req.user.id }).sort({ createdAt: -1 });
  res.json(budgets);
});

// Get single budget
router.get('/:id', auth, async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, userId: req.user.id });
  if (!budget) return res.status(404).json({ error: 'Бюджет не знайдено' });
  res.json(budget);
});

// Create budget
router.post('/', auth, async (req, res) => {
  try {
    const budget = await Budget.create({ ...req.body, userId: req.user.id });
    res.status(201).json(budget);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update budget
router.put('/:id', auth, async (req, res) => {
  try {
    const budget = await Budget.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true }
    );
    if (!budget) return res.status(404).json({ error: 'Бюджет не знайдено' });
    res.json(budget);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Delete budget
router.delete('/:id', auth, async (req, res) => {
  await Budget.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  res.json({ success: true });
});

module.exports = router;
