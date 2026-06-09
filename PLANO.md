# PLANO DE PRODUCAO - FUNPACE RUN

## 1. Resumo executivo do estado atual

O projeto atual do FunPace Run e uma landing page React/Vite com visual forte, esportivo e moderno, organizada em secoes principais para hero, inscricao, percurso, galeria, FAQ, patrocinadores e rodape. A identidade visual esta bem direcionada para uma corrida premium, com boa energia comercial e CTA para participacao.

No entanto, o projeto ainda nao esta pronto para producao nem para vender inscricoes reais. Hoje ele funciona como prototipo estatico: o formulario apenas simula sucesso no front-end, nao existe backend de inscricoes, nao existe banco de dados, nao existe gateway de pagamento, nao existe webhook, nao existe controle de vagas/lotes, nao existe painel administrativo e nao ha validacao segura no servidor.

Tambem existem rastros de template do Google AI Studio que nao fazem parte do FunPace Run: README generico, `metadata.json` com capability de Gemini, `.env.example` com `GEMINI_API_KEY`, dependencias nao usadas como `@google/genai`, `express` e `dotenv`, alem de titulo HTML generico. Isso precisa ser limpo antes do lancamento para reduzir confusao operacional e superficie de risco.

Estado atual: bom ponto de partida visual, mas ainda e uma landing demonstrativa. Para vender inscricoes de verdade, o proximo passo e transformar o fluxo de inscricao em um produto transacional completo, com dados, pagamento, confirmacao e administracao.

### Atualizacao apos execucao da Fase 1

Itens ja executados:

- Typecheck corrigido em `src/components/forms.tsx`.
- `npm run lint` passando.
- `npm run build` passando.
- Criado `src/config/event.ts` para centralizar dados oficiais da corrida.
- Criada secao `A Prova` com `id="about"`, corrigindo a navegacao do menu.
- CTA do hero reforcado para inscricao no Lote 1.
- Formulario deixou de exibir confirmacao falsa de inscricao e agora informa que a vaga so sera garantida apos pagamento aprovado.
- `index.html`, `.env.example`, `README.md`, `metadata.json`, `package.json` e `vite.config.ts` foram limpos/atualizados para FunPace Run.
- Dependencias herdadas do template de AI/Gemini foram removidas de `package.json` e `package-lock.json`.

### Atualizacao apos execucao da Fase 2

Itens ja executados:

- Criado `src/types/registration.ts` com os tipos do formulario de inscricao.
- Criado `src/lib/validation.ts` com mascaras de CPF/telefone e validacoes client-side.
- Formulario de inscricao expandido com nome completo, e-mail, CPF, WhatsApp, data de nascimento, sexo, distancia, tamanho da camisa, contato de emergencia e aceites legais.
- Mensagens de erro por campo implementadas.
- Submit bloqueia avancar quando ha campos invalidos.
- Submit valido exibe estado de preparacao para checkout, sem criar inscricao falsa.
- `npm run lint` passando.
- `npm run build` passando.

### Atualizacao apos execucao da Fase 3

Itens ja executados:

- Criado `src/lib/api.ts` para conectar o formulario a uma API de inscricao.
- Criado `server/index.ts` com API Node local sem dependencias externas.
- Criado endpoint `POST /api/registrations` para validar dados no servidor, calcular preco no servidor, prevenir duplicidade por CPF em memoria e criar inscricao `pending_payment`.
- Criado endpoint `GET /api/registrations/:id` para consulta basica de status.
- Criado endpoint `POST /api/webhooks/payment` com verificacao de assinatura para receber status de pagamento no futuro.
- Criadas paginas `/sucesso`, `/erro` e `/pagamento-cancelado`.
- Formulario agora chama a API e recebe `registrationId`.
- Checkout real permanece bloqueado com `checkoutStatus: not_configured` enquanto nao houver adaptador de gateway e credenciais reais.
- Criado script `npm run api`.
- `.env.example` atualizado com `VITE_API_URL`, `API_PORT` e `ALLOWED_ORIGINS`.
- `npm run lint` passando.
- `npm run build` passando.
- API local validada com POST de teste retornando inscricao `pending_payment`.

Limite importante da Fase 3: o armazenamento ainda e em memoria e nao deve ser usado em producao. A persistencia real, controle atomico de vagas/lotes e historico de pagamento entram na Fase 4.

