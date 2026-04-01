require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const BACKEND = process.env.BACKEND_URL || 'http://backend:4000';

// ══════════════════════════════════════════════════════════
//  STATE — all state is authoritative in sessionCache
//  awaitingExpense / awaitingToken are pure in-memory flags
//  and reset on message, not on arbitrary async gaps
// ══════════════════════════════════════════════════════════
const sessionCache   = {};   // chatId -> session object from DB
const awaitingToken  = new Set();
const awaitingExpense = new Set();
const pendingTx      = {};   // chatId -> { parsed, apiToken }
const tokenAttempts  = {};   // chatId -> { count, bannedUntil }

// ── Session persistence ───────────────────────────────────
async function loadSession(chatId) {
  if(sessionCache[chatId]) return sessionCache[chatId];
  try {
    const { data } = await axios.get(`${BACKEND}/api/webhook/session/${chatId}`, { timeout:5000 });
    sessionCache[chatId] = data || {};
  } catch { sessionCache[chatId] = {}; }
  return sessionCache[chatId];
}

async function saveSession(chatId, patch) {
  const sess = sessionCache[chatId] || {};
  Object.assign(sess, patch);
  sessionCache[chatId] = sess;
  axios.post(`${BACKEND}/api/webhook/session/${chatId}`, sess, { timeout:5000 })
    .catch(e => console.warn('Session save failed:', e.message));
}

async function getApiToken(chatId) { return (await loadSession(chatId)).apiToken || null; }
async function getLang(chatId)     { return (await loadSession(chatId)).lang || 'uk'; }
async function getAiConfig(chatId) {
  const sess = await loadSession(chatId);
  return { provider: sess.aiProvider||'gemini', key: sess.aiKey||null };
}

// ══════════════════════════════════════════════════════════
//  AI — multi-provider: gemini | openai | deepseek
//  ONLY user's own key; no system key fallback for photo AI
// ══════════════════════════════════════════════════════════
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash'];

async function aiAnalyze(chatId, prompt, imageBase64 = null) {
  const { provider, key } = await getAiConfig(chatId);
  if(!key) throw new Error('NO_KEY');

  if(provider === 'gemini') {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    let lastErr;
    for(const model of GEMINI_MODELS) {
      try {
        const genAI  = new (GoogleGenerativeAI)(key);
        const client = genAI.getGenerativeModel({ model });
        const contents = imageBase64
          ? [{ inlineData:{ data:imageBase64, mimeType:'image/jpeg' } }, prompt]
          : prompt;
        const result = await client.generateContent(contents);
        return result.response.text().trim();
      } catch(e) { console.warn(`Gemini ${model}:`, e.message); lastErr = e; }
    }
    throw lastErr;
  }

  if(provider === 'openai' || provider === 'deepseek') {
    const baseURL = provider === 'openai'
      ? 'https://api.openai.com/v1'
      : 'https://api.deepseek.com/v1';
    const model = provider === 'openai' ? 'gpt-4o' : 'deepseek-chat';

    const messages = imageBase64
      ? [{ role:'user', content:[
            { type:'image_url', image_url:{ url:`data:image/jpeg;base64,${imageBase64}` } },
            { type:'text', text:prompt }
          ]}]
      : [{ role:'user', content: prompt }];

    const resp = await axios.post(`${baseURL}/chat/completions`, {
      model, messages, max_tokens:1000, temperature:0
    }, { headers:{ Authorization:`Bearer ${key}` }, timeout:30000 });
    return resp.data.choices[0].message.content.trim();
  }

  throw new Error('Unknown AI provider: ' + provider);
}

