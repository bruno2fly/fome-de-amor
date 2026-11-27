-- When the confirmation e-mail was sent (null = not sent yet). Used to send
-- it exactly once, even if Mercado Pago notifies the same payment twice.
alter table public.runday_registrations
  add column if not exists email_confirmacao_at timestamptz;
