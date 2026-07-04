const configuredWhatsAppNumber =
  import.meta.env.VITE_WHATSAPP_NUMBER ||
  import.meta.env.NEXT_PUBLIC_WHATSAPP_NUMBER ||
  '5569992565155';

export const whatsappSupport = {
  number: configuredWhatsAppNumber,
  message: 'Olá! Gostaria de mais informações sobre a FunPace Run.',
};

export function getWhatsAppUrl(message = whatsappSupport.message) {
  return `https://wa.me/${whatsappSupport.number}?text=${encodeURIComponent(message)}`;
}

export function getWhatsAppSupportUrl() {
  return getWhatsAppUrl();
}
