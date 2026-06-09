import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCcw, Search, ShieldCheck } from 'lucide-react';
import {
  ApiError,
  getAdminCsvUrl,
  getAdminRegistrations,
  getAdminSummary,
} from '../lib/api';
import type { AdminRegistration, AdminSummaryResponse } from '../types/registration';

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const statusOptions = [
  { value: '', label: 'Todos os status' },
  { value: 'pending_payment', label: 'Pendente' },
  { value: 'paid', label: 'Pago' },
  { value: 'payment_failed', label: 'Falhou' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'refunded', label: 'Reembolsado' },
];

export function AdminPage() {
  const [adminKey, setAdminKey] = useState(() => window.localStorage.getItem('funpace-admin-key') || '');
  const [draftKey, setDraftKey] = useState(adminKey);
  const [summary, setSummary] = useState<AdminSummaryResponse | null>(null);
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([]);
  const [filters, setFilters] = useState({ status: '', distanceId: '', lotId: '', q: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const csvUrl = useMemo(() => getAdminCsvUrl(filters), [filters]);

  const loadAdminData = async (key = adminKey) => {
    if (!key) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [summaryResponse, registrationsResponse] = await Promise.all([
        getAdminSummary(key),
        getAdminRegistrations(key, filters),
      ]);

      setSummary(summaryResponse);
      setRegistrations(registrationsResponse.registrations);
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

  if (!adminKey || error === 'Acesso administrativo nao autorizado.') {
    return (
      <main className="min-h-screen bg-black text-white px-6 py-20 flex items-center">
        <form onSubmit={handleLogin} className="max-w-xl mx-auto w-full border border-zinc-800 bg-zinc-950 p-8 md:p-12">
          <ShieldCheck className="w-12 h-12 text-brand mb-8" />
          <h1 className="font-display text-5xl font-black uppercase tracking-tighter mb-4">Admin FunPace Run</h1>
          <p className="text-zinc-400 font-mono text-sm mb-8">
            Informe a chave administrativa local para acessar inscritos, vendas e exportacao.
          </p>
          <input
            type="password"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
            className="w-full bg-black border border-zinc-800 p-4 text-white focus:border-brand focus:outline-none"
            placeholder="ADMIN_API_KEY"
          />
          {error && <p className="mt-4 text-sm font-bold uppercase tracking-wider text-brand">{error}</p>}
          <button className="mt-6 w-full bg-brand text-black p-4 font-black uppercase tracking-widest text-sm">
            Entrar
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <p className="text-brand font-bold uppercase tracking-widest text-xs mb-3">Painel administrativo</p>
            <h1 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none">
              Inscritos e vendas
            </h1>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void loadAdminData()}
              className="bg-zinc-900 border border-zinc-800 px-4 py-3 font-bold uppercase tracking-widest text-xs flex items-center gap-2 hover:border-brand"
            >
              <RefreshCcw className="w-4 h-4" /> Atualizar
            </button>
            <button
              type="button"
              onClick={() => void downloadCsv()}
              className="bg-brand text-black px-4 py-3 font-black uppercase tracking-widest text-xs flex items-center gap-2"
            >
              <Download className="w-4 h-4" /> CSV
            </button>
          </div>
        </header>

        {summary && (
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Metric label="Inscricoes" value={summary.totals.registrations.toString()} />
            <Metric label="Pagas" value={summary.totals.paid.toString()} />
            <Metric label="Pendentes" value={summary.totals.pending.toString()} />
            <Metric label="Receita paga" value={currencyFormatter.format(summary.totals.revenueCents / 100)} />
          </section>
        )}

        <section className="border border-zinc-800 bg-zinc-950 p-4 mb-8">
          <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-[1fr_180px_180px_160px] gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={filters.q}
                onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
                className="w-full bg-black border border-zinc-800 py-3 pl-11 pr-4 text-white focus:border-brand focus:outline-none"
                placeholder="Buscar nome, email ou telefone"
              />
            </div>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              className="bg-black border border-zinc-800 p-3 text-white focus:border-brand focus:outline-none"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={filters.distanceId}
              onChange={(event) => setFilters((current) => ({ ...current, distanceId: event.target.value }))}
              className="bg-black border border-zinc-800 p-3 text-white focus:border-brand focus:outline-none"
            >
              <option value="">Todas distancias</option>
              {summary?.byDistance.map((distance) => (
                <option key={distance.id} value={distance.id}>{distance.name}</option>
              ))}
            </select>
            <select
              value={filters.lotId}
              onChange={(event) => setFilters((current) => ({ ...current, lotId: event.target.value }))}
              className="bg-black border border-zinc-800 p-3 text-white focus:border-brand focus:outline-none"
            >
              <option value="">Todos lotes</option>
              {summary?.lots.map((lot) => (
                <option key={lot.id} value={lot.id}>{lot.name}</option>
              ))}
            </select>
          </form>
        </section>

        {error && <p className="mb-6 border border-brand p-4 text-brand font-bold uppercase tracking-widest text-xs">{error}</p>}
        {loading && <p className="mb-6 text-zinc-500 font-mono text-sm">Carregando painel...</p>}

        <section className="border border-zinc-800 overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-zinc-950 text-zinc-500 uppercase tracking-widest text-xs">
              <tr>
                <th className="p-4">Atleta</th>
                <th className="p-4">Contato</th>
                <th className="p-4">Prova</th>
                <th className="p-4">Lote</th>
                <th className="p-4">Status</th>
                <th className="p-4">Valor</th>
                <th className="p-4">Criado</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((registration) => (
                <tr key={registration.id} className="border-t border-zinc-900">
                  <td className="p-4">
                    <p className="font-bold">{registration.fullName}</p>
                    <p className="font-mono text-xs text-zinc-500">{registration.id}</p>
                  </td>
                  <td className="p-4 font-mono text-sm text-zinc-300">
                    <p>{registration.email}</p>
                    <p>{registration.phone}</p>
                  </td>
                  <td className="p-4 font-bold">{registration.distance} / {registration.shirtSize}</td>
                  <td className="p-4">{registration.lot}</td>
                  <td className="p-4">
                    <span className="border border-zinc-700 px-2 py-1 text-xs font-bold uppercase tracking-widest">
                      {registration.status}
                    </span>
                  </td>
                  <td className="p-4 font-mono">{currencyFormatter.format(registration.amountCents / 100)}</td>
                  <td className="p-4 font-mono text-xs text-zinc-500">
                    {new Date(registration.createdAt).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
              {registrations.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-zinc-500 font-mono">
                    Nenhuma inscricao encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-800 bg-zinc-950 p-5">
      <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-3">{label}</p>
      <p className="font-mono text-2xl md:text-3xl font-black">{value}</p>
    </div>
  );
}
