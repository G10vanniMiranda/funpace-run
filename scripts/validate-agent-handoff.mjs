#!/usr/bin/env node
// Offline, deterministic validator for a FUNPACE agent handoff document.
// No network, no filesystem beyond the file argument, no production/provider
// access, no secrets required.
//
// Usage:
//   node scripts/validate-agent-handoff.mjs <path-to-handoff.md> [--template]
//
// --template : structure + secret/PII checks only (for HANDOFF.template.md,
//              whose action sections are guidance comments, not filled values).
//
// Exit code 0 = valid, 1 = invalid or usage error.

import { readFileSync } from 'node:fs';

const REQUIRED_SECTIONS = [
  'MISSION',
  'OBJECTIVE',
  'PHASE',
  'STATUS',
  'CHECKPOINT',
  'SOURCE OF TRUTH',
  'BRANCH',
  'HEAD',
  'BASE SHA',
  'PRODUCTION SHA',
  'WORKTREE',
  'DIRTY TREE',
  'PROTECTED PATHS',
  'MUTATION LEDGER',
  'AUTHORIZATION STATE',
  'TESTS',
  'CI',
  'DEPLOYMENT',
  'BLOCKERS',
  'UNKNOWN',
  'HUMAN GATES',
  'ROLLBACK',
  'NEXT SAFE ACTION',
  'DO NOT REPEAT',
  'REFERENCES',
];

const VALID_STATUS = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'BLOCKED',
  'HUMAN_GATE',
  'READY_TO_CONTINUE',
  'READY_TO_RELEASE',
  'RELEASED',
  'VERIFIED',
  'ABORTED',
];

const VALID_AUTH = [
  'AUTHORIZED',
  'NOT_AUTHORIZED',
  'REQUIRES_HUMAN_GATE',
  'EXPIRED_AUTHORIZATION',
  'UNKNOWN',
];

const LEDGER_DOMAINS = [
  'GIT',
  'GITHUB',
  'DATABASE',
  'PAYMENT',
  'EMAIL',
  'SHEETS',
  'META',
  'VERCEL',
  'SUPABASE',
  'FILESYSTEM',
  'OTHER',
];
const LEDGER_STATES = ['NONE', 'READ_ONLY', 'MUTATED', 'UNKNOWN'];

// Secret / PII patterns. Each is [label, RegExp]. Applied to the whole document
// including comments: a template must be clean too.
const FORBIDDEN = [
  ['postgres connection string', /\bpostgres(?:ql)?:\/\/\S+/i],
  ['private key block', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ['openai-style key', /\bsk-[A-Za-z0-9]{20,}\b/],
  ['stripe secret key', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['resend api key', /\bre_[A-Za-z0-9]{16,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/],
  ['github token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ['github fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['gitlab token', /\bglpat-[A-Za-z0-9_-]{16,}\b/],
  ['aws access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['bearer authorization header', /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/-]{12,}/i],
  ['cpf', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ['br phone number', /\+55\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/],
  ['personal email', /\b[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|icloud|live|proton)\.[A-Za-z.]{2,}\b/i],
  ['windows user path', /[A-Za-z]:\\Users\\[^\\\s<]+/],
  ['unix home path', /\/(?:Users|home)\/(?!<)[a-z0-9._-]+\//i],
  ['env var with inline value', /\b(?:DATABASE_URL|RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY|VERCEL_TOKEN|INFINITEPAY_[A-Z_]+|META_[A-Z_]*TOKEN|GOOGLE_PRIVATE_KEY)\s*=\s*(?!YES\b|NO\b|<)[^\s]/],
];

function sectionBodies(text) {
  const lines = text.split(/\r?\n/);
  const bodies = new Map();
  let current = null;
  let buf = [];
  const flush = () => {
    if (current !== null) bodies.set(current, buf.join('\n'));
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1].trim().toUpperCase();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return bodies;
}

function stripComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '').trim();
}

export function validateHandoff(text, { template = false } = {}) {
  const errors = [];
  const warnings = [];

  // 1. secret / PII scan (always)
  for (const [label, re] of FORBIDDEN) {
    if (re.test(text)) errors.push(`forbidden content: ${label}`);
  }

  // 2. required sections present
  const bodies = sectionBodies(text);
  for (const s of REQUIRED_SECTIONS) {
    if (!bodies.has(s)) errors.push(`missing required section: ## ${s}`);
  }

  // 3. STATUS token
  const statusBody = stripComments(bodies.get('STATUS') || '');
  const statusTokens = statusBody.match(/[A-Z_]{4,}/g) || [];
  const statusHit = statusTokens.filter((t) => VALID_STATUS.includes(t));
  if (!template || statusBody.length > 0) {
    if (statusHit.length !== 1) {
      errors.push(
        `STATUS must contain exactly one of ${VALID_STATUS.join(', ')} (found: ${statusHit.join(', ') || 'none'})`,
      );
    }
  }

  // 4. AUTHORIZATION STATE token (only when filled)
  const authBody = stripComments(bodies.get('AUTHORIZATION STATE') || '');
  if (authBody.length > 0) {
    const authHit = (authBody.match(/[A-Z_]{5,}/g) || []).filter((t) => VALID_AUTH.includes(t));
    if (authHit.length < 1) {
      warnings.push(`AUTHORIZATION STATE should name one of ${VALID_AUTH.join(', ')}`);
    }
  } else if (!template) {
    errors.push('AUTHORIZATION STATE is empty');
  }

  // 5. MUTATION LEDGER domains + states
  const ledgerBody = bodies.get('MUTATION LEDGER') || '';
  for (const d of LEDGER_DOMAINS) {
    const line = new RegExp(`(^|\\n)\\s*[-*]?\\s*${d}\\s*:\\s*(.*)`, 'i').exec(ledgerBody);
    if (!line) {
      errors.push(`MUTATION LEDGER missing domain: ${d}`);
      continue;
    }
    if (template) continue;
    const val = stripComments(line[2] || '').trim();
    const state = (val.match(/[A-Z_]{4,}/) || [])[0];
    if (!state || !LEDGER_STATES.includes(state)) {
      errors.push(`MUTATION LEDGER ${d} must be one of ${LEDGER_STATES.join(', ')} (found: ${val || 'empty'})`);
    }
  }

  // 6. NEXT SAFE ACTION and DO NOT REPEAT must have real content (non-template)
  for (const s of ['NEXT SAFE ACTION', 'DO NOT REPEAT']) {
    const body = stripComments(bodies.get(s) || '');
    if (!template && body.replace(/[-*\s]/g, '').length === 0) {
      errors.push(`${s} is required and must not be empty`);
    }
    if (!template && /^continue( work| the work)?\.?$/i.test(body)) {
      errors.push(`${s} must be a concrete executable instruction, not "continue work"`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function main(argv) {
  const args = argv.slice(2);
  const template = args.includes('--template');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    process.stderr.write('usage: node scripts/validate-agent-handoff.mjs <handoff.md> [--template]\n');
    process.exit(1);
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    process.stderr.write(`cannot read ${path}: ${err.message}\n`);
    process.exit(1);
  }
  const { ok, errors, warnings } = validateHandoff(text, { template });
  for (const w of warnings) process.stdout.write(`warning: ${w}\n`);
  for (const e of errors) process.stdout.write(`error: ${e}\n`);
  process.stdout.write(ok ? `ok: ${path} is a valid handoff${template ? ' template' : ''}\n` : `FAILED: ${errors.length} error(s)\n`);
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('validate-agent-handoff.mjs')) {
  main(process.argv);
}
