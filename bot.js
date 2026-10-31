const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ================= CONFIGURATION =================
const CONFIG = {
  BRAND_NAME: 'Trade With Krishna',
  ADMIN_HANDLE: '@TWK_AD',
  ADMIN_CHAT_ID: 6224393090,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  
  LOGIN_URL: 'https://tws-forex-backend.vercel.app/api/login',
  ALERTS_URL: 'https://ai-bot.tradewithsanchit.com/api/signals/history?limit=8&offset=0',
  API_KEY: '99104689',
  
  CREDENTIALS: {
    email: process.env.SANCHIT_EMAIL || 'capital51gifts@gmail.com',
    password: process.env.SANCHIT_PASSWORD || 'Sanjay@999'
  },
  
  POLL_INTERVAL_MS: 5000,
  RELOGIN_INTERVAL_MS: 25 * 60 * 1000
};

const AVAILABLE_PAIRS = ['XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];
const DB_FILE = path.join(__dirname, 'database.json');
// =================================================

let db = {
  maxUsers: 50,
  users: {},
  bannedUsers: [],
  processedSignals: {}
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = { ...db, ...data };
      if (!db.processedSignals) db.processedSignals = {};
    } else {
      saveDatabase();
    }
  } catch (err) {
    console.error('Database load error:', err.message);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Database save error:', err.message);
  }
}

loadDatabase();

// Admin auto-enrolled with all pairs
const adminIdStr = String(CONFIG.ADMIN_CHAT_ID);
if (!db.users[adminIdStr]) {
  db.users[adminIdStr] = {
    name: 'Admin',
    pairs: [...AVAILABLE_PAIRS],
    isBanned: false,
    joinedAt: 'Auto-Registered'
  };
  saveDatabase();
}

const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: { timeout: 10 }
  }
});

let authHeaders = {};
let isChecking = false;
let isLoggingIn = false;

// Indian Time Formatter helper
function formatToIST(dateString) {
  try {
    const dateObj = dateString ? new Date(dateString) : new Date();
    if (isNaN(dateObj.getTime())) {
      return getIndianDateTime();
    }
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(dateObj);
  } catch (e) {
    return getIndianDateTime();
  }
}

function getIndianDateTime() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(new Date());
}

function generatePairKeyboard(chatId) {
  const userPairs = db.users[chatId]?.pairs || [];
  const inline_keyboard = AVAILABLE_PAIRS.map(pair => {
    const isSelected = userPairs.includes(pair);
    return [{ text: `${isSelected ? '✅' : '❌'} ${pair}`, callback_data: `toggle_${pair}` }];
  });
  return { inline_keyboard };
}

// ================= AUTO LOGIN / SESSION RENEW =================
async function login() {
  if (isLoggingIn) return;
  isLoggingIn = true;

  try {
    const res = await axios.post(CONFIG.LOGIN_URL, CONFIG.CREDENTIALS, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
      },
      timeout: 10000
    });

    const token = res.data?.token || res.data?.access_token || res.data?.data?.token;

    authHeaders = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      'Origin': 'https://automate.tradewithsanchit.com',
      'Referer': 'https://automate.tradewithsanchit.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Sec-GPC': '1',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156", "Brave";v="156"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"iOS"',
      'x-api-key': CONFIG.API_KEY,
      ...(token && { 'Authorization': `Bearer ${token}` })
    };

    console.log(`[AUTH] Session renewed! (${getIndianDateTime()})`);
    return true;
  } catch (err) {
    console.error('[AUTH ERROR] Login fail:', err.response?.data || err.message);
    return false;
  } finally {
    isLoggingIn = false;
  }
}

