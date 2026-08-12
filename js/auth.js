// =====================================================================
// tintin. — autenticação
// =====================================================================
// Controla a tela de login/cadastro e expõe `currentUser` + `onAuthReady`
// pro resto do app saber quando pode começar a carregar dados.
//
// Fluxo:
// 1. Ao carregar a página, verifica se já existe uma sessão salva.
// 2. Se não existir, mostra a tela de login (#authOverlay) e espera.
// 3. Quando o login/cadastro dá certo, esconde a tela de login,
//    dispara o evento 'tintin:authenticated' e o app.js (que escuta
//    esse evento) começa a carregar os dados normalmente.
// =====================================================================

let currentUser = null;

function showAuthOverlay(){
  const el = document.getElementById('authOverlay');
  if(el) el.classList.add('open');
}
function hideAuthOverlay(){
  const el = document.getElementById('authOverlay');
  if(el) el.classList.remove('open');
}
function setAuthError(msg){
  const el = document.getElementById('authError');
  if(!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}
function setAuthLoading(loading){
  const btn = document.getElementById('authSubmitBtn');
  if(!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'aguarde...' : (authMode==='signup' ? 'criar conta' : 'entrar');
}

let authMode = 'login'; // 'login' | 'signup'

function renderAuthMode(){
  const title = document.getElementById('authTitle');
  const toggleText = document.getElementById('authToggleText');
  const submitBtn = document.getElementById('authSubmitBtn');
  const nameField = document.getElementById('authNameField');
  if(authMode==='signup'){
    if(title) title.textContent = 'criar sua conta';
    if(submitBtn) submitBtn.textContent = 'criar conta';
    if(toggleText) toggleText.innerHTML = 'já tem conta? <a href="#" id="authToggleLink">entrar</a>';
    if(nameField) nameField.style.display = '';
  } else {
    if(title) title.textContent = 'entrar no tintin.';
    if(submitBtn) submitBtn.textContent = 'entrar';
    if(toggleText) toggleText.innerHTML = 'não tem conta? <a href="#" id="authToggleLink">criar agora</a>';
    if(nameField) nameField.style.display = 'none';
  }
  const link = document.getElementById('authToggleLink');
  if(link) link.addEventListener('click', (e)=>{
    e.preventDefault();
    authMode = authMode==='signup' ? 'login' : 'signup';
    setAuthError('');
    renderAuthMode();
  });
}

async function handleAuthSubmit(e){
  e.preventDefault();
  setAuthError('');
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const displayName = document.getElementById('authName') ? document.getElementById('authName').value.trim() : '';

  if(!email || !password){
    setAuthError('preencha e-mail e senha.');
    return;
  }
  if(password.length < 6){
    setAuthError('a senha precisa ter pelo menos 6 caracteres.');
    return;
  }

  setAuthLoading(true);
  try{
    if(authMode==='signup'){
      const { data, error } = await supabaseClient.auth.signUp({
        email, password,
        options: { data: { display_name: displayName || email } }
      });
      if(error) throw error;
      if(data.session){
        onAuthSuccess(data.session.user);
      } else {
        setAuthLoading(false);
        setAuthError('conta criada! verifique seu e-mail pra confirmar antes de entrar.');
      }
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if(error) throw error;
      onAuthSuccess(data.user);
    }
  }catch(err){
    setAuthLoading(false);
    setAuthError(traduzErroAuth(err.message));
  }
}

function traduzErroAuth(msg){
  if(!msg) return 'algo deu errado, tenta de novo.';
  if(msg.includes('Invalid login credentials')) return 'e-mail ou senha incorretos.';
  if(msg.includes('User already registered')) return 'já existe uma conta com esse e-mail — tenta entrar.';
  if(msg.includes('Password should be')) return 'a senha precisa ter pelo menos 6 caracteres.';
  return msg;
}

function onAuthSuccess(user){
  currentUser = user;
  hideAuthOverlay();
  setAuthLoading(false);
  document.dispatchEvent(new CustomEvent('tintin:authenticated', { detail: { user } }));
}

async function handleLogout(){
  await supabaseClient.auth.signOut();
  currentUser = null;
  location.reload();
}

async function initAuth(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  renderAuthMode();
  document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
  const logoutBtn = document.getElementById('btnLogout');
  if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  if(session && session.user){
    onAuthSuccess(session.user);
  } else {
    showAuthOverlay();
  }

  supabaseClient.auth.onAuthStateChange((event, newSession) => {
    if(event === 'SIGNED_OUT'){
      currentUser = null;
      showAuthOverlay();
    }
  });
}

// o script fica no fim do <body>, então o DOM já está pronto quando ele roda
initAuth();
