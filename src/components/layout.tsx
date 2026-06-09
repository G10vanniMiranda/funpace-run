import { motion } from 'motion/react';
import { Instagram, Twitter, Youtube } from 'lucide-react';
import { eventInfo } from '../config/event';

export function Navbar() {
  return (
    <nav className="fixed top-0 left-0 w-full z-50 mix-blend-difference px-6 py-4 flex justify-between items-center text-white">
      <div className="font-display font-bold text-xl tracking-tighter uppercase">Funpace Run</div>
      <div className="hidden md:flex gap-8 text-sm font-bold uppercase tracking-widest">
        <a href="#about" className="hover:text-brand transition-colors">A Prova</a>
        <a href="#map" className="hover:text-brand transition-colors">Percurso</a>
        <a href="#register" className="hover:text-brand transition-colors">Inscricoes</a>
        <a href="#faq" className="hover:text-brand transition-colors">FAQ</a>
      </div>
      <a 
        href="#register" 
        className="px-4 py-2 bg-white text-black font-bold uppercase text-xs tracking-wider rounded-full hover:bg-brand transition-colors"
      >
        Participar
      </a>
    </nav>
  );
}

export function Marquee() {
  return (
    <div className="w-full bg-brand text-black py-3 overflow-hidden border-y-2 border-black flex whitespace-nowrap relative z-10">
      <motion.div 
        className="flex gap-8 font-display font-bold uppercase tracking-tighter text-xl shrink-0"
        animate={{ x: [0, -1036] }}
        transition={{ repeat: Infinity, duration: 15, ease: "linear" }}
      >
        <span>NO EXCUSES</span>
        <span>•</span>
        <span>{eventInfo.name}</span>
        <span>•</span>
        <span>{eventInfo.distances.join(' ')}</span>
        <span>•</span>
        <span>OUTWORK EVERYONE</span>
        <span>•</span>
        <span>NO EXCUSES</span>
        <span>•</span>
        <span>{eventInfo.name}</span>
        <span>•</span>
        <span>{eventInfo.distances.join(' ')}</span>
        <span>•</span>
        <span>OUTWORK EVERYONE</span>
        <span>•</span>
        <span>NO EXCUSES</span>
        <span>•</span>
        <span>{eventInfo.name}</span>
        <span>•</span>
        <span>{eventInfo.distances.join(' ')}</span>
        <span>•</span>
        <span>OUTWORK EVERYONE</span>
      </motion.div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="bg-black border-t border-zinc-800 text-white py-20 px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-end gap-12">
        <div className="flex flex-col gap-6">
          <h2 className="font-display text-5xl md:text-8xl font-black uppercase tracking-tighter leading-none">
            Funpace<br />
            <span className="text-zinc-500 stroke-text">Run</span>
          </h2>
          <p className="text-zinc-400 font-mono text-sm max-w-sm">
            Destrua seus limites. Corrida oficial em {eventInfo.city}, Brasil - 2026.
          </p>
        </div>
        
        <div className="flex flex-col gap-4">
          <h3 className="font-bold uppercase tracking-widest text-sm text-zinc-500 mb-2">Conecte-se</h3>
          <div className="flex gap-4">
            <a href="#" className="w-12 h-12 rounded-full border border-zinc-700 flex items-center justify-center hover:bg-white hover:text-black transition-colors">
              <Instagram className="w-5 h-5" />
            </a>
            <a href="#" className="w-12 h-12 rounded-full border border-zinc-700 flex items-center justify-center hover:bg-white hover:text-black transition-colors">
              <Twitter className="w-5 h-5" />
            </a>
            <a href="#" className="w-12 h-12 rounded-full border border-zinc-700 flex items-center justify-center hover:bg-white hover:text-black transition-colors">
              <Youtube className="w-5 h-5" />
            </a>
          </div>
          <div className="mt-8 text-xs text-zinc-600 font-mono">
            &copy; {new Date().getFullYear()} Funpace Run. Todos os direitos reservados.
          </div>
          <div className="flex gap-4 text-xs text-zinc-500 font-bold uppercase tracking-widest">
            <a href="/regulamento" className="hover:text-brand">Regulamento</a>
            <a href="/privacidade" className="hover:text-brand">Privacidade</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
