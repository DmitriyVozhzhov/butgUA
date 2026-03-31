require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const BACKEND = process.env.BACKEND_URL || 'http://backend:4000';

// ── In-memory state (session cache — populated from DB on first use) ──
const sessionCache   = {};   // chatId -> { apiToken, lang, selectedBudget:{id,title} }
const awaitingToken  = new Set();
const awaitingExpense = new Set(); // chatId is in "add expense" mode
const pendingTx      = {};   // chatId -> { parsed, apiToken }
const tokenAttempts  = {};   // chatId -> { count, bannedUntil }

// ── Persist session to backend ────────────────────────────
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
  try {
    await axios.post(`${BACKEND}/api/webhook/session/${chatId}`, sess, { timeout:5000 });
  } catch(e) { console.warn('Session save failed:', e.message); }
}

async function getApiToken(chatId) {
  const sess = await loadSession(chatId);
  return sess.apiToken || null;
}

async function getLang(chatId) {
  const sess = await loadSession(chatId);
  return sess.lang || 'uk';
}

// ── Gemini with user API key + fallback ───────────────────
const MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.0-pro'];

async function getGeminiClient(chatId) {
  const sess = await loadSession(chatId);
  const key = sess.geminiKey || process.env.GEMINI_API_KEY;
  return new GoogleGenerativeAI(key);
}

async function geminiGenerate(chatId, contents, isMultimodal) {
  const sess = await loadSession(chatId);
  const userKey = sess.geminiKey;
  const fallbackKey = process.env.GEMINI_API_KEY;

  // Try user key first (all models), then fallback key
  const attempts = [];
  if(userKey && userKey !== fallbackKey) {
    MODEL_CHAIN.forEach(m => attempts.push({ key: userKey, model: m }));
  }
  MODEL_CHAIN.forEach(m => attempts.push({ key: fallbackKey, model: m }));

  let lastErr;
  for(const { key, model } of attempts) {
    try {
      const genAI  = new GoogleGenerativeAI(key);
      const client = genAI.getGenerativeModel({ model });
      const result = await client.generateContent(contents);
      return result.response.text().trim();
    } catch(e) {
      console.warn(`Gemini ${model} failed:`, e.message);
      lastErr = e;
    }
  }
  throw lastErr || new Error('All Gemini attempts failed');
}

