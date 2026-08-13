-- =====================================================================
-- tintin. — schema Supabase (Postgres)
-- =====================================================================
-- Este arquivo cria toda a estrutura de banco necessária para o tintin.
-- funcionar como produto multi-usuário, com autenticação e isolamento
-- de dados via Row Level Security (RLS).
--
-- Como rodar: Supabase Dashboard → SQL Editor → cole este arquivo → Run.
-- (ou via CLI: supabase db push, se estiver usando migrations locais)
-- =====================================================================

create extension if not exists "uuid-ossp";

-- =====================================================================
-- 1. PROFILES
-- Estende a tabela auth.users (gerenciada pelo Supabase Auth) com dados
-- específicos do app. Um profile é criado automaticamente no signup
-- (ver trigger no final do arquivo).
-- =====================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  invested_base numeric(12,2) not null default 0,
  -- ponto de partida do "Valor Investido" (equivalente ao antigo
  -- state.investedBase) — a partir daqui, os aportes/rendimentos
  -- calculados em runtime vão sendo somados em cima disso.
  onboarding_completed boolean not null default true,
  -- controla se a pessoa já passou pelo wizard de "primeiros passos".
  -- default true aqui é só pra instalações novas do zero; o trigger
  -- handle_new_user() abaixo insere false explicitamente pra cada
  -- conta nova, que é o caso que realmente importa em produção.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "usuário vê e edita só o próprio perfil"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- =====================================================================
-- 2. CATEGORIES
-- Diferente do protótipo (onde categoria era uma string solta repetida
-- em cada lançamento), aqui vira uma tabela de verdade. Isso resolve de
-- graça o problema de "renomear categoria = atualizar N linhas na mão"
-- que tivemos várias vezes no app em HTML/JS.
-- =====================================================================
create table public.categories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('despesa','receita')),
  color text, -- hex, ex: '#F4622C' — deixa o usuário escolher a cor (item #7 da lista de UX que discutimos)
  is_investimento boolean not null default false,
  -- marca a categoria especial "Investimento" (usada no cálculo do Valor Investido)
  is_rendimento boolean not null default false,
  -- marca categorias tipo "Rendimento" que somam automático no Valor Investido
  -- sem entrar na conta de "economia do mês" (equivalente ao que hoje é
  -- hardcoded pelo nome "Rendimento" no app em HTML — aqui vira flag configurável)
  created_at timestamptz not null default now(),
  unique (user_id, name, type)
);

alter table public.categories enable row level security;

create policy "usuário só mexe nas próprias categorias"
  on public.categories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index idx_categories_user on public.categories(user_id);

-- =====================================================================
-- 3. TRANSACTIONS  (equivalente à aba "Realizado")
-- Lançamentos reais, já acontecidos.
-- =====================================================================
create table public.transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  date date not null,
  description text not null,
  type text not null check (type in ('despesa','receita')),
  amount numeric(12,2) not null check (amount >= 0),
  tags text[] not null default '{}',
  recurring_id uuid, -- agrupa ocorrências de um lançamento repetido (equivalente ao antigo recurringId)
  created_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

create policy "usuário só mexe nos próprios lançamentos"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index idx_transactions_user_date on public.transactions(user_id, date);
create index idx_transactions_category on public.transactions(category_id);

-- =====================================================================
-- 4. BUDGET_ITEMS  (equivalente à aba "Previsto")
-- Despesas/receitas previstas — o coração do método (o teto do mês
-- seguinte é definido aqui).
-- =====================================================================
create table public.budget_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  type text not null check (type in ('despesa','receita')),
  month text not null check (month ~ '^\d{4}-\d{2}$'), -- formato 'YYYY-MM'
  date date, -- nulo quando is_variable = true (orçamento do mês, sem dia fixo — ex: Lazer, Mercado)
  is_variable boolean not null default false,
  is_paid boolean not null default false,
  -- quando marcado como pago, gera um registro em `transactions` e continua
  -- contando no teto do mês, mas some das visões de "ainda pendente"
  paid_transaction_id uuid references public.transactions(id) on delete set null,
  series_id uuid, -- agrupa ocorrências de uma previsão que se repete por N meses
  series_index int,
  series_total int,
  created_at timestamptz not null default now()
);

alter table public.budget_items enable row level security;

create policy "usuário só mexe na própria previsão"
  on public.budget_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index idx_budget_items_user_month on public.budget_items(user_id, month);
create index idx_budget_items_user_date on public.budget_items(user_id, date);
create index idx_budget_items_category on public.budget_items(category_id);
create index idx_budget_items_series on public.budget_items(series_id);

-- =====================================================================
-- 5. SALDO_INICIAL_OVERRIDES
-- Ajuste manual do "saldo inicial" de um mês específico (equivalente
-- ao campo editável no Mapa). Quando não existe linha aqui pro mês,
-- o app calcula automático como soma de budget_items.
-- =====================================================================
create table public.saldo_inicial_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  value numeric(12,2) not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.saldo_inicial_overrides enable row level security;

create policy "usuário só mexe nos próprios overrides"
  on public.saldo_inicial_overrides for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- 6. CLOSED_MONTHS
-- Histórico de fechamentos de mês (o botão "fechar mês e investir a
-- sobra"). Guardamos o valor gerado pra auditoria/relatório histórico.
-- =====================================================================
create table public.closed_months (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  aporte_amount numeric(12,2) not null, -- positivo = aporte, negativo = resgate
  overrun_amount numeric(12,2) not null default 0, -- quanto estourou o pote naquele mês, se estourou
  closed_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.closed_months enable row level security;

create policy "usuário só vê os próprios fechamentos"
  on public.closed_months for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- 7. DISMISSED_REMINDERS
-- Controla o popup de "contas previstas pra hoje" — um registro por
-- dia dispensado.
-- =====================================================================
create table public.dismissed_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.dismissed_reminders enable row level security;

create policy "usuário só mexe nos próprios lembretes"
  on public.dismissed_reminders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- 8. TRIGGER: criar profile automaticamente no signup
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, onboarding_completed)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.email), false);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================================
-- 9. TRIGGER: manter updated_at atualizado em profiles
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();