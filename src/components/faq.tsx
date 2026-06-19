import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Reveal } from './premium';

const faqs = [
  {
    question: 'Posso alterar minha distancia apos a inscrição?',
    answer: 'Sim. A alteração de distancia pode ser feita gratuitamente através do seu painel de corredor ate 15 dias antes da prova. Alteracoes de lote poderao sofrer cobranca da diferenca de valor.',
  },
  {
    question: 'Onde e quando sera a retirada dos kits?',
    answer: 'A retirada dos kits do Lote 1 acontecera nos dias 10 e 11 de Setembro, na Running Store Oficial em Porto Velho. O local exato e horarios serao enviados por email com antecedencia.',
  },
  {
    question: 'Teremos guarda-volumes no local da prova?',
    answer: 'Sim. Havera um complexo de guarda-volumes organizado e seguro na arena do evento, abrindo as 05:00 AM e fechando 1h apos a chegada do ultimo atleta.',
  },
  {
    question: 'Existem blocos de largada baseados no pace?',
    answer: 'Absolutamente. Ao se inscrever, voce seleciona seu pace estimado, e entregaremos as pulseiras de pelotao no kit para garantir uma largada fluida e focada em performance.',
  },
  {
    question: 'A corrida acontece se chover?',
    answer: "Sim. A Funpace Run e uma prova 'No Excuses'. O evento ocorre sob chuva, desde que nao haja risco de seguranca estrutural aos participantes avaliado pelos orgaos oficiais.",
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-4xl scroll-mt-24 border-t border-zinc-900 px-4 py-16 sm:px-6 md:py-24">
      <Reveal className="mb-10 md:mb-16">
        <p className="mt-4 border-b border-zinc-800 pb-6 font-mono text-xs uppercase leading-relaxed tracking-widest text-zinc-500 sm:text-sm md:pb-8">
          Tire suas dúvidas antes de ir para a pista.
        </p>
      </Reveal>

      <Reveal className="premium-card flex flex-col border-white/10">
        {faqs.map((faq, index) => {
          const isOpen = openIndex === index;

          return (
            <div key={faq.question} className="border-b border-white/10 last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="flex w-full items-center justify-between gap-4 px-4 py-5 text-left transition-colors hover:bg-white/3 hover:text-brand sm:px-6 sm:py-6"
              >
                <span className="min-w-0 pr-2 text-base font-bold leading-snug sm:text-lg md:text-xl">{faq.question}</span>
                <ChevronDown className={`h-6 w-6 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-brand' : 'text-zinc-500'}`} />
              </button>
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <p className="px-4 pb-6 pr-2 font-mono text-sm leading-relaxed text-zinc-400 sm:px-6 sm:pr-12 md:pb-8">
                      {faq.answer}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </Reveal>
    </section>
  );
}
