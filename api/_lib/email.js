// Registration confirmation e-mail, sent through Resend (https://resend.com).
//
// Env vars (Vercel, server only):
//   RESEND_API_KEY  required to send; without it e-mails are skipped (logged)
//   EMAIL_FROM      default "Fome de Amor RUN DAY <inscricoes@fomedeamor.com.br>"
//   EMAIL_REPLY_TO  default "projetofomedeamor@hotmail.com"
//
// confirmOnce(orderId) sends exactly once per registration: it first claims
// the send in the database (email_confirmacao_at), so duplicate webhook
// deliveries or double clicks can't send twice; if sending fails the claim
// is released so it can be retried.

const store = require('./store');

const SITE = 'https://fomedeamor.com.br';
const RACE = {
  data: '28/02/2027 (domingo)',
  largada: '6h30',
  largadaKids: '8h00',
  local: 'Rua Natal Deretti, s/n, Bairro Nova Esperança, Guaramirim - SC',
  retirada: 'Dia 27/02/2027, a partir das 9h, no Projeto Fome de Amor',
  retiradaOutrasCidades:
    'Atletas de outras cidades podem retirar o kit no dia da prova, das 5h30 às 6h00, no local da prova, ' +
    'mediante solicitação para numberesportes@gmail.com com comprovante de endereço.',
  whatsapp: '47 99995-5258',
  whatsappLink: 'https://wa.me/5547999955258'
};

const PLANO = { 'sem-camiseta': 'Sem camiseta', 'com-camiseta': 'Com camiseta' };
const brl = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function details(r) {
  const free = r.cortesia_code || r.forma_pagamento === 'gratuita';
  return [
    ['Código da inscrição', r.order_id],
    ['Percurso', r.percurso === 'KIDS' ? 'Kids' : r.percurso],
    ['Kit', (PLANO[r.plano] || r.plano) + (r.tamanho ? ` — camiseta tamanho ${r.tamanho}` : '')],
    ['Valor', free ? 'Inscrição cortesia' : brl(r.amount_paid != null ? r.amount_paid : r.amount)]
  ];
}

