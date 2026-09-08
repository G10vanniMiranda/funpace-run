# Event-Day Offline Runbook — FunPace Run

**Event:** `funpace-run-2026` — 2026-09-20, largada 06:00 (America/Porto_Velho), Complexo Madeira-Mamoré, Porto Velho/RO.

**O que este runbook cobre:** gerar e usar a **Lista de Largada** impressa como registro operacional temporário quando a internet cai, e reconciliar as marcações de papel no sistema quando a conexão volta. O Admin (PostgreSQL) é sempre a fonte de verdade; o papel é um espelho temporário.

A Lista de Largada vive em **Admin → Operação → "Lista de largada"** (`administrator` ou `operation`):
- **Abrir para impressão** → documento A4 preto e branco → botão **Imprimir** do navegador (ou "Salvar como PDF").
- **Baixar CSV** → arquivo `.csv` (UTF-8 BOM, abre no Excel/Google Sheets), `Cache-Control: private, no-store`.
- Duas ordenações: **Por dorsal** (padrão) e **Por nome**. Imprima as duas.

---

## 1. PRÉ-EVENTO

### 1.1 Regeneração final
A lista fica **desatualizada** após qualquer um destes eventos — regenere depois de cada um:
- nova inscrição paga (inclui confirmação de pagamento atrasada do gateway);
- atribuição / backfill de dorsal;
- correção de prova (`Alterar prova`);
- correção de perfil relevante (nome, camisa);
- correção administrativa de status (cancelamento).

Cronograma de regeneração:
1. logo após o **corte de inscrições (2026-09-18 EOD)**;
2. logo após o **backfill de dorsais** (os 82 pagos sem dorsal ganham número);
3. na **véspera** (versão marcada "PRÉVIA" — não vai para as estações);
4. **~2 h antes da abertura dos portões** → esta é a versão **final**; só ela vai para as estações.
Destrua todas as cópias "PRÉVIA" quando a final for distribuída.

### 1.2 Portão de validação (antes de imprimir a final)
A cada geração o sistema calcula um bloco `integrity` + um `status`:

| condição | comportamento | ação |
|---|---|---|
| `duplicateBibCount > 0` | **`status: blocked`** — CSV retorna `409 START_LIST_INTEGRITY_FAILED`, a tela mostra bloco vermelho | **NÃO imprima.** Corrija o dorsal duplicado (Admin → inscrição → número de peito) e gere de novo. |
| `forbiddenKitWithoutCheckInCount > 0` (kit entregue sem check-in) | **`status: blocked`** | **NÃO imprima.** Investigue a inconsistência com o desenvolvedor; corrija; gere de novo. |
| `paidWithoutBib > 0` | `status: provisional` — imprime com faixa **LISTA PROVISÓRIA** e a seção **"⚠ SEM DORSAL"** no topo | Só imprima a **final** depois do backfill de dorsais. Antes disso, use como provisória e atribua dorsal na chegada a partir do bloco reservado. |
| `paidIdentityReviewCount > 0` (pessoa com >1 inscrição paga) | `status: provisional` — aviso visível, os dois registros aparecem | Revise cada caso com o supervisor (pode ser pagamento em duplicidade). Não remova ninguém da lista. |
| `invalidDistanceCount > 0` (prova não reconhecida) | `status: provisional` — linha marcada com `(?)` na coluna Prova | Corrija a prova da inscrição; regenere. |
| tudo zero | **`status: final`** | Pode imprimir a versão final. |

**Nunca** uma linha paga é omitida — dorsal ausente vira `SEM DORSAL`, camisa ausente vira `—`, prova não reconhecida é marcada mas mantida.

### 1.3 Cópias e redundância
- **~5 conjuntos físicos** (cada = 1 lista por dorsal + 1 por nome):
  - cada estação de check-in (recomendado ≥ 3 estações);
  - mesa do supervisor / exceções (a **matriz** — nela se anota dorsal de quem chegou `SEM DORSAL`);
  - backup técnico / on-call (lacrado);
  - estação de entrega de kit (por dorsal — o check-in já foi feito na entrada).
- **PDF salvo localmente em ≥ 2 aparelhos de operador + 1 do supervisor** (menu Imprimir → "Salvar como PDF"). Teste abrir com o aparelho em modo avião. **Não** dependa de acesso só na nuvem.
- E-mail do PDF final para os 2 líderes de turno **antes** de perder conectividade.
- Defina por escrito **um responsável por folha** antes do evento.

---

## 2. QUEDA DE INTERNET (modo papel)

1. O líder de turno **anuncia "modo papel"** e anota a **hora** em todas as folhas.
2. **Um responsável por folha.** Ninguém marca a folha de outra estação.
3. **Marque com iniciais + hora** cada check-in e cada entrega de kit.
4. **CHECK-IN antes de KIT, sempre.** A coluna CHECK-IN vem à esquerda; o cabeçalho KIT diz "(após check-in)"; o rodapé repete a regra. Estações fisicamente separadas (check-in na entrada, kit depois) reforçam a ordem.
5. **Sem marcação dupla:** se outra estação já marcou o atleta, não marque de novo.
6. **Atleta sem dorsal:** encaminhe à mesa de exceções. O supervisor atribui um dorsal do **bloco reservado** anotado na matriz e registra `nome ↔ dorsal` para entrada posterior. Operadores **não** inventam dorsais.
7. **Atleta pago que não está na folha:** mesa de exceções confere o comprovante (e-mail de confirmação / prova de pagamento). Se legítimo, adiciona numa **folha-adendo** (`nome, prova, camisa, PAGO — verificar`), atribui dorsal do bloco reservado, e a inscrição é criada + reconciliada quando voltar a conexão. Causa comum: confirmação de pagamento atrasada.
8. Verifique `/api/health` de qualquer celular em dados móveis para saber quando o sistema voltou. **Pare de marcar papel** assim que voltar; anote a hora; reconcilie antes de retomar marcação digital.

