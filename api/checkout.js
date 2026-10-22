// POST /api/checkout
// Validates a RUN DAY registration, prices it server-side, creates a Mercado
// Pago Checkout Pro preference, stores the registration as "pending", and
// returns { init_point } for the browser to redirect to.
//
// Optional `codigo`:
//  - assessoria code -> DISCOUNT_PCT off, registration tagged with the assessoria
//  - courtesy code   -> free: claimed atomically, saved as approved, no payment;
//                       returns { redirect } to the confirmation page instead.

const { MercadoPagoConfig, Preference } = require('mercadopago');
const { SITE_URL, PLANS, validateRegistration, newOrderId } = require('./_lib/registration');
const store = require('./_lib/store');
const codes = require('./_lib/codes');

const EVENT_TITLE = '2ª Corrida Fome de Amor RUN DAY';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return null; }
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = readBody(req);
  const result = validateRegistration(body);
  if (!result.ok) {
    return res.status(400).json({ error: 'invalid_fields', fields: result.errors });
  }
  const reg = result.data;

  // Discount / courtesy code (optional). Unknown or used codes are rejected
  // rather than silently ignored, so nobody pays full price by mistake.
  let code = null;
  const rawCode = body && typeof body.codigo === 'string' ? body.codigo.trim() : '';
  if (rawCode) {
    try {
      code = await codes.resolveCode(rawCode);
    } catch (err) {
      console.error('checkout: code lookup failed -', err && err.message);
      return res.status(502).json({ error: 'checkout_failed' });
    }
    if (!code) return res.status(400).json({ error: 'invalid_code', fields: ['codigo'] });
    if (code.tipo === 'usada') return res.status(400).json({ error: 'code_used', fields: ['codigo'] });
  }

  const plan = PLANS[reg.plano];
  const orderId = newOrderId();
  const baseRow = {
    order_id: orderId,
    nome: reg.nome,
    nascimento: reg.nascimento,
    email: reg.email,
    cpf: reg.cpf,
    cidade: reg.cidade,
    grupo: reg.grupo || (code && code.nome) || null,
    percurso: reg.percurso,
    plano: reg.plano,
    tamanho: reg.tamanho,
    list_price: plan.price
  };

  if (code && code.tipo === 'cortesia') {
    return registerCortesia(res, code, baseRow);
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    console.error('checkout: MP_ACCESS_TOKEN is not set');
    return res.status(500).json({ error: 'payment_unavailable' });
  }

  const discountPct = code && code.tipo === 'assessoria' ? code.desconto : 0;
  const price = discountPct ? codes.discountedPrice(plan.price, discountPct) : plan.price;
  const description =
    `Inscrição ${reg.percurso} — ${plan.label}` + (reg.tamanho ? ` (tam. ${reg.tamanho})` : '') +
    (discountPct ? ` — ${discountPct}% assessoria ${code.nome}` : '');

  // Split the full name for the payer block (helps MP's fraud scoring).
  const nameParts = reg.nome.split(/\s+/);
  const firstName = nameParts.shift();
  const lastName = nameParts.join(' ') || undefined;

  try {
    const client = new MercadoPagoConfig({
      accessToken: process.env.MP_ACCESS_TOKEN,
      options: { timeout: 8000 }
    });

    const pref = await new Preference(client).create({
      body: {
        items: [{
          id: `runday-${reg.plano}`,
          title: `${EVENT_TITLE} — ${plan.label}`,
          description,
          category_id: 'tickets',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: price
        }],
        payer: {
          name: firstName,
          surname: lastName,
          email: reg.email,
          identification: { type: 'CPF', number: reg.cpf }
        },
        external_reference: orderId,
        back_urls: {
          success: `${SITE_URL}/runday/pagamento?resultado=sucesso`,
          failure: `${SITE_URL}/runday/pagamento?resultado=falha`,
          pending: `${SITE_URL}/runday/pagamento?resultado=pendente`
        },
        auto_return: 'approved',
        // source_news=webhooks: receive only signed Webhooks, not legacy unsigned IPN.
        notification_url: `${SITE_URL}/api/mercadopago/webhook?source_news=webhooks`,
        statement_descriptor: 'FOMEDEAMOR RUNDAY',
        metadata: { order_id: orderId, assessoria: discountPct ? code.code : null }
      },
      requestOptions: { idempotencyKey: orderId }
    });

    await store.insertOrder({
      ...baseRow,
      status: 'pending',
      amount: price,
      discount_pct: discountPct,
      assessoria_code: discountPct ? code.code : null,
      preference_id: pref.id
    });

    return res.status(200).json({ init_point: pref.init_point, order_id: orderId });
  } catch (err) {
    // Log the failure without request data or credentials.
    console.error('checkout: failed for order', orderId, '-', err && (err.message || err.name));
    return res.status(502).json({ error: 'checkout_failed' });
  }
};

// Free registration with a courtesy code: claim the code first (atomic, so
// two people can't use the same one), then save the registration as approved.
async function registerCortesia(res, code, baseRow) {
  const orderId = baseRow.order_id;
  let claimed;
  try {
    claimed = await store.claimCortesia(code.code, orderId);
  } catch (err) {
    console.error('checkout: courtesy claim failed -', err && err.message);
    return res.status(502).json({ error: 'checkout_failed' });
  }
  if (!claimed) return res.status(400).json({ error: 'code_used', fields: ['codigo'] });

  try {
    const now = new Date().toISOString();
    await store.insertOrder({
      ...baseRow,
      status: 'approved',
      amount: 0,
      amount_paid: 0,
      discount_pct: 100,
      assessoria_code: claimed.assessoria_code,
      cortesia_code: claimed.code,
      mp_status: 'cortesia',
      paid_at: now,
      updated_at: now
    });
  } catch (err) {
    console.error('checkout: courtesy registration failed for', orderId, '-', err && err.message);
    await store.releaseCortesia(claimed.code, orderId).catch(() => {});
    return res.status(502).json({ error: 'checkout_failed' });
  }

  console.log('checkout: courtesy registration', orderId, 'for assessoria', claimed.assessoria_code);
  return res.status(200).json({
    redirect: `/runday/pagamento?resultado=sucesso&cortesia=1&external_reference=${orderId}`,
    order_id: orderId
  });
}
