# Meta Pixel

O Pixel do navegador é configurado exclusivamente por `VITE_META_PIXEL_ID`. Em
produção, configure essa variável com o ID informado no ambiente da Vercel.
O script é assíncrono, carregado uma única vez e não é ativado nas rotas
administrativas.

## Consentimento

O site ainda não possui uma escolha separada para cookies de marketing. A
integração está pronta para esse controle: defina
`VITE_META_PIXEL_REQUIRE_CONSENT=true` e chame
`setMetaPixelConsent(true | false)`, de `src/lib/metaPixel.ts`, a partir do
futuro banner ou gerenciador de preferências. A aceitação atual da política no
formulário serve ao processamento da inscrição e não é reutilizada como
consentimento de marketing.

## Conversions API

O backend e o webhook da InfinitePay existem, mas a Conversions API não foi
ativada sem token. Para uma próxima etapa, configure somente no servidor:

```env
META_PIXEL_ID=
META_CONVERSIONS_API_TOKEN=
META_CONVERSIONS_API_VERSION=
```

O envio deve ser conectado ao resultado idempotente de confirmação do
pagamento, nunca ao recebimento bruto do webhook. O `event_id` deve ser
`purchase_{registrationId}`, igual ao `eventID` usado pelo navegador. Falhas da
Meta não podem interromper a confirmação da inscrição. E-mail e telefone, caso
sejam usados com base legal e consentimento adequados, devem ser normalizados e
passar por SHA-256 no servidor; CPF e dados bancários nunca devem ser enviados.

## Validação manual

Depois de configurar a variável de produção, use o Meta Pixel Helper e a tela
"Testar eventos" do Gerenciador de Eventos. Confirme `PageView`,
`ViewContent`, `InitiateCheckout`, `Lead` e um `Purchase` real aprovado.
`AddPaymentInfo` não é emitido: a seleção do meio de pagamento acontece na
InfinitePay e o aplicativo não recebe esse sinal de forma confiável.
