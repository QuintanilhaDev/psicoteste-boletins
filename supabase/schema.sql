-- Rode uma vez em Supabase → SQL Editor.
-- Uma única linha guarda a cópia dos dados do app. O acesso é só pelo servidor (service role),
-- por isso a tabela fica fechada para chaves públicas (RLS ligado e sem políticas).
create table if not exists public.psico_estado (
  id text primary key,
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.psico_estado enable row level security;
