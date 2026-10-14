-- RUN DAY registrations, keyed by the order ID sent to Mercado Pago as external_reference.
-- Written only by the serverless functions using the service-role key.

create table if not exists public.runday_registrations (
  order_id          text primary key,
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'refunded')),
  nome              text not null,
  nascimento        date not null,
  email             text not null,
  cpf               text not null,
  cidade            text not null,
  grupo             text,
  percurso          text not null check (percurso in ('4K', '8K', 'KIDS')),
  plano             text not null check (plano in ('sem-camiseta', 'com-camiseta')),
  tamanho           text check (tamanho in ('P', 'M', 'G', 'GG', 'XG')),
  amount            numeric(10, 2) not null,
  preference_id     text,
  payment_id        text,
  mp_status         text,
  mp_status_detail  text,
  amount_paid       numeric(10, 2),
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists runday_registrations_status_idx on public.runday_registrations (status);
create index if not exists runday_registrations_cpf_idx on public.runday_registrations (cpf);

-- Contains personal data (CPF, birth date): RLS on with no policies, so the
-- public anon key can read or write nothing. The service-role key bypasses RLS.
alter table public.runday_registrations enable row level security;