// ── i18n ─────────────────────────────────────────────────
const T = {
  uk: {
    welcome:          '👋 Привіт! Я *BudgUA Bot*\n\nОберіть дію в меню нижче:',
    linked:           n=>`✅ Акаунт прив\'язано! Вітаємо, *${n}* 👋`,
    badToken:         '❌ Невірний токен. Перевірте та спробуйте ще раз.',
    enterToken:       '🔑 Введіть ваш API токен з розділу «Кабінет» на сайті BudgUA:',
    alreadyLinked:    n=>`✅ Акаунт підключено як *${n}*`,
    notLinked:        '⚠️ Акаунт не підключено. Натисніть «🔑 Підключити акаунт»',
    noAiKey:          '⚠️ AI ключ не налаштовано.\n\nДля розпізнавання фото чеків потрібен власний ключ API.\n\nКабінет на сайті → «AI ключі» → оберіть провайдера та вставте ключ.\n\nАбо введіть витрату вручну текстом: _"Продукти 450"_',
    scanning:         '🔍 Аналізую чек...',
    thinking:         '🤔 Розпізнаю витрату...',
    saved:            (a,c,d,dt)=>`✅ *Збережено!*\n\n💰 *${a} ₴* — ${d||'—'}\n🏷 ${c}\n📅 ${dt||'сьогодні'}`,
    noAmount:         '❌ Не вдалося визначити суму. Спробуйте: _"Продукти 450"_',
    noReceipt:        '❌ Не вдалося розпізнати чек.\n• Чіткіше фото\n• Або текстом: _"450 грн"_',
    downloadErr:      '❌ Не вдалося завантажити фото.',
    saveErr:          '❌ Помилка збереження.',
    unknownErr:       '❌ Несподівана помилка.',
    banned3:          h=>`🚫 Заблоковано на ${h} год.`,
    langSet:          'Мову встановлено: Українська',
    statsTitle:       '📊 *Статистика за місяць*',
    statsEmpty:       '📊 Транзакцій за цей місяць ще немає.',
    statsTx:          n=>`Транзакцій: ${n}`,
    statsTotal:       s=>`Загалом витрат: ${s} ₴`,
    statsTop:         'Топ категорії:',
    chooseBudget:     '📋 Оберіть бюджет для цієї витрати:',
    chooseBudgetDef:  '📋 Оберіть бюджет за замовчуванням:',
    budgetSet:        t=>`✅ Бюджет: *${t}*`,
    noBudgets:        '📋 Немає бюджетів. Створіть на сайті BudgUA.',
    currentBudget:    t=>`Поточний: *${t}*`,
    sessionExpired:   '⏳ Сесія закінчилась. Надішліть ще раз.',
    addExpenseMode:   b=>`💸 *Режим додавання витрат*\nБюджет: *${b||'не обрано'}*\n\nНадішліть фото чеку або введіть суму текстом.\nДля повернення — кнопка «↩ Назад»`,
    backToMenu:       '↩ Головне меню',
    savedBack:        '↩ Повернутись до меню',
    btnConnect:       '🔑 Підключити акаунт',
    btnConnected:     '✅ Акаунт підключено',
    btnAddExpense:    '💸 Додати витрату',
    btnStats:         '📊 Статистика',
    btnBudget:        '📋 Обрати бюджет',
    btnBack:          '↩ Назад',
    btnLangOther:     'ENG',
    manualOnly:       '✍️ Лише вручну (немає AI ключа)',
  },
  en: {
    welcome:          '👋 Hi! I\'m *BudgUA Bot*\n\nChoose an action below:',
    linked:           n=>`✅ Account linked! Welcome, *${n}* 👋`,
    badToken:         '❌ Invalid token. Check and try again.',
    enterToken:       '🔑 Enter your API token from BudgUA Profile:',
    alreadyLinked:    n=>`✅ Account connected as *${n}*`,
    notLinked:        '⚠️ Not connected. Tap «🔑 Connect account»',
    noAiKey:          '⚠️ No AI key configured.\n\nTo scan receipt photos you need your own API key.\n\nGo to Profile on the website → «AI Keys» → choose provider and add key.\n\nOr type expense manually: _"Groceries 450"_',
    scanning:         '🔍 Analyzing receipt...',
    thinking:         '🤔 Processing expense...',
    saved:            (a,c,d,dt)=>`✅ *Saved!*\n\n💰 *${a} UAH* — ${d||'—'}\n🏷 ${c}\n📅 ${dt||'today'}`,
    noAmount:         '❌ Could not detect amount. Try: _"Groceries 450"_',
    noReceipt:        '❌ Could not read receipt.\n• Clearer photo\n• Or text: _"450"_',
    downloadErr:      '❌ Could not download photo.',
    saveErr:          '❌ Save error.',
    unknownErr:       '❌ Unexpected error.',
    banned3:          h=>`🚫 Banned for ${h}h.`,
    langSet:          'Language: English',
    statsTitle:       '📊 *Monthly Statistics*',
    statsEmpty:       '📊 No transactions this month.',
    statsTx:          n=>`Transactions: ${n}`,
    statsTotal:       s=>`Total: ${s} UAH`,
    statsTop:         'Top categories:',
    chooseBudget:     '📋 Select budget for this expense:',
    chooseBudgetDef:  '📋 Select default budget:',
    budgetSet:        t=>`✅ Budget: *${t}*`,
    noBudgets:        '📋 No budgets. Create one on BudgUA.',
    currentBudget:    t=>`Current: *${t}*`,
    sessionExpired:   '⏳ Session expired. Please try again.',
    addExpenseMode:   b=>`💸 *Expense mode*\nBudget: *${b||'not set'}*\n\nSend a receipt photo or type an amount.\nTap «↩ Back» to return.`,
    backToMenu:       '↩ Main menu',
    savedBack:        '↩ Return to menu',
    btnConnect:       '🔑 Connect account',
    btnConnected:     '✅ Account connected',
    btnAddExpense:    '💸 Add expense',
    btnStats:         '📊 Statistics',
    btnBudget:        '📋 Select budget',
    btnBack:          '↩ Back',
    btnLangOther:     'UA',
    manualOnly:       '✍️ Manual only (no AI key)',
  }
};

