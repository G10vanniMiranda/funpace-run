import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { eventInfo } from '../config/event';
import { NavigationLinks, type PublicNavigationLocation } from './navigation';

export default function MobileNavigation({
  currentLocation,
}: {
  currentLocation: PublicNavigationLocation;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const closeOnNavigation = () => setOpen(false);

    window.addEventListener('hashchange', closeOnNavigation);
    window.addEventListener('popstate', closeOnNavigation);
    window.addEventListener('funpace:navigation', closeOnNavigation);

    return () => {
      window.removeEventListener('hashchange', closeOnNavigation);
      window.removeEventListener('popstate', closeOnNavigation);
      window.removeEventListener('funpace:navigation', closeOnNavigation);
    };
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Abrir menu principal"
          aria-expanded={open}
          aria-controls="mobile-navigation-panel"
          className="flex h-11 w-11 shrink-0 items-center justify-center border border-white/15 bg-white/3 text-white transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:hidden"
        >
          <Menu className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="mobile-nav-overlay fixed inset-0 z-[10010] bg-black/75 backdrop-blur-sm" />
        <Dialog.Content
          id="mobile-navigation-panel"
          className="mobile-nav-panel fixed inset-y-0 right-0 z-[10020] flex w-[min(88vw,24rem)] flex-col border-l border-white/10 bg-zinc-950 text-white shadow-[-24px_0_80px_rgba(0,0,0,0.55)] focus:outline-none sm:hidden"
        >
          <Dialog.Title className="sr-only">Menu principal</Dialog.Title>
          <div className="flex min-h-16 items-center justify-end border-b border-white/10 px-5 sm:px-6">
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar menu principal"
                className="flex h-11 w-11 shrink-0 items-center justify-center border border-white/15 text-zinc-300 transition-colors hover:border-brand hover:bg-brand hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <X className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Description className="sr-only">
            Navegação principal da Funpace Run Experience.
          </Dialog.Description>

          <nav className="flex-1 overflow-y-auto px-5 py-8" aria-label="Menu principal móvel">
            <NavigationLinks
              currentLocation={currentLocation}
              mobile
              onNavigate={() => setOpen(false)}
            />
          </nav>

          <div className="border-t border-white/10 px-5 py-6">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-brand">
              Funpace Run Experience
            </p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              {eventInfo.city} · {eventInfo.dateLabel}
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
