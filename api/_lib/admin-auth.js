// Password gate for the RUN DAY organizers' dashboard.
//
// One shared password in the RUNDAY_ADMIN_PASSWORD env var (set in Vercel,
// never committed). Logging in returns a signed token that expires after
// 12 hours; it's signed with a key derived from the password, so changing
// the password logs everyone out.

const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function password() {
  const pw = process.env.RUNDAY_ADMIN_PASSWORD;
  return pw && pw.length >= 8 ? pw : null;
}

function signingKey(pw) {
  return crypto.createHash('sha256').update('runday-inscritos:' + pw).digest();
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function sign(payload, pw) {
  return crypto.createHmac('sha256', signingKey(pw)).update(payload).digest('base64url');
}

/** Returns { token, expiresAt } if the password matches, else null. */
function login(candidate) {
  const pw = password();
  if (!pw || typeof candidate !== 'string') return null;
  // Compare digests so the check takes the same time whatever the length.
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(pw).digest();
  if (!crypto.timingSafeEqual(a, b)) return null;
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url');
  return { token: payload + '.' + sign(payload, pw), expiresAt };
}

/** True if the request carries a valid, unexpired token. */
function isAuthorized(req) {
  const pw = password();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [payload, sig] = token.split('.');
  if (!pw || !payload || !sig || !safeEqual(sig, sign(payload, pw))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch (_) {
    return false;
  }
}

module.exports = { login, isAuthorized, isConfigured: () => Boolean(password()) };
