// Creates a payment and returns a redirect URL.
// Uses Mollie when MOLLIE_API_KEY is set, otherwise Stripe (STRIPE_SECRET_KEY).
const Stripe = require('stripe');

// Server-side price list — the source of truth (client prices are never trusted).
const CATALOG = {
  '087': { name: "The Night-Watchman's Lamp", price: 95 },
  '112': { name: 'Apothecary Balance Scales', price: 140, sold: true },
  '054': { name: "The Captain's Decanter", price: 110 },
  '069': { name: 'The Silent Opener', price: 48 },
  '031': { name: "The Merchant's Signet", price: 72 },
  '095': { name: 'The Extinguisher', price: 54 },
  '118': { name: "The Cartographer's Loupe", price: 66 },
  '042': { name: "The Gentleman's Cigar Rest", price: 58 }
};
const EXTRA_WRAP = 12, EXTRA_MSG = 8, SHIP_FEE = 9, FREE_OVER = 75;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const items = Array.isArray(body.items) ? body.items : [];
    const lang = String(body.lang || 'EN').slice(0, 2).toUpperCase();
    const messageText = String(body.messageText || '').slice(0, 480);
    const wrap = !!body.wrap, message = !!body.message;
    const cust = body.customer || {};

    const chosen = [];
    let subtotal = 0;
    items.forEach(function (id) {
      const p = CATALOG[String(id)];
      if (p && !p.sold) { chosen.push({ name: p.name + ' — Artifact No. ' + id, price: p.price }); subtotal += p.price; }
    });
    if (!chosen.length) { res.status(400).json({ error: 'Your cabinet is empty.' }); return; }

    const extras = [];
    if (wrap) extras.push({ name: 'Festive wrapping', price: EXTRA_WRAP });
    if (message) extras.push({ name: 'Hand-written message', price: EXTRA_MSG });
    const shipping = subtotal > 0 && subtotal < FREE_OVER ? SHIP_FEE : 0;
    const extrasSum = extras.reduce(function (s, e) { return s + e.price; }, 0);
    const total = subtotal + extrasSum + shipping;

    const custAddr = [cust.addr, cust.zip, cust.city, cust.country].filter(Boolean).join(', ');
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const origin = req.headers.origin || (proto + '://' + req.headers.host);
    const meta = {
      passport_language: lang,
      festive_wrapping: wrap ? 'yes' : 'no',
      personal_message: message ? 'yes' : 'no',
      message_text: messageText,
      terms_accepted: body.terms ? 'yes' : 'no',
      cust_name: String(cust.name || ''),
      cust_email: String(cust.email || ''),
      cust_phone: String(cust.phone || ''),
      cust_address: custAddr
    };

    // ----- Mollie -----
    if (process.env.MOLLIE_API_KEY) {
      const payload = {
        amount: { currency: 'EUR', value: total.toFixed(2) },
        description: 'Gallerytales order — ' + chosen.length + ' artifact(s)',
        redirectUrl: origin + '/?paid=1',
        webhookUrl: origin + '/api/mollie-webhook',
        metadata: meta,
        billingEmail: cust.email || undefined
      };
      const r = await fetch('https://api.mollie.com/v2/payments', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.MOLLIE_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (!r.ok) { res.status(500).json({ error: (d && d.detail) || 'Mollie error' }); return; }
      const url = d && d._links && d._links.checkout && d._links.checkout.href;
      if (!url) { res.status(500).json({ error: 'Mollie did not return a checkout URL' }); return; }
      res.status(200).json({ url: url });
      return;
    }

    // ----- Stripe -----
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) { res.status(500).json({ error: 'Payments are not configured yet (set MOLLIE_API_KEY or STRIPE_SECRET_KEY).' }); return; }
    const stripe = Stripe(key);
    const line_items = chosen.concat(extras).map(function (it) {
      return { price_data: { currency: 'eur', product_data: { name: it.name }, unit_amount: Math.round(it.price * 100) }, quantity: 1 };
    });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: line_items,
      customer_email: cust.email || undefined,
      success_url: origin + '/?paid=1',
      cancel_url: origin + '/?canceled=1',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['NL','BE','DE','FR','LU','AT','ES','IT','IE','PT','FI','SE','DK','PL'] },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: shipping * 100, currency: 'eur' },
          display_name: shipping > 0 ? 'EU insured shipping' : 'Free EU shipping'
        }
      }],
      payment_intent_data: { description: 'Gallerytales order — passport in ' + lang },
      metadata: meta
    });
    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || 'Checkout failed' });
  }
};
