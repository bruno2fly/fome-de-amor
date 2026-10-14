// GET /api/runday/inscritos  (Authorization: Bearer <token from /api/runday/login>)
// Returns every RUN DAY registration plus summary totals for the organizers.
// Contains personal data (CPF, birth dates): never cached.

const auth = require('../_lib/admin-auth');
const store = require('../_lib/store');
const { summarize } = require('../_lib/summary');

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

  const summary = summarize(registrations);
  return res.status(200).json({ summary, registrations });
};
