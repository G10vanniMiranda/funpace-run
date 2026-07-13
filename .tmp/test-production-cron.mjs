import { readFileSync } from 'node:fs';
const line = readFileSync('.tmp/vercel-production.env', 'utf8').split(/\r?\n/).find((item) => item.startsWith('CRON_SECRET='));
const secret = line?.slice('CRON_SECRET='.length).replace(/^"|"$/g, '').replaceAll('\\n', '').trim();
if (!secret) throw new Error('CRON_SECRET missing from pulled environment.');
const response = await fetch('https://www.funpace.club/api/cron/payments', { headers: { Authorization: `Bearer ${secret}` } });
console.log(JSON.stringify({ status: response.status, body: await response.json().catch(() => null) }));
if (!response.ok) process.exitCode = 1;
