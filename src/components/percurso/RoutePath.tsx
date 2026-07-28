import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { createSvgRouteGeometry, type KmlRoute } from './routeGeometry';

export function RoutePath({ route }: { route: KmlRoute }) {
  const reduceMotion = useReducedMotion();
  const geometry = useMemo(() => createSvgRouteGeometry(route.coordinates), [route.coordinates]);

  return (
    <motion.div
      className="absolute inset-0 z-10 p-5 sm:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
    >
      <svg
        className="h-full w-full overflow-visible"
        viewBox={geometry.viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${route.title} oficial, traçado conforme o arquivo KML`}
      >
        <motion.path
          d={geometry.path}
          fill="none"
          stroke="#d7ff00"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ filter: 'drop-shadow(0 0 3px rgba(215, 255, 0, 0.24))' }}
          initial={reduceMotion ? { opacity: 1 } : { pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { pathLength: { duration: 1.35, ease: 'easeInOut' }, opacity: { duration: 0.2 } }
          }
        />
      </svg>
    </motion.div>
  );
}
