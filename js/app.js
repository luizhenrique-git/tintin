/* ---------------- Helpers ---------------- */
// evita clique-duplo/toque-duplo disparando a mesma ação duas vezes enquanto ela
// ainda está em andamento (ex: salvando algo no Supabase) — comum quando a ação
// demora um pouco e a pessoa clica de novo achando que não registrou o primeiro
// clique, gerando itens duplicados. Trava o botão até a promessa terminar.
function guardAsyncClick(btn, handler){
  btn.addEventListener('click', async (e)=>{
    if(btn.dataset.busy==='1') return;
    btn.dataset.busy = '1';
    // feedback visual imediato: o botão fica visivelmente "travado" enquanto
    // processa, pra pessoa ver que o clique já registrou e não clicar de novo
    btn.style.opacity = '0.65';
    btn.style.pointerEvents = 'none';
    try{
      await handler(e);
    } finally {
      btn.dataset.busy = '';
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    }
  });
}
function parseAmount(raw){
  if(raw==null) return NaN;
  let s = String(raw).trim();
  if(s==='') return NaN;
  if(s.includes(',') && s.includes('.')){
    s = s.replace(/\./g,'').replace(',', '.');
  } else if(s.includes(',')){
    s = s.replace(',', '.');
  }
  return parseFloat(s);
}

/* ---------------- Storage mode ----------------
   Agora sempre "nuvem de verdade": Supabase, com autenticação por usuário.
   As funções de load/persist abaixo chamam data-layer.js, que conversa
   com o banco (ver js/data-layer.js e supabase-schema/schema.sql). */
(function(){
  const el = document.getElementById('storageModeLabel');
  if(el) el.textContent = 'dados salvos na sua conta (Supabase)';
})();

/* ---------------- Generic Dialog (replaces confirm/prompt) ---------------- */
let dialogResolve = null;
const dlgOverlay = document.getElementById('dialogOverlay');
const dlgInputField = document.getElementById('dialogInputField');
const dlgInput = document.getElementById('dialogInput');
function showDialog({title, message, withInput=false, defaultValue='', okLabel='ok', extraLabel=null}){
  return new Promise(resolve=>{
    dialogResolve = resolve;
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogMessage').textContent = message;
    document.getElementById('dialogOk').textContent = okLabel;
    const extraBtn = document.getElementById('dialogExtra');
    if(extraLabel){
      extraBtn.textContent = extraLabel;
      extraBtn.style.display = 'block';
    } else {
      extraBtn.style.display = 'none';
    }
    if(withInput){
      dlgInputField.style.display='block';
      dlgInput.value = defaultValue;
      setTimeout(()=>{ dlgInput.focus(); dlgInput.select(); }, 60);
    } else {
      dlgInputField.style.display='none';
    }
    dlgOverlay.classList.add('open');
  });
}
function resolveDialog(val){
  dlgOverlay.classList.remove('open');
  if(dialogResolve){ dialogResolve(val); dialogResolve=null; }
}
document.getElementById('dialogExtra').addEventListener('click', ()=> resolveDialog('extra'));
document.getElementById('dialogCancel').addEventListener('click', ()=> resolveDialog(null));
document.getElementById('dialogOk').addEventListener('click', ()=>{
  const withInput = dlgInputField.style.display!=='none';
  if(withInput){ const v = dlgInput.value.trim(); resolveDialog(v?v:null); }
  else resolveDialog(true);
});
dlgOverlay.addEventListener('click', (e)=>{ if(e.target===dlgOverlay) resolveDialog(null); });
dlgInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); document.getElementById('dialogOk').click(); } });

/* ---------------- App state ---------------- */
let state = {
  transactions: [],
  categories: { despesa: [], receita: [] },
  investedBase: 0,
  budgetItems: [],    // [{ id, category, desc, amount, month:"YYYY-MM", seriesId, seriesIndex, seriesTotal }]
  closedMonths: [],    // ["YYYY-MM", ...] months already closed via "fechar mês"
  saldoInicialOverrides: {}, // { "YYYY-MM": number } — manual override for the Mapa's day-1 saldo inicial
  dismissedReminders: []     // ["YYYY-MM-DD", ...] days whose bill reminder popup was already dismissed
};
let currentMonth; // "YYYY-MM"
let saldosMonth; // "YYYY-MM" — independent month cursor for the Saldos tab
let previsaoMonth; // "YYYY-MM" — independent month cursor for the Previsão tab
let budgetModalType = 'despesa'; // 'despesa' | 'receita' — type of the item being created/edited in the budget item modal
let receitaCardMode = 'realizado'; // 'realizado' | 'previsto' — which value the dashboard's receitas card shows
let economiaCardMode = 'realizado'; // 'realizado' | 'previsto' — which value the dashboard's economia card shows
let despesaCardMode = 'realizado'; // 'realizado' | 'previsto' — which value the dashboard's gasto realizado card shows
let realizadoMonth; // "YYYY-MM" — independent month cursor for the Realizado tab
let selectedTxIds = new Set(); // ids currently checked for bulk category move in Realizado
let editingId = null;
let modalType = 'despesa';
let pieChart = null, barChart = null, investidoChart = null, investimentosChart = null;

