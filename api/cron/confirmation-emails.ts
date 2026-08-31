import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../server/index.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleApiRequest(req, res);
}