// ================= PURE DYNAMIC SIGNAL PARSER =================
function buildSignalMessage(signal) {
  const symbol = (signal.symbol || signal.pair || 'UNKNOWN').toUpperCase();
  
  // Asset Name
  let assetName = signal.asset_name || signal.name;
  if (!assetName) {
    if (symbol.includes('XAU')) assetName = 'Gold';
    else if (symbol.includes('XAG')) assetName = 'Silver';
    else if (symbol.includes('BTC')) assetName = 'Bitcoin';
    else if (symbol.includes('ETH')) assetName = 'Ethereum';
    else assetName = symbol;
  }

  const rawSignalTime = signal.created_at || signal.time || signal.timestamp || signal.signal_time;
  const signalTimeIST = formatToIST(rawSignalTime);

  // Direction Parsing
  const rawDirection = String(signal.direction || signal.type || signal.action || signal.signal || '').toUpperCase();
  const isBuy = rawDirection.includes('BUY') || rawDirection.includes('LONG') || rawDirection.includes('BULL');
  const isSell = rawDirection.includes('SELL') || rawDirection.includes('SHORT') || rawDirection.includes('BEAR');
  const directionEmoji = isBuy ? '🟢 BUY' : (isSell ? '🔴 SELL' : rawDirection || 'HOLD');

  // Dynamic Confidence Score & Level Parsing (No hardcoding)
  let rawScore = signal.confidence_score ?? signal.confidence ?? signal.score ?? signal.accuracy ?? signal.probability;
  if (typeof rawScore === 'string') {
    rawScore = parseFloat(rawScore.replace('%', ''));
  }
  const confidenceScore = !isNaN(rawScore) && rawScore !== null ? `${rawScore}%` : 'N/A';

  // Dynamic Confidence Level from API or derived strictly from actual score
  let confidenceLevel = signal.confidence_level || signal.level || signal.strength || signal.confidence_text;
  if (!confidenceLevel && !isNaN(rawScore) && rawScore !== null) {
    if (rawScore >= 80) confidenceLevel = 'High';
    else if (rawScore >= 60) confidenceLevel = 'Medium';
    else confidenceLevel = 'Low';
  } else if (!confidenceLevel) {
    confidenceLevel = 'N/A';
  }

  // Price Levels (Pure API keys)
  let entryZone = signal.entry_zone;
  if (!entryZone) {
    const low = signal.entry_low ?? signal.entry_min ?? signal.entry_zone_low;
    const high = signal.entry_high ?? signal.entry_max ?? signal.entry_zone_high;
    if (low !== undefined && high !== undefined) {
      entryZone = `${low} – ${high}`;
    } else {
      entryZone = signal.entry_price ?? signal.entry_mid ?? signal.entry ?? 'N/A';
    }
  }

  const entryMid = signal.entry_mid ?? signal.entryMid ?? signal.entry_price ?? signal.entry ?? 'N/A';
  const sl = signal.sl ?? signal.stop_loss ?? signal.stoploss ?? 'N/A';
  
  // Dynamic Targets
  const tp1 = signal.tp1 ?? signal.tp ?? signal.target1 ?? 'N/A';
  const tp2 = signal.tp2 ?? signal.target2 ?? 'N/A';
  const tp3 = signal.tp3 ?? signal.target3 ?? 'N/A';
  const tp4 = signal.tp4 ?? signal.target4 ?? 'N/A';

  // Dynamic Strategy Votes Extraction
  let bullishVotes = null;
  let bearishVotes = null;

  const voteSource = signal.strategy_votes || signal.votes || signal.strategies || signal.analysis || signal.voting || {};

  if (typeof voteSource === 'object' && !Array.isArray(voteSource)) {
    bullishVotes = voteSource.bullish ?? voteSource.buy ?? voteSource.bullish_count ?? voteSource.bullish_votes;
    bearishVotes = voteSource.bearish ?? voteSource.sell ?? voteSource.bearish_count ?? voteSource.bearish_votes;
  }

  if (bullishVotes === null || bearishVotes === null) {
    bullishVotes = signal.bullish_votes ?? signal.bullish_count ?? signal.bullish ?? signal.buy_votes ?? 
                   signal.strategies_bullish ?? signal.bullish_strategies ?? signal.bull_count;
    bearishVotes = signal.bearish_votes ?? signal.bearish_count ?? signal.bearish ?? signal.sell_votes ?? 
                   signal.strategies_bearish ?? signal.bearish_strategies ?? signal.bear_count;
  }

  if ((bullishVotes === null || bearishVotes === null) && Array.isArray(signal.strategies)) {
    bullishVotes = signal.strategies.filter(s => {
      const v = String(s.action || s.type || s.vote || '').toLowerCase();
      return v.includes('buy') || v.includes('bull');
    }).length;
    bearishVotes = signal.strategies.filter(s => {
      const v = String(s.action || s.type || s.vote || '').toLowerCase();
      return v.includes('sell') || v.includes('bear');
    }).length;
  }

  const finalBullish = bullishVotes !== null && bullishVotes !== undefined ? bullishVotes : '0';
  const finalBearish = bearishVotes !== null && bearishVotes !== undefined ? bearishVotes : '0';

  // AI Reasoning Parsing
  let aiReasoning = '';
  if (Array.isArray(signal.reasoning) && signal.reasoning.length > 0) {
    aiReasoning = signal.reasoning.map(r => `• ${r}`).join('\n');
  } else if (typeof signal.reasoning === 'string' && signal.reasoning.trim().length > 0) {
    aiReasoning = `• ${signal.reasoning.trim()}`;
  } else if (signal.analysis && typeof signal.analysis === 'string') {
    aiReasoning = `• ${signal.analysis.trim()}`;
  } else {
    aiReasoning = `• Technical indicators and market momentum calculated by AI system for ${symbol}`;
  }

  const istCurrentTime = getIndianDateTime();

  return `🚨 <b>${CONFIG.BRAND_NAME.toUpperCase()} AI SIGNAL</b> 🚨

🪙 <b>Asset:</b> <code>${symbol}</code> (${assetName})
⏱ <b>Signal Time (IST):</b> <code>${signalTimeIST}</code>

📊 <b>SIGNAL OVERVIEW</b>
🎯 <b>Direction:</b> <b>${directionEmoji}</b>
🔥 <b>Confidence:</b> <b>${confidenceScore} (${confidenceLevel})</b>

🎯 <b>PRICE LEVELS</b>
▫️ <b>Entry Zone:</b> <code>${entryZone}</code>
▫️ <b>Entry Mid:</b>  <code>${entryMid}</code>
🛑 <b>Stop Loss:</b>  <code>${sl}</code>
🎯 <b>TP1:</b>        <code>${tp1}</code>
🎯 <b>TP2:</b>        <code>${tp2}</code>
🎯 <b>TP3:</b>        <code>${tp3}</code>
🎯 <b>TP4:</b>        <code>${tp4}</code>

📊 <b>STRATEGY VOTES</b>
🟢 <b>Bullish:</b> ${finalBullish}  |  🔴 <b>Bearish:</b> ${finalBearish}

⚡ <b>AI REASONING</b>
${aiReasoning}

🇮🇳 <b>Alert Received (IST):</b> <code>${istCurrentTime}</code>
👤 <b>Support:</b> ${CONFIG.ADMIN_HANDLE}`;
}

