import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen({ host: '0.0.0.0', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

const requiredPorts = [3000, 3001];
const unavailablePorts = [];

for (const port of requiredPorts) {
  if (!await isPortAvailable(port)) unavailablePorts.push(port);
}

if (unavailablePorts.length > 0) {
  console.error(`Nao foi possivel iniciar: ${unavailablePorts.map((port) => `a porta ${port} ja esta em uso`).join(' e ')}.`);
  console.error('Encerre a instancia anterior do ambiente local e execute npm run dev novamente.');
  process.exit(1);
}

function spawnNpmScript(script) {
  const options = { stdio: 'inherit', windowsHide: true };
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    return spawn(process.execPath, [npmExecPath, 'run', script], options);
  }

  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm run ${script}`], options);
  }

  return spawn('npm', ['run', script], options);
}

const processes = [
  spawnNpmScript('api'),
  spawnNpmScript('dev:web'),
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error(`Falha ao iniciar o ambiente local: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    if (signal || code === 0) stop(0);
    else stop(code || 1);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
