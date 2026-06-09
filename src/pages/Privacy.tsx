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
        Para producao, defina canal oficial para solicitacoes LGPD, prazo de retencao, operador de pagamento,
        encarregado/responsavel e politica de descarte apos o evento.
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
    </LegalPage>
  );
}

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-20">
      <article className="max-w-4xl mx-auto border border-zinc-800 bg-zinc-950 p-8 md:p-12">
        <p className="text-brand font-bold uppercase tracking-widest text-xs mb-4">FunPace Run</p>
        <h1 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none mb-10">
          {title}
        </h1>
        <div className="space-y-6 text-zinc-300 font-mono text-sm leading-relaxed">
          {children}
        </div>
        <a href="/" className="inline-flex mt-10 bg-brand text-black px-6 py-4 font-black uppercase tracking-widest text-sm">
          Voltar
        </a>
      </article>
    </main>
  );
}
import type { ReactNode } from 'react';
