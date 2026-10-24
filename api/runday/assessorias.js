// /api/runday/assessorias  (Authorization: Bearer <token from /api/runday/login>)
//   GET   -> every assessoria with its counts and courtesy codes. Issues any
//            courtesy codes earned since last time (1 per 15 paid).
//   POST  { nome, responsavel?, whatsapp?, codigo? } -> creates an assessoria.
//            codigo is optional; one is generated from the name if omitted.
//   PATCH { codigo, ativo } -> activates / deactivates a code.
//   PATCH { codigo, novoPainel: true } -> new progress-page link (old one stops working).

const auth = require('../_lib/admin-auth');
const store = require('../_lib/store');
const codes = require('../_lib/codes');
const { SITE_URL } = require('../_lib/registration');

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function shareLink(code) {
  return `${SITE_URL}/runday?assessoria=${encodeURIComponent(code)}#inscricao`;
}

function painelLink(token) {
  return token ? `${SITE_URL}/runday/assessoria/${token}` : null;
}

async function list(res) {
  const [registrations, assessorias, cortesiasBefore] = await Promise.all([
    store.listOrders(), store.listAssessorias(), store.listCortesias()
  ]);
  const cortesias = await codes.syncCortesias(registrations, assessorias, cortesiasBefore);
  const paid = codes.paidByAssessoria(registrations);

  const rows = assessorias.map((a) => {
    const mine = registrations.filter((r) => r.assessoria_code === a.code);
    const pagos = paid[a.code] || 0;
    const myCortesias = cortesias.filter((c) => c.assessoria_code === a.code);
    return {
      code: a.code,
      nome: a.nome,
      responsavel: a.responsavel,
      whatsapp: a.whatsapp,
      ativo: a.ativo,
      created_at: a.created_at,
      link: shareLink(a.code),
      painelLink: painelLink(a.painel_token),
      pagos,
      // People who started but haven't paid (one per person, same as the coach's page).
      pendentes: codes.peopleFor(registrations, a.code).filter((r) => r.status === 'pending' || r.status === 'rejected').length,
      cortesiasUsadas: mine.filter((r) => r.cortesia_code && r.status === 'approved').length,
      faltamParaProxima: codes.COURTESY_EVERY - (pagos % codes.COURTESY_EVERY),
      cortesias: myCortesias.map((c) => ({
        code: c.code, seq: c.seq, usada: Boolean(c.used_order_id), used_at: c.used_at
      }))
    };
  }).sort((x, y) => y.pagos - x.pagos || x.nome.localeCompare(y.nome, 'pt-BR'));

  return res.status(200).json({
    desconto: codes.DISCOUNT_PCT,
    cortesiaACada: codes.COURTESY_EVERY,
    assessorias: rows
  });
}

async function create(req, res) {
  const body = readBody(req);
  const nome = str(body.nome, 80);
  const responsavel = str(body.responsavel, 80) || null;
  const whatsapp = str(body.whatsapp, 20).replace(/\D/g, '') || null;

  const fields = [];
  if (nome.length < 2) fields.push('nome');
  if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 13)) fields.push('whatsapp');

  let custom = null;
  if (str(body.codigo, 40)) {
    custom = codes.normalizeCode(body.codigo);
    // Courtesy codes live in the same namespace at checkout.
    if (!custom || custom.length > 30 || custom.startsWith('CORTESIA')) fields.push('codigo');
  }
  if (fields.length) return res.status(400).json({ error: 'invalid_fields', fields });

  const row = { nome, responsavel, whatsapp, ativo: true, painel_token: codes.newPainelToken() };

  if (custom) {
    const created = await store.insertAssessoria({ ...row, code: custom });
    if (!created) return res.status(409).json({ error: 'code_taken', fields: ['codigo'] });
    return res.status(201).json(publicRow(created));
  }

  // Auto-generated: NAME, then NAME2, NAME3… until one is free.
  const base = codes.codeFromName(nome);
  for (let n = 1; n <= 50; n++) {
    const code = n === 1 ? base : `${base.slice(0, 28)}${n}`;
    const created = await store.insertAssessoria({ ...row, code });
    if (created) return res.status(201).json(publicRow(created));
  }
  return res.status(409).json({ error: 'code_taken', fields: ['codigo'] });
}

function publicRow(a) {
  const { painel_token, ...rest } = a;
  return { ...rest, link: shareLink(a.code), painelLink: painelLink(painel_token) };
}

async function update(req, res) {
  const body = readBody(req);
  const code = codes.normalizeCode(body.codigo);
  if (!code) return res.status(400).json({ error: 'invalid_fields' });

  let updated;
  if (body.novoPainel === true) updated = await store.setPainelToken(code, codes.newPainelToken());
  else if (typeof body.ativo === 'boolean') updated = await store.setAssessoriaAtivo(code, body.ativo);
  else return res.status(400).json({ error: 'invalid_fields' });

  if (!updated) return res.status(404).json({ error: 'not_found' });
  return res.status(200).json(publicRow(updated));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!auth.isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    if (req.method === 'GET') return await list(res);
    if (req.method === 'POST') return await create(req, res);
    if (req.method === 'PATCH') return await update(req, res);
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('runday assessorias:', req.method, 'failed -', err && err.message);
    return res.status(502).json({ error: 'storage_unavailable' });
  }
};
