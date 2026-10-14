// Durable storage for RUN DAY registrations, keyed by order ID.
//
// Backed by a Postgres table reached through Supabase's REST API (PostgREST),
// using plain fetch so there's no extra dependency. Requires two server-only
// env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. To move to another
// store, reimplement these three functions; the API routes only use them.

const TABLE = 'runday_registrations';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Storage is not configured');
  return { base: url.replace(/\/$/, '') + '/rest/v1/' + TABLE, key };
}

async function request(method, query, body, prefer) {
  const { base, key } = config();
  const res = await fetch(base + (query ? '?' + query : ''), {
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
    throw new Error(`Storage ${method} failed with HTTP ${res.status}`);
  }
  return res.status === 204 ? [] : res.json();
}

async function insertOrder(order) {
  const rows = await request('POST', '', order);
  return rows[0];
}

async function getOrder(orderId) {
  const rows = await request('GET', 'order_id=eq.' + encodeURIComponent(orderId) + '&limit=1');
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
    'order_id=eq.' + encodeURIComponent(orderId) +
    '&or=(status.neq.approved,payment_id.is.null,payment_id.eq.' + encodeURIComponent(paymentId) + ')';
  const rows = await request('PATCH', query, patch);
  return rows[0] || null;
}

module.exports = { insertOrder, getOrder, applyPaymentUpdate };