// Fetch Helper
async function fetchLatestSignals() {
  if (!authHeaders['Authorization']) {
    await login();
  }
  const res = await axios.get(CONFIG.ALERTS_URL, { 
    headers: authHeaders,
    timeout: 8000 
  });
  return Array.isArray(res.data) 
    ? res.data 
    : (res.data.signals || res.data.data || res.data.history || []);
}

// ================= USER ACCESS & START =================
bot.onText(/\/start/, async (msg) => {
  const chatId = String(msg.chat.id);
  const userName = msg.from.first_name || 'Trader';

  if (db.bannedUsers.includes(chatId) || db.users[chatId]?.isBanned) {
    return bot.sendMessage(
      chatId, 
      `🚫 Access Denied!\n\nAapko is bot se ban kiya gaya hai.\nSupport ke liye contact karein: ${CONFIG.ADMIN_HANDLE}`
    );
  }

  const activeUserCount = Object.keys(db.users).filter(id => !db.users[id].isBanned).length;

  if (!db.users[chatId]) {
    if (activeUserCount >= db.maxUsers && chatId !== String(CONFIG.ADMIN_CHAT_ID)) {
      return bot.sendMessage(
        chatId, 
        `⚠️ Slot Full!\n\nBot me maximum user limit (${db.maxUsers}) reach ho chuki hai.\nSupport ke liye contact karein: ${CONFIG.ADMIN_HANDLE}`
      );
    }

    db.users[chatId] = {
      name: userName,
      pairs: [...AVAILABLE_PAIRS],
      isBanned: false,
      joinedAt: getIndianDateTime()
    };
    saveDatabase();

    bot.sendMessage(CONFIG.ADMIN_CHAT_ID, 
      `👤 New User Registered!\nName: ${userName}\nChat ID: ${chatId}\nTotal Active: ${activeUserCount + 1}/${db.maxUsers}`
    ).catch(err => console.error('[ADMIN MSG ERROR]', err.message));
  }

  // 1. Send Welcome Message with Pair Selection
  const welcomeText = 
`👋 <b>Welcome ${userName}!</b>\n\n` +
`<b>${CONFIG.BRAND_NAME}</b> AI Signal Bot me aapka swagat hai.\n\n` +
`Neeche diye gaye buttons par tap karke select karein ki aapko kin-kin pairs ke alerts chahiye:`;

  await bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'HTML',
    reply_markup: generatePairKeyboard(chatId)
  }).catch(err => console.error('[WELCOME ERROR]', err.message));

  // 2. Fetch Latest Signal & Send on /start
  try {
    const signals = await fetchLatestSignals();
    if (signals && signals.length > 0) {
      const latestSignal = signals[0];
      const message = buildSignalMessage(latestSignal);
      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

      // 3. Send Connection confirmation message
      const istTime = getIndianDateTime();
      const notifyText = 
        `✅ <b>Connection successfully established!</b>\n\n` +
        `🤖 <b>${CONFIG.BRAND_NAME}</b> AI Engine is active 24/7.\n` +
        `📊 <b>Monitored Pairs:</b> <code>${AVAILABLE_PAIRS.join(', ')}</code>\n` +
        `⏰ <b>Connected At (IST):</b> <code>${istTime}</code>`;

      await bot.sendMessage(chatId, notifyText, { parse_mode: 'HTML' });
    }
  } catch (err) {
    console.error('[START SIGNAL FETCH ERROR]:', err.message);
  }
});

