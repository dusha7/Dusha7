// Vercel serverless function — receives Stripe events and emails the shop owner
// a full order summary (receipt) after a successful payment.
//
// Env vars:
//   STRIPE_SECRET_KEY  (required)  — same key as checkout
//   RESEND_API_KEY     (required)  — from https://resend.com (free); enables the email
//   ORDER_EMAIL        (optional)  — where to send orders (default: dyshabbb@gmail.com)
//   ORDER_FROM         (optional)  — verified sender (default: Gallerytales <onboarding@resend.dev>)
//
// In the Stripe Dashboard → Developers → Webhooks, add an endpoint:
//   URL:    https://<your-site>/api/webhook
//   Event:  checkout.session.completed
const Stripe = require('stripe');

const LANGS = { EN: 'English', DE: 'German', NL: 'Dutch', FR: 'French' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { res.status(200).json({ ok: true, note: 'no stripe key' }); return; }
  const stripe = Stripe(key);

  try {
    const event = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (event.type === 'checkout.session.completed') {
      const id = event.data && event.data.object && event.data.object.id;
      if (id) {
        // Re-fetch from Stripe (trusts Stripe, not the incoming POST) and confirm it is paid.
        const s = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items', 'payment_intent.latest_charge'] });
        if (s && s.payment_status === 'paid') {
          await emailOwner(s);
        }
      }
    }
  } catch (e) {
    console.error('webhook error:', e && e.message);
  }
  // Always 200 so Stripe does not keep retrying on our email hiccups.
  res.status(200).json({ received: true });
};

async function emailOwner(s) {
  const rk = process.env.RESEND_API_KEY;
  const to = process.env.ORDER_EMAIL || 'dyshabbb@gmail.com';
  const from = process.env.ORDER_FROM || 'Gallerytales <onboarding@resend.dev>';
  const md = s.metadata || {};
  const cd = s.customer_details || {};
  const addr = cd.address ? [cd.address.line1, cd.address.line2, cd.address.postal_code, cd.address.city, cd.address.country].filter(Boolean).join(', ') : '—';
  const items = ((s.line_items && s.line_items.data) || []).map(function (li) {
    return '  • ' + li.description + ' — €' + (li.amount_total / 100).toFixed(2);
  }).join('\n') || '  —';
  const total = (s.amount_total / 100).toFixed(2);
  const charge = s.payment_intent && s.payment_intent.latest_charge;
  const receiptUrl = (charge && charge.receipt_url) || '';

  const lines = [
    'NEW PAID ORDER — Gallerytales',
    '================================',
    '',
    'ITEMS',
    items,
    '',
    'TOTAL PAID: €' + total,
    '',
    'CHOICES',
    '  Passport & notes language: ' + (LANGS[md.passport_language] || md.passport_language || 'English'),
    '  Festive wrapping (+€12):   ' + (md.festive_wrapping === 'yes' ? 'YES' : 'no'),
    '  Personal message (+€8):    ' + (md.personal_message === 'yes' ? 'YES' : 'no'),
    md.message_text ? '  Message text: "' + md.message_text + '"' : '',
    '  Terms of purchase accepted: ' + (md.terms_accepted === 'yes' ? 'YES' : '—'),
    '',
    'CUSTOMER',
    '  Name:  ' + (cd.name || '—'),
    '  Email: ' + (cd.email || '—'),
    '  Phone: ' + (cd.phone || '—'),
    '  Ship to: ' + addr,
    '',
    'PAYMENT',
    '  Stripe session: ' + s.id,
    receiptUrl ? '  Receipt: ' + receiptUrl : ''
  ].filter(function (x) { return x !== ''; }).join('\n');

  if (!rk) { console.log('RESEND_API_KEY missing — order not emailed. Order:\n' + lines); return; }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + rk, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from,
      to: [to],
      subject: 'New paid order — €' + total + (cd.name ? ' · ' + cd.name : ''),
      text: lines,
      reply_to: cd.email || undefined
    })
  });
  if (!resp.ok) { console.error('resend failed', resp.status, await resp.text().catch(function () { return ''; })); }
}
