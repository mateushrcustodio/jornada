# Jornada CRM — Especificação da aplicação Bitrix24

## 1. Visão geral

Aplicação para Bitrix24 focada em negociações, com duas formas de acesso:

1. **Painel geral**, acessível pelo menu lateral esquerdo do CRM, para acompanhar movimentações e gargalos de todos os negócios.
2. **Jornada dentro do card**, acessível por uma aba própria no detalhe da negociação, para visualizar o histórico de etapas daquele negócio.

O MVP será baseado em consultas sob demanda ao histórico nativo do Bitrix24, sem dependência de eventos em tempo real.

## 2. Objetivos

- Tornar visível o caminho percorrido por cada negócio.
- Mostrar quando cada movimentação ocorreu.
- Medir quanto tempo os negócios permanecem em cada etapa.
- Identificar etapas com maior retenção.
- Exibir negócios parados há muito tempo.
- Oferecer uma visão executiva do fluxo comercial.
- Criar uma base de produto reutilizável para diferentes empresas e pipelines.

## 3. Escopo do MVP

### Incluído

- Monitoramento de negócios (`entityTypeId = 2`).
- Aba de jornada dentro do card do negócio.
- Painel geral no CRM Analytics.
- Últimas movimentações.
- Filtro por período.
- Filtro por pipeline.
- Filtro por etapa.
- Lista de negócios parados.
- Tempo médio por etapa.
- Ranking de etapas com maior retenção.
- Consulta manual à API ao abrir a tela, trocar filtros ou atualizar.

### Fora do MVP

- Notificações automáticas.
- Alertas por e-mail ou chat.
- Alteração de etapa pela aplicação.
- Gravação de histórico próprio como fonte principal.
- Monitoramento de leads, contatos ou empresas.
- Integração com BI externo.

## 4. Integração com Bitrix24

### 4.1 Aba dentro do card

Placement:

```text
CRM_DEAL_DETAIL_TAB
```

Essa aba será registrada com `placement.bind` e receberá o ID do negócio em `PLACEMENT_OPTIONS`.

Exemplo de contexto recebido:

```json
{
  "PLACEMENT": "CRM_DEAL_DETAIL_TAB",
  "PLACEMENT_OPTIONS": {
    "ID": "8061"
  }
}
```

O handler deverá:

1. Ler o ID do negócio.
2. Consultar o histórico de etapas.
3. Consultar os dados atuais do negócio, quando necessário.
4. Resolver nomes de etapas e pipelines.
5. Renderizar a timeline.

### 4.2 Painel geral no menu lateral

Placement recomendado:

```text
CRM_ANALYTICS_MENU
```

Esse placement adiciona uma entrada da aplicação no menu esquerdo da área de CRM Analytics e abre o painel sem depender de um card específico.

Documentação:

- [CRM Analytics Menu](https://apidocs.bitrix24.com/api-reference/widgets/crm/analytics-menu.html)
- [Visão geral dos placements do CRM](https://apidocs.bitrix24.com/api-reference/widgets/crm/index.html)

Como alternativa, pode ser registrado um atalho na lista de negócios:

```text
CRM_DEAL_LIST_TOOLBAR
```

Esse atalho é opcional e pode ser incluído em uma segunda etapa.

## 5. APIs utilizadas

### 5.1 Histórico de etapas

Método principal:

```text
crm.stagehistory.list
```

Parâmetros principais:

```json
{
  "entityTypeId": 2,
  "order": {
    "CREATED_TIME": "DESC"
  },
  "filter": {
    ">=CREATED_TIME": "2026-01-01T00:00:00"
  },
  "select": [
    "ID",
    "OWNER_ID",
    "CATEGORY_ID",
    "STAGE_ID",
    "STAGE_SEMANTIC_ID",
    "CREATED_TIME"
  ]
}
```

Para consultar a jornada de um negócio específico:

```json
{
  "entityTypeId": 2,
  "filter": {
    "OWNER_ID": 8061
  },
  "order": {
    "CREATED_TIME": "ASC"
  }
}
```

Documentação: [crm.stagehistory.list](https://apidocs.bitrix24.com/api-reference/crm/crm-stage-history-list.html)

### 5.2 Dados atuais do negócio

Método:

```text
crm.item.get
```

Parâmetros:

```json
{
  "entityTypeId": 2,
  "id": 8061
}
```

Campos úteis:

- `ID`;
- `TITLE`;
- `CATEGORY_ID`;
- `STAGE_ID`;
- `STAGE_SEMANTIC_ID`;
- `UPDATED_TIME`;
- `MOVED_TIME`;
- `MOVED_BY`.

Documentação: [crm.item.get](https://apidocs.bitrix24.com/api-reference/crm/universal/crm-item-get.html)

### 5.3 Pipelines

Método:

```text
crm.category.list
```

Parâmetros:

```json
{
  "entityTypeId": 2
}
```

O resultado será usado para transformar `CATEGORY_ID` em nome de pipeline.

Documentação: [crm.category.list](https://apidocs.bitrix24.com/api-reference/crm/universal/category/crm-category-list.html)

### 5.4 Nomes das etapas

Para negócios, os identificadores das etapas podem ser resolvidos usando o diretório de etapas do CRM:

```text
crm.status.entity.items
```

Parâmetro:

```json
{
  "entityId": "DEAL_STAGE"
}
```

Documentação: [crm.status.entity.items](https://apidocs.bitrix24.com/api-reference/crm/status/crm-status-entity-items.html)

## 6. Tela 1 — Jornada dentro do card

### Objetivo

Permitir que o usuário entenda rapidamente por quais etapas aquele negócio passou e quanto tempo permaneceu em cada uma.

### Estrutura

```text
Cabeçalho do card
├── Nome do negócio
├── Status atual
└── Aba Jornada

Conteúdo da aba
├── Timeline visual das etapas
├── Data e hora de entrada em cada etapa
├── Usuário que realizou a movimentação, quando disponível
├── Tempo em cada etapa
├── Etapa atual destacada
└── Resumo da jornada
    ├── Quantidade de etapas percorridas
    ├── Tempo total desde a primeira etapa
    ├── Última movimentação
    └── Tempo comparativo por etapa
```

### Informações que não devem aparecer no MVP da aba

- Valor do negócio no cabeçalho da jornada.
- Nome do pipeline no cabeçalho.
- Responsável atual como indicador separado.
- Próximo passo comercial.

Essas informações pertencem ao contexto operacional do CRM e não são o foco da aplicação.

### Exemplo de evento

```text
Qualificação
Movido por Mariana Silva
03 mai · 13:40
2d 7h nesta etapa
```

## 7. Tela 2 — Painel geral

### Objetivo

Dar ao gestor uma visão consolidada dos negócios e dos pontos de retenção do processo comercial.

### Cabeçalho

- Título: `Jornada CRM`.
- Subtítulo: `Acompanhe a movimentação dos negócios e identifique gargalos por etapa.`
- Botão `Consultar API` ou `Atualizar`.
- Data/hora da última consulta.

### Filtros

#### Período

Opções sugeridas:

- Hoje.
- Últimas 24 horas.
- Últimos 7 dias.
- Últimos 30 dias.
- Período personalizado.

O filtro deve ser aplicado sobre `CREATED_TIME` do histórico de etapas.

#### Pipeline

Opções carregadas por `crm.category.list`.

Valor especial:

```text
Todos os pipelines
```

#### Etapa

Opções carregadas a partir de `crm.status.entity.items`.

Valor especial:

```text
Todas as etapas
```

## 8. Bloco — Últimas movimentações

### Objetivo

Mostrar as alterações mais recentes de etapa dos negócios.

### Campos

- Data e hora.
- Negócio.
- Pipeline.
- Etapa anterior, quando disponível pela sequência do histórico.
- Nova etapa.
- Usuário da movimentação, quando disponível.
- Link para abrir o card.

### Ordenação padrão

```text
CREATED_TIME DESC
```

### Exemplo

| Data/hora | Negócio | Pipeline | Movimentação |
|---|---|---|---|
| 09 mai · 22:18 | #8061 · Acme Corp | Enterprise | Proposta enviada → Negociação |

## 9. Bloco — Cards parados há muito tempo

### Objetivo

Identificar negócios que permanecem na etapa atual acima de um limite relevante.

### Regra de cálculo

```text
tempo parado = agora - data de entrada na etapa atual
```

O card deve ser considerado parado quando:

```text
tempo parado >= limite configurado
```

No MVP, o limite pode ser fixo por filtro ou configuração global. Em uma evolução, o limite poderá ser diferente por pipeline e etapa.

### Campos

- Negócio.
- Pipeline.
- Etapa atual.
- Tempo parado.
- Data de entrada na etapa.
- Responsável do negócio, caso seja necessário para ação gerencial.
- Link para o card.

### Sinais visuais

- Normal: dentro do limite.
- Atenção: próximo do limite.
- Crítico: acima do limite.

## 10. Bloco — Tempo médio em cada etapa

### Objetivo

Mostrar quanto tempo os negócios normalmente permanecem em cada etapa.

### Regra de cálculo

Para cada passagem concluída por uma etapa:

```text
tempo na etapa = data de entrada na etapa seguinte - data de entrada na etapa atual
```

Para a etapa atual ainda aberta:

```text
tempo na etapa = agora - data de entrada na etapa atual
```

O tempo médio deve ser calculado separadamente por pipeline e etapa quando o filtro de pipeline estiver selecionado.

### Apresentação

- Ranking horizontal ou barras comparativas.
- Tempo médio formatado em horas ou dias.
- Quantidade de negócios considerados.
- Período analisado.

## 11. Bloco — Etapas com maior retenção

### Objetivo

Destacar as etapas que concentram maior tempo de permanência ou maior quantidade de negócios parados.

### Critérios possíveis

O MVP deve ordenar por:

```text
tempo médio na etapa DESC
```

Como indicador complementar, exibir:

- quantidade de negócios atualmente na etapa;
- percentual de negócios acima do limite;
- maior tempo individual registrado;
- pipeline relacionado.

### Exemplo

```text
1. Negociação — média de 6d 4h — 18 cards parados
2. Proposta enviada — média de 4d 2h — 11 cards parados
3. Qualificação — média de 2d 7h — 5 cards parados
```

## 12. Cálculos e regras de negócio

### Primeira entrada

A primeira ocorrência do negócio no histórico representa a entrada inicial no processo.

### Mudança de etapa

Cada registro subsequente de `crm.stagehistory.list` representa uma nova posição do negócio no fluxo.

### Tempo total da jornada

```text
tempo total = agora ou data final - primeira data registrada
```

Para negócios ganhos ou perdidos, a data final deve ser a data da última movimentação registrada, salvo necessidade de usar um campo específico de fechamento.

### Retorno para etapa anterior

Uma regressão ocorre quando o negócio volta para uma etapa que já havia percorrido anteriormente.

Esse indicador pode ser incluído na evolução comercial:

```text
retornos = quantidade de vezes em que o negócio revisitou uma etapa anterior
```

### Pipeline

O pipeline deve ser obtido a partir de `CATEGORY_ID` e resolvido com `crm.category.list`.

## 13. Navegação e rotas da aplicação

### Entrada pelo card

```text
/deal/:id/journey
```

O ID será recebido pelo `CRM_DEAL_DETAIL_TAB`.

### Entrada pelo menu geral

```text
/dashboard
```

### Rotas sugeridas para evolução

```text
/dashboard
/dashboard/movements
/dashboard/stalled
/dashboard/stages
/settings
```

## 14. Permissões e segurança

- Solicitar o escopo `crm`.
- Solicitar o escopo `placement` para registrar os placements.
- Validar o domínio e o contexto da instalação.
- Não confiar apenas no `ID` recebido no frontend.
- Executar chamadas REST usando o contexto autorizado da aplicação.
- Respeitar as permissões do usuário no Bitrix24.
- Não exibir negócios aos quais o usuário não tenha acesso.
- Separar permissões de visualização e administração na evolução do produto.

### Área administrativa

A área administrativa deve ser uma seção interna do painel e poderá permitir:

- configurar limite de card parado;
- selecionar pipelines monitorados;
- escolher etapas ignoradas;
- definir período padrão;
- habilitar ou desabilitar indicadores;
- configurar regras de SLA em uma versão futura.

## 15. Estratégia de atualização de dados

### MVP

Atualização sob demanda:

- ao abrir o painel;
- ao trocar qualquer filtro;
- ao clicar em `Atualizar`;
- ao abrir a aba dentro do card.

### Evolução

Eventos do Bitrix24 podem ser adicionados para:

- alertas em tempo real;
- atualização automática do painel;
- persistência de uma cópia própria do histórico;
- notificações de SLA.

Eventos não são necessários para a primeira versão funcional.

## 16. Performance

- Aplicar filtros diretamente na consulta REST.
- Consultar apenas o período selecionado.
- Paginar resultados extensos.
- Cachear nomes de pipelines e etapas durante a sessão.
- Evitar uma chamada individual por negócio quando o painel puder usar dados agregados.
- Mostrar estado de carregamento e mensagem clara quando não houver dados.
- Tratar limites de requisição e erros de autorização.

## 17. Estados da interface

### Carregando

Mostrar skeleton ou indicador discreto durante a consulta.

### Sem resultados

Mensagem sugerida:

```text
Nenhuma movimentação encontrada para os filtros selecionados.
```

### Erro de permissão

Mensagem sugerida:

```text
Você não tem permissão para consultar o histórico desses negócios.
```

### Erro de API

Mostrar mensagem amigável e ação para tentar novamente.

## 18. Critérios de aceite

### Card

- A aba `Jornada` aparece no detalhe de um negócio.
- O ID correto do negócio é identificado pelo placement.
- A timeline mostra todas as etapas retornadas pelo histórico.
- Cada etapa mostra data e hora.
- O tempo em cada etapa é calculado corretamente.
- A etapa atual fica visualmente destacada.
- O pipeline não aparece como informação redundante no cabeçalho.
- A interface funciona sem a ilustração decorativa.

### Painel geral

- A aplicação abre pelo menu do CRM Analytics.
- O painel funciona sem ID de negócio específico.
- As últimas movimentações aparecem em ordem decrescente.
- O filtro de período altera os resultados.
- O filtro de pipeline altera os resultados.
- O filtro de etapa altera os resultados.
- A lista de cards parados respeita o limite definido.
- O tempo médio por etapa é calculado com base no histórico.
- As etapas com maior retenção aparecem ordenadas.
- O usuário pode atualizar os dados manualmente.

## 19. Evolução comercial sugerida

Depois do MVP, os recursos com maior potencial de valor percebido são:

1. SLA por pipeline e etapa.
2. Alertas de negócios parados.
3. Detecção de regressões no funil.
4. Comparativo entre equipes ou períodos.
5. Taxa de conversão entre etapas.
6. Tempo médio até ganho ou perda.
7. Exportação para CSV ou Excel.
8. Relatórios periódicos para gestores.
9. Score de saúde da negociação.
10. Auditoria completa de movimentações.

## 20. Referências oficiais

- [CRM Detail Tab](https://apidocs.bitrix24.com/api-reference/widgets/crm/detail-tab.html)
- [CRM Analytics Menu](https://apidocs.bitrix24.com/api-reference/widgets/crm/analytics-menu.html)
- [CRM placements](https://apidocs.bitrix24.com/api-reference/widgets/crm/index.html)
- [CRM list toolbar](https://apidocs.bitrix24.com/api-reference/widgets/crm/list-toolbar.html)
- [crm.stagehistory.list](https://apidocs.bitrix24.com/api-reference/crm/crm-stage-history-list.html)
- [crm.item.get](https://apidocs.bitrix24.com/api-reference/crm/universal/crm-item-get.html)
- [crm.category.list](https://apidocs.bitrix24.com/api-reference/crm/universal/category/crm-category-list.html)
- [crm.status.entity.items](https://apidocs.bitrix24.com/api-reference/crm/status/crm-status-entity-items.html)
- [placement.bind](https://apidocs.bitrix24.com/api-reference/widgets/placement-bind.html)

