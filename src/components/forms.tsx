import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Building, CheckCircle2, Info, Loader2, XCircle, Zap } from 'lucide-react';
import { eventInfo } from '../config/event';
import { ApiError, createPartnershipLead, createRegistration, getAvailability } from '../lib/api';
import { formatCpf, formatPhone, validateRegistration } from '../lib/validation';
import type { AvailabilityResponse, Gender, RaceDistance, RegistrationErrors, RegistrationFormData, ShirtSize } from '../types/registration';
import { Reveal } from './premium';

const initialRegistration: RegistrationFormData = {
  fullName: '',
  email: '',
  cpf: '',
  phone: '',
  birthDate: '',
  gender: '',
  shirtSize: 'M',
  distance: '10K',
  emergencyContactName: '',
  emergencyContactPhone: '',
  termsAccepted: false,
  regulationAccepted: false,
  privacyAccepted: false,
};

const inputClass = 'premium-input w-full min-w-0 bg-zinc-100 p-3.5 sm:p-4 border-b-2 border-black focus:outline-none focus:bg-zinc-200 transition-colors text-sm sm:text-base';
const errorClass = 'text-[11px] sm:text-xs font-bold uppercase tracking-wider text-red-700 leading-relaxed';
const labelClass = 'text-[11px] sm:text-xs font-bold uppercase tracking-widest leading-relaxed';

