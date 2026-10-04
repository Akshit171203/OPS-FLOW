import { Fragment } from 'react';

/** `code` and **bold** inside a line. Everything is rendered as React text, never as HTML. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 2 ? (
          <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; text: string };

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) code.push(lines[i]!);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: 'h', level: h[1]!.length, text: h[2]! });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      const re = ul ? /^\s*[-*]\s+(.*)$/ : /^\s*\d+[.)]\s+(.*)$/;
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        items.push(m[1]!);
      }
      i--;
      blocks.push({ kind, items });
      continue;
    }
    const para: string[] = [line];
    while (
      i + 1 < lines.length &&
      lines[i + 1]!.trim() &&
      !/^(#{1,4}\s|\s*[-*]\s|\s*\d+[.)]\s|```)/.test(lines[i + 1]!)
    )
      para.push(lines[++i]!);
    blocks.push({ kind: 'p', text: para.join(' ') });
  }
  return blocks;
}

const headingClass = [
  '',
  'text-xl font-semibold mt-6',
  'text-lg font-semibold mt-6',
  'text-base font-semibold mt-4',
  'text-sm font-semibold mt-4',
];

/** A small, dependency-free markdown view for runbooks: headings, paragraphs, lists, code. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink">
      {parse(source).map((b, i) => {
        if (b.kind === 'h') {
          const Tag = `h${Math.min(b.level + 1, 6)}` as 'h2' | 'h3' | 'h4' | 'h5';
          return (
            <Tag key={i} className={headingClass[b.level]}>
              <Inline text={b.text} />
            </Tag>
          );
        }
        if (b.kind === 'p')
          return (
            <p key={i}>
              <Inline text={b.text} />
            </p>
          );
        if (b.kind === 'code') {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-md bg-[#0d0d10] p-3 font-mono text-xs text-slate-100"
            >
              {b.text}
            </pre>
          );
        }
        const List = b.kind === 'ul' ? 'ul' : 'ol';
        return (
          <List
            key={i}
            className={`space-y-1 pl-5 ${b.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}
          >
            {b.items.map((it, j) => (
              <li key={j}>
                <Inline text={it} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
