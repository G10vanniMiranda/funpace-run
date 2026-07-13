# Fase 2 — reconciliação, capacidade e início da Fase 3

Data de implantação: 13/07/2026 (America/Manaus).

## Resultado

- Reconciliação persistente em modo `dry_run` e `apply`, com histórico de execuções.
- 25 pagamentos históricos mantidos como `manual_review_required`.
- Nenhuma inscrição ou pagamento ambíguo foi alterado.
- Oito inscrições canceladas sem pagamento foram registradas como informativas.
- Seis referências `manual_reconcile_*` já documentadas foram removidas da fila duplicada de revisão, sem alterar o histórico financeiro.
- Sete checkouts inequivocamente vencidos foram expirados e auditados.

## Modelo central de capacidade

O serviço `server/lot-capacity.ts` calcula quatro estados independentes:

1. `capacityTotal`: capacidade configurada;
2. `confirmed`: inscrições com status `paid`;
3. `temporaryReservations`: inscrições `pending_payment` ainda não vencidas;
4. `available`: `capacityTotal - confirmed - temporaryReservations`.

`sold_count` permanece por compatibilidade, mas agora é somente uma projeção de vendas confirmadas. Decisões de disponibilidade usam confirmadas e reservas ativas. Criação de reserva, confirmação, cancelamento e expiração compartilham o mesmo advisory lock no PostgreSQL.

## Reconciliação

Novas tabelas:

- `run-reconciliation-runs`;
- `run-payment-reconciliations`;
- `run-operational-alerts`.

O serviço `server/payment-reconciliation.ts` concentra detecção, comparação, relatório e consulta serial ao gateway com retry/backoff. Correções seguras reutilizam a confirmação idempotente existente. Casos sem evidência suficiente nunca são mutados.

## Fase 3 iniciada

- Nova rota `GET /api/admin/reconciliation`;
- nova rota `POST /api/admin/reconciliation/run`;
- RBAC para administrador e financeiro;
- nova seção **Reconciliação** no painel;
- KPIs de revisão, criticidade, varredura e correções;
- fila dos 25 históricos com acesso à timeline existente da inscrição;
- auditoria e timeline existentes foram reutilizadas para evitar duplicação.

## Evidências de produção

Última validação somente leitura:

| Estado | Total |
|---|---:|
| Pagas | 104 |
| Expiradas | 81 |
| Canceladas | 118 |
| Pendentes | 0 |
| Revisão manual obrigatória | 25 |

| Lote | Capacidade | Confirmadas | Reservas | Disponíveis |
|---|---:|---:|---:|---:|
| Lote 1 | 100 | 98 | 0 | 2 |
| Lote 2 | 400 | 6 | 0 | 394 |
| Lote 3 | 100 | 0 | 0 | 100 |
| Lote 4 | 100 | 0 | 0 | 100 |

- Migrações aplicadas com sucesso no Supabase.
- 58/58 testes aprovados.
- TypeScript sem erros.
- Build Vite de produção aprovado.
- `GET /api/health`: HTTP 200, Supabase OK.
- `GET /api/availability`: quatro estados publicados corretamente.
- `GET /api/admin/reconciliation` sem sessão: HTTP 401, conforme esperado.

## Continuidade da Fase 3

A base já suporta central de alertas. A próxima entrega deve conectar geração/acknowledgement de alertas, importação de extratos por adaptadores, exportações XLSX/PDF e métricas de latência, preservando os serviços e rotas desta fase.
