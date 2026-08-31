import { type FormEvent, type ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import {
  Activity,
  Bell,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Download,
  Eye,
  FileBarChart,
  Flag,
  Gift,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Medal,
  Menu,
  RefreshCcw,
  Search,
  ScanLine,
  Settings,
  ShieldCheck,
  HeartPulse,
  Shirt,
  Ticket,
  TimerReset,
  Trophy,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import { eventInfo } from '../config/event';
import { useAdminMutation } from '../hooks/useAdminMutation';
import type { AdminMutationState } from '../lib/admin-mutation-runtime';
import { buildLotUpdatePayload } from '../lib/admin-lot-mutation';
import { PartnersPanel } from '../components/admin/PartnersPanel';
import QRCode from 'qrcode';
import {
  type AdminSession,
  ApiError,
  checkInAdminRegistration,
  deliverAdminKit,
  getAdminAuditLogs,
  getAdminAuditLogsCsvUrl,
  getAdminCsvUrl,
  getAdminReportExportUrl,
  getAdminRegistrations,
  getAdminEvents,
  getAdminGoogleSheetsStatus,
  retryAdminGoogleSheets,
  syncAdminRegistrationToGoogleSheets,
  getAdminPaymentDetails,
  getAdminPayments,
  getAdminPaymentsCsvUrl,
  linkAdminOrphanPayment,
  getAdminEventConfig,
  runAdminSystemCheck,
  updateAdminEventConfig,
  updateAdminDistance,
  updateAdminLot,
  getAdminSummary,
  getAdminAlerts,
  updateAdminAlert,
  getAdminMonitoring,
  getAdminReconciliation,
  runAdminReconciliation,
  getAdminSession,
  getAdminOperation,
  loginAdmin,
  logoutAdmin,
  maintainAdminRegistration,
  reconcileAdminPayment,
  updateAdminRegistration,
  getAdminRegistrationDetails,
  assignAdminBibNumber,
} from '../lib/api';
import type { AdminAlertsResponse, AdminAuditLog, AdminEventConfig, AdminEventContext, AdminEventListItem, AdminExecutiveDashboard, AdminGoogleSheetsStatus, AdminMonitoringResponse, AdminPaymentDetailsResponse, AdminPaymentEvent, AdminReconciliationDashboard, AdminRegistration, AdminRegistrationDetailsResponse, AdminRegistrationEditable, AdminRegistrationsResponse, AdminSummaryResponse, DashboardChartPoint, RegistrationStatus } from '../types/registration';
import { useExecutiveDashboardRuntime } from '../hooks/useExecutiveDashboardRuntime';
import { EVENT_SELECTION_CODES } from '../lib/executive-dashboard-runtime';

type AdminFilters = {
  status: string;
  distanceId: string;
  lotId: string;
  q: string;
  page: string;
  pageSize: string;
  city: string;
  team: string;
  shirtSize: string;
  bibNumber: string;
  sortBy: string;
  sortOrder: string;
  sheetStatus: string;
};

type AdminNavKey = 'executive' | 'registrations' | 'payments' | 'partners' | 'reconciliation' | 'alerts' | 'monitoring' | 'operation' | 'reports' | 'audit' | 'event';
type AdminRole = AdminSession['role'];

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

// ADMIN-002 Stage 7B — the Executive Dashboard presents business figures, so its
// visible timestamps are pinned to the event's operating timezone (matches the
// "hoje · Porto Velho" metric labels). Stored timestamps are untouched.
export const BUSINESS_TIMEZONE = 'America/Porto_Velho';
export const businessDateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: BUSINESS_TIMEZONE,
});
// pt-BR: "61,3%" not "61.3%".
export const percentFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
// pt-BR: "1.234" not "1234".
export const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const formatPercent = (value: number | undefined) => `${percentFormatter.format(Number(value) || 0)}%`;
const formatCount = (value: number | undefined) => integerFormatter.format(Number(value) || 0);
// ADMIN-003 Stage 3: the backend withholds `amountCents` (and other financial
// fields) from the `operation` role, so currency renders must tolerate its
// absence and show a neutral placeholder instead of `R$ NaN`.
const formatCentsBRL = (cents: number | null | undefined) =>
  typeof cents === 'number' && Number.isFinite(cents) ? currencyFormatter.format(cents / 100) : '—';

// ADMIN-002 Stage 7B §13 — lot capacity status carries text, never colour alone.
export const LOT_LEVEL_LABEL: Record<string, string> = {
  normal: 'Normal',
  warning: 'Atenção',
  critical: 'Crítico',
  blocked: 'Bloqueado',
};

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'pending_payment', label: 'Pendente' },
  { value: 'paid', label: 'Pago' },
  { value: 'payment_failed', label: 'Falhou' },
  { value: 'expired', label: 'Expirado' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'refunded', label: 'Reembolsado' },
];

const navItems: Array<{ key: AdminNavKey; label: string; icon: LucideIcon; status?: 'soon' }> = [
  { key: 'executive', label: 'Dashboard Executivo', icon: BarChart3 },
  { key: 'registrations', label: 'Inscrições', icon: Ticket },
  { key: 'payments', label: 'Pagamentos', icon: CreditCard },
  { key: 'partners', label: 'Parceiros', icon: Users },
  { key: 'reconciliation', label: 'Reconciliação', icon: ShieldCheck },
  { key: 'alerts', label: 'Alertas', icon: Bell },
  { key: 'monitoring', label: 'Monitoramento', icon: HeartPulse },
  { key: 'operation', label: 'Operação', icon: ClipboardCheck },
  { key: 'reports', label: 'Relatórios', icon: FileBarChart },
  { key: 'audit', label: 'Auditoria', icon: Activity },
  { key: 'event', label: 'Evento', icon: Settings },
];

const navPermissions: Record<AdminNavKey, AdminRole[]> = {
  executive: ['administrator', 'finance'],
  registrations: ['administrator', 'finance', 'operation'],
  payments: ['administrator', 'finance'],
  partners: ['administrator'],
  reconciliation: ['administrator', 'finance'],
  alerts: ['administrator', 'finance'],
  monitoring: ['administrator', 'finance'],
  operation: ['administrator', 'operation'],
  reports: ['administrator', 'finance'],
  audit: ['administrator', 'finance'],
  event: ['administrator'],
};

const statusLabels: Record<RegistrationStatus, string> = {
  pending_payment: 'Pendente',
  paid: 'Pago',
  payment_failed: 'Falhou',
  expired: 'Expirado',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
};

const statusStyles: Record<RegistrationStatus, string> = {
  pending_payment: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
  paid: 'border-brand/30 bg-brand/10 text-brand',
  payment_failed: 'border-red-400/20 bg-red-400/10 text-red-200',
  expired: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300',
  cancelled: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300',
  refunded: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200',
};

// ADMIN-003 Stage 2: the selected event slug is stateless — it lives in the page
// URL as `?event=<slug>`, shared with the Executive Dashboard (Stage 4B).
function readEventSlugFromLocation(): string {
  try {
    return new URLSearchParams(window.location.search).get('event') || '';
  } catch {
    return '';
  }
}

function writeEventSlugToLocation(slug: string): void {
  const params = new URLSearchParams(window.location.search);
  if (slug) params.set('event', slug);
  else params.delete('event');
  const query = params.toString();
  window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
}

