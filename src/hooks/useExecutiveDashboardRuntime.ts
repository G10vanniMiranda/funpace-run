// ADMIN-002 Stage 6B — thin React wrapper around ExecutiveDashboardRuntime.
//
// All concurrency / polling / recovery logic lives in the framework-agnostic
// controller (src/lib/executive-dashboard-runtime.ts), which is unit-tested
// without a DOM. This hook only wires browser deps and lifecycle.

import { useEffect, useRef, useState } from 'react';
import { getAdminEvents, getAdminExecutiveDashboard } from '../lib/api';
import {
  ExecutiveDashboardRuntime,
  type ExecutiveDashboardRuntimeState,
} from '../lib/executive-dashboard-runtime';

function readEventSlug() {
  return new URLSearchParams(window.location.search).get('event') || '';
}

function writeEventSlug(slug: string) {
  const params = new URLSearchParams(window.location.search);
  if (slug) params.set('event', slug);
  else params.delete('event');
  const query = params.toString();
  window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
}

const INITIAL_STATE: ExecutiveDashboardRuntimeState = {
  phase: 'initial-loading',
  data: null,
  selectedSlug: readEventSlug(),
  events: [],
  eventsError: '',
  error: '',
  errorCode: '',
  lastGeneratedAt: null,
};

export type UseExecutiveDashboardRuntime = {
  state: ExecutiveDashboardRuntimeState;
  selectEvent: (slug: string) => void;
  refreshNow: () => void;
  retryEvents: () => void;
};

export function useExecutiveDashboardRuntime(
  adminKey: string,
  onSessionExpired: () => void,
): UseExecutiveDashboardRuntime {
  const [state, setState] = useState<ExecutiveDashboardRuntimeState>(INITIAL_STATE);
  const runtimeRef = useRef<ExecutiveDashboardRuntime | null>(null);
  const onSessionExpiredRef = useRef(onSessionExpired);
  onSessionExpiredRef.current = onSessionExpired;

  useEffect(() => {
    const runtime = new ExecutiveDashboardRuntime({
      fetchDashboard: (slug, signal) => getAdminExecutiveDashboard(adminKey, slug, { signal }),
      fetchEvents: (signal) => getAdminEvents(adminKey, { signal }).then((response) => response.events),
      readEventSlug,
      writeEventSlug,
      isVisible: () => document.visibilityState === 'visible',
      onState: setState,
      onSessionExpired: () => onSessionExpiredRef.current(),
      setTimeoutFn: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeoutFn: (handle) => window.clearTimeout(handle as number),
    });
    runtimeRef.current = runtime;

    const onVisibility = () => {
      if (document.visibilityState === 'visible') runtime.handleVisible();
      else runtime.handleHidden();
    };
    const onOnline = () => runtime.handleOnline();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    runtime.start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      runtime.stop();
      runtimeRef.current = null;
    };
  }, [adminKey]);

  return {
    state,
    selectEvent: (slug) => runtimeRef.current?.selectEvent(slug),
    refreshNow: () => runtimeRef.current?.refreshNow(),
    retryEvents: () => runtimeRef.current?.retryEvents(),
  };
}
