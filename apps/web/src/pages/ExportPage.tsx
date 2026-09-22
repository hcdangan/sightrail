import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Cpu, Download, HardDrive, Layers, Ruler, Zap } from 'lucide-react';

import { jobsApi, modesApi, modelsApi, systemApi } from '@/lib/api';
import type { ExportFormat, JobSummary } from '@/lib/api-types';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { cn, formatBytes, formatDuration } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { useJobStream } from '@/lib/hooks/useWebSockets';
import { LogConsole } from '@/components/ui/LogConsole';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Select,
  Switch,
} from '@/components/ui/primitives';

/**
 * Hailo-specific export options.
 *
 * The accelerator architecture decides which chip the HEF targets, and the
 * host/toolchain requirements are unusual enough to spell out inline.
 */
function HailoExportOptions({ arch, onArchChange }: { arch: string; onArchChange: (value: string) => void }) {
  const { data } = useQuery({ queryKey: ['system', 'device-config'], queryFn: systemApi.deviceConfig, staleTime: 30_000 });
  const architectures = data?.hailo.architectures ?? [];
  const selected = architectures.find((entry) => entry.id === arch);
  const compilerReady = data?.hailo.compiler_installed ?? false;

  return (
    <div className="space-y-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] p-3">
      <div className="flex items-center gap-2">
        <Layers className="size-3.5 text-violet-300" />
        <span className="text-[11px] font-semibold tracking-wider text-violet-200 uppercase">Hailo target</span>
      </div>

      <Field label="Accelerator architecture" hint={selected?.target}>
        <Select
          value={arch}
          onChange={(event) => onArchChange(event.target.value)}
          options={architectures.map((entry) => ({ value: entry.id, label: entry.label }))}
        />
      </Field>
      {selected && <p className="text-[11px] leading-relaxed text-slate-400">{selected.note}</p>}

      <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
        <li className="flex items-start gap-1.5">
          <CheckCircle2 className={cn('mt-0.5 size-3 shrink-0', compilerReady ? 'text-success-400' : 'text-slate-600')} />
          Dataflow Compiler {compilerReady ? 'detected' : 'not installed'} — HEF compilation needs the Hailo AI Software
          Suite on Linux x86_64.
        </li>
        <li className="flex items-start gap-1.5">
          <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-slate-600" />
          Copy the resulting <span className="font-mono">*_hailo_model</span> directory to the Raspberry Pi, then set{' '}
          <span className="font-mono">SIGHTRAIL_DEVICE=hailo</span>.
        </li>
        <li className="flex items-start gap-1.5">
          <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-slate-600" />
          Detection and classification models only; segmentation, pose and OBB are not supported by Hailo export.
        </li>
      </ul>
    </div>
  );
}

/**
 * Export mode.
 *
 * Presents every deployment format the installed Ultralytics build can produce
 * as a selectable matrix, together with the options each format accepts and
 * whether its backend dependencies are present.
 */
