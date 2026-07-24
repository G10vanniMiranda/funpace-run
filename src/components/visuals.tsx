import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react';
import { useRef, useState } from 'react';
import { Flag, MapPin, RotateCcw } from 'lucide-react';
import { Reveal } from './premium';

type CourseId = '5k' | '10k';

type CourseDefinition = {
  id: CourseId;
  selectorLabel: string;
  title: string;
  distance: string;
  start: string;
  finish: string;
  returnPoint?: string;
  diagram: {
    path: string;
    start: { x: number; y: number };
    returnPoint?: { x: number; y: number };
    labels: Array<{
      text: string;
      x: number;
      y: number;
      anchor?: 'start' | 'middle' | 'end';
    }>;
  };
};

const courses: Record<CourseId, CourseDefinition> = {
  '5k': {
    id: '5k',
    selectorLabel: '5 KM',
    title: 'Percurso 5 km',
    distance: '5 km',
    start: 'Complexo Madeira-Mamoré',
    finish: 'Complexo Madeira-Mamoré',
    returnPoint: 'Avenida Imigrantes',
    diagram: {
      path: 'M 16 76 C 24 58 31 45 43 38 C 56 30 69 35 84 22 C 72 41 58 36 45 44 C 33 51 25 63 16 76',
      start: { x: 16, y: 76 },
      returnPoint: { x: 84, y: 22 },
      labels: [
        { text: 'AV. FARQUAR', x: 48, y: 30, anchor: 'middle' },
        { text: 'AV. IMIGRANTES', x: 82, y: 15, anchor: 'end' },
      ],
    },
  },
  '10k': {
    id: '10k',
    selectorLabel: '10 KM',
    title: 'Percurso 10 km',
    distance: '10 km',
    start: 'Complexo Madeira-Mamoré',
    finish: 'Complexo Madeira-Mamoré',
    diagram: {
      path: 'M 16 78 L 22 46 L 42 25 L 70 27 L 84 43 L 70 55 L 82 73 L 61 84 L 43 69 L 28 84 L 16 78',
      start: { x: 16, y: 78 },
      labels: [
        { text: 'AV. FARQUAR', x: 16, y: 39 },
        { text: 'AV. IMIGRANTES', x: 48, y: 19, anchor: 'middle' },
        { text: 'AV. LAURO SODRÉ', x: 84, y: 36, anchor: 'end' },
        { text: 'AV. CALAMA', x: 75, y: 66, anchor: 'middle' },
        { text: 'AV. DUTRA', x: 44, y: 92, anchor: 'middle' },
      ],
    },
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
                    className={`min-h-11 px-4 py-3 font-mono text-xs font-bold tracking-[0.18em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                      isActive
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
                <div>
                  <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-brand">
                    {activeCourse.distance}
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-bold uppercase text-white">
                    {activeCourse.title}
                  </h3>
                </div>

                <div className="space-y-3 border-l border-brand/40 pl-4">
                  <CourseLocation icon={MapPin} label="Largada" value={activeCourse.start} />
                  {activeCourse.returnPoint && (
                    <CourseLocation icon={RotateCcw} label="Retorno" value={activeCourse.returnPoint} />
                  )}
                  <CourseLocation icon={Flag} label="Chegada" value={activeCourse.finish} />
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="premium-card p-4">
                <h4 className="mb-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Postos de Hidratação</h4>
                <p className="font-mono text-xl font-bold text-white">A cada 2,5 km</p>
              </div>
            </div>
          </Reveal>

          <Reveal className="w-full lg:w-[62%]" delay={0.08}>
            <div className="premium-card group relative aspect-4/3 w-full overflow-hidden rounded-sm sm:aspect-video">
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_2px,transparent_2px),linear-gradient(to_bottom,#80808012_2px,transparent_2px)] bg-size-[40px_40px]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(215,255,0,0.08),transparent_58%)]" />

              <AnimatePresence mode="wait">
                <RouteDiagram key={activeCourse.id} course={activeCourse} />
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

function RouteDiagram({ course }: { course: CourseDefinition }) {
  const { diagram } = course;

  return (
    <motion.svg
      className="absolute inset-0 z-10 h-full w-full p-5 sm:p-8"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Representação esquemática do ${course.title}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <defs>
        <filter id={`route-glow-${course.id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {diagram.labels.map((label) => (
        <text
          key={label.text}
          x={label.x}
          y={label.y}
          textAnchor={label.anchor ?? 'start'}
          fill="rgba(255,255,255,0.42)"
          fontSize="2.7"
          fontFamily="JetBrains Mono, monospace"
          fontWeight="700"
          letterSpacing="0.08em"
        >
          {label.text}
        </text>
      ))}

      <motion.path
        d={diagram.path}
        fill="transparent"
        stroke="#d7ff00"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#route-glow-${course.id})`}
        initial={{ pathLength: 0, opacity: 0.4 }}
        animate={{ pathLength: 1, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ pathLength: { duration: 1.35, ease: 'easeInOut' }, opacity: { duration: 0.2 } }}
      />

      <RouteMarker x={diagram.start.x} y={diagram.start.y} label="LARGADA / CHEGADA" align="start" />

      {diagram.returnPoint && (
        <RouteMarker
          x={diagram.returnPoint.x}
          y={diagram.returnPoint.y}
          label="RETORNO"
          align="end"
          variant="return"
        />
      )}
    </motion.svg>
  );
}

function RouteMarker({
  x,
  y,
  label,
  align,
  variant = 'start',
}: {
  x: number;
  y: number;
  label: string;
  align: 'start' | 'end';
  variant?: 'start' | 'return';
}) {
  const labelX = align === 'start' ? x + 3 : x - 3;

  return (
    <motion.g initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.8 }}>
      <circle cx={x} cy={y} r="3.2" fill={variant === 'return' ? '#ffffff' : '#d7ff00'} opacity="0.16" />
      <circle cx={x} cy={y} r="1.45" fill={variant === 'return' ? '#ffffff' : '#d7ff00'} />
      <text
        x={labelX}
        y={y + 0.9}
        textAnchor={align}
        fill={variant === 'return' ? '#ffffff' : '#d7ff00'}
        fontSize="2.6"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        letterSpacing="0.06em"
      >
        {label}
      </text>
    </motion.g>
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