const PALETTE = ['#F4622C','#4B21C4','#1F8C4C','#C9A227','#D45B90','#2E7BBF','#8B5E3C','#3FA796','#B23A48','#6C5CE7','#E08E45','#2F6B4F','#9B5DE5','#D8A048','#5E8C61','#C4497A'];
function hexToRgb(hex){
  const h = hex.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function colorFor(name){
  let h = 0;
  for(let i=0;i<name.length;i++){ h = (h*31 + name.charCodeAt(i)) >>> 0; }
  return PALETTE[h % PALETTE.length];
}
function fmtBRL(v){
  return (v<0?'-':'') + Math.abs(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}
function fmtDate(iso){
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function monthLabelOf(ym){
  const [y,m] = ym.split('-').map(Number);
  const names = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${names[m-1]} de ${y}`;
}
function todayISO(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function addDays(dateStr, n){
  const d = new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate()+n);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function addMonths(dateStr, n){
  const [y,m,day] = dateStr.split('-').map(Number);
  const target = new Date(y, (m-1)+n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth()+1, 0).getDate();
  const finalDay = Math.min(day, lastDay);
  return target.getFullYear()+'-'+String(target.getMonth()+1).padStart(2,'0')+'-'+String(finalDay).padStart(2,'0');
}

/* ---------------- Storage ---------------- */
async function loadState(){
  const data = await loadAllData();
  state.categories = data.categories;
  state.transactions = data.transactions;
  state.budgetItems = data.budgetItems;
  state.investedBase = data.investedBase;
  state.saldoInicialOverrides = data.saldoInicialOverrides;
  state.closedMonths = data.closedMonths;
  state.dismissedReminders = data.dismissedReminders;
  // snapshots usados pela sincronização incremental (diff) com o Supabase,
  // ver persistTx()/persistBudgetItems() logo abaixo
  lastSyncedTransactions = JSON.parse(JSON.stringify(state.transactions));
  lastSyncedBudgetItems = JSON.parse(JSON.stringify(state.budgetItems));
}

// -----------------------------------------------------------------------
// Sincronização incremental: em vez de reenviar o array inteiro a cada
// mudança (como no protótipo em localStorage), comparamos com a última
// versão sincronizada e mandamos pro Supabase só o que de fato mudou
// (criar/atualizar/excluir linhas específicas).
// -----------------------------------------------------------------------
let lastSyncedTransactions = [];
let lastSyncedBudgetItems = [];

async function persistTx(){
  try{
    const oldById = new Map(lastSyncedTransactions.map(t=>[t.id, t]));
    const newIds = new Set(state.transactions.map(t=>t.id));
    for(const [id] of oldById){
      if(!newIds.has(id)) await dbDeleteTransaction(id);
    }
    for(const tx of state.transactions){
      const old = oldById.get(tx.id);
      if(!old){
        tx.id = await dbCreateTransaction(tx);
      } else if(JSON.stringify(old)!==JSON.stringify(tx)){
        await dbUpdateTransaction(tx.id, tx);
      }
    }
    lastSyncedTransactions = JSON.parse(JSON.stringify(state.transactions));
  }catch(e){ showToast('erro ao salvar dados: '+(e.message||'tente novamente')); }
}

async function persistBudgetItems(){
  try{
    const oldById = new Map(lastSyncedBudgetItems.map(b=>[b.id, b]));
    const newIds = new Set(state.budgetItems.map(b=>b.id));
    for(const [id] of oldById){
      if(!newIds.has(id)) await dbDeleteBudgetItem(id);
    }
    for(const item of state.budgetItems){
      const old = oldById.get(item.id);
      if(!old){
        item.id = await dbCreateBudgetItem(item);
      } else if(JSON.stringify(old)!==JSON.stringify(item)){
        await dbUpdateBudgetItem(item.id, item);
      }
    }
    lastSyncedBudgetItems = JSON.parse(JSON.stringify(state.budgetItems));
  }catch(e){ showToast('erro ao salvar previsão: '+(e.message||'tente novamente')); }
}

// Criação/renomeação/exclusão de categoria são feitas direto contra o banco
// (dbCreateCategory / dbRenameCategory / dbDeleteCategory) nos pontos onde
// acontecem — esta função só resincroniza a lista local depois.
async function persistCats(){
  try{ state.categories = await dbListCategories(); }
  catch(e){ showToast('erro ao sincronizar categorias'); }
}
async function persistSaldoInicialOverrides(){
  try{ state.saldoInicialOverrides = await dbListSaldoInicialOverrides(); }
  catch(e){ showToast('erro ao salvar saldo inicial'); }
}
async function persistClosedMonths(){
  try{ state.closedMonths = await dbListClosedMonths(); }
  catch(e){ showToast('erro ao salvar fechamento'); }
}
async function persistDismissedReminders(){
  try{ state.dismissedReminders = await dbListDismissedReminders(); }
  catch(e){ /* não crítico */ }
}
async function persistAll(){
  await persistCats();
  await persistTx();
  await persistBudgetItems();
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
let lastSnapshot = null; // one-level undo: full state snapshot taken right before the last mutating action
let lastUndoFn = null; // ação de reversão específica (usada quando a mudança já commitou direto no banco fora do sistema de diff — ex: categorias, saldo inicial)
function snapshotState(){
  return JSON.parse(JSON.stringify({
    transactions: state.transactions,
    categories: state.categories,
    budgetItems: state.budgetItems,
    investedBase: state.investedBase,
    closedMonths: state.closedMonths,
    saldoInicialOverrides: state.saldoInicialOverrides
  }));
}
// pushUndo(): pra ações "diff-based" (transações, itens de previsão) — restaurar o
// snapshot local basta, porque persistTx()/persistBudgetItems() sincronizam a
// diferença certinho com o Supabase depois.
// pushUndo(async () => {...}): pra ações que já gravam direto no banco no momento em
// que acontecem (criar/renomear/excluir categoria, editar/resetar saldo inicial) —
// a função passada é a operação inversa de verdade (ex: dbDeleteCategory pra
// desfazer um dbCreateCategory), chamada no lugar de só restaurar o snapshot.
function pushUndo(customUndo){
  lastSnapshot = snapshotState();
  lastUndoFn = customUndo || null;
}
async function undoLastAction(){
  if(!lastSnapshot) return;
  const customUndo = lastUndoFn;
  if(customUndo){
    lastSnapshot = null;
    lastUndoFn = null;
    try{
      await customUndo();
    }catch(err){
      showToast('erro ao desfazer: '+(err && err.message ? err.message : 'tente novamente'));
      return;
    }
  } else {
    const snap = lastSnapshot;
    state.transactions = snap.transactions;
    state.categories = snap.categories;
    state.budgetItems = snap.budgetItems;
    state.investedBase = snap.investedBase;
    state.closedMonths = snap.closedMonths;
    state.saldoInicialOverrides = snap.saldoInicialOverrides;
    lastSnapshot = null;
    await persistAll();
  }
  renderDashboard();
  renderRealizado();
  renderCategorias();
  renderSaldos();
  renderPrevisao();
  if(dayDetailsState) renderDayDetailsModal(dayDetailsState.dateStr, dayDetailsState.type);
  document.getElementById('toast').classList.remove('show');
  showToast('tintin! ação desfeita');
}
let successAudioCtx = null;
function playSuccessSound(){
  try{
    if(!successAudioCtx) successAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(successAudioCtx.state === 'suspended') successAudioCtx.resume();
    const ctx = successAudioCtx;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);

    // "cha": clique mecânico curto (alavanca da caixa registradora) — ruído gerado
    // na hora (sem arquivo), filtrado pra soar seco e percussivo
    const clickDur = 0.035;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate*clickDur));
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++){ data[i] = (Math.random()*2-1) * (1-i/bufferSize); }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2500;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now+clickDur);
    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noiseSrc.start(now);
    noiseSrc.stop(now+clickDur);

    // "ching": sininhos metálicos — fundamental + harmônico levemente dissonante,
    // como um sino de verdade (em vez de um bip puro), num "tim-tim" ascendente
    function bell(freq, start, dur, vol){
      [1, 2.4].forEach((mult, i)=>{
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq*mult;
        const peak = i===0 ? vol : vol*0.35;
        gain.gain.setValueAtTime(0.0001, now+start);
        gain.gain.exponentialRampToValueAtTime(peak, now+start+0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now+start+dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now+start);
        osc.stop(now+start+dur+0.02);
      });
    }
    bell(1567.98, 0.04, 0.16, 0.5); // G6
    bell(2093.00, 0.14, 0.22, 0.5); // C7 — o "ching" final, mais agudo
  }catch(err){
    // som é só um bônus — nunca deixa isso impedir o toast de aparecer
  }
}
function showToast(msg, withUndo){
  if(!/^erro/i.test((msg||'').trim())) playSuccessSound();
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  const undoBtn = document.getElementById('toastUndo');
  undoBtn.classList.toggle('show', !!(withUndo && lastSnapshot));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), withUndo?6500:4000);
}
document.getElementById('toastUndo').addEventListener('click', undoLastAction);
window.addEventListener('error', (e)=>{
  showToast('erro: ' + (e.message || 'algo deu errado nesta ação'));
});
window.addEventListener('unhandledrejection', (e)=>{
  const m = (e.reason && e.reason.message) ? e.reason.message : String(e.reason);
  showToast('erro: ' + m);
});

/* ---------------- Tabs ---------------- */
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-'+btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab==='lancamentos') renderRealizado();
    if(btn.dataset.tab==='categorias') renderCategorias();
    if(btn.dataset.tab==='dashboard') renderDashboard();
    if(btn.dataset.tab==='saldos') renderSaldos();
    if(btn.dataset.tab==='previsao') renderPrevisao();
    if(btn.dataset.tab==='investimentos') renderInvestimentos();
  });
});

/* ---------------- Dashboard ---------------- */
function allMonthsSorted(){
  const set = new Set(state.transactions.map(t=>t.date.slice(0,7)));
  set.add(currentMonth);
  return Array.from(set).sort();
}
function shiftMonth(ym, delta){
  let [y,m] = ym.split('-').map(Number);
  m += delta;
  while(m>12){m-=12;y++;}
  while(m<1){m+=12;y--;}
  return y+'-'+String(m).padStart(2,'0');
}
document.getElementById('prevMonth').addEventListener('click', ()=>{ currentMonth = shiftMonth(currentMonth,-1); renderDashboard(); });
document.getElementById('nextMonth').addEventListener('click', ()=>{ currentMonth = shiftMonth(currentMonth,1); renderDashboard(); });

const RENDIMENTO_AUTO_CUTOFF = '2026-08-01'; // Rendimento antes disso já está embutido no investedBase corrigido; só conta automático a partir daqui
function computeValorInvestidoAsOf(dateStr){
  let v = state.investedBase || 0;
  state.transactions.forEach(t=>{
    if(t.category==='Investimento' && t.date<=dateStr){
      v += (t.type==='despesa' ? t.amount : -t.amount);
    }
    if(t.category==='Rendimento' && t.type==='receita' && t.date<=dateStr && t.date>=RENDIMENTO_AUTO_CUTOFF){
      v += t.amount;
    }
  });
  return v;
}
function computeValorInvestido(){
  return computeValorInvestidoAsOf(todayISO());
}
function txForMonth(ym){
  return state.transactions.filter(t=>t.date.slice(0,7)===ym);
}
function computeSaldoInicialDoMes(ym){
  const auto = computeBudgetTotal(ym, 'despesa');
  return (state.saldoInicialOverrides[ym] != null) ? state.saldoInicialOverrides[ym] : auto;
}
function computeSaidasReaisDoMes(ym){
  return txForMonth(ym).filter(t=>t.type==='despesa' && t.category!=='Investimento').reduce((s,t)=>s+t.amount,0);
}
function computeReceitasReaisDoMes(ym){
  return txForMonth(ym).filter(t=>t.type==='receita' && t.category!=='Investimento').reduce((s,t)=>s+t.amount,0);
}
function computeOverrunDoMes(ym){
  const saidas = computeSaidasReaisDoMes(ym);
  const inicial = computeSaldoInicialDoMes(ym);
  return Math.max(0, saidas - inicial);
}
function computeBudgetTotal(ym, type='despesa'){
  return state.budgetItems.filter(b=>b.month===ym && (b.type||'despesa')===type).reduce((s,b)=>s+b.amount,0);
}
function computeSaldoDisponivel(ym){
  const despesas = txForMonth(ym).filter(t=>t.type==='despesa' && t.category!=='Investimento').reduce((s,t)=>s+t.amount,0);
  const previsto = computeBudgetTotal(ym);
  return previsto - despesas;
}
document.querySelectorAll('#receitaModeToggle button').forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    receitaCardMode = btn.dataset.rm;
    renderDashboard();
  });
});
document.querySelectorAll('#economiaModeToggle button').forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    economiaCardMode = btn.dataset.em;
    renderDashboard();
  });
});
document.querySelectorAll('#despesaModeToggle button').forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    despesaCardMode = btn.dataset.dm;
    renderDashboard();
  });
});
function renderDashboard(){
  document.getElementById('monthLabel').textContent = monthLabelOf(currentMonth);
  const monthTx = txForMonth(currentMonth);
  const monthTxReal = monthTx.filter(t=>t.category!=='Investimento');
  const receitas = monthTxReal.filter(t=>t.type==='receita').reduce((s,t)=>s+t.amount,0);
  const despesas = monthTxReal.filter(t=>t.type==='despesa').reduce((s,t)=>s+t.amount,0);

  // valor investido "como estava" no mês sendo navegado (hoje, se for o mês atual;
  // último dia do mês, se for um mês passado) — reusa computeValorInvestidoAsOf(),
  // a mesma função já usada no gráfico de evolução.
  const investidoAsOfDate = (currentMonth===todayISO().slice(0,7)) ? todayISO() : lastDayOfMonth(currentMonth);
  document.getElementById('statInvestido').textContent = fmtBRL(computeValorInvestidoAsOf(investidoAsOfDate));
  const receitasPrevistas = computeBudgetTotal(currentMonth, 'receita');
  const statReceitaEl = document.getElementById('statReceita');
  if(receitaCardMode==='previsto'){
    statReceitaEl.textContent = receitasPrevistas>0 ? fmtBRL(receitasPrevistas) : 'sem previsão';
  } else {
    statReceitaEl.textContent = fmtBRL(receitas);
  }
  document.querySelectorAll('#receitaModeToggle button').forEach(b=>b.classList.toggle('active', b.dataset.rm===receitaCardMode));

  // saldo inicial: total da previsão do mês (ou override manual)
  const previstoMes = computeSaldoInicialDoMes(currentMonth);
  const saldoContaEl = document.getElementById('statSaldoConta');
  saldoContaEl.textContent = previstoMes>0 ? fmtBRL(previstoMes) : 'sem previsão';

  // gasto realizado: despesas reais do mês, com % do saldo inicial usado no tooltip
  const despEl = document.getElementById('statDespesa');
  const despSubEl = document.getElementById('statDespesaSub');
  const despesasPrevistas = computeBudgetTotal(currentMonth, 'despesa');
  document.querySelectorAll('#despesaModeToggle button').forEach(b=>b.classList.toggle('active', b.dataset.dm===despesaCardMode));
  if(despesaCardMode==='previsto'){
    despEl.textContent = despesasPrevistas>0 ? fmtBRL(despesasPrevistas) : 'sem previsão';
    despEl.className = 'stat-value';
    despSubEl.textContent = despesasPrevistas>0 ? 'total previsto de despesas para este mês' : 'sem previsão cadastrada para este mês';
  } else {
    despEl.textContent = fmtBRL(despesas);
    if(previstoMes>0){
      const pct = Math.round(despesas/previstoMes*100);
      despEl.className = 'stat-value ' + (despesas>previstoMes ? 'neg' : '');
      despSubEl.textContent = `${pct}% do saldo inicial (${fmtBRL(previstoMes)}) usado`;
    } else {
      despEl.className = 'stat-value';
      despSubEl.textContent = 'sem previsão cadastrada para este mês';
    }
  }

  // economia do mês = resultado do mês (receita sem rendimento - estouro - previsão do mês seguinte) + rendimento do mês.
  // o Rendimento entra aqui como economia de verdade (ele já flui automático pro Valor Investido de qualquer forma,
  // isso não muda — ver computeValorInvestidoAsOf); só a conta exibida neste card passou a incluí-lo de novo.
  const nextMonth = shiftMonth(currentMonth, 1);
  const previstoProximo = computeBudgetTotal(nextMonth, 'despesa');
  document.getElementById('statPrevistoProximo').textContent = previstoProximo>0 ? fmtBRL(previstoProximo) : 'sem previsão';
  const overrun = computeOverrunDoMes(currentMonth);
  const rendimentoReal = monthTxReal.filter(t=>t.type==='receita' && t.category==='Rendimento').reduce((s,t)=>s+t.amount,0);
  const receitasSemRendimento = receitas - rendimentoReal;
  const resultadoDoMesReal = receitasSemRendimento - overrun - previstoProximo;
  const economiaReal = resultadoDoMesReal + rendimentoReal;
  const receitasPrevistasMes = computeBudgetTotal(currentMonth, 'receita');
  const rendimentoPrevisto = state.budgetItems.filter(b=>b.month===currentMonth && (b.type||'despesa')==='receita' && b.category==='Rendimento').reduce((s,b)=>s+b.amount,0);
  const receitasPrevistasSemRendimento = receitasPrevistasMes - rendimentoPrevisto;
  const resultadoDoMesPrevisto = receitasPrevistasSemRendimento - previstoProximo;
  const economiaPrevista = resultadoDoMesPrevisto + rendimentoPrevisto;
  const ecoEl = document.getElementById('statEconomia');
  const ecoSubEl = document.getElementById('statEconomiaSub');
  document.querySelectorAll('#economiaModeToggle button').forEach(b=>b.classList.toggle('active', b.dataset.em===economiaCardMode));
  if(economiaCardMode==='previsto'){
    if(receitasPrevistasMes>0 && previstoProximo>0){
      ecoEl.textContent = fmtBRL(economiaPrevista);
      ecoEl.className = 'stat-value ' + (economiaPrevista>=0?'pos':'neg');
      ecoSubEl.innerHTML = `(resultado do mês): ${fmtBRL(resultadoDoMesPrevisto)}`
        + `<br>(rendimento): ${fmtBRL(rendimentoPrevisto)}`
        + `<br>(total): ${fmtBRL(economiaPrevista)}`;
    } else {
      ecoEl.textContent = 'sem previsão';
      ecoEl.className = 'stat-value';
      ecoSubEl.textContent = `cadastre a previsão de receita deste mês e de despesa de ${monthLabelOf(nextMonth)} pra ver este número`;
    }
  } else {
    ecoEl.textContent = fmtBRL(economiaReal);
    ecoEl.className = 'stat-value ' + (economiaReal>=0?'pos':'neg');
    ecoSubEl.innerHTML = `(resultado do mês): ${fmtBRL(resultadoDoMesReal)}`
      + (overrun>0 ? ` (já descontado o estouro de ${fmtBRL(overrun)})` : '')
      + `<br>(rendimento): ${fmtBRL(rendimentoReal)}`
      + `<br>(total): ${fmtBRL(economiaReal)}`
      + (previstoProximo<=0 ? `<br>cadastre a previsão de ${monthLabelOf(nextMonth)} pra este número fazer sentido` : '');
  }

  const previsaoItems = state.budgetItems.filter(b=>b.month===currentMonth && (b.type||'despesa')==='despesa').map(b=>({category:b.category, amount:b.amount, type:'despesa'}));
  document.getElementById('pieTitleDespesa').textContent = previsaoItems.length ? 'despesas previstas por categoria' : 'despesas por categoria';
  renderPie(previsaoItems.length ? previsaoItems : monthTxReal);

  const previsaoItemsReceita = state.budgetItems.filter(b=>b.month===currentMonth && (b.type||'despesa')==='receita').map(b=>({category:b.category, amount:b.amount, type:'receita'}));
  document.getElementById('pieTitleReceita').textContent = previsaoItemsReceita.length ? 'receitas previstas por categoria' : 'receitas por categoria';
  renderPieReceita(previsaoItemsReceita.length ? previsaoItemsReceita : monthTxReal);
  renderBar();
  renderInvestidoChart();
}

let pieChartReceita = null;
function renderPieChart(monthTx, type, canvasId, wrapId, legendId, emptyMsg){
  const filtered = monthTx.filter(t=>t.type===type);
  const byCat = {};
  filtered.forEach(t=>{ byCat[t.category] = (byCat[t.category]||0) + t.amount; });
  const entries = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  const wrap = document.getElementById(wrapId);
  const legend = document.getElementById(legendId);
  if(entries.length===0){
    wrap.innerHTML = `<div class="empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#C9C2AA" stroke-width="2"/><path d="M9 10h.01M15 10h.01M8 15c1 1.2 2.4 2 4 2s3-.8 4-2" stroke="#C9C2AA" stroke-width="2" stroke-linecap="round"/></svg>
      ${emptyMsg}</div>`;
    legend.innerHTML = '';
    return null;
  }
  if(!wrap.querySelector('canvas')) wrap.innerHTML = `<canvas id="${canvasId}"></canvas>`;
  const ctx = document.getElementById(canvasId).getContext('2d');
  const labels = entries.map(e=>e[0]);
  const data = entries.map(e=>e[1]);
  const colors = labels.map(colorFor);
  const chart = new Chart(ctx, {
    type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:2, borderColor:'#fff' }] },
    options:{ cutout:'62%', plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(c)=> c.label+': '+fmtBRL(c.raw) } } }, maintainAspectRatio:false }
  });
  legend.innerHTML = entries.slice(0,6).map(([name,val])=>`
    <div class="legend-row">
      <span class="legend-dot" style="background:${colorFor(name)}"></span>
      <span class="name">${name}</span>
      <span class="val">${fmtBRL(val)}</span>
    </div>`).join('');
  return chart;
}
function renderPie(monthTx){
  if(pieChart) pieChart.destroy();
  pieChart = renderPieChart(monthTx, 'despesa', 'pieChart', 'pieWrap', 'pieLegend', 'nenhuma despesa neste mês');
}
function renderPieReceita(monthTx){
  if(pieChartReceita) pieChartReceita.destroy();
  pieChartReceita = renderPieChart(monthTx, 'receita', 'pieChartReceita', 'pieWrapReceita', 'pieLegendReceita', 'nenhuma receita neste mês');
}

/* ---------------- Relatório PDF ---------------- */
// mesma fórmula usada no card "economia do mês" do painel (modo realizado),
// só que parametrizada por mês — reusa computeOverrunDoMes/computeBudgetTotal/
// txForMonth, não duplica nem reescreve o cálculo em si.
function computeEconomiaRealDoMes(ym){
  const monthTx = txForMonth(ym);
  const monthTxReal = monthTx.filter(t=>t.category!=='Investimento');
  const receitas = monthTxReal.filter(t=>t.type==='receita').reduce((s,t)=>s+t.amount,0);
  const despesas = monthTxReal.filter(t=>t.type==='despesa').reduce((s,t)=>s+t.amount,0);
  const overrun = computeOverrunDoMes(ym);
  const nextM = shiftMonth(ym, 1);
  const previstoProximo = computeBudgetTotal(nextM, 'despesa');
  const rendimento = monthTxReal.filter(t=>t.type==='receita' && t.category==='Rendimento').reduce((s,t)=>s+t.amount,0);
  const receitasSemRendimento = receitas - rendimento;
  const resultadoDoMes = receitasSemRendimento - overrun - previstoProximo;
  const economia = resultadoDoMes + rendimento;
  return { receitas, despesas, overrun, previstoProximo, rendimento, resultadoDoMes, economia };
}

async function gerarRelatorioPDF(){
  try{
    if(!window.jspdf){ showToast('erro: biblioteca de PDF não carregou (verifique sua conexão)'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({unit:'mm', format:'a4'});
    const marginX = 14, rightX = 196;
    let y = 44;

    function ensureSpace(needed){
      if(y + needed > 283){ doc.addPage(); y = 20; }
    }
    // seção "card": título + linhas label/valor com altura fixa conhecida de antemão,
    // desenha o fundo primeiro e depois o texto por cima (jsPDF não tem z-index).
    function drawCardSection(title, rows){
      const rowH = 6.6;
      const height = 12 + rows.length*rowH + 4;
      ensureSpace(height + 10);
      const boxY = y;
      doc.setFillColor(246,238,220);
      doc.roundedRect(marginX-4, boxY-6, rightX-marginX+8, height, 3, 3, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(12.5); doc.setTextColor(16,35,26);
      doc.text(title, marginX, boxY);
      let ry = boxY + 9;
      rows.forEach(r=>{
        doc.setFont('helvetica','normal'); doc.setFontSize(10.5);
        doc.setTextColor(107,117,104);
        doc.text(r.label, marginX, ry);
        doc.setFont('helvetica','bold');
        const [cr,cg,cb] = r.valueColor || [16,35,26];
        doc.setTextColor(cr,cg,cb);
        doc.text(r.value, rightX, ry, {align:'right'});
        ry += rowH;
      });
      y = boxY + height + 8;
    }
    function drawStatusPill(text, color){
      ensureSpace(14);
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
      const w = doc.getTextWidth(text) + 10;
      const [r,g,b] = color;
      doc.setFillColor(r,g,b);
      doc.roundedRect(marginX, y-5, w, 8, 4, 4, 'F');
      doc.setTextColor(255,255,255);
      doc.text(text, marginX+5, y);
      y += 14;
    }
    function drawTag(x, ty, text, color){
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
      const w = doc.getTextWidth(text) + 4;
      const [r,g,b] = color;
      doc.setFillColor(r,g,b);
      doc.roundedRect(x, ty-3.3, w, 4.3, 1.4, 1.4, 'F');
      doc.setTextColor(255,255,255);
      doc.text(text, x+2, ty-0.3);
      return x + w + 2;
    }
    // lista de categorias com bolinha colorida (mesma cor por categoria do resto do
    // app, via colorFor) e, quando disponível, os itens individuais com tags de
    // "pago"/"orçamento do mês" — mesmo espírito visual das tags já usadas na tela.
    function drawCategoryList(title, catGroups, emptyMsg){
      ensureSpace(16);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(16,35,26);
      doc.text(title, marginX, y); y += 6;
      doc.setDrawColor(230,220,190); doc.line(marginX, y, rightX, y); y += 6;
      if(catGroups.length===0){
        doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(150,150,140);
        doc.text(emptyMsg, marginX, y); y += 8;
        return;
      }
      const grandTotal = catGroups.reduce((s,c)=>s+c.total,0);
      catGroups.forEach(cat=>{
        ensureSpace(10);
        const [r,g,b] = hexToRgb(colorFor(cat.name));
        doc.setFillColor(r,g,b);
        doc.circle(marginX+1.2, y-1.6, 1.4, 'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(60,60,55);
        doc.text(cat.name, marginX+6, y);
        const pct = grandTotal>0 ? Math.round(cat.total/grandTotal*100) : 0;
        doc.setTextColor(16,35,26);
        doc.text(`${fmtBRL(cat.total)}  (${pct}%)`, rightX, y, {align:'right'});
        y += 6;
        doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
        cat.items.forEach(it=>{
          ensureSpace(7);
          doc.setTextColor(120,120,112);
          const label = `${it.desc}`;
          doc.text(label, marginX+6, y);
          let tagX = marginX + 6 + doc.getTextWidth(label) + 3;
          if(it.paid) tagX = drawTag(tagX, y, 'pago', [31,140,76]);
          if(it.variable) tagX = drawTag(tagX, y, 'orçamento do mês', [244,98,44]);
          doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(90,90,85);
          doc.text(fmtBRL(it.amount), rightX, y, {align:'right'});
          y += 5.4;
        });
        y += 2.5;
      });
      y += 4;
    }
    function buildCatGroups(items){
      const map = {};
      items.forEach(it=>{
        if(!map[it.category]) map[it.category] = { name: it.category, total:0, items:[] };
        map[it.category].total += it.amount;
        map[it.category].items.push({ desc: it.desc, amount: it.amount, paid: !!it.paid, variable: !!it.variable });
      });
      const groups = Object.values(map).sort((a,b)=>b.total-a.total);
      groups.forEach(g=> g.items.sort((a,b)=>b.amount-a.amount));
      return groups;
    }

    // ---- cabeçalho ----
    doc.setFillColor(16,35,26);
    doc.rect(0,0,210,30,'F');
    doc.setFillColor(198,241,53);
    doc.roundedRect(marginX,7,11,11,3,3,'F');
    doc.setTextColor(16,35,26); doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text('t', marginX+4.4, 15.5);
    doc.setTextColor(198,241,53);
    doc.setFont('helvetica','bold'); doc.setFontSize(19);
    doc.text('tintin.', marginX+15, 16);
    doc.setTextColor(246,238,220);
    doc.setFont('helvetica','normal'); doc.setFontSize(11);
    doc.text(`relatório mensal — ${monthLabelOf(currentMonth)}`, marginX+15, 23);

    // ---- dados ----
    const eco = computeEconomiaRealDoMes(currentMonth);
    const previstoMes = computeSaldoInicialDoMes(currentMonth);
    const valorInvestido = computeValorInvestido();
    const { aporte, rendimento: rendimentoTotal } = computeInvestBreakdown();
    const prevMonth = shiftMonth(currentMonth, -1);
    const ecoPrev = computeEconomiaRealDoMes(prevMonth);

    // ---- resumo geral ----
    const ecoColor = eco.economia>=0 ? [31,140,76] : [217,73,26];
    drawCardSection('resumo geral', [
      { label:'valor investido (total)', value: fmtBRL(valorInvestido) },
      { label:'receita do mês', value: fmtBRL(eco.receitas) },
      { label:'saldo inicial (previsto)', value: previstoMes>0?fmtBRL(previstoMes):'sem previsão' },
      { label:'gasto realizado', value: fmtBRL(eco.despesas) + (previstoMes>0?`  (${Math.round(eco.despesas/previstoMes*100)}% do previsto)`:'') },
      { label:'economia do mês', value: fmtBRL(eco.economia), valueColor: ecoColor },
      { label:'   resultado do mês', value: fmtBRL(eco.resultadoDoMes) },
      { label:'   rendimento', value: fmtBRL(eco.rendimento) },
    ]);
    if(eco.overrun>0) drawStatusPill(`estourou o saldo inicial em ${fmtBRL(eco.overrun)}`, [217,73,26]);
    else if(previstoMes>0) drawStatusPill('dentro do previsto', [31,140,76]);
    else drawStatusPill('sem previsão cadastrada pra este mês', [150,150,140]);

    // ---- patrimônio ----
    drawCardSection('patrimônio', [
      { label:'valor investido (total)', value: fmtBRL(valorInvestido) },
      { label:'aporte manual (categoria Investimento)', value: fmtBRL(aporte) },
      { label:'rendimento automático (categoria Rendimento)', value: fmtBRL(rendimentoTotal) },
    ]);

    // ---- comparação com o mês anterior ----
    function compareRow(label, curr, prev, higherIsBetter){
      const delta = curr - prev;
      const improved = higherIsBetter ? delta>=0 : delta<=0;
      const color = delta===0 ? [150,150,140] : (improved ? [31,140,76] : [217,73,26]);
      const sign = delta>=0 ? '+' : '-';
      return { label, value: `${fmtBRL(curr)}  (${sign}${fmtBRL(Math.abs(delta))})`, valueColor: color };
    }
    drawCardSection(`comparação com ${monthLabelOf(prevMonth)}`, [
      compareRow('receita do mês', eco.receitas, ecoPrev.receitas, true),
      compareRow('gasto realizado', eco.despesas, ecoPrev.despesas, false),
      compareRow('economia do mês', eco.economia, ecoPrev.economia, true),
    ]);

    // ---- despesas por categoria (prefere previsão do mês, senão realizado) ----
    const previsaoItemsDespesa = state.budgetItems.filter(b=>b.month===currentMonth && (b.type||'despesa')==='despesa');
    const monthTxReal = txForMonth(currentMonth).filter(t=>t.category!=='Investimento');
    const despesaSource = previsaoItemsDespesa.length ? previsaoItemsDespesa : monthTxReal.filter(t=>t.type==='despesa');
    drawCategoryList(
      `despesas por categoria${previsaoItemsDespesa.length?' (previsto)':''}`,
      buildCatGroups(despesaSource),
      'nenhuma despesa neste mês'
    );

    // ---- receitas por categoria (mesma preferência previsão/realizado que o painel já usa) ----
    const previsaoItemsReceita = state.budgetItems.filter(b=>b.month===currentMonth && (b.type||'despesa')==='receita');
    const receitaSource = previsaoItemsReceita.length ? previsaoItemsReceita : monthTxReal.filter(t=>t.type==='receita');
    drawCategoryList(
      `receitas por categoria${previsaoItemsReceita.length?' (previsto)':''}`,
      buildCatGroups(receitaSource),
      'nenhuma receita neste mês'
    );

    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(160,160,150);
    doc.text(`gerado em ${new Date().toLocaleString('pt-BR')}`, marginX, 290);

    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `tintin-relatorio-${currentMonth}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(pdfUrl), 2000);
    showToast('tintin! relatório PDF gerado');
  }catch(err){
    showToast('erro ao gerar PDF: '+(err && err.message ? err.message : 'tente novamente'));
  }
}
document.getElementById('btnGerarPDF').addEventListener('click', gerarRelatorioPDF);

function renderBar(){
  const months = [];
  let m = currentMonth;
  for(let i=0;i<6;i++){ months.unshift(m); m = shiftMonth(m,-1); }
  const receitas = months.map(ym=> txForMonth(ym).filter(t=>t.type==='receita' && t.category!=='Investimento').reduce((s,t)=>s+t.amount,0));
  const despesas = months.map(ym=> txForMonth(ym).filter(t=>t.type==='despesa' && t.category!=='Investimento').reduce((s,t)=>s+t.amount,0));
  const resultado = months.map((ym,i)=> receitas[i]-despesas[i]);
  const ctx = document.getElementById('barChart').getContext('2d');
  if(barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type:'bar',
    data:{
      labels: months.map(ym=>monthLabelOf(ym).split(' de ')[0].slice(0,3)),
      datasets:[
        { label:'receitas', data:receitas, backgroundColor:'#8FE0A8', borderRadius:8, maxBarThickness:34 },
        { label:'despesas', data:despesas, backgroundColor:'#F4622C', borderRadius:8, maxBarThickness:34 },
        { label:'resultado do mês', data:resultado, type:'line', borderColor:'#10231A', backgroundColor:'#10231A', borderWidth:2.5, pointRadius:3, pointBackgroundColor:'#10231A', tension:0.3, fill:false, order:0 }
      ]
    },
    options:{
      maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom', labels:{ usePointStyle:true, boxWidth:8, font:{family:'Inter'} } } },
      scales:{ y:{ ticks:{ callback:(v)=> 'R$'+v/1000+'k' }, grid:{ color:'#F0EAD9' } }, x:{ grid:{ display:false } } }
    }
  });
}
function renderInvestidoChart(){
  const months = [];
  let m = currentMonth;
  for(let i=0;i<6;i++){ months.unshift(m); m = shiftMonth(m,-1); }
  const today = todayISO();
  const data = months.map(ym=>{
    const asOf = (ym===today.slice(0,7)) ? today : lastDayOfMonth(ym);
    return computeValorInvestidoAsOf(asOf);
  });
  const dataMin = Math.min(...data);
  const dataMax = Math.max(...data);
  const range = dataMax - dataMin;
  const pad = range > 0 ? range * 0.25 : Math.max(dataMax * 0.02, 50);
  const ctx = document.getElementById('investidoChart').getContext('2d');
  if(investidoChart) investidoChart.destroy();
  investidoChart = new Chart(ctx, {
    type:'line',
    data:{
      labels: months.map(ym=>monthLabelOf(ym).split(' de ')[0].slice(0,3)),
      datasets:[
        { label:'valor investido', data, borderColor:'#C6F135', backgroundColor:'rgba(198,241,53,0.25)', borderWidth:2.5, pointRadius:3, pointBackgroundColor:'#C6F135', tension:0.3, fill:true }
      ]
    },
    options:{
      maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{
        y:{ suggestedMin: dataMin - pad, suggestedMax: dataMax + pad, ticks:{ callback:(v)=> 'R$'+v/1000+'k' }, grid:{ color:'#F0EAD9' } },
        x:{ grid:{ display:false } }
      }
    }
  });
}

