// =====================================================================
// tintin. — camada de dados (Supabase)
// =====================================================================
// Substitui o antigo par storageGet/storageSet (que gravava tudo em
// localStorage/window.storage como blobs JSON) por funções que
// conversam de verdade com as tabelas do schema.sql.
//
// Categorias existem em memória como um cache (`categoryCache`), pra
// evitar ficar traduzindo nome<->id o tempo todo com round-trips ao
// banco — é recarregado sempre que loadAllData() roda.
// =====================================================================

let categoryCache = { byName: {}, byId: {} }; // byName['despesa|Mercado'] = {id, name, type, color, ...}

function categoryKey(name, type){ return `${type}|${name}`; }

async function loadCategoryCache(){
  const { data, error } = await supabaseClient.from('categories').select('*');
  if(error) throw error;
  categoryCache = { byName: {}, byId: {} };
  (data||[]).forEach(c=>{
    categoryCache.byName[categoryKey(c.name, c.type)] = c;
    categoryCache.byId[c.id] = c;
  });
  return data || [];
}

function categoryNameById(id){
  const c = categoryCache.byId[id];
  return c ? c.name : 'Outros';
}
function categoryIdByName(name, type){
  const c = categoryCache.byName[categoryKey(name, type)];
  return c ? c.id : null;
}

// Categorias padrão criadas para todo usuário novo (sem histórico prévio)
const DEFAULT_CATEGORIES = [
  { name:'Moradia', type:'despesa' },
  { name:'Mercado', type:'despesa' },
  { name:'Despesa Pessoal', type:'despesa' },
  { name:'Lazer', type:'despesa' },
  { name:'Automóveis', type:'despesa' },
  { name:'Cartão de Crédito', type:'despesa' },
  { name:'Investimento', type:'despesa', is_investimento:true },
  { name:'Salário', type:'receita' },
  { name:'Rendimento', type:'receita', is_rendimento:true },
];

async function ensureDefaultCategoriesExist(){
  const existing = await loadCategoryCache();
  if(existing.length > 0) return; // usuário já tem categorias, não mexe
  const rows = DEFAULT_CATEGORIES.map(c => ({
    user_id: currentUser.id, name: c.name, type: c.type,
    is_investimento: !!c.is_investimento, is_rendimento: !!c.is_rendimento
  }));
  const { error } = await supabaseClient.from('categories').insert(rows);
  if(error) throw error;
  await loadCategoryCache();
}

// ---------------------------------------------------------------------
// CATEGORIAS
// ---------------------------------------------------------------------
async function dbListCategories(){
  await loadCategoryCache();
  const despesa = [], receita = [];
  Object.values(categoryCache.byId).forEach(c=>{
    (c.type==='despesa' ? despesa : receita).push(c.name);
  });
  return { despesa, receita };
}

async function dbCreateCategory(name, type){
  const { data, error } = await supabaseClient.from('categories')
    .insert({ user_id: currentUser.id, name, type })
    .select().single();
  if(error) throw error;
  categoryCache.byName[categoryKey(name,type)] = data;
  categoryCache.byId[data.id] = data;
  return data;
}

// Renomear categoria: como category_id é chave estrangeira, isso é só
// um UPDATE — nenhum lançamento ou item de previsão precisa ser tocado,
// eles já "seguem" o novo nome automaticamente por apontarem pro mesmo id.
async function dbRenameCategory(oldName, type, newName){
  const cat = categoryCache.byName[categoryKey(oldName, type)];
  if(!cat) throw new Error(`categoria "${oldName}" não encontrada`);
  const { error } = await supabaseClient.from('categories')
    .update({ name: newName })
    .eq('id', cat.id);
  if(error) throw error;
  await loadCategoryCache();
}