export function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [draftPassword, setDraftPassword] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [adminActor, setAdminActor] = useState('');
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [summary, setSummary] = useState<AdminSummaryResponse | null>(null);
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [filters, setFilters] = useState({ status: '', distanceId: '', lotId: '', q: '', page: '1', pageSize: '25', city: '', team: '', shirtSize: '', bibNumber: '', sortBy: 'createdAt', sortOrder: 'desc', sheetStatus: '' });
  const [googleSheetsStatus, setGoogleSheetsStatus] = useState<AdminGoogleSheetsStatus | null>(null);
  const [reportFilters, setReportFilters] = useState({ dateFrom: '', dateTo: '' });
  const [registrationPagination, setRegistrationPagination] = useState<AdminRegistrationsResponse['pagination']>({ page: 1, pageSize: 25, total: 0, totalPages: 1, people: 0, historicalRegistrations: 0 });
  // ADMIN-003 Stage 2: the Inscrições tab is person-centric within ONE event.
  const [registrationEvent, setRegistrationEvent] = useState<AdminEventContext | null>(null);
  const [registrationEventError, setRegistrationEventError] = useState<{ code: string; message: string } | null>(null);
  const [registrationEventOptions, setRegistrationEventOptions] = useState<AdminEventListItem[]>([]);
  const [registrationEventSwitch, setRegistrationEventSwitch] = useState(0);
  const registrationsRequestSeq = useRef(0);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeNav, setActiveNav] = useState<AdminNavKey>('executive');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState<AdminRegistration | null>(null);
  const [registrationDetails, setRegistrationDetails] = useState<AdminRegistrationDetailsResponse | null>(null);
  const [actionLoading, setActionLoading] = useState<string>('');
  const [maintenanceDraft, setMaintenanceDraft] = useState<{ registration: AdminRegistration; action: 'cancel' | 'send-email' | 'undo-check-in' | 'undo-kit'; reason: string } | null>(null);
  // EMAIL-OPS-002 Stage 2 — the confirmation send/resend action is the first
  // (and, this release, only) Admin mutation on the reusable state machine:
  // idle → confirming → submitting → success | failure, with an in-context
  // result that loadAdminData() cannot erase and an explicit 401 path.
  const sendEmailMutation = useAdminMutation<Awaited<ReturnType<typeof maintainAdminRegistration>>>();
  const [bibDraft, setBibDraft] = useState<{ registration: AdminRegistration; bibNumber: string; reason: string } | null>(null);
  const adminLoadInFlight = useRef(false);

  // ADMIN-003 Stage 2: on the Inscrições tab the CSV follows the tab —
  // person-centric and scoped to the same event (`view=people`). Every other
  // tab's top-bar export keeps the historical row-centric global dump.
  const csvUrl = useMemo(
    () => getAdminCsvUrl(
      activeNav === 'registrations'
        ? { ...filters, view: 'people', event: registrationEvent?.slug || readEventSlugFromLocation() }
        : filters,
    ),
    [filters, registrationEvent, activeNav],
  );
  const dashboard = useMemo(() => getDashboardModel(summary, registrations), [summary, registrations]);

  // ADMIN-002 Stage 6B: the single canonical "administrative session expired"
  // flow. Any 401 from the parent poll OR from a child runtime (executive
  // dashboard, monitoring) routes here — no waiting up to 60s for L1, no
  // repeated 401 polling, no Portuguese error-string comparison.
  const handleSessionExpired = useCallback(() => {
    setAdminKey(''); setAdminActor(''); setAdminRole(null);
    setSummary(null); setRegistrations([]); setAuditLogs([]);
    setSelectedRegistration(null); setRegistrationDetails(null);
  }, []);

  const loadAdminData = async (key = adminKey) => {
    if (!key || adminLoadInFlight.current) {
      return;
    }

    adminLoadInFlight.current = true;
    setLoading(true);
    setError('');

    try {
      // ADMIN-002 Stage 6B: allSettled so one failing request no longer discards
      // the others, and an unresolved event scope (>=2 published events, no
      // ?event= yet) does not spam a blocking error while the Executive
      // Dashboard shows its recoverable event selector (§29).
      const eventParam = readEventSlugFromLocation() || undefined;
      // ADMIN-003 Stage 2: the Inscrições tab uses the person-centric, event-
      // scoped view; every other panel keeps consuming the global row list.
      // A monotonic sequence guards against an event switch landing its
      // response after a newer one (no full L1 refactor — just latest-wins).
      const isRegistrationsView = activeNav === 'registrations';
      const registrationsSeq = isRegistrationsView ? ++registrationsRequestSeq.current : registrationsRequestSeq.current;
      const registrationsQuery = isRegistrationsView
        ? { ...filters, view: 'people', event: eventParam || '' }
        : { status: '', distanceId: '', lotId: '', q: '' };
      const [summaryOutcome, registrationsOutcome, auditOutcome] = await Promise.allSettled([
        getAdminSummary(key, eventParam),
        getAdminRegistrations(key, registrationsQuery),
        getAdminAuditLogs(key),
      ]);

      const outcomes = [summaryOutcome, registrationsOutcome, auditOutcome];
      if (key === 'session' && outcomes.some((outcome) => outcome.status === 'rejected'
        && outcome.reason instanceof ApiError && outcome.reason.status === 401)) {
        handleSessionExpired();
        return;
      }

      let nextError = '';

      if (summaryOutcome.status === 'fulfilled') {
        setSummary(summaryOutcome.value);
      } else {
        const reason = summaryOutcome.reason;
        const isEventSelection = reason instanceof ApiError
          && EVENT_SELECTION_CODES.indexOf(reason.businessCode || '') !== -1;
        if (!isEventSelection) {
          nextError = reason instanceof ApiError ? reason.message : 'Não foi possível carregar o resumo.';
        }
      }

      // Only apply the registrations outcome if it is still the latest one for
      // the tab (an older event's response must not overwrite a newer view).
      const registrationsIsStale = isRegistrationsView && registrationsSeq !== registrationsRequestSeq.current;
      if (registrationsIsStale) {
        // discarded on purpose
      } else if (registrationsOutcome.status === 'fulfilled') {
        setRegistrations(registrationsOutcome.value.registrations);
        setRegistrationPagination(registrationsOutcome.value.pagination);
        if (isRegistrationsView) {
          const resolvedEvent = registrationsOutcome.value.event || null;
          setRegistrationEvent(resolvedEvent);
          setRegistrationEventError(null);
          // §7: exactly one published event and no ?event= yet → canonicalise.
          if (resolvedEvent && !readEventSlugFromLocation()) {
            writeEventSlugToLocation(resolvedEvent.slug);
          }
        }
      } else {
        const reason = registrationsOutcome.reason;
        const eventSelectionCode = reason instanceof ApiError
          && EVENT_SELECTION_CODES.indexOf(reason.businessCode || '') !== -1
          ? reason.businessCode || ''
          : '';
        if (isRegistrationsView && eventSelectionCode) {
          // §8/§29: ambiguous / unknown / no published event → drive the tab's
          // own selection recovery state instead of a blocking banner.
          setRegistrations([]);
          setRegistrationEvent(null);
          setRegistrationEventError({ code: eventSelectionCode, message: reason instanceof ApiError ? reason.message : '' });
          void getAdminEvents(key).then((response) => setRegistrationEventOptions(response.events)).catch(() => undefined);
        } else if (!nextError) {
          nextError = reason instanceof ApiError ? reason.message : 'Não foi possível carregar as inscrições.';
        }
      }

      if (auditOutcome.status === 'fulfilled') {
        setAuditLogs(auditOutcome.value.logs);
      }

      setError(nextError);
      if (activeNav === 'registrations') setGoogleSheetsStatus(await getAdminGoogleSheetsStatus(key).catch(() => null));
    } catch {
      setError('Não foi possível carregar o painel.');
    } finally {
      adminLoadInFlight.current = false;
      setLoading(false);
    }
  };

  // ADMIN-003 Stage 2: switching the Inscrições event resets incompatible
  // filters (distance/lot belong to the previous event) and page, then reloads
  // via `registrationEventSwitch` so the fetch runs with the updated filters.
  const selectRegistrationEvent = (slug: string) => {
    writeEventSlugToLocation(slug);
    registrationsRequestSeq.current += 1;
    setRegistrationEventError(null);
    setFilters((previous) => ({ ...previous, page: '1', distanceId: '', lotId: '' }));
    setRegistrationEventSwitch((value) => value + 1);
  };

  useEffect(() => {
    void loadAdminData();
  }, [filters.status, filters.distanceId, filters.lotId, filters.page, filters.pageSize, filters.city, filters.team, filters.shirtSize, filters.bibNumber, filters.sortBy, filters.sortOrder, filters.sheetStatus, activeNav, registrationEventSwitch]);

  useEffect(() => {
    void getAdminSession().then((session) => { setAdminActor(`${session.actor} · ${session.role}`); setAdminRole(session.role); setAdminKey('session'); void loadAdminData('session'); }).catch(() => undefined).finally(() => setAuthChecking(false));
  }, []);

  useEffect(() => {
    if (!adminKey) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadAdminData(adminKey);
    };
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [adminKey, activeNav, filters]);

  useEffect(() => {
    if (!adminRole) {
      return;
    }

    if (!navPermissions[activeNav].includes(adminRole)) {
      const fallbackNav = navItems.find((item) => navPermissions[item.key].includes(adminRole))?.key || 'registrations';
      setActiveNav(fallbackNav);
    }
  }, [activeNav, adminRole]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true); setError('');
    try { const session = await loginAdmin(draftEmail, draftPassword); setAdminActor(`${session.actor} · ${session.role}`); setAdminRole(session.role); setAdminKey('session'); setDraftPassword(''); await loadAdminData('session'); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível entrar.'); }
    finally { setLoading(false); }
  };

  const handleLogout = async () => {
    try { await logoutAdmin(); } finally { setAdminKey(''); setAdminActor(''); setAdminRole(null); setSummary(null); setRegistrations([]); setAuditLogs([]); setSelectedRegistration(null); setRegistrationDetails(null); }
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadAdminData();
  };

  const downloadCsv = async () => {
    if (!adminKey) {
      return;
    }

    // ADMIN-003 Stage 3: exporting the registrations base is administrator /
    // finance only. The backend returns 403 for `operation` — this is just so
    // the client never fires a request it knows will be refused.
    if (adminRole === 'operation') {
      setError('Exportação de inscrições não disponível para o seu perfil.');
      return;
    }

    setError('');
    try {
      const response = await fetch(csvUrl, { credentials: 'include' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || 'Não foi possível exportar o CSV.');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'funpace-run-inscritos.csv';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível exportar o CSV.');
    }
  };

  const updateRegistration = (registration: AdminRegistration) => {
    setRegistrations((current) => current.map((item) => (item.id === registration.id ? registration : item)));
    setSelectedRegistration(registration);
    setRegistrationDetails((current) => current ? { ...current, registration } : current);
  };

  const handleCheckIn = async (registration: AdminRegistration) => {
    setActionLoading('check-in');
    setError('');

    try {
      const response = await checkInAdminRegistration(adminKey, registration.id);
      updateRegistration(response.registration);
      setRegistrationDetails(await getAdminRegistrationDetails(adminKey, registration.id));
      await loadAdminData();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível registrar o check-in.');
    } finally {
      setActionLoading('');
    }
  };

  const handleKitDelivery = async (registration: AdminRegistration) => {
    setActionLoading('kit');
    setError('');

    try {
      const response = await deliverAdminKit(adminKey, registration.id);
      updateRegistration(response.registration);
      setRegistrationDetails(await getAdminRegistrationDetails(adminKey, registration.id));
      await loadAdminData();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível registrar a entrega do kit.');
    } finally {
      setActionLoading('');
    }
  };

  const handleMaintenance = async (registration: AdminRegistration, action: 'cancel' | 'send-email' | 'undo-check-in' | 'undo-kit') => {
    setActionMessage('');
    if (action === 'send-email') sendEmailMutation.reset();
    setMaintenanceDraft({ registration, action, reason: '' });
  };

  // EMAIL-OPS-002 Stage 2 — the confirmation send/resend path. Feedback lives in
  // the modal (state machine), never in the transient page banner. Authoritative
  // registration state is refreshed only on acknowledge(), after the operator
  // has seen the backend result.
  const submitSendEmail = async () => {
    if (!maintenanceDraft || maintenanceDraft.action !== 'send-email') return;
    const registrationId = maintenanceDraft.registration.id;
    await sendEmailMutation.submit(() => maintainAdminRegistration(adminKey, registrationId, 'send-email', ''));
  };

  const acknowledgeSendEmail = async () => {
    const registrationId = maintenanceDraft?.registration.id;
    const updated = sendEmailMutation.state.result?.registration;
    sendEmailMutation.acknowledge();
    setMaintenanceDraft(null);
    if (updated) updateRegistration(updated);
    if (registrationId) {
      try { setRegistrationDetails(await getAdminRegistrationDetails(adminKey, registrationId)); }
      catch { /* detail refresh is best-effort; the list refresh below is authoritative */ }
    }
    await loadAdminData();
  };

  const submitMaintenance = async () => {
    if (!maintenanceDraft) return;
    const needsReason = maintenanceDraft.action !== 'send-email';
    if (needsReason && maintenanceDraft.reason.trim().length < 5) { setError('Informe um motivo com pelo menos 5 caracteres.'); return; }
    setActionLoading(maintenanceDraft.action); setError('');
    try { const response = await maintainAdminRegistration(adminKey, maintenanceDraft.registration.id, maintenanceDraft.action, maintenanceDraft.reason); updateRegistration(response.registration); setRegistrationDetails(await getAdminRegistrationDetails(adminKey, maintenanceDraft.registration.id)); await loadAdminData(); setActionMessage(response.message || (maintenanceDraft.action === 'cancel' ? 'Inscrição cancelada com sucesso.' : maintenanceDraft.action === 'send-email' ? 'Email de confirmação enviado com sucesso.' : 'Ação concluída com sucesso.')); setMaintenanceDraft(null); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível concluir a ação.'); }
    finally { setActionLoading(''); }
  };

  const handleRegistrationUpdate = async (registration: AdminRegistration, changes: AdminRegistrationEditable, reason: string) => {
    setActionLoading('edit'); setError('');
    try {
      const response = await updateAdminRegistration(adminKey, registration.id, changes, reason);
      updateRegistration(response.registration);
      setRegistrationDetails(await getAdminRegistrationDetails(adminKey, registration.id));
      await loadAdminData();
    }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível atualizar a inscrição.'); throw requestError; }
    finally { setActionLoading(''); }
  };

  const openRegistration = async (registration: AdminRegistration) => {
    setSelectedRegistration(registration); setRegistrationDetails(null);
    try { setRegistrationDetails(await getAdminRegistrationDetails(adminKey, registration.id)); } catch { /* resumo continua disponivel */ }
  };

  const handleBibNumber = async (registration: AdminRegistration) => {
    setBibDraft({ registration, bibNumber: registration.bibNumber || '', reason: '' });
  };

  const submitBibNumber = async () => {
    if (!bibDraft) return;
    if (!bibDraft.bibNumber.trim()) return;
    if (bibDraft.reason.trim().length < 5) { setError('Informe um motivo com pelo menos 5 caracteres.'); return; }
    setActionLoading('bib');
    try { const response = await assignAdminBibNumber(adminKey, bibDraft.registration.id, bibDraft.bibNumber, bibDraft.reason); updateRegistration(response.registration); setRegistrationDetails(await getAdminRegistrationDetails(adminKey, bibDraft.registration.id)); setBibDraft(null); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível atribuir o número de peito.'); }
    finally { setActionLoading(''); }
  };

  if (authChecking) return <main className="flex min-h-screen items-center justify-center bg-black text-brand"><Loader2 className="h-8 w-8 animate-spin" /></main>;

  if (!adminKey || error === 'Acesso administrativo não autorizado.') {
    return (
      <LoginScreen
        draftPassword={draftPassword}
        draftEmail={draftEmail}
        error={error}
        loading={loading}
        onPasswordChange={setDraftPassword}
        onEmailChange={setDraftEmail}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(215,255,0,0.12),transparent_32rem),linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-size-[auto,36px_36px,36px_36px]" />

      <div className="relative flex min-h-screen">
        <aside id="admin-sidebar" className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 w-70 border-r border-white/10 bg-zinc-950/95 px-3 py-4 backdrop-blur-sm transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0`}>
          <Sidebar
            activeNav={activeNav}
            adminRole={adminRole}
            onSelect={(key) => {
              setActiveNav(key);
              setSidebarOpen(false);
            }}
          />
        </aside>

        {sidebarOpen && (
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/70 lg:hidden"
          />
        )}

        <section className="min-w-0 flex-1">
          <Topbar
            activeNav={activeNav}
            loading={loading}
            sidebarOpen={sidebarOpen}
            onOpenSidebar={() => setSidebarOpen(true)}
            onRefresh={() => void loadAdminData()}
            onExport={() => void downloadCsv()}
            canExport={adminRole !== 'operation'}
            actor={adminActor}
            onLogout={() => void handleLogout()}
          />

          <div className="mx-auto max-w-400 px-4 pb-10 pt-4 sm:px-6 lg:px-8">
            {error && error !== 'Acesso administrativo não autorizado.' && (
              <StatusMessage tone="error" message={error} />
            )}
            {actionMessage && <StatusMessage tone="success" message={actionMessage} />}
            {activeNav === 'registrations' && googleSheetsStatus && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-zinc-950 p-4 text-xs">
                <div>
                  <span>Google Sheets: {googleSheetsStatus.configured ? 'configurado' : googleSheetsStatus.enabled ? 'configuração incompleta' : 'desativado'} · {googleSheetsStatus.counts.failed} falha(s) · {googleSheetsStatus.counts.pending} pendente(s)</span>
                  {googleSheetsStatus.remarketing?.volta10Campaign && (
                    <p className="mt-2 text-zinc-400">
                      Campanha WhatsApp: {googleSheetsStatus.remarketing.volta10Campaign.eligible} elegíveis · {googleSheetsStatus.remarketing.volta10Campaign.messagesSent} enviados · {googleSheetsStatus.remarketing.volta10Campaign.checkoutReturns} retornos · {googleSheetsStatus.remarketing.volta10Campaign.couponApplied} cupons · {googleSheetsStatus.remarketing.volta10Campaign.paymentsConfirmed} pagamentos · {currencyFormatter.format(googleSheetsStatus.remarketing.volta10Campaign.recoveredRevenueCents / 100)} recuperados
                    </p>
                  )}
                </div>
                <button type="button" disabled={!googleSheetsStatus.enabled || actionLoading === 'sheets-retry'} onClick={() => void (async () => { setActionLoading('sheets-retry'); try { const result = await retryAdminGoogleSheets(adminKey); setActionMessage(`${result.queued} sincronização(ões) reenviada(s).`); await loadAdminData(); } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Falha ao reenviar para o Google Sheets.'); } finally { setActionLoading(''); } })()} className="border border-brand/40 px-3 py-2 font-black uppercase text-brand disabled:opacity-40"><RefreshCcw className="mr-2 inline h-3 w-3" />Sincronizar com Google Sheets</button>
              </div>
            )}

            <AdminSection
              adminKey={adminKey}
              activeNav={activeNav}
              adminRole={adminRole}
              summary={summary}
              dashboard={dashboard}
              registrations={registrations}
              auditLogs={auditLogs}
              filters={filters}
              registrationPagination={registrationPagination}
              registrationEvent={registrationEvent}
              registrationEventError={registrationEventError}
              registrationEventOptions={registrationEventOptions}
              onSelectRegistrationEvent={selectRegistrationEvent}
              loading={loading}
              onFiltersChange={setFilters}
              reportFilters={reportFilters}
              onReportFiltersChange={setReportFilters}
              onSearch={handleSearch}
              onRefreshAdminData={() => void loadAdminData()}
              onOpenRegistration={(registration) => void openRegistration(registration)}
              onExport={() => void downloadCsv()}
              onRegistrationUpdated={updateRegistration}
              onSessionExpired={handleSessionExpired}
            />
          </div>
        </section>
      </div>

      <AthleteDrawer
        registration={selectedRegistration}
        actionLoading={actionLoading}
        onCheckIn={handleCheckIn}
        onKitDelivery={handleKitDelivery}
        onMaintenance={handleMaintenance}
        onUpdate={handleRegistrationUpdate}
        details={registrationDetails}
        onAssignBib={handleBibNumber}
        adminRole={adminRole}
        onClose={() => { setSelectedRegistration(null); setRegistrationDetails(null); }}
      />

      {maintenanceDraft && maintenanceDraft.action === 'send-email' && (
        <SendConfirmationEmailModal
          email={maintenanceDraft.registration.email}
          fullName={maintenanceDraft.registration.fullName}
          state={sendEmailMutation.state}
          onSubmit={() => void submitSendEmail()}
          onAcknowledge={() => void acknowledgeSendEmail()}
          onSessionExpired={handleSessionExpired}
          onClose={() => { sendEmailMutation.reset(); setMaintenanceDraft(null); }}
        />
      )}

      {maintenanceDraft && maintenanceDraft.action !== 'send-email' && (
        <ActionModal
          title={maintenanceDraft.action === 'cancel' ? 'Cancelar inscrição' : 'Confirmar ação administrativa'}
          description={maintenanceDraft.action === 'cancel'
            ? `A inscrição de ${maintenanceDraft.registration.fullName} será cancelada e a vaga será liberada.`
            : `Confirme a ação para ${maintenanceDraft.registration.fullName}.`}
          confirmLabel={actionLoading ? 'Processando...' : maintenanceDraft.action === 'cancel' ? 'Cancelar inscrição' : 'Confirmar'}
          confirmTone={maintenanceDraft.action === 'cancel' ? 'danger' : 'brand'}
          confirmDisabled={actionLoading !== '' || maintenanceDraft.reason.trim().length < 5}
          onConfirm={() => void submitMaintenance()}
          onClose={() => setMaintenanceDraft(null)}
        >
          <label className="block text-xs font-bold text-zinc-400">
            Motivo da ação <span className="font-normal text-zinc-500">(mínimo de 5 caracteres)</span>
            <textarea value={maintenanceDraft.reason} onChange={(event) => setMaintenanceDraft({ ...maintenanceDraft, reason: event.target.value })} className="mt-1 min-h-24 w-full border border-white/10 bg-black p-3 text-white" />
            <span className="mt-1 block text-right font-mono text-[10px] text-zinc-500">{maintenanceDraft.reason.trim().length}/5</span>
          </label>
        </ActionModal>
      )}

      {bibDraft && (
        <ActionModal
          title="Atribuir número de peito"
          description={`Defina o número de peito de ${bibDraft.registration.fullName} e registre o motivo da alteração.`}
          confirmLabel={actionLoading === 'bib' ? 'Salvando...' : 'Salvar número de peito'}
          confirmDisabled={actionLoading === 'bib' || !bibDraft.bibNumber.trim() || bibDraft.reason.trim().length < 5}
          onConfirm={() => void submitBibNumber()}
          onClose={() => setBibDraft(null)}
        >
          <EditInput label="Número de peito" value={bibDraft.bibNumber} onChange={(value) => setBibDraft({ ...bibDraft, bibNumber: value.toUpperCase() })} />
          <label className="block text-xs font-bold text-zinc-400">
            Motivo da atribuição
            <textarea value={bibDraft.reason} onChange={(event) => setBibDraft({ ...bibDraft, reason: event.target.value })} className="mt-1 min-h-24 w-full border border-white/10 bg-black p-3 text-white" />
          </label>
        </ActionModal>
      )}
    </main>
  );
}

function AdminSection({
  adminKey,
  activeNav,
  adminRole,
  summary,
  dashboard,
  registrations,
  auditLogs,
  filters,
  registrationPagination,
  registrationEvent,
  registrationEventError,
  registrationEventOptions,
  onSelectRegistrationEvent,
  loading,
  onFiltersChange,
  reportFilters,
  onReportFiltersChange,
  onSearch,
  onRefreshAdminData,
  onOpenRegistration,
  onExport,
  onRegistrationUpdated,
  onSessionExpired,
}: {
  adminKey: string;
  activeNav: AdminNavKey;
  adminRole: AdminRole | null;
  summary: AdminSummaryResponse | null;
  dashboard: DashboardModel;
  registrations: AdminRegistration[];
  auditLogs: AdminAuditLog[];
  filters: AdminFilters;
  registrationPagination: AdminRegistrationsResponse['pagination'];
  registrationEvent: AdminEventContext | null;
  registrationEventError: { code: string; message: string } | null;
  registrationEventOptions: AdminEventListItem[];
  onSelectRegistrationEvent: (slug: string) => void;
  loading: boolean;
  onFiltersChange: (filters: AdminFilters) => void;
  reportFilters: { dateFrom: string; dateTo: string };
  onReportFiltersChange: (filters: { dateFrom: string; dateTo: string }) => void;
  onSearch: (event: FormEvent) => void;
  onRefreshAdminData: () => void;
  onOpenRegistration: (registration: AdminRegistration) => void;
  onExport: () => void;
  onRegistrationUpdated: (registration: AdminRegistration) => void;
  onSessionExpired: () => void;
}) {
  if (!canAccessNav(adminRole, activeNav)) {
    return (
      <section className="mt-4">
        <StatusMessage tone="error" message="Seu perfil não possui permissão para acessar esta área." />
      </section>
    );
  }

  if (activeNav === 'executive') return <ExecutiveDashboardPanel adminKey={adminKey} onSessionExpired={onSessionExpired} />;
  if (activeNav === 'alerts') return <AlertsCenterPanel adminKey={adminKey} registrations={registrations} onOpenRegistration={onOpenRegistration} />;
  if (activeNav === 'monitoring') return <MonitoringPanel adminKey={adminKey} onSessionExpired={onSessionExpired} />;
  if (activeNav === 'partners') return <PartnersPanel adminKey={adminKey} />;

  if (activeNav === 'payments') {
    return (
      <>
        <ControlSummary dashboard={dashboard} registrations={registrations} loading={loading && !summary} />
        <PaymentControlPanel registrations={registrations} dashboard={dashboard} adminKey={adminKey} onRegistrationUpdated={onRegistrationUpdated} onRefreshAdminData={onRefreshAdminData} />
      </>
    );
  }

  if (activeNav === 'reconciliation') {
    return <ReconciliationPanel adminKey={adminKey} onOpenRegistration={onOpenRegistration} registrations={registrations} />;
  }

  if (activeNav === 'operation') {
    return (
      <>
        <ControlSummary dashboard={dashboard} registrations={registrations} loading={loading && !summary} />
        <OperationControlPanel registrations={registrations} auditLogs={auditLogs} onOpenRegistration={onOpenRegistration} adminKey={adminKey} onRegistrationUpdated={onRegistrationUpdated} onRefreshAdminData={onRefreshAdminData} />
      </>
    );
  }

  if (activeNav === 'reports') {
    return (
      <>
        <ControlSummary dashboard={dashboard} registrations={registrations} loading={loading && !summary} />
        <ReportsPanel summary={summary} dashboard={dashboard} registrations={registrations} reportFilters={reportFilters} onReportFiltersChange={onReportFiltersChange} onExport={onExport} />
      </>
    );
  }

  if (activeNav === 'audit') {
    return (
      <>
        <ControlSummary dashboard={dashboard} registrations={registrations} loading={loading && !summary} />
        <AuditPanel auditLogs={auditLogs} adminKey={adminKey} registrations={registrations} onOpenRegistration={onOpenRegistration} />
      </>
    );
  }
  if (activeNav === 'event') return <EventManagementPanel adminKey={adminKey} />;

  return (
    <>
      <ControlSummary dashboard={dashboard} registrations={registrations} loading={loading && !summary} />
      <RegistrationsPanel
        adminKey={adminKey}
        adminRole={adminRole}
        summary={summary}
        registrations={registrations}
        filters={filters}
        pagination={registrationPagination}
        event={registrationEvent}
        eventError={registrationEventError}
        eventOptions={registrationEventOptions}
        onSelectEvent={onSelectRegistrationEvent}
        loading={loading}
        onFiltersChange={onFiltersChange}
        onSearch={onSearch}
        onOpenRegistration={onOpenRegistration}
      />
    </>
  );
}

function LoginScreen({
  draftPassword,
  draftEmail,
  error,
  loading,
  onPasswordChange,
  onEmailChange,
  onSubmit,
}: {
  draftPassword: string;
  draftEmail: string;
  error: string;
  loading: boolean;
  onPasswordChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="flex min-h-screen items-center bg-black px-4 py-12 text-white sm:px-6 md:py-20">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,rgba(215,255,0,0.14),transparent_28rem)]" />
      <form onSubmit={onSubmit} aria-busy={loading} className="relative mx-auto w-full max-w-xl border border-white/10 bg-zinc-950/95 p-5 shadow-2xl sm:p-8 md:p-12">
        <ShieldCheck className="mb-8 h-12 w-12 text-brand" />
        <p className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-brand">Centro de comando</p>
        <h1 className="mb-4 font-display text-[clamp(2.6rem,12vw,3rem)] font-black uppercase leading-none tracking-tighter">Admin FunPace Run</h1>
        <p className="mb-8 font-mono text-sm leading-relaxed text-zinc-400">
          Acesse vendas, inscrições, lotes, pagamentos e operação do evento com email e senha administrativa.
        </p>
        <div>
          <input
            type="email"
            required
            disabled={loading}
            autoComplete="username"
            value={draftEmail}
            onChange={(event) => onEmailChange(event.target.value)}
            className="mb-3 w-full border border-zinc-800 bg-black px-4 py-4 text-white outline-none transition-colors focus:border-brand"
            placeholder="Email administrativo"
          />
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input type="password" required disabled={loading} autoComplete="current-password" value={draftPassword} onChange={(event) => onPasswordChange(event.target.value)} className="w-full border border-zinc-800 bg-black py-4 pl-11 pr-4 text-white outline-none transition-colors focus:border-brand disabled:cursor-wait disabled:opacity-70" placeholder="Senha administrativa" />
          </div>
        </div>
        {error && <p className="mt-4 text-sm font-bold uppercase tracking-wider text-brand">{error}</p>}
        <button disabled={loading} className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 bg-brand p-4 text-sm font-black uppercase tracking-widest text-black transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-70">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Entrando...</> : <>Entrar no painel <ChevronRight className="h-4 w-4" /></>}
        </button>
      </form>
    </main>
  );
}

function getNavLabel(key: AdminNavKey) {
  return navItems.find((item) => item.key === key)?.label || 'Admin';
}

function Sidebar({ activeNav, adminRole, onSelect }: { activeNav: AdminNavKey; adminRole: AdminRole | null; onSelect: (key: AdminNavKey) => void }) {
  const visibleNavItems = adminRole ? navItems.filter((item) => navPermissions[item.key].includes(adminRole)) : navItems;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-5 border-b border-white/10 px-3 pb-5">
        <p className="font-display text-xl font-black uppercase tracking-tighter">FunPace</p>
        <p className="mt-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Run Operations</p>
      </div>

      <nav aria-label="Navegação administrativa" className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.key;

            return (
              <button
                type="button"
                key={item.key}
                onClick={() => onSelect(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-sm font-bold transition-colors ${active ? 'bg-brand text-black' : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                  }`}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.status === 'soon' && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${active ? 'bg-black/10 text-black' : 'bg-white/5 text-zinc-400'}`}>
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-4 border-t border-white/10 px-3 pt-4">
        <div className="rounded border border-white/10 bg-white/3 p-3">
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Evento ativo</p>
          <p className="mt-2 text-sm font-bold">{eventInfo.name}</p>
          <p className="mt-1 font-mono text-xs text-zinc-500">{eventInfo.city} - {eventInfo.state}</p>
        </div>
      </div>
    </div>
  );
}

function Topbar({
  activeNav,
  loading,
  sidebarOpen,
  onOpenSidebar,
  onRefresh,
  onExport,
  canExport,
  actor,
  onLogout,
}: {
  activeNav: AdminNavKey;
  loading: boolean;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onRefresh: () => void;
  onExport: () => void;
  canExport: boolean;
  actor: string;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-black/85 px-4 py-3 backdrop-blur-sm sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-400 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Abrir menu"
            aria-expanded={sidebarOpen}
            aria-controls="admin-sidebar"
            onClick={onOpenSidebar}
            className="flex h-10 w-10 items-center justify-center border border-white/10 bg-white/3 lg:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          {/* ADMIN-002 Stage 7B §20: the page-level heading is the panel's own
              <h1>; this line is a contextual label, not a competing heading. */}
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-brand">{getNavLabel(activeNav)}</p>
            <p className="truncate text-sm font-bold text-zinc-300 sm:text-base">Centro de operações FunPace Run</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs font-bold text-zinc-400 md:inline">{actor}</span>
          {activeNav !== 'partners' && <button
            type="button"
            onClick={onRefresh}
            className="flex min-h-10 items-center gap-2 border border-white/10 bg-white/3 px-3 text-xs font-bold uppercase tracking-widest text-zinc-200 transition-colors hover:border-brand"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            <span className="hidden sm:inline">Atualizar</span>
          </button>}
          <button type="button" onClick={onLogout} className="min-h-10 border border-white/10 px-3 text-xs font-bold uppercase text-zinc-300 hover:border-red-400 hover:text-red-300">Sair</button>
          {activeNav !== 'partners' && canExport && <button
            type="button"
            onClick={onExport}
            className="flex min-h-10 items-center gap-2 bg-brand px-3 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-white"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar</span>
          </button>}
        </div>
      </div>
    </header>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  detail,
  trend,
  loading,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  detail: string;
  // ADMIN-002 Stage 7B: no fake/hardcoded trend indicator. When a real
  // period-over-period comparison exists it can be passed; otherwise omit it and
  // no arrow renders. The Executive Dashboard omits it.
  trend?: 'up' | 'neutral';
  loading: boolean;
}) {
  return (
    <div className="border border-white/10 bg-zinc-950/80 p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <dl className="min-w-0 flex-1">
          <dt className="text-xs font-black uppercase tracking-widest text-zinc-400">{label}</dt>
          {loading ? (
            <dd className="mt-4 h-8 w-24 animate-pulse bg-white/10" aria-hidden="true" />
          ) : (
            <dd className="mt-3 font-mono text-2xl font-black break-words text-white">{value}</dd>
          )}
        </dl>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/10 bg-white/3">
          <Icon aria-hidden="true" className="h-5 w-5 text-brand" />
        </div>
      </div>
      <p className="mt-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
        {trend === 'up' ? <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-brand" /> : trend === 'neutral' ? <ArrowDownRight aria-hidden="true" className="h-3.5 w-3.5 text-zinc-500" /> : null}
        <span>{detail}</span>
      </p>
    </div>
  );
}

function ControlSummary({
  dashboard,
  registrations: _registrations,
  loading,
}: {
  dashboard: DashboardModel;
  registrations: AdminRegistration[];
  loading: boolean;
}) {
  const cards: Array<{
    label: string;
    value: string | number;
    icon: LucideIcon;
    detail: string;
    trend: 'up' | 'neutral';
  }> = [
      { label: 'Pagas', value: dashboard.paidRegistrations, icon: BadgeCheck, detail: 'Inscrições confirmadas', trend: 'up' },
      { label: 'Pendentes', value: dashboard.pendingPayments, icon: TimerReset, detail: 'Aguardando pagamento', trend: 'neutral' },
      // ADMIN-002 Stage 1: financial card only when the role may see revenue.
      ...(dashboard.financialVisible
        ? [{ label: 'Receita', value: currencyFormatter.format(dashboard.revenueCents / 100), icon: WalletCards, detail: 'Pagamentos aprovados', trend: 'up' as const }]
        : []),
      { label: 'Emails pendentes', value: dashboard.paidWithoutEmail, icon: Mail, detail: 'Confirmação não enviada', trend: 'neutral' },
      { label: 'Kits entregues', value: dashboard.kitDeliveries, icon: Shirt, detail: 'Retirada registrada', trend: 'neutral' },
      { label: 'Check-ins', value: dashboard.checkIns, icon: ClipboardCheck, detail: 'Presença registrada', trend: 'neutral' },
    ];

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map((card) => (
        <KpiCard
          key={card.label}
          label={card.label}
          value={card.value}
          icon={card.icon}
          detail={card.detail}
          trend={card.trend}
          loading={loading}
        />
      ))}
    </section>
  );
}

function PaymentControlPanel({
  registrations,
  dashboard,
  adminKey,
  onRegistrationUpdated,
  onRefreshAdminData,
}: {
  registrations: AdminRegistration[];
  dashboard: DashboardModel;
  adminKey: string;
  onRegistrationUpdated: (registration: AdminRegistration) => void;
  onRefreshAdminData: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'divergent' | 'pending' | 'expired' | 'manual' | 'email'>('all');
  const [details, setDetails] = useState<AdminPaymentDetailsResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [paymentRows, setPaymentRows] = useState<AdminRegistration[]>([]);
  const [orphanEvents, setOrphanEvents] = useState<AdminPaymentEvent[]>([]);
  const [paymentPagination, setPaymentPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [paymentFilters, setPaymentFilters] = useState({ q: '', method: '', dateFrom: '', dateTo: '', page: '1', pageSize: '25' });
  const [orphanDraft, setOrphanDraft] = useState<{ event: AdminPaymentEvent; registrationId: string; reason: string } | null>(null);
  const paid = registrations.filter((registration) => registration.status === 'paid');
  const pending = registrations.filter((registration) => registration.status === 'pending_payment');
  const failed = registrations.filter((registration) => ['payment_failed', 'expired', 'cancelled', 'refunded'].includes(registration.status));
  const paidWithoutEmail = paid.filter((registration) => !registration.confirmationEmailSentAt);
  const filtered = paymentRows;
  useEffect(() => {
    const status = filter === 'pending' ? 'pending_payment' : filter === 'all' ? '' : filter;
    void getAdminPayments(adminKey, { ...paymentFilters, status }).then((response) => { setPaymentRows(response.payments); setPaymentPagination(response.pagination); setOrphanEvents(response.orphanEvents); }).catch((error) => setActionError(error instanceof ApiError ? error.message : 'Não foi possível carregar os pagamentos.'));
  }, [adminKey, filter, paymentFilters.q, paymentFilters.method, paymentFilters.dateFrom, paymentFilters.dateTo, paymentFilters.page, paymentFilters.pageSize]);

  const exportPayments = async () => {
    const status = filter === 'pending' ? 'pending_payment' : filter === 'all' ? '' : filter;
    try {
      const response = await fetch(getAdminPaymentsCsvUrl({ ...paymentFilters, status }), { credentials: 'include' });
      if (!response.ok) throw new Error('Não foi possível exportar pagamentos.');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'funpace-run-pagamentos.csv'; link.click(); URL.revokeObjectURL(url);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Não foi possível exportar pagamentos.'); }
  };
  const linkOrphan = async (event: AdminPaymentEvent) => {
    setOrphanDraft({ event, registrationId: '', reason: '' });
  };

  const submitOrphanLink = async () => {
    if (!orphanDraft?.registrationId.trim() || orphanDraft.reason.trim().length < 5) { setActionError('Informe a inscrição e um motivo com pelo menos 5 caracteres.'); return; }
    try { await linkAdminOrphanPayment(adminKey, orphanDraft.event.id, orphanDraft.registrationId, orphanDraft.reason); setOrphanEvents((current) => current.filter((item) => item.id !== orphanDraft.event.id)); setOrphanDraft(null); await onRefreshAdminData(); }
    catch (error) { setActionError(error instanceof ApiError ? error.message : 'Não foi possível vincular o evento.'); }
  };

  const openDetails = async (registration: AdminRegistration) => {
    setDetailLoading(true); setActionError('');
    try { setDetails(await getAdminPaymentDetails(adminKey, registration.id)); }
    catch (error) { setActionError(error instanceof ApiError ? error.message : 'Não foi possível carregar o pagamento.'); }
    finally { setDetailLoading(false); }
  };

  const reconcile = async () => {
    if (!details) return;
    setDetailLoading(true); setActionError('');
    try {
      const response = await reconcileAdminPayment(adminKey, details.payment.id, reason);
      onRegistrationUpdated(response.registration);
      setDetails(await getAdminPaymentDetails(adminKey, response.registration.id));
      setPaymentRows((current) => current.map((item) => item.id === response.registration.id ? response.registration : item));
      setReason('');
      await onRefreshAdminData();
    } catch (error) { setActionError(error instanceof ApiError ? error.message : 'Não foi possível conciliar o pagamento.'); }
    finally { setDetailLoading(false); }
  };

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Panel title="Conciliação" eyebrow="Pagamentos">
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricBox label="Pagos" value={paid.length} detail={currencyFormatter.format(dashboard.revenueCents / 100)} />
          <MetricBox label="Pendentes" value={pending.length} detail="Aguardando gateway" />
          <MetricBox label="Não aprovados" value={failed.length} detail="Falha, expirado ou cancelado" />
          <MetricBox label="Pagos sem email" value={paidWithoutEmail.length} detail="Exige envio" tone={paidWithoutEmail.length > 0 ? 'warning' : 'default'} />
        </div>
        <div className="mt-4">
          <RevenueChart data={dashboard.dailyRevenue} />
        </div>
      </Panel>

      <Panel title="Últimos pagamentos" eyebrow="Controle operacional">
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <input value={paymentFilters.q} onChange={(event) => setPaymentFilters({ ...paymentFilters, q: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" placeholder="Atleta, inscrição ou transação" />
          <input value={paymentFilters.method} onChange={(event) => setPaymentFilters({ ...paymentFilters, method: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" placeholder="Método: pix, cartão..." />
          <input type="date" value={paymentFilters.dateFrom} onChange={(event) => setPaymentFilters({ ...paymentFilters, dateFrom: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" aria-label="Data inicial" />
          <input type="date" value={paymentFilters.dateTo} onChange={(event) => setPaymentFilters({ ...paymentFilters, dateTo: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" aria-label="Data final" />
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {([['all', 'Todos'], ['divergent', 'Divergentes'], ['pending', 'Pendentes'], ['expired', 'Expirados'], ['manual', 'Manuais'], ['email', 'Sem email']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => { setFilter(value); setPaymentFilters({ ...paymentFilters, page: '1' }); }} className={`border px-3 py-2 text-xs font-black uppercase ${filter === value ? 'border-brand text-brand' : 'border-white/10 text-zinc-400'}`}>{label}</button>
          ))}
          <button type="button" onClick={() => void exportPayments()} className="ml-auto border border-brand px-3 py-2 text-xs font-black uppercase text-brand"><Download className="mr-1 inline h-3 w-3" /> Exportar</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-190 text-left">
            <thead className="bg-black/50 text-xs uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="p-3">Atleta</th>
                <th className="p-3">Status</th>
                <th className="p-3">Email</th>
                <th className="p-3">Valor</th>
                <th className="p-3">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((registration) => (
                <tr key={registration.id} className="border-t border-white/10">
                  <td className="p-3">
                    <p className="font-bold">{registration.fullName}</p>
                    <p className="mt-1 font-mono text-xs text-zinc-500">{registration.id}</p>
                  </td>
                  <td className="p-3"><PaymentStatus status={registration.status} /></td>
                  <td className="p-3 text-xs font-bold uppercase tracking-widest text-zinc-400">
                    {registration.confirmationEmailSentAt ? 'Enviado' : registration.status === 'paid' ? 'Pendente' : 'Não aplicável'}
                  </td>
                  <td className="p-3 font-mono font-bold">{currencyFormatter.format(registration.amountCents / 100)}</td>
                  <td className="p-3 font-mono text-xs text-zinc-500">{dateTimeFormatter.format(new Date(registration.createdAt))}</td>
                  <td className="p-3 text-xs text-zinc-400">
                    <p>{registration.gatewayStatus || 'Gateway não informado'}</p>
                    <p className="mt-1 uppercase">{registration.paymentMethod || 'Método não informado'}</p>
                    {registration.paidAt && <p className="mt-1 font-mono">Pago: {dateTimeFormatter.format(new Date(registration.paidAt))}</p>}
                    {registration.hasPaymentDivergence && <p className="mt-1 font-black text-red-300">Inconsistência detectada entre pagamento e inscrição.</p>}
                    <button type="button" onClick={() => void openDetails(registration)} className="mt-2 inline-flex items-center gap-1 border border-white/10 px-2 py-1 hover:border-brand hover:text-brand"><Eye className="h-3 w-3" /> Detalhes</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-zinc-400">
          <button type="button" disabled={paymentPagination.page <= 1} onClick={() => setPaymentFilters({ ...paymentFilters, page: String(paymentPagination.page - 1) })} className="border border-white/10 px-3 py-2 disabled:opacity-30">Anterior</button>
          <span>{paymentPagination.total} pagamentos · página {paymentPagination.page}/{paymentPagination.totalPages}</span>
          <button type="button" disabled={paymentPagination.page >= paymentPagination.totalPages} onClick={() => setPaymentFilters({ ...paymentFilters, page: String(paymentPagination.page + 1) })} className="border border-white/10 px-3 py-2 disabled:opacity-30">Próxima</button>
        </div>
      </Panel>
      {orphanEvents.length > 0 && <Panel title="Eventos sem inscrição" eyebrow="Exigem conferência"><div className="space-y-2">{orphanEvents.slice(0, 20).map((event) => <div key={event.id} className="border border-red-400/20 bg-red-400/5 p-3"><p className="font-bold text-red-200">{event.providerEventId}</p><p className="mt-1 font-mono text-xs text-zinc-500">{dateTimeFormatter.format(new Date(event.receivedAt))}</p><pre className="mt-2 max-h-32 overflow-auto text-xs text-zinc-400">{JSON.stringify(event.payload, null, 2)}</pre><button type="button" onClick={() => void linkOrphan(event)} className="mt-2 border border-red-300/30 px-3 py-2 text-xs font-black uppercase text-red-200">Vincular à inscrição</button></div>)}</div></Panel>}
      {(details || detailLoading || actionError) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/75">
          <button type="button" aria-label="Fechar" className="absolute inset-0" onClick={() => { setDetails(null); setActionError(''); }} />
          <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-zinc-950 p-5">
            <div className="flex justify-between"><h2 className="text-xl font-black">Detalhes do pagamento</h2><button type="button" onClick={() => { setDetails(null); setActionError(''); }}><X /></button></div>
            {detailLoading && !details && <p className="mt-6 text-zinc-400">Carregando...</p>}
            {actionError && <p className="mt-4 border border-red-400/20 bg-red-400/10 p-3 text-red-200">{actionError}</p>}
            {details && <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Detail label="Inscrição" value={details.payment.id} /><Detail label="Atleta" value={details.payment.fullName} />
                <Detail label="Status sistema" value={statusLabels[details.payment.status]} /><Detail label="Status gateway" value={details.payment.gatewayStatus || 'Não informado'} />
                <Detail label="Transação InfinitePay" value={details.payment.gatewayTransactionId || details.payment.providerPaymentId || 'Não informada'} /><Detail label="Método" value={details.payment.paymentMethod || 'Não informado'} />
                <Detail label="Cupom" value={details.payment.couponCode || 'Não utilizado'} /><Detail label="Valor original" value={currencyFormatter.format((details.payment.originalPriceCents ?? details.payment.amountCents) / 100)} />
                <Detail label="Desconto" value={`${details.payment.discountPercentage || 0}% · ${currencyFormatter.format((details.payment.discountAmountCents || 0) / 100)}`} /><Detail label="Valor final" value={currencyFormatter.format(details.payment.amountCents / 100)} />
                {details.payment.couponAppliedAt && <Detail label="Cupom aplicado em" value={dateTimeFormatter.format(new Date(details.payment.couponAppliedAt))} />}
                {details.payment.couponUsedAt && <Detail label="Cupom utilizado em" value={dateTimeFormatter.format(new Date(details.payment.couponUsedAt))} />}
              </div>
              <p className="mb-2 mt-5 text-xs font-black uppercase text-zinc-500">Payload do gateway</p>
              <pre className="max-h-72 overflow-auto border border-white/10 bg-black p-3 text-xs text-zinc-300">{JSON.stringify(details.gatewayPayload, null, 2) || 'Nenhum payload recebido'}</pre>
              <p className="mb-2 mt-5 text-xs font-black uppercase text-zinc-500">Eventos ({details.events.length})</p>
              {details.events.map((event) => <div key={event.id} className="border-t border-white/10 py-3"><p className="font-bold">{event.eventType}</p><p className="font-mono text-xs text-zinc-500">{dateTimeFormatter.format(new Date(event.receivedAt))} · {event.providerEventId}</p></div>)}
              {details.payment.status !== 'paid' && <div className="mt-5 border border-amber-400/20 p-4"><label className="text-xs font-black uppercase text-amber-200">Motivo da conciliacao manual</label><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-24 w-full border border-white/10 bg-black p-3" /><button type="button" disabled={detailLoading || reason.trim().length < 5} onClick={() => void reconcile()} className="mt-3 bg-brand px-4 py-3 text-xs font-black uppercase text-black disabled:opacity-40">Marcar como pago e conciliar</button></div>}
            </>}
          </aside>
        </div>
      )}
      {orphanDraft && (
        <ActionModal
          title="Vincular evento orfão"
          description="Informe a inscrição correta e o motivo da vinculação manual."
          confirmLabel="Vincular evento"
          confirmDisabled={!orphanDraft.registrationId.trim() || orphanDraft.reason.trim().length < 5}
          onConfirm={() => void submitOrphanLink()}
          onClose={() => setOrphanDraft(null)}
        >
          <EditInput label="ID da inscrição" value={orphanDraft.registrationId} onChange={(value) => setOrphanDraft({ ...orphanDraft, registrationId: value })} />
          <label className="block text-xs font-bold text-zinc-400">
            Motivo da vinculação
            <textarea value={orphanDraft.reason} onChange={(event) => setOrphanDraft({ ...orphanDraft, reason: event.target.value })} className="mt-1 min-h-24 w-full border border-white/10 bg-black p-3 text-white" />
          </label>
        </ActionModal>
      )}
    </div>
  );
}

function OperationControlPanel({
  registrations,
  auditLogs,
  onOpenRegistration,
  adminKey,
  onRegistrationUpdated,
  onRefreshAdminData,
}: {
  registrations: AdminRegistration[];
  auditLogs: AdminAuditLog[];
  onOpenRegistration: (registration: AdminRegistration) => void;
  adminKey: string;
  onRegistrationUpdated: (registration: AdminRegistration) => void;
  onRefreshAdminData: () => void;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'kit_pending' | 'checkin_pending' | 'completed'>('all');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const [operationRows, setOperationRows] = useState<AdminRegistration[]>([]);
  const [operationTotals, setOperationTotals] = useState({ paid: 0, kitPending: 0, checkInPending: 0, completed: 0 });
  const [operationPagination, setOperationPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [operationPage, setOperationPage] = useState(1);
  const [busyAction, setBusyAction] = useState('');
  const [operationError, setOperationError] = useState('');
  const [quickActionDraft, setQuickActionDraft] = useState<{ registration: AdminRegistration; action: 'check-in' | 'kit'; notes: string } | null>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void getAdminOperation(adminKey, { q: query, filter: statusFilter, page: String(operationPage), pageSize: '25' }).then((response) => { setOperationRows(response.registrations); setOperationTotals(response.totals); setOperationPagination(response.pagination); });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [adminKey, query, statusFilter, operationPage]);
  useEffect(() => { setOperationPage(1); }, [query, statusFilter]);

  const quickAction = async (registration: AdminRegistration, action: 'check-in' | 'kit') => {
    setQuickActionDraft({ registration, action, notes: '' });
  };

  const submitQuickAction = async () => {
    if (!quickActionDraft) return;
    const key = `${quickActionDraft.registration.id}:${quickActionDraft.action}`; setBusyAction(key); setOperationError('');
    try {
      const response = quickActionDraft.action === 'check-in' ? await checkInAdminRegistration(adminKey, quickActionDraft.registration.id, quickActionDraft.notes) : await deliverAdminKit(adminKey, quickActionDraft.registration.id, quickActionDraft.notes);
      onRegistrationUpdated(response.registration);
      const refreshed = await getAdminOperation(adminKey, { q: query, filter: statusFilter, page: String(operationPage), pageSize: '25' });
      setOperationRows(refreshed.registrations); setOperationTotals(refreshed.totals); setOperationPagination(refreshed.pagination);
      setQuickActionDraft(null);
      await onRefreshAdminData();
    } catch (error) { setOperationError(error instanceof ApiError ? error.message : 'Não foi possível concluir a operação.'); }
    finally { setBusyAction(''); }
  };

  const openFromCode = (rawCode: string) => {
    const code = rawCode.trim();
    const registrationId = code.startsWith('funpace:registration:') ? code.slice('funpace:registration:'.length) : code;
    const normalized = normalizeSearch(registrationId);
    const registration = registrations.find((item) => item.id === registrationId || normalizeSearch(item.bibNumber || '') === normalized);
    if (!registration) { setScanError('Inscrição não encontrada. Confira o QR ou número de peito.'); return; }
    setScanError(''); setScannerOpen(false); onOpenRegistration(registration);
  };

  return (
    <section className="mt-4 grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
      <Panel title="Controle presencial" eyebrow="Operação">
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricBox label="Aptos para operação" value={operationTotals.paid} detail="Inscrições pagas" />
          <MetricBox label="Kit pendente" value={operationTotals.kitPending} detail="Ainda não retirado" tone={operationTotals.kitPending > 0 ? 'warning' : 'default'} />
          <MetricBox label="Check-in pendente" value={operationTotals.checkInPending} detail="Ainda não realizado" tone={operationTotals.checkInPending > 0 ? 'warning' : 'default'} />
          <MetricBox label="Concluídos" value={operationTotals.completed} detail="Kit + check-in" />
        </div>

        <div className="mt-4 border border-white/10 bg-black/35 p-4">
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Busca rápida</p>
          <div className="relative mt-3">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-12 w-full border border-zinc-800 bg-black py-3 pl-11 pr-4 text-white outline-none transition-colors focus:border-brand"
              placeholder="Nome, CPF, e-mail, telefone, ID ou peito"
            />
          </div>
          <button type="button" onClick={() => { setScanError(''); setScannerOpen(true); }} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 bg-brand px-4 text-xs font-black uppercase text-black"><ScanLine className="h-4 w-4" /> Ler QR Code</button>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <OperationFilterButton active={statusFilter === 'all'} label="Todos pagos" onClick={() => setStatusFilter('all')} />
            <OperationFilterButton active={statusFilter === 'kit_pending'} label="Kit pendente" onClick={() => setStatusFilter('kit_pending')} />
            <OperationFilterButton active={statusFilter === 'checkin_pending'} label="Check-in pendente" onClick={() => setStatusFilter('checkin_pending')} />
            <OperationFilterButton active={statusFilter === 'completed'} label="Concluídos" onClick={() => setStatusFilter('completed')} />
          </div>
        </div>

        <div className="mt-4">
          <OperationsPanel auditLogs={auditLogs} />
        </div>
      </Panel>

      <Panel title="Fila de atendimento" eyebrow="Kit e check-in" action={`${operationPagination.total} atletas`}>
        {operationError && <p className="mb-3 border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">{operationError}</p>}
        <OperationalQueue registrations={operationRows} onOpenRegistration={onOpenRegistration} onQuickAction={quickAction} busyAction={busyAction} />
        <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-zinc-400"><button disabled={operationPagination.page <= 1} onClick={() => setOperationPage((page) => page - 1)} className="border border-white/10 px-3 py-2 disabled:opacity-30">Anterior</button><span>Pagina {operationPagination.page}/{operationPagination.totalPages}</span><button disabled={operationPagination.page >= operationPagination.totalPages} onClick={() => setOperationPage((page) => page + 1)} className="border border-white/10 px-3 py-2 disabled:opacity-30">Proxima</button></div>
      </Panel>
      {scannerOpen && <QrScannerModal error={scanError} onDetected={openFromCode} onClose={() => setScannerOpen(false)} />}
      {quickActionDraft && (
        <ActionModal
          title={quickActionDraft.action === 'check-in' ? 'Confirmar check-in' : 'Confirmar entrega de kit'}
          description={`Confirme a operação para ${quickActionDraft.registration.fullName}.`}
          confirmLabel={quickActionDraft.action === 'check-in' ? 'Registrar check-in' : 'Registrar entrega'}
          onConfirm={() => void submitQuickAction()}
          onClose={() => setQuickActionDraft(null)}
        >
          <label className="block text-xs font-bold text-zinc-400">
            Observacao da operação
            <textarea value={quickActionDraft.notes} onChange={(event) => setQuickActionDraft({ ...quickActionDraft, notes: event.target.value })} className="mt-1 min-h-24 w-full border border-white/10 bg-black p-3 text-white" />
          </label>
        </ActionModal>
      )}
    </section>
  );
}

function QrScannerModal({ error, onDetected, onClose }: { error: string; onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState('');

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);
  useEffect(() => {
    if (!videoRef.current) return undefined;
    const scanner = new QrScanner(videoRef.current, (result) => onDetectedRef.current(result.data), {
      preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true,
    });
    void scanner.start().catch(() => setCameraError('Não foi possível acessar a câmera. Use HTTPS, permita a câmera ou informe o código manualmente.'));
    return () => { scanner.stop(); scanner.destroy(); };
  }, []);

  return <div className="fixed inset-0 z-60 flex items-end justify-center bg-black/85 p-0 sm:items-center sm:p-5">
    <div className="w-full max-w-xl border border-white/10 bg-zinc-950 p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-black uppercase text-brand">Atendimento</p><h2 className="mt-1 text-xl font-black">Ler QR Code</h2></div><button type="button" onClick={onClose}><X /></button></div>
      <div className="overflow-hidden border border-white/10 bg-black"><video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline /></div>
      {(cameraError || error) && <p className="mt-3 border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">{cameraError || error}</p>}
      <form onSubmit={(event) => { event.preventDefault(); onDetected(manualCode); }} className="mt-4 flex gap-2">
        <input value={manualCode} onChange={(event) => setManualCode(event.target.value)} className="min-h-12 min-w-0 flex-1 border border-white/10 bg-black px-3 text-white" placeholder="ID ou numero de peito" />
        <button type="submit" disabled={!manualCode.trim()} className="bg-brand px-4 text-xs font-black uppercase text-black disabled:opacity-40">Abrir</button>
      </form>
    </div>
  </div>;
}

function OperationFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 border px-3 text-left text-xs font-black uppercase tracking-widest transition-colors ${active ? 'border-brand bg-brand text-black' : 'border-white/10 bg-white/3 text-zinc-300 hover:border-brand hover:text-brand'
        }`}
    >
      {label}
    </button>
  );
}

