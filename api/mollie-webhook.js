// Mollie webhook — Mollie POSTs a payment id here; we re-fetch it and, if paid,
// mark the pieces sold and email the shop owner the full order (once).
// If the payment failed or expired, the 30-minute hold is released.
// Set as webhookUrl in the payment (done in checkout.js). Needs MOLLIE_API_KEY and RESEND_API_KEY.
const { sendOrderEmail, fromOrderRow } = require('../lib/notify');
const db = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const key = process.env.MOLLIE_API_KEY;
  if (!key) { res.status(200).end(); return; }
  try {
    let id = req.body && req.body.id;
    if (!id && typeof req.body === 'string') { const m = /(?:^|&)id=([^&]+)/.exec(req.body); if (m) id = decodeURIComponent(m[1]); }
    if (id) {
      const r = await fetch('https://api.mollie.com/v2/payments/' + encodeURIComponent(id), { headers: { 'Authorization': 'Bearer ' + key } });
      const p = await r.json();
      const md = (p && p.metadata) || {};
      if (p && p.status === 'paid') {
        let row = null;
        if (db.configured()) {
          try { row = await db.rpc('gt_mark_paid', { p_ref: p.id }); } catch (e) { console.error('mark paid failed:', e.message); }
        }
        if (row && row.already_paid) {
          // Already handled on an earlier notification — no duplicate email.
        } else if (row) {
          await sendOrderEmail(fromOrderRow(row, { provider: 'Mollie', paymentRef: p.id }));
        } else {
          // No database, or the order was not recorded: email from the payment's own metadata.
          const value = Number((p.amount && p.amount.value) || 0);
          await sendOrderEmail({
            provider: 'Mollie',
            items: [{ name: (p.description || 'Gallerytales order') + (md.items ? ' (Nº ' + md.items + ')' : ''), amount: value }],
            total: value,
            shippingLabel: md.shipping_zone,
            lang: md.passport_language,
            wrap: md.festive_wrapping === 'yes',
            message: md.personal_message === 'yes',
            messageText: md.message_text,
            terms: md.terms_accepted === 'yes',
            customer: { name: md.cust_name, email: md.cust_email, phone: md.cust_phone, address: md.cust_address },
            paymentRef: p.id
          });
        }
      } else if (p && ['canceled', 'expired', 'failed'].indexOf(p.status) > -1 && db.configured()) {
        try { await db.rpc('gt_release', { p_ref: p.id, p_status: p.status }); } catch (e) { console.error('release failed:', e.message); }
      }
    }
  } catch (e) { console.error('mollie webhook error:', e && e.message); }
  res.status(200).end();
};
