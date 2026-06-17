import { Calendar, MapPin, Route, ShieldCheck } from 'lucide-react';
import { eventInfo } from '../config/event';

const highlights = [
  {
    icon: Calendar,
    label: 'Data e largada',
    value: `${eventInfo.dateLabel} - ${eventInfo.startTimeLabel}`,
  },
  {
    icon: Route,
    label: 'Distancias',
    value: eventInfo.distances.join(' / '),
  },
  {
    icon: MapPin,
    label: 'Arena',
    value: eventInfo.locationLabel,
  },
  {
    icon: ShieldCheck,
    label: 'Inscricao',
    value: eventInfo.offerNote,
  },
];

export function AboutSection() {
  return (
    <section id="about" className="scroll-mt-24 border-t border-zinc-900 bg-black px-4 py-16 sm:px-6 md:py-24">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div>
          <p className="text-brand font-bold uppercase tracking-widest text-xs mb-4">A prova</p>
          <h2 className="font-display text-[clamp(2.7rem,12vw,4.5rem)] font-black uppercase leading-none tracking-tighter">
            Corrida oficial FunPace em Porto Velho.
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {highlights.map(({ icon: Icon, label, value }) => (
            <div key={label} className="min-w-0 border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
              <Icon className="mb-5 h-6 w-6 text-brand sm:mb-6" />
              <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500 mb-2">{label}</h3>
              <p className="text-white font-mono text-sm leading-relaxed">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
