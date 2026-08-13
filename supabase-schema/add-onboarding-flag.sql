-- =====================================================================
-- tintin. — migração: flag de onboarding em profiles
-- =====================================================================
-- Adiciona a coluna `onboarding_completed` em `profiles` e ajusta o
-- trigger de criação de conta pra que só contas NOVAS a partir de agora
-- comecem com onboarding pendente.
--
-- O default TRUE na coluna é proposital: toda conta que já existe hoje
-- (antes desta migração) é marcada como "já passou disso" e continua
-- caindo direto no painel, sem ver o onboarding.
--
-- Como rodar: Supabase Dashboard → SQL Editor → cole este arquivo → Run.
-- Rode isso DEPOIS de já ter rodado schema.sql uma vez.
-- =====================================================================

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default true;

-- Recria o trigger de criação de conta pra inserir onboarding_completed = false
-- especificamente pra contas novas. Contas já existentes não são afetadas —
-- esta função só roda no INSERT em auth.users (ou seja, no cadastro).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, onboarding_completed)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.email), false);
  return new;
end;
$$ language plpgsql security definer;
