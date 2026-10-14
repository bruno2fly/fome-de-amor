// POST /api/runday/login  { password } -> { token, expiresAt }
// Gate for the organizers' registrations dashboard (/runday/inscritos).

const auth = require('../_lib/admin-auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!auth.isConfigured()) {
    console.error('runday login: RUNDAY_ADMIN_PASSWORD is not set (or shorter than 8 chars)');
    return res.status(503).json({ error: 'not_configured' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const session = auth.login(body.password);
  if (!session) {
    // Slow down password guessing.
    await new Promise((r) => setTimeout(r, 1000));
    return res.status(401).json({ error: 'invalid_password' });
  }
  return res.status(200).json(session);
};
