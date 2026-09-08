# Runbook do operador — FunPace Run 2026

**Evento:** 20/09/2026, largada 06:00 (horário de Porto Velho).
**Para quem é este documento:** líder de turno (SUPERVISOR), operadores de pista (OPERADOR) e apoio técnico (TÉCNICO).
**Este documento não contém senhas, segredos nem dados de participantes.** A senha fica **só no cartão impresso** com o SUPERVISOR.

> Para o modo sem internet (lista em papel), use também o documento `event-day-offline-runbook.md`.

---

## 1. Papéis no dia

| Papel | Quantos | O que faz |
|---|---|---|
| **SUPERVISOR** (líder de turno) | 1 | guarda o cartão com a senha; coordena os logins; resolve exceções (prova errada, tamanho de camisa, sem número); mantém a lista de qual aparelho está com quem. |
| **OPERADOR** (pista) | 2 a 8 | fila / busca / abrir atleta / número de peito / check-in / entrega de kit / lista de largada. **Não** cancela inscrição, **não** mexe em pagamento, **não** troca prova, **não** edita cadastro. |
| **TÉCNICO** (apoio) | 0 a 1 | acompanha a saúde do sistema; conduz os procedimentos de incidente; só ele faz troca de segredo em emergência. |

Todos os aparelhos usam **a mesma conta de administrador** neste evento. É uma exceção combinada só para o dia 20/09. Por isso:
- o OPERADOR usa **apenas a aba "Operação"** e a ficha do atleta;
- ninguém abre painel executivo, pagamentos, alertas, configuração do evento ou relatórios;
- cancelamento, troca de prova, edição de cadastro e pagamento **vão para a mesa de exceções** (seção 8).

---

## 2. Checklist de preparação do aparelho

**Na véspera (19/09):**
- [ ] bateria 100% e power bank carregado
- [ ] bloqueio de tela ajustado para 5 a 10 minutos
- [ ] navegador atualizado (Chrome ou Safari); **não** usar aba anônima / privada
- [ ] permissão de câmera concedida ao site
- [ ] fazer **um login de teste** neste aparelho, na rede que será usada no dia
- [ ] abrir a **Lista de largada** (Operação → "Lista de largada"), nas duas ordens (por dorsal e por nome)
- [ ] **salvar a Lista de largada em PDF** no aparelho e conferir que ela abre com o aparelho em modo avião
- [ ] testar a **internet móvel** (Wi-Fi desligado): abrir a aba "Operação"
- [ ] pegar a senha **do cartão impresso** com o SUPERVISOR — nunca de memória nem de print
- [ ] depois do teste, **sair (logout)** — a não ser que já esteja combinado deixar logado
- [ ] etiquetar o aparelho com um número/nome que bata com a lista do SUPERVISOR

**Na manhã do evento (20/09):**
- [ ] bateria ≥ 90%, power bank junto
- [ ] um login limpo, usando o cartão, no horário combinado (seção 4)
- [ ] a aba "Operação" carrega e mostra a fila
- [ ] a busca por nome, CPF e número de peito retorna resultado
- [ ] o PDF salvo da lista ainda abre sem internet
- [ ] entregar o aparelho ao operador; SUPERVISOR marca na lista de aparelhos

---

## 3. Internet e plano B

- **Principal:** Wi-Fi do local, **se** estiver estável e tiver sido testado antes.
- **Plano B por aparelho:** internet móvel (dados) ligada e **testada** em cada celular. O sistema tem que funcionar no 4G/5G com o Wi-Fi desligado.
- **Operadoras diferentes:** metade dos aparelhos numa operadora, metade em outra — se uma cair, a pista não para.
- **Aparelho do SUPERVISOR e do TÉCNICO:** cada um com internet própria e independente do Wi-Fi do local.
- **Para o login, prefira internet móvel.** O Wi-Fi do local é um único endereço para todo mundo; se muita gente erra a senha ao mesmo tempo nesse Wi-Fi, o sistema pode travar novos logins daquele endereço por alguns minutos. Pelos dados do celular cada aparelho tem seu próprio endereço.
- **Sem internet nenhuma:** todo mundo passa para o **modo papel** — lista impressa (ou o PDF salvo), marca check-in e kit à mão, e o SUPERVISOR lança no sistema depois. Ver `event-day-offline-runbook.md`.

---

## 4. Horário dos logins

**Regra de ouro:** os logins são **um de cada vez**, no horário que o SUPERVISOR chamar. **Nunca todos juntos.** Vários erros de senha ao mesmo tempo, no mesmo Wi-Fi, com a mesma conta, travam novos logins por ~10 minutos (quem já está logado continua funcionando).

