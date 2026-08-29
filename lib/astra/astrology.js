// Astrology computed in code so the model doesn't hallucinate positions.
// - Sun sign always available from the date alone.
// - Moon + planets + Ascendant computed with astronomy-engine when we have a
//   birth time and a geocoded city.
// Tropical zodiac, positions "of date". Values are approximate but real —
// good enough for an entertainment consultant, and far better than guessing.

let Astronomy = null;
try { Astronomy = require('astronomy-engine'); } catch (e) { /* optional dep */ }

const SIGNS = [
  { name: 'Овен', element: 'Огонь' }, { name: 'Телец', element: 'Земля' },
  { name: 'Близнецы', element: 'Воздух' }, { name: 'Рак', element: 'Вода' },
  { name: 'Лев', element: 'Огонь' }, { name: 'Дева', element: 'Земля' },
  { name: 'Весы', element: 'Воздух' }, { name: 'Скорпион', element: 'Вода' },
  { name: 'Стрелец', element: 'Огонь' }, { name: 'Козерог', element: 'Земля' },
  { name: 'Водолей', element: 'Воздух' }, { name: 'Рыбы', element: 'Вода' }
];

const DEG = Math.PI / 180;
function norm360(x) { return ((x % 360) + 360) % 360; }
function signOf(lon) { return SIGNS[Math.floor(norm360(lon) / 30)]; }

// Sun sign from month/day using standard tropical date boundaries.
// cutoff = first day of the sign that STARTS in that month; startIdx = that sign.
function sunSign(d, m) {
  const cutoff = [20, 19, 21, 20, 21, 21, 23, 23, 23, 23, 22, 22];
  const startIdx = [10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const i = startIdx[m - 1];
  return SIGNS[d >= cutoff[m - 1] ? i : (i + 11) % 12];
}

// Geocode a city name -> {lat, lon, timezone, label}. Free, no API key.
async function geocode(city) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=' +
    encodeURIComponent(city);
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const g = j && j.results && j.results[0];
  if (!g) return null;
  return {
    lat: g.latitude, lon: g.longitude, timezone: g.timezone || 'UTC',
    label: [g.name, g.admin1, g.country].filter(Boolean).join(', ')
  };
}

// Minutes east of UTC for an instant in an IANA timezone (DST-aware).
function tzOffsetMinutes(date, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = {};
    dtf.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch (e) { return 0; }
}

// Convert local wall-clock birth time in `tz` to the correct UTC instant.
function localToUTC(y, mo, d, h, mi, tz) {
  let ts = Date.UTC(y, mo - 1, d, h, mi);
  let off = tzOffsetMinutes(new Date(ts), tz);
  ts = Date.UTC(y, mo - 1, d, h, mi) - off * 60000;
  off = tzOffsetMinutes(new Date(ts), tz); // one refinement across DST edges
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - off * 60000);
}

// Mean obliquity of the ecliptic (degrees) for a given date.
function obliquity(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  return 23.439291 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
}

// Ascendant ecliptic longitude from local sidereal time + latitude.
function ascendant(dateUTC, lat, lon) {
  const gast = Astronomy.SiderealTime(dateUTC);       // sidereal hours
  const ramc = norm360(gast * 15 + lon);              // local sidereal time, deg
  const eps = obliquity(dateUTC) * DEG;
  const phi = lat * DEG;
  const r = ramc * DEG;
  const asc = Math.atan2(Math.cos(r), -(Math.sin(r) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps)));
  return norm360(asc / DEG);
}

function eclipticLon(body, dateUTC) {
  const vec = Astronomy.GeoVector(body, dateUTC, true);
  return norm360(Astronomy.Ecliptic(vec).elon);
}

// Build a full context object for one person. `birth` = {d,m,y,hour?,min?,city?}.
async function chart(birth) {
  const sun = sunSign(birth.d, birth.m);
  const out = { sun: sun };

  const hasTime = Number.isFinite(birth.hour) && Number.isFinite(birth.min);
  if (Astronomy && birth.city && hasTime) {
    try {
      const place = await geocode(birth.city);
      if (place) {
        const utc = localToUTC(birth.y, birth.m, birth.d, birth.hour, birth.min, place.timezone);
        out.place = place;
        out.moon = signOf(Astronomy.EclipticGeoMoon(utc).lon);
        out.mercury = signOf(eclipticLon(Astronomy.Body.Mercury, utc));
        out.venus = signOf(eclipticLon(Astronomy.Body.Venus, utc));
        out.mars = signOf(eclipticLon(Astronomy.Body.Mars, utc));
        out.ascendant = signOf(ascendant(utc, place.lat, place.lon));
      }
    } catch (e) { /* degrade to sun sign only */ }
  }
  return out;
}

function describe(c) {
  const parts = ['Солнце в ' + c.sun.name + ' (стихия ' + c.sun.element + ')'];
  if (c.moon) parts.push('Луна в ' + c.moon.name);
  if (c.ascendant) parts.push('Асцендент в ' + c.ascendant.name);
  if (c.mercury) parts.push('Меркурий в ' + c.mercury.name);
  if (c.venus) parts.push('Венера в ' + c.venus.name);
  if (c.mars) parts.push('Марс в ' + c.mars.name);
  return parts.join(', ');
}

module.exports = {
  sunSign: sunSign, chart: chart, describe: describe, geocode: geocode, SIGNS: SIGNS
};
