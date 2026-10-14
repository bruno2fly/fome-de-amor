// GET /api/runday/inscritos  (Authorization: Bearer <token from /api/runday/login>)
// Returns every RUN DAY registration plus summary totals for the organizers.
// Contains personal data (CPF, birth dates): never cached.

const auth = require('../_lib/admin-auth');
const store = require('../_lib/store');

function countBy(items, key, order) {
  const counts = Object.fromEntries(order.map((k) => [k, 0]));
  for (const item of items) {
    const k = key(item);
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!auth.isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });

  let registrations;
  try {
    registrations = await store.listOrders();
  } catch (err) {
    console.error('runday inscritos: storage read failed -', err && err.message);
    return res.status(502).json({ error: 'storage_unavailable' });
  }

  const paid = registrations.filter((r) => r.status === 'approved');
  const total = paid.reduce((sum, r) => sum + Number(r.amount_paid != null ? r.amount_paid : r.amount || 0), 0);

  const summary = {
    paidCount: paid.length,
    pendingCount: registrations.filter((r) => r.status === 'pending').length,
    totalCollected: Math.round(total * 100) / 100,
    byPercurso: countBy(paid, (r) => r.percurso, ['4K', '8K', 'KIDS']),
    byPlano: countBy(paid, (r) => r.plano, ['sem-camiseta', 'com-camiseta']),
    byTamanho: countBy(paid.filter((r) => r.plano === 'com-camiseta'), (r) => r.tamanho, ['P', 'M', 'G', 'GG', 'XG'])
  };

  return res.status(200).json({ summary, registrations });
};
