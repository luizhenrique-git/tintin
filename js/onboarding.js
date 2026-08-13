// =====================================================================
// tintin. — onboarding ("primeiros passos")
// =====================================================================
// Wizard de 5 telas mostrado só pra contas novas (profiles.onboarding_completed
// = false). Chamado por app.js (ver o listener de 'tintin:authenticated')
// ANTES de initApp() — só quando o onboarding termina (ou é pulado por
// erro na checagem) é que o painel normal carrega.
//
// Reusa as mesmas funções de banco de js/data-layer.js (dbCreateCategory,
// dbCreateBudgetItem, dbCompleteOnboarding) e os mesmos helpers de js/app.js
// (parseAmount, fmtBRL, shiftMonth, todayISO, escapeHtml, showToast) — nada
// de lógica de cálculo ou acesso a banco duplicado aqui.
// =====================================================================

const ONBOARDING_ACCENTS = ['#F4622C', '#C6F135', '#F4622C', '#C6F135', '#F4622C'];

let obState = null; // { step, name, onComplete, categories:[{name,type,checked,isDefault}], income:{name,amount}, expense:{category,amount}, summary:{} }

function startOnboarding(user, onComplete){
  const rawName = (user && user.user_metadata && user.user_metadata.display_name) || '';
  const name = (rawName && !rawName.includes('@')) ? rawName : '';
  obState = {
    step: 1,
    name,
    onComplete,
    categories: DEFAULT_CATEGORIES.map(c => ({ name:c.name, type:c.type, checked:true, isDefault:true })),
    income: { name:'', amount:'' },
    expense: { category:'', amount:'' },
    summary: null,
  };
  document.getElementById('onboardingOverlay').classList.add('open');
  document.body.style.overflow = 'hidden'; // trava o scroll do painel por trás enquanto o onboarding está aberto
  renderOnboardingStep();
}

function obCard(){ return document.getElementById('onboardingOverlay'); }

function renderOnboardingStep(){
  const step = obState.step;
  const accent = ONBOARDING_ACCENTS[step-1];
  const badge = `
    <span class="onboarding-badge">
      <span class="onboarding-badge-mark">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3 8a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" stroke="#10231A" stroke-width="2"/><path d="M16 12h3" stroke="#10231A" stroke-width="2" stroke-linecap="round"/><path d="M7 6V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1" stroke="#10231A" stroke-width="2"/></svg>
      </span>
      tintin<span class="dot" style="color:${accent};">.</span>
    </span>`;
  const progress = `
    <div class="onboarding-progress">
      <span class="onboarding-progress-text">passo ${step} de 5</span>
      <div class="onboarding-progress-bar"><div class="onboarding-progress-fill" style="width:${step/5*100}%;background:${accent};"></div></div>
    </div>`;

  let bodyHtml = '';
  if(step===1) bodyHtml = obRenderStep1();
  else if(step===2) bodyHtml = obRenderStep2();
  else if(step===3) bodyHtml = obRenderStep3();
  else if(step===4) bodyHtml = obRenderStep4();
  else bodyHtml = obRenderStep5();

  obCard().innerHTML = `
    <div class="onboarding-center">
      <div class="onboarding-card">
        ${badge}
        ${progress}
        ${bodyHtml}
      </div>
    </div>`;

  obWireStep();
}

function obRenderStep1(){
  const greeting = obState.name ? `bem-vindo(a), ${escapeHtml(obState.name)}!` : 'bem-vindo(a) ao tintin.!';
  return `
    <h2 class="onboarding-title">${greeting}</h2>
    <div class="onboarding-body">
      <p>que bom ter você aqui. antes de começar, vamos te mostrar rapidinho como o método funciona — leva menos de 2 minutos e já deixa sua primeira previsão pronta.</p>
    </div>
    <div class="onboarding-actions">
      <button type="button" class="btn-primary" id="obNext" style="width:100%;justify-content:center;">vamos começar</button>
    </div>`;
}

function obCycleIcon(bg, path){
  return `<span class="onboarding-cycle-icon" style="background:${bg};"><svg viewBox="0 0 24 24" fill="none">${path}</svg></span>`;
}
const OB_ICON_TREND = '<path d="M5 19V13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M11 19V9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M17 19V5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';
const OB_ICON_TARGET = '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const OB_ICON_CLOCK = '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const OB_ICON_ARROW = '<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
const OB_ICON_LOCKBOX = '<path d="M8 3v4M16 3v4M4 9h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2"/>';

