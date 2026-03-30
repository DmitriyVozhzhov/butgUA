# 💰 BudgetUA — Сімейний бюджет

Повноцінний сервіс для обліку сімейного бюджету з Telegram ботом, AI-розпізнаванням чеків та PDF-звітами.
Протестувати можна тут - https://budg.vozhzhov.biz.ua/

## 🏗 Стек

- **Backend**: Node.js + Express
- **Database**: MongoDB
- **Frontend**: Vanilla HTML/CSS/JS (nginx)
- **AI**: Google Gemini 1.5 Flash (розпізнавання чеків)
- **Bot**: Telegram Bot API
- **Deploy**: Docker Compose

---

## 🚀 Швидкий старт

### 1. Клонуємо та налаштовуємо

```bash
git clone <repo>
cd budget-app
cp .env.example .env
```

### 2. Заповнюємо .env

```env
MONGO_USER=admin
MONGO_PASS=ваш_пароль
MONGO_URI=mongodb://admin:ваш_пароль@mongo:27017/budget?authSource=admin

JWT_SECRET=мінімум_64_рандомних_символи

TELEGRAM_BOT_TOKEN=токен_від_@BotFather
BACKEND_URL=http://backend:4000

GEMINI_API_KEY=ваш_ключ_з_ai.google.dev
```

### 3. Запускаємо

```bash
docker compose up -d --build
```

- 🌐 Сайт: http://localhost:3000
- 🔌 API: http://localhost:4000/api

---

## 📱 Як підключити Telegram бота

1. Створіть бота через [@BotFather](https://t.me/BotFather) → `/newbot`
2. Скопіюйте токен у `.env` → `TELEGRAM_BOT_TOKEN`
3. Зареєструйтесь на сайті → Кабінет → Скопіюйте API токен
4. Відкрийте бота в Telegram → надішліть `/start ВАШ_API_ТОКЕН`
5. Тепер надсилайте фото чеків — бот їх розпізнає через Gemini!

---

## 📄 Функціонал

### Сайт

- ✅ Реєстрація / Вхід (JWT)
- ✅ Створення бюджетів: дохід, кредити, розстрочки, категорії, кредитна картка
- ✅ Розрахунок залишку та загального боргу
- ✅ Прогноз погашення боргів
- ✅ Діаграма витрат по категоріям (Chart.js)
- ✅ Список транзакцій
- ✅ API токен для Telegram бота
- ✅ Експорт звіту в PDF

### Telegram бот

- ✅ Прив'язка до акаунту через токен (`/start TOKEN`)
- ✅ Розпізнавання фото чеків через Gemini Vision
- ✅ Додавання витрат текстом ("Кава 85 грн")
- ✅ Автоматичне збереження в базу даних

---

## 🗂 Структура проєкту

```
budget-app/
├── backend/
│   ├── index.js
│   ├── models/          User, Budget, Transaction
│   ├── routes/          auth, budget, transactions, webhook
│   └── middleware/      auth (JWT)
├── frontend/
│   ├── index.html       Весь SPA
│   └── nginx.conf
├── telegram-bot/
│   └── bot.js           Gemini Vision + webhook
├── docker-compose.yml
└── .env.example
```

---

## 🔌 API Endpoints

### Auth

| Method | Path                       | Description         |
| ------ | -------------------------- | ------------------- |
| POST   | /api/auth/register         | Реєстрація          |
| POST   | /api/auth/login            | Вхід                |
| GET    | /api/auth/me               | Профіль + API токен |
| POST   | /api/auth/regenerate-token | Новий API токен     |

### Budget

| Method | Path            | Description     |
| ------ | --------------- | --------------- |
| GET    | /api/budget     | Всі бюджети     |
| POST   | /api/budget     | Створити бюджет |
| PUT    | /api/budget/:id | Оновити         |
| DELETE | /api/budget/:id | Видалити        |

### Transactions

| Method | Path                  | Description     |
| ------ | --------------------- | --------------- |
| GET    | /api/transactions     | Список          |
| POST   | /api/transactions     | Створити вручну |
| DELETE | /api/transactions/:id | Видалити        |

### Webhook (для бота)

| Method | Path                       | Headers     | Description         |
| ------ | -------------------------- | ----------- | ------------------- |
| POST   | /api/webhook/transaction   | x-api-token | Зберегти транзакцію |
| POST   | /api/webhook/link-telegram | —           | Прив'язати Telegram |

---

## 🔑 Отримання ключів

**Gemini API Key:**

1. Перейдіть на https://ai.google.dev
2. "Get API key" → Create API key
3. Вставте в `.env` як `GEMINI_API_KEY`

**Telegram Bot Token:**

1. Напишіть [@BotFather](https://t.me/BotFather) в Telegram
2. `/newbot` → введіть назву і username
3. Скопіюйте токен в `.env` як `TELEGRAM_BOT_TOKEN`
