import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Calendar, Clock, MapPin } from 'lucide-react';
import { eventInfo } from '../config/event';

function Countdown() {
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
    <div className="mt-8 grid w-full max-w-88 grid-cols-4 gap-2 isolate sm:max-w-none sm:flex md:mt-12">
      {timeBlocks.map((block) => (
        <div key={block.label} className="flex min-w-0 flex-col">
          <div className="flex aspect-square w-full min-w-0 items-center justify-center rounded border border-zinc-800 bg-zinc-900 font-mono text-[clamp(1.25rem,8vw,2rem)] font-bold text-white sm:h-20 sm:w-20 md:h-24 md:w-24 md:text-5xl">
            {block.value.toString().padStart(2, '0')}
          </div>
          <span className="mt-2 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500 sm:text-[10px] md:text-xs md:tracking-widest">
            {block.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative flex min-h-190 flex-col justify-end overflow-hidden px-4 pb-14 pt-28 sm:min-h-205 sm:px-6 sm:pb-20 md:min-h-[92svh] md:pb-28">
      <div className="pointer-events-none absolute right-0 top-0 h-full w-full select-none overflow-hidden opacity-30 sm:w-2/3">
        <div className="absolute -right-1/3 top-32 h-[min(74vw,800px)] w-[min(74vw,800px)] rounded-full border border-brand/20 blur-[1px] sm:top-1/4" />
        <div className="absolute -right-1/2 top-44 h-[min(74vw,800px)] w-[min(74vw,800px)] rounded-full border border-brand/10 blur-[2px] sm:top-1/3" />
      </div>

      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-size-[24px_24px]" />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-start">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="mb-5 flex max-w-full items-center gap-3 text-brand sm:gap-4 md:mb-10"
        >
          <div className="h-0.5 w-8 shrink-0 bg-brand sm:w-12" />
          <span className="min-w-0 text-xs font-bold uppercase tracking-widest sm:text-sm md:text-base">
            {eventInfo.edition} - {eventInfo.city}
          </span>
        </motion.div>

        <motion.h1
          className="ml-[-0.04em] max-w-full font-display text-[clamp(3.7rem,18vw,12rem)] font-black uppercase leading-[0.82] tracking-tighter text-white mix-blend-exclusion sm:text-[clamp(5.8rem,12vw,12rem)]"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: 'easeOut' }}
        >
          FUNPACE<br />
          <span className="text-zinc-800 [-webkit-text-stroke:1px_white] sm:[-webkit-text-stroke:2px_white]">
            RUN 2026
          </span>
        </motion.h1>

        <motion.div
          className="mt-7 flex w-full max-w-3xl flex-col gap-4 sm:mt-8 sm:flex-row sm:items-center"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: 'easeOut' }}
        >
          <a
            href="#register"
            className="flex min-h-14 w-full items-center justify-center gap-3 bg-brand px-5 py-4 text-center text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-white sm:w-auto sm:justify-start sm:px-6 sm:text-sm"
          >
            <span>Garantir inscricao - {eventInfo.currentLot}</span>
            <ArrowRight className="h-5 w-5 shrink-0" />
          </a>
          <p className="max-w-md font-mono text-sm leading-relaxed text-zinc-300 md:text-base">
            Corrida oficial FunPace com {eventInfo.distances.join(' e ')}, kit atleta, chip e medalha finisher.
          </p>
        </motion.div>

        <motion.div
          className="mt-9 grid w-full max-w-4xl grid-cols-1 gap-6 border-t border-zinc-800 pt-7 sm:grid-cols-2 md:mt-12 md:grid-cols-3 md:gap-10 md:pt-8 lg:gap-16"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          <div className="flex min-w-0 gap-4">
            <Calendar className="h-6 w-6 shrink-0 text-brand" />
            <div className="min-w-0">
              <div className="text-sm font-bold uppercase tracking-widest text-white">Data</div>
              <div className="mt-1 font-mono text-sm text-zinc-400 sm:text-base">{eventInfo.dateLabel}</div>
            </div>
          </div>

          <div className="flex min-w-0 gap-4">
            <Clock className="h-6 w-6 shrink-0 text-brand" />
            <div className="min-w-0">
              <div className="text-sm font-bold uppercase tracking-widest text-white">Largada</div>
              <div className="mt-1 font-mono text-sm text-zinc-400 sm:text-base">
                {eventInfo.startTimeLabel} - {eventInfo.distances.join(' / ')}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 gap-4 sm:col-span-2 md:col-span-1">
            <MapPin className="h-6 w-6 shrink-0 text-brand" />
            <div className="min-w-0">
              <div className="text-sm font-bold uppercase tracking-widest text-white">Local</div>
              <div className="mt-1 font-mono text-sm text-zinc-400 sm:text-base">{eventInfo.locationLabel}</div>
            </div>
          </div>
        </motion.div>

        <motion.div
          className="w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.7 }}
        >
          <Countdown />
        </motion.div>
      </div>
    </section>
  );
}
