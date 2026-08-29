# Homologação do Google Sheets

1. Execute somente `server/migrations/20260708_google_sheet_sync.sql` no SQL Editor do Supabase.
2. No Google Cloud, ative a Google Sheets API e crie uma Service Account exclusiva.
3. Crie uma planilha vazia e compartilhe-a como Editora com o e-mail da Service Account.
4. Configure no `.env` local ou diretamente na Vercel:

```env
GOOGLE_SHEETS_ENABLED=false
GOOGLE_SHEETS_SPREADSHEET_ID="id_da_planilha"
GOOGLE_SERVICE_ACCOUNT_EMAIL="conta@projeto.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

5. Mantenha `GOOGLE_SHEETS_ENABLED=false` até as três credenciais estarem preenchidas.
6. Altere para `true`, reinicie o backend e execute `POST /api/admin/google-sheets/check` autenticado como administrador.
7. Confirme a criação das abas e faça uma inscrição de homologação.

## Rollback

Defina `GOOGLE_SHEETS_ENABLED=false`. Inscrições e pagamentos continuarão no Supabase. Não remova a tabela da outbox: ela preserva o histórico e permite reprocessamento posterior.

## Layout drift safety (RELEASE-04 Stage 1)

O sync de layout reconcilia formatação (colunas, freeze, filtros, banding,
formatação condicional, protected range) a cada tarefa da outbox. Ele **não**
altera cabeçalhos, colunas ou dados.

- `GOOGLE_SHEETS_STRICT_LAYOUT_GUARD` — **default `false`**. Com `false` o
  comportamento é idêntico ao já publicado. Com `true` o sync passa a **falhar
  fechado** (`LAYOUT_DRIFT_DETECTED`, não-retryable, requer ação do operador) ao
  encontrar formatação condicional, banding ou basic filter que não reconhece
  como FUNPACE-managed, em vez de sobrescrevê-los silenciosamente. Não habilite
  antes do fingerprint da planilha de Produção (Stage 2).
- `npm run sheets:audit-layout -- --fixture <arquivo.json>` — auditoria
  **somente leitura**. Classifica os recursos de layout (`managed` /
  `legacy_managed` / `unmanaged`), calcula o plano de reparo que *seria*
  aplicado e imprime `REMOTE_MUTATIONS=0`. Não existe `--apply`.
- `npm run sheets:audit-layout -- --headers` roda a mesma auditoria contra a
  planilha remota configurada, lendo apenas metadados e a linha de cabeçalho
  (nunca linhas de participantes). Continua sem nenhuma escrita.
