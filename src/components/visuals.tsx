import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useRef, useState } from 'react';
import { CornerDownRight, Flag, MapPin } from 'lucide-react';
import { RoutePath } from './percurso/RoutePath';
import type { KmlRoute } from './percurso/routeGeometry';
import { route10km } from './percurso/route10km';
import { route5km } from './percurso/route5km';
import { Reveal } from './premium';

type CourseId = '5k' | '10k';

type CourseDefinition = {
  id: CourseId;
  selectorLabel: string;
  description?: {
    title: string;
    steps: string[];
  };
  route: KmlRoute;
};

const courses: Record<CourseId, CourseDefinition> = {
  '5k': {
    id: '5k',
    selectorLabel: '5 KM',
    description: {
      title: '',
      steps: [
        'Saída do Complexo Madeira-Mamoré',
        'Av. Farquar',
        'Retorno na Av. Imigrantes',
        'Av. Farquar',
        'Finaliza no Complexo',
      ],
    },
    route: route5km,
  },
  '10k': {
    id: '10k',
    selectorLabel: '10 KM',
    description: {
      title: '',
      steps: [
        'Saída do Complexo Madeira-Mamoré',
        'Av. Farquar',
        'Av. Imigrantes',
        'Av. Lauro Sodré',
        'Av. Calama',
        'Rua Jamary',
        'Av. Imigrantes',
        'Av. Lauro Sodré',
        'Rua José Camacho',
        'Av. Presidente Dutra',
        'Rua Padre Chiquinho',
        'Av.Farquar',
        'Finaliza no Complexo',
      ],
    },
    route: route10km,
  },
};

export function CourseMap() {
  const [activeCourseId, setActiveCourseId] = useState<CourseId>('5k');
  const reducedMotion = useReducedMotion();
  const activeCourse = courses[activeCourseId];

  return (
    <section id="map" className="relative scroll-mt-24 overflow-hidden border-t border-zinc-900 bg-zinc-950 px-4 py-16 sm:px-6 md:py-24 lg:py-32">
      <div className="premium-aurora opacity-30" />
      <div className="relative mx-auto max-w-7xl">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:gap-x-14 lg:gap-y-6 xl:gap-x-20">
          <Reveal className="flex w-full min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
            <h2 className="font-display text-[clamp(2.8rem,12vw,3.75rem)] font-black uppercase leading-[0.9] tracking-tighter">
              Percurso
            </h2>

            <div
              className="grid grid-cols-2 gap-1 border border-white/10 bg-black/40 p-1"
              role="group"
              aria-label="Selecionar percurso"
            >
              {(Object.keys(courses) as CourseId[]).map((courseId) => {
                const course = courses[courseId];
                const isActive = courseId === activeCourseId;

                return (
                  <button
                    key={course.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveCourseId(courseId)}
                    className={`min-h-11 px-4 py-3 font-mono text-xs font-bold tracking-[0.18em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${isActive
                      ? 'bg-brand text-black shadow-[0_0_24px_rgba(215,255,0,0.16)]'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                      }`}
                  >
                    {course.selectorLabel}
                  </button>
                );
              })}
            </div>

          </Reveal>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeCourse.id}
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: reducedMotion ? 0 : 0.22 }}
              className="order-3 w-full space-y-4 lg:order-0 lg:col-start-1 lg:row-start-2"
              aria-live="polite"
            >
              {activeCourse.description ? (
                <div className="border-l border-brand/50 bg-black/20 py-1 pl-4">
                  {activeCourse.description.title ? (
                    <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
                      {activeCourse.description.title}
                    </p>
                  ) : null}
                  <ul className="space-y-3">
                    {activeCourse.description.steps.map((step, index) => {
                      const isFirstStep = index === 0;
                      const isLastStep = index === activeCourse.description!.steps.length - 1;
                      const StepIcon = isFirstStep ? MapPin : isLastStep ? Flag : CornerDownRight;

                      return (
                        <li key={`${index}-${step}`} className="flex items-start gap-3">
                          <StepIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                          <div>
                            {isFirstStep || isLastStep ? (
                              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                                {isFirstStep ? 'Largada' : 'Chegada'}
                              </p>
                            ) : null}
                            <p className={`${isFirstStep || isLastStep ? 'mt-0.5 font-semibold text-zinc-200' : 'text-zinc-300'} text-sm leading-relaxed`}>
                              {step}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          <Reveal className="order-2 w-full lg:order-0 lg:col-start-2 lg:row-span-2 lg:row-start-1" delay={0.08}>
            <div className="route-map-panel relative aspect-4/3 w-full overflow-hidden sm:aspect-video">
              <AnimatePresence initial={false}>
                <RoutePath key={activeCourse.id} route={activeCourse.route} />
              </AnimatePresence>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Gallery() {
  const containerRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start end', 'end start'],
  });

  const y1 = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 80]);

  const images = [
    '/gallery/runner-1.webp',
    '/gallery/runner-2.webp',
    '/gallery/runner-3.webp',
    '/gallery/runner-4.webp',
  ];

  return (
    <section id="gallery" className="scroll-mt-24 overflow-hidden border-t border-zinc-900 bg-black py-16 md:py-24" ref={containerRef}>
      <Reveal className="mx-auto mb-10 flex max-w-7xl items-end justify-between px-4 sm:px-6 md:mb-16">
        <div>
          <h2 className="font-display text-[clamp(2.8rem,12vw,3.75rem)] font-black uppercase tracking-tighter">LEVE, JUNTO E FUN</h2>
        </div>
      </Reveal>

      <div className="flex h-105 w-full items-center justify-center gap-3 overflow-hidden px-4 sm:h-130 md:h-[70vh] md:gap-8 md:px-8 lg:h-[80vh]">
        <motion.div className="flex h-[135%] w-1/2 flex-col gap-3 md:h-[150%] md:w-1/3 md:gap-4" style={reducedMotion ? undefined : { y: y1 }}>
          <img src={images[0]} alt="Runner" className="gallery-image h-1/2 w-full object-cover object-center grayscale transition-all duration-500 hover:scale-[1.02] hover:grayscale-0" loading="lazy" decoding="async" />
          <img src={images[1]} alt="Shoes" className="gallery-image h-1/2 w-full object-cover grayscale transition-all duration-500 hover:scale-[1.02] hover:grayscale-0" loading="lazy" decoding="async" />
        </motion.div>

        <motion.div className="flex h-[135%] w-1/2 flex-col gap-3 md:h-[150%] md:w-1/3 md:gap-4" style={reducedMotion ? undefined : { y: y2 }}>
          <img src={images[2]} alt="Group running" className="gallery-image h-[58%] w-full object-cover grayscale transition-all duration-500 hover:scale-[1.02] hover:grayscale-0" loading="lazy" decoding="async" />
          <img src={images[3]} alt="City Runner" className="gallery-image h-[42%] w-full object-cover object-top grayscale transition-all duration-500 hover:scale-[1.02] hover:grayscale-0" loading="lazy" decoding="async" />
        </motion.div>
      </div>
    </section>
  );
}
