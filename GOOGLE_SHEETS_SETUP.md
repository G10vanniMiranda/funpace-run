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
