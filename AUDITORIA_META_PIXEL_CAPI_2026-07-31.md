# Auditoria técnica — Meta Pixel + Conversions API

Data da auditoria: 31/07/2026  
Escopo: código local, migrações, testes, configuração local com valores sensíveis redigidos, documentação interna e captura fornecida do Meta Events Manager.  
Modo: somente leitura do produto; este arquivo é apenas documentação. Nenhum código, banco, variável, commit, push ou deploy foi alterado.

## 1. Resumo executivo

A integração possui cinco eventos efetivamente emitidos pelo código atual:

| Evento | Browser | Server/CAPI | Estado no código |
|---|---:|---:|---|
| `PageView` | Sim | Não | Ativo |
| `ViewContent` | Sim | Não | Ativo |
| `CompleteRegistration` | Sim | Sim | Ativo |
| `InitiateCheckout` | Sim | Sim | Ativo, mas com gatilho server-side antecipado |
| `Purchase` | Sim | Sim | Ativo |
| `Lead` | Não | Não | Não existe emissor Meta no código atual; há somente entidades de negócio chamadas “lead” |

Arquitetura resumida:

```text
Consentimento localStorage
        |
        +--> Browser: MetaPixelTracker -> fbevents.js -> fbq(track)
        |
        +--> POST /api/registrations -> snapshot de consentimento no cadastro
                    |
                    +--> run-integration-events (outbox PostgreSQL)
                    |       |
                    |       +--> processMetaIntegrationQueue -> Graph API /{pixel}/events
                    |
                    +--> confirmação financeira -> Purchase na outbox
                                      |
                                      +--> envio imediato + recuperação pelo cron diário
```

Conclusão principal: a base é boa, mas ainda não é uma implementação plenamente confiável para produção. Os principais riscos são: `InitiateCheckout` CAPI antes da criação real do checkout; revogação posterior não atualiza o consentimento persistido no servidor; outbox de `CompleteRegistration`/`InitiateCheckout` não é atômica com a inscrição e não possui recuperação de eventos ausentes; cron de retry é diário; e o painel fornecido diverge materialmente do código atual (`Lead` ainda ativo e `CompleteRegistration` sem atividade recente).

Nota técnica: **6,5/10**.

## 2. Inventário completo dos eventos

### `PageView`

- Origem: `src/components/MetaPixelTracker.tsx`, função/componente `MetaPixelTracker`, linhas 6–45.
- Emissor: `src/lib/metaPixel.ts`, função `trackPageView`, linhas 180–188.
- Canal: Browser somente.
- Disparo: ao montar o tracker em rota não administrativa, depois de consentimento de Marketing; em `pushState`, `replaceState` e `popstate`; e imediatamente ao conceder Marketing.
- Deduplicação local: `lastPagePath`; a mesma rota normalizada não dispara de novo enquanto esse estado em memória não for limpo.
- Gates: navegador/documento disponíveis; Pixel ID numérico; consentimento Marketing concedido; rota não começa por `/admin`; path diferente do último path.
- Parâmetros explícitos: nenhum. A chamada é `fbq('track', 'PageView')`. URL, referrer e contexto que o script Pixel coleta são implícitos, não montados pelo projeto.
- `eventID`: ausente. Não existe equivalente server-side.

### `ViewContent`

- Origem: `src/components/forms.tsx`, `RegistrationSection`/`useEffect`, linhas 124–139.
- Emissor genérico: `trackMetaEventOnce` -> `trackMetaEvent`, `src/lib/metaPixel.ts`, linhas 191–225.
- Canal: Browser somente.
- Disparo real: depois que `/api/availability` retorna e existem `availability.event.id` e lote ativo. Portanto, não é simplesmente “ao abrir qualquer página”: é quando a seção de inscrição dispõe dos dados do evento/lote.
- Gates: todos os gates do Pixel; evento e lote disponíveis; chave `view-content:{eventId}` ainda não emitida nesta execução da aplicação.
- Parâmetros:
  - `content_name`: `availability.event.name`.
  - `content_category`: literal `Corrida de rua`.
  - `content_type`: literal `product`.
  - `content_ids`: `[availability.event.id]`.
  - `currency`: literal `BRL`.
  - `value`: `registrationPrice`, calculado a partir de `partnerContext.finalPriceCents`, ou preço do lote ativo, dividido por 100 (linhas 79–83).
