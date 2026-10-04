'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface Point {
  label: string;
  value: number;
}

/**
 * Small area chart on the design tokens. Colours are CSS variables, so it follows the theme with no
 * extra work. The wrapper carries a text alternative because the SVG itself is not readable by a screen reader.
 */
export function AreaTrend({
  data,
  height = 180,
  unit = '',
  summary,
  color = 'var(--color-accent-ink)',
  id,
  decimals = 0,
}: {
  data: Point[];
  height?: number;
  unit?: string;
  summary: string;
  color?: string;
  id: string;
  decimals?: number;
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={summary} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--color-ink-subtle)', fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            {...(decimals === 0
              ? { domain: [0, Math.max(max, 1)], tickCount: Math.min(Math.max(max, 1), 4) + 1 }
              : {})}
            allowDecimals={decimals > 0}
            width={44}
            tick={{ fill: 'var(--color-ink-subtle)', fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--color-line-strong)', strokeDasharray: '3 3' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-xl">
                  <p className="text-ink-subtle">{label}</p>
                  <p className="mt-0.5 font-semibold tabular-nums text-ink">
                    {Number(payload[0]!.value).toFixed(decimals)}
                    {unit}
                  </p>
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#fill-${id})`}
            activeDot={{ r: 4, strokeWidth: 0, fill: color }}
            isAnimationActive
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
