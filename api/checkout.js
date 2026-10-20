// Creates a payment and returns a redirect URL.
// Uses Mollie when MOLLIE_API_KEY is set, otherwise Stripe (STRIPE_SECRET_KEY).
// When Supabase is configured, items are held for 30 minutes while the customer pays
// and a pending order is recorded, so a one-of-one piece can never be sold twice.
const Stripe = require('stripe');
const db = require('../lib/db');
const { zoneFor } = require('../lib/shipping');

// Fallback price list (used only if Supabase is not configured).
// Prices include insured delivery within the EU.
const CATALOG = {
  '087': { name: "The Night-Watchman's Lamp", price: 125 },
  '112': { name: 'Apothecary Balance Scales', price: 170, sold: true },
  '054': { name: "The Captain's Decanter", price: 140 },
  '069': { name: 'The Silent Opener', price: 78 },
  '031': { name: "The Merchant's Signet", price: 102 },
  '095': { name: 'The Extinguisher', price: 84 },
  '118': { name: "The Cartographer's Loupe", price: 96 },
  '042': { name: "The Gentleman's Cigar Rest", price: 88 }
};
const EXTRA_WRAP = 12, EXTRA_MSG = 8;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const ids = Array.from(new Set((Array.isArray(body.items) ? body.items : []).map(String))).slice(0, 50);
    const lang = String(body.lang || 'EN').slice(0, 2).toUpperCase();
    const messageText = String(body.messageText || '').slice(0, 480);
    const wrap = !!body.wrap, message = !!body.message;
    const cust = body.customer || {};
    const token = String(body.token || '').slice(0, 64) || ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2));
    if (!ids.length) { res.status(400).json({ error: 'Your cabinet is empty.' }); return; }

    // ----- Items & prices: Supabase holds them while the customer pays -----
    let chosen = [];
    const useDb = db.configured();
    if (useDb) {
      try {
        const rows = await db.rpc('gt_reserve', { p_token: token, p_ids: ids });
        chosen = (rows || []).map(function (r) { return { id: r.id, name: r.name + ' — Artifact No. ' + r.id, price: Number(r.price) }; });
      } catch (e) {
        const m = /unavailable:([\w,]+)/.exec(e.message || '');
        if (m) {
          const gone = m[1].split(',');
          const names = gone.map(function (id) { return (CATALOG[id] && CATALOG[id].name) || ('Nº ' + id); });
          res.status(409).json({ code: 'unavailable', ids: gone, error: names.join(', ') + (gone.length > 1 ? ' have' : ' has') + ' just been reserved by another collector. It has been removed from your cabinet.' });
          return;
        }
        console.error('reserve failed, falling back to catalog:', e.message);
      }
    }
    if (!chosen.length) {
      ids.forEach(function (id) {
        const p = CATALOG[id];
        if (p && !p.sold) chosen.push({ id: id, name: p.name + ' — Artifact No. ' + id, price: p.price });
      });
    }
    if (!chosen.length) { res.status(400).json({ error: 'These pieces are no longer available.' }); return; }

    const subtotal = chosen.reduce(function (s, c) { return s + c.price; }, 0);
    const extras = [];
    if (wrap) extras.push({ name: 'Festive wrapping', price: EXTRA_WRAP });
    if (message) extras.push({ name: 'Hand-written message', price: EXTRA_MSG });
    const extrasSum = extras.reduce(function (s, e) { return s + e.price; }, 0);
    const zone = zoneFor(cust.country);
    const shipping = zone.fee;
    const total = subtotal + extrasSum + shipping;

    const custAddr = [cust.addr, cust.country].filter(Boolean).join(', ');
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const origin = req.headers.origin || (proto + '://' + req.headers.host);
    const meta = {
      items: chosen.map(function (c) { return c.id; }).join(','),
      token: token,
      passport_language: lang,
      festive_wrapping: wrap ? 'yes' : 'no',
      personal_message: message ? 'yes' : 'no',
      message_text: messageText.slice(0, 300),
      terms_accepted: body.terms ? 'yes' : 'no',
      shipping_zone: zone.label + ' (€' + shipping + ')',
      cust_name: String(cust.name || '').slice(0, 80),
      cust_email: String(cust.email || '').slice(0, 120),
      cust_phone: String(cust.phone || '').slice(0, 40),
      cust_country: String(cust.country || '').slice(0, 60),
      cust_address: custAddr.slice(0, 300)
    };
    const order = {
      provider: '', payment_ref: '', token: token,
      items: chosen.map(function (c) { return c.id; }),
      subtotal: subtotal, extras: extrasSum, shipping: shipping, total: total,
      country: cust.country || '', shipping_zone: zone.label,
      customer_name: cust.name || '', customer_email: cust.email || '',
      details: {
        lines: chosen.map(function (c) { return { name: c.name, amount: c.price }; }).concat(extras.map(function (e) { return { name: e.name, amount: e.price }; })),
        lang: lang, wrap: wrap, message: message, messageText: messageText, terms: !!body.terms,
        customer: { name: cust.name || '', email: cust.email || '', phone: cust.phone || '', address: custAddr }
      }
    };
    async function recordOrder() {
      if (!useDb) return;
      try { await db.rpc('gt_create_order', { p_order: order }); } catch (e) { console.error('create order failed:', e.message); }
    }

    // ----- Mollie -----
    if (process.env.MOLLIE_API_KEY) {
      const payload = {
        amount: { currency: 'EUR', value: total.toFixed(2) },
        description: 'Gallerytales order — ' + chosen.length + ' artifact(s)',
        redirectUrl: origin + '/?return=1',
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
      // Mollie uses one redirectUrl for every outcome, so we send the payment id back
      // with it and verify the real status via /api/order-status on return.
      if (d.id) {
        try {
          await fetch('https://api.mollie.com/v2/payments/' + encodeURIComponent(d.id), {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + process.env.MOLLIE_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ redirectUrl: origin + '/?return=1&ref=' + encodeURIComponent(d.id) })
          });
        } catch (e) { /* keep the neutral redirect */ }
      }
      order.provider = 'Mollie'; order.payment_ref = d.id;
      await recordOrder();
      res.status(200).json({ url: url });
      return;
    }

    // ----- Stripe -----
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) { res.status(500).json({ error: 'Payments are not configured yet (set MOLLIE_API_KEY or STRIPE_SECRET_KEY).' }); return; }
    const stripe = Stripe(key);
    // Address is collected on our side (worldwide), so we do not restrict or re-ask it on Stripe.
    const allItems = chosen.concat(extras);
    if (shipping > 0) allItems.push({ name: 'Insured delivery — ' + zone.label, price: shipping });
    const line_items = allItems.map(function (it) {
      return { price_data: { currency: 'eur', product_data: { name: it.name }, unit_amount: Math.round(it.price * 100) }, quantity: 1 };
    });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: line_items,
      customer_email: cust.email || undefined,
      billing_address_collection: 'auto',
      success_url: origin + '/?return=1&ref={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?return=1',
      payment_intent_data: { description: 'Gallerytales order — passport in ' + lang },
      metadata: meta
    });
    order.provider = 'Stripe'; order.payment_ref = session.id;
    await recordOrder();
    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || 'Checkout failed' });
  }
};
