import { describe, expect, it } from 'vitest';
import { incidentStatuses, incidentTransitions, type IncidentStatus } from '@opsflow/shared';
import { ConflictError } from '../lib/errors';
import { assertTransition, canTransition } from '../modules/incidents/stateMachine';

const valid: [IncidentStatus, IncidentStatus][] = [
  ['OPEN', 'INVESTIGATING'],
  ['INVESTIGATING', 'MITIGATING'],
  ['INVESTIGATING', 'RESOLVED'],
  ['MITIGATING', 'RESOLVED'],
  ['RESOLVED', 'CLOSED'],
];

const invalid = incidentStatuses.flatMap((from) =>
  incidentStatuses
    .filter((to) => !valid.some(([f, t]) => f === from && t === to))
    .map((to) => [from, to] as [IncidentStatus, IncidentStatus]),
);

describe('incident state machine', () => {
  it.each(valid)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(invalid)('rejects %s -> %s with INVALID_STATUS_TRANSITION', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    try {
      assertTransition(from, to);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).statusCode).toBe(409);
      expect((err as ConflictError).code).toBe('INVALID_STATUS_TRANSITION');
      expect((err as ConflictError).details).toEqual({
        from,
        to,
        allowed: incidentTransitions[from],
      });
    }
  });

  it('covers every ordered pair exactly once', () => {
    expect(valid.length + invalid.length).toBe(incidentStatuses.length ** 2);
  });
});
