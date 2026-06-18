import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './premium';

export function CourseMap() {
  return (
    <section id="map" className="relative scroll-mt-24 overflow-hidden border-t border-zinc-900 bg-zinc-950 px-4 py-16 sm:px-6 md:py-24 lg:py-32">
      <div className="premium-aurora opacity-30" />
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-10 lg:flex-row lg:gap-20 xl:gap-24">
        <Reveal className="flex w-full min-w-0 flex-col gap-6 lg:w-1/3">
          <h2 className="font-display text-[clamp(2.8rem,12vw,3.75rem)] font-black uppercase leading-[0.9] tracking-tighter">
            Percurso
          </h2>

          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:mt-6 lg:grid-cols-1 lg:gap-4">
            <div className="premium-card p-4">
              <h4 className="mb-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Postos de Hidratacao</h4>
              <p className="font-mono text-xl font-bold text-white">A cada 2.5km</p>
            </div>
          </div>
        </Reveal>

        <Reveal className="premium-card group relative aspect-[4/3] w-full overflow-hidden rounded-sm sm:aspect-video lg:w-2/3" delay={0.08}>
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_2px,transparent_2px),linear-gradient(to_bottom,#80808012_2px,transparent_2px)] bg-[size:40px_40px]" />
          <div className="absolute left-1/4 top-1/2 z-20 h-4 w-4 rounded-full bg-brand shadow-[0_0_15px_#dfff00]" />

          <svg className="absolute inset-0 z-10 h-full w-full pl-[18%] sm:pl-[25%]" viewBox="0 0 100 100" preserveAspectRatio="none">
            <motion.path
              d="M 5,50 Q 20,20 40,50 T 70,30 T 90,60"
              fill="transparent"
              stroke="#dfff00"
              strokeWidth="0.8"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 2, ease: 'easeInOut' }}
            />
          </svg>

          <div className="absolute bottom-3 left-3 right-3 z-30 border border-white/10 bg-black/80 p-3 backdrop-blur-sm sm:bottom-6 sm:left-auto sm:right-6 sm:p-4">
            <div className="text-xs font-bold uppercase tracking-widest">MAPA OFICIAL EM BREVE</div>
            <a href="#" className="mt-2 flex items-center gap-2 text-xs text-brand hover:underline">
              Download GPX <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </Reveal>
      </div>
    </section >
  );
}

export function Gallery() {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start end', 'end start'],
  });

  const y1 = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 80]);

  const images = [
    'https://images.unsplash.com/photo-1552674605-15cce7039600?auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1530143311094-34d807799e8f?auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&q=80',
  ];

  return (
    <section id="gallery" className="scroll-mt-24 overflow-hidden border-t border-zinc-900 bg-black py-16 md:py-24" ref={containerRef}>
      <Reveal className="mx-auto mb-10 flex max-w-7xl items-end justify-between px-4 sm:px-6 md:mb-16">
        <div>
          <h2 className="font-display text-[clamp(2.8rem,12vw,3.75rem)] font-black uppercase tracking-tighter">ENERGIA FUNPACE</h2>
          <p className="mt-2 max-w-xl font-mono text-xs uppercase leading-relaxed tracking-widest text-zinc-500 sm:text-sm">
            ONDE NINGUÉM SOLTA A MÃO DE NINGUÉM
          </p>
        </div>
      </Reveal>

      <div className="flex h-105 w-full items-center justify-center gap-3 overflow-hidden px-4 sm:h-[520px] md:h-[70vh] md:gap-8 md:px-8 lg:h-[80vh]">
        <motion.div className="flex h-[135%] w-1/2 flex-col gap-3 md:h-[150%] md:w-1/3 md:gap-4" style={{ y: y1 }}>
          <img src={images[0]} alt="Runner" className="h-1/2 w-full object-cover object-center grayscale transition-all duration-500 hover:scale-[1.02] hover:grayscale-0" loading="lazy" decoding="async" />
          <img src={images[1]} alt="Shoes" className="h-1/2 w-full object-cover grayscale transition-all duration-500 hover:scale-[1.02] hover:grayscale-0" loading="lazy" decoding="async" />
        </motion.div>

        <motion.div className="flex h-[135%] w-1/2 flex-col gap-3 md:h-[150%] md:w-1/3 md:gap-4" style={{ y: y2 }}>
          <img src={images[2]} alt="Group running" className="h-[58%] w-full object-cover grayscale transition-all duration-500 hover:scale-[1.02] hover:grayscale-0" loading="lazy" decoding="async" />
          <img src={images[3]} alt="City Runner" className="h-[42%] w-full object-cover object-top grayscale transition-all duration-500 hover:scale-[1.02] hover:grayscale-0" loading="lazy" decoding="async" />
        </motion.div>
      </div>
    </section>
  );
}
