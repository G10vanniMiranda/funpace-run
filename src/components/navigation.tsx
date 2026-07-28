export type PublicNavigationLocation = {
  pathname: string;
  hash: string;
};

export const publicNavigation = [
  { href: '/', label: 'Início' },
  { href: '/#register', label: 'Inscrição' },
  { href: '/#map', label: 'Percurso' },
  { href: '/regulamento', label: 'Regulamento' },
];

export function NavigationLinks({
  currentLocation,
  mobile = false,
  onNavigate,
}: {
  currentLocation: PublicNavigationLocation;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className={mobile ? 'space-y-2' : 'flex items-center gap-1'}>
      {publicNavigation.map((item, index) => {
        const isCurrent = isNavigationItemCurrent(item.href, currentLocation);

        return (
          <li key={item.href}>
            <a
              href={item.href}
              onClick={onNavigate}
              aria-current={isCurrent ? 'page' : undefined}
              className={mobile
                ? `group flex min-h-14 items-center gap-4 border-l-2 px-4 py-3 font-display text-base font-black uppercase tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    isCurrent
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-white/10 text-zinc-300 hover:border-brand/60 hover:bg-white/4 hover:text-white'
                  }`
                : `relative inline-flex min-h-11 items-center justify-center px-4 text-xs font-black uppercase tracking-[0.14em] [text-shadow:0_1px_12px_rgba(0,0,0,0.9)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                    isCurrent
                      ? 'text-brand after:absolute after:inset-x-4 after:bottom-1 after:h-px after:bg-brand'
                      : 'text-white/80 hover:text-white'
                  }`}
            >
              {mobile ? (
                <span className={`font-mono text-[10px] ${isCurrent ? 'text-brand' : 'text-zinc-600 group-hover:text-brand'}`} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
              ) : null}
              <span>{item.label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function isNavigationItemCurrent(
  href: string,
  currentLocation: PublicNavigationLocation,
) {
  if (href === '/') {
    return currentLocation.pathname === '/' && !currentLocation.hash;
  }

  if (href.startsWith('/#')) {
    return currentLocation.pathname === '/' && currentLocation.hash === href.slice(1);
  }

  return currentLocation.pathname === href;
}