**Se a sessão dura 8 horas (situação atual):**
- logar **o mais tarde possível antes da abertura dos portões — alvo 05:30 a 05:45**;
- assim a sessão cobre todo o check-in e a maior parte da entrega de kit;
- por volta das **12:30** o SUPERVISOR faz uma rodada de re-login nos pontos que ainda estiverem movimentados.

**Se a sessão dura 16 horas (mudança prevista para 17/09):**
- logar cada aparelho entre **04:30 e 05:15, um de cada vez**, usando o cartão;
- a sessão cobre o dia inteiro, inclusive desmontagem — sem expiração no meio do evento.

O SUPERVISOR confirma no dia qual das duas situações está valendo.

---

## 5. Como fazer login (passo a passo)

1. Pegue o **cartão impresso** com o SUPERVISOR. O cartão é a única fonte da senha.
2. No aparelho, abra o navegador (modo normal, **não** anônimo) e vá para o endereço do Admin.
3. Digite o e-mail e a senha **uma vez, com calma, olhando o cartão**. Confirme.
4. **Espere o resultado. Não** aperte "entrar" de novo se demorar.
   - **Deu certo:** o painel abre. Abra a aba **"Operação"**. Pronto.
   - **"E-mail ou senha inválidos":** você errou a digitação. Avise o SUPERVISOR e tente **mais uma vez**, devagar, pelo cartão.
   - **"Muitas tentativas de login. Aguarde alguns minutos.":** **pare.** Passe este aparelho para **internet móvel** (Wi-Fi desligado) e tente de novo, ou espere 10 minutos. Não fique tentando na mesma rede — isso aumenta o tempo de bloqueio.
   - **"Não foi possível conectar ao servidor":** é problema de internet, não de senha. Cheque Wi-Fi / dados móveis. Se continuar, chame o TÉCNICO.
5. Depois de entrar, **não saia (logout)** até o fim do seu turno, a não ser que vá deixar o posto de vez.
6. Se aparecer **"Sua sessão expirou. A ação NÃO foi executada."** no meio do turno: a sua última ação **não** foi registrada. Faça login de novo pelo cartão, **refaça aquela ação** e confira se ela foi aplicada.

---

## 6. Fluxo normal na pista

Buscar / ler QR → abrir a ficha do atleta → conferir → número de peito (se faltar) → **check-in** → **entrega de kit**.

- O **kit só pode ser entregue depois do check-in**. Se você tentar entregar o kit antes, o sistema recusa e pede o check-in primeiro. Isso é proteção, não erro.
- **Bater duas vezes no check-in** não gera problema: o sistema entende que já foi feito e não duplica.
- Para **desfazer um check-in**, o kit daquele atleta não pode ter sido entregue ainda. Se o kit já saiu, primeiro desfaça o kit.
- Achou algo errado que você **não** pode resolver (prova errada, camisa errada, atleta não aparece, pedido de reembolso)? Encaminhe para a **mesa de exceções** (seção 8) e siga atendendo a fila.

---

## 7. Procedimentos de incidente

| Situação | O que o operador faz | Quem escala |
|---|---|---|
| **A. Saiu sem querer (logout)** | logar de novo pelo cartão, com calma. Os outros aparelhos não são afetados. | se der "muitas tentativas": internet móvel ou esperar 10 min → SUPERVISOR |
| **B. Sessão expirou no meio de uma ação** | a ação **não** foi feita. Logar de novo, refazer só aquela ação e conferir. | SUPERVISOR se repetir no mesmo aparelho |
| **C. Esqueceu / errou a senha** | parar depois de 2 tentativas com calma pelo cartão. O cartão com o SUPERVISOR é a única fonte. | SUPERVISOR entrega o cartão; se o cartão sumiu → só o TÉCNICO resolve |
| **D. "Muitas tentativas de login"** | passar o aparelho para **internet móvel** e tentar uma vez, ou esperar ~10 min. Quem já está logado continua. | SUPERVISOR coordena para não tentarem todos juntos |
| **E. "Não foi possível conectar ao servidor"** | é internet. Alternar Wi-Fi / dados móveis. | TÉCNICO se acontecer em vários aparelhos |
| **F. Wi-Fi do local caiu** | todos passam para **dados móveis** e seguem. Aparelho sem dados móveis vai para a **lista em papel**. | TÉCNICO confirma cobertura; SUPERVISOR reposiciona |
| **G. Sem internet nenhuma** | **modo papel**: lista impressa / PDF, marcar check-in e kit à mão, SUPERVISOR lança depois. | SUPERVISOR declara o modo papel |
| **H. Aparelho perdido** | tratar como uma sessão de administrador ativa até expirar (até 8 h, ou 16 h se a mudança estiver valendo). **Não** dá para desconectar remotamente pela tela. Seguir operando nos outros. | TÉCNICO + SUPERVISOR; **trocar a senha compartilhada depois do evento** |
| **I. Aparelho roubado (confirmado)** | igual ao "perdido", com mais urgência. Se necessário, o **TÉCNICO** faz a troca do segredo do sistema — isso desconecta **todos** os aparelhos e obriga todo mundo a logar de novo. Só em emergência, com aval do SUPERVISOR. | TÉCNICO executa; SUPERVISOR autoriza |
| **J. Operador vai deixar o posto de vez** | ele **sai (logout)** naquele aparelho, ou entrega o aparelho desbloqueado para o substituto. | SUPERVISOR atualiza a lista de aparelhos |
| **K. Prova errada / camisa errada no balcão** | o operador **não** resolve. Encaminhar para a **mesa de exceções**. | SUPERVISOR faz a correção |
| **L. App com erro num aparelho** | recarregar a aba uma vez; se persistir, trocar por um **aparelho reserva** (logar pelo cartão) e separar o com defeito. | TÉCNICO olha a saúde do sistema; SUPERVISOR troca o aparelho |

