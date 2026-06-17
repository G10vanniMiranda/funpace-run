import { type ReactNode, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export function PremiumCursor() {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    const hasLargeViewport = window.matchMedia('(min-width: 1280px)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const memory = 'deviceMemory' in navigator ? Number(navigator.deviceMemory) : 8;
    const cores = navigator.hardwareConcurrency || 8;

    setEnabled(hasFinePointer && hasLargeViewport && !reducedMotion && memory >= 8 && cores >= 6);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const cursor = cursorRef.current;

    if (!cursor) {
      return;
    }

    let frame = 0;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;

    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;

      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        frame = 0;
      });
    };

    const setActive = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      cursor.dataset.active = target.closest('a, button, input, select, textarea, .premium-card') ? 'true' : 'false';
    };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerover', setActive, { passive: true });

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerover', setActive);

      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return <div ref={cursorRef} className="premium-cursor" aria-hidden="true" />;
}

export function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reducedMotion ? false : { opacity: 0, y: 24, filter: 'blur(4px)' }}
      whileInView={reducedMotion ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.22 }}
      transition={{ duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
