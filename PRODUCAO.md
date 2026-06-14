# PRODUCAO - FUNPACE RUN

Este checklist cobre seguranca, performance e operacao. O deploy em si fica a cargo da equipe.

## Antes de abrir vendas

- Trocar `ADMIN_API_KEY` e nunca usar `change-me` fora do ambiente local.
- Definir `ALLOWED_ORIGINS` somente com o dominio oficial.
- Definir `PAYMENT_PROVIDER=infinitepay`.
- Definir `INFINITEPAY_HANDLE` com a InfiniteTag da conta, sem o simbolo `$`.
- Definir `APP_URL` e `API_PUBLIC_URL` com URLs HTTPS publicas.
- Configurar `PAYMENT_WEBHOOK_SECRET` forte.
- Configurar/testar o webhook da InfinitePay apontando para `/api/webhooks/payment?token=PAYMENT_WEBHOOK_SECRET`.
- Criar as tabelas do Supabase com `server/supabase-schema.sql`.
- Definir `DATABASE_PROVIDER=supabase`, `DATABASE_URL` e `DATABASE_SSL=true`.
- Validar regulamento final e politica de privacidade.
- Confirmar preco, lote, capacidade, data, horario e local oficial.
- Rodar `npm run lint`.
- Rodar `npm run build`.
- Rodar teste completo de inscricao, redirecionamento InfinitePay, pagamento aprovado, webhook duplicado, valor divergente, duplicidade, vaga esgotada e exportacao CSV.

## Backups

- Em desenvolvimento, rode `npm run backup:db` para copiar `data/funpace-db.json` para `backups/`.
- Em producao, usar backup automatico do banco gerenciado, com teste periodico de restore.
- Proteger arquivos CSV/exportacoes com dados pessoais.

## Monitoramento

- Monitorar erros HTTP 4xx/5xx da API.
- Monitorar falhas de webhook.
- Monitorar aumento de tentativas por IP.
- Registrar eventos sem CPF completo, tokens ou dados sensiveis.

## LGPD

- Definir canal de atendimento para solicitacoes de titulares.
- Definir prazo de retencao dos dados apos o evento.
- Limitar acesso ao painel administrativo.
- Auditar exportacoes de inscritos.

## Performance

- Otimizar imagens oficiais em WebP/AVIF antes do lancamento.
- Rodar Lighthouse mobile.
- Revisar fontes externas e considerar self-host.
- Validar Core Web Vitals no dominio final.