/* ---------------- Investimentos ---------------- */
// contribuição de uma transação pro valor investido, só pra exibição de sinal
// no extrato — espelha a mesma convenção usada em computeValorInvestidoAsOf,
// sem alterar aquela função.
function investContribution(t){
  if(t.category==='Investimento') return t.type==='despesa' ? t.amount : -t.amount;
  if(t.category==='Rendimento') return t.type==='receita' ? t.amount : -t.amount;
  return 0;
}
function computeInvestBreakdown(){
  const today = todayISO();
  let aporte = state.investedBase || 0;
  let rendimento = 0;
  state.transactions.forEach(t=>{
    if(t.category==='Investimento' && t.date<=today){
      aporte += (t.type==='despesa' ? t.amount : -t.amount);
    }
    if(t.category==='Rendimento' && t.type==='receita' && t.date<=today && t.date>=RENDIMENTO_AUTO_CUTOFF){
      rendimento += t.amount;
    }
  });
  return { aporte, rendimento };
}
function renderInvestimentosChart(){
  const sortedMonths = allMonthsSorted();
  const today = todayISO();
  const lastMonth = today.slice(0,7);
  const firstMonth = sortedMonths[0] || lastMonth;
  const months = [];
  let m = firstMonth;
  while(m <= lastMonth){ months.push(m); m = shiftMonth(m, 1); }
  const data = months.map(ym=>{
    const asOf = (ym===lastMonth) ? today : lastDayOfMonth(ym);
    return computeValorInvestidoAsOf(asOf);
  });
  const dataMin = Math.min(...data);
  const dataMax = Math.max(...data);
  const range = dataMax - dataMin;
  const pad = range > 0 ? range * 0.15 : Math.max(dataMax * 0.02, 50);
  const monthAbbrev = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const labels = months.map(ym=>{
    const [y,mm] = ym.split('-');
    return monthAbbrev[parseInt(mm,10)-1]+'/'+y.slice(2);
  });
  const ctx = document.getElementById('investimentosChart').getContext('2d');
  if(investimentosChart) investimentosChart.destroy();
  investimentosChart = new Chart(ctx, {
    type:'line',
    data:{
      labels,
      datasets:[
        { label:'valor investido', data, borderColor:'#C6F135', backgroundColor:'rgba(198,241,53,0.22)', borderWidth:2.5, pointRadius: months.length>18?0:3, pointBackgroundColor:'#C6F135', tension:0.3, fill:true }
      ]
    },
    options:{
      maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{
        y:{ suggestedMin: dataMin - pad, suggestedMax: dataMax + pad, ticks:{ callback:(v)=> 'R$'+v/1000+'k' }, grid:{ color:'#F0EAD9' } },
        x:{ grid:{ display:false }, ticks:{ maxRotation:0, autoSkip:true, maxTicksLimit:12 } }
      }
    }
  });
}
function renderInvestHistory(){
  const items = state.transactions
    .filter(t=> t.category==='Investimento' || t.category==='Rendimento')
    .slice()
    .sort((a,b)=> b.date.localeCompare(a.date));
  const list = document.getElementById('investHistoryList');
  if(items.length===0){
    list.innerHTML = `<div class="prev-empty">nenhuma movimentação registrada ainda</div>`;
    return;
  }
  list.innerHTML = items.map(t=>{
    const contribution = investContribution(t);
    const sign = contribution>=0 ? 'pos' : 'neg';
    const amtText = contribution>=0 ? '+'+fmtBRL(contribution) : fmtBRL(contribution);
    return `<div class="invest-history-row">
      <span class="ihdate">${fmtDate(t.date).slice(0,5)}</span>
      <span class="ihdesc">${escapeHtml(t.desc)}<span class="ihcat">${escapeHtml(t.category)}</span></span>
      <span class="ihamt ${sign}">${amtText}</span>
    </div>`;
  }).join('');
}
function renderInvestimentos(){
  document.getElementById('investHeroValue').textContent = fmtBRL(computeValorInvestido());
  const { aporte, rendimento } = computeInvestBreakdown();
  document.getElementById('investAporteValue').textContent = fmtBRL(aporte);
  document.getElementById('investRendimentoValue').textContent = fmtBRL(rendimento);
  const total = aporte + rendimento;
  const rendimentoPct = total>0 ? Math.max(0, Math.min(100, rendimento/total*100)) : 0;
  document.getElementById('investBreakdownBarFill').style.width = rendimentoPct+'%';
  renderInvestimentosChart();
  renderInvestHistory();
}

