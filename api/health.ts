import type { IncomingMessage, ServerResponse } from 'node:http';

export const runtime = 'nodejs';

function setHeaders(req: IncomingMessage, res: ServerResponse) {
  const allowedOrigins = [
    'https://funpace.club',
    'https://www.funpace.club',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-ID');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  setHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    writeJson(res, 405, { message: 'Metodo nao permitido.' });
    return;
  }

  writeJson(res, 200, {
    status: 'ok',
    service: 'funpace-run',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    timestamp: new Date().toISOString(),
  });
}
