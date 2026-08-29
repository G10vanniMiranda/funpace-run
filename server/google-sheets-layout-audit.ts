import { createHash } from 'node:crypto';

import {
  buildGoogleSheetLayoutPlan,
  GOOGLE_SHEET_LAYOUTS,
  type ActualGoogleSheetLayout,
  type GoogleSheetLayoutKey,
  type GoogleSheetLayoutPlan,
} from './google-sheets-layout.js';

// ---------------------------------------------------------------------------
// RELEASE-04 Stage 1 — read-only layout audit report.
//
// Pure. Takes already-fetched spreadsheet metadata (never row data) and turns
// it into a sanitized DETECT/PLAN report. It performs zero network calls and
// zero mutations: every report carries `remoteMutations: 0`.
// ---------------------------------------------------------------------------

export function shortFingerprint(value: string): string {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12);
}

export function headerFingerprint(header: ReadonlyArray<unknown> | undefined): string | null {
  if (!header || header.length === 0) return null;
  return shortFingerprint(header.map((cell) => String(cell ?? '').trim()).join(''));
}

export type LayoutAuditTabInput = {
  sheetKey: GoogleSheetLayoutKey;
  sheetId: number;
  actual: ActualGoogleSheetLayout;
  serviceAccountEmail?: string;
  dataRowCount?: number;
  /** Row 1 values only, never data rows. Optional. */
  actualHeader?: ReadonlyArray<unknown>;
};

export type LayoutAuditTabReport = {
  sheetKey: GoogleSheetLayoutKey;
  sheetTitle: string | null;
  expectedColumnCount: number;
  headerHash: string | null;
  expectedHeaderHash: string;
  schemaDrift: boolean;
  driftStatus: GoogleSheetLayoutPlan['driftStatus'] | 'schema_drift';
  plan: GoogleSheetLayoutPlan | null;
  remoteMutations: 0;
  notes: string[];
};

export type LayoutAuditReport = {
  generatedAt: string;
  mode: 'fixture' | 'remote';
  spreadsheetFingerprint: string | null;
  remoteMutations: 0;
  tabs: LayoutAuditTabReport[];
  summary: {
    converged: number;
    managed_repair: number;
    legacy_migration: number;
    drift_detected: number;
    schema_drift: number;
    totalPlannedRequests: number;
  };
};

const EXPECTED_HEADERS: Record<GoogleSheetLayoutKey, readonly string[]> = {
  registrations: ['Data da inscrição', 'Status', 'Nome', 'CPF parcial', 'WhatsApp', 'E-mail', 'Sexo', 'Distância', 'Camisa', 'Lote', 'Valor', 'Método de pagamento', 'ID da inscrição', 'ID do pagamento'],
  payments: ['Data', 'ID da inscrição', 'ID do pagamento', 'Status', 'Método', 'Valor', 'Gateway', 'Transaction ID'],
  shirts: ['Tamanho', 'Quantidade'],
  check_in: ['Nome', 'CPF parcial', 'Distância', 'Camisa', 'Kit entregue', 'Horário', 'Responsável', 'ID da inscrição'],
  lots: ['Lote', 'Capacidade', 'Pagas', 'Reservadas', 'Disponíveis', 'Ocupação %', 'Atualizado em'],
  alerts: ['Gravidade', 'Tipo', 'Título', 'Status', 'Origem', 'Responsável', 'Horário', 'ID'],
  partnerships: ['Empresa', 'Contato', 'Cargo', 'E-mail', 'Status', 'Origem', 'Criado em', 'ID'],
  emails: ['Data', 'Inscrição', 'Destinatário', 'Status', 'Provedor', 'Message ID', 'Erro', 'Delivery ID'],
  remarketing: ['person_key', 'registration_id_reference', 'full_name', 'whatsapp', 'email', 'cpf_masked', 'first_registration_at', 'last_registration_at', 'last_payment_attempt_at', 'amount', 'lot', 'distance', 'registration_status', 'payment_status', 'attempt_count', 'checkout_count', 'partner_or_origin', 'remarketing_status', 'eligible', 'suppression_reason', 'last_payment_check_at', 'updated_at'],
  confirmed_payments: ['Data do pagamento', 'Nome completo', 'CPF parcial', 'WhatsApp', 'E-mail', 'Distância', 'Camisa', 'Lote', 'Número de peito', 'Valor pago', 'Meio de pagamento', 'Parceiro', 'Tipo de parceiro', 'Origem de aquisição', 'Cupom', 'Desconto', 'ID da inscrição', 'ID do pagamento', 'Provider'],
};

const LEGACY_HEADERS: Partial<Record<GoogleSheetLayoutKey, readonly string[]>> = {
  emails: ['Data', 'Inscrição', 'Destinatário', 'Status', 'Provedor', 'Message ID', 'Erro'],
};

