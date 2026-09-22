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
  document.body.style.overflow = 'hidden'; // trava o scroll do painel por trás enquanto o login está aberto
}
function hideAuthOverlay(){
  const el = document.getElementById('authOverlay');
  if(el) el.classList.remove('open');
  document.body.style.overflow = '';
  window.scrollTo(0, 0); // garante que o painel abra sempre do topo, não de onde o fundo ficou rolado
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
  if(loading){ btn.textContent = 'aguarde...'; return; }
  btn.textContent = { signup:'criar conta', forgot:'enviar link de recuperação', newpassword:'salvar nova senha' }[authMode] || 'entrar';
}

let authMode = 'login'; // 'login' | 'signup' | 'forgot' | 'newpassword'

function renderAuthMode(){
  const title = document.getElementById('authTitle');
  const toggleText = document.getElementById('authToggleText');
  const submitBtn = document.getElementById('authSubmitBtn');
  const nameField = document.getElementById('authNameField');
  const passwordField = document.getElementById('authPasswordField');
  const forgotWrap = document.getElementById('authForgotWrap');
  const passwordInput = document.getElementById('authPassword');

  nameField.style.display = authMode==='signup' ? '' : 'none';
  passwordField.style.display = (authMode==='forgot') ? 'none' : '';
  forgotWrap.style.display = (authMode==='login') ? '' : 'none';

  if(authMode==='signup'){
    title.textContent = 'criar sua conta';
    submitBtn.textContent = 'criar conta';
    toggleText.innerHTML = 'já tem conta? <a href="#" id="authToggleLink">entrar</a>';
    passwordInput.placeholder = 'mínimo 6 caracteres';
    passwordInput.autocomplete = 'new-password';
  } else if(authMode==='forgot'){
    title.textContent = 'recuperar senha';
    submitBtn.textContent = 'enviar link de recuperação';
    toggleText.innerHTML = 'lembrou a senha? <a href="#" id="authToggleLink">entrar</a>';
  } else if(authMode==='newpassword'){
    title.textContent = 'defina sua nova senha';
    submitBtn.textContent = 'salvar nova senha';
    toggleText.innerHTML = '';
    passwordInput.placeholder = 'nova senha (mínimo 6 caracteres)';
    passwordInput.autocomplete = 'new-password';
  } else {
    title.textContent = 'entrar no tintin.';
    submitBtn.textContent = 'entrar';
    toggleText.innerHTML = 'não tem conta? <a href="#" id="authToggleLink">criar agora</a>';
    passwordInput.placeholder = 'mínimo 6 caracteres';
    passwordInput.autocomplete = 'current-password';
  }

  const link = document.getElementById('authToggleLink');
  if(link) link.addEventListener('click', (e)=>{
    e.preventDefault();
    authMode = authMode==='signup' ? 'login' : (authMode==='forgot' ? 'login' : authMode);
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

  if(authMode==='forgot'){
    if(!email){
      setAuthError('preencha seu e-mail.');
      return;
    }
    setAuthLoading(true);
    try{
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      if(error) throw error;
      setAuthLoading(false);
      setAuthError('link de recuperação enviado! verifique seu e-mail.');
    }catch(err){
      setAuthLoading(false);
      setAuthError(traduzErroAuth(err.message));
    }
    return;
  }

  if(authMode==='newpassword'){
    if(!password || password.length < 6){
      setAuthError('a nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    setAuthLoading(true);
    try{
      const { data, error } = await supabaseClient.auth.updateUser({ password });
      if(error) throw error;
      onAuthSuccess(data.user);
    }catch(err){
      setAuthLoading(false);
      setAuthError(traduzErroAuth(err.message));
    }
    return;
  }

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
        options: { data: { display_name: displayName || email }, emailRedirectTo: window.location.origin }
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
  renderAuthMode();
  document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
  const logoutBtn = document.getElementById('btnLogout');
  if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  const forgotLink = document.getElementById('authForgotLink');
  if(forgotLink) forgotLink.addEventListener('click', (e)=>{
    e.preventDefault();
    authMode = 'forgot';
    setAuthError('');
    renderAuthMode();
  });

  // registra o listener ANTES do getSession() pra não perder o evento
  // PASSWORD_RECOVERY, que o supabase-js pode disparar ao processar o link
  // de recuperação de senha assim que a página carrega.
  supabaseClient.auth.onAuthStateChange((event, newSession) => {
    if(event === 'SIGNED_OUT'){
      currentUser = null;
      showAuthOverlay();
    } else if(event === 'PASSWORD_RECOVERY'){
      authMode = 'newpassword';
      setAuthError('');
      renderAuthMode();
      showAuthOverlay();
    }
  });

  const { data: { session } } = await supabaseClient.auth.getSession();
  if(session && session.user && authMode !== 'newpassword'){
    onAuthSuccess(session.user);
  } else if(authMode !== 'newpassword'){
    showAuthOverlay();
  }
}

// o script fica no fim do <body>, então o DOM já está pronto quando ele roda
initAuth();
