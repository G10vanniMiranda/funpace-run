# Event-Day Operator Readiness — FunPace Run 2026

**Event:** `funpace-run-2026` — 2026-09-20, largada 06:00 (America/Porto_Velho), Complexo Madeira-Mamoré, Porto Velho/RO.

**O que este documento é:** a referência de planejamento por trás do runbook do operador
([`event-day-operator-runbook.md`](event-day-operator-runbook.md)) — plano de aparelhos, modelo de papéis, plano de
conectividade, e os procedimentos **agendados** (não executados) de mudança e rollback do tempo de sessão. Para o modo
sem internet, ver [`event-day-offline-runbook.md`](event-day-offline-runbook.md).

**Não contém** senhas, segredos, tokens, PII, e-mails privados, IPs de operadores nem dados de participantes.

---

## 1. Modelo de autenticação (situação atual)

| item | valor |
|---|---|
| conta | **uma conta `administrator` compartilhada.** Não existe API/UI de gestão de usuários. Não há contas `operation` nem `finance`. |
| login | `POST /api/admin/session` — cria **uma nova sessão a cada login**; logins não invalidam sessões anteriores. |
| multi-aparelho | **suportado e já em uso** — várias sessões simultâneas na mesma conta, cada uma com seu próprio prazo. Um logout afeta só o aparelho que saiu. |
| duração da sessão (TTL) | **8 horas** (padrão do sistema; sem override em Produção). Prazo fixado no login — **não há renovação automática**. |
| expiração | o cliente **não** avisa antes; o primeiro sinal é um 401 no meio de uma ação → *"Sua sessão expirou. A ação NÃO foi executada."* (a ação não foi aplicada). |
| limite de tentativas de login | por IP: bloqueia acima de **10 tentativas em 5 min**; por IP+e-mail: bloqueia acima de **5 tentativas falhas em 10 min**. Janela **fixa** (não desliza). Um login bem-sucedido zera os contadores. Armazenamento em memória por instância — o bloqueio é real mas transitório. |
| risco de NAT do local | o Wi-Fi do local é **um único IP** para todos + **um e-mail compartilhado** → vários erros de senha ao mesmo tempo podem travar novos logins daquele e-mail/IP por ~10 min (sessões já abertas continuam). Mitigação: login escalonado, cartão impresso, `429` → passar o aparelho para dados móveis (IP novo). |
| perda de aparelho | a sessão **não** pode ser revogada remotamente pela tela; expira sozinha em ≤ TTL. Rotação do segredo do sistema invalida **todas** as sessões e é de emergência apenas. |

### ⚠ Conta `administrator` compartilhada — TEMPORARY EVENT-DAY EXCEPTION

Usar a mesma conta `administrator` em todos os aparelhos é uma **exceção combinada e datada, só para 2026-09-20** — não é
o estado-alvo. Riscos residuais aceitos para o dia, com mitigação:

- **todo aparelho de pista tem privilégio total de administrador** (poderia cancelar inscrição, mexer em pagamento, ver
  receita, mudar configuração do evento) → mitigado por controle físico do aparelho, bloqueio de tela, regra "uma aba, uma
  função", e o fluxo de mesa de exceções;
- **as auditorias mostram sempre o mesmo autor** e **não há log de login** → mitigado pelo caderno de papel da mesa de
  exceções e pela lista de qual aparelho está com quem.

A exceção **expira no fim do evento**. A correção definitiva é identidade individual de administrador (fora de escopo a 12
dias do evento). Uma opção intermediária — uma conta `operation` compartilhada para a pista, com `administrator` só com o
supervisor/técnico — está disponível como melhoria pré-evento com aprovação separada; remove alcance de
cancelamento/pagamento/receita dos aparelhos de pista, mas adiciona uma segunda credencial compartilhada e não muda a
exposição do limite de tentativas.

---

## 2. Plano de aparelhos (3 / 5 / 10)