async function t(chatId, key, ...args) {
  const lang = await getLang(chatId);
  const val  = T[lang]?.[key] ?? T.uk[key];
  return typeof val === 'function' ? val(...args) : (val ?? key);
}

// ── Keyboards ────────────────────────────────────────────
async function mainMenu(chatId) {
  const lang     = await getLang(chatId);
  const L        = T[lang];
  const apiToken = await getApiToken(chatId);
  // Always exit expense mode when showing main menu
  awaitingExpense.delete(chatId);
  return {
    reply_markup: {
      keyboard: [
        [apiToken ? L.btnConnected : L.btnConnect, L.btnAddExpense],
        [L.btnStats, L.btnBudget],
        [L.btnLangOther],
      ],
      resize_keyboard: true, one_time_keyboard: false
    },
    parse_mode: 'Markdown'
  };
}

async function expenseMenu(chatId) {
  const lang = await getLang(chatId);
  return {
    reply_markup: {
      keyboard: [[T[lang].btnBack]],
      resize_keyboard: true, one_time_keyboard: false
    },
    parse_mode: 'Markdown'
  };
}

// After saving — show "Back" button inline
function savedWithBackBtn(lang) {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: T[lang].savedBack, callback_data: 'back_to_menu' }]]
    }
  };
}

// ── Rate limiting ────────────────────────────────────────
function checkBanned(chatId) {
  const a = tokenAttempts[chatId];
  if(!a?.bannedUntil) return false;
  if(Date.now() < a.bannedUntil) return true;
  delete tokenAttempts[chatId]; return false;
}
function recordFail(chatId) {
  if(!tokenAttempts[chatId]) tokenAttempts[chatId] = { count:0, bannedUntil:null };
  const a = tokenAttempts[chatId];
  a.count++;
  if(a.count >= 6) { a.bannedUntil = Date.now()+12*3600000; return 12; }
  if(a.count >= 3) { a.bannedUntil = Date.now()+ 3*3600000; return  3; }
  return 0;
}

// ── API helpers ──────────────────────────────────────────
async function getBudgets(apiToken) {
  try {
    const { data } = await axios.get(`${BACKEND}/api/webhook/budgets`,
      { headers:{ 'x-api-token':apiToken }, timeout:8000 });
    return data||[];
  } catch { return []; }
}

async function saveTransaction(apiToken, data, chatId) {
  await axios.post(`${BACKEND}/api/webhook/transaction`,
    { ...data, chatId:String(chatId) },
    { headers:{ 'x-api-token':apiToken }, timeout:10000 });
}

async function linkAccount(chatId, token) {
  const { data } = await axios.post(`${BACKEND}/api/webhook/link-telegram`,
    { apiToken:token, chatId:String(chatId) }, { timeout:10000 });
  return data;
}

