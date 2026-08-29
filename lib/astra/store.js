// Persistence on Upstash Redis (HTTP, serverless-friendly).
// Tracks credits, the free-trial counter, short conversation memory, and
// idempotency keys for Telegram retries and Star payments.
const { Redis } = require('@upstash/redis');
const cfg = require('./config');

const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / _TOKEN

const kCred = function (id) { return 'astra:cred:' + id; };
const kFree = function (id) { return 'astra:free:' + id; };
const kMem = function (id) { return 'astra:mem:' + id; };
const kState = function (id) { return 'astra:state:' + id; };
const kUpd = function (id) { return 'astra:upd:' + id; };
const kPay = function (id) { return 'astra:pay:' + id; };

// True only the first time we see a given Telegram update_id (dedup retries).
async function firstSeenUpdate(updateId) {
  const ok = await redis.set(kUpd(updateId), 1, { nx: true, ex: cfg.UPDATE_DEDUP_TTL });
  return ok === 'OK' || ok === true;
}

// Try to consume one interaction. Returns the billing mode or a block.
// { ok:true, mode:'free'|'credit' } | { ok:false }
async function consume(id) {
  const used = await redis.incr(kFree(id));
  if (used <= cfg.FREE_QUESTIONS) return { ok: true, mode: 'free' };
  await redis.decr(kFree(id)); // roll back the over-count

  const after = await redis.decr(kCred(id));
  if (after >= 0) return { ok: true, mode: 'credit' };
  await redis.incr(kCred(id)); // no credits — put it back
  return { ok: false };
}

async function addCredits(id, n) {
  return redis.incrby(kCred(id), n);
}

async function balance(id) {
  const credits = (await redis.get(kCred(id))) || 0;
  const usedFree = (await redis.get(kFree(id))) || 0;
  const freeLeft = Math.max(0, cfg.FREE_QUESTIONS - Number(usedFree));
  return { credits: Number(credits), freeLeft: freeLeft };
}

// Credit a Star payment exactly once, keyed by Telegram's charge id.
async function creditPaymentOnce(chargeId, id, credits) {
  const ok = await redis.set(kPay(chargeId), 1, { nx: true, ex: 60 * 60 * 24 * 30 });
  if (!(ok === 'OK' || ok === true)) return false; // already credited
  await addCredits(id, credits);
  return true;
}

// Conversation memory (recent turns) for natural follow-ups.
async function pushMemory(id, role, content) {
  const key = kMem(id);
  await redis.rpush(key, JSON.stringify({ role: role, content: content }));
  await redis.ltrim(key, -cfg.MEMORY_TURNS * 2, -1);
  await redis.expire(key, cfg.MEMORY_TTL);
}

async function getMemory(id) {
  const raw = (await redis.lrange(kMem(id), 0, -1)) || [];
  return raw.map(function (x) { return typeof x === 'string' ? JSON.parse(x) : x; });
}

async function clearMemory(id) { return redis.del(kMem(id)); }

// In-progress structured-reading state.
async function setState(id, state) {
  return redis.set(kState(id), JSON.stringify(state), { ex: cfg.STATE_TTL });
}
async function getState(id) {
  const raw = await redis.get(kState(id));
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
async function clearState(id) { return redis.del(kState(id)); }

module.exports = {
  firstSeenUpdate, consume, addCredits, balance, creditPaymentOnce,
  pushMemory, getMemory, clearMemory, setState, getState, clearState
};
