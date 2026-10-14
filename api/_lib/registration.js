// Server-side source of truth for RUN DAY pricing and registration validation.
// Files under api/_lib are helpers, not routes (Vercel skips "_"-prefixed paths).

const SITE_URL = 'https://fomedeamor.com.br';

// Prices in BRL. Never accept a price from the client.
const PLANS = {
  'sem-camiseta': { price: 69.9, label: 'Kit sem camiseta' },
  'com-camiseta': { price: 89.9, label: 'Kit com camiseta' }
};

const PERCURSOS = ['4K', '8K', 'KIDS'];
const TAMANHOS = ['P', 'M', 'G', 'GG', 'XG'];

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function isValidCPF(raw) {
  const cpf = String(raw || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function isValidDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return false;
  const year = d.getUTCFullYear();
  return year >= 1900 && d.getTime() <= Date.now();
}

/**
 * Validates and normalises the form payload.
 * Returns { ok: true, data } or { ok: false, errors: [fieldName, ...] }.
 */
function validateRegistration(body) {
  const b = body && typeof body === 'object' ? body : {};
  const data = {
    nome: str(b.nome, 120),
    nascimento: str(b.nascimento, 10),
    email: str(b.email, 160).toLowerCase(),
    cpf: str(b.cpf, 14).replace(/\D/g, ''),
    cidade: str(b.cidade, 120),
    grupo: str(b.grupo, 120) || null,
    percurso: str(b.percurso, 10),
    plano: str(b.plano, 20),
    tamanho: str(b.tamanho, 4) || null
  };

  const errors = [];
  if (data.nome.length < 3) errors.push('nome');
  if (!isValidDate(data.nascimento)) errors.push('nascimento');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('email');
  if (!isValidCPF(data.cpf)) errors.push('cpf');
  if (data.cidade.length < 2) errors.push('cidade');
  if (!PERCURSOS.includes(data.percurso)) errors.push('percurso');
  if (!PLANS[data.plano]) errors.push('plano');

  if (data.plano === 'com-camiseta') {
    if (!TAMANHOS.includes(data.tamanho)) errors.push('tamanho');
  } else {
    data.tamanho = null; // size only applies to the shirt kit
  }

  return errors.length ? { ok: false, errors } : { ok: true, data };
}

// Order IDs look like RD27-7K3F9QX2MZ (unambiguous chars, ~50 bits of entropy).
function newOrderId() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = require('crypto').randomBytes(10);
  let id = '';
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return 'RD27-' + id;
}

module.exports = { SITE_URL, PLANS, validateRegistration, newOrderId, isValidCPF };