### Atualizacao apos execucao da Fase 4

Itens ja executados:

- Criado `server/database.ts` com camada de persistencia local em JSON.
- Criado seed inicial em `data/funpace-db.json` com evento, distancias, Lote 1, inscricoes, pagamentos e eventos de pagamento.
- API deixou de depender de `Map` em memoria para inscricoes e pagamentos.
- `POST /api/registrations` agora grava inscricao e pagamento no arquivo persistente.
- `POST /api/registrations` calcula preco pelo lote ativo no servidor.
- Controle de vagas por lote e distancia implementado no servidor.
- Duplicidade por CPF/evento mantida usando hash de CPF.
- `GET /api/availability` criado para retornar lote, preco, vagas restantes e disponibilidade por distancia.
- Front-end agora consulta disponibilidade da API e exibe preco atual, vagas do lote e vagas por distancia.
- `README.md` e `.env.example` atualizados com `DATABASE_FILE`.
- `npm run lint` passando.
- `npm run build` passando.
- API local validada com `/api/availability` e POST de inscricao persistida.

Limite importante da Fase 4: `data/funpace-db.json` e uma persistencia local para desenvolvimento. Para producao, ainda deve ser substituida por Postgres ou banco gerenciado com transacoes reais, backups, migrations e controle concorrente robusto.

### Atualizacao apos execucao da Fase 5

Itens ja executados:

- Criada rota `/admin` no front-end.
- Criado login administrativo simples por `ADMIN_API_KEY`.
- Criado endpoint `GET /api/admin/summary` com totais de inscricoes, pagas, pendentes, receita paga, resumo por distancia e lotes.
- Criado endpoint `GET /api/admin/registrations` com filtros por lote, distancia, status e busca.
- Criado endpoint `GET /api/admin/registrations.csv` para exportacao CSV.
- Painel exibe cards de metricas, tabela de inscritos, status de pagamento, valor, lote, distancia e data de criacao.
- Painel permite atualizar dados e exportar CSV.
- `.env.example` atualizado com `ADMIN_API_KEY`.
- `README.md` atualizado com instrucao de acesso ao painel.
- `npm run lint` passando.
- `npm run build` passando.
- Endpoints admin validados localmente com chave `change-me`.

Limite importante da Fase 5: a protecao atual por `ADMIN_API_KEY` e suficiente apenas para desenvolvimento/local. Em producao, substituir por autenticacao real com sessoes seguras, MFA opcional, RBAC, auditoria de exportacoes e mascaramento de dados sensiveis.

### Atualizacao apos execucao da Fase 6

Itens ja executados, sem realizar deploy:

- API recebeu headers adicionais de seguranca: `Permissions-Policy`, `X-Frame-Options` e HSTS condicional em producao.
- API passou a exigir `Content-Type: application/json` em endpoints POST sensiveis.
- API passou a tratar JSON invalido com resposta controlada.
- API bloqueia `ADMIN_API_KEY=change-me` quando `NODE_ENV=production`.
- Logs estruturados basicos foram adicionados sem dados pessoais sensiveis.
- Criadas paginas `/privacidade` e `/regulamento`.
- Formulario e rodape agora linkam para politica de privacidade e regulamento.
- `index.html` recebeu canonical, `og:locale`, `og:url` e `theme-color`.
- Criados `public/robots.txt` e `public/sitemap.xml`.
- Criado `PRODUCAO.md` com checklist de seguranca, LGPD, backup, monitoramento e performance, sem instrucoes de deploy.
- Criado script `npm run backup:db`.
- `.env.example` atualizado com `BACKUP_DIR`.
- Criado `.gitignore` para `node_modules`, `dist`, `.env`, `.env.local`, `data` e `backups`.
- `npm run lint` passando.
- `npm run build` passando.
- `npm run backup:db` validado com sucesso.

Limite importante da Fase 6: deploy, dominio, HTTPS real, observabilidade gerenciada, banco gerenciado e gateway de pagamento real ficaram fora da execucao, conforme solicitado.

Proximo bloco recomendado: escolher provedor de pagamento e banco gerenciado para substituir o modo local por infraestrutura real de producao.

## 2. Diagnostico tecnico completo

### Estrutura do projeto

Arquivos principais identificados:

- `src/App.tsx`: compoe a landing em uma unica rota.
- `src/components/layout.tsx`: navbar, marquee e footer.
- `src/components/hero.tsx`: hero principal e contador regressivo.
- `src/components/forms.tsx`: formulario de inscricao e formulario de patrocinio.
- `src/components/visuals.tsx`: percurso e galeria.
- `src/components/faq.tsx`: FAQ.
- `src/index.css`: Tailwind v4, fontes remotas e tokens visuais.
- `index.html`: metadados basicos.
- `vite.config.ts`: configuracao Vite e Tailwind.

A organizacao por componentes e simples e compreensivel para uma landing. Porem, ainda falta separacao por dominio de negocio:

- Dados da corrida estao hardcoded nos componentes.
- Conteudo comercial, lotes, valores, vagas e regras nao estao centralizados.
- Formularios nao possuem schema compartilhado.
- Nao ha camada de API.
- Nao ha tipos de dominio para participante, inscricao, pagamento, lote ou cupom.
- Nao ha rotas para sucesso, erro, admin, regulamento ou checkout.

### Rotas

Hoje existe apenas uma SPA com uma unica tela. Os links da navbar usam ancoras (`#about`, `#map`, `#register`, `#faq`). O link `#about` aponta para uma secao que nao existe explicitamente, pois nenhuma secao atual possui `id="about"`.

Rotas necessarias para producao:

- `/`: landing page.
- `/inscricao`: formulario dedicado ou etapa do checkout.
- `/checkout/:registrationId`: pagamento.
- `/sucesso`: confirmacao.
- `/erro` ou `/pagamento-cancelado`: falha/cancelamento.
- `/regulamento`: regulamento completo.
- `/admin`: painel administrativo protegido.
- `/api/registrations`: criacao e consulta de inscricoes.
- `/api/payments/create`: criacao de pagamento.
- `/api/webhooks/payment`: webhook do gateway.

### Build e qualidade

Comando executado:

- `npm run build`: passou com sucesso.

Resultado do build:

- CSS: aproximadamente 26.85 kB, gzip 5.78 kB.
- JS: aproximadamente 360.38 kB, gzip 114.09 kB.

Comando executado:

- `npm run lint`: falhou.

Erro encontrado:

- `src/components/forms.tsx`: usa `React.FormEvent` sem importar o namespace `React`.

Correcoes tecnicas imediatas:

- Importar `type FormEvent` de `react` e trocar as assinaturas para `FormEvent`.
- Ou importar `React` explicitamente.
- Manter `npm run lint` obrigatorio no pipeline.

## 3. O que ja esta pronto

- Landing page visualmente forte, com identidade agressiva e esportiva.
- Hero com data, horario, local e distancias.
- Contador regressivo funcional no client.
- CTA principal para inscricao.
- Secao de inscricao com oferta de Lote 1.
- Selecao basica de distancia e tamanho de camisa.
- Beneficios do kit apresentados de forma objetiva.
- Secao de percurso com mensagem de performance.
- FAQ inicial.
- Rodape com marca e links sociais.
- Layout responsivo em grid e classes Tailwind.
- Build de producao funcionando.

## 4. O que falta para producao

Falta praticamente toda a infraestrutura transacional:

- Backend para criar inscricao.
- Validacao de dados no servidor.
- Banco de dados.
- Gateway de pagamento.
- Webhook de confirmacao.
- Controle de status da inscricao.
- Controle de lote, preco e vagas.
- Prevencao de duplicidade.
- Pagina de sucesso.
- Pagina de erro/cancelamento.
- E-mail ou WhatsApp de confirmacao.
- Painel administrativo.
- Exportacao CSV/Excel.
- Regulamento completo.
- Politica de privacidade/LGPD.
- Monitoramento, logs e backup.
- SEO e Open Graph profissionais.
- Dominios, HTTPS e variaveis de producao.

## 5. Problemas criticos

1. O formulario confirma inscricao sem pagamento.
   Atualmente `handleSubmit` apenas executa `setStatus('success')`. Isso cria uma falsa percepcao de inscricao confirmada.

2. Nao existe backend.
   Sem servidor/API nao ha validacao confiavel, persistencia, antifraude, pagamento ou webhook.

3. Nao existe banco de dados.
   Nao ha como guardar participantes, inscricoes, status de pagamento, lotes, logs ou relatorios.

