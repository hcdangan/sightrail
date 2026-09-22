import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Pause, Play, Search, Trash2 } from 'lucide-react';

import type { JobProgressEvent } from '@/lib/api-types';
import { cn, formatClock, formatPercent } from '@/lib/utils';
import { Button, ProgressBar } from './primitives';

const LEVEL_STYLES: Record<JobProgressEvent['level'], string> = {
  debug: 'text-slate-500',
  info: 'text-slate-300',
  warning: 'text-warning-400',
  error: 'text-danger-400',
};

/**
 * Live console for a background job.
 *
 * Renders the structured event stream (logs, progress, metrics) with an optional
 * raw-stdout view, autoscroll that pauses when the user scrolls up, a text
 * filter, and a one-click `.log` export.
 */
export function LogConsole({
  events,
  percent,
  status,
  className,
  autoScroll = true,
  height = 'h-72',
}: {
  events: JobProgressEvent[];
  percent?: number;
  status?: string;
  className?: string;
  autoScroll?: boolean;
  height?: string;
}) {
  const [follow, setFollow] = useState(autoScroll);
  const [query, setQuery] = useState('');
  const [showMetrics, setShowMetrics] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (event.kind === 'progress' && showMetrics) return false;
      if (!needle) return true;
      return event.message.toLowerCase().includes(needle);
    });
  }, [events, query, showMetrics]);

  useEffect(() => {
    if (!follow) return;
    const node = containerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [filtered, follow]);

  const running = status === 'running' || status === 'queued';

  const downloadLogs = () => {
    const text = events
      .map((event) => `[${formatClock(event.timestamp)}] ${event.kind.toUpperCase()} ${event.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'job.log';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter output…"
            className="h-8 w-full rounded-lg border border-ink-600/80 bg-ink-900/80 pr-2 pl-8 font-mono text-xs text-slate-200 placeholder:text-slate-500 focus:border-brand-400/70 focus:outline-none"
          />
        </div>
        <Button
          size="sm"
          variant={follow ? 'secondary' : 'outline'}
          icon={follow ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          onClick={() => setFollow((value) => !value)}
        >
          {follow ? 'Following' : 'Paused'}
        </Button>
        <Button
          size="sm"
          variant={showMetrics ? 'secondary' : 'ghost'}
          onClick={() => setShowMetrics((value) => !value)}
          title="Hide raw epoch/progress rows"
        >
          {showMetrics ? 'Raw on' : 'Raw off'}
        </Button>
        <Button size="sm" variant="ghost" icon={<ArrowDownToLine className="size-3.5" />} onClick={downloadLogs}>
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 className="size-3.5" />}
          onClick={() => setQuery('')}
          title="Clear filter"
        />
      </div>

      {percent !== undefined && (
        <div className="flex items-center gap-3">
          <ProgressBar value={percent} tone={status === 'failed' ? 'danger' : status === 'succeeded' ? 'success' : 'brand'} indeterminate={running && percent === 0} />
          <span className="w-14 shrink-0 text-right font-mono text-[11px] text-slate-400">{formatPercent(percent)}</span>
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
          if (!atBottom && follow) setFollow(false);
        }}
        className={cn(
          'overflow-y-auto rounded-xl border border-ink-700/70 bg-ink-950/80 p-3 font-mono text-[11px] leading-relaxed',
          height,
        )}
      >
        {filtered.length === 0 ? (
          <p className="text-slate-500">{events.length === 0 ? 'Waiting for output…' : 'No lines match the filter.'}</p>
        ) : (
          filtered.map((event) => (
            <div key={event.seq} className="flex gap-2">
              <span className="shrink-0 text-slate-600 select-none">{formatClock(event.timestamp)}</span>
              <span className={cn('min-w-0 break-all whitespace-pre-wrap', LEVEL_STYLES[event.level])}>
                {event.kind === 'progress' && <span className="text-brand-400">{formatPercent(event.percent ?? 0, 0)} </span>}
                {event.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
