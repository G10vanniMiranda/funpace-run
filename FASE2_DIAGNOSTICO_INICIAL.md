# Fase 2 — diagnóstico inicial e dry-run

Data de corte: 12/07/2026 21:33 (America/Manaus). Todas as consultas ao Supabase foram executadas em modo somente leitura. Nenhum registro, status, pagamento, e-mail ou contador foi alterado nesta auditoria.

## Resumo executivo

O estado operacional pós-Fase 1 está consistente: existem 302 inscrições, 104 pagas, 6 pendentes, 74 expiradas e 118 canceladas. As 104 inscrições pagas possuem pagamento local pago, `paid_at`, `confirmed_at` e evidência de e-mail. A receita nominal é R$ 8.429,60. Os contadores dos lotes conferem com inscrições pagas/pendentes.

Não existe correção automática segura pendente no snapshot atual. Os casos remanescentes são legados sem identificadores financeiros suficientes e devem ser classificados como `manual_review_required`.

## Vínculos usados atualmente

- `run-registrations.id` é enviado como `order_nsu` e funciona como external reference.
- `run-payments.registration_id` vincula pagamento e inscrição.
- `run-payments.provider_payment_id` armazena o `invoice_slug`/checkout ID.
- `run-payments.gateway_transaction_id` armazena o `transaction_nsu`.
- `run-payment-events.provider_event_id` usa event ID quando disponível e NSU/slug como fallback.
- O índice parcial `run-payments_gateway_transaction_idx` impede repetição de NSU real.

## Estado quantitativo

| Indicador | Resultado |
|---|---:|
| Inscrições | 302 |
| Pagas | 104 |
| Pendentes | 6 |
| Expiradas | 74 |
| Canceladas | 118 |
| Pagamentos locais | 294 |
| Pagamentos sem inscrição | 0 |
| Inscrições sem pagamento | 8, todas canceladas/legadas |
| Divergências inscrição × pagamento | 0 |
| Divergências de valor | 0 |
| Pago marcado como expirado | 0 |
| Pendente com pagamento local pago | 0 |
| Pago sem transaction ID real | 25 |
| Pago sem payload de gateway | 18 |
| Confirmações manuais | 13 |
| Pagos sem webhook InfinitePay | 13, os mesmos manuais |
| Pagos sem e-mail | 0 |
| Eventos com `payment_id` inválido | 11 |
| CPFs com mais de uma tentativa histórica | 39 grupos / 114 tentativas extras |
| CPFs com mais de uma inscrição paga | 0 |

## Classificação do dry-run

### Casos consistentes

- 91 pagos confirmados por webhook InfinitePay.
- 104 pagamentos e inscrições com status/valor compatíveis.
- 104 pagos com e-mail aceito pelo Resend.
- Lote 1: 98 armazenados e 98 reservados.
- Lote 2: 12 armazenados e 12 reservados.
- IDs de inscrição e pagamento sem repetição.

### `manual_review_required`

1. **13 confirmações manuais históricas** — seis possuem identificadores sintéticos `manual_reconcile_*`; sete não possuem NSU/slug. Não podem ser validadas por `payment_check`.
2. **25 pagos sem transaction ID real** — os 13 manuais mais 12/18 registros legados sem evidência completa, dependendo do critério de payload/NSU. Preservar status e solicitar extrato/comprovante.
3. **11 eventos com referência inválida** — oito `checkout_created` legados, dois `infinitepay.orphan` de probes técnicos `codex_probe` e um `manual.payment_confirmed`. Não representam pagamentos órfãos comprovados na conta.
4. **8 inscrições sem pagamento** — todas canceladas e legadas; preservar para auditoria, sem criar pagamento artificial.

## Matriz das 15 inconsistências solicitadas