4. Nao existe gateway de pagamento.
   O projeto nao vende de fato. Precisa integrar Pix/cartao/boleto conforme estrategia comercial.

5. Nao existe controle de lote e vagas.
   A landing fala em Lote 1 limitado, mas nao ha regra real impedindo vendas acima do limite.

6. Typecheck falha.
   `npm run lint` falha em `src/components/forms.tsx`.

7. Metadados estao genericos.
   `index.html` usa `lang="en"` e titulo `My Google AI Studio App`.

8. Variaveis de ambiente estao desalinhadas.
   `.env.example` fala de Gemini/API Studio, nao de FunPace Run, pagamento, banco ou app em producao.

9. Dependencias e README herdados do template.
   Ha dependencias e documentacao que sugerem um app de AI Studio, nao a landing oficial da corrida.

10. Nao ha LGPD.
    O fluxo vai coletar dados pessoais sensiveis para organizacao de evento. Precisa base legal, consentimento, retencao, seguranca e canal de atendimento.

## 6. Melhorias de layout e conversao

### Hero principal

O hero tem impacto visual, mas precisa comunicar oferta com mais clareza comercial:

- Incluir CTA primario acima da dobra: "Garantir inscricao - Lote 1".
- Incluir preco do lote atual ou faixa "a partir de R$ X".
- Incluir vagas restantes ou data de virada de lote, desde que real e alimentado pelo backend.
- Incluir texto curto de valor: corrida oficial FunPace, 5K e 10K, kit atleta, chip, medalha e arena.
- Ajustar idioma e consistencia: ha varios textos em ingles como `Season`, `NO EXCUSES`, `OUTWORK EVERYONE`, `All rights reserved`. Pode manter parte como linguagem de marca, mas informacoes decisivas devem estar em portugues claro.

### Menu

- Corrigir link `#about` ou criar secao `id="about"`.
- Adicionar link para `Regulamento`.
- Considerar CTA fixo no mobile, no rodape da viewport, para reduzir abandono.
- Garantir menu mobile completo, pois hoje os links ficam ocultos em telas pequenas e sobra apenas o botao "Participar".

### Secoes da pagina

Secoes recomendadas para uma landing de alta conversao:

- Hero com oferta, data, distancia, local e CTA.
- Bloco rapido "O que voce recebe".
- Informacoes da prova: data, horario, local, largada, retirada de kits, categorias e distancias.
- Lotes e precos.
- Kit do atleta com imagem/mockup real.
- Percurso com mapa real ou imagem oficial.
- Programacao do evento.
- FAQ.
- Regulamento e termos.
- Confiança: organizacao, contatos oficiais, politicas, meios de pagamento e suporte.
- Rodape com CNPJ/organizador, contato, redes e links legais.

### Prova social e confianca

Hoje a galeria usa imagens remotas genericas do Unsplash e texto "Registros de edicoes anteriores". Se nao houver edicoes anteriores reais da FunPace Run, isso deve ser ajustado para nao criar alegacao enganosa.

Alternativas:

- "Inspire-se para o dia da prova".
- "Energia FunPace Run".
- Usar assets oficiais, mockups e fotos reais da organizacao quando disponiveis.

Antes do pagamento, incluir:

- Quem organiza.
- Canal de suporte no WhatsApp.
- Politica de reembolso/cancelamento.
- Link para regulamento.
- Informacao sobre ambiente seguro de pagamento.
- Confirmacao de que a vaga so e garantida apos pagamento aprovado.

## 7. Melhorias no formulario de inscricao

Campos obrigatorios recomendados:

- Nome completo.
- E-mail.
- CPF.
- Telefone/WhatsApp.
- Data de nascimento.
- Sexo.
- Tamanho da camisa.
- Distancia: 5K ou 10K.
- Cidade/UF, se necessario para relatorio.
- Contato de emergencia, recomendado para evento esportivo.
- Equipe/assessoria, opcional.
- Cupom, se existir.
- Aceite do regulamento.
- Aceite do termo de responsabilidade.
- Aceite da politica de privacidade/LGPD.

Validacoes obrigatorias:

