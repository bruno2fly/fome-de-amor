// POST /api/runday/email  (Authorization: Bearer <token from /api/runday/login>)
//   { order_id }        -> (re)sends the confirmation e-mail to one confirmed registration
//   { pendentes: true } -> sends to confirmed registrations that never got one,
//                          a few per call (the dashboard calls again until remaining = 0)

const auth = require('../_lib/admin-auth');
const store = require('../_lib/store');
const email = require('../_lib/email');

const BATCH = 5; // keeps each call well inside the function time limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!auth.isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ error: 'not_configured' });

  const body = readBody(req);
  try {
    if (typeof body.order_id === 'string' && /^RD27-[A-Z0-9]{10}$/.test(body.order_id)) {
      const row = await store.getOrder(body.order_id);
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (row.status !== 'approved') return res.status(400).json({ error: 'not_confirmed' });
      // Deliberate resend: new idempotency key so Resend doesn't dedupe it.
      await email.sendConfirmation(row, `reenvio-${row.order_id}-${Date.now()}`);
      const when = new Date().toISOString();
      await store.setConfirmationEmail(row.order_id, when);
      return res.status(200).json({ ok: true, email_confirmacao_at: when });
    }

    if (body.pendentes === true) {
      const batch = await store.listUnconfirmedEmails(BATCH);
      let sent = 0, failed = 0;
      for (const { order_id } of batch) {
        const out = await email.confirmOnce(order_id);
        if (out.sent) sent++; else if (out.error) failed++;
        await sleep(550); // stay under Resend's 2 requests/second
      }
      const remaining = (await store.listUnconfirmedEmails(1000)).length;
      return res.status(200).json({ sent, failed, remaining });
    }

    return res.status(400).json({ error: 'invalid_fields' });
  } catch (err) {
    console.error('runday email: failed -', err && err.message);
    return res.status(502).json({ error: 'send_failed', detail: (err && err.resendMessage) || '' });
  }
};
