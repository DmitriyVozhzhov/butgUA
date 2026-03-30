const mongoose = require('mongoose');

const creditSchema = new mongoose.Schema({
  name: String,
  fullAmount: Number,
  totalAmount: Number,
  monthlyPayment: Number,
  monthsLeft: Number,
});

const installmentSchema = new mongoose.Schema({
  name: String,
  fullAmount: Number,
  totalAmount: Number,
  monthlyPayment: Number,
  monthsLeft: Number,
});

const categorySchema = new mongoose.Schema({
  name: String,
  planned: Number,
});

// Multiple credit cards
const creditCardSchema = new mongoose.Schema({
  name: String,        // e.g. "ПриватБанк Visa"
  debt: Number,        // current balance
  rate: Number,        // annual rate %
  payment: Number,     // user-set monthly payment (0 = use minimum)
});

const budgetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    month: { type: String },
    income: { type: Number, default: 0 },
    credits: [creditSchema],
    installments: [installmentSchema],
    categories: [categorySchema],
    creditCards: [creditCardSchema],
    // Legacy single CC fields — kept for backward compat
    creditCardDebt: { type: Number, default: 0 },
    creditCardRate: { type: Number, default: 0 },
    creditCardPayment: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Budget', budgetSchema);