async function downloadPhotoAsBase64(fileId) {
  const info = await bot.getFile(fileId);
  const url  = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${info.file_path}`;
  const resp = await axios({ method:'GET', url, responseType:'arraybuffer', timeout:30000 });
  return Buffer.from(resp.data).toString('base64');
}

function cleanJson(s) { return s.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim(); }

async function analyzeReceiptAI(chatId, base64) {
  const lang = await getLang(chatId);
  const prompt = lang==='en'
    ? 'Analyze receipt. Return ONLY JSON no markdown:\n{"amount":<number>,"category":"<Groceries|Cafe/Restaurant|Transport|Utilities|Clothing|Pharmacy|Entertainment|Electronics|Other>","description":"<store>","date":"<YYYY-MM-DD or null>","rawText":"<text>"}'
    : 'Проаналізуй чек. ТІЛЬКИ JSON без markdown:\n{"amount":<число>,"category":"<Продукти|Кафе/Ресторан|Транспорт|Комунальні|Одяг|Ліки/Аптека|Розваги|Техніка|Інше>","description":"<назва>","date":"<YYYY-MM-DD або null>","rawText":"<текст>"}';
  const raw = await aiAnalyze(chatId, prompt, base64);
  return JSON.parse(cleanJson(raw));
}

async function analyzeTextAI(chatId, text) {
  const lang = await getLang(chatId);
  const prompt = lang==='en'
    ? `Extract expense. ONLY JSON:\n{"amount":<number>,"category":"<Groceries|Cafe/Restaurant|Transport|Utilities|Clothing|Pharmacy|Entertainment|Electronics|Other>","description":"<desc>","date":null}\nText:"${text}"`
    : `Витягни витрату. ТІЛЬКИ JSON:\n{"amount":<число>,"category":"<Продукти|Кафе/Ресторан|Транспорт|Комунальні|Одяг|Ліки/Аптека|Розваги|Техніка|Інше>","description":"<опис>","date":null}\nТекст:"${text}"`;
  const raw = await aiAnalyze(chatId, prompt);
  return JSON.parse(cleanJson(raw));
}

// ── Budget resolution ────────────────────────────────────
async function resolveBudget(chatId, apiToken) {
  const budgets = await getBudgets(apiToken);
  if(!budgets.length) return { budgetId:null, budgets };
  if(budgets.length===1) return { budgetId:budgets[0]._id, budgets };
  const sess = await loadSession(chatId);
  if(sess.selectedBudget?.id) return { budgetId:sess.selectedBudget.id, budgets };
  return { needsChoice:true, budgets };
}

function budgetBtns(budgets, prefix) {
  return budgets.slice(0,8).map(b=>[{
    text: b.title+(b.month?' '+b.month:''),
    callback_data: prefix+':'+b._id+':'+b.title.slice(0,25)
  }]);
}

async function doSaveTransaction(chatId, apiToken, parsed, rawText, budgetId) {
  await saveTransaction(apiToken, {
    amount:      Number(parsed.amount),
    category:    parsed.category||'Інше',
    description: parsed.description||rawText||'',
    date:        parsed.date||null,
    rawText:     rawText||parsed.rawText||'',
    budgetId,
  }, chatId);
}

// ══════════════════════════════════════════════════════════
//  /start
// ══════════════════════════════════════════════════════════
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if(checkBanned(chatId)) {
    const h = Math.ceil((tokenAttempts[chatId].bannedUntil-Date.now())/3600000);
    return bot.sendMessage(chatId, await t(chatId,'banned3',h));
  }
  // Always reset expense mode on /start
  awaitingExpense.delete(chatId);
  awaitingToken.delete(chatId);

  const token = match[1]?.trim();
  if(token) {
    try {
      const data = await linkAccount(chatId, token);
      await saveSession(chatId, { apiToken:token });
      delete tokenAttempts[chatId];
      return bot.sendMessage(chatId, await t(chatId,'linked',data.name), await mainMenu(chatId));
    } catch {
      const h = recordFail(chatId);
      if(h>0) return bot.sendMessage(chatId, await t(chatId,'banned3',h));
      return bot.sendMessage(chatId, await t(chatId,'badToken'), await mainMenu(chatId));
    }
  }
  return bot.sendMessage(chatId, await t(chatId,'welcome'), await mainMenu(chatId));
});

// ══════════════════════════════════════════════════════════
//  MESSAGE HANDLER
//  Key fix: ALL known menu-button texts immediately exit
//  expense mode FIRST, then handle the button action.
//  This eliminates the "ghost expense mode" bug.
// ══════════════════════════════════════════════════════════
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = (msg.text||'').trim();

  if(checkBanned(chatId)) {
    const h = Math.ceil((tokenAttempts[chatId].bannedUntil-Date.now())/3600000);
    return bot.sendMessage(chatId, await t(chatId,'banned3',h));
  }
  if(text.startsWith('/')) return;
  if(msg.photo) return; // handled by photo handler

  const lang     = await getLang(chatId);
  const L        = T[lang];
  const Lother   = lang==='uk' ? T.en : T.uk; // other language labels
  const apiToken = await getApiToken(chatId);

  // ── Collect ALL known menu button texts (both languages) ─
  const ALL_MENU_BTNS = new Set([
    T.uk.btnConnect, T.uk.btnConnected, T.uk.btnStats, T.uk.btnBudget,
    T.en.btnConnect, T.en.btnConnected, T.en.btnStats, T.en.btnBudget,
    T.uk.btnBack, T.en.btnBack,
    'UA','ENG',
  ]);
  // AddExpense buttons intentionally NOT in this set — handled separately below

  // ── Token input (highest priority, no state conflicts) ──
  if(awaitingToken.has(chatId)) {
    awaitingToken.delete(chatId);
    // If user typed a menu button while awaitingToken — exit gracefully
    if(ALL_MENU_BTNS.has(text) || text===L.btnAddExpense || text===Lother.btnAddExpense) {
      await bot.sendMessage(chatId, await t(chatId,'welcome'), await mainMenu(chatId));
      return;
    }
    try {
      const data = await linkAccount(chatId, text);
      await saveSession(chatId, { apiToken:text });
      delete tokenAttempts[chatId];
      return bot.sendMessage(chatId, await t(chatId,'linked',data.name), await mainMenu(chatId));
    } catch {
      const h = recordFail(chatId);
      if(h>0) return bot.sendMessage(chatId, await t(chatId,'banned3',h));
      const left = Math.max(0, 3-(tokenAttempts[chatId]?.count||0)%3);
      return bot.sendMessage(chatId,
        await t(chatId,'badToken')+(left>0?` (${left} ${lang==='en'?'left':'залишилось'})`:''),
        await mainMenu(chatId));
    }
  }

  // ── Back button — always exits expense mode ──────────────
  if(text===T.uk.btnBack || text===T.en.btnBack) {
    awaitingExpense.delete(chatId);
    delete pendingTx[chatId];
    return bot.sendMessage(chatId, await t(chatId,'backToMenu'), await mainMenu(chatId));
  }

  // ── Language toggle ──────────────────────────────────────
  if(text==='UA') {
    awaitingExpense.delete(chatId); // exit expense mode on lang change
    await saveSession(chatId,{lang:'uk'});
    return bot.sendMessage(chatId, T.uk.langSet, await mainMenu(chatId));
  }
  if(text==='ENG') {
    awaitingExpense.delete(chatId);
    await saveSession(chatId,{lang:'en'});
    return bot.sendMessage(chatId, T.en.langSet, await mainMenu(chatId));
  }

  // ── If text matches ANY non-addExpense menu button → exit expense mode first ──
  if(ALL_MENU_BTNS.has(text)) {
    awaitingExpense.delete(chatId); // ← KEY FIX: reset before handling any menu action
  }

  // ── Add Expense button — ENTER expense mode ──────────────
  if(text===L.btnAddExpense || text===Lother.btnAddExpense) {
    if(!apiToken) return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));
    // Reset any stale expense state
    awaitingExpense.delete(chatId);
    delete pendingTx[chatId];

    const sess = await loadSession(chatId);
    let budgetTitle = sess.selectedBudget?.title || null;

    if(!budgetTitle) {
      const budgets = await getBudgets(apiToken);
      if(budgets.length===1) {
        await saveSession(chatId,{selectedBudget:{id:budgets[0]._id,title:budgets[0].title}});
        budgetTitle = budgets[0].title;
      } else if(budgets.length>1) {
        return bot.sendMessage(chatId, await t(chatId,'chooseBudgetDef'), {
          parse_mode:'Markdown',
          reply_markup:{ inline_keyboard:budgetBtns(budgets,'setdefexp') }
        });
      }
    }

    awaitingExpense.add(chatId);
    return bot.sendMessage(chatId,
      await t(chatId,'addExpenseMode', budgetTitle),
      await expenseMenu(chatId));
  }

  // ── In expense mode → process text expense ───────────────
  if(awaitingExpense.has(chatId)) {
    if(!apiToken) {
      awaitingExpense.delete(chatId);
      return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));
    }

    const status = await bot.sendMessage(chatId, await t(chatId,'thinking'));
    const edit   = (txt,opts={}) => bot.editMessageText(txt,{
      chat_id:chatId, message_id:status.message_id, parse_mode:'Markdown', ...opts
    }).catch(()=>{});

    try {
      let parsed;
      try { parsed = await analyzeTextAI(chatId, text); }
      catch(e) {
        if(e.message==='NO_KEY') { await edit(await t(chatId,'noAiKey')); return; }
        await edit(await t(chatId,'noAmount')); return;
      }

      if(!parsed?.amount||isNaN(+parsed.amount)) { await edit(await t(chatId,'noAmount')); return; }

      const res = await resolveBudget(chatId, apiToken);
      if(res.needsChoice) {
        pendingTx[chatId] = { parsed, apiToken, rawText:text };
        await edit(lang==='en'
          ? `💬 *${parsed.amount} UAH* — ${parsed.description||text}\n\nSelect budget:`
          : `💬 *${parsed.amount} ₴* — ${parsed.description||text}\n\nОберіть бюджет:`,
          { reply_markup:{ inline_keyboard:budgetBtns(res.budgets,'savetx') } });
        return;
      }

      await doSaveTransaction(chatId, apiToken, parsed, text, res.budgetId);
      const savedMsg = await t(chatId,'saved',parsed.amount,parsed.category,parsed.description||text,parsed.date);
      await edit(savedMsg, savedWithBackBtn(lang));
    } catch(e) {
      console.error('Expense text crash:', e.message);
      await edit(await t(chatId,'unknownErr'));
    }
    return; // stay in expense mode — user uses "Back" to exit
  }

  // ── Menu buttons (outside expense mode) ─────────────────

  // Connect account
  if(text===L.btnConnect||text===Lother.btnConnect) {
    if(apiToken) return bot.sendMessage(chatId, await t(chatId,'alreadyLinked',msg.chat.first_name||''), await mainMenu(chatId));
    awaitingToken.add(chatId);
    return bot.sendMessage(chatId, await t(chatId,'enterToken'), { parse_mode:'Markdown' });
  }

  // Account status
  if(text===L.btnConnected||text===Lother.btnConnected) {
    return bot.sendMessage(chatId, await t(chatId,'alreadyLinked',msg.chat.first_name||''), await mainMenu(chatId));
  }

  // Select budget
  if(text===L.btnBudget||text===Lother.btnBudget) {
    if(!apiToken) return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));
    const budgets = await getBudgets(apiToken);
    if(!budgets.length) return bot.sendMessage(chatId, await t(chatId,'noBudgets'), await mainMenu(chatId));
    if(budgets.length===1) {
      await saveSession(chatId,{selectedBudget:{id:budgets[0]._id,title:budgets[0].title}});
      return bot.sendMessage(chatId, await t(chatId,'budgetSet',budgets[0].title), await mainMenu(chatId));
    }
    const sess = await loadSession(chatId);
    const curNote = sess.selectedBudget ? '\n'+await t(chatId,'currentBudget',sess.selectedBudget.title) : '';
    return bot.sendMessage(chatId, await t(chatId,'chooseBudgetDef')+curNote, {
      parse_mode:'Markdown', reply_markup:{ inline_keyboard:budgetBtns(budgets,'setdef') } });
  }

  // Statistics
  if(text===L.btnStats||text===Lother.btnStats) {
    if(!apiToken) return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));
    try {
      const { data:sd } = await axios.get(`${BACKEND}/api/webhook/stats`,
        { headers:{ 'x-api-token':apiToken }, timeout:8000 });
      const monthly = sd.transactions||[];
      const budget  = sd.budget;
      const now     = new Date();
      const mName   = now.toLocaleString(lang==='en'?'en-US':'uk-UA',{month:'long',year:'numeric'});
      if(!monthly.length&&!budget) return bot.sendMessage(chatId, await t(chatId,'statsEmpty'), await mainMenu(chatId));

      const total = monthly.reduce((s,tx)=>s+Number(tx.amount||0),0);
      const cats  = {};
      monthly.forEach(tx=>{cats[tx.category]=(cats[tx.category]||0)+Number(tx.amount||0);});
      const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5);

      let out = `${await t(chatId,'statsTitle')} — *${mName}*\n\n`;
      out += `${await t(chatId,'statsTx',monthly.length)}\n`;
      out += `${await t(chatId,'statsTotal',total.toLocaleString())}\n`;

      if(budget){
        const inc=Number(budget.income||0), bal=inc-total;
        out += lang==='en'?`Income: ${inc.toLocaleString()} UAH\n`:`Дохід: ${inc.toLocaleString()} ₴\n`;
        out += (bal>=0
          ? (lang==='en'?`✅ +${bal.toLocaleString()} UAH`:`✅ +${bal.toLocaleString()} ₴`)
          : (lang==='en'?`⚠️ -${Math.abs(bal).toLocaleString()} UAH`:`⚠️ -${Math.abs(bal).toLocaleString()} ₴`)
        )+'\n';
      }
      if(sorted.length){ out+='\n'+await t(chatId,'statsTop')+'\n'; sorted.forEach(([c,s])=>{out+=`  • ${c}: ${s.toLocaleString()} ₴\n`;}); }
      if(budget?.categories?.length){
        out+=lang==='en'?'\n📊 *Plan vs Actual:*\n':'\n📊 *План vs Факт:*\n';
        budget.categories.forEach(c=>{
          const a=cats[c.name]||0,p=Number(c.planned||0),pct=p>0?Math.round((a/p)*100):null;
          const icon=p>0?(a>p?'🔴':a>p*.8?'🟡':'🟢'):'⚪';
          out+=`${icon} ${c.name}: ${a.toLocaleString()}${pct!==null?' / '+p.toLocaleString()+' ('+pct+'%)':''}\n`;
        });
      }
      const debts=[...(budget?.credits||[]).map(c=>({n:c.name,v:c.monthlyPayment,t:lang==='en'?'Loan':'Кредит'})),
                   ...(budget?.installments||[]).map(i=>({n:i.name,v:i.monthlyPayment,t:lang==='en'?'Install.':'Розстрочка'})),
                   ...(budget?.creditCards||[]).map(c=>({n:c.name,v:c.debt,t:'💳',isDebt:true}))];
      if(debts.length){
        out+=lang==='en'?'\n💳 *Debts:*\n':'\n💳 *Борги:*\n';
        debts.forEach(d=>{out+=d.isDebt?`  • ${d.n}[${d.t}]: ${Number(d.v).toLocaleString()} ₴\n`:`  • ${d.n}[${d.t}]: ${Number(d.v).toLocaleString()} ₴/міс\n`;});
      }
      return bot.sendMessage(chatId, out, { parse_mode:'Markdown', reply_markup:(await mainMenu(chatId)).reply_markup });
    } catch(e){ console.error('Stats:',e.message); return bot.sendMessage(chatId, await t(chatId,'unknownErr'), await mainMenu(chatId)); }
  }
});

// ══════════════════════════════════════════════════════════
//  PHOTO HANDLER
// ══════════════════════════════════════════════════════════
bot.on('photo', async (msg) => {
  const chatId   = msg.chat.id;
  if(checkBanned(chatId)) return;
  const apiToken = await getApiToken(chatId);
  if(!apiToken) return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));

  // Check AI key before downloading
  const { key } = await getAiConfig(chatId);
  if(!key) return bot.sendMessage(chatId, await t(chatId,'noAiKey'), { parse_mode:'Markdown' });

  const lang   = await getLang(chatId);
  const status = await bot.sendMessage(chatId, await t(chatId,'scanning'));
  const edit   = (txt,opts={}) => bot.editMessageText(txt,{
    chat_id:chatId, message_id:status.message_id, parse_mode:'Markdown', ...opts
  }).catch(()=>{});

  try {
    const photo = msg.photo[msg.photo.length-1];
    let base64;
    try { base64 = await downloadPhotoAsBase64(photo.file_id); }
    catch { await edit(await t(chatId,'downloadErr')); return; }

    let parsed;
    try { parsed = await analyzeReceiptAI(chatId, base64); }
    catch(e) {
      console.error('AI err:', e.message);
      if(e.message==='NO_KEY') { await edit(await t(chatId,'noAiKey')); return; }
      await edit(await t(chatId,'noReceipt')); return;
    }

    if(!parsed?.amount||isNaN(+parsed.amount)) { await edit(await t(chatId,'noAmount')); return; }

    const res = await resolveBudget(chatId, apiToken);
    if(res.needsChoice) {
      pendingTx[chatId] = { parsed, apiToken, rawText:'' };
      await edit(lang==='en'
        ? `✅ Receipt: *${parsed.amount} UAH* — ${parsed.description||'—'}\n\nSelect budget:`
        : `✅ Чек: *${parsed.amount} ₴* — ${parsed.description||'—'}\n\nОберіть бюджет:`,
        { reply_markup:{ inline_keyboard:budgetBtns(res.budgets,'savetx') } });
      return;
    }

    await doSaveTransaction(chatId, apiToken, parsed, '', res.budgetId);
    const savedMsg = await t(chatId,'saved',parsed.amount,parsed.category,parsed.description,parsed.date);
    await edit(savedMsg, savedWithBackBtn(lang));
  } catch(e) { console.error('Photo crash:', e.message); await edit(await t(chatId,'unknownErr')); }
});

// ══════════════════════════════════════════════════════════
//  CALLBACK QUERIES
// ══════════════════════════════════════════════════════════
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;

  // Back to menu (inline button after save)
  if(data === 'back_to_menu') {
    awaitingExpense.delete(chatId);
    delete pendingTx[chatId];
    await bot.answerCallbackQuery(query.id);
    return bot.sendMessage(chatId, await t(chatId,'backToMenu'), await mainMenu(chatId));
  }

  // Set default budget then enter expense mode: setdefexp:<budgetId>:<title>
  if(data.startsWith('setdefexp:')) {
    const parts = data.split(':');
    const budgetId = parts[1];
    const title    = parts.slice(2).join(':');
    await saveSession(chatId,{ selectedBudget:{ id:budgetId, title } });
    await bot.answerCallbackQuery(query.id,{ text:'✅' });
    await bot.editMessageText(await t(chatId,'budgetSet',title),
      { chat_id:chatId, message_id:query.message.message_id, parse_mode:'Markdown' }).catch(()=>{});
    awaitingExpense.add(chatId);
    return bot.sendMessage(chatId, await t(chatId,'addExpenseMode',title), await expenseMenu(chatId));
  }

  // Set default budget (from budget menu): setdef:<budgetId>:<title>
  if(data.startsWith('setdef:')) {
    const parts = data.split(':');
    const budgetId = parts[1];
    const title    = parts.slice(2).join(':');
    await saveSession(chatId,{ selectedBudget:{ id:budgetId, title } });
    await bot.answerCallbackQuery(query.id,{ text:'✅' });
    await bot.editMessageText(await t(chatId,'budgetSet',title),
      { chat_id:chatId, message_id:query.message.message_id, parse_mode:'Markdown' }).catch(()=>{});
    return;
  }

  // Save tx to chosen budget: savetx:<budgetId>:<title>
  if(data.startsWith('savetx:')) {
    const parts = data.split(':');
    const budgetId = parts[1];
    const pending  = pendingTx[chatId];
    if(!pending) {
      await bot.answerCallbackQuery(query.id,{ text:'⏳' });
      await bot.editMessageText(await t(chatId,'sessionExpired'),
        { chat_id:chatId, message_id:query.message.message_id }).catch(()=>{});
      return;
    }
    delete pendingTx[chatId];
    const { parsed, apiToken, rawText } = pending;
    const lang = await getLang(chatId);
    try {
      await doSaveTransaction(chatId, apiToken, parsed, rawText, budgetId);
      await bot.answerCallbackQuery(query.id,{ text:'✅' });
      await bot.editMessageText(
        await t(chatId,'saved',parsed.amount,parsed.category,parsed.description||(rawText||''),parsed.date),
        { chat_id:chatId, message_id:query.message.message_id, parse_mode:'Markdown',
          ...savedWithBackBtn(lang) }).catch(()=>{});
    } catch {
      await bot.answerCallbackQuery(query.id,{ text:'❌' });
      await bot.editMessageText(await t(chatId,'saveErr'),
        { chat_id:chatId, message_id:query.message.message_id }).catch(()=>{});
    }
    return;
  }
});

bot.on('polling_error', e=>console.error('Polling:',e.message));
process.on('unhandledRejection', r=>console.error('Unhandled:',r));
console.log('🤖 BudgUA Bot v10 started — multi-provider AI, persistent sessions');