export function ExportPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const device = usePreferences((state) => state.device);

  const [model, setModel] = useState(searchParams.get('model') ?? 'yolo11n.pt');
  const [format, setFormat] = useState(searchParams.get('format') ?? 'onnx');
  const [imgsz, setImgsz] = useState(640);
  const [batch, setBatch] = useState(1);
  const [half, setHalf] = useState(false);
  const [int8, setInt8] = useState(false);
  const [dynamic, setDynamic] = useState(false);
  const [simplify, setSimplify] = useState(true);
  const [nms, setNms] = useState(false);
  const [opset, setOpset] = useState<number | ''>('');
  const [data, setData] = useState('coco8.yaml');
  const [hailoArch, setHailoArch] = useState('hailo8l');
  const [job, setJob] = useState<JobSummary | null>(null);

  const stream = useJobStream(job?.id ?? null);

  const { data: catalog } = useQuery({ queryKey: ['models', 'catalog'], queryFn: () => modelsApi.catalog() });
  const { data: local } = useQuery({ queryKey: ['models', 'local'], queryFn: modelsApi.local });
  const { data: formats } = useQuery({ queryKey: ['export', 'formats'], queryFn: modesApi.exportFormats, staleTime: 300_000 });
  const { data: availability } = useQuery({ queryKey: ['export', 'available'], queryFn: modesApi.exportAvailable, staleTime: 60_000 });
  const { data: datasets } = useQuery({ queryKey: ['datasets'], queryFn: () => modesApi.datasets(), staleTime: 60_000 });
  const { data: jobs } = useQuery({ queryKey: ['jobs', 'export'], queryFn: () => jobsApi.list('export'), refetchInterval: job ? false : 8000 });

  const modelOptions = useMemo(() => {
    const catalogOptions = (catalog?.models ?? []).map((entry) => ({ value: entry.id, label: `${entry.label} (${entry.task})` }));
    const localOptions = (local?.models ?? [])
      .filter((entry) => !catalogOptions.some((option) => option.value === entry.id))
      .map((entry) => ({ value: entry.path, label: `${entry.id} · local` }));
    return [...localOptions, ...catalogOptions];
  }, [catalog, local]);

  const selectedFormat = formats?.formats.find((entry) => entry.id === format);

  useEffect(() => {
    const requested = searchParams.get('model');
    if (requested) setModel(requested);
    const requestedFormat = searchParams.get('format');
    if (requestedFormat) setFormat(requestedFormat);
  }, [searchParams]);

  // Reset per-format options that do not apply.
  useEffect(() => {
    if (!selectedFormat) return;
    if (!selectedFormat.options.includes('int8')) setInt8(false);
    if (!selectedFormat.options.includes('half')) setHalf(false);
    if (!selectedFormat.options.includes('dynamic')) setDynamic(false);
    if (!selectedFormat.options.includes('simplify')) setSimplify(false);
    if (!selectedFormat.options.includes('nms')) setNms(false);
  }, [selectedFormat]);

  const start = useMutation({
    mutationFn: () =>
      modesApi.export({
        model,
        format,
        imgsz,
        batch,
        device,
        half,
        int8,
        dynamic,
        simplify,
        nms,
        opset: opset === '' ? null : opset,
        data: selectedFormat?.options.includes('data') || format === 'hailo' ? data : null,
        hailo_arch: format === 'hailo' ? hailoArch : null,
      }),
    onSuccess: (created) => {
      setJob(created);
      toast.success('Export started', `Converting ${model} to ${format}.`);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: Error) => toast.error('Export failed to start', error.message),
  });

  const result = (stream.summary?.result ?? null) as
    | { format: string; path: string; size_bytes: number; artifact: { url: string; name: string } }
    | null;

  const backend = availability?.backends?.[format];
  const missingBackend = backend && !backend.ready;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mode 5 of 6 · Export"
        title="Deployment export"
        description="Convert a checkpoint into any of the 22 formats Ultralytics supports — ONNX, TensorRT, OpenVINO, CoreML, TFLite, RKNN, Hailo and more — with per-format precision and optimisation options."
        badges={[
          { label: `${formats?.formats.length ?? 0} formats`, tone: 'brand' },
          { label: `device: ${device}`, tone: device === 'cpu' ? 'neutral' : 'success' },
          { label: 'FP16 · INT8 · dynamic shapes', tone: 'violet' },
        ]}
        actions={
          <Button variant="primary" icon={<Download className="size-4" />} loading={start.isPending} onClick={() => start.mutate()}>
            Export to {format}
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            icon={<Layers className="size-4" />}
            title="Format matrix"
            description="Pick a target. Formats whose backend packages are missing still appear, flagged, so you know what to install."
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(formats?.formats ?? []).map((entry: ExportFormat) => {
              const active = entry.id === format;
              const ready = availability?.backends?.[entry.id]?.ready;
              const heavy = formats?.formats && ['engine', 'hailo', 'rknn', 'deepx', 'axelera', 'imx', 'qnn', 'ascend', 'coreai'].includes(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setFormat(entry.id)}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-all',
                    active ? 'border-brand-400/70 bg-brand-500/10 glow-ring' : 'border-ink-700/60 hover:border-ink-500',
                  )}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate text-xs font-medium text-slate-200">{entry.label}</span>
                    {entry.gpu && <Zap className="size-3 shrink-0 text-warning-400" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{entry.note}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {entry.cpu && <Badge tone="neutral" className="text-[9px]">CPU</Badge>}
                    {entry.gpu && <Badge tone="warning" className="text-[9px]">GPU</Badge>}
                    {heavy && <Badge tone="danger" className="text-[9px]">heavy</Badge>}
                    {ready === false && <Badge tone="danger" className="text-[9px]">deps</Badge>}
                    {ready === true && <Badge tone="success" className="text-[9px]">ready</Badge>}
                  </div>
                  <p className="mt-1.5 font-mono text-[9px] text-slate-600">{entry.suffix || '—'}</p>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={<HardDrive className="size-4" />} title="Options" description={selectedFormat?.note} />
            <div className="space-y-3">
              <Field label="Model">
                <Select value={model} onChange={(event) => setModel(event.target.value)} options={modelOptions} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Image size">
                  <Input type="number" value={imgsz} onChange={(event) => setImgsz(Number(event.target.value))} />
                </Field>
                <Field label="Batch">
                  <Input type="number" value={batch} onChange={(event) => setBatch(Number(event.target.value))} />
                </Field>
              </div>

              <div className="space-y-2">
                {selectedFormat?.options.includes('half') && (
                  <Switch checked={half} onChange={setHalf} label="FP16 half precision" description="Halves size, needs a supported GPU at runtime." />
                )}
                {selectedFormat?.options.includes('int8') && (
                  <Switch checked={int8} onChange={setInt8} label="INT8 quantisation" description="Uses the calibration dataset below; fastest on edge NPUs." />
                )}
                {selectedFormat?.options.includes('dynamic') && (
                  <Switch checked={dynamic} onChange={setDynamic} label="Dynamic shapes" description="Accept variable input sizes at the cost of some speed." />
                )}
                {selectedFormat?.options.includes('simplify') && (
                  <Switch checked={simplify} onChange={setSimplify} label="Simplify graph" description="Runs onnx-simplifier (ONNX family only)." />
                )}
                {selectedFormat?.options.includes('nms') && (
                  <Switch checked={nms} onChange={setNms} label="Fuse NMS" description="Bake non-max suppression into the exported graph." />
                )}
              </div>

              {selectedFormat?.options.includes('opset') && (
                <Field label="ONNX opset" hint="Leave empty to use the Ultralytics default.">
                  <Input type="number" value={opset} onChange={(event) => setOpset(event.target.value === '' ? '' : Number(event.target.value))} />
                </Field>
              )}

              {(int8 || selectedFormat?.options.includes('data') || format === 'hailo') && (
                <Field
                  label="Calibration dataset"
                  hint={
                    format === 'hailo'
                      ? 'Required for Hailo INT8 quantisation — Hailo recommends 1024+ representative images.'
                      : 'Required for INT8 and TensorRT accuracy calibration.'
                  }
                >
                  <Select
                    value={data}
                    onChange={(event) => setData(event.target.value)}
                    options={(datasets?.datasets ?? []).map((entry) => ({ value: entry.id, label: entry.label }))}
                  />
                </Field>
              )}

              {format === 'hailo' && <HailoExportOptions arch={hailoArch} onArchChange={setHailoArch} />}

              {missingBackend && (
                <p className="flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 p-2 text-[11px] leading-relaxed text-warning-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  This format needs {backend?.packages.join(', ')}. Install it in the API environment, then retry.
                </p>
              )}
            </div>
          </Card>

          {selectedFormat && (
            <Card>
              <CardHeader icon={<Ruler className="size-4" />} title="Format facts" />
              <KeyValue
                columns={2}
                items={[
                  { label: 'Engine name', value: selectedFormat.engine_name },
                  { label: 'File suffix', value: <span className="font-mono">{selectedFormat.suffix || '—'}</span> },
                  { label: 'Backend env', value: selectedFormat.environment },
                  { label: 'Runs on', value: selectedFormat.targets.join(', ') || '—' },
                  { label: 'Accepted options', value: selectedFormat.options.join(', ') || 'none' },
                  { label: 'Deps ready', value: availability?.backends?.[selectedFormat.id]?.ready === undefined ? 'not required' : String(availability?.backends?.[selectedFormat.id]?.ready) },
                ]}
              />
            </Card>
          )}

          {jobs && jobs.length > 0 && (
            <Card>
              <CardHeader title="Recent exports" />
              <ul className="space-y-1.5">
                {jobs.slice(0, 6).map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setJob(entry)}
                      className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-ink-600/60 hover:bg-ink-800/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{entry.title}</span>
                      <span className="font-mono text-[10px] text-slate-500">{formatDuration(entry.duration_s)}</span>
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
            icon={<Cpu className="size-4" />}
            title={`Export console — ${job.title}`}
            actions={
              (stream.summary?.status === 'running' || stream.summary?.status === 'queued') && (
                <Button size="sm" variant="danger" onClick={() => jobsApi.cancel(job.id)}>
                  Cancel
                </Button>
              )
            }
          />
          <LogConsole events={stream.events} percent={stream.summary?.percent} status={stream.summary?.status} height="h-72" />
        </Card>
      )}

      {result && (
        <Card className="border-success-500/40">
          <CardHeader icon={<CheckCircle2 className="size-4" />} title="Export complete" />
          <KeyValue
            columns={3}
            items={[
              { label: 'Format', value: result.format },
              { label: 'Size', value: formatBytes(result.size_bytes) },
              { label: 'Path', value: <span className="font-mono text-[11px] break-all">{result.path}</span> },
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {result.artifact?.url ? (
              <a href={result.artifact.url} download>
                <Button size="sm" variant="primary" icon={<Download className="size-3.5" />}>
                  Download artifact
                </Button>
              </a>
            ) : (
              <Badge tone="neutral">The exported file lives on the API host at the path above.</Badge>
            )}
            <Link to="/benchmark">
              <Button size="sm" variant="secondary" icon={<ArrowRight className="size-3.5" />}>
                Benchmark it against other formats
              </Button>
            </Link>
            <Link to={`/predict?model=${encodeURIComponent(result.path)}`}>
              <Button size="sm" variant="ghost">
                Predict with the exported model
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {!job && (
        <EmptyState
          icon={<Download className="size-5" />}
          title="Nothing exported yet"
          description="Pick a format and press Export. The console below streams the conversion, and the artifact becomes downloadable when it finishes."
        />
      )}
    </div>
  );
}