/* --- aportar (aporte manual) --- */
const aportarOverlay = document.getElementById('aportarModalOverlay');
function openAportarModal(){
  document.getElementById('aportarMonth').value = todayISO().slice(0,7);
  document.getElementById('aportarAmount').value = '';
  [document.getElementById('aportarMonth'), document.getElementById('aportarAmount')].forEach(el=>el.classList.remove('invalid'));
  aportarOverlay.classList.add('open');
  setTimeout(()=>document.getElementById('aportarAmount').focus(), 60);
}
function closeAportarModal(){ aportarOverlay.classList.remove('open'); }
document.getElementById('btnAportar').addEventListener('click', openAportarModal);
document.getElementById('aportarModalClose').addEventListener('click', closeAportarModal);
document.getElementById('aportarCancel').addEventListener('click', closeAportarModal);
aportarOverlay.addEventListener('click', (e)=>{ if(e.target===aportarOverlay) closeAportarModal(); });
guardAsyncClick(document.getElementById('aportarSaveBtn'), async ()=>{
  const monthEl = document.getElementById('aportarMonth');
  const amountEl = document.getElementById('aportarAmount');
  [monthEl, amountEl].forEach(el=>el.classList.remove('invalid'));
  const month = monthEl.value;
  const amount = parseAmount(amountEl.value);
  const invalids = [];
  if(!month) invalids.push(monthEl);
  if(amountEl.value==='' || isNaN(amount) || amount<=0) invalids.push(amountEl);
  if(invalids.length){
    invalids.forEach(el=>el.classList.add('invalid'));
    invalids[0].focus();
    showToast('preencha os campos destacados em laranja');
    return;
  }
  pushUndo();
  const today = todayISO();
  // se for o mês atual, usa a data de hoje (senão a data ficaria no futuro,
  // já que o último dia do mês corrente ainda não chegou, e o aporte não
  // apareceria no valor investido até lá); em meses passados, usa o último dia
  const aporteDate = (month===today.slice(0,7)) ? today : lastDayOfMonth(month);
  state.transactions.push({
    id: crypto.randomUUID(),
    date: aporteDate,
    desc: 'Aporte manual',
    category: 'Investimento',
    type: 'despesa',
    amount,
    tags: ['aporte-manual']
  });
  await persistTx();
  closeAportarModal();
  renderDashboard();
  renderInvestimentos();
  showToast('tintin! aporte registrado', true);
});

/* --- retirar (resgate manual) --- */
const retirarOverlay = document.getElementById('retirarModalOverlay');
function openRetirarModal(){
  document.getElementById('retirarMonth').value = todayISO().slice(0,7);
  document.getElementById('retirarAmount').value = '';
  [document.getElementById('retirarMonth'), document.getElementById('retirarAmount')].forEach(el=>el.classList.remove('invalid'));
  retirarOverlay.classList.add('open');
  setTimeout(()=>document.getElementById('retirarAmount').focus(), 60);
}
function closeRetirarModal(){ retirarOverlay.classList.remove('open'); }
document.getElementById('btnRetirar').addEventListener('click', openRetirarModal);
document.getElementById('retirarModalClose').addEventListener('click', closeRetirarModal);
document.getElementById('retirarCancel').addEventListener('click', closeRetirarModal);
retirarOverlay.addEventListener('click', (e)=>{ if(e.target===retirarOverlay) closeRetirarModal(); });
guardAsyncClick(document.getElementById('retirarSaveBtn'), async ()=>{
  const monthEl = document.getElementById('retirarMonth');
  const amountEl = document.getElementById('retirarAmount');
  [monthEl, amountEl].forEach(el=>el.classList.remove('invalid'));
  const month = monthEl.value;
  const amount = parseAmount(amountEl.value);
  const invalids = [];
  if(!month) invalids.push(monthEl);
  if(amountEl.value==='' || isNaN(amount) || amount<=0) invalids.push(amountEl);
  if(invalids.length){
    invalids.forEach(el=>el.classList.add('invalid'));
    invalids[0].focus();
    showToast('preencha os campos destacados em laranja');
    return;
  }
  pushUndo();
  const today = todayISO();
  // mesma regra do aporte: mês atual usa a data de hoje, meses passados usam o último dia
  const retiradaDate = (month===today.slice(0,7)) ? today : lastDayOfMonth(month);
  state.transactions.push({
    id: crypto.randomUUID(),
    date: retiradaDate,
    desc: 'Retirada de investimento',
    category: 'Investimento',
    type: 'receita', // receita na categoria "Investimento" = resgate, reduz o valor investido (mesma convenção de computeValorInvestidoAsOf)
    amount,
    tags: ['retirada-manual']
  });
  await persistTx();
  closeRetirarModal();
  renderDashboard();
  renderInvestimentos();
  showToast('tintin! retirada registrada', true);
});

/* --- simular patrimônio futuro --- */
// pura função de cálculo: reusa computeValorInvestido() como ponto de partida
// e computeBudgetTotal() mês a mês — não mexe em nenhuma das duas.
function computeSimulacaoPatrimonio(startMonth, endMonth){
  const startValue = computeValorInvestido();
  const months = [];
  let m = startMonth;
  while(m <= endMonth){
    // segue o mesmo método do card "economia do mês" do painel: a receita prevista
    // do mês M financia o teto de gasto do mês SEGUINTE (M+1) — não é M contra ele mesmo.
    const nextM = shiftMonth(m, 1);
    const receita = computeBudgetTotal(m, 'receita');
    const despesaProximo = computeBudgetTotal(nextM, 'despesa');
    const hasPrevisao = receita>0 || despesaProximo>0;
    months.push({ month:m, economia: receita-despesaProximo, hasPrevisao });
    m = nextM;
  }
  const total = months.reduce((acc,mo)=> acc + (mo.hasPrevisao ? mo.economia : 0), startValue);
  const missingCount = months.filter(mo=>!mo.hasPrevisao).length;
  return { startValue, startMonth, endMonth, months, total, missingCount };
}

const simOverlay = document.getElementById('simModalOverlay');
let simStartMonth = null;
let simCustomMonth = null;

function updateSimRangeLabels(){
  document.getElementById('simStartLabel').textContent = monthLabelOf(simStartMonth);
  document.getElementById('simCustomLabel').textContent = monthLabelOf(simCustomMonth);
}
function openSimModal(){
  document.getElementById('simIntro').style.display = '';
  document.getElementById('simResult').style.display = 'none';
  simStartMonth = todayISO().slice(0,7);
  simCustomMonth = shiftMonth(simStartMonth, 1);
  updateSimRangeLabels();
  simOverlay.classList.add('open');
}
function closeSimModal(){ simOverlay.classList.remove('open'); }
document.getElementById('btnSimular').addEventListener('click', openSimModal);
document.getElementById('simModalClose').addEventListener('click', closeSimModal);
simOverlay.addEventListener('click', (e)=>{ if(e.target===simOverlay) closeSimModal(); });

