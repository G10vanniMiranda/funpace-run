// EVENT-DAY-OFFLINE-FALLBACK & START-LIST — the smallest Admin print surface.
//
// `StartListCard` sits in the Operação panel: a sort toggle, a CSV download and
// an "open for printing" action. `StartListPrintOverlay` is a fixed full-screen
// operational document with a scoped `@media print` stylesheet — plain black on
// white, A4, no decoration, no Admin chrome. The operator prints (or "Save as
// PDF") each ordering. No new dependency: browser print + a scoped style block.

import { useCallback, useEffect, useState } from 'react';
import { Printer, ListOrdered, ArrowDownAZ, Download, X } from 'lucide-react';
import { ApiError, getAdminStartList, getAdminStartListCsvUrl } from '../../lib/api';
import type { AdminStartListResponse, StartListSort } from '../../types/registration';

const PRINT_TZ = 'America/Porto_Velho';
const printTimestamp = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: PRINT_TZ,
});

const SORT_LABEL: Record<StartListSort, string> = { bib: 'Por dorsal', name: 'Por nome' };
const STATUS_LABEL: Record<AdminStartListResponse['status'], string> = {
  final: 'LISTA FINAL',
  provisional: 'LISTA PROVISÓRIA',
  blocked: 'LISTA BLOQUEADA',
};
const WARNING_LABEL: Record<string, string> = {
  PAID_WITHOUT_BIB: 'atletas pagos SEM DORSAL',
  DUPLICATE_PAID_IDENTITY: 'pessoas com mais de uma inscrição paga (revisar)',
  INVALID_DISTANCE: 'inscrições com prova não reconhecida',
};
const FAILURE_LABEL: Record<string, string> = {
  DUPLICATE_BIB: 'dorsais duplicados',
  KIT_WITHOUT_CHECK_IN: 'kit entregue sem check-in',
};

function paperTime(at: string | null): string {
  return at ? at.slice(11, 16) : '';
}

