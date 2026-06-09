# PRODUCAO - FUNPACE RUN

Este checklist cobre seguranca, performance e operacao. O deploy em si fica a cargo da equipe.

## Antes de abrir vendas

- Trocar `ADMIN_API_KEY` e nunca usar `change-me` fora do ambiente local.
- Definir `ALLOWED_ORIGINS` somente com o dominio oficial.
- Configurar `PAYMENT_WEBHOOK_SECRET` forte.
- Substituir `data/funpace-db.json` por banco gerenciado com transacoes reais antes de alto volume.
- Validar regulamento final e politica de privacidade.
- Confirmar preco, lote, capacidade, data, horario e local oficial.
- Rodar `npm run lint`.
- Rodar `npm run build`.
- Rodar teste completo de inscricao, duplicidade, vaga esgotada e exportacao CSV.

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