- Nome com pelo menos duas palavras.
- E-mail em formato valido.
- CPF com digito verificador valido.
- Telefone brasileiro valido.
- Data de nascimento coerente com idade minima do regulamento.
- Distancia permitida.
- Tamanho de camisa dentro da grade disponivel.
- Checkboxes legais obrigatorios.
- Bloqueio de envio duplo no botao.
- Estados de carregamento, sucesso e erro.

Tratamento de erro:

- Erros por campo, nao apenas mensagem generica.
- Mensagem clara quando lote esgotar.
- Mensagem clara quando CPF/e-mail ja tiver inscricao paga.
- Reaproveitar inscricao pendente quando possivel, em vez de criar duplicidade.
- Confirmacao visual somente depois de criar inscricao e iniciar checkout, nunca como "inscricao confirmada" antes do pagamento.

Fluxo recomendado:

1. Usuario preenche dados.
2. Backend valida dados, lote, vaga, preco e duplicidade.
3. Backend cria inscricao com status `pending_payment`.
4. Backend cria pagamento no gateway.
5. Usuario e redirecionado para checkout/Pix.
6. Webhook confirma pagamento.
7. Inscricao muda para `paid`.
8. Usuario recebe confirmacao por e-mail/WhatsApp.

## 8. Melhorias no checkout e pagamento

Gateway recomendado:

- Mercado Pago, Pagar.me, Asaas, Stripe ou outro gateway com Pix, cartao, webhook confiavel e conciliacao.

Requisitos obrigatorios:

- Preco calculado somente no backend.
- Lote e cupom validados somente no backend.
- Criacao de pagamento vinculada a `registrationId`.
- Webhook com assinatura/verificacao oficial do gateway.
- Idempotencia no webhook.
- Logs de eventos de pagamento.
- Status separado para inscricao e pagamento.
- Pagina de sucesso consultando status real no backend.
- Pagina de erro/cancelamento com opcao de tentar novamente.
- Expiracao de inscricoes pendentes.
- Bloqueio de confirmacao manual pelo front-end.

Status recomendados:

- `draft`: rascunho, se houver salvamento parcial.
- `pending_payment`: inscricao criada aguardando pagamento.
- `paid`: pagamento aprovado.
- `payment_failed`: pagamento recusado.
- `expired`: pagamento expirado.
- `cancelled`: cancelado pela organizacao ou usuario.
- `refunded`: reembolsado.

Evitar inscricao falsa:

- Nunca considerar submit do formulario como inscricao confirmada.
- Confirmar vaga apenas apos webhook aprovado.
- Se for necessario reservar vaga antes do pagamento, usar reserva temporaria com expiracao curta.

Evitar duplicidade:

- Chave unica por evento + CPF para inscricoes pagas.
- Regra para inscricoes pendentes: reutilizar ou expirar antes de criar nova.
- Idempotency key no gateway e no webhook.

Controle de lote e vagas:

- Lote com inicio, fim, preco, limite e status.
- Venda atomica/transacional para impedir overbooking.
- Contador publico alimentado pelo backend, com cache curto.

## 9. Melhorias de seguranca

Variaveis de ambiente necessarias:

- `APP_URL`.
- `DATABASE_URL`.
- `PAYMENT_PROVIDER`.
- `PAYMENT_ACCESS_TOKEN` ou equivalente.
- `PAYMENT_WEBHOOK_SECRET`.
- `EMAIL_PROVIDER_API_KEY`.
- `WHATSAPP_PROVIDER_TOKEN`, se usado.
- `ADMIN_SESSION_SECRET`.
- `ALLOWED_ORIGINS`.
- `RATE_LIMIT_STORE_URL`, se usar Redis.

Protecoes obrigatorias:

- Validacao no backend com schema.
- Sanitizacao de strings.
- Rate limit em formulario, checkout e webhook.
- CORS restrito.
- Headers de seguranca: CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Protecao contra manipulacao de preco.
- Logs sem CPF completo, token, cartao ou dados sensiveis.
- Webhook validado por assinatura.
- Admin com autenticacao forte e permissao por perfil.
- ReCAPTCHA, Turnstile ou honeypot para reduzir spam.
- Auditoria de alteracoes administrativas.

LGPD:

- Politica de privacidade.
- Termo de responsabilidade.
- Finalidade clara da coleta.
- Consentimento para comunicacoes quando aplicavel.
- Retencao definida dos dados.
- Canal para solicitacao de exclusao/consulta.
- Exportacoes protegidas, pois CSV/Excel tera dados pessoais.

