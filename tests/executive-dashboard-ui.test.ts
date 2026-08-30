import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WalletCards } from 'lucide-react';
import {
  BUSINESS_TIMEZONE,
  DistributionBars,
  ExecutiveEventSelection,
  ExecutiveSeries,
  HeatTiles,
  KpiCard,
  LOT_LEVEL_LABEL,
  LotOccupancy,
  businessDateTimeFormatter,
  integerFormatter,
  percentFormatter,
} from '../src/pages/Admin';

// ADMIN-002 Stage 7B — UX / a11y / responsive closure. SSR markup only
// (renderToStaticMarkup), no jsdom / axe / new dependency.

const admin = readFileSync('src/pages/Admin.tsx', 'utf8');
const panel = (() => {
  const start = admin.indexOf('function ExecutiveDashboardPanel(');
  const end = admin.indexOf('\nexport function LotOccupancy(', start);
  assert.ok(start >= 0 && end > start, 'ExecutiveDashboardPanel block located');
  return admin.slice(start, end);
})();

const series = [
  { label: '2026-08-24', count: 3, amountCents: 100_000 },
  { label: '2026-08-25', count: 5, amountCents: 250_000 },
  { label: '2026-08-26', count: 2, amountCents: 90_000 },
];

// ---- §53 chart accessibility -------------------------------------------------

test('§53 ExecutiveSeries has an accessible name, DOM value, no hover-only value, empty state', () => {
  const markup = renderToStaticMarkup(createElement(ExecutiveSeries, { data: series, caption: 'Receita por dia' }));
  assert.match(markup, /<figure/);
  assert.match(markup, /<figcaption[^>]*>Receita por dia<\/figcaption>/);
  // the visual bars are decorative
  assert.match(markup, /aria-hidden="true"/);
  // a value is present in the DOM (not only inside a group-hover span)
  assert.match(markup, /<td[^>]*>R\$\s*2\.500,00<\/td>/);
  // keyboard/touch/SR alternative
  assert.match(markup, /<details/);
  assert.match(markup, /<summary[^>]*>Ver dados<\/summary>/);
  assert.match(markup, /<table/);

  const empty = renderToStaticMarkup(createElement(ExecutiveSeries, { data: [], caption: 'x' }));
  assert.match(empty, /Sem dados neste período\./);
});

// ---- §54 chart data alternative -------------------------------------------------

test('§54 the ExecutiveSeries data table contains every visible point (label + formatted value)', () => {
  const markup = renderToStaticMarkup(createElement(ExecutiveSeries, { data: series, caption: 'Receita por dia' }));
  for (const point of series) {
    assert.ok(markup.includes(point.label), `table row for ${point.label}`);
  }
  // 100_000 / 250_000 / 90_000 cents -> R$ 1.000,00 / R$ 2.500,00 / R$ 900,00
  assert.match(markup, /R\$\s*1\.000,00/);
  assert.match(markup, /R\$\s*900,00/);
  assert.equal((markup.match(/<tr/g) || []).length, series.length + 1, 'header row + one row per point');
});

// ---- §55 KPI ----------------------------------------------------------------

test('§55 KpiCard: value has no truncate, loading is exposed, no fake trend arrow', () => {
  const ready = renderToStaticMarkup(createElement(KpiCard, {
    label: 'Receita bruta', value: 'R$ 1.234.567,89', icon: WalletCards, detail: 'todas as inscrições pagas', loading: false,
  }));
  assert.ok(!/class="[^"]*\btruncate\b[^"]*"/.test(ready), 'KPI value is never truncated');
  assert.match(ready, /R\$ 1\.234\.567,89/);
  // <dl>/<dt>/<dd> semantics
  assert.match(ready, /<dl/);
  assert.match(ready, /<dt/);
  assert.match(ready, /<dd/);
  // exactly one <svg> (the decorative icon) — no trend arrow when trend is omitted
  assert.equal((ready.match(/<svg/g) || []).length, 1);

  const withTrend = renderToStaticMarkup(createElement(KpiCard, {
    label: 'x', value: '1', icon: WalletCards, detail: 'y', trend: 'up', loading: false,
  }));
  assert.equal((withTrend.match(/<svg/g) || []).length, 2, 'trend arrow renders only when a real trend is passed');

  const busy = renderToStaticMarkup(createElement(KpiCard, {
    label: 'Receita bruta', value: 'R$ 1,00', icon: WalletCards, detail: 'x', loading: true,
  }));
  assert.match(busy, /aria-hidden="true"/); // skeleton is decorative
  assert.ok(!busy.includes('R$ 1,00'), 'no value text while loading');
});

