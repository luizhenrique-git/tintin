# tintin. — controle financeiro pessoal (com Supabase)

Sistema de gestão financeira pessoal baseado no método "orçamento pelo mês
seguinte": você nunca gasta a receita do mês corrente — define o teto de
gastos do mês seguinte com base numa previsão detalhada por categoria, e
tudo que sobra da receita vira investimento automaticamente no fechamento
do mês.

Esta versão já roda com **login de usuário** e **banco de dados real**
(Supabase/Postgres) — qualquer pessoa pode criar sua própria conta, e os
dados ficam salvos na nuvem, acessíveis de qualquer dispositivo.

## Estrutura do projeto

```
tintin-app/
├── index.html              # estrutura HTML (inclui a tela de login)
├── css/
│   └── styles.css          # todo o estilo visual
├── js/
│   ├── config.js             # credenciais do seu projeto Supabase (preencher)
│   ├── supabase-client.js    # inicializa o cliente supabase-js
│   ├── auth.js               # login, cadastro, logout
│   ├── data-layer.js         # todas as operações de banco (CRUD)
│   └── app.js                # lógica da aplicação (cálculos, telas, eventos)
├── supabase-schema/
│   ├── schema.sql            # schema completo do banco (rodar uma vez no Supabase)
│   └── MIGRACAO.md           # explicação do mapeamento de dados antigo → novo
└── README.md
```

## Passo a passo pra colocar no ar

### 1. Criar o projeto no Supabase
1. Crie uma conta em [supabase.com](https://supabase.com) (grátis pra começar).
2. Crie um novo projeto.
3. Espere a infraestrutura terminar de provisionar (leva 1-2 minutos).

### 2. Rodar o schema
1. No painel do projeto: **SQL Editor** (menu lateral).
2. Abra `supabase-schema/schema.sql` deste projeto, copie todo o conteúdo.
3. Cole no SQL Editor do Supabase e clique em **Run**.
4. Confira em **Table Editor** se as 7 tabelas apareceram: `profiles`,
   `categories`, `transactions`, `budget_items`,
   `saldo_inicial_overrides`, `closed_months`, `dismissed_reminders`.

### 3. Configurar autenticação por e-mail/senha
1. No painel: **Authentication → Providers**.
2. Confirme que **Email** está habilitado (vem habilitado por padrão).
3. Se quiser testar rápido sem confirmar e-mail a cada cadastro:
   **Authentication → Settings** → desative "Confirm email" (só recomendado
   em desenvolvimento — reative antes de ter usuários reais).

### 4. Preencher `js/config.js`
1. No painel: **Project Settings → API**.
2. Copie **Project URL** → cole em `SUPABASE_URL`.
3. Copie a chave **anon public** → cole em `SUPABASE_ANON_KEY`.
   (nunca use a chave `service_role` no frontend — essa é só para uso em
   servidor.)

### 5. Rodar localmente com Live Server
1. Abra a pasta `tintin-app` no VS Code.
2. Instale a extensão **Live Server** (Ritwick Dey), se ainda não tiver.
3. Botão direito em `index.html` → **Open with Live Server**.
4. A tela de login deve aparecer. Clique em "criar agora", cadastre-se, e
   comece a usar.

## O que muda em relação à versão anterior (HTML/JS puro)

| Antes | Agora |
|---|---|
| Dados no `localStorage` do navegador | Dados no Postgres do Supabase, por usuário |
| Sem login — um `state` só, pra qualquer um que abrisse o arquivo | Login por e-mail/senha, cada pessoa só vê os próprios dados (Row Level Security) |
| Categoria = string solta, repetida em cada lançamento | Categoria = tabela própria com id — renomear é um `UPDATE`, não uma varredura |
| "Rendimento" e "Investimento" fixos no nome, no código | Viram flags (`is_rendimento`, `is_investimento`) configuráveis por categoria |
| Salvar = reescrever o array inteiro | Salvar = sincronização incremental (só cria/atualiza/exclui o que mudou) |

Mais detalhes técnicos de cada decisão estão em `supabase-schema/MIGRACAO.md`.

## O que ainda vale melhorar (próximos passos)

- **Cores de categoria escolhidas pelo usuário** — a coluna `color` já
  existe na tabela `categories`, só falta uma interface pra editar.
- **Desfazer (undo) de categoria** — hoje criar/renomear/excluir categoria
  já grava direto no banco; desfazer funciona certinho para lançamentos e
  previsão, mas ainda não reverte ações de categoria (ver comentário no
  código, em `undoLastAction()`, dentro de `app.js`).
- **`app.js` está grande** (mais de 1.700 linhas) — bom candidato a
  quebrar em módulos menores (`dashboard.js`, `previsao.js`,
  `realizado.js`, `mapa.js`) conforme o projeto crescer.
- **Migração pra React/Vite** — o `Sistema Virtus` (seu outro projeto) já
  usa esse stack; migrar o tintin. pra lá segue fazendo sentido como
  evolução natural, mas a base de dados (Supabase) já está pronta pra
  isso independente de qual framework de frontend você usar.

## Bibliotecas externas (via CDN)

- [Chart.js](https://www.chartjs.org/) — gráficos do painel
- [jsPDF](https://github.com/parallax/jsPDF) — relatório mensal em PDF
- [supabase-js](https://github.com/supabase/supabase-js) — cliente do Supabase
- Google Fonts (Baloo 2 + Inter) — tipografia
