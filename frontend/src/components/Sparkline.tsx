interface Point {
  t: number;
  v: number;
}

/**
 * A small dependency-free line chart. It exists to show one thing at a glance: the shape of a metric
 * over time (for example the spike when a bad deploy goes out). It is a labelled image for assistive
 * tech, with the min, max and latest values in text beside it.
 */
export function Sparkline({
  points,
  label,
  format,
  height = 64,
  stroke = 'var(--color-accent-600)',
}: {
  points: Point[];
  label: string;
  format: (v: number) => string;
  height?: number;
  stroke?: string;
}) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-ink-subtle">Not enough data to draw {label.toLowerCase()} yet.</p>
    );
  }
  const W = 300;
  const pad = 4;
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  const [lo, hi] = [Math.min(...vs), Math.max(...vs)];
  const x = (t: number) => pad + ((t - t0) / (t1 - t0 || 1)) * (W - pad * 2);
  const y = (v: number) => height - pad - ((v - lo) / (hi - lo || 1)) * (height - pad * 2);
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join(' ');
  const area = `${line} L${x(t1).toFixed(1)} ${height - pad} L${x(t0).toFixed(1)} ${height - pad} Z`;
  const last = points[points.length - 1]!;

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: latest ${format(last.v)}, low ${format(lo)}, high ${format(hi)}`}
        className="h-16 w-full"
      >
        <path d={area} fill={stroke} opacity="0.1" />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(last.t)} cy={y(last.v)} r="3" fill={stroke} />
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-ink-subtle">
        <span>low {format(lo)}</span>
        <span>high {format(hi)}</span>
      </figcaption>
    </figure>
  );
}
