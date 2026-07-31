# Meta Pixel e Conversions API

## Arquitetura

O navegador carrega uma única instância do Meta Pixel por
`VITE_META_PIXEL_ID`. O backend envia eventos diretamente para
`POST https://graph.facebook.com/{META_GRAPH_API_VERSION}/{META_PIXEL_ID}/events`
com `fetch` nativo e token no header `Authorization`.

Os eventos server-side passam pela tabela `run-integration-events`. A
restrição única `(provider, event_name, event_id)` é a autoridade de
idempotência entre processos e instâncias serverless. O envio externo acontece
somente depois da operação principal e suas falhas não alteram inscrição,
checkout ou pagamento.

## Eventos e desduplicação

| Ação | Navegador | Servidor | `event_id` |
| --- | --- | --- | --- |
| Página | `PageView` | — | — |
| Conteúdo da corrida | `ViewContent` | — | — |
| Início do checkout | `InitiateCheckout` | `InitiateCheckout` | `initiate_checkout_{attemptId}` |
| Inscrição persistida | `CompleteRegistration` | `CompleteRegistration` | `complete_registration_{registrationId}` |
| Pagamento confirmado | `Purchase` | `Purchase` | `purchase_{registrationId}` |

No Pixel, o valor é enviado como `eventID`; na CAPI, como `event_id`. O antigo
`Lead` foi substituído por `CompleteRegistration`.

O navegador cria uma única identificação de tentativa quando o formulário é
montado e a envia no corpo da inscrição. Clientes antigos, sem esse campo,
recebem no servidor o fallback `initiate_checkout_{registrationId}`. O
`Purchase` server-side só é criado depois que a confirmação financeira fez
commit e quando inscrição e pagamento estão ambos `paid`.

## Variáveis de ambiente

```env
VITE_META_PIXEL_ID=
VITE_META_PIXEL_REQUIRE_CONSENT=false

META_CAPI_ENABLED=true
META_PIXEL_ID=
META_CONVERSIONS_API_TOKEN=
META_GRAPH_API_VERSION=
META_DATASET_QUALITY_TOKEN=
META_TEST_EVENT_CODE=
META_CAPI_TIMEOUT_MS=3500
META_CAPI_MAX_ATTEMPTS=5
```

Somente as variáveis `VITE_` entram no bundle. Tokens nunca devem usar esse
prefixo. `META_CAPI_ENABLED=false` interrompe novos enfileiramentos e envios sem
mudança de código.

`META_GRAPH_API_VERSION` não possui fallback intencional: configure uma versão
suportada pela conta antes de habilitar a integração.

## Dados de correspondência

O servidor normaliza e aplica SHA-256 a:

- e-mail em lowercase;
- telefone brasileiro com código `55`;
- primeiro e último nome;
- gênero `f` ou `m`, sem inferência por nome;
- cidade sem espaços, pontuação ou acentos;
- UF em lowercase;
- país `br`;
- UUID interno da inscrição como `external_id`.

São enviados sem hash:

- primeiro IP público válido de `x-forwarded-for`, validado no servidor;
- User Agent do header, limitado a 500 caracteres;
- `_fbp`;
- `_fbc`.

Quando `_fbc` não existe e a URL contém um `fbclid` válido, o navegador monta o
formato `fb.1.{timestamp}.{fbclid}`. Valores ausentes ou inválidos são omitidos.
CPF, senha, contato de emergência, dados bancários e payload do gateway nunca
são incluídos.

As URLs de origem aceitam somente origens presentes em `ALLOWED_ORIGINS`; query
string e fragmento são removidos.

## Idempotência, retry e retenção

O worker reivindica linhas com `FOR UPDATE SKIP LOCKED`. Eventos `sent` nunca
são reivindicados novamente.

Falhas de rede, timeout, HTTP 429 e HTTP 5xx recebem backoff persistido de
aproximadamente 1 minuto, 5 minutos, 30 minutos, 2 horas e 6 horas. O limite
padrão é cinco tentativas. HTTP 4xx definitivo, resposta inválida não
temporária e `events_received: 0` ficam `failed` sem próximo retry.

`last_error` armazena somente um código curto e sanitizado. Não armazena
payload, token, PII, hash, IP ou cookie.

O `event_time` original é persistido em segundos e preservado nos retries.
Eventos com mais de sete dias não são enviados.

`client_context` mantém temporariamente IP, User Agent, `fbp` e `fbc` para
retry e para o futuro `Purchase`. Ele é apagado:

- assim que houver `Purchase` com status `sent`;
- após sete dias;
- 24 horas depois de a inscrição entrar em estado terminal sem compra.

O cron financeiro também recupera compras pagas dos últimos sete dias que
ainda não possuam `Purchase`, processa eventos elegíveis e executa a limpeza.
Novas inscrições e confirmações também processam a fila oportunisticamente.

## Modo de teste

Configure temporariamente:

```env
META_TEST_EVENT_CODE=TEST_CODE_DO_EVENTS_MANAGER
```

O campo `test_event_code` só aparece quando a variável é válida e configurada.
Use uma inscrição controlada e pagamento realmente aprovado. Não altere status
financeiro para gerar eventos. Remova a variável ao terminar.

## Diagnóstico

Administradores podem consultar:

```text
GET /api/admin/integrations/meta/status
```

A resposta informa configuração, modo de teste, último sucesso, eventos
pendentes e falhas recentes. Tokens, participantes, IPs, cookies, hashes e
payloads não são retornados.

Em falhas:

1. confirme `META_CAPI_ENABLED`;
2. confirme Pixel ID, token e versão da Graph API na Vercel;
3. confira o status administrativo e logs estruturados pelo `event_id`;
4. use “Testar eventos” para comparar navegador e servidor;
5. confirme igualdade de `event_name` e `event_id`;
6. não reenvie manualmente um evento `sent`.

Para rotacionar o token, atualize `META_CONVERSIONS_API_TOKEN` somente na
Vercel, faça uma nova publicação controlada, valide no modo de teste e revogue
o token antigo. Nunca copie o token para `.env.example`, logs ou front-end.

## Dataset Quality API e operação

`META_DATASET_QUALITY_TOKEN` permanece separado e o endpoint de eventos não é
tratado como Dataset Quality API. Nenhuma consulta programática foi
implementada porque ainda falta uma referência oficial que confirme endpoint,
versão, métricas e permissões aplicáveis a este dataset.

Até essa confirmação, acompanhe manualmente no Events Manager:

- qualidade da correspondência;
- taxa de desduplicação;
- atualidade dos dados;
- cobertura de eventos da CAPI;
- diagnósticos críticos.

Uma resposta HTTP 200 isolada não encerra a validação operacional.

## Consentimento

O aceite atual do formulário autoriza o processamento da inscrição e não é
reinterpretado como consentimento de marketing. Quando existir um gerenciador
de preferências, defina `VITE_META_PIXEL_REQUIRE_CONSENT=true` e chame
`setMetaPixelConsent(true | false)`. Cookies essenciais permanecem separados
do rastreamento de marketing. Uma negativa explícita é enviada como booleano
ao backend e impede também o enfileiramento CAPI e a recuperação posterior do
`Purchase`; cookies, IP e User Agent não são persistidos nesse caso.
