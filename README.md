# Jornada CRM

MVP instalável no Bitrix24 para acompanhar a jornada de negócios (`entityTypeId = 2`), com painel de gestão, timeline dentro do card e preferências locais. Next.js 16, React 19, TypeScript, App Router e CSS responsivo. Sem banco de dados, eventos, webhooks obrigatórios ou serviço externo de persistência.

O diretório original continha somente `especificacao-jornada-crm-bitrix24.md`. A especificação foi preservada. Nenhum protótipo visual estava disponível; a interface foi criada para este MVP.

## Executar localmente

Requisitos: Node.js 22.12 ou superior e npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). A configuração de exemplo habilita `DEMO_MODE=true`, com aviso explícito em todas as telas. Os dados sintéticos estão isolados em `src/lib/demo.ts`; nunca substituem respostas ou erros de uma integração real. O negócio de demonstração [8061](http://localhost:3000/deal/8061/journey) tem quatro entradas na timeline. Não são criados links fictícios para cards de um portal real.

```powershell
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run build
npm run test:e2e
npm start
```

Os testes E2E iniciam o servidor do build de produção automaticamente em modo demonstração. Execute o build antes dos testes e deixe a porta 3000 livre. Não use uma instância de produção conectada para executá-los. O build não consulta Bitrix24 nem baixa fontes externas.

## Rotas

| Rota                                              | Função                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/dashboard`                                      | Visão geral, filtros, atividade, retenção e negócios parados                                |
| `/dashboard/movements`                            | Movimentações paginadas, autoria quando disponível e links                                  |
| `/dashboard/stalled`                              | Negócios ativos acima do limite, inclusive sem movimentações recentes                       |
| `/dashboard/stages`                               | Tempos médios, amostra, quantidade atual, quantidade e percentual parado por pipeline/etapa |
| `/deal/:id/journey`                               | Timeline, duração por passagem, tempo total e etapa atual                                   |
| `/settings`                                       | Preferências deste navegador                                                                |
| `/install`                                        | Instruções e registro dos placements pelo administrador                                     |
| `/api/bitrix/placement`                           | Handler POST comum para os dois placements e instalação                                     |
| `/api/auth/start` e `/api/auth/callback`          | Conexão OAuth opcional fora do iframe                                                       |
| `/api/dashboard`, `/api/catalog`, `/api/deal/:id` | Camada segura de consulta, sem tokens na resposta                                           |
| `/api/dashboard/page`                             | POST que devolve só o total e a página aberta de Movimentações ou Parados                   |
| `/api/users`                                      | GET com as pessoas ativas do portal (`user.get`), para o filtro Responsável                 |
| `/api/deal/:id/benchmark`                         | Mediana de tempo dos negócios já fechados do mesmo funil e resultado, usada na autópsia     |
| `/api/deal/:id/autopsy`                           | POST que publica a autópsia como comentário na timeline do negócio                          |
| `/api/install`                                    | Registro dos placements, exige sessão e `user.admin`                                        |

## Variáveis de ambiente

Todos os segredos são exclusivos do servidor; não há variáveis `NEXT_PUBLIC_*` de autenticação. `.env.local` não deve ser versionado.

| Variável                   | Configuração                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP_URL`                  | Origem pública do app, por exemplo `https://jornada.suaempresa.com`. Use HTTPS no Bitrix24. Local: `http://localhost:3000`.                            |
| `DEMO_MODE`                | `true` para dados sintéticos. Configure `false` para conectar ao portal. O registro real é bloqueado no modo demonstração.                             |
| `BITRIX_ALLOWED_DOMAINS`   | Domínios exatos permitidos, separados por vírgula, sem protocolo, porta ou caminho. Ex.: `empresa.bitrix24.com.br`.                                    |
| `BITRIX_CLIENT_ID`         | Identificador OAuth da aplicação local cadastrada no Bitrix24.                                                                                         |
| `BITRIX_CLIENT_SECRET`     | Chave secreta OAuth, utilizada somente no servidor.                                                                                                    |
| `BITRIX_APP_CODE`          | Opcional. Código retornado por `app.info`; se omitido, usa `BITRIX_CLIENT_ID`. Confira o código da sua aplicação se o portal informar valor diferente. |
| `BITRIX_APPLICATION_TOKEN` | Opcional. Token de aplicação da instalação para verificação adicional de POSTs de placements. Se configurado, o handler exige correspondência exata.   |
| `BITRIX_MEMBER_ID`         | Opcional. Restringe a instalação a um `member_id` conhecido.                                                                                           |

Depois de alterar domínios, reinicie e gere um novo build: a política `frame-ancestors` é construída na configuração do Next. Não publique esta demonstração como se estivesse conectada; desative explicitamente `DEMO_MODE` e configure a instalação real.

## Instalar no Bitrix24

1. Publique a aplicação em HTTPS em um processo Node.js. Para o MVP, use **uma instância** (sessões e cache em memória). Configure domínio autorizado e URL pública antes do build.
2. Em **Aplicativos / Recursos para desenvolvedores / Integrações / Aplicação local**, crie uma aplicação com interface. Os nomes exatos dos menus dependem da versão do portal.
3. Solicite os escopos **`crm`, `placement` e `basic`**. `basic` é usado para verificar o contexto via `app.info` e a administração via `user.admin`.
4. Configure a URL do aplicativo/handler como `https://SEU_APP/api/bitrix/placement`.
5. Configure a URL de instalação como `https://SEU_APP/api/bitrix/placement?install=1`.
6. Se usar conexão OAuth externa, configure o redirecionamento autorizado como `https://SEU_APP/api/auth/callback`.
7. Preencha `BITRIX_CLIENT_ID`, `BITRIX_CLIENT_SECRET` e, se necessário, `BITRIX_APP_CODE`. Reinicie a aplicação com `DEMO_MODE=false`.
8. Abra o instalador da aplicação **dentro do Bitrix24** como administrador. O POST inicial estabelece uma sessão segura e redireciona para `/install`.
9. Clique em **Registrar placements**. O servidor verifica `user.admin`, consulta `placement.get` e registra os bindings ausentes. Em caso de erro parcial, é possível tentar novamente sem recriar bindings já existentes.
10. Clique em **Concluir instalação**. O SDK oficial executa `BX24.installFinish()` dentro do iframe. Sem essa conclusão, os placements podem não aparecer. Recarregue o portal.

Os dois bindings usam o mesmo handler:

```json
{
  "PLACEMENT": "CRM_ANALYTICS_MENU",
  "HANDLER": "https://SEU_APP/api/bitrix/placement",
  "TITLE": "Jornada CRM"
}
```

```json
{
  "PLACEMENT": "CRM_DEAL_DETAIL_TAB",
  "HANDLER": "https://SEU_APP/api/bitrix/placement",
  "TITLE": "Jornada"
}
```

No portal, o painel fica em **CRM Analytics → Aplicativos → Jornada CRM**. A timeline fica na aba **Jornada** do negócio (pode estar em **Mais**). `placement.bind` exige o contexto OAuth de uma aplicação; um webhook não registra esses placements.

O POST do card contém `PLACEMENT=CRM_DEAL_DETAIL_TAB` e `PLACEMENT_OPTIONS={"ID":"8061"}`. O handler faz parse do JSON, valida um ID inteiro positivo e redireciona para `/deal/8061/journey`. O POST do analytics não exige ID e redireciona para `/dashboard`. Também são aceitos parâmetros `auth[...]` do instalador. Endpoints de destino fornecidos pelo POST são ignorados: o REST sempre utiliza o domínio autorizado e o OAuth usa o servidor fixo oficial.

## Consultas, acesso e segurança

- O token recebido pelo handler é validado contra o domínio permitido e `app.info.CODE`. Há validação adicional opcional de token de aplicação e `member_id`.
- Tokens OAuth e refresh tokens ficam em memória no servidor, isolados por sessão de usuário. O navegador recebe somente um identificador aleatório de 256 bits em cookie `HttpOnly`.
- Em HTTPS o cookie usa `Secure`, `SameSite=None` e `Partitioned` para embedding. Em localhost usa `SameSite=Lax`. Servidor e navegador devem suportar esse fluxo; confira as políticas de cookies do ambiente real.
- Sessões duram até 8 horas e tokens são renovados pelo servidor. Reiniciar o processo apaga as sessões; reabra o app pelo portal. O limite é de 1.000 sessões simultâneas; expiradas são removidas ao criar outras. Cada abertura no portal (menu ou aba do card) identifica o usuário pelo método `profile`; se o cookie já aponta para uma sessão válida do mesmo usuário e portal, só os tokens são trocados e os caches continuam valendo. Sem o ID do usuário, nada é reaproveitado.
- Chamadas REST usam o OAuth do usuário que abriu o widget, nunca uma credencial administrativa global. `crm.item.list` confirma quais negócios da amostra são legíveis; históricos de itens sem acesso não são enviados ao navegador. A timeline consulta `crm.item.get` antes do histórico.
- Mutações internas exigem origem igual a `APP_URL` e conteúdo JSON. O handler de placement aceita a origem HTTPS do portal permitido. IDs do frontend nunca concedem acesso por conta própria.
- Somente um administrador do portal pode registrar placements. As configurações de análise são preferências locais do usuário e não alteram o CRM.
- **Única escrita no CRM:** o botão "Publicar na timeline" da autópsia chama `crm.timeline.comment.add` com o OAuth de quem clicou (o comentário aparece com o nome dele). O texto é montado no servidor a partir do histórico, nunca recebido do navegador, e só negócios já ganhos ou perdidos são aceitos. Exige o escopo `crm` já solicitado na instalação e a permissão de comentar no negócio. O app não detecta se a autópsia já foi publicada antes; cada clique cria um comentário novo.
- As respostas da API e do handler usam `no-store`. Tokens não aparecem em URLs de redirecionamento, logs da aplicação, HTML ou JSON de resposta.
- A política de framing permite somente a própria origem e os portais configurados. Não configure `X-Frame-Options: DENY/SAMEORIGIN` no proxy de hospedagem.

## Cálculos e amostragem

- Uma passagem termina na entrada seguinte, mesmo quando a próxima entrada estiver fora do período ou da etapa filtrada. Etapas revisitadas viram novas passagens.
- Etapa atual aberta: hora da consulta menos entrada na etapa. Ganhos/perdidos: o total termina na última movimentação e a etapa terminal tem duração zero.
- O painel filtra movimentações por `CREATED_TIME`, categoria e etapa no REST. Lê todos os negócios ativos pela lista (50 por página, em lotes de 50 páginas) e, só para os negócios que se moveram no período, busca os históricos completos em grupos de 49 IDs, num único `batch` por grupo (lista + um histórico por negócio), até 6 grupos ao mesmo tempo, preservando os limites de cada passagem e a etapa anterior. Negócio ativo sem movimentação no período não tem o histórico lido: entra em "em andamento" e "parados" pelo `movedTime` da lista. O histórico lido de cada negócio ativo fica na sessão por 10 minutos e só é relido quando o `movedTime` do negócio muda, então "Atualizar" custa poucas chamadas. Listas longas usam a primeira página para obter o total e pedem as demais juntas em `batch` (até 2.500 registros por chamada contabilizada).
- **Páginas sob demanda:** as abas Movimentações e Parados não carregam o painel inteiro. Pedem ao servidor só o total e a página aberta (10 itens); cada página já vista fica no navegador por 5 minutos. A visão geral e as etapas continuam calculando tudo, porque as médias e contagens dependem de todos os dados.
  - **Movimentações** sem filtro de pipeline/etapa (e sem pipelines monitorados nem etapas ignoradas): o Bitrix24 informa o total na primeira chamada e o app lê só o bloco de 50 registros que contém a página, mais um lote com os negócios dessa página (acesso, histórico e duração). Com filtro, a lista do período é lida uma vez (só as linhas, sem ler cada negócio) e guardada na sessão por 3 minutos; pipeline, etapa e etapas ignoradas são aplicados localmente para o total ser exato. "Atualizar" descarta essa lista.
  - **Responsável e faturamento:** a barra de filtros tem **Responsável** (pessoa ativa do portal, lida por `user.get` e guardada na sessão por 10 minutos) e **Faturamento** (mínimo e máximo, inclusivos), que é o campo padrão **Valor do negócio** (`opportunity`) lido na moeda do próprio negócio; a faixa compara o número sem converter moedas, e negócio sem valor conta como 0. Os filtros valem para todas as abas: a visão geral aplica ao pedir os ativos (`assignedById`, `>=opportunity`, `<=opportunity`) e ao calcular; Parados envia os mesmos campos ao `crm.item.list`. Em Movimentações, o histórico de etapas não traz responsável nem valor, então com esses filtros (ou com a ordenação por faturamento) a lista do período é lida uma vez e os negócios dessas movimentações vêm em lotes de até 50 consultas de 50 IDs (2.500 negócios por chamada contada), também na sessão por 3 minutos; filtrar, ordenar e paginar depois disso não repete a leitura. Movimentações de negócios sem acesso ficam fora da contagem. Sem permissão em `user.get`, o filtro Responsável fica indisponível e o restante segue funcionando.
  - **Colunas e ordenação (Movimentações):** a tabela mostra também **Pessoa responsável** e **Faturamento**. Os títulos são arrastáveis (mouse, toque ou setas ← → com a alça da coluna em foco) e a ordem fica no `localStorage` (`jornada-crm.movement-columns.v1`); "Restaurar colunas" volta ao padrão. A seta ao lado de Faturamento ordena todas as páginas: o primeiro clique vai do maior para o menor e cada clique seguinte inverte; "Limpar" volta à ordem por data. Valores iguais ficam da movimentação mais recente para a mais antiga.
  - **Parados** usam `crm.item.list` ordenado por `movedTime` (negócios ativos com `movedTime` anterior ao limite), que já devolve o total. O tempo parado vem de `movedTime`; a visão geral usa a última entrada do histórico quando existe. Os dois coincidem em condições normais. Se o portal não aceitar o filtro, o app volta ao cálculo completo.
  - O total de Movimentações pode incluir registros de negócios que o usuário não pode ler; esses ficam fora da página, que então pode mostrar menos de 10 linhas.
- Busca negócios atualmente ativos **sem restringir a data de movimentação**, para detectar também cards antigos parados. Aplica pipeline, etapa, preferências e acesso a essa população. O limite é inclusivo (`>=`).
- A média é por **passagem com entrada no período**; negócios únicos e passagens são mostrados separadamente. Não é uma média do tempo recortado dentro da janela. Etapas terminais de duração zero entram na amostra quando não forem ignoradas nas configurações.
- O ranking separa pipeline e etapa, ordena pela média decrescente e mostra quantidade atual, quantidade e percentual acima do limite, amostra e maior tempo. Etapas sem passagens na janela podem ter negócios atuais; exibem **Sem passagens**, nunca uma média estimada.
- **Tempo médio no funil** (aba Etapas, coluna da direita): gráfico de colunas com o tempo médio de cada etapa **na ordem do funil** (campo `SORT`), um pipeline por vez (abas quando houver mais de um), e uma frase apontando o gargalo. Etapas de ganho/perda com duração zero ficam fora do gráfico. "Ver mais detalhes" (ou clicar numa coluna) abre uma janela com: indicadores do funil (tempo médio, gargalo, passagens, faturamento em análise, parados e valor parado), gráfico por etapa com média, mediana e maior tempo, e, para a etapa escolhida, mediana, 90º percentil, distribuição dos tempos, de onde os negócios vieram e para onde foram, tabela por responsável (tempo médio comparado à etapa, faturamento, parados), os negócios que mais demoraram e os parados agora; no fim, o resumo de cada responsável no funil. Tudo é calculado no navegador a partir do painel já carregado (`src/lib/stage-insights.ts`), sem chamadas extras ao Bitrix24, e respeita os filtros da tela. Faturamento é o Valor do negócio somado uma vez por negócio, na moeda mais comum; negócios em outra moeda ficam fora das somas (o app avisa). O nome do responsável vem da lista de pessoas ativas (`/api/users`); sem ela, aparece "Usuário #ID".
- Catálogo resolvido por `crm.category.list` e `crm.status.entity.items`: usa `DEAL_STAGE` para pipeline 0 e `DEAL_STAGE_<id>` para outros pipelines. Cache de metadados por sessão por cinco minutos, compartilhado entre consultas simultâneas e adiantado no POST do placement, enquanto o navegador carrega a página.
- Datas e horários apresentados em `America/Sao_Paulo`. Períodos personalizados usam dias completos de Brasília; o período máximo é de 366 dias. Durações são corridas, sem calendário de expediente.
- Todos os dados permanecem em memória durante a consulta. Preferências são guardadas exclusivamente no `localStorage` do navegador; é possível restaurar padrões.

## Autópsia do negócio

Em negócios ganhos ou perdidos, a aba do card mostra uma ficha com: resultado e ciclo, etapas puladas, voltas de etapa, etapa em que mais demorou e comparação com os fechados do mesmo funil. "Copiar texto" gera o resumo no formato de comentário do Bitrix24 (títulos em `[b]`).

- **Etapas puladas:** etapas do funil entre a primeira visitada e o ponto de saída que o negócio nunca visitou. Em ganhos, o ponto de saída é a etapa final; em perdidos, a etapa mais avançada alcançada, para que "Perdido" nunca conte como pulada. Depende da ordem (`SORT`) das etapas no portal.
- **Voltas:** passagem para uma etapa de ordem menor dentro do mesmo pipeline. Mudança de pipeline não conta como volta.
- **Comparação:** mediana do ciclo (primeira a última entrada no histórico) dos 50 negócios fechados mais recentes do mesmo pipeline e do mesmo resultado, excluindo o próprio. Só aparece com pelo menos 3 negócios. A amostra é lida com as permissões de quem consultou e fica em cache na sessão por 10 minutos. Ao abrir um negócio fechado, a leitura da amostra começa junto com a jornada (um `crm.item.list` e um `batch` com os históricos), e `/benchmark` só aguarda o resultado.
- A ficha não aponta responsáveis: a autoria das mudanças depende do que o histórico do portal registra.
- No modo demonstração, "Publicar na timeline" é simulado e nada é enviado. Os negócios 9001 a 9006 são fechados de demonstração (9001 tem etapa pulada e volta).

## Limitações conhecidas

1. **Validação em portal real pendente**: sem credenciais ou instalação fornecidas, os testes utilizam respostas controladas da API e modo demonstração. É necessário homologar a instalação, os escopos, a disponibilidade dos métodos/plano e as permissões com usuários do portal de destino.
2. **Autoria**: `crm.stagehistory.list` não garante o usuário de cada mudança. O app exibe a autoria quando presente no registro. Para a última entrada, também usa `movedBy` como identificador de usuário quando a etapa e o instante coincidem exatamente com `movedTime` do negócio atual. Não atribui retroativamente o responsável ou a última autoria a todas as entradas. O seletor padrão usa somente campos documentados do histórico; nas demais entradas a autoria pode aparecer como não disponibilizada. Dados da demonstração têm autores sintéticos explícitos.
3. **Volume**: são percorridas as páginas REST. O painel completo lê até 10.000 negócios ativos e 10.000 movimentações do período, e detalha (histórico por negócio) até `BITRIX_DASHBOARD_MAX_DEALS` negócios por atualização; por padrão são `(BITRIX_RATE_BURST - 10) x 49`, ou 1.470 com a rajada de 40, o que mantém a consulta dentro da rajada do Bitrix24 sem espera. Acima disso, os negócios mais recentes do período são detalhados primeiro e o painel avisa quantos ficaram de fora; o total de ativos continua exato. Totais parciais nunca aparecem como completos. Para operações maiores, será necessário evoluir o processamento sob demanda ou segmentar o uso.
4. **Consistência**: o Bitrix24 não fornece uma transação de leitura entre histórico e estado atual. Uma mudança durante a consulta pode produzir uma divergência. A timeline sinaliza quando o último registro difere da etapa atual. Refaça a consulta nesse caso.
5. **Infraestrutura**: memória local exige uma instância Node persistente. Múltiplas réplicas, execução serverless sem afinidade ou reinícios podem invalidar sessões. Nenhum banco foi adicionado para contornar isso.
6. **Iframe e cookies**: políticas corporativas ou navegadores que bloqueiem cookies de iframe podem exigir ajustar a implantação ou abrir a aplicação fora do iframe via OAuth. O SDK é carregado apenas no instalador para concluir a instalação.
7. **Rate limits**: o Bitrix24 limita por portal com um "balde" (planos comuns: rajada de 50 e 2 por segundo; Enterprise: 250 e 5/s). O app usa um balde próprio por portal, compartilhado entre as sessões: chamadas independentes saem juntas até 40 por rajada e depois seguem no ritmo de 2 por segundo. Ajuste com `BITRIX_RATE_BURST` e `BITRIX_RATE_PER_SECOND` (Enterprise, por exemplo, 200 e 5); o orçamento de negócios detalhados do painel acompanha a rajada e pode ser fixado com `BITRIX_DASHBOARD_MAX_DEALS`. Erros de limite ainda têm novas tentativas com backoff e freiam as demais chamadas. Outros apps do mesmo portal consomem o mesmo limite.
8. **Histórico nativo**: o app mostra somente o que o portal disponibiliza. Entradas ausentes, negócios migrados ou histórico apagado limitam a reconstrução. O identificador é exibido quando o nome de uma etapa histórica já não está disponível.

## Organização dos arquivos criados

| Grupo                    | Arquivos e responsabilidade                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuração             | `package.json`, `package-lock.json`, `tsconfig.json`, `next-env.d.ts`, `next.config.ts`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `.env.local` local ignorado |
| Orientações do framework | `AGENTS.md`, gerado automaticamente pelo Next.js durante o desenvolvimento                                                                                              |
| App Router               | `src/app/layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `globals.css`; páginas em `dashboard/`, `deal/`, `settings/` e `install/`                |
| Componentes              | `src/components/dashboard.tsx`, `journey.tsx`, `settings-page.tsx`, `install-page.tsx`, `shell.tsx`, `provider.tsx`, `ui.tsx`, `use-resource.ts`                        |
| Domínio                  | `src/lib/types.ts`, `calculations.ts`, `format.ts`, `settings.ts`, `demo.ts`, `http.ts`                                                                                 |
| Integração               | `src/lib/bitrix/auth.ts`, `client.ts`, `config.ts`, `errors.ts`, `service.ts`, `session.ts`                                                                             |
| Rotas da API             | `src/app/api/{dashboard,catalog,deal,auth,bitrix,install}/`                                                                                                             |
| Verificação              | `vitest.config.ts`, `playwright.config.ts`, `tests/calculations.test.ts`, `tests/bitrix.test.ts`, `tests/server-only.ts`, `tests/e2e/app.spec.ts`                       |
| Documentação             | `README.md`, `docs/payloads.json`, `docs/validation.md`                                                                                                                 |

## Referências oficiais consultadas

- [Histórico de etapas](https://apidocs.bitrix24.com/api-reference/crm/crm-stage-history-list.html)
- [Dados atuais do negócio](https://apidocs.bitrix24.com/api-reference/crm/universal/crm-item-get.html)
- [Listagem com permissões de leitura](https://apidocs.bitrix24.com/api-reference/crm/universal/crm-item-list.html)
- [Pipelines](https://apidocs.bitrix24.com/api-reference/crm/universal/category/crm-category-list.html)
- [Nomes das etapas](https://apidocs.bitrix24.com/api-reference/crm/status/crm-status-entity-items.html)
- [Contexto da aplicação](https://apidocs.bitrix24.com/api-reference/common/system/app-info.html)
- [Menu CRM Analytics](https://apidocs.bitrix24.com/api-reference/widgets/crm/analytics-menu.html)
- [Aba do card](https://apidocs.bitrix24.com/api-reference/widgets/crm/detail-tab.html)
- [Registro dos placements](https://apidocs.bitrix24.com/api-reference/widgets/placement-bind.html)

Exemplos completos de requests e responses: [`docs/payloads.json`](docs/payloads.json). Resultado dos checks executados: [`docs/validation.md`](docs/validation.md).
