# Fase 3 — diagnóstico inicial de governança e operação

Data: 12/07/2026 (America/Manaus). Documento produzido antes de alterações funcionais da Fase 3.

## Dependência arquitetural

A Fase 1 está implementada e publicada. A Fase 2 não está concluída: existe apenas `FASE2_DIAGNOSTICO_INICIAL.md`; não existem tabelas de runs/issues, serviço isolado, alertas persistidos nem página de reconciliação. A Fase 3 solicita preservar e ampliar esses componentes, portanto reconciliação manual assistida e central de alertas dependem da implementação prévia desse núcleo.

## Funcionalidades semelhantes já existentes

| Necessidade da Fase 3 | O que já existe | Gap |
|---|---|---|
| Dashboard financeiro | Cards, receita total, ticket médio, série diária e gráfico | Sem mês/lote/distância consolidados no backend, conversão formal, últimos webhooks e alertas persistidos |
| Timeline | `run-audit-logs` e `run-payment-events`; drawer mostra detalhes | Não há timeline unificada nem eventos explícitos para todas as etapas |
| Histórico administrativo | Audit logs com ator, role, sessão, IP, user-agent e payload before/after em várias ações | Cobertura não é uniforme e não há severidade/evento em todos os logs |
| Central de auditoria | Página Auditoria, filtros básicos e CSV | Sem evento, gravidade, correlação, métricas e retenção formal |
| Pagamentos | Painel, filtros, payload/eventos e verificação `payment_check` | Não há revisão assistida baseada em casos persistidos |
| Alertas | Alertas calculados no frontend e logs de erro | Não persistem, não têm ciclo de vida nem notificação consolidada |
| Relatórios | CSV de inscrições, pagamentos, auditoria, parceiros, kits e check-ins | Sem XLSX/PDF e relatórios financeiros segmentados dedicados |
| Observabilidade | Logs JSON, request ID e alguns `elapsedMs` | Sem tabela/sink de métricas, percentis, agregações ou health histórico |
| RBAC | Administrador, financeiro e operação | Faltam suporte e somente leitura; constraints e tipos estão espalhados |
| Performance | Alguns índices, paginação de listas e outbox do Sheets | Resumo ainda carrega snapshots amplos; risco de N+1 e memória com milhares de registros |
| Importação | Nenhuma importação financeira | Precisa de modelo de import batch/rows/adapters |

## Defeito prioritário: contador dos lotes

O requisito é que apenas inscrições pagas consumam o contador de vagas. O código atual não atende:

- `claimRegistrationCapacity()` incrementa `sold_count` na criação da inscrição pendente;
- `createPendingRegistrationInPostgres()` também incrementa `sold_count` antes do pagamento;
- cancelamento/expiração decrementam o contador;
- disponibilidade por distância considera `pending_payment` e `paid` juntos;
- edição de capacidade usa o `sold_count` que inclui pendências.

Snapshot atual:

| Lote | `sold_count` atual | Pagas | Pendentes | Contador correto segundo Fase 3 |
|---|---:|---:|---:|---:|
| Lote 1 | 98 | 98 | 0 | 98 |
| Lote 2 | 12 | 6 | 6 | 6 |
| Lotes 3/4 | 0 | 0 | 0 | 0 |

Logo, o painel e landing page superestimam em seis as vagas efetivamente vendidas no Lote 2.

### Arquitetura correta para não causar overbooking

Não basta ignorar pendências na capacidade. É necessário separar:

1. **vendidas/confirmadas**: derivadas exclusivamente de `registration.status='paid'`;
2. **reservas temporárias**: pendências não expiradas, usadas apenas para impedir que checkouts simultâneos excedam a capacidade;
3. **disponibilidade pública**: capacidade menos pagas, com indicação separada de reservas em andamento quando necessário;
4. **capacidade transacional para novo checkout**: capacidade menos pagas menos reservas válidas, calculada sob lock.

Recomendação: tornar `sold_count` um valor derivado/reconciliado apenas de pagas e criar `reserved_count` ou consulta transacional de pendências não expiradas. Na confirmação, converter reserva em venda sem aumentar a ocupação total duas vezes. Na expiração, liberar apenas a reserva.

## Arquitetura incremental recomendada

### Núcleo de governança

- `run-registration-events`: timeline append-only normalizada;
- `run-alerts`: alertas persistidos com severidade, status, dedupe key e resolução;
- `run-import-batches` e `run-import-rows`: importação agnóstica de gateway;
- tabelas da Fase 2 `run-reconciliation-runs` e `run-payment-reconciliations`;
- serviço único de eventos para gravar audit log + timeline sem duplicar regras.

### Serviços

- `lot-capacity-service`: contagem paga, reservas, lock e validação;
- `financial-dashboard-service`: queries agregadas e paginadas;
- `registration-timeline-service`: união normalizada de domínio/auditoria;
- `alert-service`: criação idempotente, notificação e resolução;
- `statement-import-service`: parser por adapter CSV/XLSX e matching;
- `report-service`: datasets compartilhados por CSV/XLSX/PDF;
- núcleo de reconciliação definido na Fase 2.

### RBAC

Expandir roles para `administrator`, `finance`, `operation`, `support` e `read_only`, centralizando capabilities. Migrations precisam atualizar constraints de usuários/sessões antes do código.

## Ordem segura de implementação

1. Implementar o núcleo pendente da Fase 2 (runs/issues/alertas/revisão) sem alterar casos ambíguos.
2. Corrigir contador com separação venda × reserva e testes concorrentes.
3. Criar timeline append-only e ampliar auditoria.
4. Otimizar/agregar dashboard financeiro no backend.
5. Criar central de alertas e reconciliação assistida.
6. Preparar importação por adapters, começando com CSV; XLSX/PDF exigem dependências específicas.
7. Expandir RBAC e relatórios.
8. Instrumentar métricas e validar performance com volume sintético.

## Riscos que impedem implementação direta da Fase 3

- Assumir que a Fase 2 existe produziria código duplicado e páginas sem fonte de dados.
- Alterar `sold_count` sem reserva temporária abre risco real de overbooking.
- Adicionar roles no frontend sem migrar constraints do banco quebra login/sessões.
- PDF/XLSX sem definição de biblioteca/layout cria decisões de produto e dependências não aprovadas.
- O workspace contém alterações não commitadas das etapas anteriores; elas devem ser preservadas durante qualquer implementação.