Papéis: **FIELD** (operador de pista), **SUP** (supervisor / líder de turno), **TECH** (apoio técnico). Todos com a
credencial `administrator` compartilhada (seção 1).

| frota | FIELD | SUP | TECH | janela de login (escalonado, um de cada vez) | divisão de conectividade | observações |
|---|---:|---:|---:|---|---|---|
| **3 aparelhos** | 2 | 1 | 0 (SUP acumula) | 04:45–05:00, ~15 s de intervalo | 2 operadoras entre os 3 | mínimo viável; SUP guarda o cartão e acompanha a saúde do sistema |
| **5 aparelhos** | 3 | 1 | 1 | 04:40–05:05, ~20 s de intervalo | ≥ 2 operadoras; SUP + TECH cada um em uplink independente | **baseline recomendado** para o porte deste evento |
| **10 aparelhos** | 8 | 1 | 1 | 04:30–05:15, ~30 s de intervalo, **nunca em bloco** | ~metade operadora A / metade B; SUP + TECH independentes | puxar a **lista impressa / PDF** em cada FIELD; não deixar 10 aparelhos martelando o carregamento ao vivo |

- **Reservas:** 1 aparelho reserva carregado a cada 5 do plano, já com navegador atualizado e câmera testada, **sem login**
  até ser necessário (um reserva que loga depois só inicia o próprio relógio de sessão).
- **Carga:** o peso por aparelho é a leitura da lista (~700 linhas) por trás da aba "Operação" e da lista de largada, não os
  logins. Em 10 aparelhos é confortável; em 20+, os operadores devem trabalhar sobretudo pelo **PDF salvo** e atualizar a
  lista ao vivo só sob demanda.

---

## 3. Modelo de papéis

| papel operacional | quantidade | privilégio necessário | privilégio concedido hoje |
|---|---:|---|---|
| **FIELD** | 2–8 | fila, busca, ficha mascarada, número de peito atribuir/desfazer, check-in/desfazer, kit/desfazer, lista de largada | **`administrator` completo** — sobre-concedido, aceito por um dia (ver exceção na seção 1) |
| **SUP** | 1 | tudo do FIELD + correção de prova + edição de tamanho de camisa + cancelamento + tratamento de incidentes | `administrator` completo — adequado |
| **TECH** | 0–1 | acompanhar `/api/health` e `/api/admin/monitoring`, procedimentos de incidente, rotação de segredo em emergência | `administrator` completo — adequado |
| FINANCE | 0 na pista | não é preocupação de pista no dia | não existe conta `finance`; nenhuma necessária |

Ações que o FIELD **não** faz (vão para a mesa de exceções): correção de prova (`administrator` apenas), edição de tamanho
de camisa (`administrator`/`finance`), cancelamento, envio de e-mail, pagamentos.

---

## 4. Conectividade

- **Principal:** Wi-Fi do local, **só se** estável e testado antes.
- **Plano B por aparelho:** dados móveis ligados e **testados** em cada celular (Wi-Fi desligado → abrir a aba "Operação").
- **Diversidade de operadoras:** ao menos **2 operadoras** representadas na frota, para uma queda de operadora não parar a
  pista.
- **SUP e TECH:** cada um com uplink próprio, independente do Wi-Fi do local.
- **Interação com o limite de tentativas:** o Wi-Fi do local é um IP único compartilhado. Preferir **dados móveis para o
  passo de login** (IPs distintos → contadores separados) e Wi-Fi para o tráfego de leitura depois. `429` no login → passar
  o aparelho para dados móveis dá a ele um contador novo.
- **Sem internet nenhuma:** todo o piso passa para o **modo papel** — lista impressa / PDF, marcar check-in e kit à mão,
  SUP reconcilia no sistema depois ([`event-day-offline-runbook.md`](event-day-offline-runbook.md)).

---

## 5. Prazos de login

### Política atual: sessão de 8 h

