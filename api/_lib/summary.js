// Totals for the organizers' dashboard and Excel export.

function countBy(items, key, order) {
  const counts = Object.fromEntries(order.map((k) => [k, 0]));
  for (const item of items) {
    const k = key(item);
    if (k) counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function summarize(registrations) {
  const paid = registrations.filter((r) => r.status === 'approved');
  const total = paid.reduce((sum, r) => sum + Number(r.amount_paid != null ? r.amount_paid : r.amount || 0), 0);
  return {
    paidCount: paid.length,
    pendingCount: registrations.filter((r) => r.status === 'pending').length,
    totalCollected: Math.round(total * 100) / 100,
    byPercurso: countBy(paid, (r) => r.percurso, ['4K', '8K', 'KIDS']),
    byPlano: countBy(paid, (r) => r.plano, ['sem-camiseta', 'com-camiseta']),
    byTamanho: countBy(paid.filter((r) => r.plano === 'com-camiseta'), (r) => r.tamanho, ['P', 'M', 'G', 'GG', 'XG'])
  };
}

module.exports = { summarize };
