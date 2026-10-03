import type { Logger } from 'pino';
import type { AuthContext } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      auth?: AuthContext;
    }
  }
}

export {};