// Excluir categoria: reatribui lançamentos/previsões existentes para
// "Outros" antes de apagar (cria "Outros" se ainda não existir).
async function dbDeleteCategory(name, type){
  const cat = categoryCache.byName[categoryKey(name, type)];
  if(!cat) throw new Error(`categoria "${name}" não encontrada`);

  let outros = categoryCache.byName[categoryKey('Outros', type)];
  const { count } = await supabaseClient.from('transactions')
    .select('id', { count:'exact', head:true }).eq('category_id', cat.id);

  if((count||0) > 0){
    if(!outros) outros = await dbCreateCategory('Outros', type);
    await supabaseClient.from('transactions').update({ category_id: outros.id }).eq('category_id', cat.id);
    await supabaseClient.from('budget_items').update({ category_id: outros.id }).eq('category_id', cat.id);
  }

  const { error } = await supabaseClient.from('categories').delete().eq('id', cat.id);
  if(error) throw error;
  await loadCategoryCache();
}

// ---------------------------------------------------------------------
// TRANSAÇÕES (aba Realizado)
// ---------------------------------------------------------------------
async function dbListTransactions(){
  const { data, error } = await supabaseClient.from('transactions').select('*').order('date');
  if(error) throw error;
  return (data||[]).map(t => ({
    id: t.id,
    date: t.date,
    desc: t.description,
    category: categoryNameById(t.category_id),
    type: t.type,
    amount: Number(t.amount),
    tags: t.tags || [],
    recurringId: t.recurring_id || null,
  }));
}

async function dbCreateTransaction(tx){
  const categoryId = categoryIdByName(tx.category, tx.type);
  if(!categoryId) throw new Error(`categoria "${tx.category}" não existe`);
  const { data, error } = await supabaseClient.from('transactions').insert({
    user_id: currentUser.id,
    category_id: categoryId,
    date: tx.date,
    description: tx.desc,
    type: tx.type,
    amount: tx.amount,
    tags: tx.tags || [],
    recurring_id: tx.recurringId || null,
  }).select().single();
  if(error) throw error;
  return data.id;
}

async function dbUpdateTransaction(id, tx){
  const categoryId = categoryIdByName(tx.category, tx.type);
  if(!categoryId) throw new Error(`categoria "${tx.category}" não existe`);
  const { error } = await supabaseClient.from('transactions').update({
    category_id: categoryId, date: tx.date, description: tx.desc,
    type: tx.type, amount: tx.amount, tags: tx.tags || [],
  }).eq('id', id);
  if(error) throw error;
}

async function dbDeleteTransaction(id){
  const { error } = await supabaseClient.from('transactions').delete().eq('id', id);
  if(error) throw error;
}

// ---------------------------------------------------------------------
// PREVISÃO (budget_items)
// ---------------------------------------------------------------------
async function dbListBudgetItems(){
  const { data, error } = await supabaseClient.from('budget_items').select('*');
  if(error) throw error;
  return (data||[]).map(b => ({
    id: b.id,
    category: categoryNameById(b.category_id),
    desc: b.description,
    amount: Number(b.amount),
    type: b.type,
    month: b.month,
    date: b.date,
    variable: b.is_variable,
    paid: b.is_paid,
    seriesId: b.series_id,
    seriesIndex: b.series_index,
    seriesTotal: b.series_total,
  }));
}

async function dbCreateBudgetItem(item){
  const categoryId = categoryIdByName(item.category, item.type);
  if(!categoryId) throw new Error(`categoria "${item.category}" não existe`);
  const { data, error } = await supabaseClient.from('budget_items').insert({
    user_id: currentUser.id, category_id: categoryId, description: item.desc,
    amount: item.amount, type: item.type, month: item.month, date: item.date || null,
    is_variable: !!item.variable, is_paid: !!item.paid,
    series_id: item.seriesId || null, series_index: item.seriesIndex || null, series_total: item.seriesTotal || null,
  }).select().single();
  if(error) throw error;
  return data.id;
}

async function dbUpdateBudgetItem(id, item){
  const categoryId = categoryIdByName(item.category, item.type);
  if(!categoryId) throw new Error(`categoria "${item.category}" não existe`);
  const { error } = await supabaseClient.from('budget_items').update({
    category_id: categoryId, description: item.desc, amount: item.amount,
    type: item.type, month: item.month, date: item.date || null,
    is_variable: !!item.variable, is_paid: !!item.paid,
  }).eq('id', id);
  if(error) throw error;
}