document.getElementById('simStartPrev').addEventListener('click', ()=>{
  const minMonth = todayISO().slice(0,7);
  const prev = shiftMonth(simStartMonth, -1);
  if(prev < minMonth) return; // não simula pra trás do mês atual
  simStartMonth = prev;
  updateSimRangeLabels();
});
document.getElementById('simStartNext').addEventListener('click', ()=>{
  simStartMonth = shiftMonth(simStartMonth, 1);
  if(simStartMonth > simCustomMonth) simCustomMonth = simStartMonth; // arrasta o fim junto se precisar
  updateSimRangeLabels();
});
document.getElementById('simCustomPrev').addEventListener('click', ()=>{
  const prev = shiftMonth(simCustomMonth, -1);
  if(prev < simStartMonth) return; // não deixa o fim ficar antes do início
  simCustomMonth = prev;
  updateSimRangeLabels();
});
document.getElementById('simCustomNext').addEventListener('click', ()=>{
  simCustomMonth = shiftMonth(simCustomMonth, 1);
  updateSimRangeLabels();
});
document.getElementById('simCustomBtn').addEventListener('click', ()=> renderSimResult(simStartMonth, simCustomMonth));
document.getElementById('simShortcutYear').addEventListener('click', ()=>{ const s=todayISO().slice(0,7); renderSimResult(s, todayISO().slice(0,4)+'-12'); });
document.getElementById('simShortcut3').addEventListener('click', ()=>{ const s=todayISO().slice(0,7); renderSimResult(s, shiftMonth(s,3)); });
document.getElementById('simShortcut6').addEventListener('click', ()=>{ const s=todayISO().slice(0,7); renderSimResult(s, shiftMonth(s,6)); });

function renderSimResult(startMonth, endMonth){
  const sim = computeSimulacaoPatrimonio(startMonth, endMonth);
  // soma só do que o período em si deve gerar, sem contar o que já está investido
  // hoje — derivado dos mesmos números que computeSimulacaoPatrimonio já calculou.
  const periodSum = sim.total - sim.startValue;
  const startLabel = monthLabelOf(startMonth);
  const endLabel = monthLabelOf(endMonth);
  const periodLabel = startLabel===endLabel ? startLabel : `${startLabel} até ${endLabel}`;
  const warningHtml = sim.missingCount>0
    ? `<div class="sim-warning">faltam ${sim.missingCount} ${sim.missingCount===1?'mês':'meses'} sem previsão cadastrada — a simulação considera só os meses já planejados.</div>`
    : '';
  const monthRowsHtml = sim.months.map(mo=>`
    <div class="sim-month-row${mo.hasPrevisao?'':' empty'}">
      <span>${monthLabelOf(mo.month)}</span>
      <span class="smv">${mo.hasPrevisao ? fmtBRL(mo.economia) : 'sem previsão'}</span>
    </div>`).join('');
  document.getElementById('simIntro').style.display = 'none';
  const resultEl = document.getElementById('simResult');
  resultEl.style.display = '';
  resultEl.innerHTML = `
    <div class="sim-result-label">patrimônio projetado (${periodLabel})</div>
    <div class="sim-result-value">${fmtBRL(sim.total)}</div>
    <p class="sim-result-context">considerando o que você planejou nesse período, é isso que seu patrimônio investido deve valer no fim de ${endLabel}.</p>
    <div class="sim-result-secondary">
      <div class="sim-result-secondary-label">só o que ${periodLabel} deve gerar (sem contar o que você já tem investido hoje)</div>
      <div class="sim-result-secondary-value ${periodSum>=0?'pos':'neg'}">${periodSum>=0?'+':''}${fmtBRL(periodSum)}</div>
    </div>
    ${warningHtml}
    <div class="sim-month-list">${monthRowsHtml}</div>
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="simBack">simular outro período</button>
      <button type="button" class="btn-primary" id="simDone">fechar</button>
    </div>`;
  document.getElementById('simBack').addEventListener('click', ()=>{
    document.getElementById('simIntro').style.display = '';
    resultEl.style.display = 'none';
  });
  document.getElementById('simDone').addEventListener('click', closeSimModal);
}

