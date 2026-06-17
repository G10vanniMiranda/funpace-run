import { eventInfo } from '../config/event';
import type { ReactNode } from 'react';

export function PrivacyPage() {
  return (
    <LegalPage title="Politica de privacidade">
      <p>
        Coletamos dados pessoais para processar inscricoes, identificar participantes,
        organizar kits, operar pagamentos, prestar suporte e cumprir obrigacoes legais do evento.
      </p>
      <p>
        Dados tratados: nome, e-mail, CPF, telefone, data de nascimento, sexo, tamanho de camisa,
        distancia escolhida, contato de emergencia, aceites legais, status de pagamento e historico operacional.
      </p>
      <p>
        O acesso administrativo deve ser restrito a pessoas autorizadas pela organizacao. Exportacoes devem ser
        usadas apenas para operacao da corrida e armazenadas com cuidado.
      </p>
      <p>
        Solicitacoes relacionadas a privacidade, acesso, correcao ou exclusao de dados podem ser enviadas para
        {' '}<a href={`mailto:${eventInfo.contactEmail}`} className="text-brand underline">{eventInfo.contactEmail}</a>.
      </p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Regulamento e responsabilidade">
      <p>
        A inscricao so sera considerada confirmada apos pagamento aprovado pelo gateway e confirmacao do sistema.
      </p>
      <p>
        O participante declara estar apto fisicamente para participar da prova, conhecer os riscos de uma corrida
        de rua e seguir as orientacoes da organizacao, equipe medica e autoridades locais.
      </p>
      <p>
        O regulamento final deve informar retirada de kit, idade minima, categorias, politica de reembolso,
        transferencia, alteracao de distancia, uso de imagem, largada, premiacao e motivos de cancelamento.
      </p>
      <p>
        Esta pagina e uma base operacional. Antes da abertura oficial de vendas, o texto final deve ser validado
        pela organizacao e, idealmente, por assessoria juridica.
      </p>
      <p>
        Duvidas sobre inscricao, regulamento ou atendimento podem ser enviadas para
        {' '}<a href={`mailto:${eventInfo.contactEmail}`} className="text-brand underline">{eventInfo.contactEmail}</a>.
      </p>
    </LegalPage>
  );
}

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-black px-4 py-12 text-white sm:px-6 md:py-20">
      <article className="mx-auto max-w-4xl border border-zinc-800 bg-zinc-950 p-5 sm:p-8 md:p-12">
        <p className="text-brand font-bold uppercase tracking-widest text-xs mb-4">FunPace Run</p>
        <h1 className="mb-8 font-display text-[clamp(2.6rem,12vw,4.5rem)] font-black uppercase leading-none tracking-tighter md:mb-10">
          {title}
        </h1>
        <div className="space-y-6 text-zinc-300 font-mono text-sm leading-relaxed">
          {children}
        </div>
        <a href="/" className="mt-10 inline-flex min-h-12 items-center bg-brand px-5 py-3 text-sm font-black uppercase tracking-widest text-black sm:px-6 sm:py-4">
          Voltar
        </a>
      </article>
    </main>
  );
}
