const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    budgetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Budget', default: null },
    amount: { type: Number, required: true },
    category: { type: String, default: 'Інше' },
    description: { type: String, default: '' },
    date: { type: Date, default: Date.now },
    source: { type: String, enum: ['manual', 'telegram'], default: 'manual' },
    rawText: { type: String, default: '' }, // original receipt text from AI
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
