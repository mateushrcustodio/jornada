@AGENTS.md

# Jornada CRM — guia para o Claude

Leia este arquivo antes de mexer no código. Ele resume o que o projeto faz, onde cada coisa mora e as regras que não podem quebrar, para evitar reler o projeto inteiro. Detalhes de instalação, variáveis e limitações estão no `README.md`; a especificação original está em `especificacao-jornada-crm-bitrix24.md`.

## O que é

App para Bitrix24 (Academia CRM) que mostra a **jornada de um negócio**: por quais etapas o card já passou, quanto tempo ficou em cada uma e quem moveu. Repositório original: `github.com/mateushrcustodio/jornada` (Mateus). Vini pede mudanças na branch "Mudanças-Vinicius".

Dois modos de uso, que compartilham o mesmo código:

| Modo              | Como abre                                                  | Rota                                                  | Layout                                 |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| **Aba do card**   | Placement `CRM_DEAL_DETAIL_TAB` dentro do card no Bitrix24 | `/deal/:id/journey`                                   | Só o conteúdo, sem menu (`card-shell`) |
| **Painel (menu)** | Placement `CRM_ANALYTICS_MENU`                             | `/dashboard`, `/dashboard/{movements,stalled,stages}` | Menu superior completo (`app-shell`)   |

Do painel, clicar num negócio abre `/deal/:id/journey?source=dashboard`. Nesse caso a tela do card mostra "Voltar ao painel" e "Abrir card" (`compact-journey.tsx`). Dentro do Bitrix24 (sem `source=dashboard`) esses botões não aparecem.

## Stack e comandos

Next.js 16.4.5 (App Router, Turbopack), React 19, TypeScript, zod 4, vitest 4, Playwright, CSS puro em `src/app/globals.css`. Sem banco de dados: sessões e caches ficam em memória no servidor (precisa de uma instância Node única). Node 22.12+.

```
npm run dev          # servidor de desenvolvimento (DEMO_MODE=true no .env.local)
npm run lint
npm run typecheck
npm test             # vitest (tests/*.test.ts)
npm run build
npm run test:e2e     # Playwright; sobe o build em modo demo na porta 3000 (rode o build antes e deixe a porta livre)
```

Sempre rode lint, typecheck, `npm test` e, se mexer em tela, build + e2e antes de dar algo por pronto.

**Next 16 não é o que o treinamento conhece.** Antes de escrever código de rota, cache ou renderização, consulte `node_modules/next/dist/docs/` (regra do `AGENTS.md`).

## Mapa do código

```
src/app/                    rotas (App Router) e globals.css
  api/bitrix/placement      POST dos placements: valida token/domínio, abre a sessão, redireciona (303)
  api/auth/{start,callback} OAuth opcional fora do iframe
  api/dashboard             POST com filtros -> painel completo (visão geral e etapas)
  api/dashboard/page        POST -> total + 1 página de Movimentações ou Parados (aceita `sort` por faturamento)
  api/users                 GET -> pessoas ativas (filtro Responsável)
  api/catalog               pipelines, etapas
  api/deal/[id]             jornada; /benchmark (mediana dos fechados) e /autopsy (publica comentário)
  api/install               registra placements (exige admin)
  deal/[id]/journey         página do card (lê ?source=dashboard)
  dashboard/[view]          movements | stalled | stages
src/components/
  shell.tsx                 /deal/* => só conteúdo; resto => menu superior
  column-order.ts           ordem das colunas arrastáveis (localStorage)
  dashboard.tsx             todo o painel (Visão geral + 3 views), filtros, cache de 5 min no navegador;
                            Movimentações e Parados usam /api/dashboard/page (paginação controlada)
  stage-time-chart.tsx      aba Etapas: gráfico "Tempo médio no funil" + janela "Ver mais detalhes"
  stage-pie.tsx             pizza do tempo médio + botão Colunas/Pizza (escolha em localStorage); chart-tip.tsx = dicas dos gráficos
  compact-journey.tsx       tela do card (timeline, estatísticas, autópsia)  [journey.tsx só reexporta]
  autopsy.tsx               ficha de negócio ganho/perdido
  use-resource.ts           fetch com cache em memória no navegador (cacheMs); refresh forçado ignora o cache
  provider.tsx, ui.tsx, settings-page.tsx, install-page.tsx
src/lib/
  types.ts, calculations.ts (passagens, jornada, painel), autopsy.ts, format.ts,
  stage-insights.ts (análise por etapa/responsável/faturamento a partir do painel; sem REST),
  pie.ts (fatias da pizza: percentuais que somam 100,0%, cores fixas por etapa),
  settings.ts (preferências no localStorage), demo.ts (dados sintéticos), http.ts
  bitrix/
    client.ts   REST: limitador por portal, retry, batch, listAllBatched
    service.ts  getCatalog, getDashboard, getJourney, getBenchmark, publishAutopsy
    session.ts  sessões em memória (cookie HttpOnly), reaproveitamento por usuário
    auth.ts     verifyApp, identifyUser (método `profile`)
    config.ts   env, DEMO_MODE, domínios permitidos
tests/          *.test.ts (vitest; performance.test.ts e pagination.test.ts usam o simulador), fake-bitrix.ts (simulador do REST), e2e/app.spec.ts (Playwright)
```