export function RegistrationSection() {
  const [status, setStatus] = useState<null | 'submitting' | 'checkout_pending' | 'api_error'>(null);
  const [formData, setFormData] = useState<RegistrationFormData>(initialRegistration);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [apiMessage, setApiMessage] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const activeLot = availability?.lots.find((lot) => lot.status === 'active') || availability?.lots[0];
  const lotPriceCents = activeLot?.priceCents ?? eventInfo.currentLotPriceCents;
  const selectedDistanceAvailability = availability?.distances.find((distance) => distance.name === formData.distance);
  const isSubmitting = status === 'submitting';

  useEffect(() => {
    let isMounted = true;

    getAvailability()
      .then((response) => {
        if (isMounted) {
          setAvailability(response);
        }
      })
      .catch(() => {
        if (isMounted) {
          setAvailability(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const updateField = <Field extends keyof RegistrationFormData>(
    field: Field,
    value: RegistrationFormData[Field],
  ) => {
    const nextData = { ...formData, [field]: value };

    setFormData(nextData);

    if (submitAttempted) {
      setErrors(validateRegistration(nextData));
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitAttempted(true);
    setApiMessage('');
    setRegistrationId('');

    const validationErrors = validateRegistration(formData);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setStatus(null);
      setApiMessage('Existem campos invalidos. Confira os dados destacados.');
      return;
    }

    setStatus('submitting');

    try {
      const response = await createRegistration(formData);

      setRegistrationId(response.registrationId);
      setApiMessage(response.message);

      if (response.checkoutUrl) {
        window.location.assign(response.checkoutUrl);
        return;
      }

      setStatus('checkout_pending');
    } catch (error) {
      setStatus('api_error');

      if (error instanceof ApiError) {
        setApiMessage(error.message);

        if (error.errors) {
          setErrors(error.errors as RegistrationErrors);
        }

        return;
      }

      setApiMessage('Nao foi possivel iniciar o checkout.');
    }
  };

  return (
    <section id="register" className="relative z-20 scroll-mt-24 bg-brand px-4 py-16 text-black sm:px-6 md:py-24 lg:py-32">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 xl:gap-24">
        <Reveal className="flex min-w-0 flex-col">
          <h2 className="mb-5 font-display text-[clamp(2.8rem,13vw,4.5rem)] font-black uppercase leading-none tracking-tighter md:mb-6">
            Não fique <br />para trás.
          </h2>
          <p className="mb-8 max-w-md text-base font-medium leading-relaxed opacity-80 sm:text-lg md:mb-10 md:text-xl">
            Garanta agora sua vaga no valor promocional do primeiro lote.
          </p>

          <div className="mb-6 grid max-w-md grid-cols-1 gap-3 sm:mb-8">
            <div className="min-w-0 border border-black/10 bg-black/5 p-3.5 sm:p-4">
              <p className="text-[11px] font-black uppercase tracking-widest opacity-60 sm:text-xs">Valor atual</p>
              <p className="mt-1 font-mono text-[clamp(1.25rem,6vw,1.5rem)] font-black">
                {(lotPriceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
            </div>
          </div>

          <div className="premium-card mb-8 rounded border-black/10 bg-black/5 p-4 text-black shadow-none sm:p-6">
            <h3 className="mb-4 font-black uppercase tracking-widest">O que inclui o KIT?</h3>
            <ul className="space-y-3 text-sm font-medium leading-relaxed">
              {eventInfo.kitItems.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Zap className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal className="min-w-0 bg-white p-4 pt-7 shadow-2xl sm:p-6 sm:pt-8 md:p-8 md:pt-10 xl:p-12" delay={0.08}>
          <h3 className="mb-7 font-display text-[clamp(1.7rem,7vw,2.65rem)] font-black uppercase leading-[0.95] tracking-tighter md:mb-8">
            Inscricao - {eventInfo.currentLot}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
              <Field label="Nome Completo" error={errors.fullName}>
                <input required type="text" value={formData.fullName} onChange={(event) => updateField('fullName', event.target.value)} className={inputClass} placeholder="Nome e sobrenome" aria-invalid={Boolean(errors.fullName)} />
              </Field>
              <Field label="E-mail" error={errors.email}>
                <input required type="email" value={formData.email} onChange={(event) => updateField('email', event.target.value)} className={inputClass} placeholder="voce@email.com" aria-invalid={Boolean(errors.email)} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
              <Field label="CPF" error={errors.cpf}>
                <input required type="text" inputMode="numeric" value={formData.cpf} onChange={(event) => updateField('cpf', formatCpf(event.target.value))} className={inputClass} placeholder="000.000.000-00" aria-invalid={Boolean(errors.cpf)} />
              </Field>
              <Field label="Telefone / WhatsApp" error={errors.phone}>
                <input required type="tel" inputMode="tel" value={formData.phone} onChange={(event) => updateField('phone', formatPhone(event.target.value))} className={inputClass} placeholder="(69) 99999-9999" aria-invalid={Boolean(errors.phone)} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
              <Field label="Sexo" error={errors.gender}>
                <select required value={formData.gender} onChange={(event) => updateField('gender', event.target.value as Gender)} className={`${inputClass} cursor-pointer appearance-none`} aria-invalid={Boolean(errors.gender)}>
                  <option value="">Selecione</option>
                  {eventInfo.genderOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Distancia" error={errors.distance}>
                <select value={formData.distance} onChange={(event) => updateField('distance', event.target.value as RaceDistance)} className={`${inputClass} cursor-pointer appearance-none`} aria-invalid={Boolean(errors.distance)}>
                  {eventInfo.distanceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {selectedDistanceAvailability && (
                  <p className="text-[11px] font-bold uppercase leading-relaxed tracking-wider opacity-60 sm:text-xs">
                    {selectedDistanceAvailability.remaining} vagas restantes nesta distancia.
                  </p>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
              <Field label="Tamanho da Camisa" error={errors.shirtSize}>
                <select value={formData.shirtSize} onChange={(event) => updateField('shirtSize', event.target.value as ShirtSize)} className={`${inputClass} cursor-pointer appearance-none`} aria-invalid={Boolean(errors.shirtSize)}>
                  {eventInfo.shirtSizes.map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="space-y-3 border border-black/10 bg-black/5 p-3.5 sm:p-4">
              <Checkbox checked={formData.termsAccepted} onChange={(checked) => updateField('termsAccepted', checked)}>
                Li e aceito o termo de responsabilidade da prova.
              </Checkbox>
              {errors.termsAccepted && <p className={errorClass}>{errors.termsAccepted}</p>}

              <Checkbox checked={formData.regulationAccepted} onChange={(checked) => updateField('regulationAccepted', checked)}>
                Li e aceito o <a href="/regulamento" className="underline">regulamento oficial</a> do FunPace Run.
              </Checkbox>
              {errors.regulationAccepted && <p className={errorClass}>{errors.regulationAccepted}</p>}

              <Checkbox checked={formData.privacyAccepted} onChange={(checked) => updateField('privacyAccepted', checked)}>
                Autorizo o uso dos meus dados para processar a inscricao, conforme a <a href="/privacidade" className="underline">politica de privacidade</a>.
              </Checkbox>
              {errors.privacyAccepted && <p className={errorClass}>{errors.privacyAccepted}</p>}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="premium-button group relative mt-4 flex min-h-14 w-full items-center justify-center gap-3 overflow-hidden bg-black p-4 text-center text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-zinc-800 disabled:opacity-70 sm:justify-between sm:p-6 sm:text-sm"
            >
              <span className="relative z-10 flex min-w-0 items-center gap-2">
                {status === 'submitting' && (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <span>PREPARANDO SUA INSCRICAO...</span>
                  </>
                )}
                {status === 'checkout_pending' && 'CHECKOUT EM IMPLANTACAO'}
                {status !== 'submitting' && status !== 'checkout_pending' && 'CONTINUAR PARA CHECKOUT'}
              </span>
              {status === 'submitting' ? (
                <span className="relative z-10 font-mono text-[10px] opacity-70">AGUARDE</span>
              ) : (
                <ArrowRight className="relative z-10 h-5 w-5 shrink-0 transition-transform group-hover:translate-x-2" />
              )}
            </button>

            {status === 'submitting' && (
              <AlertMessage tone="info" title="Informacao">
                Preparando sua inscricao e conectando ao checkout. Nao feche esta tela.
              </AlertMessage>
            )}

            {status === 'checkout_pending' && (
              <AlertMessage tone="success" title="Inscricao criada">
                {apiMessage} ID: {registrationId}. {eventInfo.offerNote}
              </AlertMessage>
            )}
            {status === 'api_error' && (
              <AlertMessage tone="error" title="Erro">
                {apiMessage}
              </AlertMessage>
            )}
            {submitAttempted && Object.keys(errors).length > 0 && status !== 'api_error' && (
              <AlertMessage tone="warning" title="Atencao">
                Existem campos invalidos. Corrija os dados destacados para continuar.
              </AlertMessage>
            )}
            <p className="text-center text-xs font-medium leading-relaxed opacity-60">
              * O envio ainda nao cria inscricao paga. A confirmacao dependera do gateway e do webhook.
            </p>
          </form>
        </Reveal>
      </div>
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <label className={labelClass}>{label}</label>
      {children}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-3 text-sm font-bold leading-relaxed">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-black"
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function AlertMessage({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'warning' | 'error' | 'info';
  title: string;
  children: ReactNode;
}) {
  const styles = {
    success: {
      className: 'border-emerald-800 bg-emerald-50 text-emerald-900',
      icon: CheckCircle2,
    },
    warning: {
      className: 'border-amber-700 bg-amber-50 text-amber-900',
      icon: AlertTriangle,
    },
    error: {
      className: 'border-red-800 bg-red-50 text-red-900',
      icon: XCircle,
    },
    info: {
      className: 'border-sky-800 bg-sky-50 text-sky-900',
      icon: Info,
    },
  }[tone];
  const Icon = styles.icon;

  return (
    <div className={`flex gap-3 border p-3 text-xs font-bold uppercase leading-relaxed tracking-wider shadow-sm transition-opacity duration-300 ${styles.className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="mb-1 font-black">{title}</p>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function SponsorSection() {
  const [formData, setFormData] = useState({
    companyName: '',
    contactNameRole: '',
    corporateEmail: '',
    involvementMessage: '',
    website: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<null | 'submitting' | 'success' | 'error'>(null);
  const isSubmitting = status === 'submitting';

  const validateSponsor = () => {
    const nextErrors: Record<string, string> = {};
    const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.corporateEmail.trim());

    if (!formData.companyName.trim()) {
      nextErrors.companyName = 'Informe o nome da empresa.';
    }

    if (!formData.contactNameRole.trim()) {
      nextErrors.contactNameRole = 'Informe seu nome e cargo.';
    }

    if (!emailIsValid) {
      nextErrors.corporateEmail = 'Informe um e-mail corporativo valido.';
    }

    if (formData.involvementMessage.trim().length < 10) {
      nextErrors.involvementMessage = 'Descreva como gostaria de participar.';
    }

    return nextErrors;
  };

  const updateSponsorField = (field: keyof typeof formData, value: string) => {
    const nextData = { ...formData, [field]: value };

    setFormData(nextData);

    if (Object.keys(errors).length > 0) {
      setErrors({});
    }

    if (status === 'error' || status === 'success') {
      setStatus(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const nextErrors = validateSponsor();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setStatus('error');
      return;
    }

    const [contactName, ...roleParts] = formData.contactNameRole.split('/').map((item) => item.trim()).filter(Boolean);

    setStatus('submitting');

    try {
      await createPartnershipLead({
        companyName: formData.companyName,
        contactName: contactName || formData.contactNameRole,
        contactRole: roleParts.join(' / ') || 'Nao informado',
        corporateEmail: formData.corporateEmail,
        involvementMessage: formData.involvementMessage,
        website: formData.website,
      });

      setStatus('success');
      setErrors({});
      setFormData({
        companyName: '',
        contactNameRole: '',
        corporateEmail: '',
        involvementMessage: '',
        website: '',
      });
    } catch (error) {
      setStatus('error');

      if (error instanceof ApiError && error.errors) {
        setErrors(error.errors);
      }
    }
  };

  return (
    <section className="relative border-y border-zinc-900 bg-zinc-950 px-4 py-16 sm:px-6 md:py-24">
      <Reveal className="premium-card relative z-10 mx-auto max-w-4xl p-5 text-center sm:p-8 md:p-16">
        <Building className="mx-auto mb-6 h-12 w-12 text-brand" />
        <h2 className="mb-4 font-display text-[clamp(2.4rem,10vw,3rem)] font-black uppercase leading-none tracking-tighter text-white">
          Seja um Patrocinador
        </h2>
        <p className="mx-auto mb-8 max-w-lg font-mono text-sm leading-relaxed text-zinc-400 md:mb-10">
          Posicione sua marca em um evento premium focado em performance, saude e inovacao. Preencha os dados e nossa equipe de branding entrara em contato.
        </p>

        <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-5 text-left sm:space-y-6">
          <input
            type="text"
            value={formData.website}
            onChange={(event) => updateSponsorField('website', event.target.value)}
            className="hidden"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
            <SponsorField error={errors.companyName}>
              <input required type="text" value={formData.companyName} onChange={(event) => updateSponsorField('companyName', event.target.value)} placeholder="Nome da Empresa" className="w-full border border-zinc-800 bg-zinc-900 p-4 text-white transition-colors focus:border-brand focus:outline-none" />
            </SponsorField>
            <SponsorField error={errors.contactNameRole}>
              <input required type="text" value={formData.contactNameRole} onChange={(event) => updateSponsorField('contactNameRole', event.target.value)} placeholder="Seu Nome / Cargo" className="w-full border border-zinc-800 bg-zinc-900 p-4 text-white transition-colors focus:border-brand focus:outline-none" />
            </SponsorField>
            <SponsorField error={errors.corporateEmail} className="md:col-span-2">
              <input required type="email" value={formData.corporateEmail} onChange={(event) => updateSponsorField('corporateEmail', event.target.value)} placeholder="E-mail Corporativo" className="w-full border border-zinc-800 bg-zinc-900 p-4 text-white transition-colors focus:border-brand focus:outline-none" />
            </SponsorField>
            <SponsorField error={errors.involvementMessage} className="md:col-span-2">
              <textarea
                required
                value={formData.involvementMessage}
                onChange={(event) => updateSponsorField('involvementMessage', event.target.value)}
                placeholder="Como gostaria de se envolver no evento? (Ex: Patrocinio Master, Ativacao Tenda, etc)"
                rows={4}
                className="w-full resize-none border border-zinc-800 bg-zinc-900 p-4 text-white transition-colors focus:border-brand focus:outline-none"
              />
            </SponsorField>
          </div>
          <button type="submit" disabled={isSubmitting} className="premium-button flex min-h-14 w-full items-center justify-center gap-2 bg-white p-4 text-sm font-black uppercase tracking-widest text-black transition-colors hover:bg-brand disabled:cursor-wait disabled:opacity-70">
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'ENVIANDO PROPOSTA' : 'ENVIAR PROPOSTA'}
          </button>
          {status === 'success' && (
            <AlertMessage tone="success" title="Proposta enviada">
              Proposta enviada com sucesso. Nossa equipe entrara em contato em breve.
            </AlertMessage>
          )}
          {status === 'error' && (
            <AlertMessage tone="error" title="Erro">
              Nao foi possivel enviar sua proposta agora. Tente novamente em alguns instantes.
            </AlertMessage>
          )}
        </form>
      </Reveal>

      <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 w-full -translate-x-1/2 -translate-y-1/2 select-none overflow-hidden text-center opacity-5">
        <h2 className="whitespace-nowrap font-display text-[15vw] font-black uppercase leading-none">
          SPONSORSHIP
        </h2>
      </div>
    </section>
  );
}

function SponsorField({ error, className = '', children }: { error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${className}`}>
      {children}
      {error && <p className="mt-2 text-xs font-bold uppercase tracking-wider text-brand">{error}</p>}
    </div>
  );
}
