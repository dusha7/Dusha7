// Astra — Telegram webhook (Vercel serverless).
//
// HEADLINE: fast answer. Any plain text → Astra replies immediately.
// Plus full services via the menu: Таро / Нумерология / Астрология, credits,
// and Telegram Stars payments.
const cfg = require('../lib/astra/config');
const tg = require('../lib/astra/telegram');
const store = require('../lib/astra/store');
const ai = require('../lib/astra/anthropic');
const tarot = require('../lib/astra/tarot');
const numero = require('../lib/astra/numerology');
const astro = require('../lib/astra/astrology');

// ---------- keyboards ----------
function menuKeyboard() {
  return { inline_keyboard: [
    [{ text: '🃏 Таро', callback_data: 'svc:tarot' }, { text: '🔢 Нумерология', callback_data: 'svc:numero' }],
    [{ text: '🪐 Астрология', callback_data: 'svc:astro' }],
    [{ text: '💫 Баланс', callback_data: 'balance' }, { text: '✨ Купить запросы', callback_data: 'buy' }]
  ] };
}
function buyKeyboard() {
  const rows = cfg.PACKAGES.map(function (p) {
    const label = p.title + ' — ' + p.stars + ' ⭐' + (p.badge ? ' · ' + p.badge : '');
    return [{ text: label, callback_data: 'buy:' + p.id }];
  });
  return { inline_keyboard: rows };
}
function paywallKeyboard() { return buyKeyboard(); }

// ---------- copy ----------
const WELCOME =
  '🔮 <b>Астра</b> — твой проводник в мире Таро, нумерологии и астрологии.\n\n' +
  'Самое простое: <b>просто напиши мне свой вопрос</b> — и я сразу отвечу. ✨\n\n' +
  'А если хочешь глубокий разбор — выбери услугу в меню ниже.\n\n' +
  'Первые ' + cfg.FREE_QUESTIONS + ' запроса — бесплатно. 🌙';

// ---------- main ----------
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(200).send('ok'); return; }

  // Optional webhook secret (set the same value when registering the webhook).
  const secret = process.env.ASTRA_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    res.status(401).send('unauthorized'); return;
  }

  const update = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  try {
    // Answer payment confirmations instantly — Telegram allows ~10s.
    if (update.pre_checkout_query) {
      await tg.answerPreCheckoutQuery(update.pre_checkout_query.id, true);
      res.status(200).send('ok'); return;
    }

    // Deduplicate retried updates (Telegram re-sends on any non-200/timeout).
    if (update.update_id && !(await store.firstSeenUpdate(update.update_id))) {
      res.status(200).send('ok'); return;
    }

    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (e) {
    console.error('handler error:', e);
  }
  res.status(200).send('ok');
};

// ---------- callbacks (menu taps) ----------
async function onCallback(cq) {
  const chatId = cq.message && cq.message.chat.id;
  const userId = cq.from.id;
  const data = cq.data || '';
  await tg.answerCallbackQuery(cq.id);

  if (data === 'menu') return tg.sendMessage(chatId, 'Чем помочь? 🌙', { reply_markup: menuKeyboard() });
  if (data === 'balance') return showBalance(chatId, userId);
  if (data === 'buy') return tg.sendMessage(chatId, 'Выбери пакет запросов — оплата звёздами Telegram ⭐', { reply_markup: buyKeyboard() });

  if (data.indexOf('buy:') === 0) {
    const pkg = cfg.PACKAGES.find(function (p) { return p.id === data.slice(4); });
    if (pkg) return tg.sendStarsInvoice(chatId, pkg);
    return;
  }

  if (data.indexOf('svc:') === 0) {
    const svc = data.slice(4);
    await store.setState(userId, { svc: svc, step: 0, data: {} });
    if (svc === 'tarot') return tg.sendMessage(chatId, '🃏 Расклад Таро. О чём спросим карты? Напиши свой вопрос.');
    if (svc === 'numero') return tg.sendMessage(chatId, '🔢 Нумерология. Напиши свою дату рождения в формате <b>ДД.ММ.ГГГГ</b>.');
    if (svc === 'astro') return tg.sendMessage(chatId, '🪐 Астрология. Для начала — твоя дата рождения (<b>ДД.ММ.ГГГГ</b>).');
  }
}

// ---------- messages ----------
async function onMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Successful Star payment → credit once, thank the user.
  if (msg.successful_payment) {
    const sp = msg.successful_payment;
    const pkg = cfg.PACKAGES.find(function (p) { return 'pkg:' + p.id === sp.invoice_payload; });
    if (pkg) {
      const credited = await store.creditPaymentOnce(sp.telegram_payment_charge_id, userId, pkg.credits);
      if (credited) {
        const bal = await store.balance(userId);
        return tg.sendMessage(chatId,
          '✨ Спасибо! Начислено <b>' + pkg.credits + '</b> запросов. Твой баланс: <b>' + bal.credits + '</b>.\n\nСпрашивай — я рядом. 🔮');
      }
    }
    return;
  }

  const text = (msg.text || '').trim();
  if (!text) return;

  // Commands.
  if (text[0] === '/') {
    const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
    if (cmd === '/start') { await store.clearState(userId); return tg.sendMessage(chatId, WELCOME, { reply_markup: menuKeyboard() }); }
    if (cmd === '/menu') return tg.sendMessage(chatId, 'Чем помочь? 🌙', { reply_markup: menuKeyboard() });
    if (cmd === '/balance') return showBalance(chatId, userId);
    if (cmd === '/buy') return tg.sendMessage(chatId, 'Выбери пакет запросов — оплата звёздами Telegram ⭐', { reply_markup: buyKeyboard() });
    if (cmd === '/reset') { await store.clearMemory(userId); await store.clearState(userId); return tg.sendMessage(chatId, 'Начнём с чистого листа. 🕯 О чём думаешь?'); }
    // Unknown command → treat the rest as a quick question.
  }

  // In the middle of a structured service?
  const state = await store.getState(userId);
  if (state && state.svc) return continueService(chatId, userId, state, text);

  // Default = the headline fast answer.
  return quickAnswer(chatId, userId, text);
}