- `eventID`: ausente. Sem CAPI correspondente.

### `CompleteRegistration`

Browser:

- Origem: `src/components/forms.tsx`, `handleSubmit`, linhas 182–245; chamada nas linhas 214–228.
- Disparo: após `createRegistration(...)` resolver com sucesso e existir `availability.event.id`. A inscrição já foi persistida pelo backend.
- Gates: formulário válido; resposta HTTP tratada como sucesso pelo cliente; evento de availability ainda disponível; Pixel configurado; Marketing concedido; chave em memória `complete-registration:{registrationId}` ainda não usada.
- `eventID`: `complete_registration_{registrationId}`.
- Parâmetros: `content_name`, `content_category='Inscrição em corrida'`, `currency='BRL'`, `value=registrationPrice`, `content_ids=[availability.event.id]`, `content_type='product'`, `status=true`.

Server/CAPI:

- Decisão: `server/meta-registration-flow.ts`, `resolveMetaRegistrationFlow`, linhas 19–43.
- Criação: `server/meta-events.ts`, `queueMetaCompleteRegistrationEvent`, linhas 103–120.
- Chamada: `server/index.ts`, linhas 1787–1818.
- Disparo: inscrição persistida, `success=true`, status HTTP 2xx e `registrationId` não vazio. Não depende de checkout criado.
- Gates adicionais: Marketing recebido exatamente como `true`; PostgreSQL/Supabase em uso; CAPI pronta; snapshot da inscrição existente e ainda `pending_payment`; ID válido.
- `event_time`: `registration.created_at` do banco.
- `event_source_url`: URL enviada pelo Browser, validada contra origins permitidas e reduzida a `origin + pathname`.
- `custom_data`: `currency`, `value`, `content_name`, `content_ids`, `content_type`, `status=true`.

### `InitiateCheckout`

Browser:

- Origem: `src/components/forms.tsx`, `handleSubmit`, linhas 230–243.
- Disparo: após resposta bem-sucedida de criação da inscrição, se `response.attemptId` existir. O redirect para `checkoutUrl` ocorre depois, nas linhas 247–250.
- Gates: os de `CompleteRegistration`, mais `response.attemptId`; Marketing e Pixel; dedupe em memória.
- `eventID`: o próprio `response.attemptId`.
- Parâmetros: `content_name`, `content_ids`, `content_type='product'`, `currency='BRL'`, `value=registrationPrice`, `num_items=1`.

Server/CAPI:

- Decisão/ID: `server/meta-registration-flow.ts`, linhas 30–40.
- Criação: `server/meta-events.ts`, `queueMetaInitiateCheckoutEvent`, linhas 123–144.
- Disparo implementado: quando a inscrição foi persistida, Marketing é `true` e `checkoutRequested=true`.
- `eventID`: `initiate_checkout_{registrationId}`; devolvido ao Browser como `attemptId` em `server/index.ts:1802`.
- `event_time`: início da requisição HTTP ao backend (`startedAt`), não `meta.initiatedAt` recebido do Browser.
- `custom_data`: `currency`, `value`, `content_name`, `content_ids`, `content_type`, `num_items=1`.
- Problema crítico: o evento é enfileirado nas linhas 1804–1818, antes da chamada `createInfinitePayCheckout` nas linhas 1850–1864. Se a InfinitePay falhar, a linha 1942 ainda processa a outbox. Logo, o Server pode enviar `InitiateCheckout` sem checkout criado. `checkoutRequested` representa intenção do cliente, não sucesso no gateway.

### `Purchase`

Browser:

- Origem: `src/pages/Success.tsx`, polling nas linhas 44–123 e emissão nas linhas 125–135.
- Emissor: `src/lib/metaPixel.ts`, `trackMetaPurchase`, linhas 228–252.
- Disparo: somente quando `GET /api/registrations/{id}` retorna status `paid` com `eventId`, `eventName` e valor; e Marketing está concedido.
- `eventID`: `purchase_{registrationId}`.
- Parâmetros montados pela página: `content_name`, `content_ids`, `content_type='product'`, `currency='BRL'`, `value=amountCents/100`, `num_items=1`; o helper acrescenta `order_id=registrationId`.
- Dedupe Browser: `localStorage['meta_purchase_sent:{registrationId}']='sent'`; fallback em memória se localStorage falhar.

Server/CAPI:

- Criação: `server/meta-events.ts`, `queueMetaPurchaseEvent`, linhas 147–173.
- Wrapper de envio: `server/index.ts`, `queueConfirmedMetaPurchase`, linhas 711–725.
- Gates financeiros: `registration.status='paid'`, `payment.status='paid'` e algum `paidAt`; Marketing persistido exatamente `true`; PostgreSQL e CAPI prontos.
- `event_time`: `payment.paid_at`, com fallback para `registration.paid_at`/`confirmed_at` no snapshot.
- `event_source_url`: fallback configurado para `/sucesso` em `APP_URL`; não é necessariamente a URL real visitada.
- `custom_data`: `currency`, `value`, `content_name`, `content_ids`, `content_type`, `order_id`, `num_items=1`.
- Pode nascer por quatro caminhos financeiros, sempre após verificação/persistência: webhook (`server/index.ts:2084–2178`), retorno/redirect (`2800–2831`), reconciliação administrativa (`2752–2784`) ou recuperação automática (`2921–2950`).

### `Lead`

- Não há `fbq('track','Lead')`, `trackMetaEvent(...,'Lead')`, `event_name='Lead'` ou tipo CAPI `Lead` no código executável atual.
- As ocorrências de “lead” no servidor são cadastros de parceria (`run-partnership-leads`), não eventos Meta.
- `META_PIXEL.md:26–27` declara que o antigo `Lead` foi substituído por `CompleteRegistration`.
- Como o painel fornecido mostra `Lead` ativo e recebido há cerca de 6 horas, ele vem de versão implantada diferente desta árvore, Event Setup Tool/GTM, outra integração ou emissor legado ainda em produção. Não é possível atribuir a origem exata só pela captura.

## 3. Sequência cronológica real

A sequência solicitada no enunciado precisa ser corrigida porque, sem consentimento prévio, nenhum evento Browser ocorre antes da decisão.

```text
Usuário entra
  |
  +-- sem decisão de consentimento --> banner; nenhum Pixel/PageView/ViewContent
  |                                      |
  |                                      +-- recusa --> continua sem Meta
  |                                      |
  |                                      +-- aceita Marketing
  |                                              |
  +-- consentimento Marketing já existente ------+
                                                 |
                                              PageView (Browser)
                                                 |
                                  availability + lote disponíveis
                                                 |
                                           ViewContent (Browser)
                                                 |
                                      formulário válido + submit
                                                 |
                                inscrição pending_payment persistida
                                      |                     |
                         CompleteRegistration         InitiateCheckout
                            Browser + CAPI             Browser + CAPI*
                                      |                     |
                                      +----------+----------+
                                                 |
                                    chamada/criação InfinitePay
                                                 |
                             pagamento confirmado pelo gateway
                                                 |
                                  estados paid persistidos no banco
                                      |                     |
                               Purchase CAPI       Purchase Browser
                              (não requer retorno) (se abrir sucesso)

* CAPI é enfileirado antes da criação real do checkout.
```

Se o usuário já havia concedido Marketing, o primeiro `PageView` ocorre na montagem. Se concede na sessão atual, `synchronizeMetaPixelConsent(true)` inicializa o script, envia `consent grant` e chama `trackPageView()`.

