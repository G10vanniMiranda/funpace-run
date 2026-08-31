import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../../server/index.js';

// ADMIN-UX-HOTFIX-002 — explicit Vercel filesystem function for a nested Admin
// route. A thin adapter: all auth / validation / business logic stays in the
// canonical router (handleApiRequest). Needed because a catch-all
// (api/admin/[...path].ts) is only routed one segment deep on this deployment.
export const runtime = 'nodejs';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleApiRequest(req, res);
}
