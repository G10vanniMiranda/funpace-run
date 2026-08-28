import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { validateHandoff } from '../scripts/validate-agent-handoff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(here, '../.agents/handoff/HANDOFF.template.md');
const template = readFileSync(templatePath, 'utf8');

const GOOD_INSTANCE = `# FUNPACE Mission Handoff

## MISSION
RELEASE-99 example
## OBJECTIVE
Ship a one-line docs fix; done when merged to main and Production == main.
## PHASE
PR open
## STATUS
IN_PROGRESS
## CHECKPOINT
Branch pushed, PR #99 opened, quality-gate running.
## SOURCE OF TRUTH
GitHub main.
## BRANCH
docs/example
## HEAD
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
## BASE SHA
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
## PRODUCTION SHA
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
## WORKTREE
.tmp/worktrees/release-99
## DIRTY TREE
docs/example.md | task
## PROTECTED PATHS
server/database.ts | MODIFIED | PROTECTED_WIP | 0000000000000000000000000000000000000000000000000000000000000000
## MUTATION LEDGER
- GIT: MUTATED — 1 commit on docs/example, reversible via revert
- GITHUB: MUTATED — PR #99 open
- DATABASE: NONE
- PAYMENT: NONE
- EMAIL: NONE
- SHEETS: NONE
- META: NONE
- VERCEL: READ_ONLY
- SUPABASE: NONE
- FILESYSTEM: READ_ONLY
- OTHER: NONE
## AUTHORIZATION STATE
AUTHORIZED — merge PR #99 once quality-gate is green.
## TESTS
278 pass / 0 fail (local, Node 22)
## CI
quality-gate run 123, event pull_request, in_progress; PR #99
## DEPLOYMENT
none yet
## BLOCKERS
None
## UNKNOWN
None
## HUMAN GATES
None
## ROLLBACK
Revert the squash commit; mechanism git revert; owner operator.
## NEXT SAFE ACTION
Wait for quality-gate on PR #99; if green and base is up to date, squash-merge.
## DO NOT REPEAT
- Do not re-open PR #99.
- Do not run vercel --prod.
## REFERENCES
https://github.com/example/repo/pull/99
`;

/** Replace the body of a `## NAME` section, up to the next `## ` heading or EOF. */
function replaceSection(text: string, name: string, newBody: string): string {
  const re = new RegExp(`(##\\s+${name}\\n)[\\s\\S]*?(?=\\n## |\\s*$)`);
  return text.replace(re, `$1${newBody}`);
}

test('HANDOFF.template.md passes in --template mode', () => {
  const r = validateHandoff(template, { template: true });
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('a well-formed filled instance passes full validation', () => {
  const r = validateHandoff(GOOD_INSTANCE);
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('missing NEXT SAFE ACTION fails', () => {
  const bad = replaceSection(GOOD_INSTANCE, 'NEXT SAFE ACTION', '\n');
  const r = validateHandoff(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('NEXT SAFE ACTION')));
});

test('missing DO NOT REPEAT fails', () => {
  const bad = replaceSection(GOOD_INSTANCE, 'DO NOT REPEAT', '\n');
  const r = validateHandoff(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('DO NOT REPEAT')));
});

test('"continue work" is rejected as NEXT SAFE ACTION', () => {
  const bad = replaceSection(GOOD_INSTANCE, 'NEXT SAFE ACTION', 'continue work\n');
  const r = validateHandoff(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes('continue work')));
});

test('invalid STATUS fails', () => {
  const bad = GOOD_INSTANCE.replace('## STATUS\nIN_PROGRESS', '## STATUS\nALMOST_DONE');
  const r = validateHandoff(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('STATUS')));
});

test('a token-shaped secret is rejected (synthetic value)', () => {
  const bad = GOOD_INSTANCE.replace(
    '## REFERENCES\n',
    '## REFERENCES\ntoken ghp_' + 'A'.repeat(36) + '\n',
  );
  const r = validateHandoff(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('github token')));
});

test('a CPF-shaped value is rejected (synthetic value)', () => {
  const bad = GOOD_INSTANCE.replace('## BLOCKERS\nNone', '## BLOCKERS\nperson 123.456.789-00');
  const r = validateHandoff(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('cpf')));
});

test('a missing mutation-ledger domain fails', () => {
  const bad = GOOD_INSTANCE.replace('- SHEETS: NONE\n', '');
  const r = validateHandoff(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('SHEETS')));
});

test('a missing required section fails', () => {
  const bad = GOOD_INSTANCE.replace(/## ROLLBACK\n[^#]*/, '');
  const r = validateHandoff(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('ROLLBACK')));
});
