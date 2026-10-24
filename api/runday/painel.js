// GET /api/runday/painel?t=<painel_token>
// Read-only progress for one assessoria, opened by its coach from a private
// link. Returns athletes' NAMES and registration details only — never CPF,
// e-mail or birth date (those were given to the organization, not the coach).

const store = require('../_lib/store');
const codes = require('../_lib/codes');
const { SITE_URL } = require('../_lib/registration');

const PLANO = { 'sem-camiseta': 'Sem camiseta', 'com-camiseta': 'Com camiseta' };

function athletesFor(registrations, code) {
  const paidFirst = (r) => (r.status === 'approved' ? 0 : 1);
  return codes.peopleFor(registrations, code)
    .sort((a, b) => paidFirst(a) - paidFirst(b) || a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
    .map((r) => ({
      nome: r.nome,
      percurso: r.percurso,
      kit: PLANO[r.plano] || r.plano,
      tamanho: r.tamanho || null,
      status: r.cortesia_code ? 'cortesia' : r.status === 'approved' ? 'pago' : r.status === 'rejected' ? 'recusado' : 'aguardando',
      data: r.paid_at || r.created_at
    }));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const token = new URL(req.url, 'http://localhost').searchParams.get('t') || '';
  const notFound = async () => {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return res.status(404).json({ error: 'not_found' });
  };
  if (!codes.PAINEL_TOKEN_RE.test(token)) return notFound();

  try {
    const assessoria = await store.getAssessoriaByPainelToken(token);
    if (!assessoria) return notFound();

    const [registrations, cortesiasAll] = await Promise.all([store.listOrders(), store.listCortesias()]);
    // Issue any courtesy this assessoria has earned, so the coach sees it right away.
    const cortesias = (await codes.syncCortesias(registrations, [assessoria], cortesiasAll))
      .filter((c) => c.assessoria_code === assessoria.code);

    const atletas = athletesFor(registrations, assessoria.code);
    const pagos = codes.paidByAssessoria(registrations)[assessoria.code] || 0;

    return res.status(200).json({
      nome: assessoria.nome,
      code: assessoria.code,
      ativo: assessoria.ativo,
      link: `${SITE_URL}/runday?assessoria=${encodeURIComponent(assessoria.code)}#inscricao`,
      desconto: codes.DISCOUNT_PCT,
      cortesiaACada: codes.COURTESY_EVERY,
      pagos,
      aguardando: atletas.filter((a) => a.status === 'aguardando' || a.status === 'recusado').length,
      cortesiasUsadas: atletas.filter((a) => a.status === 'cortesia').length,
      faltamParaProxima: codes.COURTESY_EVERY - (pagos % codes.COURTESY_EVERY),
      cortesias: cortesias.map((c) => ({ code: c.code, usada: Boolean(c.used_order_id) })),
      atletas
    });
  } catch (err) {
    console.error('runday painel: failed -', err && err.message);
    return res.status(502).json({ error: 'unavailable' });
  }
};
