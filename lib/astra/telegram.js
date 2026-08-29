// Thin Telegram Bot API wrapper (fetch-based, no dependency).
const TOKEN = process.env.ASTRA_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const BASE = 'https://api.telegram.org/bot' + TOKEN + '/';

async function api(method, params) {
  const r = await fetch(BASE + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {})
  });
  const j = await r.json();
  if (!j.ok) console.error('Telegram ' + method + ' failed:', j.description);
  return j;
}

// Escape everything, then re-allow the two formatting tags Astra may emit.
function sanitize(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(b|i)&gt;/g, '<$1$2>');
}

// Telegram caps messages at 4096 chars — split on paragraph boundaries.
function chunk(text, size) {
  size = size || 3800;
  const out = [];
  let buf = '';
  text.split('\n').forEach(function (line) {
    if ((buf + '\n' + line).length > size) { if (buf) out.push(buf); buf = line; }
    else { buf = buf ? buf + '\n' + line : line; }
  });
  if (buf) out.push(buf);
  return out.length ? out : [text];
}

async function sendMessage(chatId, text, extra) {
  const parts = chunk(sanitize(text));
  let last;
  for (let i = 0; i < parts.length; i++) {
    const params = Object.assign(
      { chat_id: chatId, text: parts[i], parse_mode: 'HTML', disable_web_page_preview: true },
      i === parts.length - 1 ? (extra || {}) : {}
    );
    last = await api('sendMessage', params);
  }
  return last;
}

function sendChatAction(chatId, action) {
  return api('sendChatAction', { chat_id: chatId, action: action || 'typing' });
}

function answerCallbackQuery(id, text) {
  return api('answerCallbackQuery', { callback_query_id: id, text: text || '' });
}

function answerPreCheckoutQuery(id, ok, errorMessage) {
  return api('answerPreCheckoutQuery', {
    pre_checkout_query_id: id, ok: !!ok,
    error_message: ok ? undefined : (errorMessage || 'Платёж не удалось подтвердить.')
  });
}

// Telegram Stars invoice: currency XTR, integer amount, no provider token.
function sendStarsInvoice(chatId, pkg) {
  const stars = pkg.badge ? pkg.title + ' · ' + pkg.badge : pkg.title;
  return api('sendInvoice', {
    chat_id: chatId,
    title: 'Астра · ' + pkg.title,
    description: 'Пакет «' + pkg.title + '» — пополнение баланса запросов к Астре.',
    payload: 'pkg:' + pkg.id,
    currency: 'XTR',
    prices: [{ label: stars, amount: pkg.stars }]
  });
}

module.exports = {
  api, sendMessage, sendChatAction, answerCallbackQuery,
  answerPreCheckoutQuery, sendStarsInvoice, hasToken: !!TOKEN
};
