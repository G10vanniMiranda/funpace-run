import { readFileSync, writeFileSync } from 'node:fs';
const d=JSON.parse(readFileSync('.tmp/audit-data.json','utf8')); const brl=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
const headers=['Número da inscrição','Nome completo','CPF mascarado','E-mail','WhatsApp','Sexo','Distância','Lote','Camisa','Valor pago','Método','Status inscrição','Status pagamento','ID transação InfinitePay','Data inscrição','Data confirmação','Evento','Código interno','Webhook recebido','Tentativas webhook registradas','E-mail enviado','Data e-mail','Provedor e-mail','ID e-mail','Tentativas e-mail registradas','Envios registrados','Falhas registradas'];
const rows=d.paidRows.map(r=>[r.registrationNumber,r.fullName,r.cpf,r.email,r.whatsapp,r.gender,r.distance,r.lot,r.shirt,brl(r.amountPaidCents),r.paymentMethod||'Não informado',r.registrationStatus,r.paymentStatus,r.infinitePayTransactionId||'',r.createdAt,r.confirmedAt,r.event,r.internalCode,r.paymentMethod==='manual_reconciled_paid'?'Não':'Sim',r.paymentMethod==='manual_reconciled_paid'?0:1,r.emailSent?'Sim':'Não',r.emailSentAt||'',r.emailProvider||'',r.emailId||'',r.emailAttemptsRecorded,r.emailSentLogs,r.emailFailedLogs]);
writeFileSync('AUDITORIA_INSCRICOES_PAGAS.csv','\ufeff'+[headers,...rows].map(x=>x.map(esc).join(';')).join('\r\n'));
const paidTable=rows.map(r=>`| ${r[0]} | ${String(r[1]).replaceAll('|','/')} | ${r[2]} | ${r[5]} | ${r[6]} | ${r[7]} | ${r[8]} | ${r[9]} | ${r[10]} | ${r[11]} | ${r[12]} | ${r[13]||'—'} | ${r[14]} | ${r[15]} | ${r[18]} | ${r[20]} |`).join('\n');
const report=`# Auditoria completa das inscrições do FunPace

Data de corte: **12/07/2026 20:33 (America/Manaus)** (snapshot do banco em 13/07/2026 00:33 UTC). Escopo: código-fonte, PostgreSQL/Supabase de produção e consultas individuais à API \`payment_check\` da InfinitePay. Todas as operações no banco foram executadas em transação \`BEGIN READ ONLY\` e finalizadas com \`ROLLBACK\`. Nenhum registro foi alterado.

## Resumo executivo

O núcleo cadastro–pagamento está consistente para os **104 atletas pagos**: inscrição e pagamento têm o mesmo status e valor, todos possuem datas de pagamento e confirmação, e não há CPF com duas inscrições pagas. A receita nominal das inscrições é **${brl(d.financial.revenueCents)}**.

O sistema, porém, **não está integralmente consistente**. Os pontos de maior atenção são: **11 confirmados sem evidência de e-mail enviado**, **13 pagamentos confirmados manualmente sem webhook InfinitePay**, **25 pagos sem ID real de transação** (18 legados sem dados de gateway e 7 manuais sem transação real), **11 eventos de pagamento com referência inválida**, e o contador do **Lote 1 divergente em 18 vagas** (80 armazenadas versus 98 inscrições pagas/pendentes). A reconciliação completa com o extrato InfinitePay não é possível pela API implementada, que não lista transações da conta.

## Estatísticas gerais

| Métrica | Total |
|---|---:|
| Inscrições cadastradas | 302 |
| Pagas/confirmadas | 104 |
| Pendentes | 6 |
| Expiradas | 74 |
| Canceladas | 118 |
| Reembolsadas | 0 |
| Falha de pagamento | 0 |
| Grupos de CPF repetido (histórico) | 39 |
| Tentativas extras nos grupos repetidos | 114 |
| CPFs com mais de uma inscrição paga | 0 |
| Pagamentos sem inscrição | 0 |
| Inscrições sem pagamento | 8 (todas canceladas/legadas) |
| Eventos de pagamento órfãos | 11 |

“Duplicada” aqui significa o mesmo \`cpf_hash\` em mais de um registro histórico. São novas tentativas após cancelamento/expiração, não duplicidade ativa ou financeira.

## Receita

| Indicador | Valor |
|---|---:|
| Receita nominal total | ${brl(d.financial.revenueCents)} |
| Ticket médio | ${brl(d.financial.ticketAverageCents)} |
| Menor venda | ${brl(d.financial.minCents)} |
| Maior venda | ${brl(d.financial.maxCents)} |

### Por lote

| Lote | Atletas pagos | Receita |
|---|---:|---:|
| Lote 1 | 98 | ${brl(783020)} |
| Lote 2 | 6 | ${brl(59940)} |

### Por distância/modalidade

| Distância | Atletas pagos | Receita |
|---|---:|---:|
| 5K | 90 | ${brl(731100)} |
| 10K | 14 | ${brl(111860)} |

### Por forma de pagamento registrada

| Forma | Atletas | Receita nominal |
|---|---:|---:|
| Pix | 49 | ${brl(401510)} |
| Cartão de crédito | 24 | ${brl(193760)} |
| Reconciliação manual | 13 | ${brl(103870)} |
| Não informado/legado | 18 | ${brl(143820)} |

Os valores acima são preços nominais das inscrições. A InfinitePay retorna \`paid_amount\` superior ao preço em compras com acréscimo; para receita do evento foi usado \`amount\`, que coincidiu com o preço nas 24 transações reais verificadas.

### Por dia de pagamento (Manaus)

| Dia | Pagos | Receita |
|---|---:|---:|
| 04/07 | 2 | ${brl(15980)} |
| 05/07 | 3 | ${brl(23970)} |
| 06/07 | 5 | ${brl(39950)} |
| 07/07 | 28 | ${brl(223720)} |
| 08/07 | 40 | ${brl(319600)} |
| 09/07 | 19 | ${brl(151810)} |
| 10/07 | 4 | ${brl(37960)} |
| 12/07 | 3 | ${brl(29970)} |

## Validação financeira e InfinitePay

- Banco: 104 inscrições pagas e 104 pagamentos pagos; **zero divergências** de status ou valor entre essas tabelas.
- Não há inscrição expirada com pagamento pago, nem pendente com pagamento já marcado como pago no banco.
- 73 pagamentos têm \`gateway_status=paid\` e metadados completos; 13 são \`manual_reconciled_paid\`; 18 são legados sem status/payload do gateway.
- 79 registros possuíam os identificadores mínimos para \`payment_check\`. A API respondeu a 30 e limitou 49 com HTTP 429. Entre as respostas: 24 transações reais confirmadas como pagas; 6 identificadores artificiais \`manual_reconcile_*\` retornaram não pagos, como esperado. Nas 24 reais, \`amount\` coincidiu com o valor da inscrição.
- **Pagamentos órfãos na conta InfinitePay: não determinável** sem extrato/exportação da conta. O endpoint disponível só verifica uma transação conhecida; ele não lista vendas. No banco, há 2 eventos rotulados \`infinitepay.orphan\`, incluídos nos 11 eventos sem FK válida.
- As 6 pendências não têm \`gateway_transaction_id\`; portanto a API atual não permite verificar se “o dinheiro caiu” apenas com os dados armazenados.

## Banco de dados e integridade

- IDs: 302/302 IDs únicos de inscrição e 294/294 IDs únicos de pagamento.
- Campos obrigatórios auditados (nome, CPF, e-mail, telefone, sexo, camisa): zero nulos/vazios.
- Pagos sem \`paid_at\` ou \`confirmed_at\`: zero.
- Transações e IDs de checkout repetidos: zero.
- FKs de inscrição→evento/distância/lote e pagamento→inscrição estão íntegras.
- A tabela \`run-payment-events\` **não possui FK declarada** para \`run-payments\`; 11 eventos apontam para pagamentos inexistentes: 8 \`checkout_created\`, 2 \`infinitepay.orphan\`, 1 \`manual.payment_confirmed\`.
- O contador do Lote 1 está inconsistente: \`sold_count=80\`, mas há 98 registros reservando vaga (98 pagos, sem pendentes neste lote). O Lote 2 está consistente: 12 armazenados e 12 pagos/pendentes.
- As 8 inscrições sem pagamento são registros legados cancelados, criados entre 18/06 e 02/07; não geram risco financeiro atual, mas violam a expectativa 1:1.

## Painel administrativo

O endpoint de resumo calcula os números diretamente do mesmo snapshot. Por isso o painel está correto em:

| Indicador | Painel/fórmula | Banco real | Resultado |
|---|---:|---:|---|
| Inscrições | 302 | 302 | Confere |
| Pagas | 104 | 104 | Confere |
| Pendentes | 6 | 6 | Confere |
| Receita | ${brl(842960)} | ${brl(842960)} | Confere |

Limitações do painel: o resumo tipado não expõe total de expiradas/canceladas como cartões (embora \`byStatus\` contenha os dados), nem receita por lote/distância/método; os lotes exibem o \`sold_count\` persistido, portanto o Lote 1 aparece **18 abaixo** do real. A receita por período diário do backend segue o valor nominal e é consistente com o banco.

## Webhooks

| Canal de confirmação dos 104 pagos | Total |
|---|---:|
| Webhook \`infinitepay.payment_status_changed\` | 91 |
| Evento exclusivamente manual | 13 |
| Webhook repetido para o mesmo pagamento | 0 |

Todos os 91 webhooks aparecem uma vez. Os 13 manuais não devem ser exibidos como “webhook recebido”. O banco registra apenas \`received_at\`; não existem \`processed_at\`, duração, número de tentativa do provedor ou erro de processamento. Assim, tempo e tentativas reais de webhook **não são auditáveis** retroativamente. O tempo médio criação→pagamento foi 4.024 s (67 min), máximo 162.401 s (45 h); isso não equivale a tempo de processamento do webhook.

## E-mails

| Situação dos 104 pagos | Total |
|---|---:|
| Campo de envio preenchido | 93 |
| Sem evidência de envio | 11 |
| Com erro atual armazenado | 0 |
| Provedor | Resend |

Há 136 logs \`email.confirmation.sent\` para 99 inscrições em todo o histórico, e 25 pagos têm mais de um log de envio. Isso mostra reenvios/duplicidade operacional, embora o campo atual guarde somente o último ID. Há 104 logs de tentativa para 71 inscrições e nenhum log \`failed\` no snapshot; 41 logs são \`skipped\`. Não há tabela de entregas/bounces do Resend, logo “enviado” significa aceito pela chamada, não necessariamente entregue na caixa postal.

## Lista completa das inscrições pagas

A versão completa, com e-mail e WhatsApp e todos os campos solicitados, está em **AUDITORIA_INSCRICOES_PAGAS.csv**. Abaixo está a visualização compacta; CPF permanece mascarado.

| Nº | Nome | CPF | Sexo | Distância | Lote | Camisa | Valor | Método | Inscrição | Pagamento | Transação | Criada em | Confirmada em | Webhook | E-mail |
|---|---|---|---|---|---|---|---:|---|---|---|---|---|---|---|---|
${paidTable}

## Inconsistências priorizadas

| Problema | Gravidade | Impacto / reprodução | Correção sugerida (não aplicada) |
|---|---|---|---|
| 11 pagos sem e-mail | Alta | Consultar pagos com \`confirmation_email_sent_at is null\`; risco de atleta sem confirmação | Fila durável de e-mail, retry idempotente e auditoria de entrega/bounce |
| Lote 1: 80 vs 98 | Alta | Comparar \`run-lots.sold_count\` com pagos+pendentes por \`lot_id\`; painel/capacidade errados | Recalcular sob transação após aprovação; constraint/job de reconciliação |
| 13 confirmações manuais | Alta | \`gateway_status=manual_reconciled_paid\`; não verificáveis automaticamente | Exigir NSU real, comprovante, ator e dupla aprovação; conciliar com extrato |
| 18 pagos legados sem gateway | Alta | Pagos com \`gateway_payload is null\` e sem transação | Importar evidência do extrato e marcar origem de migração explicitamente |
| 11 eventos órfãos | Média | Left join de eventos→pagamentos retorna 11 | Adicionar FK quando os legados forem classificados; armazenar órfãos em tabela própria |
| 49 verificações limitadas | Média | InfinitePay respondeu HTTP 429 | Reconciliação com backoff/fila; preferir exportação de extrato e webhooks |
| 25 pagos com logs repetidos de envio | Média | Mais de um \`email.confirmation.sent\` por inscrição paga | Chave idempotente única por template/inscrição e tabela de tentativas |
| 39 CPFs com histórico repetido | Baixa | 114 registros extras; nenhum duplo pago | Índice parcial único para status ativo/pago e política explícita de novas tentativas |
| 8 inscrições sem pagamento | Baixa | Todas canceladas e legadas | Preservar como legado ou migrar para tabela histórica após aprovação |
| Telemetria de webhook insuficiente | Média | Não há duração, resultado ou retry | Registrar início/fim, status, erro, tentativa, assinatura e correlação |

## Conclusão e recomendações

O sistema é **consistente no saldo nominal interno**, mas ainda não tem evidência suficiente para afirmar consistência financeira ponta a ponta com a InfinitePay. Há risco financeiro **moderado** concentrado nos 31 casos sem prova automática completa (18 legados + 13 manuais), risco operacional **alto** nos 11 e-mails ausentes e risco de capacidade/painel **alto** pela divergência do Lote 1. Não há evidência de inscrição paga duplicada, pagamento aprovado marcado como expirado ou pendente já marcado como pago no banco.

Prioridades propostas para uma segunda etapa, somente após autorização: (1) obter/exportar o extrato InfinitePay e reconciliar por NSU/valor/data; (2) confirmar e reenviar os 11 e-mails com idempotência; (3) corrigir o contador do Lote 1; (4) classificar os 13 manuais e 18 legados com comprovantes; (5) fortalecer FKs, índices parciais e telemetria; (6) incluir no painel receitas segmentadas, expiradas/canceladas e alertas de divergência.

## Evidências e método

- Consultas executadas em transação PostgreSQL somente leitura e rollback explícito.
- Snapshot completo mascarado: \`.tmp/audit-data.json\`.
- Respostas da reconciliação InfinitePay: \`.tmp/audit-gateway.json\`.
- Scripts locais de auditoria: \`.tmp/audit-readonly.mjs\`, \`.tmp/audit-details.mjs\`, \`.tmp/audit-gateway-readonly.mjs\`.
- Código inspecionado: \`server/database.ts\`, \`server/index.ts\`, \`server/infinitepay.ts\`, \`server/email.ts\`, \`src/pages/Admin.tsx\`, \`server/supabase-schema.sql\`.
`;
writeFileSync('AUDITORIA_INSCRICOES_FUNPACE.md',report); console.log(`Relatório: AUDITORIA_INSCRICOES_FUNPACE.md\nCSV: AUDITORIA_INSCRICOES_PAGAS.csv\nPagos: ${rows.length}`);
