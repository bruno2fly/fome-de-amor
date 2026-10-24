// Assessoria discount codes and courtesy (free registration) codes.
//
// - Assessoria code: shared by a running club with its athletes; gives
//   DISCOUNT_PCT off the registration price, every time.
// - Courtesy code: single use, free registration. An assessoria earns one
//   for every COURTESY_EVERY paid registrations made with its code
//   (courtesy registrations themselves don't count toward the next one).

const crypto = require('crypto');
const store = require('./store');

const DISCOUNT_PCT = 10;
const COURTESY_EVERY = 15;
const CODE_RE = /^[A-Z0-9-]{3,40}$/;

/** Uppercases, strips accents/spaces. Returns null if not a plausible code. */
function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, '');
  return CODE_RE.test(code) ? code : null;
}

/** Price after a percentage discount, rounded to centavos. */
function discountedPrice(price, pct) {
  return Math.round(price * (100 - pct)) / 100;
}

/** Suggested assessoria code from its name, e.g. "Assessoria Run+ XYZ" -> "RUNXYZ". */
function codeFromName(nome) {
  const base = String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\b(ASSESSORIA|ASSESSORIAS|GRUPO|GRUPOS|EQUIPE|EQUIPES|TEAM|CLUBE|DE|DA|DO|DAS|DOS|E)\b/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : 'ASSESSORIA';
}

function randomChars(n) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
  let out = '';
  for (const b of crypto.randomBytes(n)) out += alphabet[b % alphabet.length];
  return out;
}

/** Secret key for an assessoria's private progress page (32 hex chars). */
function newPainelToken() {
  return crypto.randomBytes(16).toString('hex');
}
const PAINEL_TOKEN_RE = /^[a-f0-9]{32}$/;

/** Unguessable single-use courtesy code, e.g. CORTESIA-7K3F9QX2MZ. */
function newCortesiaCode() {
  return 'CORTESIA-' + randomChars(10);
}

/**
 * Resolves a code typed at checkout.
 * Returns { tipo: 'assessoria', code, nome, desconto } | { tipo: 'cortesia', code, assessoria_code, nome }
 *       | { tipo: 'usada' } (courtesy already used) | null (unknown / inactive).
 */
async function resolveCode(raw) {
  const code = normalizeCode(raw);
  if (!code) return null;

  const assessoria = await store.getAssessoria(code);
  if (assessoria) {
    return assessoria.ativo
      ? { tipo: 'assessoria', code, nome: assessoria.nome, desconto: DISCOUNT_PCT }
      : null;
  }

  const cortesia = await store.getCortesia(code);
  if (!cortesia) return null;
  if (cortesia.used_order_id) return { tipo: 'usada' };
  const owner = await store.getAssessoria(cortesia.assessoria_code);
  return { tipo: 'cortesia', code, assessoria_code: cortesia.assessoria_code, nome: owner ? owner.nome : '' };
}

/** Paid registrations that count toward courtesies, per assessoria code. */
function paidByAssessoria(registrations) {
  const counts = {};
  for (const r of registrations) {
    if (r.status === 'approved' && r.assessoria_code && !r.cortesia_code) {
      counts[r.assessoria_code] = (counts[r.assessoria_code] || 0) + 1;
    }
  }
  return counts;
}

/**
 * One registration per person (grouped by CPF) for an assessoria: the paid
 * one if any, otherwise the latest attempt. Refunded ones are left out.
 */
function peopleFor(registrations, code) {
  const rank = (r) => (r.status === 'approved' ? 1 : 0);
  const byPerson = new Map();
  for (const r of registrations) {
    if (r.assessoria_code !== code || r.status === 'refunded') continue;
    const prev = byPerson.get(r.cpf);
    if (!prev || rank(r) > rank(prev) || (rank(r) === rank(prev) && r.created_at > prev.created_at)) {
      byPerson.set(r.cpf, r);
    }
  }
  return [...byPerson.values()];
}

/**
 * Issues any courtesy codes assessorias have earned but not yet received.
 * Safe to run repeatedly/concurrently (see store.issueCortesia).
 * Returns the full, up-to-date list of courtesy codes.
 */
async function syncCortesias(registrations, assessorias, cortesias) {
  const paid = paidByAssessoria(registrations);
  const issuedSeqs = {};
  for (const c of cortesias) (issuedSeqs[c.assessoria_code] ||= new Set()).add(c.seq);

  let issuedAny = false;
  for (const a of assessorias) {
    const earned = Math.floor((paid[a.code] || 0) / COURTESY_EVERY);
    for (let seq = 1; seq <= earned; seq++) {
      if (issuedSeqs[a.code] && issuedSeqs[a.code].has(seq)) continue;
      await store.issueCortesia({ code: newCortesiaCode(), assessoria_code: a.code, seq });
      issuedAny = true;
    }
  }
  return issuedAny ? store.listCortesias() : cortesias;
}

module.exports = {
  DISCOUNT_PCT, COURTESY_EVERY,
  normalizeCode, discountedPrice, codeFromName, newCortesiaCode, newPainelToken, PAINEL_TOKEN_RE,
  resolveCode, paidByAssessoria, peopleFor, syncCortesias
};
