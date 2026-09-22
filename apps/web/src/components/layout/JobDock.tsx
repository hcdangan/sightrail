import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, CircleX, RefreshCw, X } from 'lucide-react';

import { jobsApi } from '@/lib/api';
import type { JobSummary } from '@/lib/api-types';
import { toast } from '@/lib/stores/toasts';
import { cn, formatDuration } from '@/lib/utils';
import { LogConsole } from '@/components/ui/LogConsole';
import { useJobStream } from '@/lib/hooks/useWebSockets';
import { Badge, Button, EmptyState, ProgressBar } from '@/components/ui/primitives';

const STATUS_TONE: Record<JobSummary['status'], 'brand' | 'success' | 'danger' | 'warning' | 'neutral'> = {
  queued: 'neutral',
  running: 'brand',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

/**
 * Bottom dock for background work.
 *
 * Collapsed it shows a slim strip of active jobs; expanded it becomes the live
 * console (same component the Jobs page uses) wired to the job WebSocket.
 */
export function JobDock({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: jobs } = useQuery({
    queryKey: ['jobs', 'recent'],
    queryFn: () => jobsApi.list(),
    refetchInterval: open ? false : 4000,
  });

  const activeJobs = (jobs ?? []).filter((job) => job.status === 'running' || job.status === 'queued');
  const current = jobs?.find((job) => job.id === selected) ?? activeJobs[0] ?? jobs?.[0] ?? null;
  const stream = useJobStream(open && current ? current.id : null);

  const cancel = useMutation({
    mutationFn: (id: string) => jobsApi.cancel(id),
    onSuccess: () => {
      toast.warning('Cancellation requested', 'The job will stop after the current step.');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const status = stream.summary?.status ?? current?.status ?? 'queued';
  const percent = stream.summary?.percent ?? current?.percent ?? 0;

  return (
    <div
      className={cn(
        'shrink-0 border-t border-ink-800/80 bg-ink-900/85 backdrop-blur-xl transition-[height] duration-200',
        open ? 'h-[340px]' : activeJobs.length > 0 ? 'h-11' : 'h-9',
      )}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex h-9 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-ink-800/50"
      >
        <span className="flex items-center gap-2">
          {activeJobs.length > 0 ? (
            <span className="size-2 animate-pulse-slow rounded-full bg-brand-400" />
          ) : (
            <span className="size-2 rounded-full bg-ink-500" />
          )}
          <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Jobs</span>
          <Badge tone={activeJobs.length > 0 ? 'brand' : 'neutral'}>{activeJobs.length} active</Badge>
        </span>

        {!open && current && (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{current.title}</span>
            <span className="w-32 shrink-0">
              <ProgressBar value={current.percent} />
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[11px] text-slate-500">
              {current.percent.toFixed(0)}%
            </span>
          </span>
        )}
        {!open && !current && (
          <span className="flex-1 text-[11px] text-slate-500">
            No jobs yet — training, validation, export and auto-annotation run here.
          </span>
        )}

        <span className="ml-auto text-slate-500">{open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</span>
      </button>

      {open && (
        <div className="grid h-[calc(340px-2.25rem)] grid-cols-1 gap-3 overflow-hidden border-t border-ink-800/70 px-4 py-3 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">History</span>
              <Button
                size="xs"
                variant="ghost"
                icon={<RefreshCw className="size-3" />}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['jobs'] })}
              />
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {(jobs ?? []).length === 0 && (
                <li className="rounded-lg border border-dashed border-ink-700/70 px-3 py-6 text-center text-[11px] text-slate-500">
                  Nothing has run yet.
                </li>
              )}
              {(jobs ?? []).map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(job.id)}
                    className={cn(
                      'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                      job.id === current?.id
                        ? 'border-brand-500/40 bg-brand-500/10'
                        : 'border-transparent hover:border-ink-600/60 hover:bg-ink-800/50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[11px] font-medium text-slate-200">{job.title}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <Badge tone={STATUS_TONE[job.status]} className="text-[9px]">
                        {job.status}
                      </Badge>
                      <span className="font-mono text-[10px] text-slate-500">{formatDuration(job.duration_s)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Link to="/jobs" className="text-[11px] text-brand-300 hover:underline">
                Open jobs page
              </Link>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['jobs'] })}
                className="text-slate-500"
              >
                <X className="size-3" />
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            {current ? (
              <>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-200">{stream.summary?.title ?? current.title}</p>
                    <p className="truncate text-[11px] text-slate-500">{stream.summary?.message ?? current.message}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS_TONE[status as JobSummary['status']]} dot>
                      {status}
                    </Badge>
                    {(status === 'running' || status === 'queued') && (
                      <Button
                        size="xs"
                        variant="danger"
                        icon={<CircleX className="size-3" />}
                        loading={cancel.isPending}
                        onClick={() => cancel.mutate(current.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                <LogConsole
                  key={current.id}
                  className="min-h-0 flex-1"
                  height="h-full"
                  events={stream.events}
                  percent={percent}
                  status={status}
                />
              </>
            ) : (
              <EmptyState
                icon={<RefreshCw className="size-5" />}
                title="No job selected"
                description="Start a training, validation, export, benchmark or annotation job and its live console appears here."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