/* ---------------- Saldos ---------------- */
function daysInMonth(ym){
  const [y,m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
document.getElementById('saldosPrevMonth').addEventListener('click', ()=>{ saldosMonth = shiftMonth(saldosMonth,-1); renderSaldos(); });
document.getElementById('saldosNextMonth').addEventListener('click', ()=>{ saldosMonth = shiftMonth(saldosMonth,1); renderSaldos(); });

function renderSaldos(){
  document.getElementById('saldosMonthLabel').textContent = monthLabelOf(saldosMonth);
  const nDays = daysInMonth(saldosMonth);
  const today = todayISO();
  const autoInitial = computeBudgetTotal(saldosMonth, 'despesa');
  const hasOverride = state.saldoInicialOverrides[saldosMonth] != null;
  const initial = hasOverride ? state.saldoInicialOverrides[saldosMonth] : autoInitial;
  const temPrevisaoDespesa = autoInitial>0;
  const temPrevisaoReceita = computeBudgetTotal(saldosMonth, 'receita')>0;
  let saldoInicialDia = initial, totalEntradas = 0, totalSaidas = 0, running = initial;
  const rowsHtml = [];
  for(let d=1; d<=nDays; d++){
    const dateStr = saldosMonth+'-'+String(d).padStart(2,'0');
    const dayTx = state.transactions.filter(t=>t.date===dateStr && t.category!=='Investimento');
    const entradasReais = dayTx.filter(t=>t.type==='receita').reduce((s,t)=>s+t.amount,0);
    const entradasPrevistas = state.budgetItems.filter(b=>b.date===dateStr && (b.type||'despesa')==='receita' && !b.paid && !b.variable).reduce((s,b)=>s+b.amount,0);
    const entradas = entradasReais + entradasPrevistas;
    const saidasReais = dayTx.filter(t=>t.type==='despesa').reduce((s,t)=>s+t.amount,0);
    const saidasPrevistas = state.budgetItems.filter(b=>b.date===dateStr && (b.type||'despesa')==='despesa' && !b.paid && !b.variable).reduce((s,b)=>s+b.amount,0);
    const saidas = saidasReais + saidasPrevistas;
    const saldoDoDia = saldoInicialDia + entradas - saidas;
    totalEntradas += entradas; totalSaidas += saidas;
    const isToday = dateStr===today;
    let saldoClass;
    if(saldoDoDia<0) saldoClass = 'saldo-neg';
    else if(saldoDoDia<1000) saldoClass = 'saldo-medio';
    else saldoClass = 'saldo-alto';
    const saidasLabel = saidas>0
      ? `<span class="saidas-previsto" onclick="showDayDetails('${dateStr}','despesa')">${fmtBRL(saidas)}</span>${(saidasPrevistas>0 && saidasReais===0)?' <span class="muted-tag">(previsto)</span>':''}`
      : '—';
    const entradasLabel = entradas>0
      ? `<span class="entradas-clicavel" onclick="showDayDetails('${dateStr}','receita')">${fmtBRL(entradas)}</span>${(entradasPrevistas>0 && entradasReais===0)?' <span class="muted-tag">(previsto)</span>':''}`
      : '—';
    const saldoInicialCell = d===1
      ? `<div style="display:flex;align-items:center;gap:6px;">
          <input type="text" inputmode="decimal" class="saldo-inicial-input" data-month="${saldosMonth}" value="${initial.toFixed(2).replace('.', ',')}">
          ${hasOverride ? `<button type="button" class="icon-btn" onclick="resetSaldoInicial('${saldosMonth}')" aria-label="voltar ao valor automático" title="voltar ao automático (previsão)">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 4v6h6M20 20v-6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15a8 8 0 0 0 14.5 3M19.5 9A8 8 0 0 0 5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>` : ''}
        </div>`
      : '—';
    rowsHtml.push(`<tr class="${isToday?'row-today':''}">
      <td>${String(d).padStart(2,'0')}</td>
      <td class="saldo-inicial-cell">${saldoInicialCell}</td>
      <td class="${entradas>0?'amt receita':'empty-cell'}">${entradasLabel}</td>
      <td class="${saidas>0?'amt despesa':'empty-cell'}">${saidasLabel}</td>
      <td class="saldo-cell ${saldoClass}">${fmtBRL(saldoDoDia)}</td>
      <td>
        <button class="icon-btn" onclick="openNewForDate('${dateStr}')" aria-label="adicionar lançamento neste dia">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>
      </td>
    </tr>`);
    saldoInicialDia = saldoDoDia;
  }
  running = saldoInicialDia;
  document.getElementById('saldosTableBody').innerHTML = rowsHtml.join('');
  document.getElementById('saldosTableFoot').innerHTML = `
    <tr>
      <td><strong>total</strong></td>
      <td class="saldo-inicial-cell">${fmtBRL(initial)}</td>
      <td class="amt receita">${fmtBRL(totalEntradas)}</td>
      <td class="amt despesa">${fmtBRL(totalSaidas)}</td>
      <td class="saldo-cell">${fmtBRL(running)}</td>
      <td></td>
    </tr>`;
}
document.getElementById('saldosTableBody').addEventListener('change', async (e)=>{
  if(!e.target.classList.contains('saldo-inicial-input')) return;
  const month = e.target.dataset.month;
  const val = parseAmount(e.target.value);
  if(isNaN(val)){
    showToast('valor inválido — mantendo o anterior');
    renderSaldos();
    return;
  }
  const hadOverride = Object.prototype.hasOwnProperty.call(state.saldoInicialOverrides, month);
  const oldVal = state.saldoInicialOverrides[month];
  pushUndo(async ()=>{
    if(hadOverride){
      state.saldoInicialOverrides[month] = oldVal;
      try{ await dbSetSaldoInicialOverride(month, oldVal); }catch(err){}
    } else {
      delete state.saldoInicialOverrides[month];
      try{ await dbDeleteSaldoInicialOverride(month); }catch(err){}
    }
    await persistSaldoInicialOverrides();
  });
  state.saldoInicialOverrides[month] = val;
  try{ await dbSetSaldoInicialOverride(month, val); }catch(err){ showToast('erro ao salvar: '+(err.message||'')); }
  await persistSaldoInicialOverrides();
  renderSaldos();
  showToast('tintin! saldo inicial atualizado', true);
});
document.getElementById('saldosTableBody').addEventListener('keydown', (e)=>{
  if(e.target.classList.contains('saldo-inicial-input') && e.key==='Enter'){
    e.preventDefault();
    e.target.blur();
  }
});
window.resetSaldoInicial = async function(month){
  const oldVal = state.saldoInicialOverrides[month];
  pushUndo(async ()=>{
    state.saldoInicialOverrides[month] = oldVal;
    try{ await dbSetSaldoInicialOverride(month, oldVal); }catch(err){}
    await persistSaldoInicialOverrides();
  });
  delete state.saldoInicialOverrides[month];
  try{ await dbDeleteSaldoInicialOverride(month); }catch(err){ showToast('erro ao resetar: '+(err.message||'')); }
  await persistSaldoInicialOverrides();
  renderSaldos();
  showToast('saldo inicial voltou a ser calculado pela previsão', true);
};
const dayDetailsOverlay = document.getElementById('dayDetailsOverlay');
let dayDetailsState = null; // {dateStr, type} of the currently open modal, for in-place refresh
function renderDayDetailsModal(dateStr, type){
  dayDetailsState = { dateStr, type };
  const realItems = state.transactions.filter(t=>t.date===dateStr && t.type===type && t.category!=='Investimento');
  const forecastItems = state.budgetItems.filter(b=>b.date===dateStr && (b.type||'despesa')===type && !b.paid && !b.variable);
  document.getElementById('dayDetailsTitle').textContent = `${type==='receita'?'entradas':'saídas'} — ${fmtDate(dateStr)}`;
  const list = document.getElementById('dayDetailsList');
  const realHtml = realItems.map(t=>`
    <div class="daydetail-row">
      <span class="ddesc">${escapeHtml(t.category)} — ${escapeHtml(t.desc)}</span>
      <span class="damt">${fmtBRL(t.amount)}</span>
    </div>`).join('');
  const forecastHtml = forecastItems.map(b=>`
    <div class="daydetail-row previsto">
      <span class="ddesc">${escapeHtml(b.category)} — ${escapeHtml(b.desc)} <span class="muted-tag">(previsto)</span></span>
      <span class="damt">${fmtBRL(b.amount)}</span>
      <button type="button" class="btn-pago" onclick="markBudgetItemPaid('${b.id}')">pago</button>
    </div>`).join('');
  list.innerHTML = (realHtml + forecastHtml) || '<div class="prev-empty">nada neste dia</div>';
  const total = realItems.reduce((s,t)=>s+t.amount,0) + forecastItems.reduce((s,b)=>s+b.amount,0);
  document.getElementById('dayDetailsTotal').textContent = `total: ${fmtBRL(total)}`;
}
window.showDayDetails = function(dateStr, type){
  const realItems = state.transactions.filter(t=>t.date===dateStr && t.type===type && t.category!=='Investimento');
  const forecastItems = state.budgetItems.filter(b=>b.date===dateStr && (b.type||'despesa')===type && !b.paid && !b.variable);
  if(realItems.length===0 && forecastItems.length===0) return;
  renderDayDetailsModal(dateStr, type);
  dayDetailsOverlay.classList.add('open');
};
window.showDayRealDetails = window.showDayDetails;
window.showDayForecastDetails = function(dateStr, type='despesa'){ return window.showDayDetails(dateStr, type); };
window.markBudgetItemPaid = async function(id){
  try{
    const item = state.budgetItems.find(b=>b.id===id);
    if(!item){
      showToast('erro: não encontrei essa despesa/receita prevista (id inválido) — tenta fechar e abrir o dia de novo');
      return;
    }
    const defaultValue = item.amount.toFixed(2).replace('.', ',');
    const input = await showDialog({
      title: 'confirmar pagamento',
      message: `confirmar pagamento de "${item.desc}"? ajuste o valor abaixo se ele veio diferente do previsto:`,
      withInput: true,
      defaultValue,
      okLabel: 'confirmar'
    });
    if(input===null) return; // cancelado
    const finalAmount = parseAmount(input);
    if(isNaN(finalAmount) || finalAmount<=0){
      showToast('valor inválido, tenta de novo');
      return;
    }

    pushUndo();
    const nid = crypto.randomUUID();
    state.transactions.push({
      id: nid, date: item.date, desc: item.desc, category: item.category,
      amount: finalAmount, type: item.type||'despesa', tags: ['pago-da-previsao']
    });
    item.paid = true; // stays in the month's fixed ceiling total, just excluded from "still pending" views
    await persistTx();
    await persistBudgetItems();
    renderSaldos();
    renderRealizado();
    renderDashboard();
    if(document.getElementById('view-previsao').classList.contains('active')) renderPrevisao();
    if(dayDetailsState) renderDayDetailsModal(dayDetailsState.dateStr, dayDetailsState.type);
    showToast('tintin! marcado como pago e movido pra realizado', true);
  }catch(err){
    showToast('erro ao marcar como pago: ' + (err && err.message ? err.message : 'tente novamente'));
  }
};
document.getElementById('dayDetailsClose').addEventListener('click', ()=> dayDetailsOverlay.classList.remove('open'));
dayDetailsOverlay.addEventListener('click', (e)=>{ if(e.target===dayDetailsOverlay) dayDetailsOverlay.classList.remove('open'); });
window.openNewForDate = function(dateStr){
  editingId = null;
  document.getElementById('modalTitle').textContent = 'novo lançamento';
  document.getElementById('txId').value='';
  document.getElementById('txDate').value = dateStr;
  document.getElementById('txDesc').value='';
  document.getElementById('txAmount').value='';
  document.getElementById('txTags').value='';
  document.getElementById('txRepeat').value='none';
  document.getElementById('txRepeat').closest('.field').style.display = '';
  setModalType('despesa');
  openModal();
};

/* ---------------- Previsão ---------------- */
function lastDayOfMonth(ym){
  return ym+'-'+String(daysInMonth(ym)).padStart(2,'0');
}
document.getElementById('prevPrevMonth').addEventListener('click', ()=>{ previsaoMonth = shiftMonth(previsaoMonth,-1); renderPrevisao(); });
document.getElementById('prevNextMonth').addEventListener('click', ()=>{ previsaoMonth = shiftMonth(previsaoMonth,1); renderPrevisao(); });
document.getElementById('previsaoBusca').addEventListener('input', renderPrevisao);

function renderPrevisao(){
  document.getElementById('previsaoMonthLabel').textContent = monthLabelOf(previsaoMonth);
  renderPrevisaoColumn('despesa', 'previsaoListDespesa', 'previsaoTotalDespesa');
  renderPrevisaoColumn('receita', 'previsaoListReceita', 'previsaoTotalReceita');
}
function renderPrevisaoColumn(type, listId, totalId){
  const isDespesa = type==='despesa';
  const cats = (isDespesa ? state.categories.despesa : state.categories.receita).filter(c=>c!=='Investimento');
  const search = (document.getElementById('previsaoBusca').value||'').trim().toLowerCase();
  const list = document.getElementById(listId);
  list.innerHTML = cats.map((cat, idx)=>{
    let items = state.budgetItems.filter(b=>b.month===previsaoMonth && b.category===cat && (b.type||'despesa')===type);
    if(search) items = items.filter(b=> b.desc.toLowerCase().includes(search));
    const total = items.reduce((s,b)=>s+b.amount,0);
    const matchesSearch = !search || cat.toLowerCase().includes(search) || items.length>0;
    if(search && !matchesSearch) return '';
    const itemsHtml = items.length
      ? items.map(b=>`<div class="prev-item-row">
          <span class="prev-item-desc">${escapeHtml(b.desc)}${b.variable?' <span class="variable-tag">orçamento do mês</span>':''}${b.seriesTotal>1?` <span class="muted-tag">(${b.seriesIndex}/${b.seriesTotal})</span>`:''}${b.paid?' <span class="muted-tag" style="color:#1F8C4C;font-weight:700;">✓ pago</span>':''}</span>
          <span class="prev-item-amt">${fmtBRL(b.amount)}</span>
          <button type="button" class="icon-btn" onclick="openBudgetItemModal(null, '${b.id}')" aria-label="editar previsão">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="icon-btn danger" onclick="deleteBudgetItem('${b.id}')" aria-label="excluir previsão">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-7 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>`).join('')
      : `<div class="prev-empty">nenhuma ${isDespesa?'despesa':'receita'} prevista nesta categoria${search?' pra essa busca':' ainda'}</div>`;
    return `<div class="prev-cat${search && items.length ? ' open':''}" id="prevCat-${type}-${idx}">
      <div class="prev-cat-header" onclick="togglePrevCat('${type}', ${idx})">
        <span class="cat-dot" style="background:${colorFor(cat)}"></span>
        <span class="cname" style="flex:1;">${cat}</span>
        <span class="prev-cat-total">${fmtBRL(total)}</span>
        <button type="button" class="icon-btn" onclick="event.stopPropagation(); openBudgetItemModal('${escapeAttr(cat)}', null, '${type}')" aria-label="adicionar previsão">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>
        <button type="button" class="icon-btn" onclick="event.stopPropagation(); renameCategory('${type}','${escapeAttr(cat)}')" aria-label="renomear categoria">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="icon-btn danger" onclick="event.stopPropagation(); deleteCategory('${type}','${escapeAttr(cat)}')" aria-label="excluir categoria">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-7 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <svg class="prev-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="prev-cat-items">${itemsHtml}</div>
    </div>`;
  }).join('');
  document.getElementById(totalId).textContent = fmtBRL(computeBudgetTotal(previsaoMonth, type));
}
window.togglePrevCat = function(type, idx){
  const wrap = document.getElementById('prevCat-'+type+'-'+idx);
  if(wrap) wrap.classList.toggle('open');
};

/* --- nova despesa prevista modal --- */
const budgetOverlay = document.getElementById('budgetModalOverlay');
let editingBudgetItemId = null;
function openBudgetItemModal(presetCategory, editId, presetType){
  editingBudgetItemId = editId || null;
  const sel = document.getElementById('bCategory');

  const titleEl = budgetOverlay.querySelector('h2');
  const repeatField = document.getElementById('bRepeatType').closest('.field');
  const dateField = document.getElementById('bDateField');
  const variableCheckbox = document.getElementById('bVariable');

  if(editingBudgetItemId){
    const item = state.budgetItems.find(b=>b.id===editingBudgetItemId);
    if(item){
      const itemType = item.type || 'despesa';
      budgetModalType = itemType;
      sel.innerHTML = (itemType==='despesa' ? state.categories.despesa : state.categories.receita).filter(c=>c!=='Investimento').map(c=>`<option value="${c}">${c}</option>`).join('');
      if(titleEl) titleEl.textContent = `editar ${itemType==='despesa'?'despesa':'receita'} prevista`;
      sel.value = item.category;
      document.getElementById('bDate').value = item.date || (item.month+'-01');
      document.getElementById('bDesc').value = item.desc;
      document.getElementById('bAmount').value = item.amount.toFixed(2).replace('.', ',');
      document.getElementById('bRepeatType').value = 'once';
      document.getElementById('bRepeatTimesField').style.display = 'none';
      if(repeatField) repeatField.style.display = 'none';
      variableCheckbox.checked = !!item.variable;
      dateField.style.display = item.variable ? 'none' : '';
    }
  } else {
    budgetModalType = presetType || 'despesa';
    sel.innerHTML = (budgetModalType==='despesa' ? state.categories.despesa : state.categories.receita).filter(c=>c!=='Investimento').map(c=>`<option value="${c}">${c}</option>`).join('');
    if(titleEl) titleEl.textContent = `nova ${budgetModalType==='despesa'?'despesa':'receita'} prevista`;
    if(presetCategory) sel.value = presetCategory;
    const defaultDay = (previsaoMonth===todayISO().slice(0,7)) ? todayISO() : previsaoMonth+'-01';
    document.getElementById('bDate').value = defaultDay;
    document.getElementById('bDesc').value = '';
    document.getElementById('bAmount').value = '';
    document.getElementById('bRepeatType').value = 'once';
    document.getElementById('bRepeatTimes').value = '3';
    document.getElementById('bRepeatTimesField').style.display = 'none';
    if(repeatField) repeatField.style.display = '';
    variableCheckbox.checked = false;
    dateField.style.display = '';
  }
  [document.getElementById('bDate'), document.getElementById('bDesc'), document.getElementById('bAmount')].forEach(el=>el.classList.remove('invalid'));
  budgetOverlay.classList.add('open');
  setTimeout(()=>document.getElementById('bDesc').focus(), 60);
}
window.openBudgetItemModal = openBudgetItemModal;
function closeBudgetModal(){ budgetOverlay.classList.remove('open'); editingBudgetItemId = null; }
document.getElementById('budgetModalClose').addEventListener('click', closeBudgetModal);
document.getElementById('budgetModalCancel').addEventListener('click', closeBudgetModal);
budgetOverlay.addEventListener('click', (e)=>{ if(e.target===budgetOverlay) closeBudgetModal(); });
document.getElementById('bVariable').addEventListener('change', (e)=>{
  document.getElementById('bDateField').style.display = e.target.checked ? 'none' : '';
});
document.getElementById('bRepeatType').addEventListener('change', (e)=>{
  document.getElementById('bRepeatTimesField').style.display = e.target.value==='times' ? '' : 'none';
});
['bDate','bDesc','bAmount','bRepeatTimes'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('budgetSaveBtn').click(); }
  });
});
guardAsyncClick(document.getElementById('budgetSaveBtn'), async (e)=>{
  e.preventDefault();
  try{
    const dateEl = document.getElementById('bDate');
    const descEl = document.getElementById('bDesc');
    const amountEl = document.getElementById('bAmount');
    const isVariable = document.getElementById('bVariable').checked;
    [dateEl, descEl, amountEl].forEach(el=>el.classList.remove('invalid'));
    const category = document.getElementById('bCategory').value;
    const desc = descEl.value.trim();
    const amount = parseAmount(amountEl.value);
    // variable budgets aren't tied to a specific day — use month-01 as an internal placeholder,
    // ignoring whatever's left in the (hidden) date field
    const date = isVariable ? previsaoMonth+'-01' : dateEl.value;

    const invalids = [];
    if(!isVariable && !date) invalids.push(dateEl);
    if(!desc) invalids.push(descEl);
    if(amountEl.value==='' || isNaN(amount) || amount<=0) invalids.push(amountEl);
    if(invalids.length){
      invalids.forEach(el=>el.classList.add('invalid'));
      invalids[0].focus();
      showToast('preencha os campos destacados em laranja');
      return;
    }

    if(editingBudgetItemId){
      const item = state.budgetItems.find(b=>b.id===editingBudgetItemId);
      if(!item){ closeBudgetModal(); return; }
      const itemTypeLabel = item.type==='receita' ? 'receita' : 'despesa';
      const seriesItems = item.seriesId ? state.budgetItems.filter(b=>b.seriesId===item.seriesId) : [];

      let applyToAll = false;
      if(seriesItems.length>1){
        const choice = await showDialog({
          title: `editar ${itemTypeLabel} prevista`,
          message: `Você alterou "${desc}" para ${fmtBRL(amount)}. Aplicar só a este mês, ou a todas as ${seriesItems.length} ocorrências dessa série?`,
          okLabel: 'só este mês',
          extraLabel: `todas as ${seriesItems.length}`
        });
        if(!choice) return;
        applyToAll = choice==='extra';
      }

      pushUndo();
      if(applyToAll){
        // categoria/descrição/valor/orçamento-variável propagam pra série toda.
        // a data sincroniza só o DIA do mês (ex: dia 1 -> dia 5 em todas) — cada
        // item continua no seu próprio mês/ano, só ajustando pra itens variáveis
        // (que não têm um dia fixo, então a data não se aplica a eles).
        const newDay = isVariable ? null : parseInt(date.slice(8,10), 10);
        seriesItems.forEach(b=>{
          Object.assign(b, { category, desc, amount, variable: isVariable });
          if(!isVariable && newDay){
            const clampedDay = Math.min(newDay, daysInMonth(b.month));
            b.date = b.month+'-'+String(clampedDay).padStart(2,'0');
          }
        });
      } else {
        Object.assign(item, { category, desc, amount, date, month: date.slice(0,7), variable: isVariable });
      }
      await persistBudgetItems();
      closeBudgetModal();
      renderPrevisao();
      if(previsaoMonth===currentMonth) renderDashboard();
      showToast(applyToAll ? `tintin! ${itemTypeLabel} prevista atualizada em todas as ${seriesItems.length} ocorrências` : `tintin! ${itemTypeLabel} prevista atualizada`, true);
      return;
    }

    const repeatType = document.getElementById('bRepeatType').value;
    const timesRaw = parseInt(document.getElementById('bRepeatTimes').value, 10);
    const times = repeatType==='times' ? Math.max(2, Math.min(36, isNaN(timesRaw)?3:timesRaw)) : 1;
    const seriesId = times>1 ? 'bs_'+Date.now() : null;
    pushUndo();
    for(let i=0;i<times;i++){
      const nid = crypto.randomUUID();
      const itemDate = i===0 ? date : addMonths(date, i);
      const ym = itemDate.slice(0,7);
      state.budgetItems.push({ id: nid, category, desc, amount, date: itemDate, month: ym, type: budgetModalType, variable: isVariable, seriesId, seriesIndex: i+1, seriesTotal: times });
    }
    await persistBudgetItems();
    closeBudgetModal();
    renderPrevisao();
    if(previsaoMonth===currentMonth) renderDashboard();
    const typeLabel = budgetModalType==='receita' ? 'receita' : 'despesa';
    showToast(times>1 ? `tintin! ${typeLabel} prevista para ${times} meses` : `tintin! ${typeLabel} prevista adicionada`, true);
  }catch(err){
    showToast('erro ao salvar: '+(err && err.message ? err.message : 'tente novamente'));
  }
});
window.deleteBudgetItem = async function(id){
  const item = state.budgetItems.find(b=>b.id===id);
  if(!item) return;
  const label = (item.type==='receita') ? 'receita' : 'despesa';
  const seriesItems = item.seriesId ? state.budgetItems.filter(b=>b.seriesId===item.seriesId) : [];

  let choice;
  if(seriesItems.length>1){
    choice = await showDialog({
      title: `excluir ${label} prevista`,
      message: `"${item.desc}" se repete em ${seriesItems.length} meses (${item.seriesIndex}/${item.seriesTotal}). Excluir só este mês, ou todas as ${seriesItems.length} ocorrências?`,
      okLabel: 'só este mês',
      extraLabel: `todas as ${seriesItems.length}`
    });
    if(!choice) return;
  } else {
    const ok = await showDialog({title:`excluir ${label} prevista`, message:`excluir esta ${label} da previsão deste mês?`, okLabel:'excluir'});
    if(!ok) return;
    choice = 'ok';
  }

  pushUndo();
  if(choice==='extra'){
    state.budgetItems = state.budgetItems.filter(b=>b.seriesId!==item.seriesId);
  } else {
    state.budgetItems = state.budgetItems.filter(b=>b.id!==id);
  }
  await persistBudgetItems();
  renderPrevisao();
  if(previsaoMonth===currentMonth) renderDashboard();
  showToast(choice==='extra' ? `todas as ${seriesItems.length} ocorrências removidas` : `${label} prevista removida`, true);
};