## 4. Payload CAPI exato e origem dos campos

Envelope HTTP:

- Endpoint: `POST https://graph.facebook.com/{META_GRAPH_API_VERSION}/{META_PIXEL_ID}/events`.
- Autorização: header `Authorization: Bearer {META_CONVERSIONS_API_TOKEN}`.
- Body: `{ data: [event], test_event_code? }`.
- `test_event_code` é incluído quando `META_TEST_EVENT_CODE` é válido.

Campos comuns a todos os três eventos server-side:

| Campo | Presença | Origem |
|---|---|---|
| `event_name` | Sempre | Literal do evento |
| `event_time` | Sempre | `created_at`, início da request, ou `paid_at`, normalizado para Unix seconds |
| `event_source_url` | Sempre | URL Browser permitida sem query/hash; Purchase usa fallback `/sucesso` |
| `action_source` | Sempre | Literal `website` |
| `event_id` | Sempre | ID determinístico derivado de `registrationId` |
| `user_data` | Sempre, objeto possivelmente parcial | Cadastro + request HTTP/cookies |
| `custom_data` | Sempre | Snapshot do evento/inscrição/pagamento |

`user_data` atual:

| Campo Meta | Condicional | Origem/normalização |
|---|---:|---|
| `em` | Sim | `registration.payload.email`, lowercase/trim, SHA-256, array |
| `ph` | Sim | telefone do cadastro; só dígitos, prefixo `55`, SHA-256, array |
| `fn` | Sim | primeira palavra de `fullName`, minúscula/sem acento/não letras removidas, SHA-256 |
| `ln` | Sim | última palavra de `fullName`, mesma normalização, SHA-256 |
| `ge` | Sim | `gender` convertido para `f`/`m`, SHA-256 |
| `ct` | Sim | `city`, minúscula/sem acento/espaços removidos, SHA-256 |
| `st` | Sim | `state`, somente se normalizar para duas letras, SHA-256 |
| `country` | Normalmente sim | literal `br`, SHA-256 |
| `external_id` | Sim | `registrationId`, SHA-256 |
| `client_ip_address` | Sim | primeiro IP público válido de `x-forwarded-for`, `x-vercel-forwarded-for` ou socket |
| `client_user_agent` | Sim | header `user-agent`, controles removidos, máximo 500 caracteres |
| `fbc` | Sim | `_fbc` do Browser ou valor construído de `fbclid`; não hasheado, validado |
| `fbp` | Sim | cookie `_fbp` do Browser; não hasheado, validado |

O CPF nunca é enviado. IP, User Agent, `fbc` e `fbp` são separados em `client_context` dentro da outbox; os hashes ficam em `user_data`. No envio, os objetos são recombinados.

`custom_data` por evento:

| Campo | CompleteRegistration | InitiateCheckout | Purchase | Origem server-side |
|---|---:|---:|---:|---|
| `currency` | `BRL` | `BRL` | `BRL` | Literal |
| `value` | Sim | Sim | Sim | `payment.amount_cents` ou `registration.amount_cents` / 100 |
| `content_name` | Sim | Sim | Sim | nome do evento em `run-events` |
| `content_ids` | Sim | Sim | Sim | `[run-events.id]` |
| `content_type` | `product` | `product` | `product` | Literal |
| `status` | `true` | Não | Não | Literal |
| `num_items` | Não | `1` | `1` | Literal |
| `order_id` | Não | Não | `registrationId` | ID da inscrição |

## 5. Consentimento LGPD

Browser:

- Estado em `localStorage`, chave `funpace-privacy-consent-v1`, com versão, categorias, `decidedAt` e `updatedAt` (`src/lib/privacyConsent.ts`).
- Default fail-closed: necessários `true`, estatística/Marketing `false`, `hasDecision=false`.
- O Pixel só inicializa quando a categoria Marketing está explicitamente liberada. Isso vale sempre; `VITE_META_PIXEL_REQUIRE_CONSENT` não é lida em nenhum ponto e é variável obsoleta/documentação desatualizada.
- Ao revogar: envia `fbq('consent','revoke')` se `fbq` ainda existe, remove a tag `fbevents.js`, apaga `window.fbq`/`window._fbq`, expira `_fbp` e `_fbc` em combinações de domínio/path, limpa o estado de rota e permite futura reinicialização.
- Limites: não é possível apagar cookies third-party da Meta; eventos já transmitidos não são retirados; marcadores `meta_purchase_sent:*` e o set de dedupe de eventos não são apagados.

Server:

- No submit, o Browser envia `meta.marketingConsent`; o backend reduz qualquer valor diferente de `true` para `false` e persiste o snapshot em `registration.payload.meta.marketingConsent` (`server/index.ts:660–707`).
- Sem `true`, CAPI não é enfileirada. Antes de cada envio, o processador consulta novamente esse snapshot persistido.
- Falha crítica de revogação: o gerenciador de preferências só atualiza o localStorage. Não existe chamada para atualizar a inscrição/outbox no servidor. Assim, revogar depois da inscrição não muda o snapshot `true`; eventos já pendentes e o futuro `Purchase` continuam elegíveis no Server.
- IP/User Agent/cookies são limpos da outbox após Purchase enviado, após sete dias, ou 24h depois de status terminal negativo. Os hashes de identidade em `user_data` não são limpos por essa rotina.

## 6. Outbox, fila, retry e idempotência

- Tabela: `run-integration-events`, criada por `supabase/migrations/20260725000300_meta_capi_integration_events.sql`.
- Estados: `pending`, `processing`, `sent`, `failed`.
- Unicidade: `(provider, event_name, event_id)`; insert usa `ON CONFLICT DO NOTHING`.
- Claim concorrente: CTE com `FOR UPDATE SKIP LOCKED`; máximo 20; incrementa `attempt_count` antes do envio.
- Recuperação de worker travado: `processing` há mais de 5 minutos volta a ser elegível.
- Timeout HTTP: default 3.500 ms, configurável entre 1.000 e 10.000 ms.
- Tentativas: default 5, configurável de 1 a 10.
- Backoff nominal: 60s, 5min, 30min, 2h, 6h; o último atraso se repete em tentativas adicionais.
- Retry automático somente para erro de rede/timeout, HTTP 429 ou HTTP 5xx. HTTP 4xx, resposta inválida não retryable e `events_received=0` tornam-se falha permanente.
- Sucesso exige HTTP OK e `events_received > 0`.
- Logs estruturados incluem evento, ID, inscrição, status, duração, HTTP, erro e quantidade recebida.
- Status administrativo expõe somente último sucesso, falhas das últimas 24h e quantidade `pending`; não inclui `processing`, retries agendados, falhas permanentes por tipo ou idade da fila.
- Processamento imediato: após criação da inscrição e após confirmação financeira.
- Recuperação: cron `/api/cron/payments`, protegido por bearer secret, executado por `vercel.json` uma vez ao dia (`17 7 * * *`). Ele procura até 20 Purchases ausentes e processa até 20 itens.

Riscos de durabilidade:

1. A inscrição é confirmada em transação anterior; a inserção na outbox ocorre depois. Não é uma outbox transacional atômica. Crash/falha entre commit e enqueue perde `CompleteRegistration`/`InitiateCheckout`.
2. Só há recuperação explícita de `Purchase` ausente. Não há reconciliador de `CompleteRegistration` ou `InitiateCheckout` ausente.
3. O backoff não possui scheduler no intervalo indicado; depois da tentativa imediata, o gatilho garantido visível no repositório é diário. Na prática, 60s/5min/etc. podem virar quase 24h.
4. Registros com `event_time` mais antigo que sete dias não são claimados, mas permanecem na tabela.
5. Um timeout após aceitação pela Meta e antes do `sent` gera retry com o mesmo ID. A proteção local não sabe se a Meta aceitou; depende da idempotência/deduplicação do lado Meta.