// ================= BUTTONS TOGGLE =================
bot.on('callback_query', async (query) => {
  const chatId = String(query.message.chat.id);
  const messageId = query.message.message_id;
  const data = query.data;

  if (db.bannedUsers.includes(chatId)) {
    return bot.answerCallbackQuery(query.id, { text: 'You are banned!', show_alert: true });
  }

  if (data.startsWith('toggle_')) {
    const pair = data.replace('toggle_', '');
    let userPairs = db.users[chatId]?.pairs || [];

    if (userPairs.includes(pair)) {
      userPairs = userPairs.filter(p => p !== pair);
    } else {
      userPairs.push(pair);
    }

    if (!db.users[chatId]) {
      db.users[chatId] = {
        name: query.from.first_name || 'Trader',
        pairs: userPairs,
        isBanned: false,
        joinedAt: getIndianDateTime()
      };
    } else {
      db.users[chatId].pairs = userPairs;
    }
    saveDatabase();

    await bot.editMessageReplyMarkup(generatePairKeyboard(chatId), {
      chat_id: chatId,
      message_id: messageId
    }).catch(e => console.error('[KEYBOARD EDIT ERROR]', e.message));

    await bot.answerCallbackQuery(query.id, {
      text: `${pair} ${userPairs.includes(pair) ? 'Enabled ✅' : 'Disabled ❌'}`
    });
  }
});

// ================= ADMIN COMMANDS =================
bot.onText(/\/stats/, (msg) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(CONFIG.ADMIN_CHAT_ID)) return;

  const total = Object.keys(db.users).length;
  const banned = db.bannedUsers.length;
  const active = total - banned;

  bot.sendMessage(chatId, 
    `📊 <b>${CONFIG.BRAND_NAME} Control Panel</b>\n\n` +
    `👥 Max Allowed Users: <b>${db.maxUsers}</b>\n` +
    `✅ Active Users: <b>${active}</b>\n` +
    `🚫 Banned Users: <b>${banned}</b>\n` +
    `📁 Total Enrolled: <b>${total}</b>\n\n` +
    `<b>Admin Controls:</b>\n` +
    `• <code>/setlimit &lt;number&gt;</code>\n` +
    `• <code>/ban &lt;chat_id&gt;</code>\n` +
    `• <code>/unban &lt;chat_id&gt;</code>\n` +
    `• <code>/users</code>`,
    { parse_mode: 'HTML' }
  ).catch(e => console.error('[STATS ERROR]', e.message));
});

bot.onText(/\/setlimit (.+)/, (msg, match) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(CONFIG.ADMIN_CHAT_ID)) return;

  const newLimit = parseInt(match[1]);
  if (isNaN(newLimit) || newLimit <= 0) {
    return bot.sendMessage(chatId, '❌ Valid number daalein. Example: <code>/setlimit 50</code>', { parse_mode: 'HTML' });
  }

  db.maxUsers = newLimit;
  saveDatabase();
  bot.sendMessage(chatId, `✅ Max User Limit set to: <b>${newLimit}</b>`, { parse_mode: 'HTML' });
});

bot.onText(/\/ban (.+)/, (msg, match) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(CONFIG.ADMIN_CHAT_ID)) return;

  const targetId = match[1].trim();
  if (!db.bannedUsers.includes(targetId)) {
    db.bannedUsers.push(targetId);
  }
  if (db.users[targetId]) {
    db.users[targetId].isBanned = true;
  }
  saveDatabase();

  bot.sendMessage(chatId, `🚫 User <code>${targetId}</code> ko ban kar diya gaya hai.`, { parse_mode: 'HTML' });
  bot.sendMessage(targetId, `🚫 Notification: Aapko ban kiya gaya hai. Contact: ${CONFIG.ADMIN_HANDLE}`).catch(() => {});
});

