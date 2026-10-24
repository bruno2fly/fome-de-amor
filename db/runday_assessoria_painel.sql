-- Secret key for each assessoria's private progress page
-- (/runday/assessoria/<painel_token>). Separate from the discount code,
-- which is shared with every athlete. Existing rows get a key from the default.
alter table public.runday_assessorias
  add column if not exists painel_token text not null
    default encode(extensions.gen_random_bytes(16), 'hex')
    check (painel_token ~ '^[a-f0-9]{32}$');

create unique index if not exists runday_assessorias_painel_token_key
  on public.runday_assessorias (painel_token);