// ---------- fast answer (headline feature) ----------
async function quickAnswer(chatId, userId, text) {
  await tg.sendChatAction(chatId, 'typing');

  const bill = await store.consume(userId);
  if (!bill.ok) return sendPaywall(chatId);

  // Auto-grounding: if the message contains a birth date, quietly compute the
  // real numerology + sun sign so the answer is grounded, not invented.
  let context = '';
  const date = numero.parseDate(text);
  if (date) {
    const nums = numero.compute(date);
    const sun = astro.sunSign(date.d, date.m);
    context = '[КОНТЕКСТ] ' + numero.describe(date, nums) +
      '; Солнце в ' + sun.name + ' (стихия ' + sun.element + ').\n\n';
  }

  const memory = await store.getMemory(userId);
  const messages = memory.concat([{ role: 'user', content: context + text }]);

  const reply = await ai.generate(messages, cfg.MAX_TOKENS_QUICK);
  await tg.sendMessage(chatId, reply, { reply_markup: menuKeyboard() });

  await store.pushMemory(userId, 'user', text);
  await store.pushMemory(userId, 'assistant', reply);
}

// ---------- structured services ----------
async function continueService(chatId, userId, state, text) {
  const svc = state.svc;
  const skip = /^(пропустить|не знаю|-|нет)$/i.test(text.trim());

  if (svc === 'tarot') {
    return runReading(chatId, userId, function () {
      const cards = tarot.draw(3);
      return {
        directive: '[УСЛУГА: Таро] Вопрос клиента: "' + text + '".',
        context: '[КОНТЕКСТ] Вытянутые карты: ' + tarot.describe(cards) + '.'
      };
    });
  }

  if (svc === 'numero') {
    const date = numero.parseDate(text);
    if (!date) return tg.sendMessage(chatId, 'Не разобрала дату 🕯 Напиши в формате <b>ДД.ММ.ГГГГ</b>, например 07.03.1994.');
    return runReading(chatId, userId, function () {
      const nums = numero.compute(date);
      return {
        directive: '[УСЛУГА: Нумерология]',
        context: '[КОНТЕКСТ] ' + numero.describe(date, nums) + '.'
      };
    });
  }

  if (svc === 'astro') {
    // step 0: date → step 1: time → step 2: city → generate
    if (state.step === 0) {
      const date = numero.parseDate(text);
      if (!date) return tg.sendMessage(chatId, 'Не разобрала дату 🕯 Напиши <b>ДД.ММ.ГГГГ</b>.');
      state.data.date = date; state.step = 1;
      await store.setState(userId, state);
      return tg.sendMessage(chatId, 'Хорошо. Время рождения (<b>ЧЧ:ММ</b>)? Если не знаешь — напиши «пропустить».');
    }
    if (state.step === 1) {
      if (!skip) {
        const t = text.match(/(\d{1,2}):(\d{2})/);
        if (t) { state.data.hour = +t[1]; state.data.min = +t[2]; }
      }
      state.step = 2;
      await store.setState(userId, state);
      return tg.sendMessage(chatId, 'И город рождения? Если хочешь пропустить — напиши «пропустить».');
    }
    if (state.step === 2) {
      const city = skip ? null : text;
      const birth = Object.assign({}, state.data.date, {
        hour: state.data.hour, min: state.data.min, city: city
      });
      return runReading(chatId, userId, async function () {
        const chart = await astro.chart(birth);
        const place = chart.place ? ' Место: ' + chart.place.label + '.' : '';
        return {
          directive: '[УСЛУГА: Астрология]',
          context: '[КОНТЕКСТ] ' + astro.describe(chart) + '.' + place
        };
      });
    }
  }
}

// Shared: bill, build prompt, generate, deliver, remember, clear state.
async function runReading(chatId, userId, build) {
  await tg.sendChatAction(chatId, 'typing');

  const bill = await store.consume(userId);
  if (!bill.ok) { await store.clearState(userId); return sendPaywall(chatId); }

  const parts = await build();
  await store.clearState(userId);

  const content = parts.directive + '\n' + parts.context;
  const memory = await store.getMemory(userId);
  const messages = memory.concat([{ role: 'user', content: content }]);

  const reply = await ai.generate(messages, cfg.MAX_TOKENS_READING);
  await tg.sendMessage(chatId, reply, { reply_markup: menuKeyboard() });

  await store.pushMemory(userId, 'user', parts.directive);
  await store.pushMemory(userId, 'assistant', reply);
}

// ---------- helpers ----------
async function showBalance(chatId, userId) {
  const bal = await store.balance(userId);
  const line = bal.freeLeft > 0
    ? 'Бесплатных запросов осталось: <b>' + bal.freeLeft + '</b>.'
    : 'Куплено запросов на балансе: <b>' + bal.credits + '</b>.';
  return tg.sendMessage(chatId, '💫 ' + line, { reply_markup: buyKeyboard() });
}

function sendPaywall(chatId) {
  return tg.sendMessage(chatId,
    'Бесплатные запросы закончились ✨\nЧтобы продолжить, пополни баланс — оплата звёздами Telegram ⭐',
    { reply_markup: paywallKeyboard() });
}
