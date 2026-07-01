import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Calendar, Clock, MapPin } from 'lucide-react';
import { eventInfo } from '../config/event';

function Countdown() {
  const reducedMotion = useReducedMotion();
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    const targetDate = new Date(eventInfo.startsAt);

    const interval = setInterval(() => {
      const now = new Date();
      const difference = targetDate.getTime() - now.getTime();

      if (difference > 0) {
        setTimeLeft({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((difference / 1000 / 60) % 60),
          seconds: Math.floor((difference / 1000) % 60),
        });
      } else {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const timeBlocks = [
    { label: 'DIAS', value: timeLeft.days },
    { label: 'HORAS', value: timeLeft.hours },
    { label: 'MINUTOS', value: timeLeft.minutes },
    { label: 'SEGUNDOS', value: timeLeft.seconds },
  ];

  return (
    <div className="isolate mt-8 grid w-full max-w-88 grid-cols-4 gap-2 sm:max-w-none sm:flex md:mt-12">
      {timeBlocks.map((block, index) => (
        <motion.div
          key={block.label}
          className="flex min-w-0 flex-col"
          initial={reducedMotion ? false : { opacity: 0, y: 14 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.72 + index * 0.06, ease: 'easeOut' }}
        >
          <div className="premium-counter flex aspect-square w-full min-w-0 items-center justify-center rounded border border-white/10 font-mono text-[clamp(1.25rem,8vw,2rem)] font-bold text-white sm:h-20 sm:w-20 md:h-24 md:w-24 md:text-5xl">
            {block.value.toString().padStart(2, '0')}
          </div>
          <span className="mt-2 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500 sm:text-[10px] md:text-xs md:tracking-widest">
            {block.label}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

export function Hero() {
  const reducedMotion = useReducedMotion();
  const heroItems = [
    { icon: Calendar, label: 'Data', value: eventInfo.dateLabel },
    { icon: Clock, label: 'Largada', value: `${eventInfo.startTimeLabel} - ${eventInfo.distances.join(' / ')}` },
    { icon: MapPin, label: 'Local', value: eventInfo.locationLabel },
  ];

  return (
    <section className="relative flex min-h-svh flex-col justify-center overflow-hidden px-4 pb-12 pt-16 sm:px-6 sm:pb-16 sm:pt-20 md:min-h-[92svh] md:justify-end md:pb-24">
      <div className="premium-aurora" />
      <div className="premium-grid" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_18%,rgba(215,255,0,0.14),transparent_24rem),linear-gradient(to_bottom,transparent,rgba(0,0,0,0.78))]" />
      <div className="technical-line left-[6%] top-[28%] w-[34vw]" />
      <div className="technical-line right-[8%] top-[62%] w-[24vw] [animation-delay:1.4s]" />
      <div className="pointer-events-none absolute -right-48 top-24 h-[min(72vw,740px)] w-[min(72vw,740px)] rounded-full border border-brand/15 shadow-[0_0_120px_rgba(215,255,0,0.08)]" />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-start overflow-visible">
        <motion.h1
          className="max-w-[calc(100vw-2rem)] overflow-visible px-1 py-2 font-display text-[clamp(2.75rem,11.6vw,7.5rem)] font-black uppercase leading-[0.9] tracking-tighter text-white sm:max-w-[calc(100vw-3rem)] sm:text-[clamp(4.25rem,8vw,8.75rem)] md:leading-[0.86]"
          initial={reducedMotion ? false : { opacity: 0, y: 50 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
        >
          FUNPACE <br />
          <span className="text-black [-webkit-text-stroke:1px_white] drop-shadow-[0_0_28px_rgba(255,255,255,0.08)] sm:[-webkit-text-stroke:2px_white]">
            <span className="block">RUN</span>
            <span className="block text-[0.78em] sm:text-[0.72em] xl:text-[0.84em]">EXPERIENCE</span>
          </span>
        </motion.h1>

        <motion.div
          className="mt-7 flex w-full max-w-3xl flex-col gap-4 sm:mt-8 sm:flex-row sm:items-center"
          initial={reducedMotion ? false : { opacity: 0, y: 24 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: 'easeOut' }}
        >
          <a
            href="#register"
            className="premium-button flex min-h-14 w-full items-center justify-center gap-3 bg-brand px-5 py-4 text-center text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-white sm:w-auto sm:justify-start sm:px-6 sm:text-sm"
          >
            <span>Garantir inscricao - {eventInfo.currentLot}</span>
            <ArrowRight className="h-5 w-5 shrink-0" />
          </a>
        </motion.div>

        <motion.div
          className="mt-9 grid w-full max-w-4xl grid-cols-1 gap-3 border-t border-white/10 pt-7 sm:grid-cols-2 md:mt-12 md:grid-cols-3 md:gap-4 md:pt-8"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={reducedMotion ? undefined : { opacity: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          {heroItems.map(({ icon: Icon, label, value }, index) => (
            <motion.div
              key={label}
              className="premium-card flex min-w-0 gap-4 p-4 sm:col-span-1"
              initial={reducedMotion ? false : { opacity: 0, y: 16 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.48 + index * 0.08, ease: 'easeOut' }}
            >
              <Icon className="h-6 w-6 shrink-0 text-brand" />
              <div className="min-w-0">
                <div className="text-sm font-bold uppercase tracking-widest text-white">{label}</div>
                <div className="mt-1 font-mono text-sm text-zinc-400 sm:text-base">{value}</div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          className="w-full"
          initial={reducedMotion ? false : { opacity: 0, y: 20 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.7 }}
        >
          <Countdown />
        </motion.div>
      </div>
    </section>
  );
}