## 10. Melhorias de performance

Pontos atuais:

- Build passa.
- Bundle JS gzipado em torno de 114 kB, aceitavel para landing, mas pode melhorar.
- Imagens da galeria vem de URLs externas do Unsplash, sem controle total de disponibilidade, dimensoes e cache.
- Fontes sao importadas via CSS do Google Fonts, gerando dependencia externa no carregamento.
- SEO e metadados estao genericos.

Melhorias recomendadas:

- Definir `lang="pt-BR"`.
- Atualizar title e description.
- Adicionar Open Graph e Twitter Cards.
- Criar `robots.txt` e `sitemap.xml`.
- Usar imagens locais otimizadas em WebP/AVIF.
- Definir `width`, `height`, `loading="lazy"` e `decoding="async"` nas imagens abaixo da dobra.
- Preload somente do necessario acima da dobra.
- Considerar self-host das fontes ou reduzir familias/pesos.
- Remover dependencias nao usadas.
- Rodar Lighthouse mobile antes do lancamento.
- Evitar animacoes pesadas em dispositivos de baixo desempenho.
- Garantir acessibilidade de contraste, foco, labels e navegacao por teclado.

## 11. Estrutura ideal de banco de dados

Modelo recomendado:

### `events`

- `id`
- `name`
- `slug`
- `date`
- `start_time`
- `location_name`
- `address`
- `city`
- `state`
- `status`
- `created_at`
- `updated_at`

### `race_distances`

- `id`
- `event_id`
- `name`
- `distance_km`
- `capacity`
- `min_age`
- `status`

### `lots`

- `id`
- `event_id`
- `name`
- `price_cents`
- `starts_at`
- `ends_at`
- `capacity`
- `sold_count`
- `status`

### `participants`

- `id`
- `full_name`
- `email`
- `cpf_hash`
- `cpf_encrypted`
- `phone`
- `birth_date`
- `gender`
- `city`
- `state`
- `emergency_contact_name`
- `emergency_contact_phone`
- `created_at`
- `updated_at`

### `registrations`

- `id`
- `event_id`
- `participant_id`
- `distance_id`
- `lot_id`
- `shirt_size`
- `status`
- `price_cents`
- `discount_cents`
- `final_price_cents`
- `coupon_id`
- `terms_accepted_at`
- `regulation_accepted_at`
- `privacy_accepted_at`
- `created_at`
- `updated_at`
- `expires_at`

### `payments`

- `id`
- `registration_id`
- `provider`
- `provider_payment_id`
- `provider_checkout_url`
- `method`
- `status`
- `amount_cents`
- `paid_at`
- `expires_at`
- `created_at`
- `updated_at`

### `payment_events`

- `id`
- `payment_id`
- `provider_event_id`
- `event_type`
- `payload`
- `received_at`
- `processed_at`
- `status`

### `coupons`

- `id`
- `event_id`
- `code`
- `type`
- `value_cents`
- `percent`
- `max_uses`
- `used_count`
- `starts_at`
- `ends_at`
- `status`

### `admin_users`

- `id`
- `name`
- `email`
- `password_hash` ou provedor OAuth.
- `role`
- `last_login_at`
- `created_at`
- `updated_at`

### `audit_logs`

- `id`
- `admin_user_id`
- `action`
- `entity`
- `entity_id`
- `metadata`
- `created_at`

Indices e integridade:

- Unique em `event_id + cpf_hash` para inscricoes pagas/ativas, conforme regra.
- Indice em `registrations.status`.
- Indice em `payments.provider_payment_id`.
- Indice em `payment_events.provider_event_id` para idempotencia.
- Foreign keys obrigatorias.
- Transacoes para venda de lote/vaga.

Backup:

- Backup diario automatizado.
- Retencao minima ate pos-evento.
- Teste de restore antes do lancamento.

## 12. Estrutura ideal de painel administrativo

Funcionalidades minimas:

