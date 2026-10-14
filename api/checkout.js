// POST /api/checkout
// Validates a RUN DAY registration, prices it server-side, creates a Mercado
// Pago Checkout Pro preference, stores the registration as "pending", and
// returns { init_point } for the browser to redirect to.

const { MercadoPagoConfig, Preference } = require('mercadopago');
const { SITE_URL, PLANS, validateRegistration, newOrderId } = require('./_lib/registration');
const store = require('./_lib/store');

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

  if (!process.env.MP_ACCESS_TOKEN) {
    console.error('checkout: MP_ACCESS_TOKEN is not set');
    return res.status(500).json({ error: 'payment_unavailable' });
  }

  const plan = PLANS[reg.plano];
  const orderId = newOrderId();
  const description =
    `Inscrição ${reg.percurso} — ${plan.label}` + (reg.tamanho ? ` (tam. ${reg.tamanho})` : '');

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
          unit_price: plan.price
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
        metadata: { order_id: orderId }
      },
      requestOptions: { idempotencyKey: orderId }
    });

    await store.insertOrder({
      order_id: orderId,
      status: 'pending',
      nome: reg.nome,
      nascimento: reg.nascimento,
      email: reg.email,
      cpf: reg.cpf,
      cidade: reg.cidade,
      grupo: reg.grupo,
      percurso: reg.percurso,
      plano: reg.plano,
      tamanho: reg.tamanho,
      amount: plan.price,
      preference_id: pref.id
    });

    return res.status(200).json({ init_point: pref.init_point, order_id: orderId });
  } catch (err) {
    // Log the failure without request data or credentials.
    console.error('checkout: failed for order', orderId, '-', err && (err.message || err.name));
    return res.status(502).json({ error: 'checkout_failed' });
  }
};
