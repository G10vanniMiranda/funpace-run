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
    <section id="about" className="px-6 py-24 bg-black border-t border-zinc-900">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-12 lg:gap-20 items-start">
        <div>
          <p className="text-brand font-bold uppercase tracking-widest text-xs mb-4">A prova</p>
          <h2 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none">
            Corrida oficial FunPace em Porto Velho.
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {highlights.map(({ icon: Icon, label, value }) => (
            <div key={label} className="border border-zinc-800 bg-zinc-950 p-6">
              <Icon className="w-6 h-6 text-brand mb-6" />
              <h3 className="font-bold uppercase tracking-widest text-xs text-zinc-500 mb-2">{label}</h3>
              <p className="text-white font-mono text-sm leading-relaxed">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