// ── i18n ─────────────────────────────────────────────────
const T = {
  uk: {
    welcome:           '👋 Привіт! Я *BudgUA Bot*\n\nОберіть дію в меню нижче:',
    linked:            n=>`✅ Акаунт прив\'язано! Вітаємо, *${n}* 👋`,
    badToken:          '❌ Невірний токен. Перевірте та спробуйте ще раз.',
    enterToken:        '🔑 Введіть ваш API токен з розділу «Кабінет» на сайті BudgUA:',
    alreadyLinked:     n=>`✅ Акаунт підключено як *${n}*`,
    notLinked:         '⚠️ Акаунт не підключено. Натисніть «🔑 Підключити акаунт»',
    scanning:          '🔍 Аналізую чек...',
    thinking:          '🤔 Розпізнаю витрату...',
    saved:             (a,c,d,dt)=>`✅ *Збережено!*\n\n💰 *${a} ₴* — ${d||'—'}\n🏷 ${c}\n📅 ${dt||'сьогодні'}`,
    noAmount:          '❌ Не вдалося визначити суму. Спробуйте: _"Продукти 450"_',
    noReceipt:         '❌ Не вдалося розпізнати чек.\n• Чіткіше фото\n• Або текстом: _"450 грн"_',
    downloadErr:       '❌ Не вдалося завантажити фото.',
    saveErr:           '❌ Помилка збереження.',
    unknownErr:        '❌ Несподівана помилка.',
    banned3:           h=>`🚫 Заблоковано на ${h} год.`,
    langSet:           'Мову встановлено: Українська',
    statsTitle:        '📊 *Статистика за місяць*',
    statsEmpty:        '📊 Транзакцій за цей місяць ще немає.',
    statsTx:           n=>`Транзакцій: ${n}`,
    statsTotal:        s=>`Загалом витрат: ${s} ₴`,
    statsTop:          'Топ категорії:',
    chooseBudget:      '📋 Оберіть бюджет для цієї витрати:',
    chooseBudgetDef:   '📋 Оберіть бюджет за замовчуванням:',
    budgetSet:         t=>`✅ Бюджет: *${t}*`,
    noBudgets:         '📋 Немає бюджетів. Створіть на сайті BudgUA.',
    currentBudget:     t=>`Поточний: *${t}*`,
    sessionExpired:    '⏳ Сесія закінчилась. Надішліть ще раз.',
    addExpenseMode:    b=>`💸 Режим додавання витрат\nБюджет: *${b||'—'}*\n\nНадішліть фото чеку або введіть суму текстом.\nДля повернення — кнопка «↩ Назад»`,
    backToMenu:        'Повернулись до головного меню.',
    btnConnect:        '🔑 Підключити акаунт',
    btnConnected:      '✅ Акаунт підключено',
    btnAddExpense:     '💸 Додати витрату',
    btnStats:          '📊 Статистика',
    btnBudget:         '📋 Обрати бюджет',
    btnBack:           '↩ Назад',
    btnLangOther:      'ENG',
  },
  en: {
    welcome:           '👋 Hi! I\'m *BudgUA Bot*\n\nChoose an action below:',
    linked:            n=>`✅ Account linked! Welcome, *${n}* 👋`,
    badToken:          '❌ Invalid token. Check and try again.',
    enterToken:        '🔑 Enter your API token from BudgUA Profile:',
    alreadyLinked:     n=>`✅ Account connected as *${n}*`,
    notLinked:         '⚠️ Not connected. Tap «🔑 Connect account»',
    scanning:          '🔍 Analyzing receipt...',
    thinking:          '🤔 Processing expense...',
    saved:             (a,c,d,dt)=>`✅ *Saved!*\n\n💰 *${a} UAH* — ${d||'—'}\n🏷 ${c}\n📅 ${dt||'today'}`,
    noAmount:          '❌ Could not detect amount. Try: _"Groceries 450"_',
    noReceipt:         '❌ Could not read receipt.\n• Clearer photo\n• Or text: _"450"_',
    downloadErr:       '❌ Could not download photo.',
    saveErr:           '❌ Save error.',
    unknownErr:        '❌ Unexpected error.',
    banned3:           h=>`🚫 Banned for ${h}h.`,
    langSet:           'Language: English',
    statsTitle:        '📊 *Monthly Statistics*',
    statsEmpty:        '📊 No transactions this month.',
    statsTx:           n=>`Transactions: ${n}`,
    statsTotal:        s=>`Total: ${s} UAH`,
    statsTop:          'Top categories:',
    chooseBudget:      '📋 Select budget for this expense:',
    chooseBudgetDef:   '📋 Select default budget:',
    budgetSet:         t=>`✅ Budget: *${t}*`,
    noBudgets:         '📋 No budgets. Create one on BudgUA.',
    currentBudget:     t=>`Current: *${t}*`,
    sessionExpired:    '⏳ Session expired. Please try again.',
    addExpenseMode:    b=>`💸 Expense mode\nBudget: *${b||'—'}*\n\nSend a receipt photo or type an amount.\nTap «↩ Back» to return.`,
    backToMenu:        'Back to main menu.',
    btnConnect:        '🔑 Connect account',
    btnConnected:      '✅ Account connected',
    btnAddExpense:     '💸 Add expense',
    btnStats:          '📊 Statistics',
    btnBudget:         '📋 Select budget',
    btnBack:           '↩ Back',
    btnLangOther:      'UA',
  }
};

async function t(chatId, key, ...args) {
  const lang = await getLang(chatId);
  const val  = T[lang]?.[key] || T.uk[key];
  return typeof val === 'function' ? val(...args) : (val || key);
}