| Código proposto | Situação atual | Ação do dry-run |
|---|---:|---|
| `gateway_paid_local_pending` | 0 comprovados | Nenhuma |
| `gateway_paid_local_expired` | 0 comprovados | Nenhuma |
| `gateway_payment_without_local_record` | Não determinável sem extrato | Alerta/configuração externa |
| `local_paid_without_real_transaction` | 25 | Revisão manual |
| `local_confirmed_without_gateway_evidence` | 13 manuais + legado incompleto | Revisão manual |
| `amount_mismatch` | 0 | Nenhuma |
| `webhook_missing` | 13 manuais | Revisão manual |
| `webhook_unprocessed` | 0 comprovados | Nenhuma |
| `duplicate_payment` | 0 | Nenhuma |
| `duplicate_registration` | 0 pagas; 39 grupos históricos | Informativo |
| `orphan_payment_event` | 11 eventos técnicos/legados | Revisão manual |
| `registration_without_payment` | 8 canceladas | Informativo |
| `confirmation_email_missing` | 0 | Nenhuma |
| `lot_counter_mismatch` | 0 | Nenhuma |
| `admin_status_mismatch` | 0 | Nenhuma |

## Limitação da InfinitePay

A integração pública documentada oferece criação de link, webhook e `payment_check`. O `payment_check` exige `handle`, `order_nsu`, `transaction_nsu` e `slug`. Não foi localizado endpoint público para listar/paginar todas as vendas da conta. Portanto, `fetchInfinitePayPayments()` só pode:

1. verificar transações conhecidas localmente; ou
2. consumir um extrato/exportação fornecido pela conta; ou
3. integrar um endpoint privado oficialmente fornecido pela InfinitePay.

Sem uma dessas fontes, não é tecnicamente possível provar que “todo pagamento da conta possui registro local”. A Fase 2 deve expor essa cobertura no relatório em vez de declarar reconciliação completa.

## Gaps arquiteturais

- Não existem tabelas de runs/issues de reconciliação.
- O cron atual recupera no máximo cinco pagamentos conhecidos e dez e-mails, mas não gera relatório persistido.
- Não há backoff exponencial, `Retry-After`, cache nem checkpoint de retomada.
- Não há página `/admin/reconciliacao` nem ações RBAC específicas.
- Não há alerta diário/critico consolidado.
- A regra de detecção está espalhada entre resumo, pagamentos e cron.
- O painel ainda oferece texto “marcar como pago”, embora o endpoint faça `payment_check`; a interface precisa comunicar “verificar no gateway”.
- A API não consegue descobrir pagamentos totalmente órfãos sem extrato externo.

## Plano seguro de implementação

1. Criar `run-reconciliation-runs` e `run-payment-reconciliations`.
2. Implementar serviço isolado com detector puro e adaptador InfinitePay rate-limited.
3. Reutilizar `confirmPaymentInPostgres` para toda correção segura.
4. Persistir ambiguidades como `manual_review_required` sem mutar pagamento/inscrição.
5. Criar endpoints admin de resumo, execução dry-run/apply, detalhes, reprocesso e resolução.
6. Criar página de Reconciliação com RBAC administrador/financeiro.
7. Executar cron diário no limite do plano Vercel e permitir recorte por período.
8. Enviar alerta Resend mascarado apenas quando houver críticos/erro geral.
9. Testar rate limit, backoff, idempotência, cron concorrente e todos os códigos de divergência.

## Resultado da simulação

- Registros analisados: 302 inscrições / 294 pagamentos / 375 eventos de pagamento.
- Correções automáticas propostas agora: **0**.
- Revisões manuais propostas: **25 casos financeiros sem NSU real**, consolidados para evitar duplicar alertas por entidade.
- Eventos legados/técnicos a classificar: **11**.
- Diferença financeira interna encontrada: **R$ 0,00**.
- Receita conciliada internamente: **R$ 8.429,60**.
- Cobertura externa comprovável sem extrato: parcial; 79 registros possuem os identificadores mínimos, mas consultas em massa sofrem HTTP 429 e devem usar fila/backoff.

