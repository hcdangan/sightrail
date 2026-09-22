import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Ban, CircleCheck, CircleX, Layers, RefreshCw, Trash2 } from 'lucide-react';

import { jobsApi } from '@/lib/api';
import type { JobKind, JobSummary } from '@/lib/api-types';
import { toast } from '@/lib/stores/toasts';
import { formatDuration, formatRelativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { useJobStream } from '@/lib/hooks/useWebSockets';
import { LogConsole } from '@/components/ui/LogConsole';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KeyValue,
  ProgressBar,
  SegmentedControl,
  SectionTitle,
} from '@/components/ui/primitives';

const STATUS_TONE = {
  queued: 'neutral',
  running: 'brand',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'warning',
} as const;

const KINDS: (JobKind | 'all')[] = ['all', 'train', 'val', 'export', 'benchmark', 'annotate', 'video'];

/**
 * Jobs control room.
 *
 * The full history of background work with status filters, a detail panel and
 * the same live console the dock uses. Heavy Ultralytics modes never block a
 * request — they all land here.
 */
export function JobsPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<JobKind | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: jobs, refetch, isFetching } = useQuery({
    queryKey: ['jobs', kind],
    queryFn: () => jobsApi.list(kind === 'all' ? undefined : kind),
    refetchInterval: 5000,
  });

  const current = jobs?.find((job) => job.id === selected) ?? jobs?.[0] ?? null;
  const stream = useJobStream(current?.id ?? null);

  const cancel = useMutation({
    mutationFn: (id: string) => jobsApi.cancel(id),
    onSuccess: () => {
      toast.warning('Cancellation requested');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const clear = useMutation({
    mutationFn: () => jobsApi.clearFinished(),
    onSuccess: (data) => {
      toast.info(`Removed ${data.removed} finished job(s)`);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const summary = stream.summary ?? current;
  const running = (jobs ?? []).filter((job) => job.status === 'running' || job.status === 'queued').length;
  const failed = (jobs ?? []).filter((job) => job.status === 'failed').length;
  const succeeded = (jobs ?? []).filter((job) => job.status === 'succeeded').length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Observe"
        title="Background jobs"
        description="Training, validation, export, benchmark, auto-annotation and video rendering all execute on a bounded worker pool — watch them here with live logs and metrics."
        badges={[
          { label: `${running} running`, tone: running > 0 ? 'brand' : 'neutral' },
          { label: `${succeeded} succeeded`, tone: 'success' },
          { label: `${failed} failed`, tone: failed > 0 ? 'danger' : 'neutral' },
        ]}
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={isFetching} onClick={() => refetch()}>
              Refresh
            </Button>
            <Button variant="ghost" icon={<Trash2 className="size-4" />} loading={clear.isPending} onClick={() => clear.mutate()}>
              Clear finished
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          size="sm"
          value={kind}
          onChange={(value) => {
            setKind(value);
            setSelected(null);
          }}
          options={KINDS.map((entry) => ({ value: entry, label: entry }))}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card>
          <CardHeader icon={<Layers className="size-4" />} title="Job history" description="Newest first — click a row for its console." />
          <DataTable<JobSummary>
            dense
            rows={jobs ?? []}
            getRowKey={(job) => job.id}
            onRowClick={(job) => setSelected(job.id)}
            empty={
              <EmptyState
                icon={<Layers className="size-5" />}
                title="No jobs"
                description="Start a training run, validation, export, benchmark, annotation or video analysis."
              />
            }
            columns={[
              {
                key: 'title',
                header: 'Job',
                render: (job) => (
                  <div className="min-w-0">
                    <span className="block truncate text-xs text-slate-200">{job.title}</span>
                    <span className="block font-mono text-[10px] text-slate-500">
                      {job.kind} · {job.id}
                    </span>
                  </div>
                ),
              },
              { key: 'status', header: 'Status', render: (job) => <Badge tone={STATUS_TONE[job.status]} dot>{job.status}</Badge> },
              {
                key: 'progress',
                header: 'Progress',
                width: '160px',
                render: (job) => (
                  <div className="flex items-center gap-2">
                    <ProgressBar value={job.percent} tone={job.status === 'failed' ? 'danger' : job.status === 'succeeded' ? 'success' : 'brand'} />
                    <span className="w-9 shrink-0 text-right font-mono text-[10px] text-slate-500">{job.percent.toFixed(0)}%</span>
                  </div>
                ),
              },
              { key: 'duration', header: 'Duration', align: 'right', render: (job) => <span className="font-mono text-[11px] text-slate-500">{formatDuration(job.duration_s)}</span> },
              { key: 'created', header: 'Started', align: 'right', render: (job) => <span className="text-[11px] text-slate-500">{formatRelativeTime(job.created_at)}</span> },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (job) =>
                  job.status === 'running' || job.status === 'queued' ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={<Ban className="size-3" />}
                      onClick={(event) => {
                        event.stopPropagation();
                        cancel.mutate(job.id);
                      }}
                    >
                      Stop
                    </Button>
                  ) : job.status === 'succeeded' ? (
                    <CircleCheck className="ml-auto size-3.5 text-success-400" />
                  ) : job.status === 'failed' ? (
                    <CircleX className="ml-auto size-3.5 text-danger-400" />
                  ) : null,
              },
            ]}
          />
        </Card>

        <div className="space-y-4">
          {!summary ? (
            <EmptyState
              icon={<Layers className="size-5" />}
              title="No job selected"
              description="Choose a job to stream its console and inspect the parsed metrics and artifacts."
            />
          ) : (
            <>
              <Card>
                <CardHeader
                  title={summary.title}
                  description={summary.message}
                  actions={
                    (summary.status === 'running' || summary.status === 'queued') && (
                      <Button size="sm" variant="danger" onClick={() => cancel.mutate(summary.id)}>
                        Cancel
                      </Button>
                    )
                  }
                />
                <KeyValue
                  columns={2}
                  items={[
                    { label: 'Kind', value: <Badge tone="brand">{summary.kind}</Badge> },
                    { label: 'Status', value: <Badge tone={STATUS_TONE[summary.status]} dot>{summary.status}</Badge> },
                    { label: 'Job id', value: <span className="font-mono text-[11px]">{summary.id}</span> },
                    { label: 'Duration', value: formatDuration(summary.duration_s), mono: true },
                    { label: 'Created', value: formatRelativeTime(summary.created_at) },
                    { label: 'Finished', value: summary.finished_at ? formatRelativeTime(summary.finished_at) : '—' },
                  ]}
                />

                {summary.error && (
                  <p className="mt-3 rounded-lg border border-danger-500/40 bg-danger-500/10 p-2 font-mono text-[11px] text-danger-300">
                    {summary.error}
                  </p>
                )}

                <SectionTitle className="mt-4">Parameters</SectionTitle>
                <div className="max-h-40 overflow-y-auto">
                  <KeyValue
                    columns={1}
                    items={Object.entries(summary.params ?? {})
                      .filter(([, value]) => value !== null && value !== undefined && value !== '' && !Array.isArray(value))
                      .slice(0, 30)
                      .map(([key, value]) => ({
                        label: key,
                        value: <span className="font-mono text-[11px]">{String(value)}</span>,
                      }))}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title="Live console" description="Structured events parsed from the Ultralytics output stream." />
                <LogConsole events={stream.events} percent={summary.percent} status={summary.status} height="h-72" />
              </Card>

              {Object.keys(summary.metrics ?? {}).length > 0 && (
                <Card>
                  <CardHeader title="Parsed metrics" description="Values extracted from the progress stream." />
                  <div className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(summary.metrics).map(([key, values]) => (
                      <div key={key} className="rounded-lg border border-ink-700/60 bg-ink-900/50 p-2.5">
                        <p className="text-[10px] tracking-wider text-slate-500 uppercase">{key}</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-slate-200">
                          {Array.isArray(values) ? `${values.length} samples · last ${String(values[values.length - 1])}` : String(values)}
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {summary.artifacts.length > 0 && (
                <Card>
                  <CardHeader title="Artifacts" description={`${summary.artifacts.length} file(s) produced.`} />
                  <ul className="space-y-1.5">
                    {summary.artifacts.slice(0, 24).map((artifact) => (
                      <li key={artifact.path} className="flex items-center gap-2 rounded-lg border border-ink-700/60 px-2.5 py-1.5">
                        <Badge tone="neutral">{artifact.kind}</Badge>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">{artifact.name}</span>
                        {artifact.url && (
                          <a href={artifact.url} target="_blank" rel="noreferrer" className="text-[11px] text-brand-300 hover:underline">
                            Open
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {summary.status === 'succeeded' && summary.result && (
                <Card>
                  <CardHeader title="Result payload" description="Exactly what the job returned." />
                  <pre className="max-h-64 overflow-auto rounded-lg border border-ink-700/60 bg-ink-950/80 p-3 font-mono text-[11px] text-slate-300">
                    {JSON.stringify(summary.result, null, 2)}
                  </pre>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
