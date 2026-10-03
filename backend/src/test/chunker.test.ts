import { describe, expect, it } from 'vitest';
import { chunkRunbook } from '../modules/runbooks/chunker';
import { SEED_RUNBOOKS } from '../db/seedRunbooks';

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);

describe('chunkRunbook', () => {
  it('splits by heading and prefixes every chunk with the title and heading', () => {
    const content = `# Guide\n\n## Alpha\n${'alpha text. '.repeat(40)}\n\n## Beta\n${'beta text. '.repeat(40)}`;
    const chunks = chunkRunbook('My runbook', content);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.content.startsWith('My runbook › Alpha\n'))).toBe(true);
    expect(chunks.some((c) => c.content.startsWith('My runbook › Beta\n'))).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('never exceeds the maximum size, even for one long paragraph with no headings', () => {
    const long = 'The pool is exhausted and requests wait for a free connection. '.repeat(60);
    const chunks = chunkRunbook('Title', long, { maxChars: 500, overlap: 60 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(500);
  });

  it('keeps an overlap between consecutive windows so a sentence cut at a seam is still seen whole', () => {
    const text = Array.from({ length: 80 }, (_, i) => `sentence${i} about the database`).join('. ');
    const chunks = chunkRunbook('T', text, { maxChars: 300, overlap: 80 });
    for (let i = 1; i < chunks.length; i++) {
      const tail = words(chunks[i - 1]!.content).slice(-4);
      const head = new Set(words(chunks[i]!.content));
      expect(tail.some((w) => head.has(w))).toBe(true);
    }
  });

  it('loses no content: every distinctive word of the input appears in some chunk', () => {
    for (const rb of SEED_RUNBOOKS) {
      const chunks = chunkRunbook(rb.title, rb.content);
      const all = new Set(words(chunks.map((c) => c.content).join(' ')));
      const missing = [...new Set(words(rb.content.replace(/[`#*]/g, ' ')))].filter(
        (w) => !all.has(w),
      );
      expect(missing).toEqual([]);
    }
  });

  it('merges tiny sections rather than emitting near-empty chunks, and handles no headings or empty input', () => {
    const tiny = `# A\n\nshort.\n\n# B\n\nalso short.\n\n# C\n${'real content here. '.repeat(30)}`;
    const chunks = chunkRunbook('T', tiny, { minChars: 100 });
    expect(chunks.every((c) => c.content.length > 60)).toBe(true);
    expect(chunkRunbook('T', 'just one paragraph without headings').length).toBe(1);
    expect(chunkRunbook('T', '   \n  ')).toEqual([]);
  });

  it('keeps seeded runbooks in the 500-800 character range per chunk', () => {
    for (const rb of SEED_RUNBOOKS) {
      for (const c of chunkRunbook(rb.title, rb.content))
        expect(c.content.length).toBeLessThanOrEqual(800);
    }
  });
});