---

## 3. RECOVERY (conexão restaurada)

O sistema volta a ser a autoridade. As marcações de papel **não** são autoritativas até serem reprocessadas. **Não existe endpoint de reconciliação em lote** — cada marca de papel é reprocessada pelas ações normais do Admin (primitivas estreitas), que são idempotentes.

1. **Congele o papel.** Recolha todas as folhas; escreva a hora de fim do modo papel em cada uma; nenhuma marcação nova.
2. **Atribua um dono por folha** e registre quem marcou o quê (iniciais já estão na folha).
3. **Entre os CHECK-INS primeiro** (preserva PG-1 `KIT ⇒ CHECK-IN`). Para cada marca de check-in no papel: buscar o atleta (por dorsal/nome) → **Registrar check-in**.
4. **Refresh autoritativo** — confira o contador de "Check-in pendente" na aba Operação.
5. **Entre as ENTREGAS DE KIT depois.** Para cada marca de kit: buscar → **Registrar entrega**.
6. **Refresh autoritativo** — confira "Kit pendente" e "Concluídos".
7. **`ALREADY_CHECKED_IN` / `KIT_ALREADY_DELIVERED` (HTTP 200) = sucesso** — o atleta já constava (janela online parcial ou entrada repetida). Marque a folha e siga; não trate como erro.
8. **`CHECK_IN_REQUIRED_FOR_KIT_DELIVERY` (409)** = marca de kit no papel sem check-in correspondente. Resolva: se o atleta realmente fez check-in no papel, entre esse check-in primeiro e depois o kit; se não, é erro de operador → sinalize ao supervisor, **não** force.
9. **Atletas sem dorsal atendidos no modo papel:** atribua o dorsal agora (Admin → inscrição → "Atribuir número de peito", motivo: `"EVENT-DAY: dorsal atribuído em modo papel, entrada retroativa"`), depois entre check-in/kit.
10. **Compare os totais:** aba Operação `{ paid, checkInPending, kitPending, completed }` vs a contagem do papel **por prova** (5K / 10K). Investigue qualquer diferença.
11. **Assinatura do supervisor:** o líder confirma contagem-papel == contagem-sistema por prova, assina e data a folha matriz, e arquiva.
12. **Pós-evento:** rode `POST /api/admin/reconciliation/run` (varredura financeira existente); exporte o CSV final de check-in/kit para registro.

---

## 4. FALHAS ESPECÍFICAS — fallback mais simples

| falha | detecção | fallback |
|---|---|---|
| Vercel indisponível | app/API fora; `/api/health` inacessível | modo papel (§2); monitorar `/api/health` por dados móveis; retomar + reconciliar (§3) |
| Banco (Supabase) indisponível | toda chamada Admin → 503; `/api/health` → 503 | modo papel; nada a limpar (primitivas são transacionais); reconciliar no retorno |
| Internet do local fora | chamadas expiram em ~15 s | **trocar cada aparelho para dados móveis**; se todas as operadoras falharem → modo papel |
| Uma operadora fora | alguns aparelhos lentos/falhando | mover esses operadores para aparelhos com operadora funcionando; manter ≥ 2 operadoras na frota |
| Permissão de câmera negada (QR) | scanner mostra o erro + campo manual | digitar o **dorsal** ou o ID no campo manual do scanner; ou buscar por nome |
| QR danificado/ilegível | scan falha | ler o **dorsal impresso** no número de peito e buscar por dorsal; ou por nome |
| Sessão expirou (TTL 8 h) | ação em voo → 401; drawer mostra "sessão expirou — ação NÃO executada" | re-login com o cartão de credencial; sessões multi-aparelho são independentes (só aquele aparelho é afetado). **Mitigação prévia:** aumentar `ADMIN_SESSION_TTL_SECONDS` para o fim de semana + logar os aparelhos na véspera. |
| Impressora indisponível | — | cópias **pré-impressas** véspera + manhã; **PDF salvo em ≥ 2 aparelhos** serve de fallback de leitura na tela |
| Lista impressa desatualizada | `generatedAt` + `Ref` (contentHash curto) em toda página vs a regra de "válida até" (§1.1) | destrua as cópias superadas; só cópias da geração final (§1.1 item 4) vão às estações; na dúvida, regenere e reimprima |
| Atleta pago ausente da lista impressa | operador não acha no papel | buscar no app (se online); se offline, mesa de exceções → folha-adendo + dorsal do bloco reservado + criar/reconciliar depois (§2.7) |
| Marcação de papel em duplicidade | no §3.7 a segunda entrada retorna `ALREADY_*` 200 | idempotente — sem dano; marque uma vez |
| Folha perdida/danificada | folha faltando na reconciliação | reconstruir a partir de: outras cópias redundantes (§1.3), log da mesa de exceções, e o último estado online (totais da Operação + auditoria). Qualquer lacuna → esses atletas são tratados como "ainda não fizeram check-in" e reverificados numa estação. |

---

## 5. PRIVACIDADE

- A lista contém **nome + CPF mascarado (`123.***.***-45`) + prova + camisa + dorsal**. Sem e-mail, telefone, nascimento, endereço, dados financeiros.
- CSV e JSON saem com `Cache-Control: private, no-store` e download forçado; nada é persistido no servidor.
- **Papel:** recolher todas as folhas ao fim do evento e **triturar** após os resultados serem finalizados.
- **Digital:** cada dono de aparelho **apaga** os PDFs/CSVs em até **48 h** após o evento; o supervisor confirma no debrief.