function OperationalQueue({
  registrations,
  onOpenRegistration,
  onQuickAction,
  busyAction,
}: {
  registrations: AdminRegistration[];
  onOpenRegistration: (registration: AdminRegistration) => void;
  onQuickAction: (registration: AdminRegistration, action: 'check-in' | 'kit') => Promise<void>;
  busyAction: string;
}) {
  if (registrations.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-190 text-left">
        <thead className="bg-black/50 text-xs uppercase tracking-widest text-zinc-500">
          <tr>
            <th className="p-3">Atleta</th>
            <th className="p-3">Prova</th>
            <th className="p-3">Kit</th>
            <th className="p-3">Check-in</th>
            <th className="p-3 text-right">Acao</th>
          </tr>
        </thead>
        <tbody>
          {registrations.map((registration) => (
            <tr key={registration.id} className="border-t border-white/10">
              <td className="p-3">
                <p className="font-bold">{registration.fullName}</p>
                <p className="mt-1 font-mono text-xs text-zinc-500">{registration.cpfMasked}</p>
                {registration.bibNumber && <p className="mt-1 text-xs font-black uppercase text-brand">Peito {registration.bibNumber}</p>}
              </td>
              <td className="p-3 text-sm font-bold text-zinc-300">{registration.distance} / camisa {registration.shirtSize}</td>
              <td className="p-3 text-xs font-black uppercase tracking-widest text-zinc-400">
                {registration.kitStatus === 'delivered' ? 'Entregue' : 'Pendente'}
              </td>
              <td className="p-3 text-xs font-black uppercase tracking-widest text-zinc-400">
                {registration.checkInStatus === 'checked_in' ? 'Realizado' : 'Pendente'}
              </td>
              <td className="p-3 text-right">
                <div className="mb-2 flex justify-end gap-1">
                  {registration.kitStatus !== 'delivered' && <button type="button" disabled={busyAction !== ''} onClick={() => void onQuickAction(registration, 'kit')} className="border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-zinc-300 disabled:opacity-30">Kit</button>}
                  {registration.checkInStatus !== 'checked_in' && <button type="button" disabled={busyAction !== ''} onClick={() => void onQuickAction(registration, 'check-in')} className="border border-brand/30 px-2 py-1 text-[10px] font-black uppercase text-brand disabled:opacity-30">Check-in</button>}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenRegistration(registration)}
                  className="inline-flex min-h-10 items-center gap-2 border border-white/10 px-3 text-xs font-black uppercase tracking-widest text-zinc-200 transition-colors hover:border-brand hover:text-brand"
                >
                  <Eye className="h-4 w-4" /> Abrir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsPanel({
  summary,
  dashboard,
  registrations,
  reportFilters,
  onReportFiltersChange,
  onExport,
}: {
  summary: AdminSummaryResponse | null;
  dashboard: DashboardModel;
  registrations: AdminRegistration[];
  reportFilters: { dateFrom: string; dateTo: string };
  onReportFiltersChange: (filters: { dateFrom: string; dateTo: string }) => void;
  onExport: () => void;
}) {
  const [exportError, setExportError] = useState('');
  const [exportFilters, setExportFilters] = useState({ status: '', lotId: '', distanceId: '', city: '', gender: '', payment: '' });
  const paidRegistrations = registrations.filter((registration) => registration.status === 'paid');
  const pendingRegistrations = registrations.filter((registration) => registration.status === 'pending_payment');
  const confirmationEmailMissing = paidRegistrations.filter((registration) => !registration.confirmationEmailSentAt);
  const confirmationEmailFailed = paidRegistrations.filter((registration) => registration.confirmationEmailError);
  const kitDelivered = paidRegistrations.filter((registration) => registration.kitStatus === 'delivered');
  const checkIns = paidRegistrations.filter((registration) => registration.checkInStatus === 'checked_in');
  const distanceRows = summary?.byDistance.map((distance) => ({
    label: distance.name,
    total: distance.total,
    paid: distance.paid,
    pending: distance.pending,
  })) || [];
  const reportCards = [
    { label: 'Inscritos pagos', value: dashboard.paidRegistrations, detail: currencyFormatter.format(dashboard.revenueCents / 100), icon: BadgeCheck },
    { label: 'Inscritos pendentes', value: dashboard.pendingPayments, detail: 'Aguardando pagamento', icon: TimerReset },
    { label: 'Pagamentos confirmados', value: dashboard.paidRegistrations, detail: 'Banco + gateway', icon: CreditCard },
    { label: 'Conciliados manualmente', value: summary?.totals.manualReconciledPayments ?? 0, detail: 'Ajustes auditados', icon: ShieldCheck },
    { label: 'Emails enviados', value: summary?.totals.confirmationEmailsSent ?? 0, detail: 'Confirmacao', icon: Mail },
    { label: 'Emails pendentes/falhos', value: summary?.totals.confirmationEmailsAttention ?? 0, detail: 'Exigem conferencia', icon: Activity },
    { label: 'Kits retirados', value: dashboard.kitDeliveries, detail: `${Math.max(dashboard.paidRegistrations - dashboard.kitDeliveries, 0)} pendentes`, icon: Shirt },
    { label: 'Check-ins', value: dashboard.checkIns, detail: `${Math.max(dashboard.paidRegistrations - dashboard.checkIns, 0)} pendentes`, icon: ClipboardCheck },
  ];
  const alerts = [
    (summary?.totals.paidWithoutEmail ?? 0) > 0 ? `${summary?.totals.paidWithoutEmail ?? 0} inscritos pagos sem email de confirmacao.` : '',
    (summary?.totals.confirmationEmailsFailed ?? 0) > 0 ? `${summary?.totals.confirmationEmailsFailed ?? 0} emails de confirmacao com erro registrado.` : '',
    dashboard.pendingPayments > 0 ? `${dashboard.pendingPayments} inscricoes ainda pendentes de pagamento.` : '',
  ].filter(Boolean);
  const exportReport = async (url: string, filename: string) => {
    setExportError('');
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || 'Não foi possível exportar o relatório.');
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Não foi possível exportar o relatório.');
    }
  };
  const combinedReportFilters = { ...reportFilters, ...exportFilters };
  const registrationReportUrl = getAdminCsvUrl(combinedReportFilters);
  const paidReportUrl = getAdminCsvUrl({ ...combinedReportFilters, reportType: 'paid' });
  const kitReportUrl = getAdminCsvUrl({ ...combinedReportFilters, reportType: 'kits' });
  const checkInReportUrl = getAdminCsvUrl({ ...combinedReportFilters, reportType: 'checkins' });
  const paymentsReportUrl = getAdminPaymentsCsvUrl(combinedReportFilters);

  return (
    <section className="mt-4 space-y-4">
      <Panel title="Central de relatorios" eyebrow="Exportacao e conferencia">
        <div className="grid gap-3">
          {exportError && <p className="border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">{exportError}</p>}
          <div>
            <p className="text-sm leading-relaxed text-zinc-400">
              Relatorios operacionais para conferir inscritos, pagamentos, camisetas, kit, check-in e emails de confirmacao.
            </p>
            <p className="mt-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
              O CSV exporta a base completa com campos de pagamento, gateway e email.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-bold text-zinc-400">Periodo inicial<input type="date" value={reportFilters.dateFrom} onChange={(event) => onReportFiltersChange({ ...reportFilters, dateFrom: event.target.value })} className="mt-1 min-h-11 w-full border border-white/10 bg-black px-3 text-white" /></label>
            <label className="text-xs font-bold text-zinc-400">Periodo final<input type="date" value={reportFilters.dateTo} onChange={(event) => onReportFiltersChange({ ...reportFilters, dateTo: event.target.value })} className="mt-1 min-h-11 w-full border border-white/10 bg-black px-3 text-white" /></label>
            <SelectFilter value={exportFilters.status} onChange={(status) => setExportFilters({ ...exportFilters, status })} options={statusOptions} />
            <SelectFilter value={exportFilters.lotId} onChange={(lotId) => setExportFilters({ ...exportFilters, lotId })} options={[{ value: '', label: 'Todos os lotes' }, ...(summary?.lots || []).map((lot) => ({ value: lot.id, label: lot.name }))]} />
            <SelectFilter value={exportFilters.distanceId} onChange={(distanceId) => setExportFilters({ ...exportFilters, distanceId })} options={[{ value: '', label: 'Todas as distâncias' }, ...(summary?.byDistance || []).map((distance) => ({ value: distance.id, label: distance.name }))]} />
            <input value={exportFilters.city} onChange={(event) => setExportFilters({ ...exportFilters, city: event.target.value })} className="min-h-12 border border-white/10 bg-black px-3 text-white" placeholder="Cidade" />
            <SelectFilter value={exportFilters.gender} onChange={(gender) => setExportFilters({ ...exportFilters, gender })} options={[{ value: '', label: 'Todos os sexos' }, { value: 'female', label: 'Feminino' }, { value: 'male', label: 'Masculino' }]} />
            <SelectFilter value={exportFilters.payment} onChange={(payment) => setExportFilters({ ...exportFilters, payment })} options={[{ value: '', label: 'Todos pagamentos' }, { value: 'paid', label: 'Pagos' }, { value: 'infinitepay', label: 'InfinitePay' }, { value: 'pix', label: 'PIX' }]} />
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
              <button type="button" onClick={onExport} className="flex min-h-11 items-center justify-center gap-2 bg-brand px-4 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-white"><Download className="h-4 w-4" /> Base completa</button>
              <button type="button" onClick={() => void exportReport(registrationReportUrl, 'funpace-run-inscricoes.csv')} className="border border-brand px-3 py-2 text-xs font-black uppercase text-brand">Inscricoes</button>
              <button type="button" onClick={() => void exportReport(getAdminReportExportUrl(combinedReportFilters, 'excel'), 'funpace-relatorio.xls')} className="border border-brand px-3 py-2 text-xs font-black uppercase text-brand">Excel</button>
              <button type="button" onClick={() => void exportReport(getAdminReportExportUrl(combinedReportFilters, 'pdf'), 'funpace-relatorio.pdf')} className="border border-brand px-3 py-2 text-xs font-black uppercase text-brand">PDF</button>
              <button type="button" onClick={() => void exportReport(paymentsReportUrl, 'funpace-run-pagamentos.csv')} className="border border-brand px-3 py-2 text-xs font-black uppercase text-brand">Pagamentos</button>
              <button type="button" onClick={() => void exportReport(kitReportUrl, 'funpace-run-kits.csv')} className="border border-brand px-3 py-2 text-xs font-black uppercase text-brand">Kits</button>
              <button type="button" onClick={() => void exportReport(checkInReportUrl, 'funpace-run-checkins.csv')} className="border border-brand px-3 py-2 text-xs font-black uppercase text-brand">Check-ins</button>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {reportCards.map((card) => (
          <ReportCard key={card.label} {...card} />
        ))}
      </div>

      {alerts.length > 0 && (
        <Panel title="Alertas de conferencia" eyebrow="Atenção">
          <div className="grid gap-2">
            {alerts.map((alert) => (
              <div key={alert} className="border border-amber-400/20 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
                {alert}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Lista por distancia" eyebrow="Inscrições">
          <ReportTable
            columns={['Distancia', 'Total', 'Pagos', 'Pendentes']}
            rows={distanceRows.map((row) => [row.label, row.total, row.paid, row.pending])}
          />
        </Panel>

        <Panel title="Lista por tamanho de camisa" eyebrow="Produção">
          <ReportTable
            columns={['Camisa', 'Quantidade']}
            rows={(summary?.shirtSizes || [])
              .slice()
              .sort((a, b) => shirtSizeOrder(a.size) - shirtSizeOrder(b.size))
              .map((item) => [`Camisa ${item.size}`, item.total])}
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ReportList title="Retirada de kit" eyebrow="Operação" registrations={kitDelivered} emptyMessage="Nenhum kit entregue ainda." />
        <ReportList title="Check-in" eyebrow="Operação" registrations={checkIns} emptyMessage="Nenhum check-in realizado ainda." />
        <ReportList title="Emails pendentes/falhos" eyebrow="Confirmação" registrations={[...confirmationEmailMissing, ...confirmationEmailFailed]} emptyMessage="Todos os pagos tem email enviado." />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportList title="Inscritos pagos" eyebrow="Pagamento" registrations={paidRegistrations} emptyMessage="Nenhuma inscrição paga." />
        <ReportList title="Inscritos pendentes" eyebrow="Pagamento" registrations={pendingRegistrations} emptyMessage="Nenhuma inscrição pendente." />
      </div>
    </section>
  );
}

function ReportCard({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: LucideIcon }) {
  return (
    <div className="border border-white/10 bg-zinc-950/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">{label}</p>
          <p className="mt-3 font-mono text-2xl font-black">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center border border-white/10 bg-white/3">
          <Icon className="h-5 w-5 text-brand" />
        </div>
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-widest text-zinc-500">{detail}</p>
    </div>
  );
}

function ReportTable({ columns, rows }: { columns: string[]; rows: Array<Array<string | number>> }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhum dado disponivel.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-120 text-left">
        <thead className="bg-black/50 text-xs uppercase tracking-widest text-zinc-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="p-3">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join('-')} className="border-t border-white/10">
              {row.map((cell, index) => (
                <td key={`${row.join('-')}-${index}`} className="p-3 text-sm font-bold text-zinc-300">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportList({
  title,
  eyebrow,
  registrations,
  emptyMessage,
}: {
  title: string;
  eyebrow: string;
  registrations: AdminRegistration[];
  emptyMessage: string;
}) {
  const rows = registrations.slice(0, 8);

  return (
    <Panel title={title} eyebrow={eyebrow} action={`${registrations.length} registros`}>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{emptyMessage}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((registration) => (
            <div key={registration.id} className="border border-white/10 bg-black/35 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-zinc-100">{registration.fullName}</p>
                  <p className="mt-1 truncate font-mono text-xs text-zinc-500">{registration.email}</p>
                </div>
                <span className="shrink-0 text-xs font-black uppercase tracking-widest text-brand">{registration.distance}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-widest text-zinc-500">
                <span>Camisa {registration.shirtSize}</span>
                <span>{statusLabels[registration.status]}</span>
                <span>{currencyFormatter.format(registration.amountCents / 100)}</span>
              </div>
            </div>
          ))}
          {registrations.length > rows.length && (
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">
              Mais {registrations.length - rows.length} registros no CSV.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

// ADMIN-002 Stage 6B — recoverable state when >=2 events are published and no
// event is selected (EVENT_SCOPE_AMBIGUOUS), or the URL slug is unknown
// (EVENT_NOT_FOUND). No auto-selection: the operator must choose (two events can
// legitimately run at once). No dashboard polling happens in this state.
export function ExecutiveEventSelection({ events, eventsError, message, onSelect, onRetryEvents }: {
  events: AdminEventListItem[];
  eventsError: string;
  message: string;
  onSelect: (slug: string) => void;
  onRetryEvents: () => void;
}) {
  const [choice, setChoice] = useState('');
  return (
    <section className="mt-4 space-y-4" aria-labelledby="exec-dashboard-heading">
      <div className="border border-white/10 bg-zinc-950/80 p-5">
        <p className="text-xs font-black uppercase tracking-widest text-brand">Centro de controle operacional</p>
        <h1 id="exec-dashboard-heading" className="mt-2 text-3xl font-black tracking-tight">Dashboard Executivo</h1>
        <p id="exec-event-message" className="mt-2 text-sm text-amber-200" role="status">
          {message || 'Selecione o evento que o dashboard deve exibir.'}
        </p>
      </div>
      <div className="border border-white/10 bg-zinc-950/80 p-5">
        {events.length > 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-2 text-xs text-zinc-400">
              <span className="font-black uppercase tracking-widest text-zinc-400">Evento</span>
              <select
                aria-label="Selecionar evento do dashboard"
                aria-describedby="exec-event-message"
                value={choice}
                onChange={(changeEvent) => setChoice(changeEvent.target.value)}
                className="min-h-11 border border-white/15 bg-black px-2 py-1 text-white"
              >
                <option value="">Escolha um evento…</option>
                {events.map((item) => (
                  <option key={item.id} value={item.slug}>{item.name}{item.status === 'closed' ? ' (encerrado)' : ''}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!choice}
              onClick={() => onSelect(choice)}
              className="min-h-11 border border-brand px-4 text-xs font-black uppercase tracking-widest text-brand disabled:opacity-40"
            >
              Carregar dashboard
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-400" role="status">
              {eventsError || 'Carregando a lista de eventos…'}
            </p>
            {eventsError && (
              <button type="button" onClick={onRetryEvents} className="min-h-11 self-start border border-white/15 px-4 text-xs font-black uppercase tracking-widest text-zinc-200">
                Tentar novamente
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ExecutiveDashboardPanel({ adminKey, onSessionExpired }: { adminKey: string; onSessionExpired: () => void }) {
  const runtime = useExecutiveDashboardRuntime(adminKey, onSessionExpired);
  const { phase, data, events, error, eventsError, selectedSlug, lastGeneratedAt } = runtime.state;

  // ADMIN-002 Stage 7B §29 — after recovering from a blocking state, move focus
  // to the dashboard heading so keyboard / screen-reader users are not dropped
  // on <body>.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousPhaseRef = useRef(phase);
  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    const wasBlocking = previous === 'event-selection-required' || previous === 'initial-error';
    const isBlocking = phase === 'event-selection-required' || phase === 'initial-error';
    if (previous !== phase && wasBlocking && !isBlocking) headingRef.current?.focus();
  }, [phase]);

  if (phase === 'event-selection-required') {
    return (
      <ExecutiveEventSelection
        events={events}
        eventsError={eventsError}
        message={error}
        onSelect={runtime.selectEvent}
        onRetryEvents={runtime.retryEvents}
      />
    );
  }

  if (phase === 'initial-error') {
    // StatusMessage already carries role="alert" (assertive); no extra live region.
    return (
      <section className="mt-4 space-y-3">
        <StatusMessage tone="error" message={error || 'Não foi possível carregar o dashboard executivo.'} />
        <button type="button" onClick={() => runtime.refreshNow()} className="min-h-11 border border-brand px-4 text-xs font-black uppercase tracking-widest text-brand">
          Tentar novamente
        </button>
      </section>
    );
  }

  // phase === 'initial-loading' | 'ready' | 'refreshing' | 'stale'
  const loading = phase === 'initial-loading';
  const financial = data?.financial;
  const registrationsData = data?.registrations;
  const checkouts = data?.checkouts;
  const charts = data?.charts;
  const marketing = data?.marketing;
  const athletes = data?.athletes;
  const selectorEvents = data?.event && !events.some((item) => item.id === data.event.id)
    ? [{ id: data.event.id, slug: data.event.slug, name: data.event.name, status: data.event.status as 'published' | 'closed', date: data.event.date }, ...events]
    : events;
  const showingPreviousEvent = phase === 'refreshing' && !!data?.event && !!selectedSlug && data.event.slug !== selectedSlug;
  // §27 — during a transition the control shows the event the operator picked,
  // not the one still on screen.
  const pendingEventId = showingPreviousEvent ? selectorEvents.find((item) => item.slug === selectedSlug)?.id : undefined;
  const selectedEventId = pendingEventId || data?.event.id || '';
  const staleSince = phase === 'stale' && lastGeneratedAt ? businessDateTimeFormatter.format(new Date(lastGeneratedAt)) : '';
  return (
    <section className="mt-4 space-y-4" aria-labelledby="exec-dashboard-heading">
      {phase === 'stale' && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 border border-amber-400/30 bg-amber-400/10 p-3 text-xs font-bold text-amber-100">
          <span>Não foi possível atualizar agora. Mostrando os últimos dados{staleSince ? ` de ${staleSince}` : ''}.</span>
          <button type="button" onClick={() => runtime.refreshNow()} className="min-h-9 border border-amber-300/50 px-3 py-1 uppercase tracking-widest text-amber-100">
            Atualizar agora
          </button>
        </div>
      )}
      {showingPreviousEvent && (
        <p role="status" className="border border-white/15 bg-white/5 p-3 text-xs font-bold text-zinc-200">
          Carregando o evento selecionado… os números abaixo ainda são do evento anterior{data?.event ? ` (${data.event.name})` : ''}.
        </p>
      )}
      <div className="flex flex-col gap-3 border border-white/10 bg-zinc-950/80 p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-brand">Centro de controle operacional</p>
          <h1 id="exec-dashboard-heading" ref={headingRef} tabIndex={-1} className="mt-2 text-3xl font-black tracking-tight outline-none">Dashboard Executivo</h1>
          <p className="mt-2 text-sm text-zinc-400">Visão financeira, comercial e operacional atualizada automaticamente.</p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          {data?.event && (selectorEvents.length > 1 ? (
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="font-black uppercase tracking-widest text-zinc-400">Evento</span>
              <select
                aria-label="Selecionar evento do dashboard"
                value={selectedEventId}
                onChange={(changeEvent) => runtime.selectEvent(selectorEvents.find((item) => item.id === changeEvent.target.value)?.slug || '')}
                className="min-h-11 border border-white/15 bg-black px-2 py-1 text-white"
              >
                {selectorEvents.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === 'closed' ? ' (encerrado)' : ''}</option>)}
              </select>
            </label>
          ) : (
            <p className="text-xs font-bold text-zinc-300">{data.event.name}{data.event.status === 'closed' ? ' · encerrado' : ''}</p>
          ))}
          <p className="font-mono text-xs text-zinc-400" aria-live="polite">{data ? `Atualizado ${businessDateTimeFormatter.format(new Date(data.generatedAt))}${phase === 'refreshing' ? ' · atualizando…' : ''}` : 'Carregando…'}</p>
        </div>
      </div>

      <section aria-labelledby="exec-kpis-heading" aria-busy={loading || undefined}>
        <h2 id="exec-kpis-heading" className="mb-3 text-xs font-black uppercase tracking-widest text-zinc-400">Visão executiva</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Receita bruta" value={currencyFormatter.format((financial?.grossRevenueCents || 0) / 100)} icon={WalletCards} detail="todas as inscrições pagas" loading={loading} />
          <KpiCard label="Receita confirmada" value={currencyFormatter.format((financial?.confirmedRevenueCents || 0) / 100)} icon={BadgeCheck} detail="pagas com liquidação registrada" loading={loading} />
          <KpiCard label="Receita hoje" value={currencyFormatter.format((financial?.todayRevenueCents || 0) / 100)} icon={Activity} detail="hoje · Porto Velho" loading={loading} />
          <KpiCard label="Receita da semana" value={currencyFormatter.format((financial?.weekRevenueCents || 0) / 100)} icon={BarChart3} detail="semana atual · seg → hoje" loading={loading} />
          <KpiCard label="Ticket médio" value={currencyFormatter.format((financial?.averageTicketCents || 0) / 100)} icon={Ticket} detail="por inscrição paga" loading={loading} />
          <KpiCard label="Pessoas inscritas" value={formatCount(registrationsData?.uniquePeople)} icon={Users} detail={`${formatCount(registrationsData?.registrationRows)} registros · ${formatCount(registrationsData?.uniquePaidPeople)} pagantes`} loading={loading} />
          <KpiCard label="Conversão de participantes" value={formatPercent(registrationsData?.participantConversionRate)} icon={ArrowUpRight} detail="pessoas pagantes / pessoas inscritas" loading={loading} />
          <KpiCard label="Abandono no checkout" value={formatPercent(checkouts?.abandonmentRate)} icon={TimerReset} detail={`${formatCount(checkouts?.created)} criados · ${formatCount(checkouts?.paid)} pagos`} loading={loading} />
        </div>
      </section>

      {/* ADMIN-002 Stage 3B: "Reembolsadas" removed — refund is not an operational
          capability (0 refunds ever; registration.status='refunded' is unreachable).
          Do not reintroduce it as a status tile; refund needs its own financial track. */}
      <Panel title="Inscrições por status" eyebrow="Funil operacional">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {([
            ['Confirmadas', formatCount(registrationsData?.confirmed), 'text-brand'],
            ['Pendentes', formatCount(registrationsData?.pending), 'text-amber-300'],
            ['Expiradas', formatCount(registrationsData?.expired), 'text-zinc-300'],
            ['Canceladas', formatCount(registrationsData?.cancelled), 'text-red-300'],
            ['Conversão participantes', formatPercent(registrationsData?.participantConversionRate), 'text-white'],
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="border border-white/10 bg-black/30 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-zinc-400">{label}</p>
              <p className={`mt-3 font-mono text-2xl font-black ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
      </Panel>

      <section aria-label="Receita" className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Receita por dia" eyebrow="Financeiro"><ExecutiveSeries data={charts?.daily || []} caption="Receita por dia (últimos 14 pontos)" /></Panel>
          <Panel title="Receita acumulada" eyebrow="Tendência"><ExecutiveSeries data={charts?.cumulativeRevenue || []} caption="Receita acumulada (últimos 14 pontos)" /></Panel>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Receita por lote" eyebrow="Financeiro"><DistributionBars data={charts?.byLot || []} value="amount" caption="Receita por lote" /></Panel>
          <Panel title="Receita por distância" eyebrow="Financeiro"><DistributionBars data={charts?.byDistance || []} value="amount" caption="Receita por distância" /></Panel>
        </div>
      </section>

      <section aria-label="Marketing e análise">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Origem das inscrições" eyebrow="Marketing"><DistributionBars data={(marketing?.sources || []).map((item) => ({ label: item.label, count: item.paid, amountCents: item.amountCents }))} value="amount" caption="Origem das inscrições" /></Panel>
          <Panel title="Conversão por campanha" eyebrow="Marketing"><DistributionBars data={marketing?.campaigns || []} caption="Conversão por campanha" /></Panel>
        </div>
      </section>

      <details className="border border-white/10 bg-zinc-950/80">
        <summary className="cursor-pointer p-4 text-xs font-black uppercase tracking-widest text-brand">Análise detalhada</summary>
        <div className="space-y-4 border-t border-white/10 p-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Panel title="Receita por hora" eyebrow="Comportamento"><ExecutiveSeries data={charts?.hourly || []} caption="Receita por hora (últimos 14 pontos)" /></Panel>
            <Panel title="Receita por cidade" eyebrow="Geografia"><DistributionBars data={charts?.byCity || []} value="amount" caption="Receita por cidade" /></Panel>
            <Panel title="Receita por sexo" eyebrow="Atletas"><DistributionBars data={charts?.byGender || []} value="amount" caption="Receita por sexo" /></Panel>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Panel title="Faixa etária" eyebrow="Atletas"><DistributionBars data={athletes?.byAge || []} caption="Faixa etária" /></Panel>
            <Panel title="Mapa de calor por cidade" eyebrow="Atletas"><HeatTiles data={athletes?.byCity || []} /></Panel>
            <Panel title="Tamanhos de camisa" eyebrow="Produção"><DistributionBars data={athletes?.byShirt || []} caption="Tamanhos de camisa" /></Panel>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Distâncias" eyebrow="Modalidades"><DistributionBars data={athletes?.byDistance || []} caption="Distâncias" /></Panel>
          </div>
          <Panel title="Ocupação dos lotes" eyebrow="Capacidade em tempo real"><LotOccupancy lots={data?.lots || []} /></Panel>
        </div>
      </details>

      <section aria-label="Operacional recente">
        <div className="grid gap-4 md:grid-cols-2">
          <RecentList title="Últimos pagamentos" rows={(data?.recent.payments || []).map((item) => ({ primary: currencyFormatter.format(item.amountCents / 100), secondary: (item.paidAt || item.updatedAt) ? businessDateTimeFormatter.format(new Date(item.paidAt || item.updatedAt)) : '—' }))} />
          <RecentList title="Últimas confirmações" rows={(data?.recent.confirmations || []).map((item) => ({ primary: currencyFormatter.format(item.amountCents / 100), secondary: item.confirmedAt ? businessDateTimeFormatter.format(new Date(item.confirmedAt)) : '—' }))} />
        </div>
      </section>
    </section>
  );
}

// ADMIN-002 Stage 7B §13 — lot capacity status is announced with text, not colour alone.
export function LotOccupancy({ lots }: { lots: AdminExecutiveDashboard['lots'] }) {
  if (lots.length === 0) return <p className="text-sm text-zinc-400">Nenhum lote disponível.</p>;
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {lots.map((lot) => {
        const alarm = lot.level === 'blocked' || lot.level === 'critical';
        return (
          <li key={lot.id} className={`border p-4 ${alarm ? 'border-red-400/40 bg-red-400/5' : lot.level === 'warning' ? 'border-amber-400/40 bg-amber-400/5' : 'border-white/10 bg-black/30'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-black" title={lot.name}>{lot.name}</p>
                <p className="mt-1 text-xs text-zinc-400">{currencyFormatter.format(lot.priceCents / 100)}</p>
              </div>
              <span className="shrink-0 font-mono text-lg font-black">{lot.occupancyPercent}%</span>
            </div>
            <div className="mt-3 h-2 bg-white/15" aria-hidden="true">
              <div className={`h-full ${alarm ? 'bg-red-400' : lot.level === 'warning' ? 'bg-amber-400' : 'bg-brand'}`} style={{ width: `${Math.min(lot.occupancyPercent, 100)}%` }} />
            </div>
            <p className={`mt-3 inline-block border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${alarm ? 'border-red-400/40 text-red-200' : lot.level === 'warning' ? 'border-amber-400/40 text-amber-200' : 'border-white/15 text-zinc-300'}`}>
              {LOT_LEVEL_LABEL[lot.level] ?? lot.level}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300">
              <span>Capacidade <b className="float-right text-white">{formatCount(lot.capacityTotal)}</b></span>
              <span>Pagas <b className="float-right text-white">{formatCount(lot.confirmed)}</b></span>
              <span>Reservadas <b className="float-right text-white">{formatCount(lot.temporaryReservations)}</b></span>
              <span>Disponíveis <b className="float-right text-white">{formatCount(lot.available)}</b></span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ADMIN-002 Stage 7B §6-9 — the visual bars are decorative (aria-hidden); the
// figcaption names the chart and the <details> table is the equivalent,
// keyboard/touch/screen-reader accessible data source. Hover stays as a pure
// enhancement, never the only source of a value.
export function ExecutiveSeries({ data, caption }: { data: DashboardChartPoint[]; caption: string }) {
  if (data.length === 0) return <p className="text-sm text-zinc-400">Sem dados neste período.</p>;
  const visible = data.slice(-14);
  const max = Math.max(...visible.map((item) => item.amountCents), 1);
  const shortLabel = (label: string) => (label.includes('-') ? label.slice(5) : label);
  return (
    <figure className="m-0">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="flex h-52 items-end gap-1" aria-hidden="true">
        {visible.map((item) => (
          <div key={item.label} className="group flex min-w-0 flex-1 flex-col items-center justify-end">
            <span className="mb-2 hidden text-[10px] text-zinc-200 group-hover:block">{currencyFormatter.format(item.amountCents / 100)}</span>
            <div className="w-full bg-brand transition-[height]" style={{ height: `${Math.max((item.amountCents / max) * 100, item.amountCents ? 4 : 1)}%` }} />
            <span className="mt-2 max-w-full truncate text-[10px] text-zinc-400" title={item.label}>{shortLabel(item.label)}</span>
          </div>
        ))}
      </div>
      <details className="mt-3 border-t border-white/10 pt-2 text-xs">
        <summary className="cursor-pointer font-bold uppercase tracking-wider text-zinc-300">Ver dados</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr><th scope="col" className="pb-1 font-bold text-zinc-400">Período</th><th scope="col" className="pb-1 text-right font-bold text-zinc-400">Receita</th></tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.label} className="border-t border-white/10">
                <td className="py-1 text-zinc-300">{item.label}</td>
                <td className="py-1 text-right font-mono text-zinc-200">{currencyFormatter.format(item.amountCents / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function DistributionBars({ data, value = 'count', caption }: { data: DashboardChartPoint[]; value?: 'count' | 'amount'; caption?: string }) {
  const rows = data.slice(0, 8);
  if (rows.length === 0) return <p className="text-sm text-zinc-400">Sem dados disponíveis.</p>;
  const max = Math.max(...rows.map((item) => (value === 'amount' ? item.amountCents : item.count)), 1);
  return (
    <ul className="space-y-3" aria-label={caption}>
      {rows.map((item) => {
        const current = value === 'amount' ? item.amountCents : item.count;
        const formatted = value === 'amount' ? currencyFormatter.format(current / 100) : integerFormatter.format(current);
        return (
          <li key={item.label}>
            <div className="mb-1 flex justify-between gap-3 text-xs">
              <span className="truncate font-bold text-zinc-200" title={item.label}>{item.label}</span>
              <span className="shrink-0 font-mono text-zinc-300">{formatted}</span>
            </div>
            <div className="h-2 bg-white/15" aria-hidden="true"><div className="h-full bg-brand" style={{ width: `${(current / max) * 100}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

export function HeatTiles({ data }: { data: DashboardChartPoint[] }) {
  const rows = data.slice(0, 12);
  if (rows.length === 0) return <p className="text-sm text-zinc-400">Nenhuma cidade registrada.</p>;
  const max = Math.max(...rows.map((item) => item.count), 1);
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {rows.map((item) => (
        <li key={item.label} className="border border-brand/20 p-3" style={{ backgroundColor: `rgb(163 230 53 / ${Math.max((item.count / max) * 0.45, 0.06)})` }}>
          <MapPin aria-hidden="true" className="h-4 w-4 text-brand" />
          <p className="mt-2 truncate text-xs font-black" title={item.label}>{item.label}</p>
          <p className="mt-1 font-mono text-lg">{integerFormatter.format(item.count)}</p>
        </li>
      ))}
    </ul>
  );
}

function RecentList({ title, rows }: { title: string; rows: Array<{ primary: string; secondary: string }> }) {
  return (
    <Panel title={title} eyebrow="Tempo real">
      <ul className="space-y-2">
        {rows.slice(0, 6).map((row, index) => (
          <li key={index} className="flex items-baseline justify-between gap-2 border border-white/10 bg-black/30 p-3 font-mono text-xs">
            <span className="font-bold text-zinc-200">{row.primary}</span>
            <span className="shrink-0 text-zinc-400">{row.secondary}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-zinc-400">Nenhum registro.</li>}
      </ul>
    </Panel>
  );
}

function AlertsCenterPanel({ adminKey, registrations, onOpenRegistration }: { adminKey: string; registrations: AdminRegistration[]; onOpenRegistration: (registration: AdminRegistration) => void }) {
  const [data, setData] = useState<AdminAlertsResponse | null>(null); const [filters, setFilters] = useState({ status: '', severity: '', type: '' }); const [error, setError] = useState(''); const [draft, setDraft] = useState<{ id: string; status: 'acknowledged' | 'resolved'; resolution: string } | null>(null);
  const load = async () => { try { setData(await getAdminAlerts(adminKey, filters)); setError(''); } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Falha ao carregar alertas.'); } };
  useEffect(() => { void load(); }, [adminKey, filters.status, filters.severity, filters.type]);
  const submit = async () => { if (!draft) return; try { await updateAdminAlert(adminKey, draft.id, draft.status, draft.resolution); setDraft(null); await load(); } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Falha ao atualizar alerta.'); } };
  const openEntity = (id: string | null) => { const registration = registrations.find((item) => item.id === id); if (registration) onOpenRegistration(registration); };
  return <section className="mt-4 border border-white/10 bg-zinc-950/80"><div className="border-b border-white/10 p-5"><p className="text-xs font-black uppercase tracking-widest text-brand">Centro de controle</p><h2 className="mt-2 text-2xl font-black">Alertas</h2><p className="mt-2 text-sm text-zinc-400">Detecção idempotente com responsável, reconhecimento e resolução auditada.</p></div>{error && <p className="m-4 border border-red-400/20 bg-red-400/10 p-3 text-red-100">{error}</p>}<div className="grid gap-3 border-b border-white/10 p-4 sm:grid-cols-4"><SelectFilter value={filters.status} onChange={(status) => setFilters({ ...filters, status })} options={[{ value: '', label: 'Todos status' }, { value: 'open', label: 'Abertos' }, { value: 'acknowledged', label: 'Reconhecidos' }, { value: 'resolved', label: 'Resolvidos' }]} /><SelectFilter value={filters.severity} onChange={(severity) => setFilters({ ...filters, severity })} options={[{ value: '', label: 'Todas gravidades' }, { value: 'critical', label: 'Crítico' }, { value: 'warning', label: 'Atenção' }, { value: 'info', label: 'Informativo' }]} /><KpiCard label="Abertos" value={data?.totals.open || 0} icon={Bell} detail="requerem acompanhamento" trend="neutral" loading={!data} /><KpiCard label="Críticos" value={data?.totals.critical || 0} icon={Activity} detail="prioridade máxima" trend="neutral" loading={!data} /></div><div className="divide-y divide-white/10">{(data?.alerts || []).map((alert) => <div key={alert.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_150px_180px_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className={`border px-2 py-1 text-[10px] font-black uppercase ${alert.severity === 'critical' ? 'border-red-400/30 text-red-300' : alert.severity === 'warning' ? 'border-amber-400/30 text-amber-300' : 'border-white/10 text-zinc-400'}`}>{alert.severity}</span><p className="font-bold">{alert.title}</p></div><p className="mt-2 text-sm text-zinc-400">{alert.message}</p><p className="mt-2 font-mono text-[10px] text-zinc-600">{alert.alertType} · {dateTimeFormatter.format(new Date(alert.detectedAt))}</p></div><p className="text-xs font-black uppercase text-zinc-400">{alert.status}</p><p className="text-xs text-zinc-500">{alert.acknowledgedBy || 'Sem responsável'}</p><div className="flex flex-wrap gap-2">{alert.entityType === 'registration' && <button onClick={() => openEntity(alert.entityId)} className="border border-white/10 px-2 py-1 text-xs">Abrir</button>}{alert.status === 'open' && <button onClick={() => setDraft({ id: alert.id, status: 'acknowledged', resolution: '' })} className="border border-amber-400/30 px-2 py-1 text-xs text-amber-300">Assumir</button>}{alert.status !== 'resolved' && <button onClick={() => setDraft({ id: alert.id, status: 'resolved', resolution: '' })} className="border border-brand/30 px-2 py-1 text-xs text-brand">Resolver</button>}</div></div>)}{data && data.alerts.length === 0 && <p className="p-6 text-sm text-zinc-500">Nenhum alerta encontrado.</p>}</div>{draft && <ActionModal title={draft.status === 'resolved' ? 'Resolver alerta' : 'Assumir alerta'} confirmLabel="Confirmar" loading={false} confirmDisabled={draft.resolution.trim().length < 5} onConfirm={() => void submit()} onClose={() => setDraft(null)}><label className="text-xs font-bold text-zinc-400">Resolução / observação<textarea value={draft.resolution} onChange={(event) => setDraft({ ...draft, resolution: event.target.value })} className="mt-2 min-h-28 w-full border border-white/10 bg-black p-3 text-white" /></label></ActionModal>}</section>;
}

function MonitoringPanel({ adminKey, onSessionExpired }: { adminKey: string; onSessionExpired: () => void }) {
  const [data, setData] = useState<AdminMonitoringResponse | null>(null); const [error, setError] = useState('');
  const load = async () => { try { setData(await getAdminMonitoring(adminKey)); setError(''); } catch (requestError) { if (requestError instanceof ApiError && requestError.status === 401) { onSessionExpired(); return; } setError(requestError instanceof ApiError ? requestError.message : 'Falha ao carregar monitoramento.'); } };
  // ADMIN-002 Stage 6B: the 20s monitoring poll now respects tab visibility
  // (no polling while hidden; one immediate refresh when it becomes visible).
  useEffect(() => {
    let stopped = false;
    const tick = () => { if (!stopped && document.visibilityState === 'visible') void load(); };
    void load();
    const interval = window.setInterval(tick, 20_000);
    document.addEventListener('visibilitychange', tick);
    return () => { stopped = true; window.clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [adminKey]);
  return <section className="mt-4 space-y-4"><div className="border border-white/10 bg-zinc-950/80 p-5"><p className="text-xs font-black uppercase tracking-widest text-brand">Observabilidade</p><h2 className="mt-2 text-2xl font-black">Monitoramento</h2><p className="mt-2 text-sm text-zinc-400">Saúde dos serviços e telemetria da instância serverless atual.</p></div>{error && <StatusMessage tone="error" message={error} />}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{(data?.services || []).map((service) => <div key={service.id} className="border border-white/10 bg-zinc-950/80 p-4"><div className="flex items-center justify-between"><p className="font-black">{service.label}</p><span className={`h-3 w-3 rounded-full ${service.status === 'operational' || service.status === 'configured' ? 'bg-brand' : service.status === 'degraded' ? 'bg-amber-400' : service.status === 'disabled' || service.status === 'local' ? 'bg-zinc-500' : 'bg-red-400'}`} /></div><p className="mt-3 text-xs font-black uppercase text-zinc-500">{service.status}</p><p className="mt-2 text-xs text-zinc-400">{service.detail}</p>{service.latencyMs !== null && <p className="mt-3 font-mono text-sm text-brand">{service.latencyMs} ms</p>}</div>)}</div><Panel title="Métricas da instância" eyebrow="Tempo real"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{data && Object.entries({ 'Resposta API': `${data.metrics.responseTimeMs} ms`, 'Consulta banco': `${data.metrics.databaseQueryMs} ms`, 'Heap': `${data.metrics.memoryUsedMb} MB`, 'RSS': `${data.metrics.memoryRssMb} MB`, 'CPU usuário': `${data.metrics.cpuUserMs} ms`, 'Erros críticos': data.metrics.errors, 'Webhooks': data.metrics.webhooks, 'E-mails': data.metrics.emailsSent }).map(([label, value]) => <div key={label} className="border border-white/10 bg-black/30 p-3"><p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</p><p className="mt-2 font-mono text-xl font-black">{value}</p></div>)}</div></Panel></section>;
}

function ReconciliationPanel({ adminKey, registrations, onOpenRegistration }: { adminKey: string; registrations: AdminRegistration[]; onOpenRegistration: (registration: AdminRegistration) => void }) {
  const [dashboard, setDashboard] = useState<AdminReconciliationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    try { setDashboard(await getAdminReconciliation(adminKey)); setError(''); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível carregar a reconciliação.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [adminKey]);
  const run = async () => {
    setRunning(true); setMessage(''); setError('');
    try {
      const result = await runAdminReconciliation(adminKey, 'dry_run');
      setMessage(`Dry-run concluído: ${result.checkedCount} pagamentos verificados, ${result.manualReviewRequired} em revisão manual, ${result.correctedCount} alterações.`);
      await load();
    } catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Falha ao executar a reconciliação.'); }
    finally { setRunning(false); }
  };
  const openIssue = async (registrationId: string | null) => {
    if (!registrationId) return;
    const local = registrations.find((registration) => registration.id === registrationId);
    if (local) { onOpenRegistration(local); return; }
    try { onOpenRegistration((await getAdminRegistrationDetails(adminKey, registrationId)).registration); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível abrir a inscrição.'); }
  };
  const activeIssues = dashboard?.issues.filter((issue) => issue.resolutionStatus === 'manual_review_required') || [];
  const lastRun = dashboard?.runs[0];
  return (
    <section className="mt-4 border border-white/10 bg-zinc-950/80">
      <div className="flex flex-col gap-4 border-b border-white/10 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-xs font-black uppercase tracking-widest text-brand">Governança financeira</p><h2 className="mt-2 text-2xl font-black">Central de reconciliação</h2><p className="mt-2 text-sm text-zinc-400">Casos ambíguos permanecem bloqueados para revisão; nenhuma confirmação é feita sem prova do gateway.</p></div>
        <button type="button" disabled={running} onClick={() => void run()} className="min-h-11 border border-brand px-4 text-xs font-black uppercase text-brand disabled:opacity-40"><RefreshCcw className={`mr-2 inline h-4 w-4 ${running ? 'animate-spin' : ''}`} />Executar dry-run</button>
      </div>
      {error && <p className="m-4 border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</p>}
      {message && <p className="m-4 border border-brand/20 bg-brand/10 p-3 text-sm text-brand">{message}</p>}
      <div className="grid gap-3 border-b border-white/10 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Revisão manual" value={loading ? '—' : String(activeIssues.length)} icon={ShieldCheck} detail="casos históricos preservados" trend="neutral" loading={loading} />
        <KpiCard label="Críticos" value={loading ? '—' : String(activeIssues.filter((issue) => issue.severity === 'critical').length)} icon={Activity} detail="exigem ação imediata" trend="neutral" loading={loading} />
        <KpiCard label="Última varredura" value={lastRun ? String(lastRun.checkedCount) : '—'} detail="pagamentos analisados" icon={Search} trend="neutral" loading={loading} />
        <KpiCard label="Correções automáticas" value={lastRun ? String(lastRun.correctedCount) : '0'} detail="somente com evidência inequívoca" icon={BadgeCheck} trend="up" loading={loading} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-230 text-left"><thead className="bg-black/50 text-xs uppercase tracking-widest text-zinc-500"><tr><th className="p-4">Problema</th><th className="p-4">Inscrição</th><th className="p-4">Gravidade</th><th className="p-4">Situação</th><th className="p-4">Detectado</th><th className="p-4 text-right">Ação</th></tr></thead>
          <tbody>{activeIssues.map((issue) => <tr key={issue.id} className="border-t border-white/10"><td className="p-4"><p className="font-bold">{issue.issueCode}</p><p className="mt-1 text-xs text-zinc-500">Preservado sem mutação financeira</p></td><td className="p-4 font-mono text-xs text-zinc-400">{issue.registrationId}</td><td className="p-4"><span className="border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-xs uppercase text-amber-200">{issue.severity}</span></td><td className="p-4 text-xs font-bold uppercase text-zinc-300">Revisão manual obrigatória</td><td className="p-4 font-mono text-xs text-zinc-500">{dateTimeFormatter.format(new Date(issue.lastDetectedAt))}</td><td className="p-4 text-right"><button type="button" onClick={() => void openIssue(issue.registrationId)} className="border border-brand/30 px-3 py-2 text-xs font-black uppercase text-brand">Abrir timeline</button></td></tr>)}</tbody>
        </table>
        {!loading && activeIssues.length === 0 && <p className="p-6 text-sm text-zinc-500">Nenhuma revisão manual pendente.</p>}
      </div>
    </section>
  );
}

function AuditPanel({ auditLogs, adminKey, registrations, onOpenRegistration }: { auditLogs: AdminAuditLog[]; adminKey: string; registrations: AdminRegistration[]; onOpenRegistration: (registration: AdminRegistration) => void }) {
  const [logs, setLogs] = useState(auditLogs);
  const [filters, setFilters] = useState({ q: '', action: '', actor: '', entityType: '', dateFrom: '', dateTo: '', page: '1', pageSize: '50' });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: auditLogs.length, totalPages: 1 });
  const [selectedLog, setSelectedLog] = useState<AdminAuditLog | null>(null);
  const [auditError, setAuditError] = useState('');
  const [openingRegistrationId, setOpeningRegistrationId] = useState('');
  useEffect(() => {
    const timeout = window.setTimeout(() => { void getAdminAuditLogs(adminKey, filters).then((response) => { setLogs(response.logs); setPagination(response.pagination); setAuditError(''); }).catch((error) => setAuditError(error instanceof ApiError ? error.message : 'Não foi possível carregar a auditoria.')); }, 250);
    return () => window.clearTimeout(timeout);
  }, [adminKey, filters.q, filters.action, filters.actor, filters.entityType, filters.dateFrom, filters.dateTo, filters.page, filters.pageSize]);
  const exportAudit = async () => {
    try { const response = await fetch(getAdminAuditLogsCsvUrl(filters), { credentials: 'include' }); if (!response.ok) throw new Error('Não foi possível exportar a auditoria.'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'funpace-run-auditoria.csv'; link.click(); URL.revokeObjectURL(url); }
    catch (error) { setAuditError(error instanceof Error ? error.message : 'Não foi possível exportar a auditoria.'); }
  };
  const openRegistrationFromLog = async (log: AdminAuditLog) => {
    if (log.entityType !== 'registration') return;
    const registration = registrations.find((item) => item.id === log.entityId);
    if (registration) { onOpenRegistration(registration); return; }
    setOpeningRegistrationId(log.entityId);
    try { const response = await getAdminRegistrationDetails(adminKey, log.entityId); onOpenRegistration(response.registration); }
    catch (error) { setAuditError(error instanceof ApiError ? error.message : 'Não foi possível abrir a inscrição relacionada.'); }
    finally { setOpeningRegistrationId(''); }
  };
  return (
    <section className="mt-4 border border-white/10 bg-zinc-950/80">
      <div className="border-b border-white/10 p-4 md:p-5">
        <p className="text-xs font-black uppercase tracking-widest text-brand">Auditoria</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight">Historico administrativo</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
          Registro das acoes criticas feitas no admin e por automacoes do sistema.
        </p>
      </div>

      <div className="grid gap-2 border-b border-white/10 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" placeholder="Buscar em toda auditoria" />
        <input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" placeholder="Acao" />
        <input value={filters.actor} onChange={(event) => setFilters({ ...filters, actor: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" placeholder="Ator" />
        <SelectFilter value={filters.entityType} onChange={(value) => setFilters({ ...filters, entityType: value, page: '1' })} options={[{ value: '', label: 'Todas entidades' }, { value: 'registration', label: 'Inscrição' }, { value: 'payment', label: 'Pagamento' }, { value: 'partnership', label: 'Parceria' }, { value: 'event', label: 'Evento' }, { value: 'distance', label: 'Distância' }, { value: 'lot', label: 'Lote' }]} />
        <input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" aria-label="Data inicial" />
        <input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value, page: '1' })} className="min-h-11 border border-white/10 bg-black px-3 text-white" aria-label="Data final" />
        <button type="button" onClick={() => void exportAudit()} className="min-h-11 border border-brand px-3 text-xs font-black uppercase text-brand">Exportar CSV</button>
        <button type="button" onClick={() => setFilters({ q: '', action: '', actor: '', entityType: '', dateFrom: '', dateTo: '', page: '1', pageSize: '50' })} className="min-h-11 border border-white/10 px-3 text-xs font-black uppercase">Limpar</button>
      </div>
      {auditError && <p className="m-4 border border-red-400/20 bg-red-400/10 p-3 text-red-100">{auditError}</p>}

      {logs.length === 0 ? (
        <div className="p-6 text-sm text-zinc-500">Nenhum log administrativo encontrado.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-215 text-left">
            <thead className="bg-black/50 text-xs uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="p-4">Acao</th>
                <th className="p-4">Entidade</th>
                <th className="p-4">Ator</th>
                <th className="p-4">Origem</th>
                <th className="p-4">Data</th>
                <th className="p-4 text-right">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-white/10">
                  <td className="p-4"><p className="font-bold">{auditActionLabel(log.action)}</p><p className="mt-1 text-xs text-zinc-500">{summarizeAuditPayload(log.payload)}</p></td>
                  <td className="p-4">
                    <p className="text-sm text-zinc-300">{auditEntityLabel(log.entityType)}</p>
                    <p className="mt-1 font-mono text-xs text-zinc-500">{log.entityId}</p>
                  </td>
                  <td className="p-4"><p className="text-sm font-bold text-zinc-300">{log.actor}</p><p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">{log.actorRole || 'sistema'}</p></td>
                  <td className="p-4"><p className="font-mono text-xs text-zinc-400">{log.ipAddress || 'IP n/a'}</p><p className="mt-1 font-mono text-[11px] text-zinc-600">{log.sessionId || 'sessao n/a'}</p></td>
                  <td className="p-4 font-mono text-xs text-zinc-500">{dateTimeFormatter.format(new Date(log.createdAt))}</td>
                  <td className="p-4 text-right"><button type="button" onClick={() => setSelectedLog(log)} className="border border-white/10 px-2 py-1 text-xs">Payload</button>{log.entityType === 'registration' && <button type="button" onClick={() => void openRegistrationFromLog(log)} className="ml-1 border border-brand/30 px-2 py-1 text-xs text-brand">{openingRegistrationId === log.entityId ? 'Abrindo...' : 'Abrir'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-white/10 p-4 text-xs text-zinc-400"><button disabled={pagination.page <= 1} onClick={() => setFilters({ ...filters, page: String(pagination.page - 1) })} className="border border-white/10 px-3 py-2 disabled:opacity-30">Anterior</button><span>{pagination.total} logs · pagina {pagination.page}/{pagination.totalPages}</span><button disabled={pagination.page >= pagination.totalPages} onClick={() => setFilters({ ...filters, page: String(pagination.page + 1) })} className="border border-white/10 px-3 py-2 disabled:opacity-30">Proxima</button></div>
      {selectedLog && <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"><div className="w-full max-w-3xl border border-white/10 bg-zinc-950 p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-black">{auditActionLabel(selectedLog.action)}</h3><p className="mt-1 text-sm text-zinc-400">{summarizeAuditPayload(selectedLog.payload)}</p></div><button onClick={() => setSelectedLog(null)}><X /></button></div><div className="mt-4 grid gap-3 border border-white/10 bg-black/30 p-4 text-xs text-zinc-400 sm:grid-cols-2"><div><p className="font-bold uppercase tracking-widest text-zinc-500">Ator</p><p className="mt-1 text-sm text-zinc-200">{selectedLog.actor}</p><p className="mt-1 uppercase tracking-widest text-zinc-500">{selectedLog.actorRole || 'sistema'}</p></div><div><p className="font-bold uppercase tracking-widest text-zinc-500">Data</p><p className="mt-1 font-mono text-sm text-zinc-200">{dateTimeFormatter.format(new Date(selectedLog.createdAt))}</p></div><div><p className="font-bold uppercase tracking-widest text-zinc-500">Entidade</p><p className="mt-1 text-sm text-zinc-200">{auditEntityLabel(selectedLog.entityType)}</p><p className="mt-1 font-mono text-[11px] text-zinc-500">{selectedLog.entityId}</p></div><div><p className="font-bold uppercase tracking-widest text-zinc-500">Origem</p><p className="mt-1 font-mono text-sm text-zinc-200">{selectedLog.ipAddress || 'IP n/a'}</p><p className="mt-1 font-mono text-[11px] text-zinc-500">{selectedLog.sessionId || 'sessao n/a'}</p></div></div>{selectedLog.entityType === 'registration' && <div className="mt-4 flex justify-end"><button type="button" onClick={() => void openRegistrationFromLog(selectedLog)} className="border border-brand/30 px-3 py-2 text-xs font-black uppercase text-brand">{openingRegistrationId === selectedLog.entityId ? 'Abrindo inscrição...' : 'Abrir inscrição relacionada'}</button></div>}<pre className="mt-4 max-h-[60vh] overflow-auto border border-white/10 bg-black p-3 text-xs text-zinc-300">{JSON.stringify(selectedLog.payload, null, 2)}</pre></div></div>}
    </section>
  );
}

function EventManagementPanel({ adminKey }: { adminKey: string }) {
  const [config, setConfig] = useState<AdminEventConfig | null>(null);
  const [message, setMessage] = useState('');
  const [saveDraft, setSaveDraft] = useState<{ kind: 'event' | 'distance' | 'lot'; id?: string; reason: string } | null>(null);
  // ADMIN-UX-HOTFIX-001 — event/lot config saves run on the reusable mutation
  // state machine: idle → confirming → submitting → success | failure. Feedback
  // is rendered in the modal (durable), never the transient panel banner, and a
  // silent no-op / swallowed rejection is impossible.
  const saveMutation = useAdminMutation<{ message: string }>();
  const [checkLoading, setCheckLoading] = useState<'email' | 'gateway' | ''>('');
  const [checkResult, setCheckResult] = useState<{ target: 'email' | 'gateway'; summary: string; ok: boolean; checks: Array<{ label: string; ok: boolean; detail: string }> } | null>(null);
  const load = () => getAdminEventConfig(adminKey).then(setConfig).catch((error) => setMessage(error instanceof ApiError ? error.message : 'Não foi possível carregar o evento.'));
  useEffect(() => { void load(); }, [adminKey]);
  if (!config) return <section className="mt-4 border border-white/10 bg-zinc-950 p-6 text-zinc-400">{message || 'Carregando configuracao...'}</section>;
  const availabilityLabel = {
    available: 'Inscricoes disponiveis',
    scheduled: 'Aguardando abertura',
    closed: 'Inscrições indisponíveis',
  }[config.health.sales.registrationAvailability];
  const now = Date.now();
  const eventAlerts = [
    config.event.status === 'published' && !config.health.database.ok ? { key: 'database', tone: 'warning' as const, title: 'Banco indisponivel', detail: config.health.database.issue || 'Sem conexao valida com o banco principal.' } : null,
    config.event.status === 'published' && !config.health.email.configured ? { key: 'email', tone: 'warning' as const, title: 'Email pendente', detail: 'O evento está publicado, mas o email transacional não está configurado.' } : null,
    config.event.status === 'published' && !config.health.gateway.configured ? { key: 'gateway', tone: 'warning' as const, title: 'Gateway pendente', detail: 'O evento está publicado, mas o gateway não está pronto para gerar vendas.' } : null,
    config.event.status === 'published' && !config.health.sales.activeLotId ? { key: 'active-lot', tone: 'warning' as const, title: 'Sem lote ativo', detail: 'Não existe lote ativo para um evento publicado.' } : null,
    config.event.status === 'published' && config.health.sales.activeDistances === 0 ? { key: 'distances', tone: 'warning' as const, title: 'Sem distancias ativas', detail: 'Ative pelo menos uma distancia para liberar inscricoes.' } : null,
    config.lots.some((lot) => lot.status === 'active' && new Date(lot.endsAt).getTime() < now) ? { key: 'expired-lot', tone: 'warning' as const, title: 'Lote ativo vencido', detail: 'Existe lote ativo com encerramento no passado.' } : null,
    config.lots.some((lot) => new Date(lot.startsAt).getTime() >= new Date(lot.endsAt).getTime()) ? { key: 'invalid-window', tone: 'warning' as const, title: 'Janela de venda invalida', detail: 'Um ou mais lotes possuem inicio maior ou igual ao fim.' } : null,
    config.event.status === 'draft' && config.health.sales.registrationAvailability === 'available' ? { key: 'draft-open', tone: 'warning' as const, title: 'Evento em rascunho com vendas prontas', detail: 'Ha lote e distancias ativas, mas o evento ainda esta como rascunho.' } : null,
  ].filter(Boolean) as Array<{ key: string; tone: 'warning'; title: string; detail: string }>;
  const updateEvent = (field: keyof AdminEventConfig['event'], value: string) => setConfig({ ...config, event: { ...config.event, [field]: value } });
  // ADMIN-UX-HOTFIX-001 — one confirm → exactly one PATCH. The mutation runtime
  // owns submitting/success/failure; a rejected promise is never swallowed and a
  // "lot not found in the loaded config" case is surfaced, not silently dropped.
  const submitConfigSave = () => {
    const draft = saveDraft;
    if (!draft) return;
    void saveMutation.submit(async () => {
      const reason = draft.reason.trim();
      if (reason.length < 5) {
        throw new ApiError('Informe um motivo com pelo menos 5 caracteres.', { code: 'validation', businessCode: 'CONFIG_REASON_INVALID' });
      }
      if (draft.kind === 'event') {
        await updateAdminEventConfig(adminKey, config.event, reason);
        return { message: 'Alteração salva com sucesso.' };
      }
      if (draft.kind === 'distance' && draft.id) {
        const distance = config.distances.find((item) => item.id === draft.id);
        if (!distance) {
          throw new ApiError('Distância não encontrada na configuração carregada. Recarregue e tente novamente.', { code: 'stale', businessCode: 'CONFIG_ENTITY_STALE' });
        }
        await updateAdminDistance(adminKey, distance.id, { capacity: distance.capacity, status: distance.status, reason });
        return { message: 'Alteração salva com sucesso.' };
      }
      if (draft.kind === 'lot' && draft.id) {
        const lot = config.lots.find((item) => item.id === draft.id);
        const built = buildLotUpdatePayload(lot, reason);
        if (!built.ok || !('payload' in built)) {
          const errorText = 'error' in built ? built.error : 'Configuração de lote inválida.';
          throw new ApiError(errorText, { code: 'validation', businessCode: 'LOT_PAYLOAD_INVALID' });
        }
        // full-replace: buildLotUpdatePayload guarantees the complete 7-field body
        // (name / capacity / priceCents / status / startsAt / endsAt / reason).
        await updateAdminLot(adminKey, (lot as { id: string }).id, built.payload);
        return { message: 'Alteração salva com sucesso.' };
      }
      throw new ApiError('Nada para salvar.', { code: 'validation', businessCode: 'CONFIG_NOTHING_TO_SAVE' });
    });
  };

  const acknowledgeConfigSave = () => {
    saveMutation.acknowledge();
    setSaveDraft(null);
    void load();
  };

  const closeConfigSave = () => {
    saveMutation.reset();
    setSaveDraft(null);
  };
  const runCheck = async (target: 'email' | 'gateway') => {
    setCheckLoading(target);
    setMessage('');
    try {
      const result = await runAdminSystemCheck(adminKey, target);
      setCheckResult(result);
      setMessage(result.summary);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Falha ao executar diagnostico.');
    } finally {
      setCheckLoading('');
    }
  };
  return <section className="mt-4 space-y-4">
    {message && <p className="border border-brand/20 bg-brand/10 p-3 text-sm text-brand">{message}</p>}
    {eventAlerts.length > 0 && <Panel title="Alertas automaticos" eyebrow="Prioridade"><div className="grid gap-3 lg:grid-cols-2">{eventAlerts.map((alert) => <div key={alert.key} className="border border-amber-400/20 bg-amber-400/10 p-4"><p className="text-xs font-black uppercase tracking-widest text-amber-300">{alert.title}</p><p className="mt-2 text-sm text-amber-50">{alert.detail}</p></div>)}</div></Panel>}
    <Panel title="Saúde do sistema" eyebrow="Operação">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricBox label="Banco" value={config.health.database.ok ? 'Online' : 'Falha'} detail={config.health.database.provider} tone={config.health.database.ok ? 'default' : 'warning'} />
        <MetricBox label="Email" value={config.health.email.configured ? 'Configurado' : 'Pendente'} detail={config.health.email.provider} tone={config.health.email.configured ? 'default' : 'warning'} />
        <MetricBox label="Gateway" value={config.health.gateway.configured ? 'Configurado' : 'Pendente'} detail={config.health.gateway.provider} tone={config.health.gateway.configured ? 'default' : 'warning'} />
        <MetricBox label="Inscricoes" value={availabilityLabel} detail={config.health.sales.activeLotName || 'Sem lote ativo'} tone={config.health.sales.registrationAvailability === 'available' ? 'default' : 'warning'} />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="border border-white/10 bg-black/30 p-4 text-sm text-zinc-300">
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Disponibilidade</p>
          <div className="mt-3 space-y-2">
            <p>Status do evento: <span className="font-bold">{config.health.sales.eventStatus}</span></p>
            <p>Lote ativo: <span className="font-bold">{config.health.sales.activeLotName || 'Nenhum'}</span></p>
            <p>Distancias ativas: <span className="font-bold">{config.health.sales.activeDistances}</span> de {config.health.sales.availableDistances}</p>
          </div>
        </div>
        <div className="border border-white/10 bg-black/30 p-4 text-sm text-zinc-300">
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Diagnostico</p>
          <div className="mt-3 space-y-2">
            {!config.health.database.ok && <p className="text-amber-300">Banco indisponivel: {config.health.database.issue || 'sem detalhes'}</p>}
            {!config.health.email.configured && <p className="text-amber-300">Email transacional não configurado.</p>}
            {!config.health.gateway.configured && <p className="text-amber-300">Gateway sem provider ou handle configurado.</p>}
            {config.health.database.ok && config.health.email.configured && config.health.gateway.configured && <p className="text-brand">Serviços principais configurados para operação.</p>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void runCheck('email')} disabled={checkLoading !== ''} className="border border-brand px-3 py-2 text-xs font-black uppercase text-brand disabled:opacity-50">{checkLoading === 'email' ? 'Validando email...' : 'Validar email'}</button>
            <button type="button" onClick={() => void runCheck('gateway')} disabled={checkLoading !== ''} className="border border-brand px-3 py-2 text-xs font-black uppercase text-brand disabled:opacity-50">{checkLoading === 'gateway' ? 'Validando gateway...' : 'Validar gateway'}</button>
          </div>
        </div>
      </div>
      {checkResult && <div className="mt-4 border border-white/10 bg-black/30 p-4 text-sm text-zinc-300"><p className="text-xs font-black uppercase tracking-widest text-zinc-500">Ultimo diagnostico: {checkResult.target}</p><p className={`mt-3 font-bold ${checkResult.ok ? 'text-brand' : 'text-amber-300'}`}>{checkResult.summary}</p><div className="mt-3 space-y-2">{checkResult.checks.map((item) => <div key={`${checkResult.target}-${item.label}`} className="flex items-start justify-between gap-3 border-t border-white/10 pt-2 first:border-t-0 first:pt-0"><div><p className="font-bold">{item.label}</p><p className="text-xs text-zinc-500">{item.detail}</p></div><span className={item.ok ? 'text-brand' : 'text-amber-300'}>{item.ok ? 'OK' : 'Pendente'}</span></div>)}</div></div>}
    </Panel>
    <Panel title="Dados do evento" eyebrow="Configuracao">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <EditInput label="Nome" value={config.event.name} onChange={(value) => updateEvent('name', value)} />
        <EditInput label="Data" type="date" value={config.event.date} onChange={(value) => updateEvent('date', value)} />
        <EditInput label="Horario" type="time" value={config.event.startTime} onChange={(value) => updateEvent('startTime', value)} />
        <EditInput label="Local" value={config.event.locationName} onChange={(value) => updateEvent('locationName', value)} />
        <EditInput label="Cidade" value={config.event.city} onChange={(value) => updateEvent('city', value)} />
        <EditInput label="UF" value={config.event.state} maxLength={2} onChange={(value) => updateEvent('state', value.toUpperCase())} />
        <label className="text-xs font-bold text-zinc-400">Status<select value={config.event.status} onChange={(event) => updateEvent('status', event.target.value)} className="mt-1 min-h-11 w-full border border-white/10 bg-black p-2 text-white"><option value="published">Publicado</option><option value="draft">Rascunho</option><option value="closed">Encerrado</option></select></label>
      </div>
      <button type="button" onClick={() => { saveMutation.reset(); setSaveDraft({ kind: 'event', reason: '' }); }} className="mt-4 bg-brand px-4 py-3 text-xs font-black uppercase text-black">Salvar evento</button>
    </Panel>
    <Panel title="Distancias" eyebrow="Capacidade">
      <div className="grid gap-3 lg:grid-cols-2">{config.distances.map((distance) => <div key={distance.id} className="border border-white/10 bg-black/30 p-4"><p className="font-black">{distance.name}</p><div className="mt-3 grid grid-cols-2 gap-2"><EditInput label="Capacidade" type="number" value={String(distance.capacity)} onChange={(value) => setConfig({ ...config, distances: config.distances.map((item) => item.id === distance.id ? { ...item, capacity: Number(value) } : item) })} /><label className="text-xs font-bold text-zinc-400">Status<select value={distance.status} onChange={(event) => setConfig({ ...config, distances: config.distances.map((item) => item.id === distance.id ? { ...item, status: event.target.value } : item) })} className="mt-1 min-h-11 w-full border border-white/10 bg-black p-2 text-white"><option value="active">Ativa</option><option value="inactive">Inativa</option><option value="sold_out">Esgotada</option></select></label></div><button type="button" onClick={() => { saveMutation.reset(); setSaveDraft({ kind: 'distance', id: distance.id, reason: '' }); }} className="mt-3 border border-brand px-3 py-2 text-xs font-black uppercase text-brand">Salvar</button></div>)}</div>
    </Panel>
    <Panel title="Lotes e vendas" eyebrow="Comercial">
      <div className="grid gap-3 xl:grid-cols-2">{config.lots.map((lot) => <div key={lot.id} className="border border-white/10 bg-black/30 p-4"><div className="grid gap-2 sm:grid-cols-2"><EditInput label="Nome" value={lot.name} onChange={(value) => setConfig({ ...config, lots: config.lots.map((item) => item.id === lot.id ? { ...item, name: value } : item) })} /><EditInput label="Preco em centavos" type="number" value={String(lot.priceCents)} onChange={(value) => setConfig({ ...config, lots: config.lots.map((item) => item.id === lot.id ? { ...item, priceCents: Number(value) } : item) })} /><EditInput label="Capacidade" type="number" value={String(lot.capacity)} onChange={(value) => setConfig({ ...config, lots: config.lots.map((item) => item.id === lot.id ? { ...item, capacity: Number(value) } : item) })} /><label className="text-xs font-bold text-zinc-400">Status<select value={lot.status} onChange={(event) => setConfig({ ...config, lots: config.lots.map((item) => item.id === lot.id ? { ...item, status: event.target.value } : item) })} className="mt-1 min-h-11 w-full border border-white/10 bg-black p-2 text-white"><option value="active">Ativo</option><option value="scheduled">Agendado</option><option value="inactive">Inativo</option><option value="sold_out">Esgotado</option><option value="closed">Encerrado</option></select></label><EditInput label="Inicio" type="datetime-local" value={lot.startsAt.slice(0, 16)} onChange={(value) => setConfig({ ...config, lots: config.lots.map((item) => item.id === lot.id ? { ...item, startsAt: value } : item) })} /><EditInput label="Fim" type="datetime-local" value={lot.endsAt.slice(0, 16)} onChange={(value) => setConfig({ ...config, lots: config.lots.map((item) => item.id === lot.id ? { ...item, endsAt: value } : item) })} /></div><p className="mt-2 text-xs text-zinc-500">{lot.soldCount} vagas ocupadas</p><button type="button" onClick={() => { saveMutation.reset(); setSaveDraft({ kind: 'lot', id: lot.id, reason: '' }); }} className="mt-3 border border-brand px-3 py-2 text-xs font-black uppercase text-brand">Salvar lote</button></div>)}</div>
    </Panel>
    {saveDraft && (
      <ConfigSaveModal
        kind={saveDraft.kind}
        reason={saveDraft.reason}
        onReasonChange={(value) => setSaveDraft({ ...saveDraft, reason: value })}
        state={saveMutation.state}
        onSubmit={submitConfigSave}
        onAcknowledge={acknowledgeConfigSave}
        onSessionExpired={() => { window.location.href = '/admin'; }}
        onClose={closeConfigSave}
      />
    )}
  </section>;
}

function MetricBox({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className={`border p-4 ${tone === 'warning' ? 'border-amber-400/20 bg-amber-400/10' : 'border-white/10 bg-black/35'}`}>
      <p className="text-xs font-black uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-3 font-mono text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-widest text-zinc-500">{detail}</p>
    </div>
  );
}

function RegistrationsPanel({
  adminKey,
  adminRole,
  summary,
  registrations,
  filters,
  pagination,
  event,
  eventError,
  eventOptions,
  onSelectEvent,
  loading,
  onFiltersChange,
  onSearch,
  onOpenRegistration,
}: {
  adminKey: string;
  adminRole: AdminRole | null;
  summary: AdminSummaryResponse | null;
  registrations: AdminRegistration[];
  filters: AdminFilters;
  pagination: AdminRegistrationsResponse['pagination'];
  event: AdminEventContext | null;
  eventError: { code: string; message: string } | null;
  eventOptions: AdminEventListItem[];
  onSelectEvent: (slug: string) => void;
  loading: boolean;
  onFiltersChange: (filters: AdminFilters) => void;
  onSearch: (event: FormEvent) => void;
  onOpenRegistration: (registration: AdminRegistration) => void;
}) {
  const [syncingId, setSyncingId] = useState('');
  // ADMIN-003 Stage 3: the `operation` role never receives financial fields
  // from the backend — hide the "Valor" column and its sort so the surface
  // matches the contract.
  const showFinancialColumn = adminRole !== 'operation';

  // ADMIN-003 Stage 2 §8/§29: 2+ published events (or an unknown/closed slug
  // that no longer resolves) → require an explicit human choice. No table, no
  // "first/most recent" auto-pick, no repeated calls to an invalid endpoint.
  if (eventError) {
    return (
      <section className="mt-4 border border-white/10 bg-zinc-950/80">
        <div className="p-6 md:p-8">
          <p className="text-xs font-black uppercase tracking-widest text-brand">Inscrições</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">Selecione um evento</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            {eventError.code === 'NO_PUBLISHED_EVENT'
              ? 'Nenhum evento publicado no momento. Publique um evento para acompanhar as pessoas inscritas.'
              : eventError.code === 'EVENT_NOT_FOUND'
                ? 'O evento informado no endereço não foi encontrado. Escolha um evento para continuar.'
                : 'Há mais de um evento publicado. Escolha qual evento você quer acompanhar nas inscrições.'}
          </p>
          {eventOptions.length > 0 && (
            <label className="mt-5 block max-w-md text-xs font-bold uppercase tracking-widest text-zinc-400">
              Evento
              <select
                className="mt-2 min-h-12 w-full border border-zinc-800 bg-black px-3 text-white outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40"
                defaultValue=""
                onChange={(changeEvent) => { if (changeEvent.target.value) onSelectEvent(changeEvent.target.value); }}
              >
                <option value="" disabled>Escolha um evento…</option>
                {eventOptions.map((option) => (
                  <option key={option.id} value={option.slug}>
                    {option.name}{option.status === 'closed' ? ' (encerrado)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
    );
  }

  const peopleCount = pagination.people ?? pagination.total;
  const historicalCount = pagination.historicalRegistrations ?? peopleCount;

  return (
    <section className="mt-4 border border-white/10 bg-zinc-950/80">
      <div className="border-b border-white/10 p-4 md:p-5">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-brand">Inscrições</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">Mesa operacional de atletas</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
              Pessoas inscritas no evento selecionado. Cada linha é uma pessoa; as tentativas anteriores ficam no histórico do atleta.
            </p>
            {event && (
              <p className="mt-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
                Evento: <span className="text-white">{event.name}</span>
                {event.status === 'closed' && <span className="ml-2 text-amber-300">(encerrado)</span>}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
            {eventOptions.length > 1 && (
              <select
                aria-label="Trocar de evento"
                className="border border-white/10 bg-black px-2.5 py-1 text-white outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40"
                value={event?.slug || ''}
                onChange={(changeEvent) => onSelectEvent(changeEvent.target.value)}
              >
                {!event && <option value="" disabled>Selecione um evento…</option>}
                {eventOptions.map((option) => (
                  <option key={option.id} value={option.slug}>
                    {option.name}{option.status === 'closed' ? ' (encerrado)' : ''}
                  </option>
                ))}
              </select>
            )}
            <span className="border border-white/10 px-2.5 py-1">Ordenação: recentes</span>
          </div>
        </div>

        <form onSubmit={onSearch} className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_180px_160px]">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={filters.q}
              onChange={(event) => onFiltersChange({ ...filters, q: event.target.value, page: '1' })}
              className="min-h-12 w-full border border-zinc-800 bg-black py-3 pl-11 pr-4 text-white outline-none transition-colors focus:border-brand"
              placeholder="Pesquisa inteligente: nome, email ou telefone"
            />
          </div>
          <SelectFilter value={filters.status} onChange={(value) => onFiltersChange({ ...filters, status: value, page: '1' })} options={statusOptions} />
          <SelectFilter
            value={filters.distanceId}
            onChange={(value) => onFiltersChange({ ...filters, distanceId: value, page: '1' })}
            options={[
              { value: '', label: 'Todas distancias' },
              ...(summary?.byDistance.map((distance) => ({ value: distance.id, label: distance.name })) || []),
            ]}
          />
          <SelectFilter
            value={filters.lotId}
            onChange={(value) => onFiltersChange({ ...filters, lotId: value, page: '1' })}
            options={[
              { value: '', label: 'Todos lotes' },
              ...(summary?.lots.map((lot) => ({ value: lot.id, label: lot.name })) || []),
            ]}
          />
        </form>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <input value={filters.city} onChange={(event) => onFiltersChange({ ...filters, city: event.target.value, page: '1' })} className="min-h-12 border border-zinc-800 bg-black p-3 text-white outline-none focus:border-brand" placeholder="Filtrar por cidade" />
          <input value={filters.team} onChange={(event) => onFiltersChange({ ...filters, team: event.target.value, page: '1' })} className="min-h-12 border border-zinc-800 bg-black p-3 text-white outline-none focus:border-brand" placeholder="Filtrar por equipe" />
          <input value={filters.bibNumber} onChange={(event) => onFiltersChange({ ...filters, bibNumber: event.target.value, page: '1' })} className="min-h-12 border border-zinc-800 bg-black p-3 text-white outline-none focus:border-brand" placeholder="Numero de peito" />
          <SelectFilter value={filters.shirtSize} onChange={(value) => onFiltersChange({ ...filters, shirtSize: value, page: '1' })} options={[{ value: '', label: 'Todas as camisas' }, ...eventInfo.shirtSizes.map((size) => ({ value: size, label: `Camisa ${size}` }))]} />
          <SelectFilter value={filters.sheetStatus} onChange={(value) => onFiltersChange({ ...filters, sheetStatus: value, page: '1' })} options={[{ value: '', label: 'Todos no Sheets' }, { value: 'unsynchronized', label: 'Não sincronizados' }]} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
          <span>
            <span className="font-bold text-zinc-300">{formatCount(peopleCount)} {peopleCount === 1 ? 'pessoa' : 'pessoas'}</span>
            {historicalCount !== peopleCount && (
              <span className="ml-2 text-zinc-500">· {formatCount(historicalCount)} registros históricos</span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <SelectFilter value={filters.sortBy} onChange={(value) => onFiltersChange({ ...filters, sortBy: value, page: '1' })} options={[{ value: 'createdAt', label: 'Ordenar por data' }, { value: 'fullName', label: 'Ordenar por nome' }, { value: 'status', label: 'Ordenar por status' }, ...(showFinancialColumn ? [{ value: 'amountCents', label: 'Ordenar por valor' }] : []), { value: 'bibNumber', label: 'Ordenar por peito' }]} />
            <SelectFilter value={filters.sortOrder} onChange={(value) => onFiltersChange({ ...filters, sortOrder: value, page: '1' })} options={[{ value: 'desc', label: 'Decrescente' }, { value: 'asc', label: 'Crescente' }]} />
            <SelectFilter value={filters.pageSize} onChange={(value) => onFiltersChange({ ...filters, pageSize: value, page: '1' })} options={[{ value: '25', label: '25 por pagina' }, { value: '50', label: '50 por pagina' }, { value: '100', label: '100 por pagina' }]} />
            <button type="button" onClick={() => onFiltersChange({ status: '', distanceId: '', lotId: '', q: '', page: '1', pageSize: filters.pageSize, city: '', team: '', shirtSize: '', bibNumber: '', sortBy: 'createdAt', sortOrder: 'desc', sheetStatus: '' })} className="border border-white/10 px-3 py-2 font-black uppercase hover:border-brand hover:text-brand">Limpar filtros</button>
          </div>
        </div>
      </div>

      {loading && registrations.length === 0 ? (
        <TableSkeleton />
      ) : registrations.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-275 text-left">
            <thead className="bg-black/50 text-xs uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="p-4">Atleta</th>
                <th className="p-4">Contato</th>
                <th className="p-4">Prova</th>
                <th className="p-4">Lote</th>
                <th className="p-4">Pagamento</th>
                {showFinancialColumn && <th className="p-4">Valor</th>}
                <th className="p-4">Inscrição</th>
                <th className="p-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((registration) => (
                <tr key={registration.id} className="border-t border-white/10 transition-colors hover:bg-white/3">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-brand/10 text-sm font-black text-brand">
                        {getInitials(registration.fullName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-bold">{registration.fullName}</p>
                        <p className="mt-1 truncate font-mono text-xs text-zinc-500">{registration.id}</p>
                        {registration.bibNumber && <p className="mt-1 text-xs font-black uppercase text-brand">Peito {registration.bibNumber}</p>}
                        {(registration.attemptsCount ?? 1) > 1 && (
                          <p className="mt-1 inline-block border border-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                            {registration.attemptsCount} tentativas
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-4 font-mono text-sm text-zinc-300">
                    <p className="truncate">{registration.email}</p>
                    <p className="mt-1 text-zinc-500">{registration.phone}</p>
                    <p className="mt-1 text-zinc-600">{registration.cpfMasked}</p>
                    {(registration.city || registration.team) && <p className="mt-1 text-zinc-600">{[registration.city, registration.state, registration.team].filter(Boolean).join(' · ')}</p>}
                  </td>
                  <td className="p-4">
                    <p className="font-black">{registration.distance}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Camisa {registration.shirtSize}</p>
                  </td>
                  <td className="p-4 text-sm font-bold text-zinc-300">{registration.lot}</td>
                  <td className="p-4">
                    <PaymentStatus status={registration.status} />
                  </td>
                  {showFinancialColumn && <td className="p-4 font-mono font-bold">{formatCentsBRL(registration.amountCents)}</td>}
                  <td className="p-4 font-mono text-xs text-zinc-500">{dateTimeFormatter.format(new Date(registration.createdAt))}</td>
                  <td className="p-4 text-right">
                    <button type="button" disabled={syncingId === registration.id} onClick={() => void (async () => { setSyncingId(registration.id); try { await syncAdminRegistrationToGoogleSheets(adminKey, registration.id); } finally { setSyncingId(''); } })()} className="mr-2 inline-flex min-h-10 items-center gap-2 border border-white/10 px-3 text-xs font-black uppercase text-zinc-300 hover:border-brand hover:text-brand disabled:opacity-40"><RefreshCcw className="h-4 w-4" />Sheets</button>
                    <button
                      type="button"
                      onClick={() => onOpenRegistration(registration)}
                      className="inline-flex min-h-10 items-center gap-2 border border-white/10 px-3 text-xs font-black uppercase tracking-widest text-zinc-200 transition-colors hover:border-brand hover:text-brand"
                    >
                      <Eye className="h-4 w-4" /> Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination.totalPages > 1 && <div className="flex items-center justify-between border-t border-white/10 p-4">
        <button type="button" disabled={pagination.page <= 1 || loading} onClick={() => onFiltersChange({ ...filters, page: String(pagination.page - 1) })} className="border border-white/10 px-4 py-2 text-xs font-black uppercase disabled:opacity-30">Anterior</button>
        <span className="font-mono text-xs text-zinc-400">Pagina {pagination.page} de {pagination.totalPages}</span>
        <button type="button" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => onFiltersChange({ ...filters, page: String(pagination.page + 1) })} className="border border-white/10 px-4 py-2 text-xs font-black uppercase disabled:opacity-30">Proxima</button>
      </div>}
    </section>
  );
}

function RegistrationEditForm({ registration, loading, onSave }: { registration: AdminRegistration; loading: boolean; onSave: (registration: AdminRegistration, changes: AdminRegistrationEditable, reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<AdminRegistrationEditable>(() => ({
    fullName: registration.fullName, email: registration.email, phone: registration.phone, birthDate: registration.birthDate,
    gender: registration.gender, shirtSize: registration.shirtSize, emergencyContactName: registration.emergencyContactName,
    emergencyContactPhone: registration.emergencyContactPhone, city: registration.city, state: registration.state, team: registration.team,
  }));
  useEffect(() => {
    setForm({
      fullName: registration.fullName, email: registration.email, phone: registration.phone, birthDate: registration.birthDate,
      gender: registration.gender, shirtSize: registration.shirtSize, emergencyContactName: registration.emergencyContactName,
      emergencyContactPhone: registration.emergencyContactPhone, city: registration.city, state: registration.state, team: registration.team,
    });
  }, [registration.id, registration.updatedAt]);
  const update = (field: keyof AdminRegistrationEditable, value: string) => setForm((current) => ({ ...current, [field]: value }));
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-5 w-full border border-white/10 px-4 py-3 text-xs font-black uppercase hover:border-brand hover:text-brand">Editar dados cadastrais</button>;
  return <div className="mt-5 border border-white/10 bg-black/30 p-4">
    <div className="mb-4 flex justify-between"><p className="text-xs font-black uppercase text-brand">Editar cadastro</p><button type="button" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <EditInput label="Nome" value={form.fullName} onChange={(value) => update('fullName', value)} />
      <EditInput label="Email" type="email" value={form.email} onChange={(value) => update('email', value)} />
      <EditInput label="Telefone" value={form.phone} onChange={(value) => update('phone', value)} />
      <EditInput label="Nascimento" type="date" value={form.birthDate} onChange={(value) => update('birthDate', value)} />
      <EditInput label="Cidade" value={form.city || ''} onChange={(value) => update('city', value)} />
      <EditInput label="UF" value={form.state || ''} maxLength={2} onChange={(value) => update('state', value.toUpperCase())} />
      <EditInput label="Equipe" value={form.team || ''} onChange={(value) => update('team', value)} />
      <EditInput label="Contato de emergencia" value={form.emergencyContactName} onChange={(value) => update('emergencyContactName', value)} />
      <EditInput label="Telefone emergencia" value={form.emergencyContactPhone} onChange={(value) => update('emergencyContactPhone', value)} />
      <label className="text-xs font-bold text-zinc-400">Sexo<select value={form.gender} onChange={(event) => update('gender', event.target.value)} className="mt-1 min-h-11 w-full border border-white/10 bg-black p-2 text-white"><option value="female">Feminino</option><option value="male">Masculino</option></select></label>
      <label className="text-xs font-bold text-zinc-400">Camisa<select value={form.shirtSize} onChange={(event) => update('shirtSize', event.target.value)} className="mt-1 min-h-11 w-full border border-white/10 bg-black p-2 text-white">{eventInfo.shirtSizes.map((size) => <option key={size}>{size}</option>)}</select></label>
    </div>
    <label className="mt-3 block text-xs font-bold text-zinc-400">Motivo da alteracao<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full border border-white/10 bg-black p-3 text-white" /></label>
    <button type="button" disabled={loading || reason.trim().length < 5} onClick={() => void onSave(registration, form, reason).then(() => { setOpen(false); setReason(''); })} className="mt-3 bg-brand px-4 py-3 text-xs font-black uppercase text-black disabled:opacity-40">{loading ? 'Salvando...' : 'Salvar alteracoes'}</button>
  </div>;
}

function canAccessNav(role: AdminRole | null, nav: AdminNavKey) {
  return role ? navPermissions[nav].includes(role) : false;
}

function EditInput({ label, value, onChange, type = 'text', maxLength }: { label: string; value: string; onChange: (value: string) => void; type?: string; maxLength?: number }) {
  return <label className="text-xs font-bold text-zinc-400">{label}<input type={type} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full border border-white/10 bg-black p-2 text-white" /></label>;
}

// EMAIL-OPS-002 Stage 2 — confirmation send/resend modal driven by the reusable
// mutation state machine. Feedback is rendered HERE (in-context), never through
// the page-level `error` banner that loadAdminData() / the 60s poll clear. 401
// is an explicit described session-expiry with its own button — never a silent
// logout mid-action.
function SendConfirmationEmailModal({
  email,
  fullName,
  state,
  onSubmit,
  onAcknowledge,
  onSessionExpired,
  onClose,
}: {
  email: string;
  fullName: string;
  state: AdminMutationState<{ message?: string; registration?: AdminRegistration }>;
  onSubmit: () => void;
  onAcknowledge: () => void;
  onSessionExpired: () => void;
  onClose: () => void;
}) {
  const submitting = state.phase === 'submitting';
  const succeeded = state.phase === 'success';
  const failed = state.phase === 'failure';
  const sessionExpired = failed && Boolean(state.error?.sessionExpired);
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4">
      <button type="button" aria-label="Fechar modal" className="absolute inset-0" onClick={submitting ? undefined : onClose} />
      <div className="relative w-full max-w-lg border border-white/10 bg-zinc-950 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-black">Enviar email de confirmação</h3>
            <p className="mt-2 text-sm text-zinc-400">A confirmação de <span className="text-white">{fullName}</span> será enviada para <span className="text-white">{email}</span>.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="flex h-10 w-10 items-center justify-center border border-white/10 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {succeeded && (
          <div className="mt-5 border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100" role="status">
            {state.successMessage || 'Email de confirmação enviado com sucesso.'}
          </div>
        )}
        {failed && (
          <div className="mt-5 border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100" role="alert">
            {state.error?.message || 'Não foi possível concluir a ação.'}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {succeeded ? (
            <button type="button" onClick={onAcknowledge} className="border border-emerald-400/40 px-4 py-3 text-xs font-black uppercase text-emerald-200">Concluir</button>
          ) : sessionExpired ? (
            <button type="button" onClick={onSessionExpired} className="border border-brand/40 px-4 py-3 text-xs font-black uppercase text-brand">Entrar novamente</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={submitting} className="border border-white/10 px-4 py-3 text-xs font-black uppercase text-zinc-300 disabled:opacity-40">Fechar</button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting}
                className="flex items-center gap-2 border border-brand/40 px-4 py-3 text-xs font-black uppercase text-brand disabled:opacity-40"
              >
                {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                {submitting ? 'Enviando...' : failed ? 'Tentar novamente' : 'Enviar email'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ADMIN-UX-HOTFIX-001 — event / distance / lot config save modal on the reusable
// mutation state machine. One confirm → one PATCH. The submitting / success /
// failure surface is rendered HERE (durable); the modal never disappears leaving
// the operator unsure whether the change persisted.
function ConfigSaveModal({
  kind,
  reason,
  onReasonChange,
  state,
  onSubmit,
  onAcknowledge,
  onSessionExpired,
  onClose,
}: {
  kind: 'event' | 'distance' | 'lot';
  reason: string;
  onReasonChange: (value: string) => void;
  state: AdminMutationState<{ message?: string }>;
  onSubmit: () => void;
  onAcknowledge: () => void;
  onSessionExpired: () => void;
  onClose: () => void;
}) {
  const submitting = state.phase === 'submitting';
  const succeeded = state.phase === 'success';
  const failed = state.phase === 'failure';
  const sessionExpired = failed && Boolean(state.error?.sessionExpired);
  const entity = kind === 'lot' ? 'lote' : kind === 'distance' ? 'distância' : 'evento';
  const reasonValid = reason.trim().length >= 5;
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4">
      <button type="button" aria-label="Fechar modal" className="absolute inset-0" onClick={submitting ? undefined : onClose} />
      <div className="relative w-full max-w-lg border border-white/10 bg-zinc-950 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-black">Confirmar alteração de {entity}</h3>
            <p className="mt-2 text-sm text-zinc-400">Registre o motivo antes de salvar. A alteração é auditada.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="flex h-10 w-10 items-center justify-center border border-white/10 disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!succeeded && !sessionExpired && (
          <label className="mt-5 block text-xs font-bold text-zinc-400">
            Motivo da alteração <span className="font-normal text-zinc-500">(mínimo de 5 caracteres)</span>
            <textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              disabled={submitting}
              className="mt-1 min-h-24 w-full border border-white/10 bg-black p-3 text-white disabled:opacity-60"
            />
            <span className="mt-1 block text-right font-mono text-[10px] text-zinc-500">{reason.trim().length}/5</span>
          </label>
        )}

        {succeeded && (
          <div className="mt-5 border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100" role="status">
            {state.successMessage || 'Alteração salva com sucesso.'}
          </div>
        )}
        {failed && (
          <div className="mt-5 border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100" role="alert">
            {state.error?.message || 'Não foi possível salvar a alteração.'}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {succeeded ? (
            <button type="button" onClick={onAcknowledge} className="border border-emerald-400/40 px-4 py-3 text-xs font-black uppercase text-emerald-200">Concluir</button>
          ) : sessionExpired ? (
            <button type="button" onClick={onSessionExpired} className="border border-brand/40 px-4 py-3 text-xs font-black uppercase text-brand">Entrar novamente</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={submitting} className="border border-white/10 px-4 py-3 text-xs font-black uppercase text-zinc-300 disabled:opacity-40">Fechar</button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting || !reasonValid}
                className="flex items-center gap-2 bg-brand px-4 py-3 text-xs font-black uppercase text-black disabled:opacity-40"
              >
                {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                {submitting ? 'Salvando…' : failed ? 'Tentar novamente' : 'Salvar alteração'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionModal({
  title,
  description,
  loading,
  confirmLabel,
  confirmTone = 'brand',
  confirmDisabled,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  confirmLabel: string;
  confirmTone?: 'brand' | 'danger';
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4">
      <button type="button" aria-label="Fechar modal" className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-lg border border-white/10 bg-zinc-950 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-black">{title}</h3>
            {description && <p className="mt-2 text-sm text-zinc-400">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center border border-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children && <div className="mt-5 space-y-4">{children}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="border border-white/10 px-4 py-3 text-xs font-black uppercase text-zinc-300">Cancelar</button>
          <button
            type="button"
            disabled={confirmDisabled || loading}
            onClick={onConfirm}
            className={`${confirmTone === 'danger' ? 'bg-red-500 text-white' : 'bg-brand text-black'} px-4 py-3 text-xs font-black uppercase disabled:opacity-40`}
          >
            {loading ? 'Processando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function OperationalQr({ registrationId }: { registrationId: string }) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => { void QRCode.toDataURL(`funpace:registration:${registrationId}`, { width: 320, margin: 2, color: { dark: '#000000', light: '#d7ff00' } }).then(setDataUrl); }, [registrationId]);
  return <div className="flex aspect-square items-center justify-center border border-white/10 bg-brand p-3">{dataUrl ? <img src={dataUrl} alt={`QR Code da inscrição ${registrationId}`} className="h-full w-full" /> : <Loader2 className="h-8 w-8 animate-spin text-black" />}</div>;
}

function AthleteDrawer({
  registration,
  details,
  actionLoading,
  adminRole,
  onCheckIn,
  onKitDelivery,
  onMaintenance,
  onUpdate,
  onAssignBib,
  onClose,
}: {
  registration: AdminRegistration | null;
  details: AdminRegistrationDetailsResponse | null;
  actionLoading: string;
  adminRole: AdminRole | null;
  onCheckIn: (registration: AdminRegistration) => void;
  onKitDelivery: (registration: AdminRegistration) => void;
  onMaintenance: (registration: AdminRegistration, action: 'cancel' | 'send-email' | 'undo-check-in' | 'undo-kit') => void;
  onUpdate: (registration: AdminRegistration, changes: AdminRegistrationEditable, reason: string) => Promise<void>;
  onAssignBib: (registration: AdminRegistration) => void;
  onClose: () => void;
}) {
  if (!registration) {
    return null;
  }

  const createdAt = new Date(registration.createdAt);
  const canOperate = registration.status === 'paid';
  const canEditRegistration = adminRole === 'administrator';
  const canAssignBib = adminRole === 'administrator' || adminRole === 'operation';
  const canHandleOperation = canAssignBib;
  const canResendEmail = adminRole === 'administrator' || adminRole === 'finance';
  const canCancelRegistration = adminRole === 'administrator';
  // ADMIN-003 Stage 3: `operation` gets no financial data from the backend.
  const canSeeFinancial = adminRole === 'administrator' || adminRole === 'finance';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75">
      <button type="button" aria-label="Fechar detalhes" className="absolute inset-0" onClick={onClose} />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-zinc-950 p-5 shadow-2xl sm:p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/10 text-xl font-black text-brand">
              {getInitials(registration.fullName)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-widest text-brand">Perfil do atleta</p>
              <h2 className="mt-2 truncate text-2xl font-black">{registration.fullName}</h2>
              <p className="mt-1 font-mono text-xs text-zinc-500">{registration.id}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="CPF" value={registration.cpfMasked} />
          <Detail label="Nascimento" value={registration.birthDate ? formatDateOnly(registration.birthDate) : 'Não informado'} />
          <Detail label="Idade" value={registration.age !== null ? `${registration.age} anos` : 'Não informada'} />
          <Detail label="Sexo" value={genderLabel(registration.gender)} />
          <Detail label="Telefone" value={registration.phone} />
          <Detail label="Email" value={registration.email} />
          <Detail label="Cidade" value={registration.city || 'Não coletada'} />
          <Detail label="Estado" value={registration.state || 'Não coletado'} />
          <Detail label="Equipe" value={registration.team || 'Não coletada'} />
          <Detail label="Distancia" value={registration.distance} />
          <Detail label="Lote" value={registration.lot} />
          <Detail label="Numero de peito" value={registration.bibNumber || 'A definir'} />
          <Detail label="Contato emergencia" value={registration.emergencyContactName} />
          <Detail label="Telefone emergencia" value={registration.emergencyContactPhone} />
        </div>

        {canEditRegistration && <RegistrationEditForm registration={registration} loading={actionLoading === 'edit'} onSave={onUpdate} />}
        {canAssignBib && <button type="button" disabled={actionLoading !== ''} onClick={() => onAssignBib(registration)} className="mt-3 w-full border border-brand/30 px-4 py-3 text-xs font-black uppercase text-brand">{registration.bibNumber ? 'Alterar numero de peito' : 'Atribuir numero de peito'}</button>}

        <div className="mt-5 grid gap-4 sm:grid-cols-[160px_1fr]">
          <OperationalQr registrationId={registration.id} />
          <div className="border border-white/10 bg-white/3 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-zinc-500">{canSeeFinancial ? 'Pagamento' : 'Situação'}</p>
            <div className="mt-3">
              <PaymentStatus status={registration.status} />
            </div>
            {canSeeFinancial && <p className="mt-4 font-mono text-2xl font-black">{formatCentsBRL(registration.amountCents)}</p>}
            <p className="mt-2 text-sm text-zinc-400">Inscrição criada em {dateTimeFormatter.format(createdAt)}</p>
          </div>
        </div>

        {details?.partnerHistory && <div className="mt-5 border border-brand/25 bg-brand/5 p-4">
          <p className="text-xs font-black uppercase tracking-widest text-brand">Historico do {details.partnerHistory.partnerType === 'influencer' ? 'Influenciador' : 'Parceiro'}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Detail label={details.partnerHistory.partnerType === 'influencer' ? 'Influenciador responsavel' : 'Assessoria responsavel'} value={details.partnerHistory.partnerName} />
            <Detail label="Percentual aplicado" value={`${details.partnerHistory.discountPercentage}%`} />
            <Detail label="Link utilizado" value={details.partnerHistory.partnerLink || 'Não registrado'} />
            <Detail label="Identificada em" value={dateTimeFormatter.format(new Date(details.partnerHistory.identifiedAt))} />
            <Detail label="Pagamento confirmado" value={details.partnerHistory.paidAt ? dateTimeFormatter.format(new Date(details.partnerHistory.paidAt)) : 'Ainda não confirmado'} />
            <Detail label="Usuário responsável" value={details.partnerHistory.responsibleUser || 'Processo automático'} />
          </div>
          <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-zinc-600">Snapshot protegido contra alteracoes apos a confirmacao</p>
        </div>}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={!canHandleOperation || !canOperate || registration.checkInStatus === 'checked_in' || actionLoading !== ''}
            onClick={() => onCheckIn(registration)}
            className="flex min-h-12 items-center justify-center gap-2 border border-brand/30 bg-brand px-4 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-zinc-500"
          >
            {actionLoading === 'check-in' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            {registration.checkInStatus === 'checked_in' ? 'Check-in realizado' : 'Registrar check-in'}
          </button>
          <button
            type="button"
            disabled={!canHandleOperation || !canOperate || registration.kitStatus === 'delivered' || actionLoading !== ''}
            onClick={() => onKitDelivery(registration)}
            className="flex min-h-12 items-center justify-center gap-2 border border-white/10 px-4 text-xs font-black uppercase tracking-widest text-zinc-100 transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:text-zinc-500"
          >
            {actionLoading === 'kit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            {registration.kitStatus === 'delivered' ? 'Kit entregue' : 'Entregar kit'}
          </button>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {canResendEmail && (registration.status === 'paid'
            ? registration.confirmationEmailSentAt
              ? <button type="button" disabled title="Email de confirmacao ja registrado" className="cursor-not-allowed border border-white/10 px-3 py-2 text-xs font-black uppercase text-zinc-600">Email enviado</button>
              : <button type="button" disabled={actionLoading !== ''} onClick={() => onMaintenance(registration, 'send-email')} className="border border-white/10 px-3 py-2 text-xs font-black uppercase">Enviar email</button>
            : <button type="button" disabled title="Disponivel somente apos a confirmacao do pagamento" className="cursor-not-allowed border border-white/10 px-3 py-2 text-xs font-black uppercase text-zinc-600">Email disponivel apos pagamento</button>)}
          {canHandleOperation && registration.checkInStatus === 'checked_in' && <button type="button" disabled={actionLoading !== ''} onClick={() => onMaintenance(registration, 'undo-check-in')} className="border border-white/10 px-3 py-2 text-xs font-black uppercase">Desfazer check-in</button>}
          {canHandleOperation && registration.kitStatus === 'delivered' && <button type="button" disabled={actionLoading !== ''} onClick={() => onMaintenance(registration, 'undo-kit')} className="border border-white/10 px-3 py-2 text-xs font-black uppercase">Desfazer entrega</button>}
          {canCancelRegistration && !['cancelled', 'refunded'].includes(registration.status) && <button type="button" disabled={actionLoading !== ''} onClick={() => onMaintenance(registration, 'cancel')} className="border border-red-400/30 px-3 py-2 text-xs font-black uppercase text-red-300">Cancelar inscrição</button>}
        </div>

        {!canOperate && (
          <p className="mt-3 border border-amber-400/20 bg-amber-400/10 p-3 text-xs font-bold uppercase tracking-wider text-amber-100">
            Operacoes presenciais liberadas apenas para inscrições pagas.
          </p>
        )}

        {(details?.personHistory?.length ?? 0) > 1 && (
          <details className="mt-5 border border-white/10 bg-white/3 p-4">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-widest text-zinc-300">
              Histórico de tentativas ({details?.personHistory.length})
            </summary>
            <p className="mt-2 text-xs text-zinc-500">
              Tentativas anteriores desta pessoa neste evento. Nenhuma foi apagada ou alterada; a linha principal é a inscrição canônica.
            </p>
            <ol className="mt-3 space-y-2">
              {(details?.personHistory || []).map((attempt) => (
                <li
                  key={attempt.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 border p-2 text-xs ${attempt.isCanonical ? 'border-brand/30 bg-brand/5' : 'border-white/10'}`}
                >
                  <span className={`border px-1.5 py-0.5 font-bold uppercase tracking-widest ${statusStyles[attempt.status]}`}>
                    {statusLabels[attempt.status]}
                  </span>
                  <span className="text-zinc-400">{dateTimeFormatter.format(new Date(attempt.createdAt))}</span>
                  {typeof attempt.amountCents === 'number' && <span className="text-zinc-400">{formatCentsBRL(attempt.amountCents)}</span>}
                  {attempt.paidAt && <span className="text-brand">pago em {dateTimeFormatter.format(new Date(attempt.paidAt))}</span>}
                  {attempt.isCanonical && <span className="font-bold uppercase tracking-widest text-brand">canônica</span>}
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">{attempt.id}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

        <div className="mt-5 border border-white/10 bg-white/3 p-4">
          <div role="tablist" aria-label="Detalhes da inscrição" className="border-b border-white/10 pb-3"><button type="button" role="tab" aria-selected="true" className="border-b-2 border-brand px-3 py-2 text-xs font-black uppercase tracking-widest text-brand">Timeline</button></div>
          <div className="mt-4 space-y-4">
            {(details?.timeline || []).map((event) => (
              <div key={event.id} className="flex gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${event.severity === 'critical' ? 'border-red-400/40 text-red-300' : event.severity === 'success' ? 'border-brand/30 text-brand' : 'border-white/10 text-zinc-400'}`}><Activity className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1"><p className="font-bold">{auditActionLabel(event.title)}</p><p className="mt-1 text-sm text-zinc-500">{dateTimeFormatter.format(new Date(event.occurredAt))} · {event.actor} · {event.origin}</p><details className="mt-2"><summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-zinc-600">Logs técnicos</summary><pre className="mt-2 max-h-52 overflow-auto border border-white/10 bg-black p-2 text-[10px] text-zinc-400">{JSON.stringify(event.details, null, 2)}</pre></details></div>
              </div>
            ))}
            {!details && <p className="text-sm text-zinc-500">Carregando timeline…</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Panel({ title, eyebrow, action, children }: { title: string; eyebrow: string; action?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border border-white/10 bg-zinc-950/80 p-4 md:p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-brand">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-black">{title}</h2>
        </div>
        {action && <span className="hidden text-xs font-bold uppercase tracking-widest text-zinc-500 sm:inline">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function TimelineChart({ data }: { data: ChartPoint[] }) {
  const max = Math.max(...data.map((item) => item.count), 1);

  return (
    <div className="h-64">
      <div className="flex h-52 items-end gap-2 border-b border-white/10">
        {data.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex w-full items-end justify-center">
              <div
                className="w-full max-w-10 bg-brand shadow-[0_0_22px_rgba(215,255,0,0.18)]"
                style={{ height: `${Math.max((item.count / max) * 180, item.count ? 18 : 4)}px` }}
              />
            </div>
            <span className="truncate font-mono text-[10px] uppercase text-zinc-600">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueChart({ data }: { data: ChartPoint[] }) {
  const max = Math.max(...data.map((item) => item.amountCents), 1);

  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.label} className="grid grid-cols-[72px_1fr_92px] items-center gap-3">
          <span className="font-mono text-xs text-zinc-500">{item.label}</span>
          <div className="h-2 overflow-hidden bg-white/10">
            <div className="h-full bg-brand" style={{ width: `${Math.max((item.amountCents / max) * 100, item.amountCents ? 8 : 2)}%` }} />
          </div>
          <span className="text-right font-mono text-xs text-zinc-300">{currencyFormatter.format(item.amountCents / 100)}</span>
        </div>
      ))}
    </div>
  );
}

function LotDistancePanel({ summary }: { summary: AdminSummaryResponse | null }) {
  if (!summary) {
    return <SkeletonBlock />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {summary.lots.map((lot) => {
          const percentage = lot.capacity ? Math.min((lot.soldCount / lot.capacity) * 100, 100) : 0;

          return (
            <div key={lot.id}>
              <div className="mb-2 flex justify-between gap-3 text-sm">
                <span className="font-bold">{lot.name}</span>
                <span className="font-mono text-zinc-400">{lot.confirmed} confirmadas + {lot.temporaryReservations} reservas / {lot.capacity}</span>
              </div>
              <div className="h-2 bg-white/10">
                <div className="h-full bg-brand" style={{ width: `${percentage}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {summary.byDistance.map((distance) => (
          <div key={distance.id} className="border border-white/10 bg-black/35 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-zinc-500">{distance.name}</p>
            <p className="mt-3 font-mono text-2xl font-black">{distance.total}</p>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-zinc-500">{distance.paid} pagos</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperationsPanel({ auditLogs }: { auditLogs: AdminAuditLog[] }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <OperationalCard icon={ClipboardCheck} label="Check-in" detail="Registro presencial para inscritos pagos." />
        <OperationalCard icon={Gift} label="Kit do atleta" detail="Controle de retirada individual no perfil." />
      </div>

      <div className="border border-white/10 bg-black/35 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Auditoria</p>
            <p className="mt-1 text-sm font-bold text-zinc-300">Ultimas acoes administrativas</p>
          </div>
          <Activity className="h-5 w-5 text-brand" />
        </div>

        {auditLogs.length === 0 ? (
          <p className="text-sm leading-relaxed text-zinc-500">
            Nenhuma acao operacional registrada ainda.
          </p>
        ) : (
          <div className="space-y-3">
            {auditLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="border-t border-white/10 pt-3">
                <p className="text-sm font-bold text-zinc-200">{auditActionLabel(log.action)}</p>
                <p className="mt-1 truncate font-mono text-xs text-zinc-500">{log.entityId}</p>
                <p className="mt-1 text-xs text-zinc-600">{dateTimeFormatter.format(new Date(log.createdAt))} por {log.actor}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OperationalCard({ icon: Icon, label, detail }: { icon: LucideIcon; label: string; detail: string }) {
  return (
    <div className="border border-white/10 bg-black/35 p-4">
      <Icon className="h-5 w-5 text-brand" />
      <p className="mt-4 font-bold">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-zinc-500">{detail}</p>
    </div>
  );
}

function SelectFilter({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-12 border border-zinc-800 bg-black p-3 text-white outline-none transition-colors focus:border-brand"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function PaymentStatus({ status }: { status: RegistrationStatus }) {
  return (
    <span className={`inline-flex items-center gap-2 border px-2.5 py-1 text-xs font-black uppercase tracking-widest ${statusStyles[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statusLabels[status]}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-white/10 bg-white/3 p-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-2 wrap-break-word text-sm font-bold text-zinc-200">{value}</p>
    </div>
  );
}

function TimelineItem({ icon: Icon, title, detail, muted }: { icon: LucideIcon; title: string; detail: string; muted?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${muted ? 'border-white/10 text-zinc-500' : 'border-brand/30 text-brand'}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="font-bold">{title}</p>
        <p className="mt-1 text-sm text-zinc-500">{detail}</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <Ticket className="h-10 w-10 text-zinc-600" />
      <h3 className="mt-5 text-xl font-black">Nenhuma inscrição encontrada</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
        Ajuste os filtros ou aguarde novas inscrições. Quando houver atletas, eles aparecerao nesta mesa operacional.
      </p>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse bg-white/4" />
      ))}
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="space-y-3">
      <div className="h-5 w-2/3 animate-pulse bg-white/10" />
      <div className="h-24 animate-pulse bg-white/10" />
      <div className="h-5 w-1/2 animate-pulse bg-white/10" />
    </div>
  );
}

function StatusMessage({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  return (
    <div className={`mb-4 border p-4 text-sm font-bold uppercase tracking-wider ${tone === 'error' ? 'border-red-400/30 bg-red-400/10 text-red-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </div>
  );
}

type ChartPoint = {
  label: string;
  count: number;
  amountCents: number;
};

type DashboardModel = {
  totalRegistrations: number;
  paidRegistrations: number;
  uniquePeople: number;
  uniquePaidPeople: number;
  todayRegistrations: number;
  weekRegistrations: number;
  revenueCents: number;
  todayRevenueCents: number;
  averageTicketCents: number;
  /** participant conversion (unique paid people / unique people), 1 decimal, from the canonical engine */
  conversionRate: number;
  financialVisible: boolean;
  remainingSpots: number;
  currentLotName: string;
  currentLotPriceCents: number;
  distanceSummary: string;
  daysRemaining: number;
  dailyRegistrations: ChartPoint[];
  dailyRevenue: ChartPoint[];
  checkIns: number;
  kitDeliveries: number;
  pendingPayments: number;
  paidWithoutEmail: number;
};

function getDashboardModel(summary: AdminSummaryResponse | null, registrations: AdminRegistration[]): DashboardModel {
  const now = new Date();
  const todayKey = toDateKey(now);
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);

  const activeLot = summary?.lots.find((lot) => lot.status === 'active') || summary?.lots[0];
  const paid = registrations.filter((registration) => registration.status === 'paid');
  const todayRegistrations = summary?.totals.todayRegistrations ?? registrations.filter((registration) => toDateKey(new Date(registration.createdAt)) === todayKey).length;
  const weekRegistrations = summary?.totals.weekRegistrations ?? registrations.filter((registration) => new Date(registration.createdAt) >= startOfDay(weekAgo)).length;
  // Financial / conversion numbers are business truth: consume the canonical
  // engine via /api/admin/summary. No independent frontend formulas.
  const financialVisible = summary?.totals.financialVisible ?? true;
  const todayRevenueCents = summary?.totals.todayRevenueCents ?? 0;
  const revenueCents = summary?.totals.revenueCents ?? 0;
  const totalRegistrations = summary?.totals.registrations ?? registrations.length;
  const paidRegistrations = summary?.totals.paid ?? paid.length;
  const averageTicketCents = summary?.totals.averageTicketCents ?? 0;
  const conversionRate = summary?.totals.participantConversionRate ?? 0;
  const dailyRegistrations = summary?.daily ?? [];
  const dailyRevenue = summary?.daily ?? [];

  return {
    totalRegistrations,
    paidRegistrations,
    uniquePeople: summary?.totals.uniquePeople ?? totalRegistrations,
    uniquePaidPeople: summary?.totals.uniquePaidPeople ?? paidRegistrations,
    todayRegistrations,
    weekRegistrations,
    revenueCents,
    todayRevenueCents,
    averageTicketCents,
    conversionRate,
    financialVisible,
    remainingSpots: activeLot?.remaining ?? eventInfo.currentLotCapacity,
    currentLotName: activeLot?.name || eventInfo.currentLot,
    currentLotPriceCents: activeLot?.priceCents ?? eventInfo.currentLotPriceCents,
    distanceSummary: summary?.byDistance.map((distance) => `${distance.name} ${distance.total}`).join(' / ') || '10K 0 / 5K 0',
    daysRemaining: Math.max(Math.ceil((new Date(eventInfo.startsAt).getTime() - now.getTime()) / 86_400_000), 0),
    dailyRegistrations,
    dailyRevenue,
    checkIns: summary?.totals.checkIns ?? registrations.filter((registration) => registration.checkInStatus === 'checked_in').length,
    kitDeliveries: summary?.totals.kitDeliveries ?? registrations.filter((registration) => registration.kitStatus === 'delivered').length,
    pendingPayments: summary?.totals.pending ?? registrations.filter((registration) => registration.status === 'pending_payment').length,
    paidWithoutEmail: summary?.totals.paidWithoutEmail ?? registrations.filter((registration) => registration.status === 'paid' && !registration.confirmationEmailSentAt).length,
  };
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function normalizeSearch(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.]+/gu, '');
}

function shirtSizeOrder(size: string) {
  const order = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'];
  const index = order.indexOf(size.toUpperCase());
  return index === -1 ? order.length : index;
}

function genderLabel(gender: AdminRegistration['gender']) {
  const labels: Record<string, string> = {
    female: 'Feminino',
    male: 'Masculino',
  };

  return gender ? labels[gender] || gender : 'Não informado';
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    'registration.check_in': 'Check-in registrado',
    'registration.kit_delivered': 'Kit entregue',
    'registration.updated': 'Cadastro atualizado',
    'registration.cancel': 'Inscrição cancelada',
    'registration.undo-check-in': 'Check-in desfeito',
    'registration.undo-kit': 'Entrega de kit desfeita',
    'registration.bib_assigned': 'Numero de peito atribuido',
    'payment.webhook_processed': 'Webhook de pagamento processado',
    'payment.amount_mismatch': 'Divergencia de valor',
    'payment.manual_reconciled': 'Pagamento conciliado manualmente',
    'payment.orphan_received': 'Evento de pagamento sem inscrição',
    'payment.orphan_linked': 'Evento de pagamento vinculado',
    'email.confirmation.attempted': 'Envio de confirmacao iniciado',
    'email.confirmation.sent': 'Confirmacao enviada',
    'email.confirmation.failed': 'Falha na confirmacao',
    'email.confirmation.skipped': 'Confirmacao ignorada',
    'partner.link_accessed': 'Link da assessoria acessado',
    'partner.link_rejected': 'Acesso ao link rejeitado',
    'registration.started': 'Inscrição iniciada pela assessoria',
    'discount.applied': 'Desconto da assessoria aplicado',
    'payment.started': 'Pagamento iniciado',
    'webhook.received': 'Webhook recebido',
    'payment.approved': 'Pagamento aprovado',
    'payment.declined': 'Pagamento recusado',
    'payment.refunded': 'Pagamento reembolsado',
    'registration.cancelled': 'Inscrição cancelada',
    'consistency.issue_detected': 'Inconsistencia de parceiro detectada',
  };

  return labels[action] || action;
}

function auditEntityLabel(entityType: string) {
  const labels: Record<string, string> = {
    registration: 'Inscrição',
    payment: 'Pagamento',
    partnership: 'Parceria',
    event: 'Evento',
    distance: 'Distancia',
    lot: 'Lote',
  };

  return labels[entityType] || entityType;
}

function summarizeAuditPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return 'Sem resumo disponivel.';
  }

  const data = payload as Record<string, unknown>;
  const summary = [
    typeof data.reason === 'string' && data.reason ? `Motivo: ${data.reason}` : null,
    typeof data.status === 'string' && data.status ? `Status: ${data.status}` : null,
    typeof data.transactionId === 'string' && data.transactionId ? `Transação: ${data.transactionId}` : null,
    typeof data.bibNumber === 'string' && data.bibNumber ? `Peito: ${data.bibNumber}` : null,
    typeof data.method === 'string' && data.method ? `Método: ${data.method}` : null,
    typeof data.amountCents === 'number' ? `Valor: ${currencyFormatter.format(data.amountCents / 100)}` : null,
    typeof data.operator === 'string' && data.operator ? `Operador: ${data.operator}` : null,
  ].filter(Boolean);

  if (summary.length > 0) {
    return summary.slice(0, 2).join(' · ');
  }

  const keys = Object.keys(data);
  return keys.length > 0 ? `Campos: ${keys.slice(0, 4).join(', ')}` : 'Payload sem campos relevantes.';
}

function formatDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('pt-BR').format(date);
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}