test('§55 the Executive Dashboard passes no trend prop to its KPI cards', () => {
  const kpiBlock = panel.slice(panel.indexOf('exec-kpis-heading'), panel.indexOf('Inscrições por status'));
  assert.ok(!/\btrend=/.test(kpiBlock), 'no hardcoded trend on the executive KPIs');
});

// ---- §56 lot status -------------------------------------------------------------

test('§56 LotOccupancy announces warning / critical / blocked / normal with text', () => {
  for (const [level, label] of Object.entries(LOT_LEVEL_LABEL)) {
    const markup = renderToStaticMarkup(createElement(LotOccupancy, {
      lots: [{ id: 'l', name: 'Lote 1', priceCents: 12_000, capacityTotal: 100, confirmed: 40, temporaryReservations: 2, occupied: 42, available: 58, occupancyPercent: 42, level: level as never }],
    }));
    assert.ok(markup.includes(label), `lot level "${level}" renders the text "${label}"`);
  }
  const empty = renderToStaticMarkup(createElement(LotOccupancy, { lots: [] }));
  assert.match(empty, /Nenhum lote disponível\./);
});

// ---- §57 headings ---------------------------------------------------------------

test('§57 exactly one <h1> for the executive tab; the Topbar no longer competes', () => {
  assert.ok(!/<h1[^>]*>Centro de operações FunPace Run<\/h1>/.test(admin), 'Topbar heading demoted to <p>');
  assert.match(admin, /<p className="truncate text-sm font-bold text-zinc-300 sm:text-base">Centro de operações FunPace Run<\/p>/);
  assert.equal((panel.match(/<h1[ >]/g) || []).length, 1, 'ExecutiveDashboardPanel renders a single <h1>');
  assert.match(panel, /<h1 id="exec-dashboard-heading"/);
});

test('§57 the KPI group and funnel carry a group heading', () => {
  assert.match(panel, /<h2 id="exec-kpis-heading"[^>]*>Visão executiva<\/h2>/);
  assert.match(panel, /aria-labelledby="exec-kpis-heading"/);
  assert.match(panel, /title="Inscrições por status"/); // Panel renders <h2>
});

// ---- §58 nav ------------------------------------------------------------------

test('§58 sidebar nav has an accessible name and marks the active item', () => {
  assert.match(admin, /<nav aria-label="Navegação administrativa"/);
  assert.match(admin, /aria-current=\{active \? 'page' : undefined\}/);
});

// ---- §59 event selector -------------------------------------------------------

test('§59 ExecutiveEventSelection: labelled select, error association, adequate target', () => {
  const markup = renderToStaticMarkup(createElement(ExecutiveEventSelection, {
    events: [{ id: 'a', slug: 'a', name: 'Evento A', status: 'published', date: '2026-09-20' }],
    eventsError: '', message: 'Há mais de um evento publicado.', onSelect: () => {}, onRetryEvents: () => {},
  }));
  assert.match(markup, /aria-label="Selecionar evento do dashboard"/);
  assert.match(markup, /aria-describedby="exec-event-message"/);
  assert.match(markup, /id="exec-event-message"[^>]*role="status"/);
  assert.match(markup, /<select[^>]*class="[^"]*min-h-11/);
  assert.match(markup, /<button[^>]*class="[^"]*min-h-11/);
});