## Regras que não se quebram

- **Segurança:** tokens OAuth ficam só no servidor; o navegador recebe um cookie de sessão aleatório. Respostas da API são `no-store`. Mutações exigem origem igual a `APP_URL` e JSON (`assertSameOrigin`). Chamadas REST usam o OAuth do **usuário** que abriu o app, nunca credencial global. Históricos de negócios que o usuário não pode ler não podem chegar ao navegador.
- **Única escrita no CRM:** `crm.timeline.comment.add` da autópsia (texto montado no servidor, só negócio ganho/perdido). Não adicione outras escritas sem pedido explícito.
- **Modo demo (`DEMO_MODE=true`)** usa dados de `src/lib/demo.ts` (negócio 8061 e fechados 9001–9006). Nunca misture dados demo com resposta ou erro de portal real.
- **Totais parciais nunca aparecem como completos:** acima do orçamento de negócios detalhados (padrão 1.470), de 10.000 ativos ou de 10.000 movimentações do período, a API avisa (`partial` + `warning` dizendo quantos ficaram de fora) em vez de truncar em silêncio.
- **Datas** em `America/Sao_Paulo`. Durações são corridas (sem expediente). Limite de parado é inclusivo (`>=`).
- Mantenha o resultado dos cálculos idêntico quando otimizar: há testes de equivalência em `tests/performance.test.ts`.

## Desempenho (já feito; preserve)

A lentidão vinha de espaçar 550 ms cada chamada REST, chamadas em sequência e sessão nova a cada abertura de card. Hoje:

