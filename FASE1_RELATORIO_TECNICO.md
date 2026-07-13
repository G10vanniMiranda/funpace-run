# Fase 1 — relatório técnico

Data: 12/07/2026 (America/Manaus)

## Resultado

O fluxo foi alterado para não confiar no webhook como prova financeira. Cada aprovação recebida precisa conter `order_nsu`, `transaction_nsu`, `invoice_slug` e valor válido, e é confirmada servidor-a-servidor em `payment_check` antes da transação local.

## Arquitetura final

`formulário → inscrição/pagamento pendente → checkout InfinitePay → webhook com secret URL → payment_check → transação idempotente → resposta HTTP → e-mail/Sheets idempotentes → painel com atualização periódica`

Um cron autenticado executa recuperação diária às 03:17 (Manaus): verifica pagamentos não pagos que já possuam NSU/slug e recupera e-mails de inscrições pagas sem confirmação. Falhas do webhook continuam tendo retry imediato pela InfinitePay quando a API responde com erro.

## Causas-raiz corrigidas

- webhook aceito sem autenticação quando o segredo estava vazio;
- payload do webhook usado como prova de pagamento sem validação `payment_check`;
- e-mail e Sheets atrasavam a resposta ao provedor;
- aprovação atrasada recusada por mudança posterior de lote/preço;
- idempotência baseada apenas no ID do evento, ausente no payload oficial;
- ausência de rotina automática agendada;
- scripts capazes de confirmar pagamento sem prova do gateway;
- painel aberto sem atualização automática.

## Garantias implementadas

- segredo obrigatório e comparação em tempo constante;
- verificação oficial de pagamento e valor;
- idempotência por `transaction_nsu`, índice único parcial e lock transacional;
- eventos repetidos não atualizam novamente nem geram novo audit log financeiro;
- pagamento confirmado nunca é rebaixado por evento atrasado;
- e-mail usa chave idempotente estável do Resend;
- cron recupera pagamentos verificáveis e e-mails faltantes;
- logs estruturados incluem inscrição, NSU, duração, resultado, erro e stack;
- painel recarrega a cada 15 segundos e ao voltar para a aba;
- scripts de confirmação/criação manual desativados.

## Reconciliação inicial de produção

- índice único financeiro aplicado com sucesso;
- 11 e-mails ausentes enviados pelo Resend: 11 aceitos, 0 falhas;
- contador do Lote 1 corrigido de 80 para 98 com audit log;
- pós-auditoria: 104 pagos, 104 com e-mail, 0 divergências de status/valor, lotes consistentes;
- 2 eventos órfãos classificados como probes técnicos `codex_probe`, sem venda real;
- 13 confirmações manuais históricas preservadas. Elas não possuem NSU/slug real suficiente para validação retroativa e não foram artificialmente alteradas.

## Testes e validações

- `npm run lint`: aprovado;
- `npm test`: 52/52 aprovados;
- `npm run build`: aprovado;
- cenários cobertos: PIX aprovado, expirado, recusado, payload inválido, aprovação atrasada, evento que não rebaixa pago, contrato `payment_check`, perda de conexão, idempotency key do Resend, falhas/retry da outbox do Sheets e regras administrativas.

## Estado de implantação

A versão foi publicada em produção. `CRON_SECRET` está configurado, o índice de banco está ativo e a função explícita do cron foi validada ponta a ponta: acesso público retorna 401; acesso autenticado retornou 200 com `checked=0`, `errors=0` e `emailsRecovered=0`. O plano Hobby rejeitou a frequência de cinco minutos; por isso o fallback roda diariamente. O webhook e os retries do provedor permanecem como caminho de confirmação em tempo real.
