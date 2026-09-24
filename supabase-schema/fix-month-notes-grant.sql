-- =====================================================================
-- tintin. — correção: permissão da tabela month_notes
-- =====================================================================
-- A criação da tabela (add-month-notes.sql) configura as políticas de RLS
-- (quem pode ver quais LINHAS), mas isso é diferente da permissão bruta de
-- acessar a TABELA em si — sem essa concessão o Postgres nega o acesso
-- mesmo com a política de RLS certa ("permission denied for table
-- month_notes"). Rode isso uma vez pra liberar.
--
-- Como rodar: Supabase Dashboard → SQL Editor → cole este arquivo → Run.
-- =====================================================================

grant select, insert, update, delete on public.month_notes to authenticated;
