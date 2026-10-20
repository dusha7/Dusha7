// Delivery fee by destination country (see /shipping.json).
const TABLE = require('../shipping.json');

function zoneFor(country) {
  const c = String(country || '').trim();
  for (const z of TABLE.zones) {
    if (z.countries.indexOf(c) > -1) return z;
  }
  return TABLE.zones.find(function (z) { return z.id === TABLE.default; });
}

module.exports = { zoneFor: zoneFor };
