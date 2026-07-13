import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

function run(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('vercel', args, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(output)));
    child.stdin.end(input);
  });
}

await run(['env', 'rm', 'CRON_SECRET', 'production', '--yes']);
const output = await run(['env', 'add', 'CRON_SECRET', 'production'], randomBytes(32).toString('hex'));
console.log(output.replace(/\r?\n/g, ' ').trim());