/* ---------------- Realizado ---------------- */
function computeCategoryBudgetTotal(ym, category, type='despesa'){
  return state.budgetItems.filter(b=>b.month===ym && b.category===category && (b.type||'despesa')===type).reduce((s,b)=>s+b.amount,0);
}
document.getElementById('realizadoPrevMonth').addEventListener('click', ()=>{ realizadoMonth = shiftMonth(realizadoMonth,-1); clearSelection(); renderRealizado(); });
document.getElementById('realizadoNextMonth').addEventListener('click', ()=>{ realizadoMonth = shiftMonth(realizadoMonth,1); clearSelection(); renderRealizado(); });
document.getElementById('realizadoBusca').addEventListener('input', renderRealizado);

function renderRealizado(){
  document.getElementById('realizadoMonthLabel').textContent = monthLabelOf(realizadoMonth);
  renderRealizadoColumn('despesa', 'realizadoListDespesa', 'realizadoTotalDespesa');
  renderRealizadoColumn('receita', 'realizadoListReceita', 'realizadoTotalReceita');
}
function renderRealizadoColumn(type, listId, totalId){
  const isDespesa = type==='despesa';
  const cats = (isDespesa ? state.categories.despesa : state.categories.receita).filter(c=>c!=='Investimento');
  const search = (document.getElementById('realizadoBusca').value||'').trim().toLowerCase();
  const monthTotal = (isDespesa ? computeSaidasReaisDoMes(realizadoMonth) : computeReceitasReaisDoMes(realizadoMonth));
  document.getElementById(totalId).textContent = fmtBRL(monthTotal);
  const list = document.getElementById(listId);
  list.innerHTML = cats.map((cat, idx)=>{
    let items = state.transactions.filter(t=>t.date.slice(0,7)===realizadoMonth && t.category===cat && t.type===type);
    items.sort((a,b)=> a.date.localeCompare(b.date) || a.id-b.id);
    if(search) items = items.filter(t=> t.desc.toLowerCase().includes(search));
    const total = items.reduce((s,t)=>s+t.amount,0);
    const previsto = computeCategoryBudgetTotal(realizadoMonth, cat, type);
    const pctInfo = previsto>0
      ? `<div class="muted-tag" style="font-weight:500;margin-top:2px;">previsto: ${fmtBRL(previsto)} (${Math.round(total/previsto*100)}%)</div>`
      : '';
    const matchesSearch = !search || cat.toLowerCase().includes(search) || items.length>0;
    if(search && !matchesSearch) return '';
    const itemsHtml = items.length
      ? items.map(t=>`<div class="prev-item-row">
          <input type="checkbox" class="tx-select-checkbox" data-id="${t.id}" ${selectedTxIds.has(t.id)?'checked':''} aria-label="selecionar lançamento">
          <span style="width:50px;color:var(--muted);font-size:12px;flex-shrink:0;">${fmtDate(t.date).slice(0,5)}</span>
          <span class="prev-item-desc">${escapeHtml(t.desc)}${(t.tags&&t.tags.length)?` <span class="muted-tag">${t.tags.map(tag=>'#'+escapeHtml(tag)).join(' ')}</span>`:''}</span>
          <span class="prev-item-amt">${fmtBRL(t.amount)}</span>
          <button type="button" class="icon-btn" onclick="openEdit('${t.id}')" aria-label="editar">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="icon-btn danger" onclick="deleteTx('${t.id}')" aria-label="excluir">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-7 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>`).join('')
      : `<div class="prev-empty">nenhum lançamento nesta categoria${search?' pra essa busca':' ainda'}</div>`;
    return `<div class="prev-cat${search && items.length ? ' open':''}" id="realizadoCat-${type}-${idx}">
      <div class="prev-cat-header" onclick="toggleRealizadoCat('${type}', ${idx})">
        <span class="cat-dot" style="background:${colorFor(cat)}"></span>
        <div style="flex:1;min-width:0;">
          <span class="cname">${cat}</span>
          ${pctInfo}
        </div>
        <span class="prev-cat-total">${fmtBRL(total)}</span>
        <button type="button" class="icon-btn" onclick="event.stopPropagation(); openNewForCategory('${escapeAttr(cat)}','${type}')" aria-label="novo lançamento">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        </button>
        <button type="button" class="icon-btn" onclick="event.stopPropagation(); renameCategory('${type}','${escapeAttr(cat)}')" aria-label="renomear categoria">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="icon-btn danger" onclick="event.stopPropagation(); deleteCategory('${type}','${escapeAttr(cat)}')" aria-label="excluir categoria">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-7 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <svg class="prev-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="prev-cat-items">${itemsHtml}</div>
    </div>`;
  }).join('');
}
window.toggleRealizadoCat = function(type, idx){
  const wrap = document.getElementById('realizadoCat-'+type+'-'+idx);
  if(wrap) wrap.classList.toggle('open');
};
window.openNewForCategory = function(category, type){
  editingId = null;
  document.getElementById('modalTitle').textContent = 'novo lançamento';
  document.getElementById('txId').value='';
  document.getElementById('txDate').value = (realizadoMonth===todayISO().slice(0,7)) ? todayISO() : realizadoMonth+'-01';
  document.getElementById('txDesc').value='';
  document.getElementById('txAmount').value='';
  document.getElementById('txTags').value='';
  document.getElementById('txRepeat').value='none';
  document.getElementById('txRepeat').closest('.field').style.display = '';
  setModalType(type);
  document.getElementById('txCategory').value = category;
  openModal();
};

/* ---------------- Bulk move category (Realizado) ---------------- */
document.getElementById('realizadoCols').addEventListener('change', (e)=>{
  if(!e.target.classList.contains('tx-select-checkbox')) return;
  const id = e.target.dataset.id;
  if(e.target.checked){
    // seleção em massa só faz sentido dentro de um mesmo tipo (despesa/receita),
    // já que as duas colunas ficam visíveis ao mesmo tempo agora
    const tx = state.transactions.find(t=>t.id===id);
    const currentType = selectedTypeOfSelection();
    if(tx && currentType && tx.type!==currentType){
      selectedTxIds.clear();
      renderRealizado();
    }
    selectedTxIds.add(id);
  } else {
    selectedTxIds.delete(id);
  }
  updateBulkMoveBar();
});
function selectedTypeOfSelection(){
  if(selectedTxIds.size===0) return null;
  const firstId = selectedTxIds.values().next().value;
  const tx = state.transactions.find(t=>t.id===firstId);
  return tx ? tx.type : null;
}
function updateBulkMoveBar(){
  const bar = document.getElementById('bulkMoveBar');
  const count = selectedTxIds.size;
  if(count===0){ bar.classList.remove('show'); return; }
  bar.classList.add('show');
  document.getElementById('bulkMoveCount').textContent = `${count} selecionado${count>1?'s':''}`;
  const sel = document.getElementById('bulkMoveCategory');
  const selectionType = selectedTypeOfSelection() || 'despesa';
  const cats = (selectionType==='despesa' ? state.categories.despesa : state.categories.receita).filter(c=>c!=='Investimento');
  const prevValue = sel.value;
  sel.innerHTML = cats.map(c=>`<option value="${c}">${c}</option>`).join('');
  if(cats.includes(prevValue)) sel.value = prevValue;
}
function clearSelection(){
  selectedTxIds.clear();
  updateBulkMoveBar();
}
document.getElementById('bulkMoveCancel').addEventListener('click', ()=>{
  clearSelection();
  renderRealizado();
});
guardAsyncClick(document.getElementById('bulkMoveBtn'), async ()=>{
  const target = document.getElementById('bulkMoveCategory').value;
  if(!target || selectedTxIds.size===0) return;
  const count = selectedTxIds.size;
  const ok = await showDialog({
    title: 'mover lançamentos',
    message: `mover ${count} lançamento${count>1?'s':''} pra "${target}"?`,
    okLabel: 'mover'
  });
  if(!ok) return;
  pushUndo();
  state.transactions.forEach(t=>{ if(selectedTxIds.has(t.id)) t.category = target; });
  await persistTx();
  clearSelection();
  renderRealizado();
  renderDashboard();
  showToast(`tintin! ${count} lançamento${count>1?'s':''} movido${count>1?'s':''} pra ${target}`, true);
});

