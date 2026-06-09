import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { MapPin, Calendar, Clock, ArrowRight } from 'lucide-react';
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
    <div className="flex gap-2 isolate mt-8 md:mt-12">
      {timeBlocks.map((block, i) => (
        <div key={i} className="flex flex-col">
          <div className="bg-zinc-900 border border-zinc-800 text-white font-mono text-2xl md:text-5xl font-bold w-16 h-16 md:w-24 md:h-24 flex items-center justify-center rounded">
            {block.value.toString().padStart(2, '0')}
          </div>
          <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-zinc-500 mt-2 text-center">
            {block.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative min-h-[95vh] flex flex-col justify-end pb-24 md:pb-32 px-6 overflow-hidden">
      {/* Background Graphic elements */}
      <div className="absolute top-0 right-0 w-2/3 h-full overflow-hidden opacity-30 select-none pointer-events-none">
        <div className="absolute -right-1/4 top-1/4 w-[800px] h-[800px] rounded-full border border-brand/20 blur-[1px]"></div>
        <div className="absolute -right-1/3 top-1/3 w-[800px] h-[800px] rounded-full border border-brand/10 blur-[2px]"></div>
      </div>
      
      {/* Decorative lines */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>

      <div className="max-w-7xl mx-auto w-full relative z-10 flex flex-col items-start">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex items-center gap-4 mb-6 md:mb-10 text-brand"
        >
          <div className="h-[2px] w-12 bg-brand"></div>
          <span className="uppercase font-bold tracking-widest text-sm md:text-base">{eventInfo.edition} • {eventInfo.city}</span>
        </motion.div>

        <motion.h1 
          className="font-display font-black text-[12vw] sm:text-[10vw] leading-[0.8] tracking-tighter uppercase ml-[-0.05em] text-white mix-blend-exclusion"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
        >
          FUNPACE<br />
          <span className="text-zinc-800" style={{ WebkitTextStroke: '2px white' }}>RUN 2026</span>
        </motion.h1>

        <motion.div
          className="mt-8 flex flex-col sm:flex-row gap-4 sm:items-center"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: "easeOut" }}
        >
          <a
            href="#register"
            className="bg-brand text-black px-6 py-4 font-black uppercase tracking-widest text-sm flex items-center gap-3 hover:bg-white transition-colors"
          >
            Garantir inscricao - {eventInfo.currentLot}
            <ArrowRight className="w-5 h-5" />
          </a>
          <p className="max-w-md text-sm md:text-base text-zinc-300 font-mono">
            Corrida oficial FunPace com {eventInfo.distances.join(' e ')}, kit atleta, chip e medalha finisher.
          </p>
        </motion.div>

        <motion.div 
          className="flex flex-col md:flex-row gap-8 md:gap-16 mt-12 w-full max-w-4xl border-t border-zinc-800 pt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          <div className="flex gap-4">
            <Calendar className="w-6 h-6 text-brand shrink-0" />
            <div>
              <div className="font-bold text-white uppercase tracking-widest text-sm">Data</div>
              <div className="text-zinc-400 font-mono mt-1">{eventInfo.dateLabel}</div>
            </div>
          </div>
          
          <div className="flex gap-4">
            <Clock className="w-6 h-6 text-brand shrink-0" />
            <div>
              <div className="font-bold text-white uppercase tracking-widest text-sm">Largada</div>
              <div className="text-zinc-400 font-mono mt-1">{eventInfo.startTimeLabel} • {eventInfo.distances.join(' / ')}</div>
            </div>
          </div>

          <div className="flex gap-4">
            <MapPin className="w-6 h-6 text-brand shrink-0" />
            <div>
              <div className="font-bold text-white uppercase tracking-widest text-sm">Local</div>
              <div className="text-zinc-400 font-mono mt-1">{eventInfo.locationLabel}</div>
            </div>
          </div>
        </motion.div>

        <motion.div
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
