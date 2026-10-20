// Shared: format a paid order and email it to the shop owner via Resend.
const LANGS = { EN: 'English', DE: 'German', NL: 'Dutch', FR: 'French' };

// Turn an order row from Supabase (see gt_mark_paid) into the email shape.
function fromOrderRow(row, extra) {
  const d = row.details || {};
  return Object.assign({
    items: d.lines || (row.items || []).map(function (id) { return { name: 'Artifact Nº ' + id, amount: 0 }; }),
    shipping: Number(row.shipping || 0),
    shippingLabel: row.shipping_zone,
    total: Number(row.total || 0),
    lang: d.lang,
    wrap: d.wrap,
    message: d.message,
    messageText: d.messageText,
    terms: d.terms,
    customer: d.customer || { name: row.customer_name, email: row.customer_email, address: row.country },
    orderNo: row.id
  }, extra || {});
}

async function sendOrderEmail(order) {
  const rk = process.env.RESEND_API_KEY;
  const to = process.env.ORDER_EMAIL || 'dyshabbb@gmail.com';
  const from = process.env.ORDER_FROM || 'Gallerytales <onboarding@resend.dev>';
  const c = order.customer || {};
  const items = (order.items || []).map(function (i) { return '  • ' + i.name + ' — €' + Number(i.amount).toFixed(2); }).join('\n') || '  —';
  const ship = order.shipping ? '€' + Number(order.shipping).toFixed(2) : 'Included';

  const lines = [
    'NEW PAID ORDER — Gallerytales' + (order.orderNo ? ' · Nº ' + order.orderNo : ''),
    '================================', '',
    'ITEMS', items, '',
    'Delivery: ' + ship + (order.shippingLabel ? ' · ' + order.shippingLabel : ''),
    'TOTAL PAID: €' + Number(order.total).toFixed(2), '',
    'CHOICES',
    '  Passport language: ' + (LANGS[order.lang] || order.lang || 'English'),
    '  Festive wrapping (+€12): ' + (order.wrap ? 'YES' : 'no'),
    '  Personal message (+€8): ' + (order.message ? 'YES' : 'no'),
    order.messageText ? '  Message text: "' + order.messageText + '"' : '',
    '  Terms accepted: ' + (order.terms ? 'YES' : '—'), '',
    'CUSTOMER',
    '  Name:  ' + (c.name || '—'),
    '  Email: ' + (c.email || '—'),
    '  Phone: ' + (c.phone || '—'),
    '  Ship to: ' + (c.address || '—'), '',
    'PAYMENT',
    '  Provider: ' + (order.provider || '—'),
    '  Reference: ' + (order.paymentRef || '—'),
    order.receiptUrl ? '  Receipt: ' + order.receiptUrl : ''
  ].filter(function (x) { return x !== ''; }).join('\n');

  if (!rk) { console.log('RESEND_API_KEY missing — order not emailed:\n' + lines); return; }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + rk, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from, to: [to],
      subject: 'New paid order — €' + Number(order.total).toFixed(2) + (c.name ? ' · ' + c.name : ''),
      text: lines,
      reply_to: c.email || undefined
    })
  });
  if (!resp.ok) { console.error('resend failed', resp.status, await resp.text().catch(function () { return ''; })); }
}

module.exports = { sendOrderEmail: sendOrderEmail, fromOrderRow: fromOrderRow, LANGS: LANGS };
