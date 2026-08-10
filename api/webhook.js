// Stripe webhook — on a paid checkout it emails the shop owner the full order.
// Add in Stripe Dashboard → Developers → Webhooks: URL https://<site>/api/webhook,
// event checkout.session.completed. Needs STRIPE_SECRET_KEY and RESEND_API_KEY.
const Stripe = require('stripe');
const { sendOrderEmail } = require('../lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { res.status(200).json({ ok: true }); return; }
  const stripe = Stripe(key);
  try {
    const event = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (event.type === 'checkout.session.completed') {
      const id = event.data && event.data.object && event.data.object.id;
      if (id) {
        const s = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items', 'payment_intent.latest_charge'] });
        if (s && s.payment_status === 'paid') {
          const md = s.metadata || {};
          const cd = s.customer_details || {};
          const items = ((s.line_items && s.line_items.data) || []).map(function (li) { return { name: li.description, amount: li.amount_total / 100 }; });
          const charge = s.payment_intent && s.payment_intent.latest_charge;
          const addr = cd.address ? [cd.address.line1, cd.address.line2, cd.address.postal_code, cd.address.city, cd.address.country].filter(Boolean).join(', ') : md.cust_address;
          await sendOrderEmail({
            provider: 'Stripe',
            items: items,
            total: s.amount_total / 100,
            shipping: (s.shipping_cost && s.shipping_cost.amount_total / 100) || 0,
            lang: md.passport_language,
            wrap: md.festive_wrapping === 'yes',
            message: md.personal_message === 'yes',
            messageText: md.message_text,
            terms: md.terms_accepted === 'yes',
            customer: { name: cd.name || md.cust_name, email: cd.email || md.cust_email, phone: cd.phone || md.cust_phone, address: addr },
            paymentRef: (s.payment_intent && (s.payment_intent.id || s.payment_intent)) || s.id,
            receiptUrl: charge && charge.receipt_url
          });
        }
      }
    }
  } catch (e) { console.error('stripe webhook error:', e && e.message); }
  res.status(200).json({ received: true });
};
