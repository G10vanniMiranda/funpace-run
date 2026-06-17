import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ArrowRight, Building, Zap } from 'lucide-react';
import { eventInfo } from '../config/event';
import { ApiError, createRegistration, getAvailability } from '../lib/api';
import { formatCpf, formatPhone, validateRegistration } from '../lib/validation';
import type { AvailabilityResponse, Gender, RaceDistance, RegistrationErrors, RegistrationFormData, ShirtSize } from '../types/registration';

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

const inputClass = 'w-full min-w-0 bg-zinc-100 p-3.5 sm:p-4 border-b-2 border-black focus:outline-none focus:bg-zinc-200 transition-colors text-sm sm:text-base';
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
  const lotRemaining = activeLot?.remaining ?? eventInfo.currentLotCapacity;
  const selectedDistanceAvailability = availability?.distances.find((distance) => distance.name === formData.distance);

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
        <div className="flex min-w-0 flex-col">
          <h2 className="mb-5 font-display text-[clamp(2.8rem,13vw,4.5rem)] font-black uppercase leading-none tracking-tighter md:mb-6">
            Não fique <br />para trás.
          </h2>
          <p className="mb-8 max-w-md text-base font-medium leading-relaxed opacity-80 sm:text-lg md:mb-10 md:text-xl">
            As vagas do {eventInfo.currentLot} serao liberadas com pagamento online. A vaga so sera garantida apos pagamento aprovado.
          </p>

          <div className="mb-6 grid max-w-md grid-cols-2 gap-3 sm:mb-8">
            <div className="min-w-0 border border-black/10 bg-black/5 p-3.5 sm:p-4">
              <p className="text-[11px] font-black uppercase tracking-widest opacity-60 sm:text-xs">Valor atual</p>
              <p className="mt-1 font-mono text-[clamp(1.25rem,6vw,1.5rem)] font-black">
                {(lotPriceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
            </div>
            <div className="min-w-0 border border-black/10 bg-black/5 p-3.5 sm:p-4">
              <p className="text-[11px] font-black uppercase tracking-widest opacity-60 sm:text-xs">Vagas lote</p>
              <p className="mt-1 font-mono text-[clamp(1.25rem,6vw,1.5rem)] font-black">
                {lotRemaining}
              </p>
            </div>
          </div>

          <div className="mb-8 rounded border border-black/10 bg-black/5 p-4 sm:p-6">
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
        </div>

        <div className="min-w-0 bg-white p-4 pt-7 shadow-2xl sm:p-6 sm:pt-8 md:p-8 md:pt-10 xl:p-12">
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
              <Field label="Distancia">
                <select value={formData.distance} onChange={(event) => updateField('distance', event.target.value as RaceDistance)} className={`${inputClass} cursor-pointer appearance-none`}>
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
              <Field label="Tamanho da Camisa">
                <select value={formData.shirtSize} onChange={(event) => updateField('shirtSize', event.target.value as ShirtSize)} className={`${inputClass} cursor-pointer appearance-none`}>
                  {eventInfo.shirtSizes.map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </Field>
              <Field label="Contato de emergencia" error={errors.emergencyContactName}>
                <input required type="text" value={formData.emergencyContactName} onChange={(event) => updateField('emergencyContactName', event.target.value)} className={inputClass} placeholder="Nome do contato" aria-invalid={Boolean(errors.emergencyContactName)} />
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
              disabled={status === 'submitting'}
              className="group relative mt-4 flex min-h-14 w-full items-center justify-center gap-3 overflow-hidden bg-black p-4 text-center text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-zinc-800 disabled:opacity-70 sm:justify-between sm:p-6 sm:text-sm"
            >
              <span className="relative z-10 min-w-0">
                {status === 'submitting' && 'CRIANDO INSCRICAO'}
                {status === 'checkout_pending' && 'CHECKOUT EM IMPLANTACAO'}
                {status !== 'submitting' && status !== 'checkout_pending' && 'CONTINUAR PARA CHECKOUT'}
              </span>
              <ArrowRight className="relative z-10 h-5 w-5 shrink-0 transition-transform group-hover:translate-x-2" />
            </button>

            {status === 'checkout_pending' && (
              <p className="border border-black/20 bg-black/5 p-3 text-xs font-bold uppercase leading-relaxed tracking-wider">
                {apiMessage} ID: {registrationId}. {eventInfo.offerNote}
              </p>
            )}
            {status === 'api_error' && (
              <p className="border border-red-800 bg-red-100 p-3 text-xs font-bold uppercase leading-relaxed tracking-wider text-red-800">
                {apiMessage}
              </p>
            )}
            <p className="text-center text-xs font-medium leading-relaxed opacity-60">
              * O envio ainda nao cria inscricao paga. A confirmacao dependera do gateway e do webhook.
            </p>
          </form>
        </div>
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

export function SponsorSection() {
  const [success, setSuccess] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <section className="relative border-y border-zinc-900 bg-zinc-950 px-4 py-16 sm:px-6 md:py-24">
      <div className="relative z-10 mx-auto max-w-4xl border border-zinc-800 bg-black/50 p-5 text-center shadow-2xl backdrop-blur-sm sm:p-8 md:p-16">
        <Building className="mx-auto mb-6 h-12 w-12 text-brand" />
        <h2 className="mb-4 font-display text-[clamp(2.4rem,10vw,3rem)] font-black uppercase leading-none tracking-tighter text-white">
          Seja um Parceiro
        </h2>
        <p className="mx-auto mb-8 max-w-lg font-mono text-sm leading-relaxed text-zinc-400 md:mb-10">
          Posicione sua marca em um evento premium focado em performance, saude e inovacao. Preencha os dados e nossa equipe de branding entrara em contato.
        </p>

        <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-5 text-left sm:space-y-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
            <input required type="text" placeholder="Nome da Empresa" className="bg-zinc-900 border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none transition-colors" />
            <input required type="text" placeholder="Seu Nome / Cargo" className="bg-zinc-900 border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none transition-colors" />
            <input required type="email" placeholder="E-mail Corporativo" className="bg-zinc-900 border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none transition-colors md:col-span-2" />
            <textarea
              required
              placeholder="Como gostaria de se envolver no evento? (Ex: Patrocinio Master, Ativacao Tenda, etc)"
              rows={4}
              className="bg-zinc-900 border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none transition-colors md:col-span-2 resize-none"
            />
          </div>
          <button type="submit" className="min-h-14 w-full bg-white p-4 text-sm font-black uppercase tracking-widest text-black transition-colors hover:bg-brand">
            {success ? 'ENVIADO COM SUCESSO' : 'ENVIAR PROPOSTA'}
          </button>
        </form>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 w-full -translate-x-1/2 -translate-y-1/2 select-none overflow-hidden text-center opacity-5">
        <h2 className="whitespace-nowrap font-display text-[15vw] font-black uppercase leading-none">
          SPONSORSHIP
        </h2>
      </div>
    </section>
  );
}
