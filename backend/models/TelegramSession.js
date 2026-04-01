const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  chatId: { type: String, required: true, unique: true },
  apiToken: { type: String, default: null },
  lang: { type: String, default: 'uk' },
  selectedBudget: {
    id: { type: String, default: null },
    title: { type: String, default: null }
  },
  aiProvider: { type: String, default: 'gemini' },
  aiKey: { type: String, default: null },
}, { timestamps: true });
module.exports = mongoose.model('TelegramSession', schema);