function obRenderStep2(){
  return `
    <h2 class="onboarding-title">por que nunca sobra dinheiro no fim do mês?</h2>
    <div class="onboarding-body">
      <p>Não é falta de disciplina. É que a gente só decide quanto vai gastar <strong>depois</strong> que o dinheiro já caiu na conta — e nessa hora, é fácil gastar mais do que devia, sem nem perceber.</p>
      <div class="onboarding-tip" style="border-left-color:var(--orange);">
        <p style="margin-bottom:0;">O tintin. inverte essa ordem: você define quanto pode gastar <strong>antes</strong> do dinheiro chegar. O que sobra, vira investimento sozinho — sem depender de força de vontade no dia a dia.</p>
      </div>

      <div class="onboarding-cycle">
        <div class="onboarding-cycle-label">o ciclo do método</div>
        <div class="onboarding-cycle-sub">um mês alimenta o próximo, sempre em loop</div>
        <div class="onboarding-cycle-diagram">
          <svg class="onboarding-cycle-ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <rect x="3" y="3" width="94" height="94" rx="10" fill="none" stroke="rgba(16,35,26,0.18)" stroke-width="0.6" stroke-dasharray="2 3"/>
          </svg>
          <svg class="onboarding-cycle-arrow" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
            <path d="M2 10 H82" stroke="var(--orange)" stroke-width="4" stroke-linecap="round"/>
            <path d="M74 2 L90 10 L74 18" fill="none" stroke="var(--orange)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="onboarding-cycle-center">todo mês,<br>de novo</div>
          <div class="onboarding-cycle-grid">
            <div class="onboarding-cycle-node">
              ${obCycleIcon('#DDF0EA', OB_ICON_TREND.replace(/currentColor/g,'#127A63'))}
              <span>recebe o salário na conta 1, e não gasta</span>
            </div>
            <div class="onboarding-cycle-node">
              ${obCycleIcon('#FDEBD3', OB_ICON_TARGET.replace(/currentColor/g,'#B87A1F'))}
              <span>define os gastos do mês seguinte</span>
            </div>
            <div class="onboarding-cycle-node">
              ${obCycleIcon('#F3E9C9', OB_ICON_CLOCK.replace(/currentColor/g,'#8A6D3B'))}
              <span>usa a conta 2 durante o mês</span>
            </div>
            <div class="onboarding-cycle-node">
              ${obCycleIcon('#F0E8FB', OB_ICON_ARROW.replace(/currentColor/g,'var(--purple)'))}
              <span>manda esse valor pra conta 2</span>
            </div>
            <div class="onboarding-cycle-node">
              ${obCycleIcon('#DDF0EA', OB_ICON_TREND.replace(/currentColor/g,'#127A63'))}
              <span>o que sobrar na conta 1, investe</span>
            </div>
            <div class="onboarding-cycle-node">
              ${obCycleIcon('#FBE0EA', OB_ICON_LOCKBOX.replace(/currentColor/g,'#C2447B'))}
              <span>deixa só esse valor disponível nela</span>
            </div>
          </div>
        </div>
        <p class="onboarding-cycle-note">essa separação em duas contas é opcional — o tintin. não rastreia em qual conta cada valor está, é só uma prática de organização pessoal fora do app.</p>
      </div>
    </div>
    <div class="onboarding-actions">
      <button type="button" class="btn-secondary" id="obBack">voltar</button>
      <button type="button" class="btn-primary" id="obNext">entendi, vamos configurar</button>
    </div>`;
}

function obCatRow(c, idx){
  return `
    <div class="onboarding-cat-row">
      <input type="checkbox" id="obCat${idx}" data-idx="${idx}" ${c.checked?'checked':''}>
      <label for="obCat${idx}">${escapeHtml(c.name)}</label>
    </div>`;
}

function obRenderStep3(){
  const despesaRows = obState.categories.map((c,idx)=> c.type==='despesa' ? obCatRow(c,idx) : '').join('');
  const receitaRows = obState.categories.map((c,idx)=> c.type==='receita' ? obCatRow(c,idx) : '').join('');
  return `
    <h2 class="onboarding-title">quais categorias fazem sentido pra você?</h2>
    <div class="onboarding-body">
      <p>já deixamos uma lista sugerida marcada — desmarca o que não usar, ou adiciona a sua.</p>
      <div class="onboarding-cat-cols">
        <div class="onboarding-cat-col">
          <h4>despesas</h4>
          <div id="obCatDespesaList">${despesaRows}</div>
          <div class="onboarding-add-cat">
            <input type="text" id="obNewCatDespesa" placeholder="nova categoria de despesa">
            <button type="button" id="obAddCatDespesa">+ add</button>
          </div>
        </div>
        <div class="onboarding-cat-col">
          <h4>receitas</h4>
          <div id="obCatReceitaList">${receitaRows}</div>
          <div class="onboarding-add-cat">
            <input type="text" id="obNewCatReceita" placeholder="nova categoria de receita">
            <button type="button" id="obAddCatReceita">+ add</button>
          </div>
        </div>
      </div>
    </div>
    <div class="onboarding-actions">
      <button type="button" class="btn-secondary" id="obBack">voltar</button>
      <button type="button" class="btn-primary" id="obNext">continuar</button>
    </div>`;
}

