import { motion, useReducedMotion } from 'motion/react';
import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import { createSvgRouteGeometry, type KmlRoute } from './routeGeometry';

export function RoutePath({ route }: { route: KmlRoute }) {
  const reduceMotion = useReducedMotion();
  const geometry = useMemo(
    () =>
      createSvgRouteGeometry(
        route.id === '10k' ? [...route.coordinates].reverse() : route.coordinates,
    ),
    [route],
  );
  const neonFilterId = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const haloPathRef = useRef<SVGPathElement>(null);
  const corePathRef = useRef<SVGPathElement>(null);
  const markerRef = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    if (reduceMotion) return;

    const haloPath = haloPathRef.current;
    const corePath = corePathRef.current;
    const marker = markerRef.current;
    const container = containerRef.current;
    if (!haloPath || !corePath || !marker || !container) return;

    const totalLength = corePath.getTotalLength();
    const paths = [haloPath, corePath];

    let animationFrame = 0;
    let startedAt: number | undefined;
    let isRunning = false;
    let isVisible = false;

    const resetAnimation = () => {
      paths.forEach((path) => {
        path.setAttribute('stroke-dasharray', `${totalLength} ${totalLength}`);
        path.setAttribute('stroke-dashoffset', String(totalLength));
      });
      marker.setAttribute('opacity', '0');
    };

    const drawFrame = (now: number) => {
      if (!isRunning) return;

      startedAt ??= now;
      const cycle = ((now - startedAt) % 9_000) / 9_000;
      const progress =
        cycle <= 0.58
          ? cycle / 0.58
          : cycle <= 0.88
            ? 1
            : 1 - (cycle - 0.88) / 0.12;
      const dashOffset = totalLength * (1 - progress);
      const point = corePath.getPointAtLength(totalLength * progress);

      paths.forEach((path) => {
        path.setAttribute('stroke-dashoffset', String(dashOffset));
      });
      marker.setAttribute('transform', `translate(${point.x} ${point.y})`);
      marker.setAttribute(
        'opacity',
        cycle <= 0.58 ? '1' : cycle <= 0.62 ? String(1 - (cycle - 0.58) / 0.04) : '0',
      );

      animationFrame = window.requestAnimationFrame(drawFrame);
    };

    const stopAnimation = () => {
      isRunning = false;
      startedAt = undefined;
      window.cancelAnimationFrame(animationFrame);
      resetAnimation();
    };

    const startAnimation = () => {
      if (isRunning || document.hidden || !isVisible) return;
      isRunning = true;
      startedAt = undefined;
      animationFrame = window.requestAnimationFrame(drawFrame);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible) startAnimation();
        else stopAnimation();
      },
      { threshold: 0.1 },
    );
    const handleVisibilityChange = () => {
      if (document.hidden) stopAnimation();
      else startAnimation();
    };

    resetAnimation();
    observer.observe(container);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isRunning = false;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [geometry.path, reduceMotion]);

  return (
    <motion.div
      ref={containerRef}
      className="absolute inset-0 z-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
    >
      <div className="route-map-grid absolute inset-0" aria-hidden="true" />
      <div className="absolute inset-0 p-5 sm:p-8">
        <svg
          className="h-full w-full overflow-visible"
          viewBox={geometry.viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${route.title} oficial, traçado conforme o arquivo KML`}
        >
          <defs>
            <filter id={neonFilterId} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feFlood floodColor="#d7ff00" floodOpacity="0.85" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path
            ref={haloPathRef}
            d={geometry.path}
            fill="none"
            stroke="#d7ff00"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity="0.18"
            strokeDasharray={reduceMotion ? undefined : '0 1'}
          />

          <path
            ref={corePathRef}
            d={geometry.path}
            fill="none"
            stroke="#d7ff00"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            filter={`url(#${neonFilterId})`}
            strokeDasharray={reduceMotion ? undefined : '0 1'}
          />

          {!reduceMotion && (
            <g ref={markerRef} aria-hidden="true" opacity="0">
              <circle r="52" fill="#d7ff00" opacity="0.2" />
              <circle r="24" fill="#ffffff" filter={`url(#${neonFilterId})`} />
            </g>
          )}
        </svg>
      </div>
    </motion.div>
  );
}
