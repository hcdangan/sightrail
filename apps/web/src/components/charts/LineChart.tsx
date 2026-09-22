import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/primitives';

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
  type?: 'line' | 'area';
}

const AXIS_STYLE = {
  fontSize: 10,
  fill: '#7c8ab0',
  fontFamily: 'JetBrains Mono, monospace',
} as const;

const GRID_COLOR = 'rgba(43,58,104,0.45)';

function ChartTooltip() {
  return (
    <Tooltip
      contentStyle={{
        background: 'rgba(8,12,26,0.95)',
        border: '1px solid rgba(43,58,104,0.8)',
        borderRadius: 10,
        fontSize: 11,
        color: '#e6ebf7',
      }}
      labelStyle={{ color: '#94a3b8', fontSize: 10 }}
      itemStyle={{ fontSize: 11 }}
    />
  );
}

/** Multi-series line/area chart used by training, tracking and latency views. */
export function LineChart({
  data,
  xKey,
  series,
  height = 240,
  emptyMessage = 'No data yet.',
  className,
  showLegend = true,
}: {
  data: Record<string, number | string | null | undefined>[];
  xKey: string;
  series: SeriesSpec[];
  height?: number;
  emptyMessage?: string;
  className?: string;
  showLegend?: boolean;
}) {
  const usable = data.filter((row) => series.some((entry) => typeof row[entry.key] === 'number'));
  if (usable.length === 0) {
    return <EmptyState className={cn('h-40', className)} title={emptyMessage} />;
  }

  const hasArea = series.some((entry) => entry.type === 'area');

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {hasArea ? (
          <AreaChart data={usable} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <defs>
              {series.map((entry) => (
                <linearGradient key={entry.key} id={`grad-${entry.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={entry.color} stopOpacity={0.45} />
                  <stop offset="95%" stopColor={entry.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
            <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={46} />
            {ChartTooltip()}
            {showLegend && <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />}
            {series.map((entry) => (
              <Area
                key={entry.key}
                type="monotone"
                dataKey={entry.key}
                name={entry.label}
                stroke={entry.color}
                fill={`url(#grad-${entry.key})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : (
          <ReLineChart data={usable} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
            <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={46} />
            {ChartTooltip()}
            {showLegend && <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />}
            {series.map((entry) => (
              <Line
                key={entry.key}
                type="monotone"
                dataKey={entry.key}
                name={entry.label}
                stroke={entry.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </ReLineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal/vertical bar chart for class distributions and comparisons. */
export function BarChartView({
  data,
  xKey,
  series,
  height = 240,
  layout = 'vertical',
  emptyMessage = 'No data yet.',
  className,
  highlightMax,
}: {
  data: Record<string, number | string>[];
  xKey: string;
  series: SeriesSpec[];
  height?: number;
  layout?: 'vertical' | 'horizontal';
  emptyMessage?: string;
  className?: string;
  highlightMax?: boolean;
}) {
  if (data.length === 0) {
    return <EmptyState className={cn('h-40', className)} title={emptyMessage} />;
  }

  const maxValue = highlightMax
    ? Math.max(...data.flatMap((row) => series.map((entry) => Number(row[entry.key]) || 0)))
    : null;

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={layout}
          margin={{ top: 6, right: 12, bottom: 0, left: layout === 'vertical' ? 12 : -18 }}
        >
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={layout === 'horizontal'} horizontal={layout === 'vertical'} />
          {layout === 'vertical' ? (
            <>
              <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: GRID_COLOR }} width={110} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={46} />
            </>
          )}
          {ChartTooltip()}
          {series.map((entry) => (
            <Bar key={entry.key} dataKey={entry.key} name={entry.label} fill={entry.color} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {highlightMax &&
                maxValue !== null &&
                data.map((row, index) => (
                  <Cell
                    key={index}
                    fill={entry.color}
                    fillOpacity={Number(row[entry.key]) >= maxValue ? 1 : 0.45}
                  />
                ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