| login do aparelho | expira | veredito |
|---|---|---|
| 22:00 da véspera | **06:00** (abertura) | BLOQUEIA aquele aparelho — não confiar em sessão da véspera |
| 04:30 | **12:30** | expira no meio da entrega de kit — RISCO |
| 05:00 | **13:00** | expira no fim do kit / pós-prova — RISCO |
| 05:30 | **13:30** | expira no apoio pós-prova — RISCO, o menos ruim se mantiver 8 h |

Se a mudança de TTL **não** for aplicada: logar **o mais tarde possível com segurança antes dos portões — alvo 05:30–05:45**
(expiração 13:30–13:45 cobre todo o check-in e a maior parte do kit); o SUP faz uma rodada controlada de re-login por volta
das **12:30** nos pontos ainda movimentados. Cada re-login é uma interrupção e reexpõe a janela do limite de tentativas —
mantê-los sequenciais e pelo cartão.

### Política futura aprovada: sessão de 16 h — aplicar 2026-09-17, reverter 2026-09-22

| login do aparelho | expira | veredito |
|---|---|---|
| 22:00 da véspera | **14:00** | cobre check-in + kit daquele aparelho |
| 04:30 | **20:30** | cobre tudo, inclusive desmontagem — sem expiração no meio do evento |
| 05:00 | **21:00** | idem |

Com 16 h ativo: logar cada aparelho entre **04:30 e 05:15, um de cada vez**, pelo cartão impresso. Sessões de 8 h já
abertas não são afetadas — só logins **após** o redeploy de 2026-09-17 recebem 16 h, e por isso a mudança precisa entrar
**antes** da rodada de logins do dia do evento.

---

## 6. Procedimento de mudança de TTL — 2026-09-17 (GATED — NÃO É CONFIG ATUAL)

> Este é um procedimento **agendado e condicionado a aprovação**. A configuração **atual** é de 8 h. Nada aqui é executado
> fora da janela aprovada, e só pelo TECH.

**Objetivo:** `ADMIN_SESSION_TTL_SECONDS = 57600` (16 h) ativo em Produção antes de qualquer login do dia do evento.

**Pré-condições:** aprovação do Operations Gate para este redeploy de configuração; é o **último deploy antes do
congelamento rígido de 2026-09-18**; `main` sem mudanças pendentes não relacionadas.

**Passos (executor = TECH, com o SUP presente):**
1. No ambiente de Produção do provedor de hospedagem, definir a variável **`ADMIN_SESSION_TTL_SECONDS = 57600`**. Não
   tocar em nenhuma outra variável.
2. Disparar um **redeploy do commit atual de `main`** (redeploy vazio — sem mudança de código). Mudança de variável só vale
   no próximo deploy; funções em execução não recarregam sozinhas.
3. Depois do deploy pronto, verificar:
   - `GET /api/health` → 200, banco OK, sem problema de configuração;
   - **um** login de teste num aparelho → o `Max-Age` do cookie ≈ 57600 **e** a nova linha de sessão com
     `expires_at - created_at` ≈ 57600 (checagem somente leitura).
4. Registrar: id do deploy, horário e o TTL verificado.

**Se o passo 3 mostrar que o TTL não mudou** (ainda ~28800): o redeploy não pegou a variável — disparar o deploy de novo;
**não** ir para o dia do evento com TTL não verificado.

**Sem mudança de esquema, sem migração, sem mudança de código.** Configuração + redeploy apenas.

---

## 7. Procedimento de rollback de TTL — 2026-09-22 (GATED — NÃO EXECUTAR ANTES DA DATA)

**Objetivo:** voltar o TTL de sessão para o padrão de 8 h depois da janela do evento.

**Passos (executor = TECH):**
1. No ambiente de Produção, **remover** o override `ADMIN_SESSION_TTL_SECONDS` (ou defini-lo explicitamente como `28800`).
2. Disparar um redeploy do commit atual de `main`.
3. Depois de pronto: `GET /api/health` → 200; um login de teste → `Max-Age` ≈ 28800 e TTL da nova linha de sessão ≈ 28800.
4. Registrar id do deploy + horário + TTL verificado.