function obRenderStep4(){
  const despesaCats = obState.categories.filter(c=>c.type==='despesa' && c.checked && c.name!=='Investimento');
  const options = despesaCats.map(c=>`<option value="${escapeHtml(c.name)}" ${obState.expense.category===c.name?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  return `
    <h2 class="onboarding-title">sua primeira previsão</h2>
    <div class="onboarding-body">
      <p>vamos sentir o fluxo funcionando — dá pra ajustar e adicionar mais depois, isso aqui é só o primeiro passo.</p>
      <h4 class="onboarding-subhead">sua principal fonte de renda</h4>
      <div class="field">
        <label>nome</label>
        <input type="text" id="obIncomeName" placeholder="ex: salário" value="${escapeHtml(obState.income.name)}">
      </div>
      <div class="field">
        <label>valor esperado por mês</label>
        <input type="text" id="obIncomeAmount" placeholder="0,00" value="${escapeHtml(obState.income.amount)}">
      </div>
      <h4 class="onboarding-subhead">uma despesa prevista pro mês que vem</h4>
      <div class="field">
        <label>categoria</label>
        <select id="obExpenseCategory">
          <option value="">selecione</option>
          ${options}
        </select>
      </div>
      <div class="field">
        <label>valor previsto</label>
        <input type="text" id="obExpenseAmount" placeholder="0,00" value="${escapeHtml(obState.expense.amount)}">
      </div>
    </div>
    <div class="onboarding-actions">
      <button type="button" class="btn-secondary" id="obBack">voltar</button>
      <button type="button" class="btn-primary" id="obNext">continuar</button>
    </div>`;
}

function obRenderStep5(){
  const s = obState.summary || {};
  const incomeText = s.incomeCreated ? `${escapeHtml(s.incomeName)} — ${fmtBRL(s.incomeAmount)}` : 'nenhuma cadastrada ainda';
  const expenseText = s.expenseCreated ? `${escapeHtml(s.expenseCategory)} — ${fmtBRL(s.expenseAmount)}` : 'nenhuma cadastrada ainda';
  return `
    <h2 class="onboarding-title">tudo pronto${obState.name?', '+escapeHtml(obState.name):''}!</h2>
    <div class="onboarding-body">
      <p>configuramos o essencial pra você começar:</p>
      <div class="onboarding-summary-row"><span>categorias criadas</span><strong>${s.categoriesCount||0}</strong></div>
      <div class="onboarding-summary-row"><span>receita prevista</span><strong>${incomeText}</strong></div>
      <div class="onboarding-summary-row"><span>despesa prevista</span><strong>${expenseText}</strong></div>
      <p style="margin-top:18px;">a partir daqui é só ir ajustando mês a mês — cada real no seu lugar.</p>
    </div>
    <div class="onboarding-actions">
      <button type="button" class="btn-primary" id="obFinish" style="width:100%;justify-content:center;">ir pro painel</button>
    </div>`;
}

function obWireStep(){
  const nextBtn = document.getElementById('obNext');
  const backBtn = document.getElementById('obBack');
  const finishBtn = document.getElementById('obFinish');
  if(backBtn) backBtn.addEventListener('click', ()=>{ obState.step -= 1; renderOnboardingStep(); });
  if(nextBtn) nextBtn.addEventListener('click', obGoNext);
  if(finishBtn) finishBtn.addEventListener('click', obFinish);

  if(obState.step===3){
    document.querySelectorAll('#onboardingOverlay .onboarding-cat-row input[type=checkbox]').forEach(cb=>{
      cb.addEventListener('change', (e)=>{
        obState.categories[parseInt(e.target.dataset.idx,10)].checked = e.target.checked;
      });
    });
    document.getElementById('obAddCatDespesa').addEventListener('click', ()=> obAddCustomCategory('despesa'));
    document.getElementById('obAddCatReceita').addEventListener('click', ()=> obAddCustomCategory('receita'));
  }
}

function obAddCustomCategory(type){
  const inputId = type==='despesa' ? 'obNewCatDespesa' : 'obNewCatReceita';
  const input = document.getElementById(inputId);
  const name = input.value.trim();
  if(!name) return;
  if(obState.categories.some(c=>c.name.toLowerCase()===name.toLowerCase() && c.type===type)){
    input.value = '';
    return;
  }
  obState.categories.push({ name, type, checked:true, isDefault:false });
  input.value = '';
  renderOnboardingStep();
}

async function obGoNext(){
  const nextBtn = document.getElementById('obNext');
  if(obState.step===3){
    nextBtn.disabled = true;
    nextBtn.textContent = 'criando categorias...';
    try{
      // sincroniza o cache com o banco antes de checar o que já existe — evita tentar
      // recriar (e travar em erro de duplicidade) categorias de uma tentativa anterior
      await loadCategoryCache();
      for(const c of obState.categories){
        if(!c.checked) continue;
        if(categoryIdByName(c.name, c.type)) continue; // já existe
        try{
          await dbCreateCategory(c.name, c.type);
        }catch(itemErr){
          // uma falha pontual (ex: corrida de duplicidade) não deve travar o resto do fluxo
          console.warn('não foi possível criar a categoria "'+c.name+'":', itemErr);
        }
      }
    }catch(err){
      showToast('erro ao criar categorias: '+(err && err.message ? err.message : 'tente novamente'));
      nextBtn.disabled = false;
      nextBtn.textContent = 'continuar';
      return;
    }
  }
  if(obState.step===4){
    obState.income.name = (document.getElementById('obIncomeName').value||'').trim();
    obState.income.amount = document.getElementById('obIncomeAmount').value||'';
    obState.expense.category = document.getElementById('obExpenseCategory').value||'';
    obState.expense.amount = document.getElementById('obExpenseAmount').value||'';
    nextBtn.disabled = true;
    nextBtn.textContent = 'salvando...';
    try{
      await obCreateFirstBudgetItems();
    }catch(err){
      showToast('erro ao salvar previsão: '+(err && err.message ? err.message : 'tente novamente'));
      nextBtn.disabled = false;
      nextBtn.textContent = 'continuar';
      return;
    }
  }
  obState.step += 1;
  renderOnboardingStep();
}

async function obCreateFirstBudgetItems(){
  const nextMonth = shiftMonth(todayISO().slice(0,7), 1);
  const firstDayNextMonth = nextMonth+'-01';
  const summary = {
    categoriesCount: obState.categories.filter(c=>c.checked).length,
    incomeCreated: false, incomeName:'', incomeAmount:0,
    expenseCreated: false, expenseCategory:'', expenseAmount:0,
  };

  const incomeAmount = parseAmount(obState.income.amount);
  if(obState.income.name && !isNaN(incomeAmount) && incomeAmount>0){
    const incomeCategory = 'Salário';
    if(!categoryIdByName(incomeCategory, 'receita')){
      await dbCreateCategory(incomeCategory, 'receita');
      summary.categoriesCount += 1;
    }
    await dbCreateBudgetItem({ category: incomeCategory, desc: obState.income.name, amount: incomeAmount, type:'receita', month: nextMonth, date: firstDayNextMonth });
    summary.incomeCreated = true;
    summary.incomeName = obState.income.name;
    summary.incomeAmount = incomeAmount;
  }

  const expenseAmount = parseAmount(obState.expense.amount);
  if(obState.expense.category && !isNaN(expenseAmount) && expenseAmount>0){
    await dbCreateBudgetItem({ category: obState.expense.category, desc: obState.expense.category, amount: expenseAmount, type:'despesa', month: nextMonth, date: firstDayNextMonth });
    summary.expenseCreated = true;
    summary.expenseCategory = obState.expense.category;
    summary.expenseAmount = expenseAmount;
  }

  obState.summary = summary;
}

async function obFinish(){
  const btn = document.getElementById('obFinish');
  btn.disabled = true;
  btn.textContent = 'abrindo o painel...';
  try{
    await dbCompleteOnboarding();
  }catch(err){
    // nunca trava o usuário por causa disso — só segue pro painel mesmo assim
  }
  document.getElementById('onboardingOverlay').classList.remove('open');
  document.body.style.overflow = '';
  window.scrollTo(0, 0); // garante que o painel abra sempre do topo, não de onde o fundo ficou rolado
  const onComplete = obState.onComplete;
  obState = null;
  onComplete();
}
