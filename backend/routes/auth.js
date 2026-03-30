const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

const sign = (user) =>
  jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "Всі поля обов'язкові" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: 'Email вже зареєстрований' });

    const user = await User.create({ name, email, password });
    res.json({ token: sign(user), user: { id: user._id, name: user.name, email: user.email, apiToken: user.apiToken } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: 'Невірний email або пароль' });

    res.json({ token: sign(user), user: { id: user._id, name: user.name, email: user.email, apiToken: user.apiToken } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get profile + API token
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Regenerate API token
router.post('/regenerate-token', auth, async (req, res) => {
  try {
    const { v4: uuidv4 } = require('uuid');
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { apiToken: uuidv4().replace(/-/g, '') },
      { new: true }
    ).select('-password');
    res.json({ apiToken: user.apiToken });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Delete account + all data
router.delete('/account', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Budget = require('../models/Budget');
    const Transaction = require('../models/Transaction');
    await Transaction.deleteMany({ userId: req.user.id });
    await Budget.deleteMany({ userId: req.user.id });
    await require('../models/User').findByIdAndDelete(req.user.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