async function dbDeleteBudgetItem(id){
  const { error } = await supabaseClient.from('budget_items').delete().eq('id', id);
  if(error) throw error;
}

async function dbDeleteBudgetItemSeries(seriesId){
  const { error } = await supabaseClient.from('budget_items').delete().eq('series_id', seriesId);
  if(error) throw error;
}

async function dbMarkBudgetItemPaid(id, transactionId){
  const { error } = await supabaseClient.from('budget_items')
    .update({ is_paid: true, paid_transaction_id: transactionId })
    .eq('id', id);
  if(error) throw error;
}

// ---------------------------------------------------------------------
// PERFIL (valor investido base)
// ---------------------------------------------------------------------
async function dbGetInvestedBase(){
  const { data, error } = await supabaseClient.from('profiles').select('invested_base').eq('id', currentUser.id).single();
  if(error) throw error;
  return Number(data.invested_base);
}
async function dbSetInvestedBase(value){
  const { error } = await supabaseClient.from('profiles').update({ invested_base: value }).eq('id', currentUser.id);
  if(error) throw error;
}

// ---------------------------------------------------------------------
// SALDO INICIAL (overrides manuais por mês)
// ---------------------------------------------------------------------
async function dbListSaldoInicialOverrides(){
  const { data, error } = await supabaseClient.from('saldo_inicial_overrides').select('*');
  if(error) throw error;
  const out = {};
  (data||[]).forEach(r => out[r.month] = Number(r.value));
  return out;
}
async function dbSetSaldoInicialOverride(month, value){
  const { error } = await supabaseClient.from('saldo_inicial_overrides')
    .upsert({ user_id: currentUser.id, month, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,month' });
  if(error) throw error;
}
async function dbDeleteSaldoInicialOverride(month){
  const { error } = await supabaseClient.from('saldo_inicial_overrides').delete().eq('month', month);
  if(error) throw error;
}

// ---------------------------------------------------------------------
// FECHAMENTO DE MÊS
// ---------------------------------------------------------------------
async function dbListClosedMonths(){
  const { data, error } = await supabaseClient.from('closed_months').select('month');
  if(error) throw error;
  return (data||[]).map(r => r.month);
}
async function dbCloseMonth(month, aporteAmount, overrunAmount){
  const { error } = await supabaseClient.from('closed_months')
    .upsert({ user_id: currentUser.id, month, aporte_amount: aporteAmount, overrun_amount: overrunAmount || 0, closed_at: new Date().toISOString() }, { onConflict: 'user_id,month' });
  if(error) throw error;
}

// ---------------------------------------------------------------------
// LEMBRETES DISPENSADOS
// ---------------------------------------------------------------------
async function dbListDismissedReminders(){
  const { data, error } = await supabaseClient.from('dismissed_reminders').select('date');
  if(error) throw error;
  return (data||[]).map(r => r.date);
}
async function dbDismissReminder(date){
  const { error } = await supabaseClient.from('dismissed_reminders')
    .upsert({ user_id: currentUser.id, date }, { onConflict: 'user_id,date' });
  if(error) throw error;
}

// ---------------------------------------------------------------------
// CARREGAMENTO INICIAL — busca tudo de uma vez e devolve no formato
// que o resto do app.js já espera (mesma forma do antigo `state`).
// ---------------------------------------------------------------------
async function loadAllData(){
  await ensureDefaultCategoriesExist();
  const [categories, transactions, budgetItems, investedBase, saldoInicialOverrides, closedMonths, dismissedReminders] = await Promise.all([
    dbListCategories(),
    dbListTransactions(),
    dbListBudgetItems(),
    dbGetInvestedBase(),
    dbListSaldoInicialOverrides(),
    dbListClosedMonths(),
    dbListDismissedReminders(),
  ]);
  return { categories, transactions, budgetItems, investedBase, saldoInicialOverrides, closedMonths, dismissedReminders };
}