- Login seguro.
- Dashboard com vendas totais, receita, inscritos pagos, pendentes e cancelados.
- Lista de inscritos.
- Filtro por lote.
- Filtro por distancia.
- Filtro por status de pagamento.
- Filtro por tamanho de camisa.
- Busca por nome, e-mail ou CPF mascarado.
- Exportacao CSV/Excel.
- Controle de vagas por distancia e lote.
- Relatorio financeiro.
- Relatorio de kits por tamanho.
- Lista final para organizacao da corrida.
- Reenvio de confirmacao.
- Visualizacao de pagamento e eventos de webhook.
- Cancelamento/reembolso com trilha de auditoria.

Cuidados:

- Mascarar CPF por padrao.
- Registrar exportacoes.
- Permissoes por perfil.
- Proteger rotas admin no servidor, nao apenas no front-end.

## 13. Checklist de producao

- Corrigir typecheck.
- Atualizar README para FunPace Run.
- Remover referencias a Google AI Studio/Gemini se nao usadas.
- Atualizar `index.html` com `pt-BR`, title, description, OG e favicon.
- Centralizar dados oficiais da corrida.
- Confirmar data, horario, local, distancias, precos, lote e capacidade.
- Criar regulamento completo.
- Criar politica de privacidade.
- Implementar formulario completo.
- Implementar backend de inscricoes.
- Implementar banco de dados.
- Implementar gateway de pagamento.
- Implementar webhook em producao.
- Implementar pagina de sucesso.
- Implementar pagina de erro/cancelamento.
- Implementar e-mail/WhatsApp de confirmacao.
- Implementar painel administrativo.
- Configurar variaveis de producao.
- Configurar dominio e HTTPS.
- Configurar logs e monitoramento.
- Configurar backup.
- Configurar rate limit e headers de seguranca.
- Rodar testes de formulario.
- Rodar testes de pagamento aprovado, recusado, expirado e webhook duplicado.
- Rodar Lighthouse mobile.
- Fazer compra real de teste em producao/sandbox do gateway.
- Validar exportacao da lista de inscritos.
- Definir plano de rollback.

## 14. Roadmap por fases

### Fase 1: Ajustes criticos da landing page

- Corrigir `npm run lint`.
- Atualizar metadados do `index.html`.
- Corrigir link `#about` ou criar secao "A Prova".
- Ajustar copy para oferta clara em portugues.
- Adicionar preco/lote/vagas com dados reais ou remover alegacoes nao confirmadas.
- Adicionar CTA principal no hero.
- Adicionar regulamento e politicas no rodape.
- Revisar galeria para nao alegar edicoes anteriores sem prova real.
- Melhorar experiencia mobile com CTA persistente.

### Fase 2: Formulario de inscricao

- Criar schema de inscricao.
- Adicionar campos obrigatorios.
- Implementar mascaras e validacoes client-side.
- Implementar estados de carregamento, erro e sucesso.
- Adicionar checkboxes legais.
- Bloquear submit duplo.
- Trocar "inscricao confirmada" por "dados enviados, indo para pagamento".

### Fase 3: Checkout e pagamento

- Escolher gateway.
- Criar endpoint de criacao de pagamento.
- Calcular preco no backend.
- Implementar Pix/cartao conforme gateway.
- Implementar pagina de checkout ou redirecionamento.
- Implementar sucesso, erro e cancelamento.
- Implementar webhook validado.
- Implementar confirmacao por e-mail/WhatsApp.

### Fase 4: Banco de dados e controle de inscritos

- Escolher banco, preferencialmente Postgres.
- Criar tabelas de eventos, distancias, lotes, participantes, inscricoes, pagamentos e logs.
- Implementar transacoes para controle de vagas.
- Criar seeds do evento FunPace Run 2026.
- Implementar backup.
- Implementar scripts de migracao.

### Fase 5: Painel administrativo

- Criar login protegido.
- Criar dashboard de vendas.
- Criar lista de inscritos com filtros.
- Criar exportacao CSV/Excel.
- Criar relatorios de kit e financeiro.
- Criar visualizacao de pagamentos e webhooks.
- Criar auditoria de acoes administrativas.

### Fase 6: Seguranca, performance e deploy

- Configurar variaveis de producao.
- Aplicar headers de seguranca.
- Configurar CORS e rate limit.
- Implementar LGPD.
- Otimizar imagens e fontes.
- Rodar Lighthouse.
- Configurar dominio, HTTPS, logs, monitoramento e alertas.
- Testar pagamento real em ambiente de producao com valor controlado.
- Documentar rollback.