## 7. Deduplicação Browser x Server

| Evento | Browser `eventID` | Server `event_id` | Igualdade |
|---|---|---|---|
| CompleteRegistration | `complete_registration_{registrationId}` | mesmo | Sim |
| InitiateCheckout | `response.attemptId` | `initiate_checkout_{registrationId}` | Sim; backend cria e devolve o ID |
| Purchase | `purchase_{registrationId}` | mesmo | Sim |

Garantias:

- IDs são determinísticos e validados por prefixo/regex.
- A outbox impede duas linhas do mesmo evento lógico.
- Meta recebe o mesmo `event_name` e ID nos dois canais, que é o mecanismo documentado de deduplicação Browser/CAPI.

Onde pode falhar:

- `InitiateCheckout` Server pode existir sem Browser se o gateway falhar.
- Browser pode não emitir por bloqueador, saída rápida/redirect, falta de consentimento, ausência de availability ou erro de script. Isso é esperado; CAPI mantém cobertura.
- Server pode não emitir se CAPI estiver desabilitada/incompleta no momento da inscrição; recovery posterior só cobre Purchase.
- `CompleteRegistration` e `InitiateCheckout` Browser usam preço derivado do estado da UI; Server usa snapshot persistido. Em mudança de lote/parceiro, os valores dos dois lados podem divergir embora o ID dedupe.
- Purchase Browser pode ocorrer muito depois do Purchase Server. Fora da janela de dedupe da Meta, o localStorage só sabe do Browser e não do Server.
- `PageView` e `ViewContent` não têm CAPI nem `event_id`, portanto não participam de dedupe cross-channel.

## 8. Purchase: confirmação, falso positivo e duplicidade

O fluxo forte do `Purchase` é a melhor parte da integração:

1. Webhook/redirect/admin/cron consulta `payment_check` da InfinitePay.
2. Exige resposta `paid` e verifica divergência de valor.
3. `confirmPaymentInPostgres` persiste pagamento e inscrição como `paid`.
4. Só depois `queueConfirmedMetaPurchase` tenta criar e enviar o evento.
5. `queueMetaPurchaseEvent` repete a validação de `registration.status`, `payment.status` e `paidAt`.
6. A unicidade da outbox evita uma nova linha em webhooks/retornos repetidos.
7. O cron recupera pagamentos confirmados sem linha Purchase nos últimos sete dias.

Isto reduz bem falsos positivos. As lacunas remanescentes são operacionais: consentimento revogado não sincronizado; falha entre confirmação e enqueue recuperada apenas no cron diário; e a captura do painel não mostra `Purchase`, impedindo validar sua recepção real.

## 9. Comparação com a documentação oficial da Meta

Referências usadas:

