import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react';
import { useRef, useState } from 'react';
import { Flag, MapPin, RotateCcw } from 'lucide-react';
import { RoutePath } from './percurso/RoutePath';
import type { KmlRoute } from './percurso/routeGeometry';
import { route10km } from './percurso/route10km';
import { route5km } from './percurso/route5km';
import { Reveal } from './premium';

type CourseId = '5k' | '10k';

type CourseDefinition = {
  id: CourseId;
  selectorLabel: string;
  start: string;
  finish: string;
  returnPoint?: string;
  route: KmlRoute;
};

const courses: Record<CourseId, CourseDefinition> = {
  '5k': {
    id: '5k',
    selectorLabel: '5 KM',
    start: 'Complexo Madeira-Mamoré',
    finish: 'Complexo Madeira-Mamoré',
    returnPoint: 'Avenida Imigrantes',
    route: route5km,
  },
  '10k': {
    id: '10k',
    selectorLabel: '10 KM',
    start: 'Complexo Madeira-Mamoré',
    finish: 'Complexo Madeira-Mamoré',
    route: route10km,
  },
};

export function CourseMap() {
  const [activeCourseId, setActiveCourseId] = useState<CourseId>('5k');
  const activeCourse = courses[activeCourseId];

  return (
    <section id="map" className="relative scroll-mt-24 overflow-hidden border-t border-zinc-900 bg-zinc-950 px-4 py-16 sm:px-6 md:py-24 lg:py-32">
      <div className="premium-aurora opacity-30" />
      <div className="relative mx-auto max-w-7xl">
        <div className="flex flex-col items-start gap-10 lg:flex-row lg:gap-14 xl:gap-20">
          <Reveal className="flex w-full min-w-0 flex-col gap-6 lg:w-[38%]">
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

            <AnimatePresence mode="wait">
              <motion.div
                key={activeCourse.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
                className="space-y-4"
                aria-live="polite"
              >
                <div className="space-y-3 border-l border-brand/40 pl-4">
                  <CourseLocation icon={MapPin} label="Largada" value={activeCourse.start} />
                  {activeCourse.returnPoint && (
                    <CourseLocation icon={RotateCcw} label="Retorno" value={activeCourse.returnPoint} />
                  )}
                  <CourseLocation icon={Flag} label="Chegada" value={activeCourse.finish} />
                </div>
              </motion.div>
            </AnimatePresence>

          </Reveal>

          <Reveal className="w-full lg:w-[62%]" delay={0.08}>
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

function CourseLocation({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-zinc-200">{value}</p>
      </div>
    </div>
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
    '/gallery/runner-1.webp',
    '/gallery/runner-2.webp',
    '/gallery/runner-3.webp',
    '/gallery/runner-4.webp',
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

      <div className="flex h-105 w-full items-center justify-center gap-3 overflow-hidden px-4 sm:h-130 md:h-[70vh] md:gap-8 md:px-8 lg:h-[80vh]">
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
