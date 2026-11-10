# Validação do MVP

Executada em 9 de novembro de 2026, Windows, Node.js 24.20.0, npm 11.9.0.

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | Aprovado, TypeScript estrito sem erros |
| `npm run lint` | Aprovado, sem erros ou avisos |
| `npm test` | 28 testes aprovados em 4 arquivos |
| `npm run build` | Build Next.js 16.4.5 de produção aprovado |
| `npm run test:e2e` | 16 testes aprovados, 8 cenários em desktop e 8 em celular, Chromium |
| Auditoria npm após instalação | 0 vulnerabilidades |
| Revisão visual | Painel e jornada revisados em desktop e celular |

## Cobertura automatizada

### Cálculos, consultas e segurança

- Ordem cronológica, desempate por ID, registros duplicados e retornos a etapas anteriores.
- Duração de passagens concluídas e da etapa atual.
- Encerramento do total em ganho/perda e etapa terminal com duração zero.
- Histórico vazio e divergência entre histórico e etapa atual.
- Autoria sem atribuições indevidas; `movedBy` usado somente na última entrada coincidente.
- Negócios parados sem movimentações recentes, limite inclusivo e exclusão de negócios encerrados.
- Sequência completa preservada ao filtrar etapas; ranking, negócios únicos e passagens.
- Pipelines monitorados, etapas ignoradas e datas em Brasília.
- Paginação REST completa, interrupção de paginação repetida e limite explícito sem amostras parciais.
- Validação de domínios, contexto da aplicação e origem de requisições.
- Renovação OAuth no servidor, cookies opacos e limpeza de sessões expiradas.
- Handler comum: dashboard sem ID, card com `PLACEMENT_OPTIONS`, rejeição de ID e JSON inválidos.
- Bloqueio da instalação real no modo demonstração.
- Confirmação de acesso via `crm.item.list` antes de disponibilizar históricos; `crm.item.get` antes da timeline.
- Erros da integração real nunca substituídos silenciosamente por dados de demonstração.

### Telas em desktop e celular

1. Painel, filtro de pipeline e atualização manual.
2. Timeline do negócio, autoria demonstrativa, etapa atual e ausência de pipeline no cabeçalho.
3. Preferências salvas no navegador, persistência após recarregar e indicadores desativados.
4. Skeleton de carregamento, erro de permissão, nova tentativa e listas vazias.
5. Telas de movimentações, parados, etapas, instalação e negócio ausente.
6. Datas personalizadas, prevenção de consulta inválida e período sem movimentações.
7. Histórico vazio e erro de API na jornada do card.
8. Navegação pelo menu (incluindo menu móvel) e paginação.

As telas principais também verificam que a página não excede a largura da janela. Tabelas extensas mantêm rolagem horizontal dentro do próprio painel.

## Capturas da versão testada

- [Painel desktop](screenshots/dashboard-desktop.png)
- [Painel celular](screenshots/dashboard-mobile.png)
- [Jornada desktop](screenshots/journey-desktop.png)
- [Jornada celular](screenshots/journey-mobile.png)

## Limites da validação

Não foram fornecidos portal ou credenciais OAuth reais. Nenhum placement foi registrado em um Bitrix24 externo, nem houve publicação em hospedagem. A integração foi implementada conforme as referências oficiais e exercitada com respostas controladas; a interface usa demonstração explicitamente identificada. A homologação no portal precisa verificar plano, escopos, permissões de cada perfil, conclusão da instalação e cookies no iframe.

Detalhes de configuração, exemplos de payload e limitações de autoria, volume e sessões estão no [README](../README.md).
