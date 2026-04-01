# 💰 BudgUA — Family Budget Tracker

Full-stack family budget app with AI receipt scanning via Telegram bot.

## 🏗 Stack
- **Backend**: Node.js + Express + MongoDB
- **Frontend**: Vanilla HTML/CSS/JS (nginx)
- **AI**: Google Gemini / OpenAI / DeepSeek (user's own key)
- **Bot**: Telegram Bot API
- **Auth**: JWT + Google OAuth (optional)
- **Real-time**: WebSocket (live dashboard updates)
- **Deploy**: Docker Compose

---

## 🚀 Quick Start

```bash
git clone <repo>
cd budget-app
cp .env.example .env
# Edit .env with your values
docker compose up -d --build
```

- 🌐 Web: http://localhost:3000
- 🔌 API: http://localhost:4000/api
- 📖 Docs: http://localhost:3000/docs.html

---

## ⚙️ .env Configuration

```env
MONGO_USER=admin
MONGO_PASS=your_password
MONGO_URI=mongodb://admin:your_password@mongo:27017/budget?authSource=admin

JWT_SECRET=random_64_char_string

TELEGRAM_BOT_TOKEN=your_token_from_BotFather

BACKEND_URL=http://backend:4000
PORT=4000

# Optional: Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

> **Note**: No system Gemini key needed. Users provide their own AI key in Profile.

---

## 🤖 Telegram Bot — @BudgUA_bot

### How to connect:
1. Go to BudgUA website → **Profile** → copy API token
2. Open [@BudgUA_bot](https://t.me/BudgUA_bot) in Telegram
3. Tap **🔑 Connect account** → paste token
4. Done! Send receipt photos or type expenses

### Bot menu:
| Button | Action |
|--------|--------|
| 🔑 Connect account | Link your BudgUA account |
| 💸 Add expense | Enter expense mode (receipt photo or text) |
| 📊 Statistics | Monthly stats with plan vs actual |
| 📋 Select budget | Set default budget for expenses |
| UA / ENG | Toggle language |

### Important:
- **Expense mode**: All menu buttons are hidden, only `↩ Back` is shown
- **Photo scanning**: Requires your own AI key (Gemini / OpenAI / DeepSeek)
- **Text input**: Works without AI key
- **Sessions**: Persist in MongoDB — reconnection is not needed after restart

---

## 🔑 AI Key Setup (for receipt scanning)

Users add their own AI API key in **Profile → AI Keys**:

| Provider | Get key at | Key format |
|----------|-----------|------------|
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/app/apikey) | `AIzaSy...` |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | `sk-...` |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | `sk-...` |

**Gemini fallback chain**: `gemini-2.5-flash` → `gemini-1.5-flash`

---

## 🔐 Google OAuth Setup (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project → APIs & Services → Credentials
3. Create OAuth 2.0 Client ID
4. Authorized redirect URIs: `http://yourdomain.com/auth/google/callback`
5. Add to `.env`:
   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
6. Uncomment Google auth section in `backend/routes/auth.js`

---

## 📁 Project Structure

```
budget-app/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── index.js              — Express + WebSocket server
│   ├── models/
│   │   ├── User.js           — User + AI key storage
│   │   ├── Budget.js         — Budget with credits/cards
│   │   ├── Transaction.js    — Expense records
│   │   └── TelegramSession.js — Persistent bot sessions
│   └── routes/
│       ├── auth.js           — Login/register/Google/API keys
│       ├── budget.js         — CRUD budgets
│       ├── transactions.js   — CRUD transactions
│       └── webhook.js        — Telegram webhook + session API
├── frontend/
│   ├── index.html            — Full SPA
│   ├── docs.html             — Documentation
│   ├── terms.html            — Terms of Use
│   ├── privacy.html          — Privacy Policy
│   └── nginx.conf
└── telegram-bot/
    └── bot.js                — Bot with persistent sessions + multi-AI
```

---

## 🔌 API Reference

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Register |
| POST | /api/auth/login | — | Login |
| POST | /api/auth/google | — | Google OAuth |
| GET | /api/auth/me | JWT | Profile |
| POST | /api/auth/api-key | JWT | Save AI key |
| DELETE | /api/auth/api-key | JWT | Remove AI key |
| POST | /api/auth/regenerate-token | JWT | New API token |
| DELETE | /api/auth/account | JWT | Delete account |

### Budget
| Method | Path | Auth |
|--------|------|------|
| GET | /api/budget | JWT |
| POST | /api/budget | JWT |
| PUT | /api/budget/:id | JWT |
| DELETE | /api/budget/:id | JWT |

### Transactions
| Method | Path | Auth |
|--------|------|------|
| GET | /api/transactions | JWT |
| POST | /api/transactions | JWT |
| DELETE | /api/transactions/:id | JWT |

### Webhook (Telegram Bot)
| Method | Path | Header |
|--------|------|--------|
| POST | /api/webhook/transaction | x-api-token |
| POST | /api/webhook/link-telegram | — |
| GET | /api/webhook/budgets | x-api-token |
| GET | /api/webhook/stats | x-api-token |
| GET | /api/webhook/session/:chatId | — |
| POST | /api/webhook/session/:chatId | — |

---

## 👤 Author

**Dmytro Vozhzhov / Дмитро Вожжов**
- Telegram: [t.me/dzim4ik1](https://t.me/dzim4ik1)
- Email: admin@vozhzhov.biz.ua
- Bot: [@BudgUA_bot](https://t.me/BudgUA_bot)