// ── Menus ────────────────────────────────────────────────
async function mainMenu(chatId) {
  const lang     = await getLang(chatId);
  const L        = T[lang];
  const apiToken = await getApiToken(chatId);
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

async function analyzeReceipt(chatId, base64) {
  const lang = await getLang(chatId);
  const prompt = lang==='en'
    ? 'Analyze receipt. Return ONLY JSON no markdown:\n{"amount":<number>,"category":"<Groceries|Cafe/Restaurant|Transport|Utilities|Clothing|Pharmacy|Entertainment|Electronics|Other>","description":"<store>","date":"<YYYY-MM-DD or null>","rawText":"<text>"}'
    : 'Проаналізуй чек. ТІЛЬКИ JSON без markdown:\n{"amount":<число>,"category":"<Продукти|Кафе/Ресторан|Транспорт|Комунальні|Одяг|Ліки/Аптека|Розваги|Техніка|Інше>","description":"<назва>","date":"<YYYY-MM-DD або null>","rawText":"<текст>"}';
  const raw = await geminiGenerate(chatId, [{ inlineData:{ data:base64, mimeType:'image/jpeg' } }, prompt]);
  return JSON.parse(cleanJson(raw));
}

async function analyzeText(chatId, text) {
  const lang = await getLang(chatId);
  const prompt = lang==='en'
    ? `Extract expense. ONLY JSON:\n{"amount":<number>,"category":"<Groceries|Cafe/Restaurant|Transport|Utilities|Clothing|Pharmacy|Entertainment|Electronics|Other>","description":"<desc>","date":null}\nText:"${text}"`
    : `Витягни витрату. ТІЛЬКИ JSON:\n{"amount":<число>,"category":"<Продукти|Кафе/Ресторан|Транспорт|Комунальні|Одяг|Ліки/Аптека|Розваги|Техніка|Інше>","description":"<опис>","date":null}\nТекст:"${text}"`;
  const raw = await geminiGenerate(chatId, prompt);
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
    callback_data: prefix+b._id+':'+b.title.slice(0,28)
  }]);
}

// ── Process expense (shared for text + photo) ────────────
async function processExpense(chatId, parsed, rawText) {
  const apiToken = await getApiToken(chatId);
  if(!apiToken) return;
  const res = await resolveBudget(chatId, apiToken);
  if(res.needsChoice) {
    pendingTx[chatId] = { parsed, apiToken, rawText };
    return { chooseBudget: true, budgets: res.budgets };
  }
  await saveTransaction(apiToken, {
    amount:      Number(parsed.amount),
    category:    parsed.category||'Інше',
    description: parsed.description||rawText||'',
    date:        parsed.date||null,
    rawText:     rawText||parsed.rawText||'',
    budgetId:    res.budgetId,
  }, chatId);
  return { saved: true };
}

// ── /start ───────────────────────────────────────────────
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if(checkBanned(chatId)) {
    const h = Math.ceil((tokenAttempts[chatId].bannedUntil-Date.now())/3600000);
    return bot.sendMessage(chatId, await t(chatId,'banned3',h));
  }
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