function buildEmail(r) {
  const firstName = String(r.nome || '').trim().split(/\s+/)[0] || 'atleta';
  const subject = 'Inscrição confirmada — 2ª Corrida Fome de Amor RUN DAY';
  const rows = details(r);
  const largada = r.percurso === 'KIDS' ? `${RACE.largadaKids} (Corrida Kids)` : RACE.largada;

  const text = [
    `Olá, ${firstName}!`,
    '',
    'Sua inscrição na 2ª Corrida Fome de Amor RUN DAY está confirmada. 🎉',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Data: ${RACE.data}`,
    `Largada: ${largada}`,
    `Local: ${RACE.local}`,
    '',
    `Retirada do kit: ${RACE.retirada}.`,
    RACE.retiradaOutrasCidades,
    '',
    `Regulamento: ${SITE}/runday/regulamento`,
    `Dúvidas: WhatsApp ${RACE.whatsapp}`,
    '',
    'Guarde este e-mail. Obrigado por correr com o Fome de Amor!',
    'Associação Fome de Amor · Organização: Number Esportes'
  ].join('\n');

  const detailRows = rows.map(([k, v]) => `
              <tr>
                <td style="padding:8px 0;color:#5b6b61;font-size:14px;width:44%;vertical-align:top;">${esc(k)}</td>
                <td style="padding:8px 0;color:#0b1a12;font-size:14px;font-weight:600;vertical-align:top;">${esc(v)}</td>
              </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef3ef;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">Sua inscrição está confirmada. Nos vemos dia 28/02/2027!</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ef;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#0b1a12;padding:24px 28px;">
          <img src="${SITE}/logo.png" width="72" alt="Fome de Amor" style="display:block;margin-bottom:12px;height:auto;">
          <div style="color:#39d98a;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">2ª Corrida Fome de Amor</div>
          <div style="color:#ffffff;font-size:26px;font-weight:900;line-height:1.2;margin-top:4px;">RUN DAY · Inscrição confirmada ✓</div>
        </td></tr>
        <tr><td style="padding:26px 28px 8px;">
          <p style="margin:0 0 12px;color:#0b1a12;font-size:16px;">Olá, <strong>${esc(firstName)}</strong>!</p>
          <p style="margin:0 0 18px;color:#33433a;font-size:15px;line-height:1.55;">Sua inscrição na <strong>2ª Corrida Fome de Amor RUN DAY</strong> está confirmada. Obrigado por correr com a gente!</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3ebe5;border-bottom:1px solid #e3ebe5;">${detailRows}
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px 6px;">
          <div style="color:#1aa864;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">A prova</div>
          <p style="margin:0 0 6px;color:#33433a;font-size:14px;line-height:1.5;"><strong>Data:</strong> ${esc(RACE.data)}</p>
          <p style="margin:0 0 6px;color:#33433a;font-size:14px;line-height:1.5;"><strong>Largada:</strong> ${esc(largada)}</p>
          <p style="margin:0 0 14px;color:#33433a;font-size:14px;line-height:1.5;"><strong>Local:</strong> ${esc(RACE.local)}</p>
          <div style="color:#1aa864;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Retirada do kit</div>
          <p style="margin:0 0 6px;color:#33433a;font-size:14px;line-height:1.5;">${esc(RACE.retirada)}.</p>
          <p style="margin:0 0 18px;color:#5b6b61;font-size:13px;line-height:1.5;">${esc(RACE.retiradaOutrasCidades)}</p>
        </td></tr>
        <tr><td style="padding:0 28px 26px;">
          <a href="${SITE}/runday/regulamento" style="display:inline-block;background:#1aa864;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:11px 20px;border-radius:50px;margin:0 8px 8px 0;">Ver regulamento</a>
          <a href="${RACE.whatsappLink}" style="display:inline-block;background:#ffffff;color:#1aa864;text-decoration:none;font-weight:bold;font-size:14px;padding:10px 19px;border-radius:50px;border:1px solid #1aa864;margin:0 0 8px;">Dúvidas no WhatsApp</a>
        </td></tr>
        <tr><td style="background:#f6f9f7;padding:16px 28px;color:#7a8a80;font-size:12px;line-height:1.5;">
          Guarde este e-mail. Associação Fome de Amor · Organização: Number Esportes<br>
          <a href="${SITE}/runday" style="color:#7a8a80;">fomedeamor.com.br/runday</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

/** Sends one confirmation e-mail. Returns { sent } or { skipped } or throws. */
async function sendConfirmation(r, idempotencyKey) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('email: RESEND_API_KEY not set; confirmation not sent for', r.order_id);
    return { skipped: 'not_configured' };
  }
  if (!r.email) return { skipped: 'no_email' };

  const { subject, text, html } = buildEmail(r);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey || `confirmacao-${r.order_id}`
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Fome de Amor RUN DAY <inscricoes@fomedeamor.com.br>',
      to: [r.email],
      reply_to: process.env.EMAIL_REPLY_TO || 'projetofomedeamor@hotmail.com',
      subject, text, html
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`Resend responded HTTP ${res.status}`);
  return { sent: true };
}

/**
 * Sends the confirmation for a confirmed registration, once. Never throws
 * (callers are payment flows that must not fail because of e-mail).
 */
async function confirmOnce(orderId) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('email: RESEND_API_KEY not set; skipping confirmation for', orderId);
    return { skipped: 'not_configured' };
  }
  let row;
  try {
    row = await store.claimConfirmationEmail(orderId);
    if (!row) return { skipped: 'already_sent_or_not_confirmed' };
    const out = await sendConfirmation(row);
    if (!out.sent) await store.setConfirmationEmail(orderId, null);
    else console.log('email: confirmation sent for', orderId);
    return out;
  } catch (err) {
    console.error('email: confirmation failed for', orderId, '-', err && err.message);
    if (row) await store.setConfirmationEmail(orderId, null).catch(() => {});
    return { error: true };
  }
}

/**
 * Runs work after the response is sent when the platform supports it
 * (Vercel's waitUntil), so webhooks and redirects stay fast.
 */
function background(promise) {
  try {
    const { waitUntil } = require('@vercel/functions');
    waitUntil(promise);
  } catch (_) {
    promise.catch(() => {});
  }
  return promise;
}

module.exports = { buildEmail, sendConfirmation, confirmOnce, background };