export function buildLayoutAuditReport(input: {
  mode: 'fixture' | 'remote';
  spreadsheetId?: string | null;
  tabs: LayoutAuditTabInput[];
}): LayoutAuditReport {
  const summary = {
    converged: 0,
    managed_repair: 0,
    legacy_migration: 0,
    drift_detected: 0,
    schema_drift: 0,
    totalPlannedRequests: 0,
  };

  const tabs: LayoutAuditTabReport[] = input.tabs.map((tab) => {
    const expected = EXPECTED_HEADERS[tab.sheetKey];
    const expectedHeaderHash = headerFingerprint(expected) as string;
    const headerHash = headerFingerprint(tab.actualHeader);
    const legacy = LEGACY_HEADERS[tab.sheetKey];
    const legacyHeaderHash = legacy ? headerFingerprint(legacy) : null;

    const schemaDrift = headerHash != null
      && headerHash !== expectedHeaderHash
      && headerHash !== legacyHeaderHash;

    const notes: string[] = [];
    if (headerHash != null && headerHash === legacyHeaderHash) {
      notes.push('legacy_header: accepted historical header for this tab');
    }

    if (schemaDrift) {
      summary.schema_drift += 1;
      return {
        sheetKey: tab.sheetKey,
        sheetTitle: tab.actual.properties?.title ?? null,
        expectedColumnCount: GOOGLE_SHEET_LAYOUTS[tab.sheetKey].columnCount,
        headerHash,
        expectedHeaderHash,
        schemaDrift: true,
        driftStatus: 'schema_drift',
        plan: null,
        remoteMutations: 0,
        notes: [...notes, 'schema_drift: header row does not match the expected or legacy contract; no layout plan computed'],
      };
    }

    const plan = buildGoogleSheetLayoutPlan(
      tab.sheetKey,
      tab.sheetId,
      tab.actual,
      tab.serviceAccountEmail ?? 'service-account@managed.local',
      tab.dataRowCount,
    );
    summary[plan.driftStatus] += 1;
    summary.totalPlannedRequests += plan.plannedRequestCount;

    return {
      sheetKey: tab.sheetKey,
      sheetTitle: tab.actual.properties?.title ?? null,
      expectedColumnCount: GOOGLE_SHEET_LAYOUTS[tab.sheetKey].columnCount,
      headerHash,
      expectedHeaderHash,
      schemaDrift: false,
      driftStatus: plan.driftStatus,
      plan,
      remoteMutations: 0,
      notes: [...notes, ...plan.notes],
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    spreadsheetFingerprint: input.spreadsheetId ? shortFingerprint(input.spreadsheetId) : null,
    remoteMutations: 0,
    tabs,
    summary,
  };
}

export function formatLayoutAuditReport(report: LayoutAuditReport): string {
  const lines: string[] = [];
  lines.push(`GENERATED_AT=${report.generatedAt}`);
  lines.push(`MODE=${report.mode}`);
  lines.push(`SPREADSHEET_FINGERPRINT=${report.spreadsheetFingerprint ?? 'n/a'}`);
  lines.push(`REMOTE_MUTATIONS=${report.remoteMutations}`);
  lines.push('');
  for (const tab of report.tabs) {
    lines.push(`[${tab.sheetKey}] title=${tab.sheetTitle ?? 'n/a'} expected_columns=${tab.expectedColumnCount}`);
    lines.push(`  header_hash=${tab.headerHash ?? 'not-read'} expected=${tab.expectedHeaderHash} schema_drift=${tab.schemaDrift}`);
    lines.push(`  drift_status=${tab.driftStatus}`);
    if (tab.plan) {
      const c = tab.plan.classification;
      lines.push(`  conditional_formats: total=${c.conditionalFormats.total} managed=${c.conditionalFormats.managed} unmanaged=${c.conditionalFormats.unmanaged}`);
      lines.push(`  bandings: total=${c.bandings.total} managed=${c.bandings.managed} legacy=${c.bandings.legacyManaged} unmanaged=${c.bandings.unmanaged}`);
      lines.push(`  basic_filter: ${c.basicFilter}`);
      lines.push(`  protected_ranges: managed_current=${c.protectedRanges.managedCurrent} managed_legacy=${c.protectedRanges.managedLegacy} external=${c.protectedRanges.external}`);
      lines.push(`  PLANNED_REQUESTS=${tab.plan.plannedRequestCount} structural=${tab.plan.structuralRequestCount} kinds=${JSON.stringify(tab.plan.plannedRequestKinds)}`);
      lines.push(`  LEGACY_CONVERGENCE_REQUESTS=${tab.plan.legacyConvergenceRequestCount} (planned only, not sent)`);
    }
    for (const note of tab.notes) lines.push(`  note: ${note}`);
    lines.push('');
  }
  const s = report.summary;
  lines.push(`SUMMARY converged=${s.converged} managed_repair=${s.managed_repair} legacy_migration=${s.legacy_migration} drift_detected=${s.drift_detected} schema_drift=${s.schema_drift}`);
  lines.push(`TOTAL_PLANNED_REQUESTS=${s.totalPlannedRequests}`);
  lines.push(`REMOTE_MUTATIONS=0`);
  return lines.join('\n');
}
