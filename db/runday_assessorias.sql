-- Assessorias (running clubs) with a shared 10% discount code, and the
-- single-use courtesy codes they earn (1 per 15 paid registrations).
-- Additive only: existing registrations are untouched.

create table if not exists public.runday_assessorias (
  code         text primary key check (code ~ '^[A-Z0-9-]{3,30}$'),
  nome         text not null,
  responsavel  text,
  whatsapp     text,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.runday_cortesias (
  code             text primary key check (code ~ '^[A-Z0-9-]{6,40}$'),
  assessoria_code  text not null references public.runday_assessorias(code),
  seq              integer not null check (seq >= 1),
  used_order_id    text unique,
  used_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (assessoria_code, seq)   -- the Nth courtesy can only be issued once
);

alter table public.runday_registrations
  add column if not exists assessoria_code text references public.runday_assessorias(code),
  add column if not exists discount_pct    numeric(5, 2) not null default 0,
  add column if not exists list_price      numeric(10, 2),
  add column if not exists cortesia_code   text unique references public.runday_cortesias(code);

create index if not exists runday_registrations_assessoria_idx on public.runday_registrations (assessoria_code);

-- Personal / commercial data: no public access; the service-role key bypasses RLS.
alter table public.runday_assessorias enable row level security;
alter table public.runday_cortesias enable row level security;
