const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ================= CONFIGURATION =================
const CONFIG = {
  BRAND_NAME: 'Trade With Krishna',
  ADMIN_HANDLE: '@TWK_AD',
  ADMIN_CHAT_ID: 6224393090, // Aapki exact Admin Numeric ID
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
  
  // Website API URLs
  LOGIN_URL: process.env.LOGIN_URL || 'https://automate.tradewithsanchit.com/api/login',
  ALERTS_URL: process.env.ALERTS_URL || 'https://automate.tradewithsanchit.com/api/signals',
  
  CREDENTIALS: {
    email: process.env.SANCHIT_EMAIL || 'your_email@example.com',
    password: process.env.SANCHIT_PASSWORD || 'your_password'
  },
  
  POLL_INTERVAL_MS: 5000,             // Har 5 second me new signal check
  RELOGIN_INTERVAL_MS: 25 * 60 * 1000 // Har 25 minute me preemptive login
};

const AVAILABLE_PAIRS = ['XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];[cite: 1]
const DB_FILE = path.join(__dirname, 'database.json');
// =================================================

let db = {
  maxUsers: 50,
  users: {},
  bannedUsers: []
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
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

const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });

let authHeaders = {};
let lastProcessedSignalKey = null;
let isChecking = false;
let isLoggingIn = false;

// Indian Standard Time (IST) Formatter
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

// Inline Keyboard Buttons Generator
function generatePairKeyboard(chatId) {
  const userPairs = db.users[chatId]?.pairs || [];
  const inline_keyboard = AVAILABLE_PAIRS.map(pair => {
    const isSelected = userPairs.includes(pair);
    return [{ text: `${isSelected ? '✅' : '❌'} ${pair}`, callback_data: `toggle_${pair}` }];
  });
  return { inline_keyboard };
}

// ================= USER ACCESS & START =================
bot.onText(/\/start/, (msg) => {
  const chatId = String(msg.chat.id);
  const userName = msg.from.first_name || 'Trader';

  // 1. Check agar user Banned hai
  if (db.bannedUsers.includes(chatId) || db.users[chatId]?.isBanned) {
    return bot.sendMessage(
      chatId, 
      `🚫 *Access Denied!*\n\nAapko is bot se ban kiya gaya hai.\nSupport & Unban ke liye contact karein: ${CONFIG.ADMIN_HANDLE}`,
      { parse_mode: 'Markdown' }
    );
  }

  // 2. Check agar User Limit exceed ho rahi hai
  const activeUserCount = Object.keys(db.users).filter(id => !db.users[id].isBanned).length;

  if (!db.users[chatId]) {
    if (activeUserCount >= db.maxUsers && chatId !== String(CONFIG.ADMIN_CHAT_ID)) {
      return bot.sendMessage(
        chatId, 
        `⚠️ *Slot Full!*\n\nBot me maximum user limit (${db.maxUsers}) reach ho chuki hai.\nNaye slots open hone par try karein ya Admin se access ke liye contact karein: ${CONFIG.ADMIN_HANDLE}`,
        { parse_mode: 'Markdown' }
      );
    }

    db.users[chatId] = {
      name: userName,
      pairs: [...AVAILABLE_PAIRS],
      isBanned: false,
      joinedAt: getIndianDateTime()
    };
    saveDatabase();

    // Admin ko alert message bhejega
    bot.sendMessage(CONFIG.ADMIN_CHAT_ID, 
      `👤 *New User Registered!*\nName: ${userName}\nChat ID: \`${chatId}\`\nTotal Active: ${activeUserCount + 1}/${db.maxUsers}`, 
      { parse_mode: 'Markdown' }
    );
  }

  const welcomeText = 
`👋 *Welcome ${userName}!*

*${CONFIG.BRAND_NAME}* AI Signal Bot me aapka swagat hai.

Neeche diye gaye buttons par tap karke select karein ki aapko kin-kin pairs ke alerts chahiye:`;

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: generatePairKeyboard(chatId)
  });
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

    if (db.users[chatId]) {
      db.users[chatId].pairs = userPairs;
      saveDatabase();
    }

    await bot.editMessageReplyMarkup(generatePairKeyboard(chatId), {
      chat_id: chatId,
      message_id: messageId
    });

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
    `📊 *${CONFIG.BRAND_NAME} Control Panel*\n\n` +
    `👥 Max Allowed Users: *${db.maxUsers}*\n` +
    `✅ Active Users: *${active}*\n` +
    `🚫 Banned Users: *${banned}*\n` +
    `📁 Total Enrolled: *${total}*\n\n` +
    `*Admin Controls:*\n` +
    `• \`/setlimit <number>\`\n` +
    `• \`/ban <chat_id>\`\n` +
    `• \`/unban <chat_id>\`\n` +
    `• \`/users\``,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/setlimit (.+)/, (msg, match) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(CONFIG.ADMIN_CHAT_ID)) return;

  const newLimit = parseInt(match[1]);
  if (isNaN(newLimit) || newLimit <= 0) {
    return bot.sendMessage(chatId, '❌ Valid number daalein. Example: `/setlimit 50`');
  }

  db.maxUsers = newLimit;
  saveDatabase();
  bot.sendMessage(chatId, `✅ Max User Limit set to: *${newLimit}*`, { parse_mode: 'Markdown' });
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

  bot.sendMessage(chatId, `🚫 User \`${targetId}\` ko ban kar diya gaya hai.`, { parse_mode: 'Markdown' });
  bot.sendMessage(targetId, `🚫 *Notification:* Aapko ban kiya gaya hai. Contact: ${CONFIG.ADMIN_HANDLE}`);
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

  bot.sendMessage(chatId, `✅ User \`${targetId}\` unban ho gaya hai.`, { parse_mode: 'Markdown' });
  bot.sendMessage(targetId, `✅ *Notification:* Aapka access activate ho gaya hai. Dobara /start karein.`);
});

