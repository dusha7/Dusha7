// Live stock for the shop page: [{ id, price, sold }] from Supabase.
// The page shows its built-in list until this answers, so it never blocks rendering.
const db = require('../lib/db');

module.exports = async (req, res) => {
  if (!db.configured()) { res.status(200).json({ products: [] }); return; }
  try {
    const rows = await db.listProducts();
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    res.status(200).json({ products: rows.map(function (r) { return { id: r.id, price: Number(r.price), sold: !!r.sold }; }) });
  } catch (e) {
    res.status(200).json({ products: [], error: 'unavailable' });
  }
};
