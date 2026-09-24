-- =====================================================================
-- tintin. — migração: observação do mês (Painel)
-- =====================================================================
-- Campo de texto livre por mês, pra anotar imprevistos ou mudanças que
-- fogem do padrão (ex: "tive um imprevisto médico e mexi na reserva").
-- Mesmo padrão da saldo_inicial_overrides: uma linha por usuário+mês.
--
-- Como rodar: Supabase Dashboard → SQL Editor → cole este arquivo → Run.
-- Rode isso DEPOIS de já ter rodado schema.sql uma vez.
-- =====================================================================

create table public.month_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  note text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.month_notes enable row level security;

create policy "usuário só mexe nas próprias observações"
  on public.month_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
