-- Adds shirt sizes 8 (infantil) and PP. Widening only: existing rows stay valid.
alter table public.runday_registrations drop constraint if exists runday_registrations_tamanho_check;
alter table public.runday_registrations add constraint runday_registrations_tamanho_check
  check (tamanho in ('8', 'PP', 'P', 'M', 'G', 'GG', 'XG'));
