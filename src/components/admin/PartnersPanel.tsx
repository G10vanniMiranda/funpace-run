import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BarChart3, Building2, Check, ChevronLeft, ChevronRight, Clipboard, Edit3, Loader2, Megaphone, Plus, Power, RefreshCcw, Search, Trash2, Users, X } from 'lucide-react';
import {
  ApiError,
  checkAdminPartnerSlug,
  createAdminPartner,
  deleteAdminPartner,
  getAdminPartners,
  updateAdminPartner,
  updateAdminPartnerStatus,
} from '../../lib/api';
import { buildPartnerLink, copyPartnerLink, partnerTypeLabels, partnerTypeOptions, slugifyPartnerName } from '../../lib/partners';
import type { AdminPartner, PartnerInput, PartnerStatus, PartnerType } from '../../types/partner';
import { PartnerDashboard } from './PartnerDashboard';

const emptyPartner: PartnerInput = { name: '', slug: '', partnerType: 'sports_advisory', discountPercentage: 10, description: null, status: 'active' };
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });

function requestMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function PartnersPanel({ adminKey }: { adminKey: string }) {
  const [view, setView] = useState<'management' | 'dashboard'>('management');
  const [partners, setPartners] = useState<AdminPartner[]>([]);
  const [filters, setFilters] = useState({ name: '', slug: '', status: '', partnerType: '' });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [draft, setDraft] = useState<PartnerInput | null>(null);
  const [editingId, setEditingId] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'available' | 'unavailable'>('idle');
  const [deleting, setDeleting] = useState<AdminPartner | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const publicOrigin = useMemo(() => (import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, ''), []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await getAdminPartners(adminKey, { ...filters, page: String(page), pageSize: String(pagination.pageSize) });
      setPartners(response.partners); setPagination(response.pagination); setError('');
    } catch (requestError) {
      setError(requestMessage(requestError, 'Nao foi possivel carregar os parceiros.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timeout);
  }, [adminKey, filters.name, filters.slug, filters.status, filters.partnerType, page, pagination.pageSize]);

  useEffect(() => {
    if (!draft || draft.slug.length < 2) { setSlugState('idle'); return; }
    setSlugState('checking');
    const timeout = window.setTimeout(() => {
      void checkAdminPartnerSlug(adminKey, draft.slug, editingId)
        .then((result) => setSlugState(result.available ? 'available' : 'unavailable'))
        .catch(() => setSlugState('idle'));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [adminKey, draft?.slug, editingId]);

  const openCreate = () => {
    setEditingId(''); setDraft({ ...emptyPartner }); setSlugManuallyEdited(false); setSlugState('idle'); setError(''); setMessage('');
  };

  const openEdit = (partner: AdminPartner) => {
    setEditingId(partner.id);
    setDraft({ name: partner.name, slug: partner.slug, partnerType: partner.partnerType, discountPercentage: partner.discountPercentage, description: partner.description, status: partner.status });
    setSlugManuallyEdited(true); setSlugState('idle'); setError(''); setMessage('');
  };

  const updateName = (name: string) => {
    if (!draft) return;
    setDraft({ ...draft, name, slug: slugManuallyEdited ? draft.slug : slugifyPartnerName(name) });
  };

  const updateSlug = (slug: string) => {
    if (!draft) return;
    setSlugManuallyEdited(true); setDraft({ ...draft, slug: slugifyPartnerName(slug) });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || slugState === 'unavailable' || slugState === 'checking') return;
    setSaving(true); setError('');
    try {
      if (editingId) await updateAdminPartner(adminKey, editingId, draft);
      else await createAdminPartner(adminKey, draft);
      setDraft(null); setEditingId(''); setMessage(editingId ? 'Parceiro atualizado com sucesso.' : 'Parceiro criado com sucesso.');
      if (!editingId) setPage(1);
      await load();
    } catch (requestError) {
      setError(requestMessage(requestError, 'Nao foi possivel salvar o parceiro.'));
      if (requestError instanceof ApiError && requestError.errors?.slug) setSlugState('unavailable');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (partner: AdminPartner) => {
    const status: PartnerStatus = partner.status === 'active' ? 'inactive' : 'active';
    setError('');
    try {
      const response = await updateAdminPartnerStatus(adminKey, partner.id, status);
      setPartners((current) => current.map((item) => item.id === partner.id ? response.partner : item));
      setMessage(status === 'active' ? 'Parceiro ativado.' : 'Parceiro inativado.');
    } catch (requestError) {
      setError(requestMessage(requestError, 'Nao foi possivel alterar o status.'));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setSaving(true); setError('');
    try {
      await deleteAdminPartner(adminKey, deleting.id);
      setPartners((current) => current.filter((item) => item.id !== deleting.id));
      setDeleting(null); setMessage('Parceiro removido com sucesso.');
    } catch (requestError) {
      setError(requestMessage(requestError, 'Nao foi possivel remover o parceiro.'));
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (partner: AdminPartner) => {
    try {
      await copyPartnerLink(buildPartnerLink(publicOrigin, partner.slug));
      setCopiedId(partner.id); setMessage('Link copiado para a area de transferencia.');
      window.setTimeout(() => setCopiedId(''), 1800);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Nao foi possivel copiar o link.');
    }
  };

  if (view === 'dashboard') return <PartnerDashboard adminKey={adminKey} onBack={() => setView('management')} />;

  return (
    <section className="space-y-4">
      <div className="flex flex-col justify-between gap-4 border border-white/10 bg-zinc-950 p-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">Assessoria esportiva e influenciador</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">Parceiros</h2>
          <p className="mt-1 text-sm text-zinc-400">Gerencie os parceiros e seus links exclusivos.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setView('dashboard')} className="inline-flex min-h-11 items-center justify-center gap-2 border border-brand/30 px-4 text-xs font-black uppercase text-brand hover:bg-brand hover:text-black"><BarChart3 className="h-4 w-4" /> Dashboard</button>
          <button type="button" disabled={loading} onClick={() => void load()} className="inline-flex min-h-11 items-center justify-center gap-2 border border-white/10 px-4 text-xs font-black uppercase text-zinc-300 hover:border-brand hover:text-brand disabled:opacity-50"><RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar</button>
          <button type="button" onClick={openCreate} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 bg-brand px-5 text-xs font-black uppercase tracking-widest text-black hover:bg-white sm:flex-none">
            <Plus className="h-4 w-4" /> Novo parceiro
          </button>
        </div>
      </div>

      {error && <div role="alert" className="border border-red-400/30 bg-red-400/10 p-4 text-sm font-bold text-red-200">{error}</div>}
      {message && <div className="border border-brand/30 bg-brand/10 p-4 text-sm font-bold text-brand">{message}</div>}

      <div className="grid gap-3 border border-white/10 bg-zinc-950 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_220px_220px]">
        <FilterInput label="Buscar por nome" value={filters.name} onChange={(name) => { setPage(1); setFilters({ ...filters, name }); }} />
        <FilterInput label="Buscar por slug" value={filters.slug} onChange={(slug) => { setPage(1); setFilters({ ...filters, slug: slugifyPartnerName(slug) }); }} mono />
        <label className="text-xs font-bold text-zinc-400">Tipo
          <select value={filters.partnerType} onChange={(event) => { setPage(1); setFilters({ ...filters, partnerType: event.target.value }); }} className="mt-1 min-h-11 w-full border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-brand">
            <option value="">Todos</option>{partnerTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-zinc-400">Status
          <select value={filters.status} onChange={(event) => { setPage(1); setFilters({ ...filters, status: event.target.value }); }} className="mt-1 min-h-11 w-full border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-brand">
            <option value="">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option>
          </select>
        </label>
      </div>

      <div className="border border-white/10 bg-zinc-950">
        {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" /> Carregando parceiros...</div>
          : partners.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center"><Users className="mb-3 h-8 w-8 text-zinc-600" /><p className="font-bold">Nenhum parceiro encontrado.</p><p className="mt-1 text-sm text-zinc-500">Ajuste os filtros ou cadastre uma nova assessoria.</p></div>
            : <>
              <div className="hidden overflow-x-auto lg:block"><PartnerTable partners={partners} publicOrigin={publicOrigin} copiedId={copiedId} onCopy={copyLink} onEdit={openEdit} onStatus={changeStatus} onDelete={setDeleting} /></div>
              <div className="divide-y divide-white/10 lg:hidden">{partners.map((partner) => <PartnerCard key={partner.id} partner={partner} publicOrigin={publicOrigin} copied={copiedId === partner.id} onCopy={() => void copyLink(partner)} onEdit={() => openEdit(partner)} onStatus={() => void changeStatus(partner)} onDelete={() => setDeleting(partner)} />)}</div>
            </>}
        {!loading && pagination.total > 0 && <Pagination pagination={pagination} onPage={setPage} />}
      </div>

      {draft && <PartnerForm draft={draft} editing={Boolean(editingId)} saving={saving} slugState={slugState} onName={updateName} onSlug={updateSlug} onChange={setDraft} onSubmit={submit} onClose={() => setDraft(null)} />}
      {deleting && <ConfirmDelete partner={deleting} saving={saving} onConfirm={() => void remove()} onClose={() => setDeleting(null)} />}
    </section>
  );
}

function Pagination({ pagination, onPage }: { pagination: { page: number; pageSize: number; total: number; totalPages: number }; onPage: (page: number) => void }) {
  return <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-3 text-xs text-zinc-400 sm:flex-row sm:items-center sm:justify-between"><p>{pagination.total} parceiro{pagination.total === 1 ? '' : 's'} · Pagina {pagination.page} de {Math.max(1, pagination.totalPages)}</p><div className="flex gap-2"><button type="button" aria-label="Pagina anterior" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} className="inline-flex min-h-9 items-center gap-1 border border-white/10 px-3 font-bold uppercase text-zinc-300 hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft className="h-4 w-4" /> Anterior</button><button type="button" aria-label="Proxima pagina" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)} className="inline-flex min-h-9 items-center gap-1 border border-white/10 px-3 font-bold uppercase text-zinc-300 hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-30">Proxima <ChevronRight className="h-4 w-4" /></button></div></div>;
}

function FilterInput({ label, value, onChange, mono = false }: { label: string; value: string; onChange: (value: string) => void; mono?: boolean }) {
  return <label className="text-xs font-bold text-zinc-400">{label}<span className="relative mt-1 block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" /><input value={value} onChange={(event) => onChange(event.target.value)} className={`min-h-11 w-full border border-white/10 bg-black pl-10 pr-3 text-sm text-white outline-none focus:border-brand ${mono ? 'font-mono' : ''}`} /></span></label>;
}

function PartnerTable({ partners, publicOrigin, copiedId, onCopy, onEdit, onStatus, onDelete }: { partners: AdminPartner[]; publicOrigin: string; copiedId: string; onCopy: (partner: AdminPartner) => void; onEdit: (partner: AdminPartner) => void; onStatus: (partner: AdminPartner) => void; onDelete: (partner: AdminPartner) => void }) {
  return <table className="w-full min-w-340 text-left"><thead className="border-b border-white/10 bg-black/40 text-[10px] uppercase tracking-widest text-zinc-500"><tr>{['Nome', 'Tipo', 'Slug', 'Desconto', 'Status', 'Criado em', 'Link exclusivo', 'Acoes'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-white/8">{partners.map((partner) => <tr key={partner.id} className="hover:bg-white/2"><td className="px-4 py-4"><p className="font-bold">{partner.name}</p>{partner.description && <p className="mt-1 max-w-48 truncate text-xs text-zinc-500">{partner.description}</p>}</td><td className="px-4 py-4"><PartnerTypeBadge partnerType={partner.partnerType} /></td><td className="px-4 py-4 font-mono text-xs text-zinc-300">{partner.slug}</td><td className="px-4 py-4 font-mono font-bold text-brand">{partner.discountPercentage}%</td><td className="px-4 py-4"><StatusBadge status={partner.status} /></td><td className="px-4 py-4 text-xs text-zinc-400">{dateFormatter.format(new Date(partner.createdAt))}</td><td className="max-w-70 px-4 py-4"><p className="truncate font-mono text-[11px] text-zinc-500">{buildPartnerLink(publicOrigin, partner.slug)}</p><button type="button" onClick={() => void onCopy(partner)} className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-black uppercase text-brand hover:text-white">{copiedId === partner.id ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{copiedId === partner.id ? 'Copiado' : 'Copiar link'}</button></td><td className="px-4 py-4"><ActionButtons partner={partner} onEdit={() => onEdit(partner)} onStatus={() => onStatus(partner)} onDelete={() => onDelete(partner)} /></td></tr>)}</tbody></table>;
}

function PartnerCard({ partner, publicOrigin, copied, onCopy, onEdit, onStatus, onDelete }: { partner: AdminPartner; publicOrigin: string; copied: boolean; onCopy: () => void; onEdit: () => void; onStatus: () => void; onDelete: () => void }) {
  return <article className="space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{partner.name}</h3><p className="mt-1 font-mono text-xs text-zinc-500">{partner.slug}</p><div className="mt-2"><PartnerTypeBadge partnerType={partner.partnerType} /></div></div><StatusBadge status={partner.status} /></div><div className="grid grid-cols-2 gap-3 text-xs"><div><p className="uppercase text-zinc-600">Desconto</p><p className="mt-1 font-mono text-lg font-black text-brand">{partner.discountPercentage}%</p></div><div><p className="uppercase text-zinc-600">Criado em</p><p className="mt-1 text-zinc-300">{dateFormatter.format(new Date(partner.createdAt))}</p></div></div><div className="border border-white/8 bg-black p-3"><p className="truncate font-mono text-[11px] text-zinc-500">{buildPartnerLink(publicOrigin, partner.slug)}</p><button type="button" onClick={onCopy} className="mt-2 inline-flex items-center gap-2 text-xs font-black uppercase text-brand">{copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}{copied ? 'Copiado' : 'Copiar link'}</button></div><ActionButtons partner={partner} onEdit={onEdit} onStatus={onStatus} onDelete={onDelete} /></article>;
}

function PartnerTypeBadge({ partnerType }: { partnerType: PartnerType }) {
  const Icon = partnerType === 'influencer' ? Megaphone : Building2;
  return <span className="inline-flex items-center gap-1.5 border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-300"><Icon className="h-3.5 w-3.5 text-brand" />{partnerTypeLabels[partnerType]}</span>;
}

function StatusBadge({ status }: { status: PartnerStatus }) {
  return <span className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${status === 'active' ? 'border-brand/30 bg-brand/10 text-brand' : 'border-zinc-600/40 bg-zinc-700/20 text-zinc-400'}`}>{status === 'active' ? 'Ativo' : 'Inativo'}</span>;
}

function ActionButtons({ partner, onEdit, onStatus, onDelete }: { partner: AdminPartner; onEdit: () => void; onStatus: () => void; onDelete: () => void }) {
  return <div className="flex flex-wrap gap-2"><button type="button" title="Editar parceiro" onClick={onEdit} className="flex h-9 w-9 items-center justify-center border border-white/10 text-zinc-300 hover:border-brand hover:text-brand"><Edit3 className="h-4 w-4" /></button><button type="button" title={partner.status === 'active' ? 'Inativar parceiro' : 'Ativar parceiro'} onClick={onStatus} className="flex h-9 w-9 items-center justify-center border border-white/10 text-zinc-300 hover:border-brand hover:text-brand"><Power className="h-4 w-4" /></button><button type="button" title="Excluir parceiro" onClick={onDelete} className="flex h-9 w-9 items-center justify-center border border-white/10 text-zinc-300 hover:border-red-400 hover:text-red-300"><Trash2 className="h-4 w-4" /></button></div>;
}

function PartnerForm({ draft, editing, saving, slugState, onName, onSlug, onChange, onSubmit, onClose }: { draft: PartnerInput; editing: boolean; saving: boolean; slugState: 'idle' | 'checking' | 'available' | 'unavailable'; onName: (value: string) => void; onSlug: (value: string) => void; onChange: (draft: PartnerInput) => void; onSubmit: (event: FormEvent) => void; onClose: () => void }) {
  const disabled = saving || slugState === 'checking' || slugState === 'unavailable' || draft.name.trim().length < 2 || draft.slug.length < 2 || draft.discountPercentage <= 0 || draft.discountPercentage >= 100;
  return <div className="fixed inset-0 z-60 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"><form onSubmit={onSubmit} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto border border-white/10 bg-zinc-950 p-5 shadow-2xl sm:p-7"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-brand">{editing ? `Editar ${partnerTypeLabels[draft.partnerType].toLowerCase()}` : 'Novo parceiro'}</p><h2 className="mt-2 text-2xl font-black">{editing ? draft.name : 'Cadastrar parceiro'}</h2></div><button type="button" aria-label="Fechar" onClick={onClose} className="flex h-10 w-10 items-center justify-center border border-white/10 text-zinc-400 hover:text-white"><X className="h-5 w-5" /></button></div><div className="grid gap-4 sm:grid-cols-2"><FormInput label="Nome do parceiro" value={draft.name} onChange={onName} required /><label className="text-xs font-bold text-zinc-400">Tipo do parceiro<select required value={draft.partnerType} onChange={(event) => onChange({ ...draft, partnerType: event.target.value as PartnerType })} className="mt-1 min-h-12 w-full border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-brand">{partnerTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-xs font-bold text-zinc-400">Slug<span className="relative mt-1 block"><input required value={draft.slug} onChange={(event) => onSlug(event.target.value)} className={`min-h-12 w-full border bg-black px-3 pr-10 font-mono text-sm text-white outline-none ${slugState === 'unavailable' ? 'border-red-400' : slugState === 'available' ? 'border-brand' : 'border-white/10 focus:border-brand'}`} />{slugState === 'checking' && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" />}{slugState === 'available' && <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand" />}{slugState === 'unavailable' && <X className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-red-400" />}</span><span className={`mt-1 block text-[11px] ${slugState === 'unavailable' ? 'text-red-300' : 'text-zinc-600'}`}>{slugState === 'unavailable' ? 'Este slug ja esta em uso.' : 'Unico para todos os tipos; usado em /p/slug.'}</span></label><FormInput label="Percentual de desconto" value={String(draft.discountPercentage)} onChange={(value) => onChange({ ...draft, discountPercentage: Number(value) })} type="number" min="0.01" max="99.99" step="0.01" required /><label className="text-xs font-bold text-zinc-400">Status<select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as PartnerStatus })} className="mt-1 min-h-12 w-full border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-brand"><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label></div><label className="mt-4 block text-xs font-bold text-zinc-400">Descricao <span className="font-normal text-zinc-600">(opcional)</span><textarea value={draft.description || ''} maxLength={1000} onChange={(event) => onChange({ ...draft, description: event.target.value || null })} className="mt-1 min-h-28 w-full resize-y border border-white/10 bg-black p-3 text-sm text-white outline-none focus:border-brand" /></label><div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="min-h-11 border border-white/10 px-5 text-xs font-black uppercase text-zinc-300 hover:border-white/30">Cancelar</button><button disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 bg-brand px-6 text-xs font-black uppercase tracking-widest text-black hover:bg-white disabled:cursor-not-allowed disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Salvando...' : editing ? 'Salvar alteracoes' : 'Criar parceiro'}</button></div></form></div>;
}

function FormInput({ label, value, onChange, type = 'text', ...props }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; min?: string; max?: string; step?: string }) {
  return <label className="text-xs font-bold text-zinc-400">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-12 w-full border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-brand" {...props} /></label>;
}

function ConfirmDelete({ partner, saving, onConfirm, onClose }: { partner: AdminPartner; saving: boolean; onConfirm: () => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" className="w-full max-w-md border border-red-400/20 bg-zinc-950 p-6"><Trash2 className="h-9 w-9 text-red-300" /><h2 className="mt-5 text-xl font-black">Excluir parceiro?</h2><p className="mt-2 text-sm leading-relaxed text-zinc-400"><strong className="text-white">{partner.name}</strong> sera inativado e removido da listagem. O historico sera preservado.</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={saving} onClick={onClose} className="min-h-11 border border-white/10 px-4 text-xs font-black uppercase text-zinc-300">Cancelar</button><button type="button" disabled={saving} onClick={onConfirm} className="inline-flex min-h-11 items-center gap-2 bg-red-400 px-4 text-xs font-black uppercase text-black disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Excluir</button></div></div></div>;
}
