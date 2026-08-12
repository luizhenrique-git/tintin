# tintin. — do protótipo (HTML/JS) para produto (Supabase)

Este documento explica como os dados que já existem no `state` do app em
HTML/JS mapeiam para as tabelas novas em `schema.sql`, e as decisões de
arquitetura por trás de cada mudança.

## Mapeamento direto

| Hoje (`state.*` no app.js) | Vira (Supabase) | O que muda |
|---|---|---|
| `state.transactions` | tabela `transactions` | `category` (string) vira `category_id` (FK) |
| `state.categories.despesa` / `.receita` | tabela `categories` | uma linha por categoria, com `type` |
| `state.budgetItems` | tabela `budget_items` | mesma estrutura, `category` vira FK |
| `state.investedBase` | `profiles.invested_base` | um valor por usuário, não mais uma constante do sistema |
| `state.saldoInicialOverrides` | tabela `saldo_inicial_overrides` | de objeto `{mês: valor}` pra tabela de verdade |
| `state.closedMonths` | tabela `closed_months` | passa a guardar também o valor do aporte gerado (histórico), não só a lista de meses fechados |
| `state.dismissedReminders` | tabela `dismissed_reminders` | idem |
| `state.rendimentoBaseFixed` | *(não migra)* | era uma correção pontual de dados do protótipo — não faz sentido num sistema novo, que já nasce certo |

## As 3 mudanças mais importantes

### 1. Categoria vira tabela, não mais string solta

Hoje, toda vez que você renomeia uma categoria, o código precisa varrer
`transactions` e `budgetItems` inteiros procurando strings iguais pra
trocar uma por uma — foi uma fonte real de bugs nessa conversa (duplicação
de categoria, itens "órfãos" com nome levemente diferente, etc.).

Com `category_id` como chave estrangeira, **renomear uma categoria é um
único `UPDATE` na tabela `categories`** — todos os lançamentos e previsões
que apontam pra ela já refletem o novo nome automaticamente, sem
precisar tocar em mais nada.

### 2. "Rendimento" vira flag, não mais nome fixo no código

Hoje, o app tem literalmente escrito no JavaScript: `if (categoria ===
'Rendimento')`. Se um cliente seu quiser nomear diferente (ex:
"Dividendos", "Juros do CDB"), não funcionaria sem eu editar código.

Na tabela `categories`, isso vira a flag `is_rendimento` — qualquer
categoria pode ser marcada assim, por qualquer usuário, sem precisar de
código novo. O mesmo vale para `is_investimento` (hoje também hardcoded
pelo nome "Investimento").

### 3. Todo mundo tem `user_id` + Row Level Security

Row Level Security (RLS) é um recurso do Postgres que o Supabase já usa
por padrão: cada policy garante que **um usuário só consegue ler ou
escrever linhas onde `user_id = auth.uid()`** (o próprio usuário
autenticado). Isso significa que, mesmo que alguém tente burlar o
frontend e chamar a API direto, o banco em si já bloqueia acesso aos
dados de outra pessoa — a segurança não depende só do código da
aplicação.

## O que NÃO migra ainda (fica pra próxima etapa)

As funções de cálculo que são o coração do método —
`computeBudgetTotal`, `computeSaldoInicialDoMes`, `computeOverrunDoMes`,
a lógica de fechamento de mês — **continuam em JavaScript**, rodando no
frontend, só que agora operando sobre dados vindos do Supabase em vez de
`localStorage`. Elas já estão testadas e validadas com seus dados reais
ao longo dessa conversa, não faz sentido reescrever agora.

Se um dia o app crescer a ponto de precisar dessas contas rodando no
banco (por exemplo, pra gerar relatórios agregados de muitos usuários de
uma vez, tipo você usar isso pra consultoria), aí sim vale migrar parte
dessa lógica pra **views** ou **funções SQL** do Postgres — mas isso é
otimização de fase 2, não bloqueia o lançamento.

## Próximos passos sugeridos

1. Rodar `schema.sql` num projeto Supabase (novo, separado do que o
   Sistema Virtus já usa, ou o mesmo projeto com tabelas próprias — sua
   escolha).
2. Configurar Supabase Auth (e-mail/senha é o mais simples pra começar).
3. Trocar as funções `storageGet`/`storageSet` do `app.js` por chamadas
   ao cliente `supabase-js` (`.from('transactions').select()`, etc.) —
   essa é a parte que exige mais trabalho, mas o *formato dos dados* que
   a lógica espera continua muito parecido, então a reescrita é mais
   mecânica do que criativa.
4. Adaptar a interface pra React aos poucos, tela por tela, reaproveitando
   a paleta de cores e os componentes visuais que já validamos (dá pra
   fazer isso em paralelo ao passo 3, não precisa ser tudo de uma vez).
