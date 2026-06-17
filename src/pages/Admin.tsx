import { type FormEvent, type ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Download,
  Eye,
  FileBarChart,
  FileText,
  Flag,
  Gift,
  LayoutDashboard,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Medal,
  Menu,
  Percent,
  QrCode,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Shirt,
  Ticket,
  TimerReset,
  Trophy,
  UserCog,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';
import { eventInfo } from '../config/event';
import {
  ApiError,
  checkInAdminRegistration,
  deliverAdminKit,
  getAdminAuditLogs,
  getAdminCsvUrl,
  getAdminRegistrations,
  getAdminSummary,
} from '../lib/api';
import type { AdminAuditLog, AdminRegistration, AdminSummaryResponse, RegistrationStatus } from '../types/registration';

type AdminFilters = {
  status: string;
  distanceId: string;
  lotId: string;
  q: string;
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'pending_payment', label: 'Pendente' },
  { value: 'paid', label: 'Pago' },
  { value: 'payment_failed', label: 'Falhou' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'refunded', label: 'Reembolsado' },
];

const navItems: Array<{ label: string; icon: LucideIcon; status?: 'soon' }> = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Eventos', icon: CalendarClock },
  { label: 'Inscricoes', icon: Ticket },
  { label: 'Atletas', icon: Users },
  { label: 'Pagamentos', icon: CreditCard },
  { label: 'Lotes', icon: Flag },
  { label: 'Cupons', icon: Percent, status: 'soon' },
  { label: 'Check-in', icon: ClipboardCheck },
  { label: 'Resultados', icon: Trophy, status: 'soon' },
  { label: 'Kit do Atleta', icon: Shirt },
  { label: 'Financeiro', icon: WalletCards },
  { label: 'Relatorios', icon: FileBarChart },
  { label: 'Notificacoes', icon: Bell, status: 'soon' },
  { label: 'Equipe', icon: UserCog, status: 'soon' },
  { label: 'Configuracoes', icon: Settings },
  { label: 'Logs', icon: Activity },
];

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