// ── Message handler ──────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = (msg.text||'').trim();

  if(checkBanned(chatId)) {
    const h = Math.ceil((tokenAttempts[chatId].bannedUntil-Date.now())/3600000);
    return bot.sendMessage(chatId, await t(chatId,'banned3',h));
  }
  if(text.startsWith('/')) return;
  if(msg.photo) return;

  const lang     = await getLang(chatId);
  const L        = T[lang];
  const apiToken = await getApiToken(chatId);

  // ── Token input ──────────────────────────────────────
  if(awaitingToken.has(chatId)) {
    awaitingToken.delete(chatId);
    try {
      const data = await linkAccount(chatId, text);
      await saveSession(chatId, { apiToken:text });
      delete tokenAttempts[chatId];
      return bot.sendMessage(chatId, await t(chatId,'linked',data.name), await mainMenu(chatId));
    } catch {
      const h = recordFail(chatId);
      if(h>0) return bot.sendMessage(chatId, await t(chatId,'banned3',h));
      const left = Math.max(0, 3-(tokenAttempts[chatId]?.count||0)%3);
      const suffix = left>0 ? ` (${left} ${lang==='en'?'left':'залишилось'})` : '';
      return bot.sendMessage(chatId, await t(chatId,'badToken')+suffix, await mainMenu(chatId));
    }
  }

  // ── Back button — always exits expense mode ──────────
  if(text === L.btnBack || text === T.uk.btnBack || text === T.en.btnBack) {
    awaitingExpense.delete(chatId);
    delete pendingTx[chatId];
    return bot.sendMessage(chatId, await t(chatId,'backToMenu'), await mainMenu(chatId));
  }

  // ── Language toggle ──────────────────────────────────
  if(text === 'UA') {
    await saveSession(chatId, { lang:'uk' });
    return bot.sendMessage(chatId, T.uk.langSet, await mainMenu(chatId));
  }
  if(text === 'ENG') {
    await saveSession(chatId, { lang:'en' });
    return bot.sendMessage(chatId, T.en.langSet, await mainMenu(chatId));
  }

  // ── If in expense mode — treat ANY text as an expense ─
  if(awaitingExpense.has(chatId)) {
    if(!apiToken) {
      awaitingExpense.delete(chatId);
      return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));
    }
    const status = await bot.sendMessage(chatId, await t(chatId,'thinking'));
    const edit   = (txt,opts={}) => bot.editMessageText(txt,{ chat_id:chatId, message_id:status.message_id, parse_mode:'Markdown', ...opts }).catch(()=>{});
    try {
      let parsed;
      try { parsed = await analyzeText(chatId, text); }
      catch { await edit(await t(chatId,'noAmount')); return; }
      if(!parsed?.amount||isNaN(+parsed.amount)) { await edit(await t(chatId,'noAmount')); return; }
      const result = await processExpense(chatId, parsed, text);
      if(result?.chooseBudget) {
        await edit(lang==='en'
          ? `💬 *${parsed.amount} UAH* — ${parsed.description||text}\n\nSelect budget:`
          : `💬 *${parsed.amount} ₴* — ${parsed.description||text}\n\nОберіть бюджет:`,
          { reply_markup:{ inline_keyboard:budgetBtns(result.budgets,'savetx:') } });
        return;
      }
      await edit(await t(chatId,'saved',parsed.amount,parsed.category,parsed.description||text,parsed.date));
    } catch(e) {
      console.error('Expense text crash:', e.message);
      await edit(await t(chatId,'unknownErr'));
    }
    return;
  }

  // ── Menu buttons (only when NOT in expense mode) ─────

  // Connect account
  if(text===L.btnConnect||text===T.uk.btnConnect||text===T.en.btnConnect) {
    if(apiToken) return bot.sendMessage(chatId, await t(chatId,'alreadyLinked',msg.chat.first_name||''), await mainMenu(chatId));
    awaitingToken.add(chatId);
    return bot.sendMessage(chatId, await t(chatId,'enterToken'), { parse_mode:'Markdown' });
  }

  // Account status
  if(text===L.btnConnected||text===T.uk.btnConnected||text===T.en.btnConnected) {
    return bot.sendMessage(chatId, await t(chatId,'alreadyLinked',msg.chat.first_name||''), await mainMenu(chatId));
  }

  // Add expense — enter expense mode
  if(text===L.btnAddExpense||text===T.uk.btnAddExpense||text===T.en.btnAddExpense) {
    if(!apiToken) return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));
    const sess = await loadSession(chatId);
    const budgetTitle = sess.selectedBudget?.title || null;
    // If multiple budgets and none selected yet — pick first
    if(!budgetTitle) {
      const budgets = await getBudgets(apiToken);
      if(budgets.length===1) { await saveSession(chatId,{selectedBudget:{id:budgets[0]._id,title:budgets[0].title}}); }
      else if(budgets.length>1 && !sess.selectedBudget) {
        // Show budget picker before entering expense mode
        return bot.sendMessage(chatId,
          await t(chatId,'chooseBudgetDef'),
          { parse_mode:'Markdown', reply_markup:{ inline_keyboard: budgetBtns(budgets,'setdefexp:') } });
      }
    }
    const updatedSess = await loadSession(chatId);
    awaitingExpense.add(chatId);
    return bot.sendMessage(chatId,
      await t(chatId,'addExpenseMode', updatedSess.selectedBudget?.title||null),
      await expenseMenu(chatId));
  }

  // Select budget
  if(text===L.btnBudget||text===T.uk.btnBudget||text===T.en.btnBudget) {
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
      parse_mode:'Markdown', reply_markup:{ inline_keyboard:budgetBtns(budgets,'setdef:') } });
  }

  // Statistics
  if(text===L.btnStats||text===T.uk.btnStats||text===T.en.btnStats) {
    if(!apiToken) return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));
    try {
      const { data:sd } = await axios.get(`${BACKEND}/api/webhook/stats`,
        { headers:{ 'x-api-token':apiToken }, timeout:8000 });
      const monthly = sd.transactions||[];
      const budget  = sd.budget;
      const now     = new Date();
      const mName   = now.toLocaleString(lang==='en'?'en-US':'uk-UA',{month:'long',year:'numeric'});
      if(!monthly.length&&!budget) return bot.sendMessage(chatId, await t(chatId,'statsEmpty'), await mainMenu(chatId));
      const total  = monthly.reduce((s,tx)=>s+Number(tx.amount||0),0);
      const cats   = {};
      monthly.forEach(tx=>{cats[tx.category]=(cats[tx.category]||0)+Number(tx.amount||0);});
      const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5);
      let out = `${await t(chatId,'statsTitle')} — *${mName}*\n\n`;
      out += `${await t(chatId,'statsTx',monthly.length)}\n`;
      out += `${await t(chatId,'statsTotal',total.toLocaleString())}\n`;
      if(budget){
        const inc=Number(budget.income||0), bal=inc-total;
        out += lang==='en'?`Income: ${inc.toLocaleString()} UAH\n`:`Дохід: ${inc.toLocaleString()} ₴\n`;
        out += bal>=0
          ? (lang==='en'?`✅ +${bal.toLocaleString()} UAH`:`✅ +${bal.toLocaleString()} ₴`)
          : (lang==='en'?`⚠️ -${Math.abs(bal).toLocaleString()} UAH`:`⚠️ -${Math.abs(bal).toLocaleString()} ₴`);
        out+='\n';
      }
      if(sorted.length){ out+='\n'+await t(chatId,'statsTop')+'\n'; sorted.forEach(([c,s])=>{out+=`  • ${c}: ${s.toLocaleString()} ₴\n`;}); }
      if(budget?.categories?.length){
        out+=lang==='en'?'\n📊 *Plan vs Actual:*\n':'\n📊 *План vs Факт:*\n';
        budget.categories.forEach(c=>{
          const a=cats[c.name]||0, p=Number(c.planned||0), pct=p>0?Math.round((a/p)*100):null;
          const icon=p>0?(a>p?'🔴':a>p*.8?'🟡':'🟢'):'⚪';
          out+=`${icon} ${c.name}: ${a.toLocaleString()}${pct!==null?' / '+p.toLocaleString()+' ('+pct+'%)':''}\n`;
        });
      }
      const debts=[...(budget?.credits||[]).map(c=>({n:c.name,v:c.monthlyPayment,t:lang==='en'?'Loan':'Кредит'})),
                   ...(budget?.installments||[]).map(i=>({n:i.name,v:i.monthlyPayment,t:lang==='en'?'Install.':'Розстрочка'})),
                   ...(budget?.creditCards||[]).map(c=>({n:c.name,v:c.debt,t:'💳',isDebt:true}))];
      if(debts.length){
        out+=lang==='en'?'\n💳 *Debts:*\n':'\n💳 *Борги:*\n';
        debts.forEach(d=>{ out+=d.isDebt?`  • ${d.n} [${d.t}]: ${Number(d.v).toLocaleString()} ₴\n`:`  • ${d.n} [${d.t}]: ${Number(d.v).toLocaleString()} ₴/міс\n`; });
      }
      return bot.sendMessage(chatId, out, { parse_mode:'Markdown', reply_markup:(await mainMenu(chatId)).reply_markup });
    } catch(e){ console.error('Stats error:',e.message); return bot.sendMessage(chatId, await t(chatId,'unknownErr'), await mainMenu(chatId)); }
  }
});

