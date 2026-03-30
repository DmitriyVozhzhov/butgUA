require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const BACKEND = process.env.BACKEND_URL || "http://backend:4000";

// ── State maps ──────────────────────────────────────────
const linkedUsers = {}; // chatId -> apiToken
const userLangs = {}; // chatId -> 'uk'|'en'
const tokenAttempts = {}; // chatId -> {count, bannedUntil}
const awaitingToken = new Set(); // chatIds waiting for token input
const pendingPhotos = {}; // chatId -> { base64, apiToken } waiting for budget selection

// ── i18n ────────────────────────────────────────────────
const T = {
  uk: {
    welcome:
      "👋 Привіт! Я *BudgUA Bot* — допомагаю вести облік витрат.\n\nОберіть дію:",
    linked: (name) =>
      `✅ Акаунт прив'язано!\n\nВітаємо, *${name}*! 👋\n\n📸 Надсилайте фото чеків\n✍️ Або текстом: _"АТБ 450 грн"_`,
    badToken: "❌ Невірний токен. Спробуйте ще раз.",
    enterToken:
      "🔑 Будь ласка, введіть ваш API токен з кабінету на сайті BudgUA:",
    alreadyLinked: (name) =>
      `✅ Ваш акаунт вже підключено як *${name}*.\n\nМожете надсилати чеки або витрати текстом!`,
    notLinked:
      "⚠️ Спочатку підключіть акаунт через кнопку «🔑 Підключити акаунт»",
    scanning: "🔍 Аналізую чек...",
    thinking: "🤔 Розпізнаю витрату...",
    saved: (amt, cat, desc, date) =>
      `✅ *Збережено!*\n\n💰 Сума: *${amt} ₴*\n🏷 ${cat}\n📝 ${desc || "—"}\n📅 ${date || "сьогодні"}`,
    savedText: (amt, cat, desc) =>
      `✅ *Збережено!*\n\n💰 *${amt} ₴* — ${desc}\n🏷 ${cat}`,
    noAmount:
      '❌ Не вдалося визначити суму. Введіть вручну: _"750 грн продукти"_',
    noReceipt:
      '❌ Не вдалося розпізнати чек. Спробуйте:\n• Чіткіше фото\n• Або написати суму текстом: _"750 грн"_',
    downloadErr: "❌ Не вдалося завантажити фото. Спробуйте ще раз.",
    saveErr: "❌ Помилка збереження. Перевірте підключення.",
    unknownErr: "❌ Несподівана помилка. Спробуйте пізніше.",
    banned3: (hrs) =>
      `🚫 Забагато невірних спроб. Тимчасово заблоковано на ${hrs} год.`,
    langSet: "🇺🇦 Мову встановлено: Українська",
    statsTitle: "📊 *Статистика за місяць*",
    statsEmpty: "📊 Транзакцій за цей місяць ще немає.",
    statsTx: (n) => `Транзакцій: ${n}`,
    statsTotal: (s) => `Загалом витрат: ${s} ₴`,
    statsTop: "Топ категорії:",
    chooseAction: "Оберіть дію:",
  },
  en: {
    welcome:
      "👋 Hi! I'm *BudgUA Bot* — your expense tracker assistant.\n\nChoose an action:",
    linked: (name) =>
      `✅ Account linked!\n\nWelcome, *${name}*! 👋\n\n📸 Send receipt photos\n✍️ Or text like: _"Groceries 450"_`,
    badToken: "❌ Invalid token. Please try again.",
    enterToken: "🔑 Please enter your API token from BudgUA website profile:",
    alreadyLinked: (name) =>
      `✅ Your account is already linked as *${name}*.\n\nSend receipts or expenses as text!`,
    notLinked:
      "⚠️ Please connect your account first via «🔑 Connect account» button",
    scanning: "🔍 Analyzing receipt...",
    thinking: "🤔 Processing expense...",
    saved: (amt, cat, desc, date) =>
      `✅ *Saved!*\n\n💰 Amount: *${amt} UAH*\n🏷 ${cat}\n📝 ${desc || "—"}\n📅 ${date || "today"}`,
    savedText: (amt, cat, desc) =>
      `✅ *Saved!*\n\n💰 *${amt} UAH* — ${desc}\n🏷 ${cat}`,
    noAmount: '❌ Could not detect amount. Try: _"750 groceries"_',
    noReceipt:
      '❌ Could not read receipt. Try:\n• A clearer photo\n• Or text the amount: _"750 groceries"_',
    downloadErr: "❌ Could not download photo. Please try again.",
    saveErr: "❌ Save error. Check your connection.",
    unknownErr: "❌ Unexpected error. Try again later.",
    banned3: (hrs) =>
      `🚫 Too many failed attempts. Temporarily banned for ${hrs}h.`,
    langSet: "🇬🇧 Language set: English",
    statsTitle: "📊 *Monthly statistics*",
    statsEmpty: "📊 No transactions this month yet.",
    statsTx: (n) => `Transactions: ${n}`,
    statsTotal: (s) => `Total spent: ${s} UAH`,
    statsTop: "Top categories:",
    chooseAction: "Choose an action:",
  },
};

