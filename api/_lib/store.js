// Durable storage for RUN DAY registrations, assessorias and courtesy codes.
//
// Backed by Postgres tables reached through Supabase's REST API (PostgREST),
// using plain fetch so there's no extra dependency. Requires two server-only
// env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

const REGISTRATIONS = 'runday_registrations';
const ASSESSORIAS = 'runday_assessorias';
const CORTESIAS = 'runday_cortesias';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Storage is not configured');
  return { base: url.replace(/\/$/, '') + '/rest/v1/', key };
}

class StorageError extends Error {
  constructor(method, status) {
    super(`Storage ${method} failed with HTTP ${status}`);
    this.status = status;
  }
}

async function request(table, method, query, body, prefer) {
  const { base, key } = config();
  const res = await fetch(base + table + (query ? '?' + query : ''), {
    method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000) // keeps the webhook well inside MP's 22s window
  });
  if (!res.ok) {
    // Don't echo the response body: it can contain row data.
    throw new StorageError(method, res.status);
  }
  return res.status === 204 ? [] : res.json();
}

const eq = (v) => 'eq.' + encodeURIComponent(v);

// ---------- Registrations ----------

async function insertOrder(order) {
  const rows = await request(REGISTRATIONS, 'POST', '', order);
  return rows[0];
}

async function getOrder(orderId) {
  const rows = await request(REGISTRATIONS, 'GET', 'order_id=' + eq(orderId) + '&limit=1');
  return rows[0] || null;
}

/**
 * Applies a payment update to an order, idempotently.
 *
 * The update is skipped when the order is already approved by a *different*
 * payment, so a late notification for an earlier rejected attempt can never
 * overwrite a confirmed payment. Re-applying the same notification just
 * writes the same values again. Returns the updated row, or null if skipped.
 */
async function applyPaymentUpdate(orderId, paymentId, patch) {
  const query =
    'order_id=' + eq(orderId) +
    '&or=(status.neq.approved,payment_id.is.null,payment_id.eq.' + encodeURIComponent(paymentId) + ')';
  const rows = await request(REGISTRATIONS, 'PATCH', query, patch);
  return rows[0] || null;
}

// All registrations, newest first (for the organizers' dashboard).
async function listOrders() {
  const columns = [
    'order_id', 'status', 'nome', 'nascimento', 'email', 'cpf', 'cidade', 'grupo',
    'percurso', 'plano', 'tamanho', 'amount', 'amount_paid', 'payment_id', 'paid_at', 'created_at',
    'assessoria_code', 'discount_pct', 'list_price', 'cortesia_code'
  ].join(',');
  return request(REGISTRATIONS, 'GET', 'select=' + columns + '&order=created_at.desc');
}

// ---------- Assessorias ----------

async function getAssessoria(code) {
  const rows = await request(ASSESSORIAS, 'GET', 'code=' + eq(code) + '&limit=1');
  return rows[0] || null;
}

async function listAssessorias() {
  return request(ASSESSORIAS, 'GET', 'select=*&order=created_at.desc');
}

/** Inserts an assessoria; returns null if the code is already taken. */
async function insertAssessoria(row) {
  try {
    const rows = await request(ASSESSORIAS, 'POST', '', row);
    return rows[0];
  } catch (err) {
    if (err.status === 409) return null;
    throw err;
  }
}

async function getAssessoriaByPainelToken(token) {
  const rows = await request(ASSESSORIAS, 'GET', 'painel_token=' + eq(token) + '&limit=1');
  return rows[0] || null;
}

/** Replaces an assessoria's progress-page key (the old link stops working). */
async function setPainelToken(code, token) {
  const rows = await request(ASSESSORIAS, 'PATCH', 'code=' + eq(code), { painel_token: token });
  return rows[0] || null;
}

async function setAssessoriaAtivo(code, ativo) {
  const rows = await request(ASSESSORIAS, 'PATCH', 'code=' + eq(code), { ativo: Boolean(ativo) });
  return rows[0] || null;
}

// ---------- Courtesy codes ----------

async function getCortesia(code) {
  const rows = await request(CORTESIAS, 'GET', 'code=' + eq(code) + '&limit=1');
  return rows[0] || null;
}

async function listCortesias() {
  return request(CORTESIAS, 'GET', 'select=*&order=assessoria_code.asc,seq.asc');
}

/**
 * Issues the Nth courtesy for an assessoria. The (assessoria_code, seq)
 * unique constraint makes this safe to call repeatedly or concurrently:
 * if that courtesy already exists, nothing happens and null is returned.
 */
async function issueCortesia(row) {
  const rows = await request(
    CORTESIAS, 'POST', 'on_conflict=assessoria_code,seq', row,
    'return=representation,resolution=ignore-duplicates'
  );
  return rows[0] || null;
}

/**
 * Atomically claims an unused courtesy code for an order. Returns the
 * claimed row, or null if the code doesn't exist or was already used.
 */
async function claimCortesia(code, orderId) {
  const rows = await request(
    CORTESIAS, 'PATCH', 'code=' + eq(code) + '&used_order_id=is.null',
    { used_order_id: orderId, used_at: new Date().toISOString() }
  );
  return rows[0] || null;
}

/** Undoes a claim (used when saving the registration fails afterwards). */
async function releaseCortesia(code, orderId) {
  await request(CORTESIAS, 'PATCH', 'code=' + eq(code) + '&used_order_id=' + eq(orderId),
    { used_order_id: null, used_at: null }, 'return=minimal');
}

module.exports = {
  insertOrder, getOrder, applyPaymentUpdate, listOrders,
  getAssessoria, listAssessorias, insertAssessoria, setAssessoriaAtivo,
  getAssessoriaByPainelToken, setPainelToken,
  getCortesia, listCortesias, issueCortesia, claimCortesia, releaseCortesia
};
