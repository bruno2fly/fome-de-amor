// POST /api/runday/manual  (Authorization: Bearer <token from /api/runday/login>)
// Organizers register someone by hand (in person, Pix, cash…), outside Mercado Pago.
// Body: the same fields as the public form, plus
//   pagamento: 'pago' | 'gratuita'
//   forma:     'pix' | 'dinheiro' | 'cartao' | 'transferencia' | 'outro'   (when pago)
//   valor:     amount received in R$ (when pago; defaults to the current price)
//   assessoria (optional code), observacao (optional), confirmarDuplicado (bool)
// Saved straight away as approved, origem = 'manual'.

const auth = require('../_lib/admin-auth');
const store = require('../_lib/store');
const codes = require('../_lib/codes');
const { priceFor, validateRegistration, newOrderId } = require('../_lib/registration');

const FORMAS = ['pix', 'dinheiro', 'cartao', 'transferencia', 'outro'];

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

/** Accepts 29.9, "29,90", "R$ 1.234,50". Returns a number with 2 decimals, or null. */
function parseValor(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  let t = v.replace(/[R$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!auth.isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });

  const body = readBody(req);
  const result = validateRegistration(body);
  const fields = result.ok ? [] : [...result.errors];

  const pagamento = body.pagamento;
  if (pagamento !== 'pago' && pagamento !== 'gratuita') fields.push('pagamento');
  const forma = pagamento === 'pago' ? String(body.forma || '') : 'gratuita';
  if (pagamento === 'pago' && !FORMAS.includes(forma)) fields.push('forma');

  let valor = null;
  if (pagamento === 'pago' && body.valor !== undefined && body.valor !== null && body.valor !== '') {
    valor = parseValor(body.valor);
    if (valor === null || valor <= 0 || valor > 10000) fields.push('valor');
  }

  const observacao = typeof body.observacao === 'string' ? body.observacao.trim().slice(0, 300) || null : null;
  if (fields.length) return res.status(400).json({ error: 'invalid_fields', fields });
  const reg = result.data;

  try {
    let assessoria = null;
    if (body.assessoria) {
      const code = codes.normalizeCode(body.assessoria);
      assessoria = code ? await store.getAssessoria(code) : null;
      if (!assessoria) return res.status(400).json({ error: 'invalid_fields', fields: ['assessoria'] });
    }

    if (body.confirmarDuplicado !== true) {
      const existing = await store.findApprovedByCpf(reg.cpf);
      if (existing.length) {
        return res.status(409).json({
          error: 'duplicate',
          existing: existing.map((e) => ({ nome: e.nome, percurso: e.percurso, origem: e.origem, created_at: e.created_at }))
        });
      }
    }

    const listPrice = priceFor(reg.plano, reg.percurso);
    const discountPct = pagamento === 'gratuita' ? 100 : assessoria ? codes.DISCOUNT_PCT : 0;
    const suggested = assessoria ? codes.discountedPrice(listPrice, codes.DISCOUNT_PCT) : listPrice;
    const amount = pagamento === 'gratuita' ? 0 : valor !== null ? valor : suggested;
    const now = new Date().toISOString();
    const orderId = newOrderId();

    await store.insertOrder({
      order_id: orderId,
      status: 'approved',
      origem: 'manual',
      forma_pagamento: forma,
      observacao,
      nome: reg.nome,
      nascimento: reg.nascimento,
      email: reg.email,
      cpf: reg.cpf,
      cidade: reg.cidade,
      grupo: reg.grupo || (assessoria && assessoria.nome) || null,
      percurso: reg.percurso,
      plano: reg.plano,
      tamanho: reg.tamanho,
      list_price: listPrice,
      discount_pct: discountPct,
      assessoria_code: assessoria ? assessoria.code : null,
      amount,
      amount_paid: amount,
      mp_status: 'manual',
      paid_at: now,
      updated_at: now
    });

    console.log('runday manual: registered', orderId, pagamento, forma);
    return res.status(201).json({ order_id: orderId, nome: reg.nome, amount });
  } catch (err) {
    console.error('runday manual: failed -', err && err.message);
    return res.status(502).json({ error: 'storage_unavailable' });
  }
};
