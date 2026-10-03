import { describe, expect, it } from 'vitest';
import { extractJson, parseAnalysis } from '../modules/ai/output';

const valid = {
  summary: 'Pool exhausted after a rollout.',
  possibleCauses: [
    {
      cause: 'Connection pool exhaustion',
      confidence: 0.8,
      evidence: ['log: Connection pool exhausted'],
    },
  ],
  suggestedSteps: ['Roll back v2.4.0 (requires human approval)'],
  overallConfidence: 0.75,
};

describe('parseAnalysis', () => {
  it('accepts plain JSON, fenced JSON, and JSON surrounded by prose', () => {
    const json = JSON.stringify(valid);
    expect(parseAnalysis(json).ok).toBe(true);
    expect(parseAnalysis('```json\n' + json + '\n```').ok).toBe(true);
    expect(parseAnalysis('```\n' + json + '\n```').ok).toBe(true);
    expect(parseAnalysis(`Here is my analysis:\n${json}\nHope that helps!`).ok).toBe(true);
    expect(extractJson('  {"a":1}  ')).toBe('{"a":1}');
  });

  it('rejects text that is not JSON, with a reason that can be fed back to the model', () => {
    const r = parseAnalysis('I think the database is the problem.');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/not valid JSON/);
    expect(parseAnalysis('{"summary": "cut off').ok).toBe(false);
  });

  it.each([
    ['missing summary', { ...valid, summary: undefined }],
    ['empty causes', { ...valid, possibleCauses: [] }],
    [
      'confidence above 1',
      { ...valid, possibleCauses: [{ ...valid.possibleCauses[0], confidence: 1.5 }] },
    ],
    ['confidence below 0', { ...valid, overallConfidence: -0.1 }],
    [
      'cause without evidence',
      { ...valid, possibleCauses: [{ cause: 'x', confidence: 0.5, evidence: [] }] },
    ],
    ['no steps', { ...valid, suggestedSteps: [] }],
    ['wrong type', { ...valid, overallConfidence: 'high' }],
    [
      'too many causes',
      { ...valid, possibleCauses: Array.from({ length: 6 }, () => valid.possibleCauses[0]) },
    ],
  ])('rejects valid JSON with the wrong shape: %s', (_name, body) => {
    const r = parseAnalysis(JSON.stringify(body));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/did not match the required shape/);
  });

  it('strips unknown extra fields rather than passing them through', () => {
    const r = parseAnalysis(JSON.stringify({ ...valid, hiddenInstruction: 'do bad things' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).not.toHaveProperty('hiddenInstruction');
  });
});
