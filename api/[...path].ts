import type { IncomingMessage, ServerResponse } from 'node:http';

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function createErrorId() {
  return `err_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const { handleApiRequest } = await import('../server/index.ts');
    return await handleApiRequest(req, res);
  } catch (error) {
    const errorId = createErrorId();

    console.error(JSON.stringify({
      at: new Date().toISOString(),
      errorId,
      phase: 'serverless_bootstrap',
      method: req.method,
      path: req.url?.split('?')[0],
      message: error instanceof Error ? error.message : 'Unknown bootstrap error',
      stack: error instanceof Error ? error.stack : undefined,
    }));

    const debugEnabled = process.env.API_DEBUG_ERRORS === 'true';

    writeJson(res, 500, {
      message: 'Erro interno. Nossa equipe ja foi notificada.',
      errorId,
      debug: debugEnabled && error instanceof Error
        ? {
          message: error.message,
          stack: error.stack,
        }
        : undefined,
    });
  }
}