test('§59 the header event selector reflects the pending selection and is tap-sized', () => {
  const header = panel.slice(panel.indexOf('exec-dashboard-heading'), panel.indexOf('exec-kpis-heading'));
  assert.match(header, /value=\{selectedEventId\}/);
  assert.match(header, /className="min-h-11 border border-white\/15/);
  assert.match(panel, /const selectedEventId = pendingEventId \|\| data\?\.event\.id \|\| '';/);
});

// ---- §60 runtime states ------------------------------------------------------

test('§60 runtime-state semantics: stale=status, initial-error=alert without a duplicate live region', () => {
  assert.match(panel, /phase === 'stale' && \(\s*\n\s*<div role="status"/);
  const initialError = panel.slice(panel.indexOf("phase === 'initial-error'"), panel.indexOf("// phase === 'initial-loading'"));
  assert.ok(!/aria-live/.test(initialError), 'initial-error does not add a live region on top of role="alert"');
  const statusMessage = admin.slice(admin.indexOf('function StatusMessage('));
  assert.match(statusMessage, /role=\{tone === 'error' \? 'alert' : 'status'\}/);
});

test('§65 focus is moved to the dashboard heading after recovering from a blocking state', () => {
  assert.match(panel, /const headingRef = useRef<HTMLHeadingElement>\(null\)/);
  assert.match(panel, /tabIndex=\{-1\}/);
  assert.match(panel, /headingRef\.current\?\.focus\(\)/);
});

// ---- §61 empty states ------------------------------------------------------------

test('§61 every chart has a distinct empty state', () => {
  assert.match(renderToStaticMarkup(createElement(ExecutiveSeries, { data: [], caption: 'x' })), /Sem dados neste período\./);
  assert.match(renderToStaticMarkup(createElement(HeatTiles, { data: [] })), /Nenhuma cidade registrada\./);
  assert.match(renderToStaticMarkup(createElement(LotOccupancy, { lots: [] })), /Nenhum lote disponível\./);
  assert.match(renderToStaticMarkup(createElement(DistributionBars, { data: [] })), /Sem dados disponíveis\./);
});

// ---- §62 formatters --------------------------------------------------------------

test('§62 pt-BR number formatting and Porto Velho timezone', () => {
  assert.equal(percentFormatter.format(61.3), '61,3');
  assert.equal(percentFormatter.format(0), '0');
  assert.equal(integerFormatter.format(1234), '1.234');
  assert.equal(integerFormatter.format(1234567), '1.234.567');
  assert.equal(BUSINESS_TIMEZONE, 'America/Porto_Velho');
  assert.equal(businessDateTimeFormatter.resolvedOptions().timeZone, 'America/Porto_Velho');
  // 2026-08-30T06:00:00Z === 02:00 in America/Porto_Velho (UTC-4)
  assert.match(businessDateTimeFormatter.format(new Date('2026-08-30T06:00:00.000Z')), /02:00/);
});

test('§62 DistributionBars renders pt-BR grouped integers', () => {
  const markup = renderToStaticMarkup(createElement(DistributionBars, {
    data: [{ label: 'Instagram', count: 1234, amountCents: 0 }], caption: 'Origem',
  }));
  assert.match(markup, /1\.234/);
});

// ---- §63 responsive contract --------------------------------------------------

test('§63 the dashboard grids gain md/lg breakpoints, not just xl', () => {
  assert.ok(panel.includes('lg:grid-cols-2'), 'revenue grid breaks at lg');
  assert.ok(panel.includes('md:grid-cols-2'), 'secondary grids break at md');
  assert.ok(!/className="grid gap-4 xl:grid-cols-3"/.test(panel), 'no bare "1 column until xl" grid remains');
  assert.ok(!/className="grid gap-4 xl:grid-cols-2"/.test(panel));
});

// ---- §64 recent ------------------------------------------------------------------

test('§64 the Executive Dashboard drops "Últimos webhooks" and never labels a row with a raw id', () => {
  assert.ok(!panel.includes('Últimos webhooks'), 'webhook log removed from the executive surface');
  assert.ok(!panel.includes('recent.webhooks'), 'no webhook data read on the executive surface');
  assert.ok(!/label:\s*item\.registrationId/.test(panel), 'no raw registration id as a row label');
  assert.ok(!/label:\s*item\.id\b/.test(panel), 'no raw id as a row label');
  assert.match(panel, /Últimos pagamentos/);
  assert.match(panel, /Últimas confirmações/);
});

// ---- density / progressive disclosure ----------------------------------------

test('§38-40 secondary analytics collapse under a <details> that starts closed', () => {
  assert.match(panel, /<details className="border border-white\/10 bg-zinc-950\/80">\s*\n\s*<summary[^>]*>Análise detalhada<\/summary>/);
  assert.ok(!/‹details open|<details open/.test(panel), 'details starts collapsed');
  // every detailed panel is still present (no metric removed)
  for (const t of ['Receita por hora', 'Receita por cidade', 'Receita por sexo', 'Faixa etária', 'Mapa de calor por cidade', 'Tamanhos de camisa', 'Distâncias', 'Ocupação dos lotes']) {
    assert.ok(panel.includes(`title="${t}"`), `detailed panel "${t}" preserved`);
  }
});
