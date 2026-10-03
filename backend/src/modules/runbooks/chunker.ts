export interface Chunk {
  index: number;
  content: string;
}

export interface ChunkOptions {
  maxChars: number;
  overlap: number;
  minChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 800, overlap: 80, minChars: 200 };

interface Section {
  heading: string;
  body: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;

function sections(content: string): Section[] {
  const out: Section[] = [];
  let current: Section = { heading: '', body: '' };
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const m = HEADING.exec(line);
    if (m) {
      if (current.body.trim() || current.heading) out.push(current);
      current = { heading: m[2]!.trim(), body: '' };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.body.trim() || current.heading) out.push(current);
  return out.map((s) => ({ heading: s.heading, body: s.body.trim() }));
}

/** Break `text` into windows of at most `max` characters, preferring paragraph, then sentence, then word boundaries. */
function windows(text: string, max: number, overlap: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + max, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const cut = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('. ') + 1,
        slice.lastIndexOf('\n'),
      );
      const space = slice.lastIndexOf(' ');
      const best = cut > max * 0.5 ? cut : space > max * 0.5 ? space : slice.length;
      end = start + best;
    }
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    // Next window starts a little before this one ended, at a word boundary, so context is not lost at the seam
    let next = Math.max(end - overlap, start + 1);
    const space = text.indexOf(' ', next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }
  return out.filter(Boolean);
}

/**
 * Split a runbook into chunks for embedding: by heading first, merging tiny sections, then into
 * windows of at most `maxChars` with a small overlap. Every chunk starts with "Title › Heading" so it
 * still makes sense when retrieved on its own, and no chunk exceeds `maxChars` including that prefix.
 */
export function chunkRunbook(
  title: string,
  content: string,
  options: Partial<ChunkOptions> = {},
): Chunk[] {
  const { maxChars, overlap, minChars } = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const secs = sections(content);

  // Merge sections too small to stand alone into the next one
  const merged: Section[] = [];
  let carry: Section | null = null;
  for (const s of secs) {
    // A heading with no text of its own (such as a document title) adds nothing: the next section keeps its own heading
    if (carry && carry.body === '') carry = null;
    const joined: Section = carry
      ? {
          heading: carry.heading || s.heading,
          body: `${carry.body}\n\n${s.heading ? `${s.heading}\n` : ''}${s.body}`.trim(),
        }
      : s;
    if (joined.body.length < minChars) carry = joined;
    else {
      merged.push(joined);
      carry = null;
    }
  }
  if (carry) merged.push(carry);

  const chunks: Chunk[] = [];
  for (const s of merged) {
    const prefix = `${title}${s.heading ? ` › ${s.heading}` : ''}\n`;
    const budget = Math.max(100, maxChars - prefix.length);
    for (const w of windows(s.body, budget, Math.min(overlap, Math.floor(budget / 4)))) {
      chunks.push({ index: chunks.length, content: `${prefix}${w}` });
    }
  }
  return chunks;
}
