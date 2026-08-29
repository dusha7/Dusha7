// Numerology computed in code (the model is bad at arithmetic on dates).
// Methodology (Pythagorean): master numbers 11 / 22 / 33 are preserved.

function digits(n) {
  return String(n).replace(/\D/g, '').split('').map(Number);
}

// Reduce to a single digit, keeping master numbers 11/22/33.
function reduce(sum) {
  while (sum > 9 && sum !== 11 && sum !== 22 && sum !== 33) {
    sum = digits(sum).reduce(function (a, b) { return a + b; }, 0);
  }
  return sum;
}

// Parse a date the user typed. Accepts DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY,
// YYYY-MM-DD. Returns {d, m, y} or null.
function parseDate(text) {
  if (!text) return null;
  var s = String(text).trim();
  var m = s.match(/\b(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/); // YYYY-MM-DD
  if (m) return normalize(+m[3], +m[2], +m[1]);
  m = s.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/); // DD.MM.YYYY
  if (m) return normalize(+m[1], +m[2], +m[3]);
  return null;
}

function normalize(d, mo, y) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return { d: d, m: mo, y: y };
}

// Life Path — sum of all digits of the full birth date.
// Soul (Число Души) — the day of birth, reduced.
function compute(date) {
  var all = digits(date.d).concat(digits(date.m), digits(date.y));
  var lifePath = reduce(all.reduce(function (a, b) { return a + b; }, 0));
  var soul = reduce(date.d);
  return { lifePath: lifePath, soul: soul };
}

function describe(date, nums) {
  var dd = String(date.d).padStart(2, '0');
  var mm = String(date.m).padStart(2, '0');
  return 'дата рождения ' + dd + '.' + mm + '.' + date.y +
    ', Число Жизненного Пути = ' + nums.lifePath +
    ', Число Души = ' + nums.soul;
}

module.exports = { parseDate: parseDate, compute: compute, describe: describe, reduce: reduce };