Sessões de 16 h ainda abertas mantêm o prazo de 16 h até expirarem sozinhas — aceitável; foram emitidas dentro da janela
aprovada.

**Encerramento do evento (em / após 2026-09-22):** trocar a senha da conta `administrator` compartilhada; se algum
aparelho foi perdido ou roubado durante o evento, rotacionar também o segredo do sistema (invalida todas as sessões).

---

## 8. Tabela de incidentes (A–L)

| id | situação | ação | escalonamento |
|---|---|---|---|
| **A** | saiu sem querer (logout) | logar de novo pelo cartão, sequencial, com calma. Outros aparelhos não afetados. | se `429`: dados móveis ou esperar 10 min → SUP |
| **B** | sessão expirou no meio de uma ação | a ação **não** foi feita. Logar de novo, refazer só aquela ação, conferir. | SUP se repetir no mesmo aparelho |
| **C** | esqueceu / errou a senha | parar após 2 tentativas com calma pelo cartão. O cartão com o SUP é a única fonte; não há reset self-service. | SUP entrega o cartão; se o cartão sumiu → só o TECH |
| **D** | "Muitas tentativas de login" (`429`) | passar o aparelho para **dados móveis** e tentar uma vez, ou esperar ~10 min. Quem já está logado continua. | SUP coordena para não tentarem todos juntos |
| **E** | "Não foi possível conectar ao servidor" | é internet, não senha. Alternar Wi-Fi / dados móveis; abrir `/api/health`. | TECH se acontecer em vários aparelhos |
| **F** | Wi-Fi do local caiu | todos para **dados móveis** e seguem. Aparelho sem dados móveis → **lista em papel**. | TECH confirma cobertura; SUP reposiciona |
| **G** | sem internet nenhuma | **modo papel**: lista impressa / PDF, marcar à mão, SUP lança depois. | SUP declara o modo papel; TECH observa a volta |
| **H** | aparelho perdido | tratar como sessão de administrador ativa até expirar (≤ 8 h, ou ≤ 16 h se a mudança estiver valendo). **Não** dá para desconectar remotamente pela tela. Seguir nos outros. | TECH + SUP; **trocar a senha compartilhada depois do evento** |
| **I** | aparelho roubado (confirmado) | como H, com mais urgência. Se justificar, **o TECH rotaciona o segredo do sistema** (variável + redeploy) — invalida **todas** as sessões e obriga re-login geral. Só emergência, com aval do SUP. Não rotacionar o segredo casualmente em operação ao vivo. | TECH executa; SUP autoriza |
| **J** | operador deixa o posto de vez | ele **sai (logout)** naquele aparelho, ou entrega o aparelho desbloqueado ao substituto. | SUP atualiza a lista de aparelhos |
| **K** | prova errada / camisa errada no balcão | o FIELD **não** resolve. Encaminhar para a **mesa de exceções**. | SUP faz a correção (prova = `administrator`; camisa = `administrator`/`finance`) |
| **L** | app com erro num aparelho | recarregar a aba uma vez; se persistir, trocar por um **aparelho reserva** (login pelo cartão) e separar o com defeito. | TECH olha `/api/health` + `/api/admin/monitoring`; SUP troca o aparelho |

---

## 9. Mesa de exceções

Um posto fixo, com o SUP (ou alguém com o aparelho do SUP), que resolve o que o operador de pista não pode fazer na fila.