- **Limitador por portal** (balde de chamadas, compartilhado entre sessões) em `client.ts`. Padrão: rajada 40, 2/s. Ajustável por `BITRIX_RATE_BURST` e `BITRIX_RATE_PER_SECOND` (Enterprise: ~200 e 5). Outros apps do portal consomem o mesmo limite do Bitrix24.
- **`batch`** (até 50 subcomandos = 1 chamada contada). `listAllBatched` pega a 1ª página para saber o total e pede as demais em lotes. Painel lê negócios + históricos em grupos de 49 IDs, até 6 em paralelo. O card usa 1 `batch` (`crm.item.get` + histórico, `halt=1`).
- **Sessão reaproveitada** por usuário/portal (`profile`), mantendo catálogo, nomes e amostra de fechados. O POST do placement já aquece o catálogo.
- **Páginas sob demanda (Movimentações e Parados):** `getMovementsPage` e `getStalledPage` em `service.ts`. Movimentações sem filtro lê só o bloco de 50 do histórico (o total vem do Bitrix24) e um lote com os negócios da página; com filtro, guarda na sessão a lista do período (3 min) e filtra localmente. Parados usa `crm.item.list` ordenado por `movedTime`, com fallback para o cálculo completo. Visão geral e Etapas continuam lendo tudo. Regras de pipeline/etapa vêm de `stageFilters` (`calculations.ts`), compartilhadas com o painel completo.
- **Painel completo sem teto de 500:** lê todos os ativos pela lista (barata) e só busca o histórico de cada negócio para quem se moveu no período (`getDashboard`). Ativo sem movimentação no período usa `movedTime` (mesma regra de Parados). O orçamento de negócios detalhados vem de `dashboardDealBudget()` em `client.ts` (`(rajada - 10) x 49`, ou `BITRIX_DASHBOARD_MAX_DEALS`). O histórico de ativos fica em `session.dealHistory` (10 min, até 5.000) e vale enquanto o `movedTime` do negócio não muda. Medido no simulador (200 ms, limite real): 487 ativos em 15 chamadas (~1,2 s); 1.217 ativos em 27 chamadas (~2,3 s); 2ª atualização com 6 a 9 chamadas.
- **Responsável / faturamento (Movimentações):** o campo "faturamento" é o **Valor do negócio** (`opportunity`, padrão do Bitrix24; decisão do Vini). Filtros em `Filters` (`assignedById`, `opportunityMin/Max`) e ordenação em `MovementSort`; regras em `matchesDealFilters`/`sortByOpportunity` (`calculations.ts`), valor ausente = 0. Com esses filtros ou ordenação, `getMovementsPage` sai do caminho rápido de 1 bloco: lê o período (`loadMovementRows`) e os negócios dele em lote (`loadMovementDeals`, sessão 3 min) e filtra/ordena localmente. Sem eles, o caminho rápido e o limite de 5 chamadas continuam. O nome do responsável só é resolvido nas Movimentações (mesmo `user.get` do "Movido por"); por isso os testes de equivalência ignoram `assignedByName`.
- **Caches:** catálogo 5 min (por sessão, com promessa compartilhada), amostra de fechados 10 min, navegador 5 min no painel (`DASHBOARD_CACHE_MS`) com filtros "grudados" ao voltar.
- Medido no simulador (200 ms de latência, limites reais): card fechado 5,7 s → 0,6 s; painel 30 d (400 negócios) 21,7 s → 0,9 s; Movimentações pág. 1 sem filtro 0,8 s e Parados pág. 1 0,6 s, qualquer que seja o volume (3.000 negócios: painel completo 4,3 s).

## Testes

- `tests/fake-bitrix.ts` simula o REST (batch, `halt`, permissões, balde 50/2 s). Use-o para qualquer teste de desempenho ou regressão do serviço, sem portal real.
- Nunca teste contra o portal de produção. O e2e roda sempre em modo demo.
- **Falhas conhecidas (nov/2026):** 2 de 24 e2e, `jornada mostra timeline e dados próprios do histórico` (desktop e mobile). O teste exige que o cabeçalho não contenha "Enterprise", mas o código do Mateus passou a mostrar o nome do pipeline. Falha igual no código original; não é regressão. Corrija o teste ou o cabeçalho só se pedirem.
- Se o Playwright reclamar de executável do Chromium inexistente, use `npx playwright install chromium` (ou aponte `launchOptions.executablePath` para um Chrome local, sem commitar isso).

## Como trabalhar neste repositório

1. Leia este arquivo e só abra os arquivos que a tarefa toca. `service.ts`, `client.ts` e `dashboard.tsx` são grandes: use busca por nome de função em vez de ler inteiro.
2. Em mudanças de comportamento, escreva ou ajuste o teste junto e confira lint, typecheck, `npm test` e build.
3. Não faça commit, push nem troque de branch sem o Vini pedir. Mudanças grandes (como as de desempenho) é melhor ir em branch separada para o Mateus revisar.
4. Atualize o `README.md` quando mudar comportamento visível ou variáveis de ambiente, e este arquivo quando mudar a estrutura ou uma regra acima.
5. Textos de interface e mensagens em português do Brasil.

## Pendências e ideias (não pedidas)

- Validar um card real no portal depois de cada otimização relevante (os testes usam simulador).
- Ajustar `BITRIX_RATE_*` se aparecerem erros de limite (planos diferentes têm limites diferentes).
- Os 2 testes e2e acima aguardam decisão sobre o cabeçalho mostrar ou não o pipeline.