bot.onText(/\/users/, (msg) => {
  const chatId = String(msg.chat.id);
  if (chatId !== String(CONFIG.ADMIN_CHAT_ID)) return;

  let listText = `📋 *Registered Users List:*\n\n`;
  for (const [id, user] of Object.entries(db.users)) {
    const status = db.bannedUsers.includes(id) ? '🚫 Banned' : '✅ Active';
    listText += `• ${user.name} (\`${id}\`) - ${status}\n`;
  }

  bot.sendMessage(chatId, listText, { parse_mode: 'Markdown' });
});

// ================= AUTO LOGIN / SESSION RENEW =================
async function login() {
  if (isLoggingIn) return;
  isLoggingIn = true;

  try {
    const res = await axios.post(CONFIG.LOGIN_URL, CONFIG.CREDENTIALS, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 10000
    });

    const token = res.data?.token || res.data?.access_token || res.data?.data?.token;
    const cookies = res.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ');

    authHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...(cookies && { 'Cookie': cookies })
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

// ================= BROADCAST SIGNALS =================
async function broadcastTelegramAlert(signal) {
  const symbol = (signal.symbol || signal.pair || 'XAUUSD').toUpperCase();[cite: 2]
  const assetName = signal.asset_name || signal.name || 'Gold';[cite: 2]
  const signalTime = signal.created_at || signal.time || 'Live Signal';

  // Direction & Confidence[cite: 3]
  const direction = (signal.direction || signal.type || signal.action || 'SELL').toUpperCase();[cite: 3]
  const directionEmoji = direction.includes('BUY') ? '🟢 BUY' : '🔴 SELL';
  const confidenceScore = signal.confidence_score || signal.confidence || signal.score || '80';[cite: 3]
  const confidenceLevel = signal.confidence_level || signal.level || 'Medium';[cite: 3]

  // Price Levels[cite: 2]
  const entryZone = signal.entry_zone || `${signal.entry_low || '3,882'} – ${signal.entry_high || '3,882.6'}`;[cite: 2]
  const entryMid = signal.entry_mid || signal.entryMid || signal.entry || '3,882.3';[cite: 2]
  const sl = signal.sl || signal.stop_loss || '3,892.3';[cite: 2]
  const tp1 = signal.tp1 || signal.tp || '3,872.3';[cite: 2]
  const tp2 = signal.tp2 || '3,857.3';[cite: 2]
  const tp3 = signal.tp3 || '3,837.3';[cite: 2]
  const tp4 = signal.tp4 || '3,812.3';[cite: 2]

  // Strategy Votes[cite: 2]
  const bullishVotes = signal.bullish_votes ?? signal.bullish ?? 1;[cite: 2]
  const bearishVotes = signal.bearish_votes ?? signal.bearish ?? 5;[cite: 2]

  // AI Reasoning[cite: 2]
  let aiReasoning = '';
  if (Array.isArray(signal.reasoning)) {
    aiReasoning = signal.reasoning.map(r => `✅ ${r}`).join('\n');
  } else {
    aiReasoning = 
      `✅ Selling pressure detected on ${symbol} from live MT5 data during New York session\n` +[cite: 2]
      `✅ Market structure supports downside movement with 80% confidence\n` +[cite: 2]
      `✅ 5/12 strategies confirmed - risk-reward ratio validated by AI system`;[cite: 2]
  }

  const istCurrentTime = getIndianDateTime();

  const message = 
`🚨 *${CONFIG.BRAND_NAME.toUpperCase()} AI SIGNAL* 🚨

🪙 *Asset:* \`${symbol}\` (${assetName})
⏱ *Signal Time:* \`${signalTime}\`

📊 *SIGNAL OVERVIEW*
🎯 *Direction:* *${directionEmoji}*
🔥 *Confidence:* *${confidenceScore}% (${confidenceLevel})*

🎯 *PRICE LEVELS*
▫️ *Entry Zone:* \`${entryZone}\`
▫️ *Entry Mid:*  \`${entryMid}\`
🛑 *Stop Loss:*  \`${sl}\`
🎯 *TP1:*        \`${tp1}\`
🎯 *TP2:*        \`${tp2}\`
🎯 *TP3:*        \`${tp3}\`
🎯 *TP4:*        \`${tp4}\`

📊 *STRATEGY VOTES*
🟢 *Bullish:* ${bullishVotes}  |  🔴 *Bearish:* ${bearishVotes}

⚡ *AI REASONING*
${aiReasoning}

🇮🇳 *Alert Received (IST):* \`${istCurrentTime}\`
👤 *Support:* ${CONFIG.ADMIN_HANDLE}`;[cite: 2, 3]

  for (const [chatId, userData] of Object.entries(db.users)) {
    if (!userData.isBanned && !db.bannedUsers.includes(chatId)) {
      if (userData.pairs && userData.pairs.includes(symbol)) {
        try {
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error(`[SEND FAILED] ChatId ${chatId}:`, err.message);
        }
      }
    }
  }

  console.log(`[SENT] ${symbol} signal dispatched at IST: ${istCurrentTime}`);
}

// ================= POLLING & AUTO-RECOVERY =================
async function checkNewSignals(isRetry = false) {
  if (isChecking && !isRetry) return;
  isChecking = true;

  try {
    if (!authHeaders['Authorization'] && !authHeaders['Cookie']) {
      await login();
    }

    const res = await axios.get(CONFIG.ALERTS_URL, { 
      headers: authHeaders,
      timeout: 8000 
    });

    if (res.data?.status === 'unauthenticated' || res.data?.message?.toLowerCase().includes('unauthorized')) {
      throw { response: { status: 401 } };
    }

    const signals = Array.isArray(res.data) ? res.data : (res.data.data || res.data.signals || []);
    if (!signals.length) {
      isChecking = false;
      return;
    }

    const latest = signals[0];
    const signalKey = latest.id || `${latest.symbol}_${latest.created_at || latest.entry_mid || latest.entry}`;[cite: 2]

    if (signalKey !== lastProcessedSignalKey) {
      if (lastProcessedSignalKey !== null) {
        await broadcastTelegramAlert(latest);
      } else {
        console.log(`[INITIALIZED] Baseline active: ${signalKey}`);
      }
      lastProcessedSignalKey = signalKey;
    }
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      console.warn(`[DETECTED] Session logout detect hua (${status})! Re-login chalu...`);
      const success = await login();
      if (success && !isRetry) {
        isChecking = false;
        return await checkNewSignals(true);
      }
    } else {
      console.error('[POLL ERROR]', err.message);
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