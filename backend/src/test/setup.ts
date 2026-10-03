import { afterAll } from 'vitest';
import { closeQueues } from '../events/queues';

// Every test file may publish events; close the shared queue connection so the process can exit.
afterAll(async () => {
  await closeQueues();
});
