// GET /api/runday/codigo?c=CODE
// Lets the registration form check a code and preview the price before paying.
// The checkout re-validates the code itself; this is display-only.
//   200 { tipo: 'assessoria', nome, desconto } | { tipo: 'cortesia', nome }
//   404 { error: 'invalid_code' } | 409 { error: 'code_used' }

const codes = require('../_lib/codes');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const raw = new URL(req.url, 'http://localhost').searchParams.get('c') || '';

  let found;
  try {
    found = await codes.resolveCode(raw);
  } catch (err) {
    console.error('runday codigo: lookup failed -', err && err.message);
    return res.status(502).json({ error: 'unavailable' });
  }
  if (!found) {
    await new Promise((r) => setTimeout(r, 400)); // slow down code guessing
    return res.status(404).json({ error: 'invalid_code' });
  }
  if (found.tipo === 'usada') return res.status(409).json({ error: 'code_used' });
  if (found.tipo === 'assessoria') {
    return res.status(200).json({ tipo: 'assessoria', code: found.code, nome: found.nome, desconto: found.desconto });
  }
  return res.status(200).json({ tipo: 'cortesia', code: found.code, nome: found.nome });
};