// ── Photo handler ────────────────────────────────────────
bot.on('photo', async (msg) => {
  const chatId   = msg.chat.id;
  if(checkBanned(chatId)) return;
  const apiToken = await getApiToken(chatId);
  if(!apiToken) return bot.sendMessage(chatId, await t(chatId,'notLinked'), await mainMenu(chatId));

  const status = await bot.sendMessage(chatId, await t(chatId,'scanning'));
  const edit   = (txt,opts={}) => bot.editMessageText(txt,{ chat_id:chatId, message_id:status.message_id, parse_mode:'Markdown', ...opts }).catch(()=>{});

  try {
    const photo = msg.photo[msg.photo.length-1];
    let base64;
    try { base64 = await downloadPhotoAsBase64(photo.file_id); }
    catch { await edit(await t(chatId,'downloadErr')); return; }

    let parsed;
    try { parsed = await analyzeReceipt(chatId, base64); }
    catch(e) { console.error('Gemini err:',e.message); await edit(await t(chatId,'noReceipt')); return; }

    if(!parsed?.amount||isNaN(+parsed.amount)) { await edit(await t(chatId,'noAmount')); return; }

    const result = await processExpense(chatId, parsed, '');
    if(result?.chooseBudget) {
      const lang = await getLang(chatId);
      await edit(lang==='en'
        ? `✅ Receipt: *${parsed.amount} UAH* — ${parsed.description||'—'}\n\nSelect budget:`
        : `✅ Чек: *${parsed.amount} ₴* — ${parsed.description||'—'}\n\nОберіть бюджет:`,
        { reply_markup:{ inline_keyboard:budgetBtns(result.budgets,'savetx:') } });
      return;
    }
    await edit(await t(chatId,'saved',parsed.amount,parsed.category,parsed.description,parsed.date));
  } catch(e) { console.error('Photo crash:',e.message); await edit(await t(chatId,'unknownErr')); }
});

