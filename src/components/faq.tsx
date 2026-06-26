import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Reveal } from './premium';

const faqs = [
  {
    question: 'Posso alterar minha distância após a inscrição?',
    answer: 'Não. Após a confirmação da inscrição, não é possível alterar a distância escolhida. A definição da distância faz parte do planejamento técnico do evento, incluindo controle de vagas, kits, estrutura operacional e segurança dos atletas. Por isso, alterações de percurso após a conclusão da inscrição não são permitidas. Recomendamos que o participante confira cuidadosamente a distância desejada antes de finalizar a inscrição.',
  },
  {
    question: 'Onde e quando será a retirada dos kits?',
    answer: 'O local, a data e o horário para a retirada dos kits serão divulgados aproximadamente 1 semana antes do evento. Todas as informações oficiais serão publicadas em nossos canais de comunicação e enviadas aos atletas inscritos. Fique atento ao seu e-mail e às redes sociais da FunPace para acompanhar as atualizações.',
  },
  {
    question: 'Teremos guarda-volumes no local da prova?',
    answer: 'Não. O evento não contará com serviço de guarda-volumes. Recomendamos que os participantes levem apenas itens essenciais para a prova e evitem portar objetos de valor. A organização não se responsabiliza por pertences deixados no local do evento.',
  },
  {
    question: 'Posso transferir minha inscrição para outra pessoa?',
    answer: 'Não. As inscrições são pessoais e intransferíveis. Por questões de segurança, organização do evento, controle de resultados, seguro do atleta e responsabilidade da organização, não é permitida a troca de titularidade da inscrição. Caso o atleta inscrito não possa participar da prova, a inscrição não poderá ser utilizada por outra pessoa, mesmo que haja venda, doação ou qualquer outro tipo de transferência. Participantes que correrem utilizando a inscrição de terceiros poderão ser desclassificados, não terão direito à premiação e poderão ser impedidos de participar de futuras edições do evento. Recomendamos que, antes de concluir a inscrição, o participante tenha certeza de que poderá comparecer na data da prova.',
  },
  {
    question: 'A corrida acontece se chover?',
    answer: "Sim. A Funpace Run é uma prova 'No Excuses'. O evento ocorre sob chuva, desde que não haja risco de seguranca estrutural aos participantes avaliado pelos orgãos oficiais.",
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
