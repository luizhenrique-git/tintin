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

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