bot.onText(/\/unban (.+)/, (msg, match) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(CONFIG.ADMIN_CHAT_ID)) return;

  const targetId = match[1].trim();
  db.bannedUsers = db.bannedUsers.filter(id => id !== targetId);
  if (db.users[targetId]) {
    db.users[targetId].isBanned = false;
  }
  saveDatabase();

  bot.sendMessage(chatId, `✅ User <code>${targetId}</code> unban ho gaya hai.`, { parse_mode: 'HTML' });
  bot.sendMessage(targetId, `✅ Notification: Aapka access activate ho gaya hai. Dobara /start karein.`).catch(() => {});
});

bot.onText(/\/users/, (msg) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(CONFIG.ADMIN_CHAT_ID)) return;

  let listText = `📋 Registered Users List:\n\n`;
  for (const [id, user] of Object.entries(db.users)) {
    const status = db.bannedUsers.includes(id) ? '🚫 Banned' : '✅ Active';
    listText += `• ${user.name} (${id}) - ${status}\n`;
  }

  bot.sendMessage(chatId, listText);
});

// ================= BROADCAST SIGNALS =================
async function broadcastTelegramAlert(signal) {
  const symbol = (signal.symbol || signal.pair || 'XAUUSD').toUpperCase();
  const message = buildSignalMessage(signal);

  for (const [chatId, userData] of Object.entries(db.users)) {
    if (!userData.isBanned && !db.bannedUsers.includes(chatId)) {
      if (userData.pairs && userData.pairs.includes(symbol)) {
        try {
          await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } catch (err) {
          console.error(`[SEND FAILED] ChatId ${chatId}:`, err.message);
        }
      }
    }
  }

  console.log(`[SENT] ${symbol} signal dispatched successfully at IST: ${getIndianDateTime()}`);
}

// ================= LIVE POLLING CONTROLLER =================
async function checkNewSignals(isRetry = false) {
  if (isChecking && !isRetry) return;
  isChecking = true;

  try {
    const signals = await fetchLatestSignals();

    if (!signals || !signals.length) {
      isChecking = false;
      return;
    }

    // Baseline Lock on First Bot Run
    if (Object.keys(db.processedSignals).length === 0) {
      for (const sig of signals) {
        const sKey = String(sig._id || sig.id || `${sig.symbol}_${sig.created_at || sig.entry_mid || sig.entry_price || sig.entry}`);
        db.processedSignals[sKey] = true;
      }
      saveDatabase();
      isChecking = false;
      return;
    }

    // Only broadcast real-time incoming signals
    for (const sig of signals) {
      const sym = (sig.symbol || sig.pair || '').toUpperCase();
      if (!AVAILABLE_PAIRS.includes(sym)) continue;

      const sigKey = String(sig._id || sig.id || `${sym}_${sig.created_at || sig.entry_mid || sig.entry_price || sig.entry}`);

      if (!db.processedSignals[sigKey]) {
        db.processedSignals[sigKey] = true;
        saveDatabase();
        await broadcastTelegramAlert(sig);
        console.log(`[LIVE SIGNAL] New ${sym} signal dispatched: ${sigKey}`);
      }
    }

  } catch (err) {
    const status = err.response?.status;
    console.error(`[POLL ERROR] Status: ${status}`);
    if (status === 401 || status === 403) {
      console.warn(`[DETECTED] Session logout (Status ${status}). Re-logging in...`);
      const success = await login();
      if (success && !isRetry) {
        isChecking = false;
        return await checkNewSignals(true);
      }
    }
  } finally {
    isChecking = false;
  }
}

// ================= APP INITIALIZATION =================
async function main() {
  await login();
  setInterval(login, CONFIG.RELOGIN_INTERVAL_MS);
  setInterval(() => checkNewSignals(), CONFIG.POLL_INTERVAL_MS);
  console.log(`[READY] ${CONFIG.BRAND_NAME} bot is active. Admin ID: ${CONFIG.ADMIN_CHAT_ID}`);
}

main();

// ================= RENDER WEB SERVICE HEALTH CHECK =================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Trade With Krishna Bot is running 24/7!\n');
}).listen(PORT, () => {
  console.log(`[SERVER] Health check listening on port ${PORT}`);
});
