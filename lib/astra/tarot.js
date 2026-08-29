// Tarot deck + a cryptographically-random draw.
// The model does NOT invent cards — we draw them here and pass them as facts.
const crypto = require('crypto');

// 22 Major Arcana — enough for expressive 1/3/5-card spreads.
const MAJORS = [
  'Шут', 'Маг', 'Верховная Жрица', 'Императрица', 'Император',
  'Иерофант', 'Влюблённые', 'Колесница', 'Сила', 'Отшельник',
  'Колесо Фортуны', 'Справедливость', 'Повешенный', 'Смерть', 'Умеренность',
  'Дьявол', 'Башня', 'Звезда', 'Луна', 'Солнце', 'Суд', 'Мир'
];

// Unbiased random integer in [0, max) using rejection sampling.
function randInt(max) {
  const limit = Math.floor(0xffffffff / max) * max;
  let x;
  do {
    x = crypto.randomBytes(4).readUInt32BE(0);
  } while (x >= limit);
  return x % max;
}

// Draw `count` distinct cards, each independently upright or reversed.
function draw(count) {
  const pool = MAJORS.slice();
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = randInt(pool.length);
    const name = pool.splice(idx, 1)[0];
    out.push({ name, reversed: randInt(2) === 1 });
  }
  return out;
}

// Human-readable line for the [КОНТЕКСТ] block.
function describe(cards) {
  return cards
    .map(function (c) { return c.name + (c.reversed ? ' (перевёрнутая)' : ' (прямая)'); })
    .join(', ');
}

module.exports = { draw, describe, MAJORS };
