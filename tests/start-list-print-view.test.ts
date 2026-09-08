import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// EVENT-DAY-OFFLINE-FALLBACK & START-LIST — the print surface contract. Repo
// convention: no jsdom render in unit tests; assert the markup/behaviour
// contract from source. Not overfit to JSX formatting.

const view = readFileSync('src/components/admin/StartListPrint.tsx', 'utf8');
const admin = readFileSync('src/pages/Admin.tsx', 'utf8');

test('the card is wired into the Operação panel and nowhere else', () => {
  assert.match(admin, /import \{ StartListCard \} from '\.\.\/components\/admin\/StartListPrint';/);
  assert.match(admin, /<StartListCard adminKey=\{adminKey\} \/>/);
  assert.equal([...admin.matchAll(/<StartListCard\b/g)].length, 1);
});

test('print mechanics: scoped @media print + window.print(), no new dependency', () => {
  assert.match(view, /@media print/);
  assert.match(view, /@page \{ size: A4; margin: 12mm; \}/);
  assert.match(view, /window\.print\(\)/);
  assert.match(view, /thead \{ display: table-header-group; \}/);
  // only lucide-react + local imports — no charting / pdf / print library
  const imports = [...view.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(
    imports.sort(),
    ['../../lib/api', '../../types/registration', 'lucide-react', 'react'].sort(),
  );
});

test('two print orders are operator-selectable and re-fetch via the sort contract', () => {
  assert.match(view, /SORT_LABEL: Record<StartListSort, string> = \{ bib: 'Por dorsal', name: 'Por nome' \}/);
  // card toggle + overlay toggle
  assert.match(view, /aria-label="Ordenação da lista"/);
  assert.match(view, /onReorder\(option\)/);
  assert.match(view, /onReorder: \(sort: StartListSort\) => void/);
  // the document states its ordering
  assert.match(view, /Lista de Largada \(\{SORT_LABEL\[list\.sort\]\}\)/);
});

test('document header shows event, generatedAt (Porto Velho tz), contentRef and totals', () => {
  assert.match(view, /const PRINT_TZ = 'America\/Porto_Velho';/);
  assert.match(view, /timeZone: PRINT_TZ,/);
  assert.match(view, /Gerada em \{printTimestamp\.format\(new Date\(list\.generatedAt\)\)\} \(Porto Velho\)/);
  assert.match(view, /Ref \{list\.contentRef\}/);
  assert.match(view, /\{list\.integrity\.totalPaid\} pagos.*\{list\.integrity\.paidWithBib\} com dorsal.*\{list\.integrity\.paidWithoutBib\} SEM DORSAL/s);
});

test('provisional + blocked indicators are shown, never silently suppressed', () => {
  assert.match(view, /STATUS_LABEL: Record<[^>]+> = \{\s*\n\s*final: 'LISTA FINAL',\s*\n\s*provisional: 'LISTA PROVISÓRIA',\s*\n\s*blocked: 'LISTA BLOQUEADA',/);
  assert.match(view, /list\.status === 'blocked'/);
  assert.match(view, /list\.status === 'provisional'/);
  assert.match(view, /list\.warnings\.map/);
  assert.match(view, /regenere após o backfill de dorsais/);
});

test('SEM DORSAL rows are isolated in a labelled top section, never omitted', () => {
  assert.match(view, /const semDorsal = list\.rows\.filter\(\(row\) => !row\.hasBib\)/);
  assert.match(view, /Sem dorsal — atribuir na chegada \(\{semDorsal\.length\}\)/);
  assert.match(view, /\{semDorsal\.length > 0 && \(/);
});

test('CHECK-IN column precedes KIT; KIT header says "após check-in"; footer instruction present', () => {
  const checkInIdx = view.indexOf('<th scope="col">Check-in</th>');
  const kitIdx = view.indexOf('Kit (após check-in)');
  assert.ok(checkInIdx >= 0 && kitIdx >= 0 && checkInIdx < kitIdx, 'Check-in column must come before Kit');
  assert.match(view, /Marque KIT somente após o CHECK-IN do mesmo atleta/);
  assert.match(view, /check-ins primeiro, kits depois/);
});

test('semantic table: caption + th scope=col; boxes are drawn borders, not colour', () => {
  assert.match(view, /<caption className="sr-only">/);
  assert.match(view, /<th scope="col">Dorsal<\/th>/);
  assert.match(view, /\.start-list-box \{ display: inline-block; width: 14px; height: 14px; border: 1px solid #000; \}/);
  // data cells rely on borders, not background-color
  assert.match(view, /\.start-list-table th, \.start-list-table td \{ border: 1px solid #000;/);
  // print @media forces a white ground; the only CSS `background:` is #fff
  assert.match(view, /@media print \{[\s\S]*?body \{ background: #fff !important; \}/);
  assert.deepEqual([...view.matchAll(/background(?:-color)?:\s*([^;!]+)/g)].map((m) => m[1].trim()), ['#fff']);
});

test('PII-excluded fields never appear in the print component', () => {
  for (const forbidden of [/\.email\b/, /\.phone\b/, /\.birthDate\b/, /\.amountCents\b/, /\.gatewayTransactionId\b/, /\.providerPaymentId\b/, /\.couponCode\b/, /\.partnerId\b/, /\bpersonKey\b/, /registration\.payload|row\.payload/]) {
    assert.doesNotMatch(view, forbidden, `print view must not reference ${forbidden}`);
  }
  // it only ever renders the allowlisted StartListRow fields
  assert.match(view, /row\.bib/);
  assert.match(view, /row\.cpfMasked/);
  assert.match(view, /row\.shirtSize/);
});

test('CSV download surfaces the integrity-fail-closed 409 as a clear message', () => {
  assert.match(view, /START_LIST_INTEGRITY_FAILED/);
  assert.match(view, /Corrija antes de exportar/);
});

test('no animation classes on the print surface', () => {
  assert.doesNotMatch(view, /animate-|transition-(?!colors)|duration-\d/);
});
