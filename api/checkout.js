// Vercel serverless function — creates a Stripe Checkout Session and returns its URL.
// Requires env var STRIPE_SECRET_KEY (set it in Vercel → Project → Settings → Environment Variables).
const Stripe = require('stripe');

// Server-side price list (source of truth — client prices are never trusted).
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
const EXTRAS = { wrap: { name: 'Festive wrapping', price: 12 }, message: { name: 'Hand-written message', price: 8 } };

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { res.status(500).json({ error: 'Payments are not configured yet (missing STRIPE_SECRET_KEY).' }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const items = Array.isArray(body.items) ? body.items : [];
    const lang = String(body.lang || 'EN').slice(0, 2).toUpperCase();
    const messageText = String(body.messageText || '').slice(0, 480);

    const line_items = [];
    items.forEach((id) => {
      const p = CATALOG[String(id)];
      if (p && !p.sold) {
        line_items.push({
          price_data: {
            currency: 'eur',
            product_data: { name: p.name + ' — Artifact No. ' + id },
            unit_amount: Math.round(p.price * 100)
          },
          quantity: 1
        });
      }
    });
    if (!line_items.length) { res.status(400).json({ error: 'Your cabinet is empty.' }); return; }

    if (body.wrap) line_items.push({ price_data: { currency: 'eur', product_data: { name: EXTRAS.wrap.name }, unit_amount: EXTRAS.wrap.price * 100 }, quantity: 1 });
    if (body.message) line_items.push({ price_data: { currency: 'eur', product_data: { name: EXTRAS.message.name }, unit_amount: EXTRAS.message.price * 100 }, quantity: 1 });

    const stripe = Stripe(key);
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const origin = req.headers.origin || (proto + '://' + req.headers.host);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      // Card is on by default; enable iDEAL / Bancontact in the Stripe Dashboard for EU buyers.
      success_url: origin + '/?paid=1',
      cancel_url: origin + '/?canceled=1',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['NL','BE','DE','FR','LU','AT','ES','IT','IE','PT','FI','SE','DK','PL'] },
      payment_intent_data: {
        description: 'Gallerytales order — passport in ' + lang + (body.wrap ? ', festive wrapping' : '') + (body.message ? ', personal message' : '')
      },
      metadata: {
        passport_language: lang,
        festive_wrapping: body.wrap ? 'yes' : 'no',
        personal_message: body.message ? 'yes' : 'no',
        message_text: messageText,
        terms_accepted: body.terms ? 'yes' : 'no'
      }
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || 'Checkout failed' });
  }
};
