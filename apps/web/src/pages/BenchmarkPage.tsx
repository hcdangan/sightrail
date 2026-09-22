import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Gauge, Play, Scale, Timer, Trophy, Zap } from 'lucide-react';

import { jobsApi, modesApi, modelsApi } from '@/lib/api';
import type { BenchmarkResult, BenchmarkRow, JobSummary } from '@/lib/api-types';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { cn, formatMs, formatScore, toCsv } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { useJobStream } from '@/lib/hooks/useWebSockets';
import { LogConsole } from '@/components/ui/LogConsole';
import { BarChartView } from '@/components/charts/LineChart';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  Input,
  SectionTitle,
  Select,
  Switch,
} from '@/components/ui/primitives';

/**
 * Benchmark mode.
 *
 * Exports the same checkpoint to several formats, then measures file size,
 * export time and (optionally) validation metrics per format — the practical way
 * to choose a deployment target.
 */
export function BenchmarkPage() {
  const queryClient = useQueryClient();
  const device = usePreferences((state) => state.device);

  const [model, setModel] = useState('yolo11n.pt');
  const [dataset, setDataset] = useState('coco8.yaml');
  const [imgsz, setImgsz] = useState(640);
  const [selected, setSelected] = useState<string[]>(['onnx', 'torchscript']);
  const [withAccuracy, setWithAccuracy] = useState(true);
  const [job, setJob] = useState<JobSummary | null>(null);

  const stream = useJobStream(job?.id ?? null);

  const { data: catalog } = useQuery({ queryKey: ['models', 'catalog'], queryFn: () => modelsApi.catalog() });
  const { data: formats } = useQuery({ queryKey: ['export', 'formats'], queryFn: modesApi.exportFormats, staleTime: 300_000 });
  const { data: datasets } = useQuery({ queryKey: ['datasets'], queryFn: () => modesApi.datasets(), staleTime: 60_000 });
  const { data: jobs } = useQuery({ queryKey: ['jobs', 'benchmark'], queryFn: () => jobsApi.list('benchmark'), refetchInterval: job ? false : 8000 });

  const modelOptions = useMemo(
    () => (catalog?.models ?? []).filter((entry) => entry.size === 'n' || entry.size === 's').map((entry) => ({ value: entry.id, label: `${entry.label} (${entry.task})` })),
    [catalog],
  );

  const start = useMutation({
    mutationFn: () =>
      modesApi.benchmark({
        model,
        formats: selected,
        data: withAccuracy ? dataset : null,
        imgsz,
        device,
      }),
    onSuccess: (created) => {
      setJob(created);
      toast.success('Benchmark started', `${selected.length} format(s) queued.`);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: Error) => toast.error('Could not start the benchmark', error.message),
  });

  const result = (stream.summary?.result ?? null) as BenchmarkResult | null;
  const rows = result?.formats ?? [];
  const successful = rows.filter((row) => row.status === 'ok');

  const sizeRows = successful.map((row) => ({ format: row.format, size: row.size_mb ?? 0 }));
  const latencyRows = successful
    .filter((row) => row.latency?.inference_ms)
    .map((row) => ({ format: row.format, inference: row.latency?.inference_ms ?? 0, preprocess: row.latency?.preprocess_ms ?? 0 }));

  const fastest = [...successful].sort((a, b) => (a.latency?.inference_ms ?? Infinity) - (b.latency?.inference_ms ?? Infinity))[0];
  const smallest = [...successful].sort((a, b) => (a.size_mb ?? Infinity) - (b.size_mb ?? Infinity))[0];
  const mostAccurate = [...successful].sort(
    (a, b) => (b.metrics?.['map50'] ?? b.metrics?.['accuracy_top1'] ?? 0) - (a.metrics?.['map50'] ?? a.metrics?.['accuracy_top1'] ?? 0),
  )[0];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mode 6 of 6 · Benchmark"
        title="Speed, size and accuracy trade-offs"
        description="Export one checkpoint to many formats and compare them side by side. Sightrail validates each artefact on a small dataset so accuracy numbers are real, not estimated."
        badges={[
          { label: `device: ${device}`, tone: device === 'cpu' ? 'neutral' : 'success' },
          { label: `${selected.length} formats selected`, tone: 'brand' },
          { label: 'size · latency · mAP', tone: 'violet' },
        ]}
        actions={
          <Button
            variant="primary"
            icon={<Play className="size-4" />}
            loading={start.isPending}
            disabled={selected.length === 0}
            onClick={() => start.mutate()}
          >
            Run benchmark
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            icon={<Scale className="size-4" />}
            title="Formats to compare"
            description="Small, CPU-friendly formats are preselected. Add more as needed — each one is exported and measured independently."
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(formats?.formats ?? []).map((entry) => {
              const active = selected.includes(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() =>
                    setSelected((previous) =>
                      previous.includes(entry.id) ? previous.filter((item) => item !== entry.id) : [...previous, entry.id],
                    )
                  }
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-all',
                    active ? 'border-brand-400/70 bg-brand-500/10' : 'border-ink-700/60 hover:border-ink-500',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium text-slate-200">{entry.label}</span>
                    <span className={cn('size-3.5 shrink-0 rounded border', active ? 'border-brand-400 bg-brand-400' : 'border-ink-500')} />
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">{entry.suffix || '—'}</p>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={<Gauge className="size-4" />} title="Setup" />
            <div className="space-y-3">
              <Field label="Model">
                <Select value={model} onChange={(event) => setModel(event.target.value)} options={modelOptions} />
              </Field>
              <Field label="Image size">
                <Input type="number" value={imgsz} onChange={(event) => setImgsz(Number(event.target.value))} />
              </Field>
              <Switch
                checked={withAccuracy}
                onChange={setWithAccuracy}
                label="Validate accuracy per format"
                description="Runs model.val() on each artefact — slower, but gives real mAP/accuracy numbers."
              />
              {withAccuracy && (
                <Field label="Accuracy dataset" hint="Keep it small: every format is validated on it.">
                  <Select
                    value={dataset}
                    onChange={(event) => setDataset(event.target.value)}
                    options={(datasets?.datasets ?? []).map((entry) => ({ value: entry.id, label: entry.label }))}
                  />
                </Field>
              )}
            </div>
          </Card>

          {jobs && jobs.length > 0 && (
            <Card>
              <CardHeader title="Previous benchmarks" />
              <ul className="space-y-1.5">
                {jobs.slice(0, 5).map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setJob(entry)}
                      className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-ink-600/60 hover:bg-ink-800/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{entry.title}</span>
                      <Badge tone={entry.status === 'succeeded' ? 'success' : entry.status === 'failed' ? 'danger' : 'neutral'}>
                        {entry.status}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {job && (
        <Card>
          <CardHeader
            title="Benchmark console"
            description="Each format is exported, sized and (optionally) validated in turn."
            actions={
              (stream.summary?.status === 'running' || stream.summary?.status === 'queued') && (
                <Button size="sm" variant="danger" onClick={() => jobsApi.cancel(job.id)}>
                  Cancel
                </Button>
              )
            }
          />
          <LogConsole events={stream.events} percent={stream.summary?.percent} status={stream.summary?.status} height="h-64" />
        </Card>
      )}

      {successful.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <WinnerCard icon={<Zap className="size-4" />} label="Fastest inference" value={fastest?.format ?? '—'} detail={fastest?.latency?.inference_ms ? formatMs(fastest.latency.inference_ms) : 'not measured'} />
            <WinnerCard icon={<Scale className="size-4" />} label="Smallest artefact" value={smallest?.format ?? '—'} detail={smallest?.size_mb ? `${smallest.size_mb.toFixed(2)} MB` : '—'} />
            <WinnerCard
              icon={<Trophy className="size-4" />}
              label="Most accurate"
              value={mostAccurate?.format ?? '—'}
              detail={
                mostAccurate?.metrics
                  ? `mAP@50 ${formatScore(mostAccurate.metrics['map50'])}`
                  : 'accuracy not measured'
              }
            />
          </div>

          <Card>
            <CardHeader
              icon={<Timer className="size-4" />}
              title="Comparison table"
              description="One row per format. Any format that failed reports its error inline."
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const blob = new Blob([toCsv(rows as unknown as Record<string, unknown>[])], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = 'benchmark.csv';
                    anchor.click();
                  }}
                >
                  Export CSV
                </Button>
              }
            />
            <DataTable<BenchmarkRow>
              rows={rows}
              getRowKey={(row) => row.format}
              columns={[
                {
                  key: 'format',
                  header: 'Format',
                  render: (row) => (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-200">{row.format}</span>
                      {row.status === 'failed' && <Badge tone="danger">failed</Badge>}
                    </span>
                  ),
                },
                { key: 'size', header: 'Size', align: 'right', render: (row) => <span className="font-mono text-xs">{row.size_mb ? `${row.size_mb.toFixed(2)} MB` : '—'}</span> },
                { key: 'export', header: 'Export time', align: 'right', render: (row) => <span className="font-mono text-xs">{row.export_seconds !== undefined ? `${row.export_seconds.toFixed(1)}s` : '—'}</span> },
                { key: 'pre', header: 'Preprocess', align: 'right', render: (row) => <span className="font-mono text-xs">{formatMs(row.latency?.preprocess_ms)}</span> },
                { key: 'infer', header: 'Inference', align: 'right', render: (row) => <span className="font-mono text-xs">{formatMs(row.latency?.inference_ms)}</span> },
                { key: 'post', header: 'Postprocess', align: 'right', render: (row) => <span className="font-mono text-xs">{formatMs(row.latency?.postprocess_ms)}</span> },
                {
                  key: 'map50',
                  header: 'mAP@50',
                  align: 'right',
                  render: (row) => <span className="font-mono text-xs">{formatScore(row.metrics?.['map50'])}</span>,
                },
                {
                  key: 'map',
                  header: 'mAP@50-95',
                  align: 'right',
                  render: (row) => <span className="font-mono text-xs">{formatScore(row.metrics?.['map'])}</span>,
                },
                {
                  key: 'acc',
                  header: 'Top-1',
                  align: 'right',
                  render: (row) => <span className="font-mono text-xs">{formatScore(row.metrics?.['accuracy_top1'])}</span>,
                },
              ]}
              empty={null}
            />
            {rows.some((row) => row.status === 'failed') && (
              <div className="mt-3 space-y-1.5">
                <SectionTitle>Failures</SectionTitle>
                {rows
                  .filter((row) => row.status === 'failed')
                  .map((row) => (
                    <p key={row.format} className="rounded-lg border border-danger-500/40 bg-danger-500/10 p-2 font-mono text-[11px] text-danger-300">
                      {row.format}: {row.error}
                    </p>
                  ))}
              </div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Artefact size" description="Smaller is cheaper to ship and usually faster to load." />
              <BarChartView
                data={sizeRows}
                xKey="format"
                series={[{ key: 'size', label: 'Size (MB)', color: '#22d3ee' }]}
                highlightMax={false}
                height={220}
              />
            </Card>
            <Card>
              <CardHeader title="Inference latency" description="Per-image inference time reported by the validator." />
              <BarChartView
                data={latencyRows}
                xKey="format"
                series={[
                  { key: 'preprocess', label: 'Preprocess', color: '#a78bfa' },
                  { key: 'inference', label: 'Inference', color: '#22d3ee' },
                ]}
                height={220}
                emptyMessage="Latency is only measured when accuracy validation is enabled."
              />
            </Card>
          </div>
        </>
      )}

      {!job && (
        <EmptyState
          icon={<Gauge className="size-5" />}
          title="No benchmark yet"
          description="Select two or more formats and run the benchmark. Everything runs as a background job, so you can navigate away while it works."
        />
      )}
    </div>
  );
}

function WinnerCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-300">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] tracking-wider text-slate-500 uppercase">{label}</p>
        <p className="truncate font-mono text-sm text-slate-100">{value}</p>
        <p className="truncate text-[11px] text-slate-500">{detail}</p>
      </div>
    </div>
  );
}
