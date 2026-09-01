import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../server/index.js';

// EMAIL-OPS-003 Stage 2 — explicit Vercel function for the Resend delivery
// lifecycle webhook. A thin adapter: signature verification, normalization,
// idempotency and the narrow ingestion transaction all live in the canonical
// router (handleApiRequest -> handleResendWebhook).
export const runtime = 'nodejs';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleApiRequest(req, res);
}