- [Server event parameters — Meta](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/)
- [Customer information parameters — Meta](https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters/)
- [Deduplicate Pixel and Server Events — Meta](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/)
- [Meta Pixel event reference](https://developers.facebook.com/docs/meta-pixel/reference/)
- [Business SDK oficial da Meta](https://github.com/facebook/facebook-nodejs-business-sdk)

Conforme/recomendado já implementado:

- Campos estruturais obrigatórios da CAPI presentes: `event_name`, `event_time`, `action_source`, `user_data`; para website, também há `event_source_url`.
- `event_id` presente e compartilhado nos eventos híbridos.
- `currency` e `value` presentes em Purchase.
- Identificadores fortes: email, telefone, nome, sobrenome, cidade, estado, país, gênero e external ID com SHA-256; IP/UA, `fbp` e `fbc` sem hash.
- Horário em segundos e limite de sete dias.
- `action_source='website'` coerente.

Campos disponíveis/recomendáveis ausentes ou incompletos:

| Campo | Situação | Prioridade/observação |
|---|---|---|
| `db`/date of birth | Ausente, embora `birthDate` exista no cadastro | Alta para elevar Event Match Quality; exige base legal e normalização correta |
| `zp`/ZIP | Ausente e não coletado | Média; só coletar se houver finalidade/base legal |
| `contents` com `id`, `quantity`, `item_price` | Ausente | Média; enriquecer checkout/Purchase e coerência de catálogo |
| `content_category` na CAPI | Ausente | Baixa/média; Browser usa em View/Complete |
| `delivery_category` | Ausente | Baixa; provavelmente não aplicável a inscrição |
| `predicted_ltv` | Ausente | Baixa/não aplicável hoje |
| `search_string` | Ausente | Não aplicável aos eventos atuais |
| `subscription_id` | Ausente | Não aplicável sem assinatura |
| `lead_id` | Ausente | Só aplicável se o fluxo `Lead` for intencional |
| `fb_login_id` | Ausente | Não aplicável sem Facebook Login |
| `data_processing_options`, país/estado | Ausente | Avaliar juridicamente; não é substituto do consentimento LGPD |
| `opt_out` | Ausente | O projeto bloqueia envio em vez de enviar opt-out; abordagem coerente, mas revogação server precisa sincronização |
| advanced matching no `fbq('init')` | Ausente | Pode melhorar Browser matching, sujeito a consentimento/base legal |
| `partner_agent` | Ausente | Normal em integração direta, não um erro funcional |

A qualidade de correspondência 6,1/10 mostrada na captura é compatível com uma implementação que já envia vários identificadores, mas ainda pode ganhar com data de nascimento, maior cobertura de `fbp`/`fbc`, consistência Browser/Server e diagnóstico de payloads efetivamente recebidos.

## 10. Comparação com a captura do Meta Events Manager

O que a imagem fornecida permite afirmar:

| Painel | Atividade visível | Código atual | Diagnóstico |
|---|---|---|---|
| `PageView` | Ativo; ~1,5 mil; último há ~44 min; qualidade 6,1/10 | Browser | Compatível |
| `Ver conteúdo` | Ativo; 825; último há ~44 min; 6,1/10 | `ViewContent` Browser | Compatível |
| `Iniciar finalização da compra` | Ativo; 39; último há ~6 h; 6,1/10 | Browser + CAPI | Compatível em nome, mas não valida dedupe |
| `Lead` | Ativo; 31; último há ~6 h; 6,1/10 | Nenhum emissor atual | Divergência crítica/legado ou fonte externa |
| `Concluir inscrição` | Ativo; 7; último há ~2 dias | Browser + CAPI | Divergência de recência/volume em relação a InitiateCheckout |
| `Purchase` | Não aparece no recorte | Browser + CAPI | Inconclusivo; pode estar abaixo da área capturada ou não ter recebido eventos |

Sinais importantes:

- No código atual, uma inscrição bem-sucedida com checkout solicitado e consentimento gera `CompleteRegistration` e `InitiateCheckout` sob praticamente os mesmos gates. Ver `InitiateCheckout` recente enquanto `CompleteRegistration` está há dois dias sem receber evento sugere que o deploy/fonte real não corresponde integralmente ao código auditado, ou que existe configuração externa alterando eventos.
- O `Lead` recebido há seis horas prova que algum emissor fora desta árvore auditada ainda está ativo. Possibilidades: deploy antigo, Meta Event Setup Tool, GTM, script injetado, outra aplicação com o mesmo Pixel ID ou integração parceira.
- “Várias” no painel sugere mais de um método de integração, mas a captura não abre o detalhamento Browser/Server, IDs, URLs, diagnostics ou deduplication keys.
- Não é possível classificar `Purchase` como ausente no painel apenas porque ele não está no recorte.

Para fechar 100% a comparação operacional, é necessário exportar/abrir no Events Manager, para cada evento: `Connection method`, `Last received`, `Event ID`, `Event source URL`, diagnostics, deduplicated/received count e payload de Test Events. Isso é dado externo não presente na captura nem consultável pelo repositório.

## 11. Configuração observada

Sem expor segredos, o `.env` local no momento da auditoria contém:

- Pixel Browser configurado e numérico.
- `META_CAPI_ENABLED=true`.
- Pixel server, token e Graph API `v25.0` configurados.
- timeout 3.500 ms e máximo 5 tentativas.
- `META_DATASET_QUALITY_TOKEN` ausente; atualmente só é reportado no status e não participa do envio.
- `META_TEST_EVENT_CODE` configurado (`TEST...`). Se essa condição existir no ambiente implantado, todos os payloads CAPI recebem `test_event_code`; confirmar que isso é intencional e não confundir tráfego de teste com produção.
- `VITE_META_PIXEL_REQUIRE_CONSENT=false`, porém a variável não é usada; o Browser sempre exige consentimento explícito.

Essas constatações valem para o arquivo local, não provam os valores configurados no deploy Vercel.

## 12. Riscos priorizados

### Críticos

1. `InitiateCheckout` CAPI pode ser falso positivo por nascer antes de a InfinitePay criar checkout.
2. Revogação de Marketing não chega ao servidor; fila pendente e Purchase futuro continuam autorizados pelo snapshot antigo.
3. Events Manager não corresponde ao código: `Lead` continua ativo e `CompleteRegistration` parece interrompido.

### Altos

4. Enqueue não atômico com a inscrição e sem recovery para Complete/Initiate.
5. Retry nominal de minutos depende, na prática, de cron diário depois da tentativa imediata.
6. `META_TEST_EVENT_CODE` local ativo pode contaminar/limitar validação de produção se replicado no deploy.

### Médios

7. Valores Browser podem divergir do snapshot financeiro Server em alterações de lote/parceiro.
8. Status administrativo da integração é pouco diagnóstico.
9. Retenção/limpeza remove contexto de rede/cookies, mas não os hashes de identidade da outbox.
10. Purchase Browser tardio pode cair fora da janela de dedupe com Purchase Server.

## 13. Recomendações, sem implementação nesta fase

Ordem recomendada:

1. Investigar no Events Manager a origem exata de `Lead`, a ausência recente de Complete e a visibilidade de Purchase; comparar Browser/Server e `event_id` em Test Events.
2. Mover o nascimento server-side de `InitiateCheckout` para depois de checkout criado e persistido; manter o mesmo ID devolvido ao Browser.
3. Criar sincronização server-side da revogação, com política definida para cancelar/bloquear itens pendentes e impedir Purchase futuro quando aplicável.
4. Tornar a outbox atômica com a transação de inscrição, ou adicionar reconciliador determinístico de Complete/Initiate ausentes.
5. Executar worker/cron em frequência compatível com o backoff e envio quase em tempo real.
6. Confirmar/remover `META_TEST_EVENT_CODE` no ambiente de produção após homologação.
7. Adicionar `birthDate` como `db` apenas após validação jurídica/privacidade; medir ganho de Event Match Quality antes de coletar qualquer campo novo.
8. Adicionar `contents` coerente, `content_category` server-side e testes de igualdade de payload Browser/Server.
9. Ampliar observabilidade: contagem por status, idade do item mais antigo, falhas permanentes, retries, taxa deduplicada e cobertura CAPI por evento.
10. Definir retenção de `user_data` hashed e procedimento de exclusão/revogação compatível com a política LGPD.

## 14. Verificação executada

Foram executados somente testes locais focados, sem mutação de produto:

```text
node --import tsx --test
  tests/meta-conversions-api.test.ts
  tests/meta-registration-flow.test.ts
  tests/privacy-consent.test.ts
```

Resultado: **44 testes aprovados, 0 falhas**. Os testes confirmam normalização/hashing, payload, classificação de erros, timeout, consentimento, limpeza de cookies, IDs determinísticos, gates de Purchase e migração da outbox. Eles não detectam a antecipação semântica do `InitiateCheckout`, a falta de propagação da revogação ao backend nem a frequência efetiva do scheduler.

