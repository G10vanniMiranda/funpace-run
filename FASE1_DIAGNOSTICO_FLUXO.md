# Fase 1 — diagnóstico e mapa do fluxo atual

Data do mapeamento: 12/07/2026. Este documento foi produzido antes de qualquer alteração no código funcional.

## Fluxo observado

1. A landing page renderiza `RegistrationForm`.
2. O formulário valida os dados e chama `POST /api/registrations`.
3. O backend cria inscrição e pagamento `pending_payment`, reservando capacidade do lote.
4. O backend chama `POST https://api.checkout.infinitepay.io/links`, usando o UUID da inscrição como `order_nsu`, e persiste `invoice_slug`/URL.
5. O navegador é redirecionado ao checkout InfinitePay.
6. Após aprovação, existem dois caminhos concorrentes:
   - webhook `POST /api/webhooks/payment`;
   - redirect do comprador para `/sucesso`, seguido de `POST /api/payments/confirm` e `payment_check`.
7. O webhook normaliza o payload e, quando parece pago, confirma diretamente no banco.
8. A confirmação atualiza inscrição/pagamento, NSU, payload, datas e número de peito.
9. Depois da transação, a mesma requisição tenta enfileirar Google Sheets e enviar e-mail Resend.
10. O painel não mantém cache: cada leitura recalcula métricas a partir do banco.
11. A tela de sucesso consulta o status em polling por aproximadamente 65 segundos.

## Causas-raiz

1. **Autenticidade não comprovada:** a InfinitePay não documenta assinatura do webhook. O código aceita o payload como prova de pagamento e o algoritmo local de assinatura não corresponde a um contrato oficial conhecido.
2. **Configuração permissiva:** quando `PAYMENT_WEBHOOK_SECRET` está vazio, qualquer POST JSON chega ao processamento.
3. **Resposta lenta:** e-mail e sincronização externa são executados no caminho da requisição antes de ela terminar. A InfinitePay recomenda responder em menos de um segundo.
4. **Idempotência incompleta:** `provider_event_id` é único, mas o webhook oficial não contém `event_id`; o código usa o NSU como fallback. Não existe unicidade explícita de `gateway_transaction_id`, e duplicatas ainda geram novos audit logs e acionam pós-processamento.
5. **E-mail não durável:** existe claim de cinco minutos e idempotency key no Resend, mas não existe outbox independente com estado/tentativas/próxima execução. Falha após a confirmação depende de novo webhook ou script manual.
6. **Recuperação não agendada:** há scripts administrativos e confirmação pelo redirect, mas nenhuma rotina automática periódica em produção.
7. **Eventos órfãos sem integridade:** `run-payment-events.payment_id` não possui FK; eventos órfãos usam string vazia.
8. **Telemetria insuficiente:** há `received_at`, payload e audit log, mas faltam início/fim de processamento, duração, tentativas, resposta de verificação, erro e stack trace estruturados.
9. **Capacidade inconsistente em legado:** a auditoria encontrou `sold_count` do Lote 1 divergente. A atualização incremental não é protegida por uma reconciliação derivada.
10. **Redirect é fallback dependente do usuário:** se o webhook falhar e o comprador não clicar em Continuar, o sistema não recebe `transaction_nsu`/`slug` por esse caminho.

## Requisitos arquiteturais derivados

- Tratar todo webhook como não confiável até `payment_check` confirmar `paid=true` e o `amount` esperado.
- Persistir cada recebimento em inbox durável antes do processamento.
- Usar `transaction_nsu` como chave financeira única e uma chave determinística do evento para idempotência.
- Confirmar inscrição/pagamento e criar jobs de pós-processamento na mesma transação.
- Retirar Resend e Sheets do caminho crítico do webhook.
- Criar outbox com retry/backoff e cron autenticado para recuperação.
- Registrar todas as fases, duração, resposta sanitizada e erros.
- Responder 400 em falha transitória para provocar retry do provedor, conforme documentação oficial.

