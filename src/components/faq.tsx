import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const faqs = [
  {
    question: "Posso alterar minha distância após a inscrição?",
    answer: "Sim. A alteração de distância pode ser feita gratuitamente através do seu painel de corredor até 15 dias antes da prova. Alterações de Lote (ex: 5k para 10k) poderão sofrer cobrança da diferença de valor."
  },
  {
    question: "Onde e quando será a retirada dos kits?",
    answer: "A retirada dos kits do Lote 1 acontecerá nos dias 10 e 11 de Setembro, na Running Store Oficial em Porto Velho. O local exato e horários serão enviados por email com antecedência."
  },
  {
    question: "Teremos guarda-volumes no local da prova?",
    answer: "Sim! Haverá um complexo de guarda-volumes organizado e seguro na arena do evento, abrindo às 05:00 AM e fechando 1h após a chegada do último atleta."
  },
  {
    question: "Existem blocos (pelotões) de largada baseados no pace?",
    answer: "Absolutamente. Ao se inscrever, você seleciona seu pace estimado, e entregaremos as pulseiras de pelotão no kit para garantir uma largada fluida e focada em performance."
  },
  {
    question: "A corrida acontece se chover?",
    answer: "Sim. A Funpace Run é uma prova 'No Excuses'. O evento ocorre sob chuva, desde que não haja risco de segurança estrutural aos participantes avaliado pelos órgãos oficiais."
  }
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-24 px-6 max-w-4xl mx-auto border-t border-zinc-900">
      <div className="mb-16">
        <h2 className="font-display text-5xl md:text-6xl font-black uppercase tracking-tighter">
          INTEL. <span className="text-zinc-700">(FAQ)</span>
        </h2>
        <p className="text-zinc-500 font-mono text-sm mt-4 uppercase tracking-widest border-b border-zinc-800 pb-8">
          Tire suas dúvidas antes de ir para a pista.
        </p>
      </div>

      <div className="flex flex-col border-t border-zinc-800">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div key={idx} className="border-b border-zinc-800">
              <button 
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full py-6 flex justify-between items-center text-left hover:text-brand transition-colors"
              >
                <span className="font-bold text-lg md:text-xl pr-8">{faq.question}</span>
                <ChevronDown className={`w-6 h-6 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-brand' : 'text-zinc-500'}`} />
              </button>
              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <p className="pb-8 text-zinc-400 font-mono text-sm leading-relaxed pr-12">
                      {faq.answer}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