/* ---------------- Categorias ---------------- */
function categoryTotal(name, type){
  return state.transactions.filter(t=>t.category===name && t.type===type).reduce((s,t)=>s+t.amount,0);
}
function categoryCount(name, type){
  return state.transactions.filter(t=>t.category===name && t.type===type).length;
}
function renderCategorias(){
  const dEl = document.getElementById('catListDespesa');
  const rEl = document.getElementById('catListReceita');
  const build = (list, type) => list.length===0
    ? '<div class="empty">nenhuma categoria ainda</div>'
    : list.slice().sort((a,b)=> categoryTotal(b,type)-categoryTotal(a,type)).map(name=>`
      <div class="cat-chip">
        <span class="cat-dot" style="background:${colorFor(name)}"></span>
        <div class="info">
          <div class="cname">${name}</div>
          <div class="ctotal">${categoryCount(name,type)} lançamento(s) · ${fmtBRL(categoryTotal(name,type))}</div>
        </div>
        <div class="cactions">
          <button class="icon-btn" onclick="renameCategory('${type}','${escapeAttr(name)}')" aria-label="renomear">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-btn danger" onclick="deleteCategory('${type}','${escapeAttr(name)}')" aria-label="excluir">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-7 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>`).join('');
  dEl.innerHTML = build(state.categories.despesa, 'despesa');
  rEl.innerHTML = build(state.categories.receita, 'receita');
}
document.querySelectorAll('.add-cat-btn').forEach(btn=>{
  guardAsyncClick(btn, async ()=>{
    const type = btn.dataset.t;
    const name = await showDialog({title:`nova categoria de ${type}`, message:'digite o nome da categoria:', withInput:true, defaultValue:'', okLabel:'criar'});
    if(!name) return;
    const trimmed = name.trim();
    if(!trimmed) return;
    if(state.categories[type].some(c=>c.toLowerCase()===trimmed.toLowerCase())){
      showToast('essa categoria já existe'); return;
    }
    pushUndo(async ()=>{
      await dbDeleteCategory(trimmed, type);
      await persistCats();
    });
    try{
      await dbCreateCategory(trimmed, type);
      await persistCats();
      renderCategorias();
      if(document.getElementById('view-previsao').classList.contains('active')) renderPrevisao();
      showToast('categoria criada', true);
    }catch(err){
      showToast('erro ao criar categoria: '+(err.message||''));
    }
  });
});
// Renomear categoria: como category_id é chave estrangeira no banco, isso é
// só um UPDATE do nome — não precisa reescrever cada lançamento/previsão,
// eles já "seguem" o novo nome por apontarem pro mesmo id (ver data-layer.js).
async function renameCategory(type, oldName){
  const novo = await showDialog({title:'renomear categoria', message:`novo nome para "${oldName}":`, withInput:true, defaultValue:oldName, okLabel:'salvar'});
  if(!novo) return;
  const trimmed = novo.trim();
  if(!trimmed || trimmed===oldName) return;
  pushUndo(async ()=>{
    await dbRenameCategory(trimmed, type, oldName);
    state.transactions.forEach(t=>{ if(t.type===type && t.category===trimmed) t.category = oldName; });
    state.budgetItems.forEach(b=>{ if(b.category===trimmed && (b.type||'despesa')===type) b.category = oldName; });
    lastSyncedTransactions.forEach(t=>{ if(t.type===type && t.category===trimmed) t.category = oldName; });
    lastSyncedBudgetItems.forEach(b=>{ if(b.category===trimmed && (b.type||'despesa')===type) b.category = oldName; });
    await persistCats();
  });
  try{
    await dbRenameCategory(oldName, type, trimmed);
    // atualiza os textos em memória pra refletir na hora (o id no banco não mudou)
    state.transactions.forEach(t=>{ if(t.type===type && t.category===oldName) t.category = trimmed; });
    state.budgetItems.forEach(b=>{ if(b.category===oldName && (b.type||'despesa')===type) b.category = trimmed; });
    lastSyncedTransactions.forEach(t=>{ if(t.type===type && t.category===oldName) t.category = trimmed; });
    lastSyncedBudgetItems.forEach(b=>{ if(b.category===oldName && (b.type||'despesa')===type) b.category = trimmed; });
    await persistCats();
    renderCategorias();
    if(document.getElementById('view-previsao').classList.contains('active')) renderPrevisao();
    showToast('categoria renomeada', true);
  }catch(err){
    showToast('erro ao renomear: '+(err.message||''));
  }
}
async function deleteCategory(type, name){
  const count = categoryCount(name, type);
  const msg = count>0
    ? `"${name}" tem ${count} lançamento(s). Eles serão movidos para "Outros". Continuar?`
    : `excluir a categoria "${name}"?`;
  const ok = await showDialog({title:'excluir categoria', message: msg, okLabel:'excluir'});
  if(!ok) return;
  // captura quem pertence a essa categoria ANTES de excluir, pra saber exatamente
  // o que reverter no desfazer (sem confundir com itens que já eram "Outros")
  const affectedTxIds = state.transactions.filter(t=>t.type===type && t.category===name).map(t=>t.id);
  const affectedBudgetIds = state.budgetItems.filter(b=>b.category===name && (b.type||'despesa')===type).map(b=>b.id);
  pushUndo(async ()=>{
    await dbCreateCategory(name, type);
    affectedTxIds.forEach(id=>{ const t = state.transactions.find(x=>x.id===id); if(t) t.category = name; });
    affectedBudgetIds.forEach(id=>{ const b = state.budgetItems.find(x=>x.id===id); if(b) b.category = name; });
    // marca o "último sincronizado" como Outros (o que está de fato no banco agora),
    // pra persistTx/persistBudgetItems detectarem a diferença e regravarem certinho
    lastSyncedTransactions.forEach(t=>{ if(affectedTxIds.includes(t.id)) t.category = 'Outros'; });
    lastSyncedBudgetItems.forEach(b=>{ if(affectedBudgetIds.includes(b.id)) b.category = 'Outros'; });
    await persistCats();
    await persistTx();
    await persistBudgetItems();
  });
  try{
    await dbDeleteCategory(name, type);
    // espelha localmente a reatribuição pra "Outros" que já aconteceu no banco
    state.transactions.forEach(t=>{ if(t.type===type && t.category===name) t.category = 'Outros'; });
    state.budgetItems.forEach(b=>{ if(b.category===name && (b.type||'despesa')===type) b.category = 'Outros'; });
    lastSyncedTransactions.forEach(t=>{ if(t.type===type && t.category===name) t.category = 'Outros'; });
    lastSyncedBudgetItems.forEach(b=>{ if(b.category===name && (b.type||'despesa')===type) b.category = 'Outros'; });
    await persistCats();
    renderCategorias();
    if(document.getElementById('view-previsao').classList.contains('active')) renderPrevisao();
    showToast('categoria excluída', true);
  }catch(err){
    showToast('erro ao excluir categoria: '+(err.message||''));
  }
}

/* ---------------- Modal / Form ---------------- */
const overlay = document.getElementById('modalOverlay');
function openModal(){ overlay.classList.add('open'); }
function closeModal(){ overlay.classList.remove('open'); editingId=null; }
document.getElementById('btnNovo').addEventListener('click', ()=>{
  editingId = null;
  document.getElementById('modalTitle').textContent = 'novo lançamento';
  document.getElementById('txId').value='';
  document.getElementById('txDate').value = todayISO();
  document.getElementById('txDesc').value='';
  document.getElementById('txAmount').value='';
  document.getElementById('txTags').value='';
  document.getElementById('txRepeat').value='none';
  document.getElementById('txRepeat').closest('.field').style.display = '';
  setModalType('despesa');
  openModal();
});
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
overlay.addEventListener('click', (e)=>{ if(e.target===overlay) closeModal(); });

function setModalType(t){
  modalType = t;
  document.querySelectorAll('.type-toggle button').forEach(b=>b.classList.toggle('active', b.dataset.t===t));
  const sel = document.getElementById('txCategory');
  sel.innerHTML = state.categories[t].map(c=>`<option value="${c}">${c}</option>`).join('');
}
document.querySelectorAll('.type-toggle button').forEach(b=>{
  b.addEventListener('click', ()=> setModalType(b.dataset.t));
});

window.openEdit = function(id){
  const t = state.transactions.find(x=>x.id===id);
  if(!t) return;
  editingId = id;
  document.getElementById('modalTitle').textContent = 'editar lançamento';
  document.getElementById('txId').value = id;
  document.getElementById('txDate').value = t.date;
  document.getElementById('txDesc').value = t.desc;
  document.getElementById('txAmount').value = t.amount.toFixed(2).replace('.', ',');
  document.getElementById('txTags').value = (t.tags||[]).join(', ');
  document.getElementById('txRepeat').value = 'none';
  document.getElementById('txRepeat').closest('.field').style.display = 'none';
  setModalType(t.type);
  document.getElementById('txCategory').value = t.category;
  openModal();
};
window.deleteTx = async function(id){
  const ok = await showDialog({title:'excluir lançamento', message:'excluir este lançamento?', okLabel:'excluir'});
  if(!ok) return;
  pushUndo();
  state.transactions = state.transactions.filter(t=>t.id!==id);
  await persistTx();
  renderRealizado();
  renderDashboard();
  showToast('lançamento excluído', true);
};

['txDate','txDesc','txCategory','txAmount'].forEach(id=>{
  document.getElementById(id).addEventListener('input', (e)=> e.target.classList.remove('invalid'));
  document.getElementById(id).addEventListener('change', (e)=> e.target.classList.remove('invalid'));
});

['txDate','txDesc','txCategory','txAmount','txTags'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('txSaveBtn').click(); }
  });
});
guardAsyncClick(document.getElementById('txSaveBtn'), async (e)=>{
  e.preventDefault();
  try{
    const dateEl = document.getElementById('txDate');
    const descEl = document.getElementById('txDesc');
    const catEl = document.getElementById('txCategory');
    const amountEl = document.getElementById('txAmount');
    [dateEl,descEl,catEl,amountEl].forEach(el=>el.classList.remove('invalid'));

    const date = dateEl.value;
    const desc = descEl.value.trim();
    const category = catEl.value;
    const amountRaw = amountEl.value;
    const amount = parseAmount(amountRaw);
    const tags = document.getElementById('txTags').value.split(',').map(s=>s.trim()).filter(Boolean);
    const repeat = document.getElementById('txRepeat').value;

    const invalids = [];
    if(!date) invalids.push(dateEl);
    if(!desc) invalids.push(descEl);
    if(!category) invalids.push(catEl);
    if(amountRaw==='' || isNaN(amount) || amount<0) invalids.push(amountEl);

    if(invalids.length){
      invalids.forEach(el=>el.classList.add('invalid'));
      invalids[0].focus();
      showToast('preencha os campos destacados em laranja');
      return;
    }

    let addedCount = 1;
    pushUndo();
    if(editingId){
      const t = state.transactions.find(x=>x.id===editingId);
      Object.assign(t, { date, desc, category, amount, type: modalType, tags });
    } else {
      const nextId = () => crypto.randomUUID();
      state.transactions.push({ id: nextId(), date, desc, category, amount, type: modalType, tags });
      if(repeat==='weekly' || repeat==='monthly'){
        const recurringId = 'rec_'+Date.now();
        state.transactions[state.transactions.length-1].recurringId = recurringId;
        for(let i=1;i<12;i++){
          const d2 = repeat==='weekly' ? addDays(date, 7*i) : addMonths(date, i);
          state.transactions.push({ id: nextId(), date:d2, desc, category, amount, type: modalType, tags, recurringId });
        }
        addedCount = 12;
      }
    }
    await persistTx();
    closeModal();
    currentMonth = date.slice(0,7);
    saldosMonth = date.slice(0,7);
    realizadoMonth = date.slice(0,7);
    renderDashboard();
    renderRealizado();
    renderSaldos();
    showToast(addedCount>1 ? `tintin! ${addedCount} lançamentos criados` : 'tintin! lançamento salvo', true);
  }catch(err){
    showToast('erro ao salvar: ' + (err && err.message ? err.message : 'tente novamente'));
  }
});

/* ---------------- Exportar dados ---------------- */
document.getElementById('btnBackup').addEventListener('click', ()=>{
  try{
    const snapshot = {
      exportado_em: new Date().toISOString(),
      transacoes: state.transactions,
      categorias: state.categories,
      valor_investido_base: state.investedBase,
      previsao: state.budgetItems,
      meses_fechados: state.closedMonths,
      saldo_inicial_manual: state.saldoInicialOverrides,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tintin-dados-'+todayISO()+'.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    showToast(`tintin! dados exportados (${state.transactions.length} lançamentos, ${state.budgetItems.length} previsões)`);
  }catch(err){
    showToast('erro ao exportar dados: '+(err && err.message ? err.message : 'tente novamente'));
  }
});

/* ---------------- Helpers ---------------- */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s){ return String(s).replace(/'/g, "\\'"); }

/* ---------------- Init ---------------- */
async function initApp(){
  currentMonth = todayISO().slice(0,7);
  saldosMonth = currentMonth;
  try{
    await loadState();
  }catch(e){
    showToast('não foi possível carregar seus dados — verifique sua conexão e recarregue a página. ('+(e.message||'')+')');
    return;
  }
  if(!allMonthsSorted().includes(currentMonth)){
    const months = allMonthsSorted();
    if(months.length) currentMonth = months[months.length-1];
  }
  saldosMonth = currentMonth;
  realizadoMonth = currentMonth;
  previsaoMonth = shiftMonth(currentMonth, 1);
  renderDashboard();
  renderRealizado();
  renderCategorias();
  renderSaldos();
  renderPrevisao();
  checkDailyReminder();
}
// o app só carrega dados depois que auth.js confirma que o usuário está logado.
// antes disso, checa se a conta ainda precisa passar pelo onboarding — se a
// checagem falhar por qualquer motivo, nunca trava o usuário: segue pro painel.
document.addEventListener('tintin:authenticated', async (e)=>{
  let onboardingDone = true;
  try{
    onboardingDone = await dbGetOnboardingStatus();
  }catch(err){
    onboardingDone = true;
  }
  if(onboardingDone){
    initApp();
  } else {
    startOnboarding(e.detail.user, initApp);
  }
});

function checkDailyReminder(){
  const today = todayISO();
  if(state.dismissedReminders.includes(today)) return;
  const items = state.budgetItems.filter(b=>b.date===today && (b.type||'despesa')==='despesa');
  if(items.length===0) return;
  const total = items.reduce((s,b)=>s+b.amount,0);
  document.getElementById('reminderList').innerHTML = items.map(b=>`
    <div class="reminder-item">
      <span class="cat-dot" style="background:${colorFor(b.category)}"></span>
      <span class="rname">${escapeHtml(b.category)} — ${escapeHtml(b.desc)}</span>
      <span class="ramt">${fmtBRL(b.amount)}</span>
    </div>`).join('');
  document.getElementById('reminderTotal').textContent = `total previsto pra hoje: ${fmtBRL(total)}`;
  document.getElementById('reminderOverlay').classList.add('open');
}
async function dismissReminder(){
  const today = todayISO();
  if(!state.dismissedReminders.includes(today)) state.dismissedReminders.push(today);
  try{ await dbDismissReminder(today); }catch(e){ /* não crítico */ }
  await persistDismissedReminders();
  document.getElementById('reminderOverlay').classList.remove('open');
}
document.getElementById('reminderOk').addEventListener('click', dismissReminder);
guardAsyncClick(document.getElementById('reminderGoMapa'), async ()=>{
  await dismissReminder();
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const mapaTab = document.querySelector('.tab[data-tab="saldos"]');
  if(mapaTab) mapaTab.classList.add('active');
  document.getElementById('view-saldos').classList.add('active');
  saldosMonth = todayISO().slice(0,7);
  renderSaldos();
});

