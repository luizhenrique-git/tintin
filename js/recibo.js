// =====================================================================
// tintin. — Recibo (resumo em texto, pra colar no WhatsApp)
// =====================================================================
// Módulo isolado: nada aqui toca o DOM ou busca dado no Supabase/state.
// gerarReciboTexto() só recebe números já calculados (ver coletarDadosRecibo
// em app.js, que é quem busca os dados reais reusando os cálculos do painel)
// e devolve o texto pronto — trocar o formato do recibo é mexer só aqui.
// =====================================================================

const MESES_PT_RECIBO = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function nomeMesCapitalizado(mesRef){
  const mes = Number(mesRef.split('-')[1]);
  const nome = MESES_PT_RECIBO[mes-1];
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

function fmtNumBR(v){
  return (v<0?'-':'') + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

// dados = {
//   investido: number,
//   saldoConta: number,
//   ganhos: number,
//   despesas: number,
//   rendimento: null | { porDia:number, noMes:number, diasUteis:number }
// }
function gerarReciboTexto(mesRef, dados){
  const nomeMes = nomeMesCapitalizado(mesRef);
  const total = dados.investido + dados.saldoConta;
  const sobra = dados.ganhos - dados.despesas;

  const linhas = [
    `>  Relatório ${nomeMes} - tintin. `,
    `Investido: ${fmtNumBR(dados.investido)}`,
    `Saldo conta: ${fmtNumBR(dados.saldoConta)}`,
    `Total: ${fmtNumBR(total)}`,
    '',
    '> Planejamento',
    `Ganhos: ${fmtNumBR(dados.ganhos)}`,
    `Previsão próx. mês: ${fmtNumBR(dados.despesas)}`,
    `Sobra: ${fmtNumBR(sobra)}`,
  ];

  if(dados.rendimento){
    linhas.push(
      '',
      '> Rendimento',
      `Por dia: ${fmtNumBR(dados.rendimento.porDia)}`,
      `No mês: ${fmtNumBR(dados.rendimento.noMes)} (${dados.rendimento.diasUteis} dias úteis)`
    );
  }

  return linhas.join('\n');
}

// ---------------------------------------------------------------------
// Dias úteis (seg-sex, excluindo feriados nacionais) — sem hardcode de ano.
// ---------------------------------------------------------------------
function calcularPascoa(ano){
  const a = ano % 19;
  const b = Math.floor(ano/100);
  const c = ano % 100;
  const d = Math.floor(b/4);
  const e = b % 4;
  const f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c/4);
  const k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const mFactor = Math.floor((a + 11*h + 22*l)/451);
  const mesEDia = h + l - 7*mFactor + 114;
  const mes = Math.floor(mesEDia/31); // 3=março, 4=abril
  const dia = (mesEDia % 31) + 1;
  return new Date(ano, mes-1, dia);
}

function toISODate(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function feriadosNacionais(ano){
  const addDays = (date, dias) => { const d = new Date(date); d.setDate(d.getDate()+dias); return d; };
  const fixos = [[1,1],[4,21],[5,1],[9,7],[10,12],[11,2],[11,15],[11,20],[12,25]]
    .map(([m,d]) => new Date(ano, m-1, d));
  const pascoa = calcularPascoa(ano);
  const moveis = [
    addDays(pascoa, -47), // Carnaval
    addDays(pascoa, -2),  // Sexta-feira Santa
    addDays(pascoa, 60),  // Corpus Christi
  ];
  return new Set([...fixos, ...moveis].map(toISODate));
}

function diasUteisNoMes(ano, mes){
  const feriados = feriadosNacionais(ano);
  const totalDias = new Date(ano, mes, 0).getDate();
  let count = 0;
  for(let d=1; d<=totalDias; d++){
    const date = new Date(ano, mes-1, d);
    const dow = date.getDay(); // 0=domingo, 6=sábado
    if(dow===0 || dow===6) continue;
    if(feriados.has(toISODate(date))) continue;
    count++;
  }
  return count;
}