function t(chatId, key, ...args) {
  const lang = userLangs[chatId] || "uk";
  const val = T[lang][key];
  return typeof val === "function" ? val(...args) : val || key;
}

// ── Main menu keyboard ───────────────────────────────────
function mainMenu(chatId) {
  const lang = userLangs[chatId] || "uk";
  const isLinked = !!linkedUsers[chatId];
  if (lang === "en") {
    return {
      reply_markup: {
        keyboard: [
          [
            isLinked ? "✅ Account connected" : "🔑 Connect account",
            "💸 Add expense",
          ],
          ["📊 Monthly stats", "🌐 Language / Мова"],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
      parse_mode: "Markdown",
    };
  }
  return {
    reply_markup: {
      keyboard: [
        [
          isLinked ? "✅ Акаунт підключено" : "🔑 Підключити акаунт",
          "💸 Додати витрату",
        ],
        ["📊 Статистика за місяць", "🌐 Language / Мова"],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
    parse_mode: "Markdown",
  };
}

// ── Rate limiting ────────────────────────────────────────
function checkBanned(chatId) {
  const a = tokenAttempts[chatId];
  if (!a) return false;
  if (a.bannedUntil && Date.now() < a.bannedUntil) return true;
  if (a.bannedUntil && Date.now() >= a.bannedUntil) {
    delete tokenAttempts[chatId];
    return false;
  }
  return false;
}

function recordFailedAttempt(chatId) {
  if (!tokenAttempts[chatId])
    tokenAttempts[chatId] = { count: 0, bannedUntil: null };
  const a = tokenAttempts[chatId];
  a.count++;
  if (a.count >= 6) {
    a.bannedUntil = Date.now() + 12 * 60 * 60 * 1000; // 12h
    return 12;
  } else if (a.count >= 3) {
    a.bannedUntil = Date.now() + 3 * 60 * 60 * 1000; // 3h
    return 3;
  }
  return 0;
}

// ── Helpers ──────────────────────────────────────────────
async function downloadPhotoAsBase64(fileId) {
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
  const response = await axios({
    method: "GET",
    url: fileUrl,
    responseType: "arraybuffer",
    timeout: 30000,
  });
  return Buffer.from(response.data).toString("base64");
}

function cleanJson(text) {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

async function analyzeReceipt(base64Image, lang) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const prompt =
    lang === "en"
      ? 'Analyze this receipt. Return ONLY valid JSON, no markdown:\n{"amount":<number>,"category":"<Groceries|Cafe/Restaurant|Transport|Utilities|Clothing|Pharmacy|Entertainment|Electronics|Other>","description":"<store name>","date":"<YYYY-MM-DD or null>","rawText":"<text>"}'
      : 'Проаналізуй цей чек. Поверни ТІЛЬКИ JSON без markdown:\n{"amount":<число>,"category":"<Продукти|Кафе/Ресторан|Транспорт|Комунальні|Одяг|Ліки/Аптека|Розваги|Техніка|Інше>","description":"<назва>","date":"<YYYY-MM-DD або null>","rawText":"<текст>"}';
  const result = await model.generateContent([
    { inlineData: { data: base64Image, mimeType: "image/jpeg" } },
    prompt,
  ]);
  return JSON.parse(cleanJson(result.response.text().trim()));
}

async function analyzeText(text, lang) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const prompt =
    lang === "en"
      ? `Extract expense from text. Return ONLY JSON:\n{"amount":<number>,"category":"<Groceries|Cafe/Restaurant|Transport|Utilities|Clothing|Pharmacy|Entertainment|Electronics|Other>","description":"<desc>","date":null}\nText: "${text}"`
      : `Витягни витрату з тексту. Поверни ТІЛЬКИ JSON:\n{"amount":<число>,"category":"<Продукти|Кафе/Ресторан|Транспорт|Комунальні|Одяг|Ліки/Аптека|Розваги|Техніка|Інше>","description":"<опис>","date":null}\nТекст: "${text}"`;
  const result = await model.generateContent(prompt);
  return JSON.parse(cleanJson(result.response.text().trim()));
}

async function getBudgets(apiToken) {
  try {
    const { data } = await axios.get(`${BACKEND}/api/webhook/budgets`, {
      headers: { "x-api-token": apiToken },
      timeout: 8000,
    });
    return data || [];
  } catch {
    return [];
  }
}

async function saveTransaction(apiToken, data, chatId) {
  await axios.post(
    `${BACKEND}/api/webhook/transaction`,
    { ...data, chatId: String(chatId) },
    { headers: { "x-api-token": apiToken }, timeout: 10000 },
  );
}

async function linkAccount(chatId, token) {
  const { data } = await axios.post(
    `${BACKEND}/api/webhook/link-telegram`,
    { apiToken: token, chatId: String(chatId) },
    { timeout: 10000 },
  );
  return data;
}

// ── /start ───────────────────────────────────────────────
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (checkBanned(chatId)) {
    const a = tokenAttempts[chatId];
    const hrs = Math.ceil((a.bannedUntil - Date.now()) / 3600000);
    return bot.sendMessage(chatId, t(chatId, "banned3", hrs));
  }

  const token = match[1]?.trim();
  if (token) {
    try {
      const data = await linkAccount(chatId, token);
      linkedUsers[chatId] = token;
      if (tokenAttempts[chatId]) delete tokenAttempts[chatId];
      await bot.sendMessage(
        chatId,
        t(chatId, "linked", data.name),
        mainMenu(chatId),
      );
    } catch (e) {
      const hrs = recordFailedAttempt(chatId);
      if (hrs > 0) {
        await bot.sendMessage(chatId, t(chatId, "banned3", hrs));
      } else {
        await bot.sendMessage(chatId, t(chatId, "badToken"), mainMenu(chatId));
      }
    }
  } else {
    await bot.sendMessage(chatId, t(chatId, "welcome"), mainMenu(chatId));
  }
});

// ── Message handler ──────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (checkBanned(chatId)) {
    const a = tokenAttempts[chatId];
    const hrs = Math.ceil((a.bannedUntil - Date.now()) / 3600000);
    return bot.sendMessage(chatId, t(chatId, "banned3", hrs));
  }

  // Commands handled elsewhere
  if (text.startsWith("/")) return;

  // ── Awaiting token input ─────────────────────────────
  if (awaitingToken.has(chatId)) {
    awaitingToken.delete(chatId);
    const token = text.trim();
    try {
      const data = await linkAccount(chatId, token);
      linkedUsers[chatId] = token;
      if (tokenAttempts[chatId]) delete tokenAttempts[chatId];
      return bot.sendMessage(
        chatId,
        t(chatId, "linked", data.name),
        mainMenu(chatId),
      );
    } catch (e) {
      const hrs = recordFailedAttempt(chatId);
      if (hrs > 0) {
        return bot.sendMessage(chatId, t(chatId, "banned3", hrs));
      }
      const remaining = 3 - ((tokenAttempts[chatId]?.count || 0) % 3);
      return bot.sendMessage(
        chatId,
        t(chatId, "badToken") +
          ` (${remaining > 0 ? remaining : 3} attempts left)`,
        mainMenu(chatId),
      );
    }
  }

  // ── Menu button: Connect account ─────────────────────
  if (text === "🔑 Підключити акаунт" || text === "🔑 Connect account") {
    if (linkedUsers[chatId]) {
      const name = msg.chat.first_name || "user";
      return bot.sendMessage(
        chatId,
        t(chatId, "alreadyLinked", name),
        mainMenu(chatId),
      );
    }
    awaitingToken.add(chatId);
    return bot.sendMessage(chatId, t(chatId, "enterToken"), {
      parse_mode: "Markdown",
    });
  }

  // ── Menu button: Already linked (status) ─────────────
  if (text === "✅ Акаунт підключено" || text === "✅ Account connected") {
    const name = msg.chat.first_name || "";
    return bot.sendMessage(
      chatId,
      t(chatId, "alreadyLinked", name),
      mainMenu(chatId),
    );
  }

  // ── Menu button: Stats ───────────────────────────────
  if (text === "📊 Статистика за місяць" || text === "📊 Monthly stats") {
    const apiToken = linkedUsers[chatId];
    if (!apiToken)
      return bot.sendMessage(chatId, t(chatId, "notLinked"), mainMenu(chatId));
    const lang = userLangs[chatId] || "uk";
    try {
      const { data: statsData } = await axios.get(
        `${BACKEND}/api/webhook/stats`,
        {
          headers: { "x-api-token": apiToken },
          timeout: 8000,
        },
      );
      const monthly = statsData.transactions || [];
      const budget = statsData.budget;
      const now = new Date();
      const monthName = now.toLocaleString(lang === "en" ? "en-US" : "uk-UA", {
        month: "long",
        year: "numeric",
      });

      if (!monthly.length && !budget)
        return bot.sendMessage(
          chatId,
          t(chatId, "statsEmpty"),
          mainMenu(chatId),
        );

      const total = monthly.reduce((s, tx) => s + Number(tx.amount || 0), 0);
      const cats = {};
      monthly.forEach((tx) => {
        cats[tx.category] = (cats[tx.category] || 0) + Number(tx.amount || 0);
      });
      const sorted = Object.entries(cats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      let msg2 = `${t(chatId, "statsTitle")} — *${monthName}*\n\n`;
      msg2 += `${t(chatId, "statsTx", monthly.length)}\n`;
      msg2 += `${t(chatId, "statsTotal", total.toLocaleString())}\n`;

      if (budget) {
        const income = Number(budget.income || 0);
        const balance = income - total;
        msg2 +=
          lang === "en"
            ? `Income: ${income.toLocaleString()} UAH\n`
            : `Дохід: ${income.toLocaleString()} ₴\n`;
        msg2 +=
          (balance >= 0
            ? lang === "en"
              ? `✅ Balance: +${balance.toLocaleString()} UAH`
              : `✅ Залишок: +${balance.toLocaleString()} ₴`
            : lang === "en"
              ? `⚠️ Overspent: ${balance.toLocaleString()} UAH`
              : `⚠️ Перевитрата: ${balance.toLocaleString()} ₴`) + "\n";
      }

      if (sorted.length) {
        msg2 += "\n" + t(chatId, "statsTop") + "\n";
        sorted.forEach(([cat, sum]) => {
          msg2 += `  • ${cat}: ${sum.toLocaleString()} ₴\n`;
        });
      }

      // Categories vs plan
      if (budget?.categories?.length) {
        const header =
          lang === "en" ? "\n📊 *Plan vs Actual:*\n" : "\n📊 *План vs Факт:*\n";
        msg2 += header;
        budget.categories.forEach((c) => {
          const actual = cats[c.name] || 0;
          const planned = Number(c.planned || 0);
          const pct = planned > 0 ? Math.round((actual / planned) * 100) : null;
          const bar =
            planned > 0
              ? actual > planned
                ? "🔴"
                : actual > planned * 0.8
                  ? "🟡"
                  : "🟢"
              : "⚪";
          msg2 += `${bar} ${c.name}: ${actual.toLocaleString()}${pct !== null ? " / " + planned.toLocaleString() + " (" + pct + "%)" : ""}\n`;
        });
      }

      // Debts
      const allDebts = [
        ...(budget?.credits || []).map((c) => ({
          name: c.name,
          monthly: c.monthlyPayment,
          left: c.monthsLeft,
          type: lang === "en" ? "Loan" : "Кредит",
        })),
        ...(budget?.installments || []).map((i) => ({
          name: i.name,
          monthly: i.monthlyPayment,
          left: i.monthsLeft,
          type: lang === "en" ? "Install" : "Розстрочка",
        })),
        ...(budget?.creditCards || []).map((c) => ({
          name: c.name,
          monthly: c.payment || 0,
          debt: c.debt,
          type: "💳",
        })),
      ];
      if (allDebts.length) {
        msg2 += lang === "en" ? "\n💳 *Debts:*\n" : "\n💳 *Борги:*\n";
        allDebts.forEach((d) => {
          if (d.debt)
            msg2 += `  • ${d.name} [${d.type}]: ${Number(d.debt).toLocaleString()} ₴\n`;
          else
            msg2 += `  • ${d.name} [${d.type}]: ${Number(d.monthly).toLocaleString()} ₴/міс, ${d.left || "?"} міс.\n`;
        });
      }

      const opts = {
        parse_mode: "Markdown",
        reply_markup: mainMenu(chatId).reply_markup,
      };
      return bot.sendMessage(chatId, msg2, opts);
    } catch (e) {
      console.error("Stats error:", e.message);
      return bot.sendMessage(chatId, t(chatId, "unknownErr"), mainMenu(chatId));
    }
  }

  // ── Menu button: Language ────────────────────────────
  if (text === "🌐 Language / Мова") {
    return bot.sendMessage(chatId, "Choose language / Оберіть мову:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🇺🇦 Українська", callback_data: "lang_uk" },
            { text: "🇬🇧 English", callback_data: "lang_en" },
          ],
        ],
      },
    });
  }

  // ── Add expense button ───────────────────────────────
  if (text === "💸 Додати витрату" || text === "💸 Add expense") {
    const apiToken = linkedUsers[chatId];
    if (!apiToken)
      return bot.sendMessage(chatId, t(chatId, "notLinked"), mainMenu(chatId));
    return bot.sendMessage(
      chatId,
      userLangs[chatId] === "en"
        ? '💸 Send me a receipt photo or type your expense:\n_Example: "Groceries 450" or "Coffee 85"_'
        : '💸 Надішліть фото чеку або введіть витрату текстом:\n_Приклад: "Продукти 450" або "Кава 85"_',
      { parse_mode: "Markdown" },
    );
  }

  // ── Photo is handled separately ─────────────────────
  if (msg.photo) return;

  // ── Text expense ─────────────────────────────────────
  const apiToken = linkedUsers[chatId];
  if (!apiToken)
    return bot.sendMessage(chatId, t(chatId, "notLinked"), mainMenu(chatId));

  const lang = userLangs[chatId] || "uk";
  const status = await bot.sendMessage(chatId, t(chatId, "thinking"));
  const edit = (txt, opts = {}) =>
    bot
      .editMessageText(txt, {
        chat_id: chatId,
        message_id: status.message_id,
        parse_mode: "Markdown",
        ...opts,
      })
      .catch(() => {});

  try {
    let parsed;
    try {
      parsed = await analyzeText(text, lang);
    } catch (e) {
      await edit(t(chatId, "noAmount"));
      return;
    }

    if (!parsed?.amount || isNaN(Number(parsed.amount))) {
      await edit(t(chatId, "noAmount"));
      return;
    }

    try {
      await saveTransaction(
        apiToken,
        {
          amount: Number(parsed.amount),
          category: parsed.category || "Інше",
          description: parsed.description || text,
          date: parsed.date || null,
          rawText: text,
        },
        chatId,
      );
    } catch (e) {
      await edit(t(chatId, "saveErr"));
      return;
    }

    await edit(
      t(
        chatId,
        "savedText",
        parsed.amount,
        parsed.category,
        parsed.description || text,
      ),
    );
  } catch (e) {
    console.error("Text crash:", e);
    await edit(t(chatId, "unknownErr"));
  }
});

