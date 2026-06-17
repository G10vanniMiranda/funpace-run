import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../server/index';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleApiRequest(req, res);
}
