// GET /api/runday/export[?todos=1]  (Authorization: Bearer <token from /api/runday/login>)
// Downloads the RUN DAY registrations as an Excel file (.xlsx) with two sheets:
// "Inscritos" (one row per registrant) and "Resumo" (totals).
// Default: paid registrations only; ?todos=1 includes unpaid checkouts.

const ExcelJS = require('exceljs');
const auth = require('../_lib/admin-auth');
const store = require('../_lib/store');
const { summarize } = require('../_lib/summary');
const codes = require('../_lib/codes');

const RACE_DAY = { y: 2027, m: 2, d: 28 };
const STATUS = { approved: 'Pago', pending: 'Aguardando pagamento', rejected: 'Recusado', refunded: 'Reembolsado' };
const PLANO = { 'sem-camiseta': 'Sem camiseta', 'com-camiseta': 'Com camiseta' };
const GREEN = 'FF1AA864';

// Excel dates carry no timezone, so store Brasília wall-clock time.
const spParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function brasiliaDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(spParts.formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}

function birthDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

function ageOnRaceDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  let age = RACE_DAY.y - +m[1];
  if (RACE_DAY.m < +m[2] || (RACE_DAY.m === +m[2] && RACE_DAY.d < +m[3])) age -= 1;
  return age;
}