---

## 8. Mesa de exceções

**O que é:** um posto fixo, com o SUPERVISOR (ou alguém com o aparelho do SUPERVISOR), que resolve o que o operador de pista não pode fazer.

| Caso | O que a mesa faz |
|---|---|
| **prova errada** | confere identidade e pagamento e usa "Alterar prova" na ficha do atleta |
| **tamanho de camisa errado** | edita o tamanho na ficha do atleta |
| **pago e sem número de peito** | atribui o próximo número daquela prova, ali na mesa |
| **nome / CPF divergente do documento** | confere pelo e-mail de confirmação / pagamento e corrige se for erro de digitação; senão anota para revisão depois do evento |
| **atleta não aparece na busca** | busca por CPF, depois por e-mail, depois no histórico de pessoas; se realmente não existir, anota os dados no papel e resolve depois — **não** cria inscrição na hora |
| **pedido de reembolso / cancelamento** | **não** é ação do dia do evento. Anota o contato e passa para o financeiro depois. |

**Fluxo:** o operador de pista identifica o problema → manda o atleta para a mesa de exceções com um bilhete de uma linha → a mesa resolve → o atleta volta para a fila do operador para o check-in e o kit.
A mesa mantém um **caderno de papel** (nome do atleta, o que mudou, horário) como registro humano de apoio.

---

## 9. Regras de segurança com a conta compartilhada

1. **Aparelho sempre sob controle.** Ou na mão do operador, ou com o SUPERVISOR. Nunca largado na mesa desbloqueado.
2. **Bloqueio de tela de 5 a 10 minutos** com senha de aparelho.
3. **Uma aba, uma função.** Só "Operação" e a ficha do atleta.
4. **Operador de pista não cancela, não mexe em pagamento, não troca prova, não edita cadastro.** Isso é regra, vai para a mesa de exceções.
5. **Senha só do cartão impresso.** Sem print, sem colar em conversa, sem falar em voz alta em grupo. O cartão fica com o SUPERVISOR.
6. **Sem aba anônima / privada.**
7. **Logout só ao deixar o posto de vez.**
8. **Lista de aparelhos** sempre atualizada (quem está com qual aparelho).
9. **Depois do evento:** trocar a senha compartilhada; se algum aparelho foi perdido/roubado, o TÉCNICO também troca o segredo do sistema. Voltar a duração de sessão para o padrão.
10. **Nunca** desligar a autenticação, desligar o limite de tentativas, deixar a lista de largada pública, nem aumentar a duração da sessão de forma permanente.

---

## 10. Mudança da duração da sessão (só o TÉCNICO, nas datas combinadas)

- **17/09/2026 — aumentar para 16 horas:** o TÉCNICO ajusta a configuração no painel de hospedagem e publica novamente a versão atual. Depois, faz **um** login de teste e confere que a nova sessão dura ~16 horas. Sessões já abertas não mudam — por isso a alteração precisa acontecer **antes** dos logins do dia do evento.
- **22/09/2026 — voltar para 8 horas:** o TÉCNICO remove o ajuste e publica novamente. Sessões de 16 horas ainda abertas seguem até expirar sozinhas.
- Nas duas datas: registrar data, horário e a duração conferida.
- **Nenhuma dessas mudanças é feita pelo operador nem pelo SUPERVISOR.**

---

## 11. Contatos e escalonamento

| Preciso de… | Procure |
|---|---|
| senha / cartão | SUPERVISOR |
| aparelho reserva | SUPERVISOR |
| prova / camisa / número de peito | mesa de exceções (SUPERVISOR) |
| "não conecta" em vários aparelhos, app com erro, aparelho perdido/roubado | TÉCNICO |
| mudança de configuração da sessão | TÉCNICO (só nas datas 17/09 e 22/09) |
| reembolso / financeiro | anotar e passar para o financeiro depois do evento |