export function StartListCard({ adminKey }: { adminKey: string }) {
  const [sort, setSort] = useState<StartListSort>('bib');
  const [overlay, setOverlay] = useState<AdminStartListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);

  const open = useCallback(async (nextSort: StartListSort) => {
    setLoading(true);
    setError('');
    try {
      const response = await getAdminStartList(adminKey, { sort: nextSort });
      setOverlay(response);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível gerar a lista de largada.');
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  const downloadCsv = useCallback(async (nextSort: StartListSort) => {
    setCsvBusy(true);
    setError('');
    try {
      const response = await fetch(getAdminStartListCsvUrl({ sort: nextSort }), { credentials: 'include' });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { code?: string } | null;
        throw new Error(
          errorBody?.code === 'START_LIST_INTEGRITY_FAILED'
            ? 'A lista tem falhas de integridade (dorsal duplicado ou kit sem check-in). Corrija antes de exportar.'
            : 'Não foi possível baixar a lista de largada.',
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lista-largada-${nextSort === 'name' ? 'por-nome' : 'por-dorsal'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Falha ao baixar a lista.');
    } finally {
      setCsvBusy(false);
    }
  }, []);

  return (
    <div className="border border-white/10 bg-white/3 p-4">
      <p className="text-xs font-black uppercase tracking-widest text-brand">Fallback offline</p>
      <h3 className="mt-1 text-base font-black">Lista de largada</h3>
      <p className="mt-1 text-xs text-zinc-400">
        Roster de atletas pagos para impressão. Imprima antes do evento e guarde cópias em papel; em queda de
        internet, marque check-in e kit no papel e reconcilie depois.
      </p>


      <div className="mt-3 inline-flex border border-white/10" role="group" aria-label="Ordenação da lista">
        {(['bib', 'name'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={sort === option}
            onClick={() => setSort(option)}
            className={`inline-flex min-h-10 items-center gap-1 px-3 text-xs font-black uppercase tracking-widest ${
              sort === option ? 'bg-brand text-black' : 'text-zinc-300 hover:text-brand'
            }`}
          >
            {option === 'bib' ? <ListOrdered className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />}
            {SORT_LABEL[option]}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void open(sort)}
          className="inline-flex min-h-10 items-center gap-2 border border-brand/40 px-3 text-xs font-black uppercase text-brand disabled:opacity-40"
        >
          <Printer className="h-4 w-4" /> {loading ? 'Gerando…' : 'Abrir para impressão'}
        </button>
        <button
          type="button"
          disabled={csvBusy}
          onClick={() => void downloadCsv(sort)}
          className="inline-flex min-h-10 items-center gap-2 border border-white/10 px-3 text-xs font-black uppercase text-zinc-200 disabled:opacity-40"
        >
          <Download className="h-4 w-4" /> {csvBusy ? 'Baixando…' : 'Baixar CSV'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 border border-red-400/20 bg-red-400/10 p-2 text-xs text-red-100">
          {error}
        </p>
      )}

      {overlay && (
        <StartListPrintOverlay
          initial={overlay}
          onReorder={(nextSort) => open(nextSort)}
          onDownload={(nextSort) => downloadCsv(nextSort)}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}

export function StartListPrintOverlay({
  initial,
  onReorder,
  onDownload,
  onClose,
}: {
  initial: AdminStartListResponse;
  onReorder: (sort: StartListSort) => void;
  onDownload: (sort: StartListSort) => void;
  onClose: () => void;
}) {
  const list = initial;
  const semDorsal = list.rows.filter((row) => !row.hasBib);
  const withBib = list.rows.filter((row) => row.hasBib);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="start-list-overlay fixed inset-0 z-[9999] overflow-auto bg-white text-black" role="dialog" aria-label="Lista de largada para impressão">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .start-list-overlay, .start-list-overlay * { visibility: visible !important; }
          .start-list-overlay { position: absolute !important; inset: 0 !important; overflow: visible !important; }
          .start-list-no-print { display: none !important; }
          .start-list-doc { padding: 0 !important; }
          .start-list-table thead { display: table-header-group; }
          .start-list-table tr { break-inside: avoid; }
        }
        .start-list-table { border-collapse: collapse; width: 100%; }
        .start-list-table th, .start-list-table td { border: 1px solid #000; padding: 3px 6px; font-size: 10px; text-align: left; vertical-align: top; }
        .start-list-table th { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
        .start-list-box { display: inline-block; width: 14px; height: 14px; border: 1px solid #000; }
      `}</style>

      <div className="start-list-no-print sticky top-0 flex flex-wrap items-center gap-2 border-b border-black/20 bg-white/95 px-4 py-3">
        <div className="inline-flex border border-black" role="group" aria-label="Ordenação">
          {(['bib', 'name'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={list.sort === option}
              onClick={() => onReorder(option)}
              className={`min-h-10 px-3 text-xs font-black uppercase ${list.sort === option ? 'bg-black text-white' : 'text-black'}`}
            >
              {SORT_LABEL[option]}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => window.print()} className="inline-flex min-h-10 items-center gap-2 border border-black bg-black px-3 text-xs font-black uppercase text-white">
          <Printer className="h-4 w-4" /> Imprimir
        </button>
        <button type="button" onClick={() => onDownload(list.sort)} className="inline-flex min-h-10 items-center gap-2 border border-black px-3 text-xs font-black uppercase text-black">
          <Download className="h-4 w-4" /> CSV
        </button>
        <button type="button" onClick={onClose} className="ml-auto inline-flex min-h-10 items-center gap-2 border border-black px-3 text-xs font-black uppercase text-black">
          <X className="h-4 w-4" /> Fechar
        </button>
      </div>

      <div className="start-list-doc mx-auto max-w-[900px] px-6 py-5">
        <header className="border-b-2 border-black pb-2">
          <h1 className="text-lg font-black uppercase">
            {list.event.name} — Lista de Largada ({SORT_LABEL[list.sort]})
          </h1>
          <p className="mt-1 text-xs">
            Evento {list.event.slug} · Data {list.event.date} · Gerada em {printTimestamp.format(new Date(list.generatedAt))} (Porto Velho) ·
            Ref {list.contentRef}
          </p>
          <p className="mt-1 text-xs font-black">
            {STATUS_LABEL[list.status]} · {list.integrity.totalPaid} pagos · {list.integrity.paidWithBib} com dorsal ·{' '}
            {list.integrity.paidWithoutBib} SEM DORSAL
          </p>
          {list.warnings.length > 0 && (
            <ul className="mt-1 text-xs">
              {list.warnings.map((code) => (
                <li key={code}>
                  ⚠ {code === 'PAID_WITHOUT_BIB' ? list.integrity.paidWithoutBib : code === 'INVALID_DISTANCE' ? list.integrity.invalidDistanceCount : list.integrity.paidIdentityReviewCount}{' '}
                  {WARNING_LABEL[code] ?? code}
                </li>
              ))}
            </ul>
          )}
          {list.status === 'blocked' && (
            <p className="mt-1 border border-black p-1 text-xs font-black">
              LISTA BLOQUEADA — {list.failures.map((code) => FAILURE_LABEL[code] ?? code).join('; ')}. Não use para operação; corrija e gere de novo.
            </p>
          )}
          {list.status === 'provisional' && (
            <p className="mt-1 text-xs">
              Lista provisória: regenere após o backfill de dorsais e a última correção administrativa. Só a versão final (impressa ~2 h antes) vai para as estações.
            </p>
          )}
        </header>

        {semDorsal.length > 0 && (
          <section className="mt-4">
            <h2 className="text-sm font-black uppercase">⚠ Sem dorsal — atribuir na chegada ({semDorsal.length})</h2>
            <StartListTable rows={semDorsal} />
          </section>
        )}

        <section className="mt-4">
          <h2 className="text-sm font-black uppercase">
            {list.sort === 'bib' ? `Atletas com dorsal (${withBib.length})` : `Todos os atletas pagos (${list.rows.length})`}
          </h2>
          <StartListTable rows={list.sort === 'bib' ? withBib : list.rows} />
        </section>

        <footer className="mt-4 border-t border-black pt-2 text-xs">
          Marque KIT somente após o CHECK-IN do mesmo atleta. Em queda de internet, esta folha é o registro temporário —
          um responsável por folha, sem marcação dupla. Reconcilie no sistema quando voltar (check-ins primeiro, kits depois).
        </footer>
      </div>
    </div>
  );
}

function StartListTable({ rows }: { rows: AdminStartListResponse['rows'] }) {
  return (
    <table className="start-list-table mt-1">
      <caption className="sr-only">Lista de atletas: dorsal, participante, CPF, prova, camisa, check-in e kit.</caption>
      <thead>
        <tr>
          <th scope="col">Dorsal</th>
          <th scope="col">Participante</th>
          <th scope="col">CPF</th>
          <th scope="col">Prova</th>
          <th scope="col">Camisa</th>
          <th scope="col">Check-in</th>
          <th scope="col">Kit (após check-in)</th>
          <th scope="col">ID</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.registrationId}>
            <td className="font-black">{row.bib}</td>
            <td>{row.name}</td>
            <td>{row.cpfMasked}</td>
            <td>{row.distanceKnown ? row.distance : `${row.distance} (?)`}</td>
            <td>{row.shirtSize}</td>
            <td>{row.checkIn.recorded ? `☑ ${paperTime(row.checkIn.at)}` : <span className="start-list-box" aria-label="pendente" />}</td>
            <td>{row.kit.recorded ? `☑ ${paperTime(row.kit.at)}` : <span className="start-list-box" aria-label="pendente" />}</td>
            <td style={{ fontSize: '7px' }}>{row.registrationId}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