| caso | o que a mesa faz | deixa auditoria? |
|---|---|---|
| prova errada | confere identidade + pagamento → Admin → ficha → **"Alterar prova"** (`administrator` apenas) | sim — uma `registration.distance_corrected` |
| tamanho de camisa errado | Admin → ficha → editar tamanho (`administrator`/`finance`) | sim — uma edição de cadastro estreita |
| pago e sem número de peito | atribui o próximo número daquela prova, ali na mesa | sim — uma atribuição de número |
| nome / CPF divergente do documento | confere pelo e-mail de confirmação / pagamento; corrige se for erro de digitação, senão anota para revisão pós-evento | sim |
| atleta não aparece na busca | busca por CPF, depois e-mail, depois histórico de pessoas; se realmente não existir, anota no papel e resolve depois — **não** cria inscrição na hora | n/a |
| duplicado / já fez check-in | a primitiva é idempotente (retorna "já fez check-in"); confirma que é a mesma pessoa e libera | só a auditoria original |
| pedido de reembolso / cancelamento | **não** é ação do dia. Anota o contato e passa para o financeiro depois. | n/a |

**Fluxo:** FIELD identifica o problema → manda o atleta à mesa com um bilhete de uma linha → a mesa resolve com o aparelho
`administrator` do SUP → o atleta volta à fila do FIELD para check-in + kit. A mesa mantém um caderno de papel (nome, o que
mudou, horário) como backstop humano da atribuição fraca de auditoria.

---

## 10. Regra CHECK-IN antes de KIT (invariantes)

- **O kit só é entregue depois do check-in.** Tentar entregar o kit antes → o sistema recusa e pede o check-in primeiro.
  Isso é proteção, não erro. (Invariante PG-1: *kit entregue ⇒ check-in feito*.)
- **Não se desfaz um check-in enquanto o kit daquele atleta existir.** Primeiro desfaz o kit, depois o check-in.
  (Invariante PG-2.)
- Check-in e kit são **idempotentes**: bater duas vezes não duplica; sob concorrência (vários toques ao mesmo tempo no
  mesmo atleta) o sistema consolida em exatamente um registro e uma auditoria.
- Desfazer é remoção física do registro (não fica marca de "desfeito" na contagem).

Essas invariantes foram exercitadas de ponta a ponta contra as primitivas reais em homologação (participantes sintéticos,
resíduo zero): check-in / duplicado / kit-após-check-in / kit-antes (PG-1) / undo-check-in-com-kit (PG-2) / undo-kit /
undo-check-in / 6 check-ins concorrentes → 1 registro + 1 auditoria / zero `KIT_ENTREGUE + SEM_CHECK-IN`.

---

## 11. Papel do supervisor (resumo)

- Guarda o **cartão impresso** com a credencial — única fonte da senha.
- Chama os logins **um de cada vez** nos horários da seção 2. Nunca a frota inteira junta.
- Mantém a **lista de qual aparelho está com quem**, atualizada.
- Opera a **mesa de exceções** (seção 9) e mantém o caderno de papel.
- Declara o **modo papel** se a conectividade cair de vez (seção 4 e offline runbook).
- Na política de 8 h, faz a **rodada de re-login ~12:30** nos pontos ainda movimentados.
- Autoriza (com o TECH) as ações de emergência de aparelho perdido/roubado (seção 8, H/I).
- Pós-evento: garante a troca da senha compartilhada; aciona o rollback de TTL (seção 7).

---

## 12. Start List / PDF offline

- A Lista de Largada vive em **Admin → Operação → "Lista de largada"** (`administrator` ou `operation`).
- **Abrir para impressão** → A4 preto e branco → Imprimir / Salvar como PDF. **Baixar CSV** → `.csv` UTF-8 BOM.
- Duas ordenações: **por dorsal** (padrão) e **por nome** — imprimir as duas.
- Cada aparelho de pista salva o **PDF localmente** e confirma, em modo avião, que ele abre sem internet.
- Enquanto houver atletas pagos sem número de peito, a lista sai marcada como **"LISTA PROVISÓRIA"**.
- Detalhes de regeneração, uso em papel e reconciliação: [`event-day-offline-runbook.md`](event-day-offline-runbook.md).
