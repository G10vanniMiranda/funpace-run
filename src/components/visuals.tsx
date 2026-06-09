import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
import { Map as MapIcon, ArrowRight } from 'lucide-react';

export function CourseMap() {
  return (
    <section id="map" className="py-24 md:py-32 px-6 border-t border-zinc-900 bg-zinc-950 overflow-hidden relative">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-16 lg:gap-24 items-center">
        
        {/* Info Column */}
        <div className="lg:w-1/3 flex flex-col gap-6">
          <div className="flex items-center gap-3 text-brand mb-4">
            <MapIcon className="w-6 h-6" />
            <span className="font-bold uppercase tracking-widest text-xs">Análise de Percurso</span>
          </div>
          
          <h2 className="font-display text-5xl md:text-6xl font-black uppercase tracking-tighter leading-[0.9]">
            Terreno <br/><span className="text-zinc-600">Reconhecido</span>
          </h2>
          
          <p className="text-zinc-400 text-sm font-mono leading-relaxed max-w-md">
            Um percurso majoritariamente plano, desenhado para quebra de recordes pessoais (PRs). Altimetria controlada com poucas elevações e amplas vias retas.
          </p>

          <div className="flex flex-col gap-4 mt-6">
            <div className="p-4 bg-zinc-900 border border-zinc-800">
              <h4 className="font-bold uppercase text-xs tracking-widest text-zinc-500 mb-1">Ganho de Elevação (10K)</h4>
              <p className="font-mono text-xl text-white font-bold">+ 42m</p>
            </div>
            <div className="p-4 bg-zinc-900 border border-zinc-800">
              <h4 className="font-bold uppercase text-xs tracking-widest text-zinc-500 mb-1">Postos de Hidratação</h4>
              <p className="font-mono text-xl text-white font-bold">A cada 2.5km</p>
            </div>
          </div>
        </div>

        {/* Map Visualization placeholder (Stylized graphic) */}
        <div className="lg:w-2/3 w-full aspect-video bg-zinc-900 relative rounded-sm border-2 border-zinc-800 overflow-hidden group">
          {/* Faux map background grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_2px,transparent_2px),linear-gradient(to_bottom,#80808012_2px,transparent_2px)] bg-[size:40px_40px]"></div>
          
          {/* Start / Finish Point */}
          <div className="absolute top-1/2 left-1/4 w-4 h-4 bg-brand rounded-full z-20 shadow-[0_0_15px_#dfff00] animate-pulse"></div>
          
          {/* Faux Route SVG */}
          <svg className="absolute inset-0 w-full h-full z-10 pl-[25%]" viewBox="0 0 100 100" preserveAspectRatio="none">
             <motion.path 
                d="M 5,50 Q 20,20 40,50 T 70,30 T 90,60" 
                fill="transparent" 
                stroke="#dfff00" 
                strokeWidth="0.8"
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 2, ease: "easeInOut" }}
             />
          </svg>
          
          <div className="absolute bottom-6 right-6 z-30 bg-black/80 backdrop-blur border border-zinc-800 p-4">
             <div className="font-bold uppercase text-xs tracking-widest">MAPA OFICIAL EM BREVE</div>
             <a href="#" className="flex items-center gap-2 text-brand text-xs mt-2 hover:underline">
               Download GPX <ArrowRight className="w-3 h-3" />
             </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Gallery() {
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"]
  });

  const y1 = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 80]);

  const images = [
    "https://images.unsplash.com/photo-1552674605-15cce7039600?auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1530143311094-34d807799e8f?auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&q=80",
  ];

  return (
    <section id="gallery" className="py-24 border-t border-zinc-900 bg-black overflow-hidden" ref={containerRef}>
      <div className="px-6 mb-16 max-w-7xl mx-auto flex justify-between items-end">
        <div>
           <h2 className="font-display text-5xl md:text-6xl font-black uppercase tracking-tighter">Energy</h2>
           <p className="text-zinc-500 font-mono text-sm mt-2 uppercase tracking-widest">Energia visual da experiencia FunPace Run</p>
        </div>
      </div>

      {/* Parallax Image Grid */}
      <div className="w-full flex gap-4 md:gap-8 px-4 md:px-8 h-[60vh] md:h-[80vh] overflow-hidden justify-center items-center">
         
         <motion.div className="flex flex-col gap-4 md:w-1/3 h-[150%]" style={{ y: y1 }}>
           <img src={images[0]} alt="Runner" className="w-full h-[400px] object-cover grayscale hover:grayscale-0 transition-all duration-500 object-center" />
           <img src={images[1]} alt="Shoes" className="w-full h-[500px] object-cover grayscale hover:grayscale-0 transition-all duration-500" />
         </motion.div>

         <motion.div className="flex flex-col gap-4 md:w-1/3 h-[150%]" style={{ y: y2 }}>
           <img src={images[2]} alt="Group running" className="w-full h-[500px] object-cover grayscale hover:grayscale-0 transition-all duration-500 mb-8" />
           <img src={images[3]} alt="City Runner" className="w-full h-[300px] object-cover grayscale hover:grayscale-0 transition-all duration-500 object-top" />
         </motion.div>
         
      </div>
    </section>
  );
}
