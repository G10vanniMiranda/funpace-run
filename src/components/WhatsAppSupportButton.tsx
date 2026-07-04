import { memo } from 'react';
import { FaWhatsapp } from 'react-icons/fa';
import { getWhatsAppSupportUrl } from '../config/whatsapp';

function WhatsAppSupportButtonComponent() {
  return (
    <a
      href={getWhatsAppSupportUrl()}
      target="_blank"
      rel="noreferrer"
      aria-label="Falar com suporte pelo WhatsApp"
      title="Falar com suporte pelo WhatsApp"
      className="fixed bottom-[calc(18px+env(safe-area-inset-bottom))] right-[calc(18px+env(safe-area-inset-right))] z-[10000] flex h-[52px] w-[52px] items-center justify-center rounded-[9999px] border border-white/25 bg-[#25D366] text-white shadow-[0_14px_34px_rgba(0,0,0,0.34),0_0_0_1px_rgba(37,211,102,0.18)] transition-[transform,box-shadow,filter] duration-200 ease-out hover:scale-105 hover:shadow-[0_18px_46px_rgba(0,0,0,0.42),0_0_0_1px_rgba(255,255,255,0.2)] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#25D366] active:scale-95 motion-reduce:transition-none sm:bottom-[calc(20px+env(safe-area-inset-bottom))] sm:right-[calc(20px+env(safe-area-inset-right))] sm:h-14 sm:w-14 lg:bottom-[calc(24px+env(safe-area-inset-bottom))] lg:right-[calc(24px+env(safe-area-inset-right))] lg:h-[60px] lg:w-[60px]"
    >
      <FaWhatsapp className="h-[27px] w-[27px] sm:h-[30px] sm:w-[30px] lg:h-8 lg:w-8" aria-hidden="true" />
    </a>
  );
}

export const WhatsAppSupportButton = memo(WhatsAppSupportButtonComponent);
