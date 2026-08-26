// Returns whether a payment reference is actually paid. Used by the site after
// the customer returns from the payment page, so we never show a false "thank you".
const Stripe = require('stripe');

module.exports = async (req, res) => {
  let ref = req.query && req.query.ref;
  if (!ref) { try { ref = new URL(req.url, 'http://x').searchParams.get('ref'); } catch (e) {} }
  if (!ref) { res.status(400).json({ paid: false, error: 'no ref' }); return; }
  try {
    // Mollie payment id
    if (ref.indexOf('tr_') === 0 && process.env.MOLLIE_API_KEY) {
      const r = await fetch('https://api.mollie.com/v2/payments/' + encodeURIComponent(ref), {
        headers: { 'Authorization': 'Bearer ' + process.env.MOLLIE_API_KEY }
      });
      const p = await r.json();
      res.status(200).json({ paid: !!(p && p.status === 'paid'), status: p && p.status });
      return;
    }
    // Stripe Checkout Session id
    if (ref.indexOf('cs_') === 0 && process.env.STRIPE_SECRET_KEY) {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const s = await stripe.checkout.sessions.retrieve(ref);
      res.status(200).json({ paid: !!(s && s.payment_status === 'paid'), status: s && s.payment_status });
      return;
    }
    res.status(200).json({ paid: false, status: 'unknown' });
  } catch (e) {
    res.status(200).json({ paid: false, status: 'error' });
  }
};
