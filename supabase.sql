-- =============================================================================
-- Painel de Votação em Tempo Real — schema do banco
-- =============================================================================
-- Roda este script inteiro no SQL Editor do Supabase (uma vez por projeto).
-- Cria as tabelas, configura RLS, habilita realtime e popula as opções iniciais.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela `opcoes` — alternativas da enquete
-- -----------------------------------------------------------------------------
create table if not exists public.opcoes (
  id        bigserial primary key,
  texto     text      not null,
  ordem     int       not null default 0,
  criado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Tabela `votos` — uma linha por voto
-- -----------------------------------------------------------------------------
-- Decisão: 1 linha por voto (em vez de contador denormalizado em `opcoes`).
-- Motivo: auditável, realtime via INSERT é mais natural que UPDATE,
--          e a unique em `voter_hash` impede voto duplo no nível do banco.
-- -----------------------------------------------------------------------------
create table if not exists public.votos (
  id          bigserial primary key,
  opcao_id    bigint    not null references public.opcoes(id) on delete cascade,
  voter_hash  text      not null,
  criado_em   timestamptz not null default now(),
  unique (voter_hash)
);

create index if not exists votos_opcao_idx on public.votos(opcao_id);

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS)
-- -----------------------------------------------------------------------------
-- Anon key vai pro front. RLS protege o banco:
--   - opcoes: leitura pública, sem escrita.
--   - votos:  leitura pública, INSERT público (voto), sem UPDATE/DELETE.
-- -----------------------------------------------------------------------------
alter table public.opcoes enable row level security;
alter table public.votos  enable row level security;

drop policy if exists "leitura publica de opcoes" on public.opcoes;
create policy "leitura publica de opcoes"
  on public.opcoes for select using (true);

drop policy if exists "leitura publica de votos" on public.votos;
create policy "leitura publica de votos"
  on public.votos for select using (true);

drop policy if exists "qualquer um pode votar" on public.votos;
create policy "qualquer um pode votar"
  on public.votos for insert with check (true);

-- -----------------------------------------------------------------------------
-- Realtime — habilita publicação de mudanças em `votos`
-- -----------------------------------------------------------------------------
-- Sem isso, o canal `postgres_changes` não recebe nada da tabela `votos`.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from   pg_publication_tables
    where  pubname = 'supabase_realtime'
    and    schemaname = 'public'
    and    tablename = 'votos'
  ) then
    alter publication supabase_realtime add table public.votos;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Seed — opções iniciais (idempotente: roda quando a tabela está vazia)
-- -----------------------------------------------------------------------------
insert into public.opcoes (texto, ordem)
select v.texto, v.ordem
from (values
  ('JavaScript / TypeScript', 1),
  ('Python',                  2),
  ('Go',                      3),
  ('Rust',                    4)
) as v(texto, ordem)
where not exists (select 1 from public.opcoes);
