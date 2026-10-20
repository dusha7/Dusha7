// Stripe webhook — on a paid checkout it marks the pieces sold and emails the shop owner
// the full order (once); on an expired checkout it releases the hold.
// Add in Stripe Dashboard → Developers → Webhooks: URL https://<site>/api/webhook,
// events checkout.session.completed and checkout.session.expired.
// Needs STRIPE_SECRET_KEY and RESEND_API_KEY.
const Stripe = require('stripe');
const { sendOrderEmail, fromOrderRow } = require('../lib/notify');
const db = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { res.status(200).json({ ok: true }); return; }
  const stripe = Stripe(key);
  try {
    const event = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = event.data && event.data.object && event.data.object.id;
    if (event.type === 'checkout.session.completed' && id) {
      const s = await stripe.checkout.sessions.retrieve(id, { expand: ['line_items', 'payment_intent.latest_charge'] });
      if (s && s.payment_status === 'paid') {
        const charge = s.payment_intent && s.payment_intent.latest_charge;
        const receiptUrl = charge && charge.receipt_url;
        const paymentRef = (s.payment_intent && (s.payment_intent.id || s.payment_intent)) || s.id;
        let row = null;
        if (db.configured()) {
          try { row = await db.rpc('gt_mark_paid', { p_ref: s.id }); } catch (e) { console.error('mark paid failed:', e.message); }
        }
        if (row && row.already_paid) {
          // Already handled on an earlier notification — no duplicate email.
        } else if (row) {
          await sendOrderEmail(fromOrderRow(row, { provider: 'Stripe', paymentRef: paymentRef, receiptUrl: receiptUrl }));
        } else {
          const md = s.metadata || {};
          const cd = s.customer_details || {};
          const items = ((s.line_items && s.line_items.data) || []).map(function (li) { return { name: li.description, amount: li.amount_total / 100 }; });
          await sendOrderEmail({
            provider: 'Stripe',
            items: items,
            total: s.amount_total / 100,
            shippingLabel: md.shipping_zone,
            lang: md.passport_language,
            wrap: md.festive_wrapping === 'yes',
            message: md.personal_message === 'yes',
            messageText: md.message_text,
            terms: md.terms_accepted === 'yes',
            customer: { name: cd.name || md.cust_name, email: cd.email || md.cust_email, phone: cd.phone || md.cust_phone, address: md.cust_address },
            paymentRef: paymentRef,
            receiptUrl: receiptUrl
          });
        }
      }
    } else if (event.type === 'checkout.session.expired' && id && db.configured()) {
      try { await db.rpc('gt_release', { p_ref: id, p_status: 'expired' }); } catch (e) { console.error('release failed:', e.message); }
    }
  } catch (e) { console.error('stripe webhook error:', e && e.message); }
  res.status(200).json({ received: true });
};