export function AdminPage() {
  const [adminKey, setAdminKey] = useState(() => window.localStorage.getItem('funpace-admin-key') || '');
  const [draftKey, setDraftKey] = useState(adminKey);
  const [summary, setSummary] = useState<AdminSummaryResponse | null>(null);
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [filters, setFilters] = useState({ status: '', distanceId: '', lotId: '', q: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeNav, setActiveNav] = useState('Dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState<AdminRegistration | null>(null);
  const [actionLoading, setActionLoading] = useState<'check-in' | 'kit' | ''>('');

  const csvUrl = useMemo(() => getAdminCsvUrl(filters), [filters]);
  const dashboard = useMemo(() => getDashboardModel(summary, registrations), [summary, registrations]);

  const loadAdminData = async (key = adminKey) => {
    if (!key) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [summaryResponse, registrationsResponse, auditLogsResponse] = await Promise.all([
        getAdminSummary(key),
        getAdminRegistrations(key, filters),
        getAdminAuditLogs(key),
      ]);

      setSummary(summaryResponse);
      setRegistrations(registrationsResponse.registrations);
      setAuditLogs(auditLogsResponse.logs);
    } catch (requestError) {
      const message = requestError instanceof ApiError
        ? requestError.message
        : 'Nao foi possivel carregar o painel.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, [filters.status, filters.distanceId, filters.lotId]);

  const handleLogin = (event: FormEvent) => {
    event.preventDefault();
    window.localStorage.setItem('funpace-admin-key', draftKey);
    setAdminKey(draftKey);
    void loadAdminData(draftKey);
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadAdminData();
  };

  const downloadCsv = async () => {
    if (!adminKey) {
      return;
    }

    const response = await fetch(csvUrl, {
      headers: {
        'X-Admin-Key': adminKey,
      },
    });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'funpace-run-inscritos.csv';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const updateRegistration = (registration: AdminRegistration) => {
    setRegistrations((current) => current.map((item) => (item.id === registration.id ? registration : item)));
    setSelectedRegistration(registration);
  };

  const handleCheckIn = async (registration: AdminRegistration) => {
    setActionLoading('check-in');
    setError('');

    try {
      const response = await checkInAdminRegistration(adminKey, registration.id);
      updateRegistration(response.registration);
      await loadAdminData();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Nao foi possivel registrar o check-in.');
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
      await loadAdminData();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Nao foi possivel registrar a entrega do kit.');
    } finally {
      setActionLoading('');
    }
  };

  if (!adminKey || error === 'Acesso administrativo nao autorizado.') {
    return (
      <LoginScreen
        draftKey={draftKey}
        error={error}
        onChange={setDraftKey}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,rgba(215,255,0,0.12),transparent_32rem),linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px]" />

      <div className="relative flex min-h-screen">
        <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 w-[280px] border-r border-white/10 bg-zinc-950/95 px-3 py-4 backdrop-blur-sm transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0`}>
          <Sidebar
            activeNav={activeNav}
            onSelect={(label) => {
              setActiveNav(label);
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
            onOpenSidebar={() => setSidebarOpen(true)}
            onRefresh={() => void loadAdminData()}
            onExport={() => void downloadCsv()}
          />

          <div className="mx-auto max-w-[1600px] px-4 pb-10 pt-4 sm:px-6 lg:px-8">
            {error && error !== 'Acesso administrativo nao autorizado.' && (
              <StatusMessage tone="error" message={error} />
            )}

            <EventHero summary={summary} dashboard={dashboard} />

            <KpiGrid dashboard={dashboard} loading={loading && !summary} />

            <div className="mt-6 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
              <Panel title="Inscricoes por dia" eyebrow="Performance comercial" action="Ultimos registros">
                <TimelineChart data={dashboard.dailyRegistrations} />
              </Panel>

              <Panel title="Lotes e distancias" eyebrow="Capacidade">
                <LotDistancePanel summary={summary} />
              </Panel>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <Panel title="Receita por dia" eyebrow="Financeiro">
                <RevenueChart data={dashboard.dailyRevenue} />
              </Panel>

              <Panel title="Operacao presencial" eyebrow="Check-in, kit e logs">
                <OperationsPanel auditLogs={auditLogs} />
              </Panel>
            </div>

            <RegistrationsPanel
              summary={summary}
              registrations={registrations}
              filters={filters}
              loading={loading}
              onFiltersChange={setFilters}
              onSearch={handleSearch}
              onOpenRegistration={setSelectedRegistration}
            />
          </div>
        </section>
      </div>

      <AthleteDrawer
        registration={selectedRegistration}
        actionLoading={actionLoading}
        onCheckIn={handleCheckIn}
        onKitDelivery={handleKitDelivery}
        onClose={() => setSelectedRegistration(null)}
      />
    </main>
  );
}

function LoginScreen({
  draftKey,
  error,
  onChange,
  onSubmit,
}: {
  draftKey: string;
  error: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="flex min-h-screen items-center bg-black px-4 py-12 text-white sm:px-6 md:py-20">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,rgba(215,255,0,0.14),transparent_28rem)]" />
      <form onSubmit={onSubmit} className="relative mx-auto w-full max-w-xl border border-white/10 bg-zinc-950/95 p-5 shadow-2xl sm:p-8 md:p-12">
        <ShieldCheck className="mb-8 h-12 w-12 text-brand" />
        <p className="mb-3 text-xs font-black uppercase tracking-[0.28em] text-brand">Centro de comando</p>
        <h1 className="mb-4 font-display text-[clamp(2.6rem,12vw,3rem)] font-black uppercase leading-none tracking-tighter">Admin FunPace Run</h1>
        <p className="mb-8 font-mono text-sm leading-relaxed text-zinc-400">
          Acesse vendas, inscricoes, lotes, pagamentos e operacao do evento com a chave administrativa.
        </p>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="password"
            value={draftKey}
            onChange={(event) => onChange(event.target.value)}
            className="w-full border border-zinc-800 bg-black py-4 pl-11 pr-4 text-white outline-none transition-colors focus:border-brand"
            placeholder="ADMIN_API_KEY"
          />
        </div>
        {error && <p className="mt-4 text-sm font-bold uppercase tracking-wider text-brand">{error}</p>}
        <button className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 bg-brand p-4 text-sm font-black uppercase tracking-widest text-black transition-colors hover:bg-white">
          Entrar no painel <ChevronRight className="h-4 w-4" />
        </button>
      </form>
    </main>
  );
}

function Sidebar({ activeNav, onSelect }: { activeNav: string; onSelect: (label: string) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-5 border-b border-white/10 px-3 pb-5">
        <p className="font-display text-xl font-black uppercase tracking-tighter">FunPace</p>
        <p className="mt-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Run Operations</p>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.label;

            return (
              <button
                type="button"
                key={item.label}
                onClick={() => onSelect(item.label)}
                className={`flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-sm font-bold transition-colors ${
                  active ? 'bg-brand text-black' : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.status === 'soon' && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${active ? 'bg-black/10 text-black' : 'bg-white/5 text-zinc-500'}`}>
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-4 border-t border-white/10 px-3 pt-4">
        <div className="rounded border border-white/10 bg-white/[0.03] p-3">
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
  onOpenSidebar,
  onRefresh,
  onExport,
}: {
  activeNav: string;
  loading: boolean;
  onOpenSidebar: () => void;
  onRefresh: () => void;
  onExport: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-black/85 px-4 py-3 backdrop-blur-sm sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={onOpenSidebar}
            className="flex h-10 w-10 items-center justify-center border border-white/10 bg-white/[0.03] lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-brand">{activeNav}</p>
            <h1 className="truncate text-sm font-bold text-zinc-300 sm:text-base">Centro de operacoes FunPace Run</h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="flex min-h-10 items-center gap-2 border border-white/10 bg-white/[0.03] px-3 text-xs font-bold uppercase tracking-widest text-zinc-200 transition-colors hover:border-brand"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            <span className="hidden sm:inline">Atualizar</span>
          </button>
          <button
            type="button"
            onClick={onExport}
            className="flex min-h-10 items-center gap-2 bg-brand px-3 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-white"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function EventHero({ summary, dashboard }: { summary: AdminSummaryResponse | null; dashboard: DashboardModel }) {
  const activeLot = summary?.lots.find((lot) => lot.status === 'active') || summary?.lots[0];

  return (
    <section className="grid gap-4 overflow-hidden border border-white/10 bg-zinc-950/85 p-4 shadow-2xl md:p-6 xl:grid-cols-[1.4fr_0.6fr]">
      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <StatusPill status="published" label="Publicado" />
          <StatusPill status="active" label={activeLot?.status === 'sold_out' ? 'Lote esgotado' : 'Inscricoes abertas'} />
          <span className="rounded border border-white/10 px-2.5 py-1 text-xs font-bold uppercase tracking-widest text-zinc-400">
            {eventInfo.currentLot}
          </span>
        </div>

        <p className="text-xs font-black uppercase tracking-[0.28em] text-brand">Evento principal</p>
        <h2 className="mt-3 max-w-4xl font-display text-[clamp(2.5rem,9vw,5.8rem)] font-black uppercase leading-[0.9] tracking-tighter">
          {eventInfo.name}
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <MiniFact icon={CalendarClock} label="Data da prova" value={eventInfo.dateLabel} />
          <MiniFact icon={TimerReset} label="Dias restantes" value={`${dashboard.daysRemaining}`} />
          <MiniFact icon={MapPin} label="Cidade" value={`${eventInfo.city} - ${eventInfo.state}`} />
        </div>
      </div>

      <div className="flex flex-col justify-between gap-4 border border-white/10 bg-black/40 p-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Acoes do evento</p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            As acoes abaixo estao mapeadas para a proxima fase de backend administrativo.
          </p>
        </div>
        <div className="grid gap-2">
          <GhostAction icon={FileText} label="Editar Evento" />
          <GhostAction icon={BadgeCheck} label="Publicar" />
          <GhostAction icon={Archive} label="Encerrar Inscricoes" danger />
        </div>
      </div>
    </section>
  );
}

function KpiGrid({ dashboard, loading }: { dashboard: DashboardModel; loading: boolean }) {
  const cards: Array<{
    label: string;
    value: string | number;
    icon: LucideIcon;
    detail: string;
    trend: 'up' | 'neutral';
  }> = [
    { label: 'Total de inscritos', value: dashboard.totalRegistrations, icon: Users, detail: `${dashboard.paidRegistrations} pagos`, trend: 'up' },
    { label: 'Inscricoes hoje', value: dashboard.todayRegistrations, icon: Activity, detail: 'Janela operacional', trend: 'neutral' },
    { label: 'Inscricoes na semana', value: dashboard.weekRegistrations, icon: BarChart3, detail: 'Ultimos 7 dias', trend: 'up' },
    { label: 'Faturamento', value: currencyFormatter.format(dashboard.revenueCents / 100), icon: WalletCards, detail: 'Receita paga', trend: 'up' },
    { label: 'Faturamento hoje', value: currencyFormatter.format(dashboard.todayRevenueCents / 100), icon: CreditCard, detail: 'Pagos hoje', trend: 'neutral' },
    { label: 'Ticket medio', value: currencyFormatter.format(dashboard.averageTicketCents / 100), icon: Ticket, detail: 'Por inscricao paga', trend: 'neutral' },
    { label: 'Taxa de conversao', value: `${dashboard.conversionRate}%`, icon: ArrowUpRight, detail: 'Pagas / total', trend: 'up' },
    { label: 'Check-ins realizados', value: dashboard.checkIns, icon: ClipboardCheck, detail: 'Operacao presencial', trend: 'neutral' },
    { label: 'Kits entregues', value: dashboard.kitDeliveries, icon: Gift, detail: 'Retirada registrada', trend: 'neutral' },
    { label: 'Vagas restantes', value: dashboard.remainingSpots, icon: Medal, detail: `${dashboard.currentLotName}`, trend: 'neutral' },
    { label: 'Lote atual', value: dashboard.currentLotName, icon: Flag, detail: currencyFormatter.format(dashboard.currentLotPriceCents / 100), trend: 'neutral' },
    { label: 'Atletas por distancia', value: dashboard.distanceSummary, icon: Trophy, detail: 'Total inscrito', trend: 'neutral' },
  ];

  return (
    <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label}>
          <KpiCard
            label={card.label}
            value={card.value}
            icon={card.icon}
            detail={card.detail}
            trend={card.trend}
            loading={loading}
          />
        </div>
      ))}
    </section>
  );
}

function KpiCard({
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
  trend: 'up' | 'neutral';
  loading: boolean;
}) {
  return (
    <div className="border border-white/10 bg-zinc-950/80 p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">{label}</p>
          {loading ? (
            <div className="mt-4 h-8 w-24 animate-pulse bg-white/10" />
          ) : (
            <p className="mt-3 truncate font-mono text-2xl font-black text-white">{value}</p>
          )}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/10 bg-white/[0.03]">
          <Icon className="h-5 w-5 text-brand" />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
        {trend === 'up' ? <ArrowUpRight className="h-3.5 w-3.5 text-brand" /> : <ArrowDownRight className="h-3.5 w-3.5 text-zinc-600" />}
        <span>{detail}</span>
      </div>
    </div>
  );
}

function RegistrationsPanel({
  summary,
  registrations,
  filters,
  loading,
  onFiltersChange,
  onSearch,
  onOpenRegistration,
}: {
  summary: AdminSummaryResponse | null;
  registrations: AdminRegistration[];
  filters: AdminFilters;
  loading: boolean;
  onFiltersChange: (filters: AdminFilters) => void;
  onSearch: (event: FormEvent) => void;
  onOpenRegistration: (registration: AdminRegistration) => void;
}) {
  return (
    <section className="mt-4 border border-white/10 bg-zinc-950/80">
      <div className="border-b border-white/10 p-4 md:p-5">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-brand">Inscricoes</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">Mesa operacional de atletas</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
              Pesquisa, filtros, exportacao e acesso rapido ao historico do atleta. CPF, cidade, equipe e paginacao entram na proxima fase de API.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
            <span className="border border-white/10 px-2.5 py-1">Colunas: padrao</span>
            <span className="border border-white/10 px-2.5 py-1">Ordenacao: recentes</span>
          </div>
        </div>

        <form onSubmit={onSearch} className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_180px_160px]">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={filters.q}
              onChange={(event) => onFiltersChange({ ...filters, q: event.target.value })}
              className="min-h-12 w-full border border-zinc-800 bg-black py-3 pl-11 pr-4 text-white outline-none transition-colors focus:border-brand"
              placeholder="Pesquisa inteligente: nome, email ou telefone"
            />
          </div>
          <SelectFilter value={filters.status} onChange={(value) => onFiltersChange({ ...filters, status: value })} options={statusOptions} />
          <SelectFilter
            value={filters.distanceId}
            onChange={(value) => onFiltersChange({ ...filters, distanceId: value })}
            options={[
              { value: '', label: 'Todas distancias' },
              ...(summary?.byDistance.map((distance) => ({ value: distance.id, label: distance.name })) || []),
            ]}
          />
          <SelectFilter
            value={filters.lotId}
            onChange={(value) => onFiltersChange({ ...filters, lotId: value })}
            options={[
              { value: '', label: 'Todos lotes' },
              ...(summary?.lots.map((lot) => ({ value: lot.id, label: lot.name })) || []),
            ]}
          />
        </form>
      </div>

      {loading && registrations.length === 0 ? (
        <TableSkeleton />
      ) : registrations.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left">
            <thead className="bg-black/50 text-xs uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="p-4">Atleta</th>
                <th className="p-4">Contato</th>
                <th className="p-4">Prova</th>
                <th className="p-4">Lote</th>
                <th className="p-4">Pagamento</th>
                <th className="p-4">Valor</th>
                <th className="p-4">Inscricao</th>
                <th className="p-4 text-right">Acao</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((registration) => (
                <tr key={registration.id} className="border-t border-white/10 transition-colors hover:bg-white/[0.03]">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-brand/10 text-sm font-black text-brand">
                        {getInitials(registration.fullName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-bold">{registration.fullName}</p>
                        <p className="mt-1 truncate font-mono text-xs text-zinc-500">{registration.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4 font-mono text-sm text-zinc-300">
                    <p className="truncate">{registration.email}</p>
                    <p className="mt-1 text-zinc-500">{registration.phone}</p>
                    <p className="mt-1 text-zinc-600">{registration.cpfMasked}</p>
                  </td>
                  <td className="p-4">
                    <p className="font-black">{registration.distance}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Camisa {registration.shirtSize}</p>
                  </td>
                  <td className="p-4 text-sm font-bold text-zinc-300">{registration.lot}</td>
                  <td className="p-4">
                    <PaymentStatus status={registration.status} />
                  </td>
                  <td className="p-4 font-mono font-bold">{currencyFormatter.format(registration.amountCents / 100)}</td>
                  <td className="p-4 font-mono text-xs text-zinc-500">{dateTimeFormatter.format(new Date(registration.createdAt))}</td>
                  <td className="p-4 text-right">
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
    </section>
  );
}

function AthleteDrawer({
  registration,
  actionLoading,
  onCheckIn,
  onKitDelivery,
  onClose,
}: {
  registration: AdminRegistration | null;
  actionLoading: 'check-in' | 'kit' | '';
  onCheckIn: (registration: AdminRegistration) => void;
  onKitDelivery: (registration: AdminRegistration) => void;
  onClose: () => void;
}) {
  if (!registration) {
    return null;
  }

  const createdAt = new Date(registration.createdAt);
  const canOperate = registration.status === 'paid';

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
          <Detail label="Nascimento" value={registration.birthDate ? formatDateOnly(registration.birthDate) : 'Nao informado'} />
          <Detail label="Idade" value={registration.age !== null ? `${registration.age} anos` : 'Nao informada'} />
          <Detail label="Sexo" value={genderLabel(registration.gender)} />
          <Detail label="Telefone" value={registration.phone} />
          <Detail label="Email" value={registration.email} />
          <Detail label="Cidade" value={registration.city || 'Nao coletada'} />
          <Detail label="Estado" value={registration.state || 'Nao coletado'} />
          <Detail label="Equipe" value={registration.team || 'Nao coletada'} />
          <Detail label="Distancia" value={registration.distance} />
          <Detail label="Lote" value={registration.lot} />
          <Detail label="Numero de peito" value={registration.bibNumber || 'A definir'} />
          <Detail label="Contato emergencia" value={registration.emergencyContactName} />
          <Detail label="Telefone emergencia" value={registration.emergencyContactPhone} />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[160px_1fr]">
          <div className="flex aspect-square items-center justify-center border border-white/10 bg-black">
            <QrCode className="h-20 w-20 text-brand" />
          </div>
          <div className="border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Pagamento</p>
            <div className="mt-3">
              <PaymentStatus status={registration.status} />
            </div>
            <p className="mt-4 font-mono text-2xl font-black">{currencyFormatter.format(registration.amountCents / 100)}</p>
            <p className="mt-2 text-sm text-zinc-400">Inscricao criada em {dateTimeFormatter.format(createdAt)}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={!canOperate || registration.checkInStatus === 'checked_in' || actionLoading !== ''}
            onClick={() => onCheckIn(registration)}
            className="flex min-h-12 items-center justify-center gap-2 border border-brand/30 bg-brand px-4 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-zinc-500"
          >
            {actionLoading === 'check-in' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            {registration.checkInStatus === 'checked_in' ? 'Check-in realizado' : 'Registrar check-in'}
          </button>
          <button
            type="button"
            disabled={!canOperate || registration.kitStatus === 'delivered' || actionLoading !== ''}
            onClick={() => onKitDelivery(registration)}
            className="flex min-h-12 items-center justify-center gap-2 border border-white/10 px-4 text-xs font-black uppercase tracking-widest text-zinc-100 transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:text-zinc-500"
          >
            {actionLoading === 'kit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            {registration.kitStatus === 'delivered' ? 'Kit entregue' : 'Entregar kit'}
          </button>
        </div>

        {!canOperate && (
          <p className="mt-3 border border-amber-400/20 bg-amber-400/10 p-3 text-xs font-bold uppercase tracking-wider text-amber-100">
            Operacoes presenciais liberadas apenas para inscricoes pagas.
          </p>
        )}

        <div className="mt-5 border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500">Historico completo</p>
          <div className="mt-4 space-y-4">
            <TimelineItem icon={Ticket} title="Inscricao criada" detail={dateTimeFormatter.format(createdAt)} />
            <TimelineItem icon={CreditCard} title="Pagamento vinculado" detail={statusLabels[registration.paymentStatus]} />
            <TimelineItem
              icon={Gift}
              title="Kit do atleta"
              detail={registration.kitStatus === 'delivered' ? `Entregue${registration.kitDeliveredAt ? ` em ${dateTimeFormatter.format(new Date(registration.kitDeliveredAt))}` : ''}` : 'Entrega ainda nao registrada'}
              muted={registration.kitStatus !== 'delivered'}
            />
            <TimelineItem
              icon={ClipboardCheck}
              title="Check-in"
              detail={registration.checkInStatus === 'checked_in' ? `Realizado${registration.checkInAt ? ` em ${dateTimeFormatter.format(new Date(registration.checkInAt))}` : ''}` : 'Nao realizado'}
              muted={registration.checkInStatus !== 'checked_in'}
            />
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
                <span className="font-mono text-zinc-400">{lot.soldCount}/{lot.capacity}</span>
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

function ModuleGrid() {
  const modules = [
    { icon: QrCode, label: 'Scanner QR Code', detail: 'Check-in e retirada de kit' },
    { icon: Percent, label: 'Cupons', detail: 'Limites, validade e desconto' },
    { icon: Mail, label: 'Notificacoes', detail: 'Email, WhatsApp, SMS e push' },
    { icon: FileBarChart, label: 'Relatorios', detail: 'CSV, Excel, PDF e financeiro' },
    { icon: Trophy, label: 'Resultados', detail: 'Cronometragem e certificados' },
    { icon: Activity, label: 'Auditoria', detail: 'Logs de acoes e exportacoes' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {modules.map((module) => {
        const Icon = module.icon;

        return (
          <div key={module.label} className="border border-white/10 bg-black/35 p-4">
            <Icon className="h-5 w-5 text-brand" />
            <p className="mt-4 font-bold">{module.label}</p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">{module.detail}</p>
          </div>
        );
      })}
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

function StatusPill({ status: _status, label }: { status: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-brand">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function MiniFact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-black/35 p-4">
      <Icon className="mb-4 h-5 w-5 text-brand" />
      <p className="text-xs font-black uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-2 font-mono text-sm font-bold text-zinc-200">{value}</p>
    </div>
  );
}

function GhostAction({ icon: Icon, label, danger }: { icon: LucideIcon; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`flex min-h-11 items-center justify-between border px-3 text-xs font-black uppercase tracking-widest transition-colors ${
        danger ? 'border-red-400/20 text-red-200 hover:bg-red-400/10' : 'border-white/10 text-zinc-200 hover:border-brand hover:text-brand'
      }`}
    >
      <span className="flex items-center gap-2"><Icon className="h-4 w-4" /> {label}</span>
      <ChevronRight className="h-4 w-4" />
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-2 break-words text-sm font-bold text-zinc-200">{value}</p>
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
      <h3 className="mt-5 text-xl font-black">Nenhuma inscricao encontrada</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
        Ajuste os filtros ou aguarde novas inscricoes. Quando houver atletas, eles aparecerao nesta mesa operacional.
      </p>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse bg-white/[0.04]" />
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

function StatusMessage({ tone, message }: { tone: 'error'; message: string }) {
  return (
    <div className={`mb-4 border p-4 text-sm font-bold uppercase tracking-wider ${tone === 'error' ? 'border-red-400/30 bg-red-400/10 text-red-100' : ''}`}>
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
  todayRegistrations: number;
  weekRegistrations: number;
  revenueCents: number;
  todayRevenueCents: number;
  averageTicketCents: number;
  conversionRate: number;
  remainingSpots: number;
  currentLotName: string;
  currentLotPriceCents: number;
  distanceSummary: string;
  daysRemaining: number;
  dailyRegistrations: ChartPoint[];
  dailyRevenue: ChartPoint[];
  checkIns: number;
  kitDeliveries: number;
};

function getDashboardModel(summary: AdminSummaryResponse | null, registrations: AdminRegistration[]): DashboardModel {
  const now = new Date();
  const todayKey = toDateKey(now);
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 6);

  const activeLot = summary?.lots.find((lot) => lot.status === 'active') || summary?.lots[0];
  const paid = registrations.filter((registration) => registration.status === 'paid');
  const todayRegistrations = registrations.filter((registration) => toDateKey(new Date(registration.createdAt)) === todayKey).length;
  const weekRegistrations = registrations.filter((registration) => new Date(registration.createdAt) >= startOfDay(weekAgo)).length;
  const todayRevenueCents = paid
    .filter((registration) => toDateKey(new Date(registration.createdAt)) === todayKey)
    .reduce((total, registration) => total + registration.amountCents, 0);
  const revenueCents = summary?.totals.revenueCents ?? paid.reduce((total, registration) => total + registration.amountCents, 0);
  const totalRegistrations = summary?.totals.registrations ?? registrations.length;
  const paidRegistrations = summary?.totals.paid ?? paid.length;
  const averageTicketCents = paidRegistrations > 0 ? Math.round(revenueCents / paidRegistrations) : activeLot?.priceCents || eventInfo.currentLotPriceCents;
  const conversionRate = totalRegistrations > 0 ? Math.round((paidRegistrations / totalRegistrations) * 100) : 0;
  const dailyRegistrations = buildDailySeries(registrations, 'count');
  const dailyRevenue = buildDailySeries(paid, 'amount');

  return {
    totalRegistrations,
    paidRegistrations,
    todayRegistrations,
    weekRegistrations,
    revenueCents,
    todayRevenueCents,
    averageTicketCents,
    conversionRate,
    remainingSpots: activeLot?.remaining ?? eventInfo.currentLotCapacity,
    currentLotName: activeLot?.name || eventInfo.currentLot,
    currentLotPriceCents: activeLot?.priceCents ?? eventInfo.currentLotPriceCents,
    distanceSummary: summary?.byDistance.map((distance) => `${distance.name} ${distance.total}`).join(' / ') || '10K 0 / 5K 0',
    daysRemaining: Math.max(Math.ceil((new Date(eventInfo.startsAt).getTime() - now.getTime()) / 86_400_000), 0),
    dailyRegistrations,
    dailyRevenue,
    checkIns: summary?.totals.checkIns ?? registrations.filter((registration) => registration.checkInStatus === 'checked_in').length,
    kitDeliveries: summary?.totals.kitDeliveries ?? registrations.filter((registration) => registration.kitStatus === 'delivered').length,
  };
}

function buildDailySeries(registrations: AdminRegistration[], mode: 'count' | 'amount'): ChartPoint[] {
  const days = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return startOfDay(date);
  });

  return days.map((date) => {
    const key = toDateKey(date);
    const items = registrations.filter((registration) => toDateKey(new Date(registration.createdAt)) === key);

    return {
      label: dateFormatter.format(date).replace('.', ''),
      count: mode === 'count' ? items.length : 0,
      amountCents: mode === 'amount' ? items.reduce((total, registration) => total + registration.amountCents, 0) : 0,
    };
  });
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function genderLabel(gender: AdminRegistration['gender']) {
  const labels: Record<string, string> = {
    female: 'Feminino',
    male: 'Masculino',
    non_binary: 'Nao binario',
    prefer_not_to_answer: 'Prefiro nao informar',
  };

  return gender ? labels[gender] || gender : 'Nao informado';
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    'registration.check_in': 'Check-in registrado',
    'registration.kit_delivered': 'Kit entregue',
  };

  return labels[action] || action;
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
