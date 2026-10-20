// Supabase access for the shop's server functions.
// Needs SUPABASE_URL, SUPABASE_KEY (publishable/anon) and GT_DB_SECRET.
// Without them the shop still works, just without stock locking or order records.

function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.GT_DB_SECRET);
}

function headers() {
  const key = process.env.SUPABASE_KEY;
  const h = { 'apikey': key, 'Content-Type': 'application/json' };
  if (key.indexOf('eyJ') === 0) h['Authorization'] = 'Bearer ' + key;
  return h;
}

async function rpc(name, args) {
  const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(Object.assign({ p_secret: process.env.GT_DB_SECRET }, args))
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) {
    const err = new Error((data && data.message) || ('Supabase ' + r.status));
    err.status = r.status;
    throw err;
  }
  return data;
}

async function listProducts() {
  const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/products?select=id,price,sold', { headers: headers() });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return r.json();
}

module.exports = { configured: configured, rpc: rpc, listProducts: listProducts };
