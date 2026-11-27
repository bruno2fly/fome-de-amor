-- Registrations entered by organizers in the dashboard (outside Mercado Pago).
-- Additive: existing rows become origem = 'site'.
alter table public.runday_registrations
  add column if not exists origem text not null default 'site' check (origem in ('site', 'manual')),
  add column if not exists forma_pagamento text
    check (forma_pagamento in ('pix', 'dinheiro', 'cartao', 'transferencia', 'outro', 'gratuita')),
  add column if not exists observacao text;
