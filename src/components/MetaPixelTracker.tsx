import { useEffect } from 'react';
import { trackPageView } from '../lib/metaPixel';

const NAVIGATION_EVENT = 'funpace:navigation';

export function MetaPixelTracker() {
  useEffect(() => {
    if (window.location.pathname.startsWith('/admin')) return;

    const notifyNavigation = () => window.dispatchEvent(new Event(NAVIGATION_EVENT));
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function (...args) {
      originalPushState.apply(this, args);
      notifyNavigation();
    };
    window.history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      notifyNavigation();
    };

    const trackCurrentPage = () => {
      if (!window.location.pathname.startsWith('/admin')) {
        trackPageView(window.location.pathname);
      }
    };

    window.addEventListener('popstate', trackCurrentPage);
    window.addEventListener(NAVIGATION_EVENT, trackCurrentPage);
    trackCurrentPage();

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', trackCurrentPage);
      window.removeEventListener(NAVIGATION_EVENT, trackCurrentPage);
    };
  }, []);

  return null;
}
