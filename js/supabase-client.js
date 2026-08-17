// =====================================================================
// tintin. — cliente Supabase
// =====================================================================
// Inicializa o cliente supabase-js usando as credenciais de config.js.
// Todos os outros arquivos (auth.js, data-layer.js) usam a variável
// global `supabaseClient` definida aqui.
// =====================================================================

if (!window.supabase) {
  console.error('[tintin.] biblioteca supabase-js não carregou — verifique o <script> no index.html');
}

// storage: sessionStorage (em vez do localStorage padrão) — a sessão fica
// vinculada à aba/janela do navegador, então fechar a aba já exige login de
// novo na próxima vez, sem precisar de nenhum controle extra de expiração.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: window.sessionStorage }
});