// ── Photo handler ────────────────────────────────────────
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  if (checkBanned(chatId)) return;
  const apiToken = linkedUsers[chatId];
  if (!apiToken)
    return bot.sendMessage(chatId, t(chatId, "notLinked"), mainMenu(chatId));

  const lang = userLangs[chatId] || "uk";
  const status = await bot.sendMessage(chatId, t(chatId, "scanning"));
  const edit = (txt, opts = {}) =>
    bot
      .editMessageText(txt, {
        chat_id: chatId,
        message_id: status.message_id,
        parse_mode: "Markdown",
        ...opts,
      })
      .catch(() => {});

  try {
    const photo = msg.photo[msg.photo.length - 1];
    let base64;
    try {
      base64 = await downloadPhotoAsBase64(photo.file_id);
    } catch (e) {
      await edit(t(chatId, "downloadErr"));
      return;
    }

    let parsed;
    try {
      parsed = await analyzeReceipt(base64, lang);
    } catch (e) {
      console.error("Gemini err:", e.message);
      await edit(t(chatId, "noReceipt"));
      return;
    }

    if (!parsed?.amount || isNaN(Number(parsed.amount))) {
      await edit(t(chatId, "noAmount"));
      return;
    }

    // Ask which budget to assign this expense to
    const budgetList = await getBudgets(apiToken);
    if (budgetList.length > 1) {
      // Store parsed data and let user choose budget via inline keyboard
      pendingPhotos[chatId] = { parsed, apiToken };
      const btns = budgetList.slice(0, 8).map((b) => [
        {
          text: b.title + (b.month ? " (" + b.month + ")" : ""),
          callback_data:
            "budget_" +
            b._id +
            "_" +
            JSON.stringify({
              amount: parsed.amount,
              category: parsed.category || "Інше",
              description: parsed.description || "",
              date: parsed.date || null,
              rawText: parsed.rawText || "",
            }).substring(0, 100),
        },
      ]);
      const lang = userLangs[chatId] || "uk";
      await edit(
        lang === "en"
          ? `✅ Receipt recognized: *${parsed.amount} UAH* — ${parsed.description || "—"}

Select budget to assign:`
          : `✅ Чек розпізнано: *${parsed.amount} ₴* — ${parsed.description || "—"}

Оберіть бюджет для цієї витрати:`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: btns } },
      );
    } else {
      // Only one budget — save directly
      const budgetId = budgetList[0]?._id || null;
      try {
        await saveTransaction(
          apiToken,
          {
            amount: Number(parsed.amount),
            category: parsed.category || "Інше",
            description: parsed.description || "",
            date: parsed.date || null,
            rawText: parsed.rawText || "",
            budgetId,
          },
          chatId,
        );
      } catch (e) {
        await edit(t(chatId, "saveErr"));
        return;
      }
      await edit(
        t(
          chatId,
          "saved",
          parsed.amount,
          parsed.category,
          parsed.description,
          parsed.date,
        ),
      );
    }
  } catch (e) {
    console.error("Photo crash:", e);
    await edit(t(chatId, "unknownErr"));
  }
});

