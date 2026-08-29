// Central configuration for the Astra esoteric-consultant bot.
//
// The HEADLINE feature is the fast answer: the user types anything and Astra
// replies right away (default text handler). On top of that the three full
// services stay available via the menu / commands:
//   • Таро (расклад из реальных вытянутых карт)
//   • Нумерология (числа считаются в коде)
//   • Астрология (знаки, стихии, асцендент и планеты считаются в коде)
//
// Prices are in Telegram Stars (XTR) — integers, no decimals.

module.exports = {
  // Free trial: how many interactions a brand-new user gets before the paywall.
  FREE_QUESTIONS: 3,
  // Credits spent per answered question or per generated reading (both = 1).
  CREDITS_PER_QUESTION: 1,

  // Star packages the user can buy. `id` is embedded in the invoice payload.
  PACKAGES: [
    { id: 'p10', credits: 10, stars: 100, title: '10 запросов' },
    { id: 'p30', credits: 30, stars: 250, title: '30 запросов', badge: 'выгодно' },
    { id: 'p100', credits: 100, stars: 700, title: '100 запросов', badge: '−30%' }
  ],

  // Generation settings. Speed-first for the quick answer; a touch more room
  // for the structured readings. Override the model via ASTRA_MODEL
  // (e.g. claude-haiku-4-5 for maximum speed).
  MODEL: process.env.ASTRA_MODEL || 'claude-opus-5',
  MAX_TOKENS_QUICK: 700,
  MAX_TOKENS_READING: 1400,
  EFFORT: 'low', // chat-style creative work — low effort is the cost/speed sweet spot

  // Conversation memory: how many recent turns to keep for natural follow-ups.
  MEMORY_TURNS: 6,

  // Redis key TTLs (seconds).
  MEMORY_TTL: 60 * 60 * 24 * 7, // 7 days
  STATE_TTL: 60 * 60,           // in-progress structured-reading state
  UPDATE_DEDUP_TTL: 60 * 60     // idempotency for Telegram update retries
};
