// POST /api/mercadopago/webhook
// Source of truth for "did they actually pay". Verifies Mercado Pago's
// x-signature, re-fetches the payment from MP (never trusts the notification
// body), and updates the stored order by external_reference, idempotently.

const {
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError
} = require('mercadopago');
const store = require('../_lib/store');

// MP payment status -> our order status.
const STATUS_MAP = {
  approved: 'approved',
  authorized: 'pending',
  pending: 'pending',
  in_process: 'pending',
  in_mediation: 'pending',
  rejected: 'rejected',
  cancelled: 'rejected',
  refunded: 'refunded',
  charged_back: 'refunded'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  // MP_WEBHOOK_SECRET may hold several comma-separated secrets. Test-account
  // payments are signed with the test seller app's secret, while live payments
  // use the main app's secret, so we accept any configured one.
  const secrets = (process.env.MP_WEBHOOK_SECRET || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!secrets.length || !accessToken) {
    console.error('webhook: MP_WEBHOOK_SECRET or MP_ACCESS_TOKEN is not set');
    return res.status(500).end(); // MP retries later
  }

  // MP signs the data.id from the query string; read it from the raw URL so
  // the dotted key isn't mangled by any query parser.
  const params = new URL(req.url, 'http://localhost').searchParams;
  const queryDataId = params.get('data.id');
  // Per MP docs, alphanumeric IDs must be lowercased before signing checks.
  const dataId = queryDataId ? queryDataId.toLowerCase() : null;

  let matchedIndex = -1;
  let lastErr = null;
  for (let i = 0; i < secrets.length; i++) {
    try {
      WebhookSignatureValidator.validate({
        xSignature: req.headers['x-signature'],
        xRequestId: req.headers['x-request-id'],
        dataId,
        secret: secrets[i]
      });
      matchedIndex = i;
      break;
    } catch (err) {
      if (!(err instanceof InvalidWebhookSignatureError)) throw err;
      lastErr = err;
    }
  }
  if (matchedIndex < 0) {
    console.warn('webhook: rejected signature', lastErr && lastErr.reason, 'request', (lastErr && lastErr.requestId) || '-');
    return res.status(401).end();
  }
  console.log('webhook: signature ok (secret #' + matchedIndex + ')');

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const type = body.type || params.get('type') || params.get('topic');
  if (type !== 'payment') {
    return res.status(200).json({ ignored: type || 'unknown' });
  }

  const paymentId = queryDataId || (body.data && String(body.data.id));
  if (!paymentId) return res.status(200).json({ ignored: 'no_id' });

  let payment;
  try {
    const client = new MercadoPagoConfig({ accessToken, options: { timeout: 8000 } });
    payment = await new Payment(client).get({ id: paymentId });
  } catch (err) {
    if (err && (err.status === 404 || err.statusCode === 404)) {
      // e.g. the panel's "simulate" button with a fake ID: nothing to update.
      return res.status(200).json({ ignored: 'payment_not_found' });
    }
    console.error('webhook: could not fetch payment', paymentId, '-', err && (err.message || err.name));
    return res.status(500).end(); // transient: let MP retry
  }

  const orderId = payment.external_reference;
  if (!orderId) {
    // Payments not created by /api/checkout (e.g. old static links).
    return res.status(200).json({ ignored: 'no_external_reference' });
  }

  const status = STATUS_MAP[payment.status] || 'pending';
  try {
    const updated = await store.applyPaymentUpdate(orderId, String(payment.id), {
      status,
      mp_status: payment.status,
      mp_status_detail: payment.status_detail || null,
      payment_id: String(payment.id),
      amount_paid: payment.transaction_amount,
      paid_at: payment.date_approved || null,
      updated_at: new Date().toISOString()
    });

    if (!updated) {
      const existing = await store.getOrder(orderId);
      if (!existing) {
        console.warn('webhook: no stored order for', orderId);
        return res.status(200).json({ ignored: 'unknown_order' });
      }
      // Order is already approved by another payment; keep it.
      return res.status(200).json({ ignored: 'already_approved' });
    }

    console.log('webhook: order', orderId, '->', status, '(payment', String(payment.id) + ')');
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('webhook: storage update failed for', orderId, '-', err && err.message);
    return res.status(500).end(); // let MP retry
  }
};
