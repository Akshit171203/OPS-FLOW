import type { Logger } from 'pino';
import type { ApiKeyScope } from '@opsflow/shared';
import type { AuthContext } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      auth?: AuthContext;
      /** Set when the request was authenticated with an API key instead of a session. */
      apiKey?: { id: string; name: string; scopes: ApiKeyScope[]; serviceId: string | null };
    }
  }
}

export {};