// ── Inline callbacks ─────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;

  // Set default budget then enter expense mode
  if(data.startsWith('setdefexp:')) {
    const [,budgetId,...tp] = data.split(':');
    const title = tp.join(':');
    await saveSession(chatId,{ selectedBudget:{ id:budgetId, title } });
    await bot.answerCallbackQuery(query.id,{ text:'✅' });
    awaitingExpense.add(chatId);
    await bot.editMessageText(
      await t(chatId,'addExpenseMode',title),
      { chat_id:chatId, message_id:query.message.message_id, parse_mode:'Markdown' }
    ).catch(()=>{});
    return bot.sendMessage(chatId, '↩', await expenseMenu(chatId));
  }

  // Set default budget
  if(data.startsWith('setdef:')) {
    const [,budgetId,...tp] = data.split(':');
    const title = tp.join(':');
    await saveSession(chatId,{ selectedBudget:{ id:budgetId, title } });
    await bot.answerCallbackQuery(query.id,{ text:'✅' });
    await bot.editMessageText(await t(chatId,'budgetSet',title),
      { chat_id:chatId, message_id:query.message.message_id, parse_mode:'Markdown' }).catch(()=>{});
    return;
  }

  // Save tx to chosen budget
  if(data.startsWith('savetx:')) {
    const [,budgetId,...tp] = data.split(':');
    const pending = pendingTx[chatId];
    if(!pending) {
      await bot.answerCallbackQuery(query.id,{ text:'⏳' });
      await bot.editMessageText(await t(chatId,'sessionExpired'),
        { chat_id:chatId, message_id:query.message.message_id }).catch(()=>{});
      return;
    }
    delete pendingTx[chatId];
    const { parsed, apiToken, rawText } = pending;
    try {
      await saveTransaction(apiToken,{
        amount:+parsed.amount, category:parsed.category||'Інше',
        description:parsed.description||(rawText||''),
        date:parsed.date||null, rawText:rawText||parsed.rawText||'', budgetId
      }, chatId);
      await bot.answerCallbackQuery(query.id,{ text:'✅' });
      await bot.editMessageText(
        await t(chatId,'saved',parsed.amount,parsed.category,parsed.description||(rawText||''),parsed.date),
        { chat_id:chatId, message_id:query.message.message_id, parse_mode:'Markdown' }).catch(()=>{});
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
console.log('🤖 BudgUA Bot started (gemini-2.5-flash + fallback)');