// ── Inline keyboard callbacks ────────────────────────────
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === "lang_uk") {
    userLangs[chatId] = "uk";
    await bot.answerCallbackQuery(query.id, { text: "🇺🇦 Українська" });
    await bot.sendMessage(chatId, T.uk.langSet, mainMenu(chatId));
  } else if (query.data === "lang_en") {
    userLangs[chatId] = "en";
    await bot.answerCallbackQuery(query.id, { text: "🇬🇧 English" });
    await bot.sendMessage(chatId, T.en.langSet, mainMenu(chatId));
  } else if (query.data.startsWith("budget_")) {
    // budget_<budgetId>_<jsonData>
    const parts = query.data.split("_");
    const budgetId = parts[1];
    const pending = pendingPhotos[chatId];
    if (!pending) {
      await bot.answerCallbackQuery(query.id, { text: "⏳ Session expired" });
      return;
    }
    delete pendingPhotos[chatId];
    const { parsed, apiToken } = pending;
    try {
      await saveTransaction(
        apiToken,
        {
          amount: Number(parsed.amount),
          category: parsed.category || "Інше",
          description: parsed.description || "",
          date: parsed.date || null,
          rawText: parsed.rawText || "",
          budgetId,
        },
        chatId,
      );
      await bot.answerCallbackQuery(query.id, { text: "✅ Saved!" });
      const lang = userLangs[chatId] || "uk";
      await bot.editMessageText(
        t(
          chatId,
          "saved",
          parsed.amount,
          parsed.category,
          parsed.description,
          parsed.date,
        ),
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
        },
      );
    } catch (e) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Error saving" });
    }
  }
});

bot.on("polling_error", (err) => console.error("Polling error:", err.message));
process.on("unhandledRejection", (r) => console.error("Unhandled:", r));

console.log("🤖 BudgUA Bot started");
