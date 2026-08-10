// Mollie webhook — Mollie POSTs a payment id here; we re-fetch it and, if paid,
// email the shop owner the full order. Set as webhookUrl in the payment (done in
// checkout.js). Needs MOLLIE_API_KEY and RESEND_API_KEY.
const { sendOrderEmail } = require('../lib/notify');

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
      if (p && p.status === 'paid') {
        const md = p.metadata || {};
        const value = Number((p.amount && p.amount.value) || 0);
        await sendOrderEmail({
          provider: 'Mollie',
          items: [{ name: p.description || 'Gallerytales order', amount: value }],
          total: value,
          lang: md.passport_language,
          wrap: md.festive_wrapping === 'yes',
          message: md.personal_message === 'yes',
          messageText: md.message_text,
          terms: md.terms_accepted === 'yes',
          customer: { name: md.cust_name, email: md.cust_email, phone: md.cust_phone, address: md.cust_address },
          paymentRef: p.id
        });
      }
    }
  } catch (e) { console.error('mollie webhook error:', e && e.message); }
  res.status(200).end();
};
