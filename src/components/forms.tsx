import { type FormEvent, useEffect, useState } from 'react';
import { ArrowRight, Zap, Building } from 'lucide-react';
import { eventInfo } from '../config/event';
import { ApiError, createRegistration, getAvailability } from '../lib/api';
import { formatCpf, formatPhone, validateRegistration } from '../lib/validation';
import type { AvailabilityResponse, RegistrationErrors, RegistrationFormData, RaceDistance, Gender, ShirtSize } from '../types/registration';

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

const inputClass = 'w-full bg-zinc-100 p-4 border-b-2 border-black focus:outline-none focus:bg-zinc-200 transition-colors';
const errorClass = 'text-xs font-bold uppercase tracking-wider text-red-700';

export function RegistrationSection() {
  const [status, setStatus] = useState<null | 'submitting' | 'checkout_pending' | 'api_error'>(null);
  const [formData, setFormData] = useState<RegistrationFormData>(initialRegistration);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [apiMessage, setApiMessage] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const activeLot = availability?.lots.find((lot) => lot.status === 'active') || availability?.lots[0];
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
    <section id="register" className="py-32 px-6 bg-brand text-black relative z-20">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24">
        <div className="flex flex-col">
          <h2 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none mb-6">
            Não fique <br/>para trás.
          </h2>
          <p className="font-medium text-lg md:text-xl max-w-md opacity-80 mb-10">
            As vagas do {eventInfo.currentLot} serao liberadas com pagamento online. A vaga so sera garantida apos pagamento aprovado.
          </p>

          <div className="grid grid-cols-2 gap-3 max-w-md mb-8">
            <div className="border border-black/10 bg-black/5 p-4">
              <p className="text-xs font-black uppercase tracking-widest opacity-60">Valor atual</p>
              <p className="font-mono text-2xl font-black">
                {activeLot ? (activeLot.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'A definir'}
              </p>
            </div>
            <div className="border border-black/10 bg-black/5 p-4">
              <p className="text-xs font-black uppercase tracking-widest opacity-60">Vagas lote</p>
              <p className="font-mono text-2xl font-black">{activeLot ? activeLot.remaining : '--'}</p>
            </div>
          </div>

          <div className="bg-black/5 p-6 rounded mb-8 border border-black/10">
            <h3 className="font-black uppercase tracking-widest mb-4">O que inclui o KIT?</h3>
            <ul className="space-y-3 font-medium text-sm">
              {eventInfo.kitItems.map((item) => (
                <li key={item} className="flex items-center gap-3"><Zap className="w-4 h-4" /> {item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="bg-white p-8 md:p-12 shadow-2xl">
          <h3 className="font-display font-black text-3xl uppercase tracking-tighter mb-8">
            Inscrição • {eventInfo.currentLot}
          </h3>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">Nome Completo</label>
                <input
                  required
                  type="text"
                  value={formData.fullName}
                  onChange={(event) => updateField('fullName', event.target.value)}
                  className={inputClass}
                  placeholder="Nome e sobrenome"
                  aria-invalid={Boolean(errors.fullName)}
                />
                {errors.fullName && <p className={errorClass}>{errors.fullName}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">E-mail</label>
                <input
                  required
                  type="email"
                  value={formData.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  className={inputClass}
                  placeholder="voce@email.com"
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email && <p className={errorClass}>{errors.email}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">CPF</label>
                <input
                  required
                  type="text"
                  inputMode="numeric"
                  value={formData.cpf}
                  onChange={(event) => updateField('cpf', formatCpf(event.target.value))}
                  className={inputClass}
                  placeholder="000.000.000-00"
                  aria-invalid={Boolean(errors.cpf)}
                />
                {errors.cpf && <p className={errorClass}>{errors.cpf}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">Telefone / WhatsApp</label>
                <input
                  required
                  type="tel"
                  inputMode="tel"
                  value={formData.phone}
                  onChange={(event) => updateField('phone', formatPhone(event.target.value))}
                  className={inputClass}
                  placeholder="(69) 99999-9999"
                  aria-invalid={Boolean(errors.phone)}
                />
                {errors.phone && <p className={errorClass}>{errors.phone}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">Data de nascimento</label>
                <input
                  required
                  type="date"
                  value={formData.birthDate}
                  onChange={(event) => updateField('birthDate', event.target.value)}
                  className={inputClass}
                  aria-invalid={Boolean(errors.birthDate)}
                />
                {errors.birthDate && <p className={errorClass}>{errors.birthDate}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">Sexo</label>
                <select
                  required
                  value={formData.gender}
                  onChange={(event) => updateField('gender', event.target.value as Gender)}
                  className={`${inputClass} cursor-pointer appearance-none`}
                  aria-invalid={Boolean(errors.gender)}
                >
                  <option value="">Selecione</option>
                  {eventInfo.genderOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {errors.gender && <p className={errorClass}>{errors.gender}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">Distância</label>
                <select
                  value={formData.distance}
                  onChange={(event) => updateField('distance', event.target.value as RaceDistance)}
                  className={`${inputClass} cursor-pointer appearance-none`}
                >
                  {eventInfo.distanceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {selectedDistanceAvailability && (
                  <p className="text-xs font-bold uppercase tracking-wider opacity-60">
                    {selectedDistanceAvailability.remaining} vagas restantes nesta distancia.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">Tamanho da Camisa</label>
                <select
                  value={formData.shirtSize}
                  onChange={(event) => updateField('shirtSize', event.target.value as ShirtSize)}
                  className={`${inputClass} cursor-pointer appearance-none`}
                >
                  {eventInfo.shirtSizes.map((size) => (
                    <option key={size}>{size}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">Contato de emergência</label>
                <input
                  required
                  type="text"
                  value={formData.emergencyContactName}
                  onChange={(event) => updateField('emergencyContactName', event.target.value)}
                  className={inputClass}
                  placeholder="Nome do contato"
                  aria-invalid={Boolean(errors.emergencyContactName)}
                />
                {errors.emergencyContactName && <p className={errorClass}>{errors.emergencyContactName}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest">Telefone de emergência</label>
                <input
                  required
                  type="tel"
                  inputMode="tel"
                  value={formData.emergencyContactPhone}
                  onChange={(event) => updateField('emergencyContactPhone', formatPhone(event.target.value))}
                  className={inputClass}
                  placeholder="(69) 99999-9999"
                  aria-invalid={Boolean(errors.emergencyContactPhone)}
                />
                {errors.emergencyContactPhone && <p className={errorClass}>{errors.emergencyContactPhone}</p>}
              </div>
            </div>

            <div className="space-y-3 border border-black/10 bg-black/5 p-4">
              <label className="flex items-start gap-3 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={formData.termsAccepted}
                  onChange={(event) => updateField('termsAccepted', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-black"
                />
                <span>Li e aceito o termo de responsabilidade da prova.</span>
              </label>
              {errors.termsAccepted && <p className={errorClass}>{errors.termsAccepted}</p>}

              <label className="flex items-start gap-3 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={formData.regulationAccepted}
                  onChange={(event) => updateField('regulationAccepted', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-black"
                />
                <span>Li e aceito o <a href="/regulamento" className="underline">regulamento oficial</a> do FunPace Run.</span>
              </label>
              {errors.regulationAccepted && <p className={errorClass}>{errors.regulationAccepted}</p>}

              <label className="flex items-start gap-3 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={formData.privacyAccepted}
                  onChange={(event) => updateField('privacyAccepted', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-black"
                />
                <span>Autorizo o uso dos meus dados para processar a inscricao, conforme a <a href="/privacidade" className="underline">politica de privacidade</a>.</span>
              </label>
              {errors.privacyAccepted && <p className={errorClass}>{errors.privacyAccepted}</p>}
            </div>

            <button 
              type="submit" 
              disabled={status === 'submitting'}
              className="w-full bg-black text-white hover:bg-zinc-800 transition-colors p-6 font-black uppercase tracking-widest text-sm flex items-center justify-between group mt-4 relative overflow-hidden"
            >
              <span className="relative z-10">
                {status === 'submitting' && 'CRIANDO INSCRICAO'}
                {status === 'checkout_pending' && 'CHECKOUT EM IMPLANTACAO'}
                {status !== 'submitting' && status !== 'checkout_pending' && 'CONTINUAR PARA CHECKOUT'}
              </span>
              <ArrowRight className="w-5 h-5 relative z-10 group-hover:translate-x-2 transition-transform" />
            </button>
            {status === 'checkout_pending' && (
              <p className="border border-black/20 bg-black/5 p-3 text-xs font-bold uppercase tracking-wider">
                {apiMessage} ID: {registrationId}. {eventInfo.offerNote}
              </p>
            )}
            {status === 'api_error' && (
              <p className="border border-red-800 bg-red-100 p-3 text-xs font-bold uppercase tracking-wider text-red-800">
                {apiMessage}
              </p>
            )}
            <p className="text-xs text-center font-medium opacity-60">* O envio ainda nao cria inscricao paga. A confirmacao dependera do gateway e do webhook.</p>
          </form>
        </div>
      </div>
    </section>
  );
}

export function SponsorSection() {
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <section className="py-24 px-6 bg-zinc-950 border-t border-zinc-900 border-b relative">
      <div className="max-w-4xl mx-auto text-center border p-8 md:p-16 border-zinc-800 relative z-10 bg-black/50 backdrop-blur-sm shadow-2xl">
        <Building className="w-12 h-12 text-brand mx-auto mb-6" />
        <h2 className="font-display text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4 text-white">
          Seja um Parceiro
        </h2>
        <p className="text-zinc-400 font-mono text-sm max-w-lg mx-auto mb-10">
          Posicione sua marca em um evento premium focado em performance, saúde e inovação. Preencha os dados e nossa equipe de branding entrará em contato.
        </p>

        <form onSubmit={handleSubmit} className="text-left space-y-6 max-w-2xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <input required type="text" placeholder="Nome da Empresa" className="bg-zinc-900 border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none transition-colors" />
             <input required type="text" placeholder="Seu Nome / Cargo" className="bg-zinc-900 border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none transition-colors" />
             <input required type="email" placeholder="E-mail Corporativo" className="bg-zinc-900 border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none transition-colors md:col-span-2" />
             <textarea 
               required 
               placeholder="Como gostaria de se envolver no evento? (Ex: Patrocínio Master, Ativação Tenda, etc)" 
               rows={4} 
               className="bg-zinc-900 border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none transition-colors md:col-span-2 resize-none" 
             />
          </div>
          <button type="submit" className="w-full bg-white text-black p-4 font-black uppercase tracking-widest hover:bg-brand transition-colors text-sm">
             {success ? 'ENVIADO COM SUCESSO' : 'ENVIAR PROPOSTA'}
          </button>
        </form>
      </div>
      
      {/* Decorative text behind */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full text-center overflow-hidden opacity-5 pointer-events-none select-none z-0">
        <h2 className="font-display font-black text-[15vw] leading-none uppercase whitespace-nowrap">
          SPONSORSHIP
        </h2>
      </div>
    </section>
  );
}