function formatCpf(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(cpf || '');
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

async function buildWorkbook(rows, summary, includeUnpaid, assessorias, registrations) {
  const assessoriaName = Object.fromEntries(assessorias.map((a) => [a.code, a.nome]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fome de Amor RUN DAY';
  wb.created = new Date();

  const ws = wb.addWorksheet('Inscritos', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Nome', key: 'nome', width: 32 },
    { header: 'CPF', key: 'cpf', width: 16 },
    { header: 'Nascimento', key: 'nascimento', width: 13, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Idade na corrida', key: 'idade', width: 10 },
    { header: 'E-mail', key: 'email', width: 30 },
    { header: 'Cidade', key: 'cidade', width: 20 },
    { header: 'Grupo de corrida', key: 'grupo', width: 22 },
    { header: 'Percurso', key: 'percurso', width: 10 },
    { header: 'Kit', key: 'kit', width: 15 },
    { header: 'Tamanho', key: 'tamanho', width: 9 },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Valor (R$)', key: 'valor', width: 12, style: { numFmt: '"R$" #,##0.00' } },
    { header: 'Pago em (Brasília)', key: 'pago_em', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Inscrito em (Brasília)', key: 'criado_em', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Código da inscrição', key: 'codigo', width: 18 },
    { header: 'ID pagamento Mercado Pago', key: 'pagamento', width: 22 },
    { header: 'Assessoria', key: 'assessoria', width: 24 },
    { header: 'Código assessoria', key: 'assessoria_code', width: 18 },
    { header: 'Desconto', key: 'desconto', width: 11 },
    { header: 'Código cortesia', key: 'cortesia', width: 22 }
  ];
  styleHeader(ws.getRow(1));

  // Values go in as plain strings/numbers/dates, never formulas: names and
  // other fields come from a public form.
  for (const r of rows) {
    ws.addRow({
      nome: r.nome,
      cpf: formatCpf(r.cpf),
      nascimento: birthDate(r.nascimento),
      idade: ageOnRaceDay(r.nascimento),
      email: r.email,
      cidade: r.cidade,
      grupo: r.grupo || '',
      percurso: r.percurso,
      kit: PLANO[r.plano] || r.plano,
      tamanho: r.tamanho || '',
      status: STATUS[r.status] || r.status,
      valor: Number(r.amount_paid != null ? r.amount_paid : r.amount),
      pago_em: brasiliaDate(r.paid_at),
      criado_em: brasiliaDate(r.created_at),
      codigo: r.order_id,
      pagamento: r.payment_id || '',
      assessoria: r.assessoria_code ? (assessoriaName[r.assessoria_code] || '') : '',
      assessoria_code: r.assessoria_code || '',
      desconto: r.cortesia_code ? 'Cortesia' : Number(r.discount_pct) > 0 ? `${Number(r.discount_pct)}%` : '',
      cortesia: r.cortesia_code || ''
    });
  }
  if (rows.length) ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };

  const rs = wb.addWorksheet('Resumo');
  rs.columns = [{ width: 30 }, { width: 16 }];
  const add = (label, value, fmt) => {
    const row = rs.addRow([label, value]);
    if (fmt) row.getCell(2).numFmt = fmt;
    return row;
  };
  const section = (title) => {
    rs.addRow([]);
    styleHeader(rs.addRow([title, 'Inscritos pagos']));
  };

  styleHeader(rs.addRow(['2ª Corrida Fome de Amor RUN DAY', '']));
  add('Exportado em (Brasília)', brasiliaDate(new Date().toISOString()), 'dd/mm/yyyy hh:mm');
  add('Planilha "Inscritos" contém', includeUnpaid ? 'Todas as inscrições' : 'Apenas pagas');
  add('Inscrições pagas', summary.paidCount);
  add('Aguardando pagamento', summary.pendingCount);
  add('Total arrecadado', summary.totalCollected, '"R$" #,##0.00');
  add('Inscrições cortesia', summary.cortesiaCount);
  section('Por percurso');
  for (const [k, n] of Object.entries(summary.byPercurso)) add(k, n);
  section('Por kit');
  for (const [k, n] of Object.entries(summary.byPlano)) add(PLANO[k] || k, n);
  section('Camisetas por tamanho');
  for (const [k, n] of Object.entries(summary.byTamanho)) add(k, n);

  // Per-assessoria sheet: paid athletes and courtesies.
  const as = wb.addWorksheet('Assessorias', { views: [{ state: 'frozen', ySplit: 1 }] });
  as.columns = [
    { header: 'Assessoria', key: 'nome', width: 28 },
    { header: 'Código', key: 'code', width: 18 },
    { header: 'Responsável', key: 'responsavel', width: 22 },
    { header: 'WhatsApp', key: 'whatsapp', width: 16 },
    { header: 'Inscritos pagos', key: 'pagos', width: 15 },
    { header: 'Cortesias ganhas', key: 'ganhas', width: 16 },
    { header: 'Cortesias usadas', key: 'usadas', width: 16 },
    { header: 'Ativa', key: 'ativo', width: 8 }
  ];
  styleHeader(as.getRow(1));
  const paid = codes.paidByAssessoria(registrations);
  for (const a of assessorias) {
    as.addRow({
      nome: a.nome, code: a.code, responsavel: a.responsavel || '', whatsapp: a.whatsapp || '',
      pagos: paid[a.code] || 0,
      ganhas: Math.floor((paid[a.code] || 0) / codes.COURTESY_EVERY),
      usadas: registrations.filter((r) => r.assessoria_code === a.code && r.cortesia_code && r.status === 'approved').length,
      ativo: a.ativo ? 'Sim' : 'Não'
    });
  }

  return wb.xlsx.writeBuffer();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!auth.isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' });

  let registrations, assessorias;
  try {
    [registrations, assessorias] = await Promise.all([store.listOrders(), store.listAssessorias()]);
  } catch (err) {
    console.error('runday export: storage read failed -', err && err.message);
    return res.status(502).json({ error: 'storage_unavailable' });
  }

  const includeUnpaid = new URL(req.url, 'http://localhost').searchParams.get('todos') === '1';
  const rows = includeUnpaid ? registrations : registrations.filter((r) => r.status === 'approved');
  const buffer = await buildWorkbook(rows, summarize(registrations), includeUnpaid, assessorias, registrations);

  const stamp = brasiliaDate(new Date().toISOString()).toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="inscritos-runday-${stamp}.xlsx"`);
  return res.status(200).send(Buffer.from(buffer));
};
