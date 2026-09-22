import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Download, Grid3x3, Play, Table2, Target, TrendingUp } from 'lucide-react';

import { jobsApi, modesApi, modelsApi } from '@/lib/api';
import type { JobSummary, PerClassMetric, ValidationResult } from '@/lib/api-types';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { downloadJson, formatMs, formatPercent, formatScore, heatColor, toCsv } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { DeviceSelect } from '@/components/system/DeviceSelect';
import { useJobStream } from '@/lib/hooks/useWebSockets';
import { LogConsole } from '@/components/ui/LogConsole';
import { BarChartView, LineChart } from '@/components/charts/LineChart';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Input,
  KeyValue,
  SectionTitle,
  Select,
} from '@/components/ui/primitives';

/**
 * Val mode.
 *
 * Everything Ultralytics reports after evaluation: aggregate mAP, per-class
 * precision/recall/F1, the mAP@50-95 curve matrix, and the confusion matrices
 * the engine writes next to the run.
 */
export function ValidatePage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const device = usePreferences((state) => state.device);
  const setDevice = usePreferences((state) => state.setDevice);

  const [model, setModel] = useState(searchParams.get('model') ?? 'yolo11n.pt');
  const [dataset, setDataset] = useState('coco8.yaml');
  const [split, setSplit] = useState<'val' | 'train' | 'test'>('val');
  const [imgsz, setImgsz] = useState(640);
  const [batch, setBatch] = useState(16);
  const [conf, setConf] = useState(0.001);
  const [iou, setIou] = useState(0.6);
  const [job, setJob] = useState<JobSummary | null>(null);

  const stream = useJobStream(job?.id ?? null);

  const { data: catalog } = useQuery({ queryKey: ['models', 'catalog'], queryFn: () => modelsApi.catalog() });
  const { data: datasets } = useQuery({ queryKey: ['datasets'], queryFn: () => modesApi.datasets(), staleTime: 60_000 });
  const { data: jobs } = useQuery({ queryKey: ['jobs', 'val'], queryFn: () => jobsApi.list('val'), refetchInterval: job ? false : 8000 });
  const { data: local } = useQuery({ queryKey: ['models', 'local'], queryFn: modelsApi.local });

  const modelOptions = useMemo(() => {
    const catalogOptions = (catalog?.models ?? []).map((entry) => ({ value: entry.id, label: `${entry.label} (${entry.task})` }));
    const localOptions = (local?.models ?? [])
      .filter((entry) => !catalogOptions.some((option) => option.value === entry.id))
      .map((entry) => ({ value: entry.path, label: `${entry.id} · local` }));
    return [...localOptions, ...catalogOptions];
  }, [catalog, local]);

  useEffect(() => {
    const requested = searchParams.get('model');
    if (requested) setModel(requested);
  }, [searchParams]);

  const start = useMutation({
    mutationFn: () =>
      modesApi.validate({ model, data: dataset, split, device, imgsz, batch, conf, iou }),
    onSuccess: (created) => {
      setJob(created);
      toast.success('Validation started', 'Metrics and plots appear as soon as it finishes.');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: Error) => toast.error('Could not start validation', error.message),
  });

  const result = (stream.summary?.result ?? null) as ValidationResult | null;
  const summary = result?.summary ?? {};

  // Reshape the per-class table for the bar chart.
  const chartRows = useMemo(
    () =>
      (result?.per_class ?? []).slice(0, 24).map((row: PerClassMetric) => ({
        name: row.class_name.length > 14 ? `${row.class_name.slice(0, 13)}…` : row.class_name,
        precision: row.precision ?? 0,
        recall: row.recall ?? 0,
        map50: row.map50 ?? 0,
        map: row.map ?? 0,
      })),
    [result?.per_class],
  );

  const perClass = result?.per_class ?? [];

  const curveSeries = useMemo(() => {
    if (!result?.curves?.length) return [];
    const classes = result.curves.slice(0, 6);
    return classes.map((entry, index) => ({
      key: `class_${entry.class_id}`,
      label: entry.class_name,
      color: ['#22d3ee', '#a78bfa', '#f472b6', '#4ade80', '#fbbf24', '#60a5fa'][index % 6],
    }));
  }, [result?.curves]);

  const curveRows = useMemo(() => {
    if (!result?.curves?.length) return [];
    const length = Math.max(...result.curves.map((entry) => entry.values.length));
    return Array.from({ length }, (_, index) => {
      const row: Record<string, number> = { iou: Number(((index / Math.max(1, length - 1)) * 0.95 + 0.05).toFixed(3)) };
      for (const entry of result.curves.slice(0, 6)) {
        row[`class_${entry.class_id}`] = entry.values[index] ?? 0;
      }
      return row;
    });
  }, [result?.curves]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mode 4 of 6 · Val"
        title="Validation & metrics"
        description="Evaluate any checkpoint against any dataset and read the full metric report: mAP@50-95, per-class precision/recall/F1 and the confusion matrices."
        badges={[
          { label: `device: ${device}`, tone: device === 'cpu' ? 'neutral' : 'success' },
          { label: 'mAP · P · R · F1', tone: 'brand' },
          { label: 'confusion matrix + curves', tone: 'violet' },
        ]}
        actions={
          <>
            <div className="w-[196px]">
              <DeviceSelect value={device} onChange={setDevice} mode="val" size="sm" />
            </div>
            <Button variant="primary" icon={<Play className="size-4" />} loading={start.isPending} onClick={() => start.mutate()}>
              Run validation
            </Button>
            {result && (
              <>
                <Button
                  variant="secondary"
                  icon={<Download className="size-4" />}
                  onClick={() => downloadJson(result, 'validation.json')}
                >
                  JSON
                </Button>
                <Button
                  variant="ghost"
                  icon={<Table2 className="size-4" />}
                  disabled={perClass.length === 0}
                  onClick={() => {
                    const blob = new Blob([toCsv(perClass as unknown as Record<string, unknown>[])], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = 'per-class-metrics.csv';
                    anchor.click();
                  }}
                >
                  CSV
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader icon={<Target className="size-4" />} title="Evaluation setup" />
            <div className="space-y-3">
              <Select value={model} onChange={(event) => setModel(event.target.value)} options={modelOptions} />
              <Select
                value={dataset}
                onChange={(event) => setDataset(event.target.value)}
                options={(datasets?.datasets ?? []).map((entry) => ({
                  value: entry.id,
                  label: `${entry.label}${entry.exists ? '' : ' (downloads)'}`,
                }))}
              />
              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={split}
                  onChange={(event) => setSplit(event.target.value as 'val' | 'train' | 'test')}
                  options={[
                    { value: 'val', label: 'val' },
                    { value: 'train', label: 'train' },
                    { value: 'test', label: 'test' },
                  ]}
                />
                <Input type="number" value={imgsz} onChange={(event) => setImgsz(Number(event.target.value))} />
                <Input type="number" value={batch} onChange={(event) => setBatch(Number(event.target.value))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-slate-400">
                  conf
                  <Input type="number" step="0.001" value={conf} onChange={(event) => setConf(Number(event.target.value))} />
                </label>
                <label className="text-[11px] text-slate-400">
                  iou
                  <Input type="number" step="0.01" value={iou} onChange={(event) => setIou(Number(event.target.value))} />
                </label>
              </div>
            </div>
          </Card>

          {Object.keys(summary).length > 0 && (
            <Card>
              <CardHeader icon={<TrendingUp className="size-4" />} title="Headline metrics" description="Aggregate scores across all classes." />
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(summary).map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-ink-700/60 bg-ink-900/50 p-2.5">
                    <p className="text-[10px] tracking-wider text-slate-500 uppercase">{key.replace(/_/g, ' ')}</p>
                    <p className="mt-0.5 font-mono text-sm text-brand-200">
                      {key.startsWith('accuracy') ? formatPercent(value) : formatScore(value)}
                    </p>
                  </div>
                ))}
              </div>
              {result?.speed && (
                <>
                  <SectionTitle className="mt-4">Speed</SectionTitle>
                  <KeyValue
                    columns={3}
                    items={[
                      { label: 'Preprocess', value: formatMs(result.speed.preprocess), mono: true },
                      { label: 'Inference', value: formatMs(result.speed.inference), mono: true },
                      { label: 'Postprocess', value: formatMs(result.speed.postprocess), mono: true },
                    ]}
                  />
                </>
              )}
            </Card>
          )}

          {(jobs?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Previous evaluations" />
              <ul className="space-y-1.5">
                {(jobs ?? []).slice(0, 6).map((entry) => (
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

        <div className="min-w-0 space-y-4">
          {!job && (
            <EmptyState
              className="h-64"
              icon={<Target className="size-5" />}
              title="No validation run yet"
              description="Choose a checkpoint and dataset, then run validation. Per-class tables, curves and confusion matrices render here."
            />
          )}

          {job && (
            <Card>
              <CardHeader
                icon={<BarChart3 className="size-4" />}
                title="Console"
                description="Ultralytics prints its per-class table to stdout; it is parsed into the report below."
                actions={
                  (stream.summary?.status === 'running' || stream.summary?.status === 'queued') && (
                    <Button size="sm" variant="danger" onClick={() => jobsApi.cancel(job.id)}>
                      Cancel
                    </Button>
                  )
                }
              />
              <LogConsole events={stream.events} percent={stream.summary?.percent} status={stream.summary?.status} height="h-56" />
            </Card>
          )}

          {chartRows.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Per-class mAP" description="Top 24 classes by dataset order." />
                <BarChartView
                  data={chartRows}
                  xKey="name"
                  layout="vertical"
                  height={Math.max(220, chartRows.length * 22)}
                  series={[
                    { key: 'map50', label: 'mAP@50', color: '#22d3ee' },
                    { key: 'map', label: 'mAP@50-95', color: '#a78bfa' },
                  ]}
                />
              </Card>
              <Card>
                <CardHeader title="Precision vs recall" description="Per-class balance between the two." />
                <BarChartView
                  data={chartRows}
                  xKey="name"
                  layout="vertical"
                  height={Math.max(220, chartRows.length * 22)}
                  series={[
                    { key: 'precision', label: 'Precision', color: '#4ade80' },
                    { key: 'recall', label: 'Recall', color: '#fbbf24' },
                  ]}
                />
              </Card>
            </div>
          )}

          {perClass.length > 0 && (
            <Card>
              <CardHeader
                icon={<Table2 className="size-4" />}
                title="Per-class metrics"
                description="Colour intensity scales with each metric's value within the table."
              />
              <DataTable<PerClassMetric>
                dense
                rows={perClass}
                getRowKey={(row) => String(row.class_id)}
                columns={[
                  { key: 'class', header: 'Class', render: (row) => <span className="text-slate-200">{row.class_name}</span> },
                  {
                    key: 'precision',
                    header: 'Precision',
                    align: 'right',
                    render: (row) => (
                      <Cell value={row.precision} max={1} />
                    ),
                  },
                  {
                    key: 'recall',
                    header: 'Recall',
                    align: 'right',
                    render: (row) => <Cell value={row.recall} max={1} />,
                  },
                  {
                    key: 'f1',
                    header: 'F1',
                    align: 'right',
                    render: (row) => <Cell value={row.f1} max={1} />,
                  },
                  {
                    key: 'map50',
                    header: 'mAP@50',
                    align: 'right',
                    render: (row) => <Cell value={row.map50} max={1} />,
                  },
                  {
                    key: 'map',
                    header: 'mAP@50-95',
                    align: 'right',
                    render: (row) => <Cell value={row.map} max={1} />,
                  },
                ]}
              />
            </Card>
          )}

          {curveRows.length > 1 && curveSeries.length > 0 && (
            <Card>
              <CardHeader
                icon={<TrendingUp className="size-4" />}
                title="mAP curve per class"
                description="mAP across IoU thresholds from 0.05 to 0.95 — the engine's ap_per_class() output."
              />
              <LineChart data={curveRows} xKey="iou" series={curveSeries} height={280} />
            </Card>
          )}

          {(result?.confusion_matrix_url || result?.artifacts?.length) && (
            <Card>
              <CardHeader
                icon={<Grid3x3 className="size-4" />}
                title="Diagnostic plots"
                description="Confusion matrix, PR/F1 curves, label distribution and mosaics written by the validator."
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {result?.confusion_matrix_url && (
                  <figure className="overflow-hidden rounded-lg border border-ink-700/60">
                    <img src={result.confusion_matrix_url} alt="Confusion matrix" className="w-full bg-white object-contain" />
                    <figcaption className="px-2 py-1 font-mono text-[10px] text-slate-400">confusion_matrix.png</figcaption>
                  </figure>
                )}
                {(result?.artifacts ?? [])
                  .filter((artifact) => artifact.kind === 'image' && !artifact.name.includes('confusion_matrix.png'))
                  .slice(0, 8)
                  .map((artifact) => (
                    <figure key={artifact.path} className="overflow-hidden rounded-lg border border-ink-700/60">
                      <img src={artifact.url} alt={artifact.name} className="w-full bg-white object-contain" loading="lazy" />
                      <figcaption className="truncate px-2 py-1 font-mono text-[10px] text-slate-400">{artifact.name}</figcaption>
                    </figure>
                  ))}
              </div>
            </Card>
          )}

          {result?.results_dict && Object.keys(result.results_dict).length > 0 && (
            <Card>
              <CardHeader title="Raw results dictionary" description="Exactly what `metrics.results_dict` contains." />
              <pre className="max-h-64 overflow-auto rounded-lg border border-ink-700/60 bg-ink-950/80 p-3 font-mono text-[11px] text-slate-300">
                {JSON.stringify(result.results_dict, null, 2)}
              </pre>
            </Card>
          )}

          {stream.summary?.status === 'succeeded' && (
            <Card className="border-brand-500/30">
              <CardHeader title="Next step" description="Export this model for deployment, or compare formats." />
              <div className="flex flex-wrap gap-2">
                <Link to={`/export?model=${encodeURIComponent(model)}`}>
                  <Button size="sm" variant="primary">
                    Export {model}
                  </Button>
                </Link>
                <Link to="/benchmark">
                  <Button size="sm" variant="secondary">
                    Benchmark formats
                  </Button>
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ value, max = 1 }: { value: number | null | undefined; max?: number }) {
  if (value === null || value === undefined) return <span className="text-slate-600">—</span>;
  return (
    <span
      className="inline-block min-w-14 rounded px-1.5 py-0.5 font-mono text-[11px]"
      style={{ background: heatColor(value, max), color: '#e6ebf7' }}
    >
      {value.toFixed(4)}
    </span>
  );
}