## 15. Lista dos arquivos que precisam ser alterados

Arquivos atuais:

- `src/components/forms.tsx`: corrigir typecheck, expandir formulario, remover sucesso falso e integrar API.
- `src/components/hero.tsx`: ajustar CTA, copy, dados oficiais e contador baseado em configuracao.
- `src/components/layout.tsx`: corrigir menu, adicionar links legais, melhorar mobile e rodape.
- `src/components/visuals.tsx`: substituir mapa/galeria genericos por assets oficiais ou copy honesta.
- `src/components/faq.tsx`: revisar FAQ com regras reais do regulamento.
- `src/App.tsx`: adicionar/organizar novas secoes ou rotas.
- `src/index.css`: revisar fontes, acessibilidade, tokens e performance.
- `index.html`: atualizar idioma, titulo, SEO, OG, favicon e metatags.
- `package.json`: renomear projeto, remover dependencias nao usadas e adicionar scripts/testes.
- `.env.example`: substituir variaveis de AI Studio por variaveis reais de producao.
- `README.md`: reescrever documentacao do FunPace Run.
- `metadata.json`: remover ou atualizar se ainda fizer sentido no deploy escolhido.
- `vite.config.ts`: revisar alias, configuracao de build e comentarios herdados.
- `tsconfig.json`: avaliar `allowJs`, strict mode e configuracoes de qualidade.

Arquivos novos recomendados:

- `src/config/event.ts`: dados oficiais da corrida.
- `src/types/registration.ts`: tipos de inscricao.
- `src/lib/validation.ts`: schemas de validacao.
- `src/lib/api.ts`: cliente API.
- `src/pages/Success.tsx`: confirmacao.
- `src/pages/PaymentError.tsx`: erro/cancelamento.
- `src/pages/Regulation.tsx`: regulamento.
- `src/server` ou app backend separado: APIs, webhooks e autenticacao.
- `prisma/schema.prisma` ou migracoes equivalentes.
- `src/admin`: painel administrativo, se mantido no mesmo app.
- `public/robots.txt`.
- `public/sitemap.xml`.
- `public/og-image.webp`.

## 16. Plano de acao por prioridade

### Critico

- Remover confirmacao falsa de inscricao antes do pagamento.
- Corrigir `npm run lint`.
- Implementar backend, banco, pagamento e webhook antes de abrir vendas.
- Implementar status real de inscricao.
- Implementar controle de lote/vagas.
- Implementar validacao server-side.
- Criar paginas de sucesso e erro/cancelamento.
- Atualizar metadados, README e variaveis para FunPace Run.
- Criar regulamento e politica de privacidade.

### Alto

- Completar campos do formulario.
- Implementar prevencao de duplicidade por CPF/evento.
- Implementar e-mail/WhatsApp de confirmacao.
- Criar painel administrativo basico.
- Implementar exportacao CSV/Excel.
- Aplicar headers de seguranca, CORS e rate limit.
- Configurar dominio, HTTPS, logs e monitoramento.
- Substituir imagens genericas por assets oficiais.
- Melhorar CTA e oferta acima da dobra.

### Medio

- Criar secao "A Prova" e corrigir menu.
- Adicionar programacao do evento.
- Adicionar relatorio de kits por tamanho.
- Adicionar cupons.
- Otimizar fontes e imagens.
- Criar sitemap e robots.
- Implementar auditoria administrativa.
- Melhorar acessibilidade e navegacao por teclado.

### Baixo

- Refinar microcopy comercial.
- Adicionar animacoes condicionais para dispositivos melhores.
- Melhorar estados vazios do admin.
- Criar pagina publica de consulta de inscricao.
- Adicionar testes automatizados de componentes visuais.
- Criar documentacao operacional para equipe do evento.

## Conclusao

O FunPace Run esta bem encaminhado como direcao visual de campanha, mas ainda nao possui a estrutura minima para vender inscricoes com seguranca. O lancamento profissional depende de transformar a landing em um fluxo transacional completo: formulario validado, pagamento real, webhook confiavel, banco de dados, painel administrativo, LGPD, monitoramento e deploy com checklist de producao.

Prioridade imediata: corrigir o typecheck, remover a confirmacao falsa, ajustar a landing para oferta clara e iniciar a implementacao do backend de inscricao/pagamento com controle real de lotes e vagas.
