#!/usr/bin/env node
// Register (or delete) the Telegram webhook for the Astra bot.
//
//   BASE_URL=https://your-app.vercel.app node scripts/set-webhook.js
//   node scripts/set-webhook.js --delete
//
// Requires ASTRA_BOT_TOKEN in the environment. If ASTRA_WEBHOOK_SECRET is set,
// it is registered so Telegram signs every update.
const TOKEN = process.env.ASTRA_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.ASTRA_WEBHOOK_SECRET;

async function main() {
  if (!TOKEN) { console.error('Set ASTRA_BOT_TOKEN first.'); process.exit(1); }
  const api = 'https://api.telegram.org/bot' + TOKEN + '/';

  if (process.argv.includes('--delete')) {
    const r = await fetch(api + 'deleteWebhook', { method: 'POST' });
    console.log(await r.json());
    return;
  }

  const base = process.env.BASE_URL;
  if (!base) { console.error('Set BASE_URL=https://your-app.vercel.app'); process.exit(1); }

  const body = {
    url: base.replace(/\/$/, '') + '/api/telegram',
    allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
    drop_pending_updates: true
  };
  if (SECRET) body.secret_token = SECRET;

  const r = await fetch(api + 'setWebhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  console.log(await r.json());
}

main().catch(function (e) { console.error(e); process.exit(1); });
