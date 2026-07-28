import {
  BarChart3,
  Check,
  Cookie,
  Megaphone,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePrivacyConsent } from '../../hooks/usePrivacyConsent';
import {
  acceptAllPrivacyConsent,
  rejectOptionalPrivacyConsent,
  setPrivacyConsent,
} from '../../lib/privacyConsent';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type PreferencesDraft = {
  statistics: boolean;
  marketing: boolean;
};

export function PrivacyConsentManager() {
  const consent = usePrivacyConsent();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [draft, setDraft] = useState<PreferencesDraft>(() => ({
    statistics: consent.preferences.statistics,
    marketing: consent.preferences.marketing,
  }));
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openPreferences = () => {
    setDraft({
      statistics: consent.preferences.statistics,
      marketing: consent.preferences.marketing,
    });
    setPreferencesOpen(true);
  };

  const closePreferences = () => setPreferencesOpen(false);

  useEffect(() => {
    if (!preferencesOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : triggerRef.current;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable?.[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePreferences();
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [preferencesOpen]);

  const savePreferences = () => {
    setPrivacyConsent(draft);
    closePreferences();
  };

  return (
    <>
      {!consent.hasDecision ? (
        <section
          aria-labelledby="privacy-consent-title"
          aria-describedby="privacy-consent-description"
          className="fixed inset-x-3 bottom-3 z-[10010] mx-auto max-w-5xl overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950/98 text-white shadow-[0_24px_80px_rgba(0,0,0,0.72)] backdrop-blur-xl motion-safe:animate-[consent-enter_320ms_ease-out] sm:inset-x-5 sm:bottom-5"
          role="dialog"
        >
          <div className="h-1 bg-linear-to-r from-brand via-lime-300 to-brand" aria-hidden="true" />
          <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-8">
            <div className="flex min-w-0 gap-4">
              <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-brand sm:flex">
                <Cookie className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-brand">
                  Sua privacidade, sua escolha
                </p>
                <h2 id="privacy-consent-title" className="font-display text-2xl font-black uppercase leading-none sm:text-3xl">
                  Controle seus dados
                </h2>
                <p id="privacy-consent-description" className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-300">
                  Usamos cookies necessários para o site funcionar. Estatísticas e Marketing são opcionais
                  e só serão ativados com a sua permissão.
                </p>
                <a href="/privacidade" className="mt-3 inline-flex text-xs font-bold uppercase tracking-wider text-zinc-400 underline decoration-zinc-600 underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
                  Entenda como usamos seus dados
                </a>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[480px]">
              <button
                type="button"
                onClick={rejectOptionalPrivacyConsent}
                className="min-h-12 rounded-lg border border-zinc-700 px-4 py-3 text-xs font-black uppercase tracking-wider text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Recusar opcionais
              </button>
              <button
                type="button"
                onClick={openPreferences}
                className="min-h-12 rounded-lg border border-zinc-700 px-4 py-3 text-xs font-black uppercase tracking-wider text-zinc-200 transition hover:border-brand/60 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Personalizar
              </button>
              <button
                type="button"
                onClick={acceptAllPrivacyConsent}
                className="min-h-12 rounded-lg bg-brand px-4 py-3 text-xs font-black uppercase tracking-wider text-black transition hover:bg-lime-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Aceitar todos
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {consent.hasDecision ? (
        <button
        ref={triggerRef}
        type="button"
        onClick={openPreferences}
        className="fixed bottom-3 left-3 z-[10010] inline-flex min-h-11 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-950/95 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-zinc-200 shadow-xl backdrop-blur transition hover:border-brand/70 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:bottom-5 sm:left-5"
        aria-haspopup="dialog"
      >
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        Preferências de Privacidade
        </button>
      ) : null}

      {preferencesOpen ? (
        <div
          className="fixed inset-0 z-[10020] flex items-end justify-center bg-black/80 p-3 backdrop-blur-sm motion-safe:animate-[consent-fade_180ms_ease-out] sm:items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreferences();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-preferences-title"
            aria-describedby="privacy-preferences-description"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 text-white shadow-[0_28px_100px_rgba(0,0,0,0.8)]"
          >
            <div className="flex items-start justify-between gap-5 border-b border-zinc-800 p-5 sm:p-7">
              <div>
                <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-brand">Central de privacidade</p>
                <h2 id="privacy-preferences-title" className="font-display text-2xl font-black uppercase leading-none sm:text-3xl">
                  Suas preferências
                </h2>
                <p id="privacy-preferences-description" className="mt-3 text-sm leading-relaxed text-zinc-400">
                  Você pode mudar sua decisão quando quiser. Cookies necessários permanecem ativos.
                </p>
              </div>
              <button
                type="button"
                onClick={closePreferences}
                aria-label="Fechar preferências de privacidade"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 transition hover:border-zinc-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3 p-5 sm:p-7">
              <ConsentCategoryRow
                icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
                title="Necessários"
                description="Mantêm segurança, navegação e funcionalidades essenciais do site."
                enabled
                locked
              />
              <ConsentCategoryRow
                icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
                title="Estatísticas"
                description="Ajudam a entender o uso do site por meio de métricas agregadas."
                enabled={draft.statistics}
                onToggle={() => setDraft((current) => ({ ...current, statistics: !current.statistics }))}
              />
              <ConsentCategoryRow
                icon={<Megaphone className="h-5 w-5" aria-hidden="true" />}
                title="Marketing"
                description="Autoriza Meta Pixel, eventos Browser e Meta Conversions API."
                enabled={draft.marketing}
                onToggle={() => setDraft((current) => ({ ...current, marketing: !current.marketing }))}
              />
            </div>

            <div className="grid gap-2 border-t border-zinc-800 p-5 sm:grid-cols-3 sm:p-7">
              <button
                type="button"
                onClick={() => {
                  rejectOptionalPrivacyConsent();
                  closePreferences();
                }}
                className="min-h-12 rounded-lg border border-zinc-700 px-4 py-3 text-xs font-black uppercase tracking-wider transition hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Recusar opcionais
              </button>
              <button
                type="button"
                onClick={savePreferences}
                className="min-h-12 rounded-lg border border-brand/60 px-4 py-3 text-xs font-black uppercase tracking-wider text-brand transition hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Salvar escolhas
              </button>
              <button
                type="button"
                onClick={() => {
                  acceptAllPrivacyConsent();
                  closePreferences();
                }}
                className="min-h-12 rounded-lg bg-brand px-4 py-3 text-xs font-black uppercase tracking-wider text-black transition hover:bg-lime-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Aceitar todos
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ConsentCategoryRow({
  icon,
  title,
  description,
  enabled,
  locked = false,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  locked?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-black/40 p-4 sm:p-5">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${enabled ? 'bg-brand/10 text-brand' : 'bg-zinc-900 text-zinc-500'}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-black uppercase">{title}</h3>
          {locked ? (
            <span className="rounded-full border border-zinc-700 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              Sempre ativo
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400 sm:text-sm">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? 'Desativar' : 'Ativar'} ${title}`}
        disabled={locked}
        onClick={onToggle}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          enabled ? 'border-brand bg-brand' : 'border-zinc-600 bg-zinc-800'
        } ${locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
          aria-hidden="true"
        >
          {enabled ? <Check className="h-3 w-3 text-brand" /> : null}
        </span>
      </button>
    </div>
  );
}
