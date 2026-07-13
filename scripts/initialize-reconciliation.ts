import { randomUUID } from 'node:crypto';
import { persistReconciliationRunInPostgres, transaction, usesPostgresDatabase } from '../server/database';
import { detectLocalReconciliationIssues, generateReconciliationReport } from '../server/payment-reconciliation';

if (!usesPostgresDatabase()) throw new Error('Esta rotina exige Supabase/Postgres.');
const startedAt = new Date().toISOString();
const database = await transaction((current) => current, { persist: false, scope: 'checkout' });
const issues = detectLocalReconciliationIssues(database);
const report = generateReconciliationReport(issues);
const completedAt = new Date().toISOString();

await persistReconciliationRunInPostgres({
  id: randomUUID(), triggerSource: 'phase2_initialization', mode: 'dry_run',
  checkedCount: database.payments.length, correctedCount: 0,
  manualReviewCount: report.manualReviewRequired, errorCount: 0,
  summary: report, startedAt, completedAt, createdBy: 'system:phase2', issues,
});

console.log(JSON.stringify({ success: true, correctedCount: 0, ...report }));
