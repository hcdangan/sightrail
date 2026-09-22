import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Cpu,
  Database,
  Download,
  Gauge,
  GraduationCap,
  HardDrive,
  Images,
  Layers,
  Rocket,
  ScanSearch,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';

import { jobsApi, systemApi } from '@/lib/api';
import { TASK_META } from '@/lib/navigation';
import { formatBytes, formatDuration, formatPercent, formatRelativeTime, cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  ProgressBar,
  SectionTitle,
  Skeleton,
  Stat,
} from '@/components/ui/primitives';

/**
 * Landing page: environment summary, one-click starts for every mode and a feed
 * of recent runs. This is the "what can this thing do" screen.
 */
export function DashboardPage() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['system', 'overview'],
    queryFn: systemApi.overview,
    refetchInterval: 15_000,
  });

  const { data: jobs } = useQuery({ queryKey: ['jobs', 'recent'], queryFn: () => jobsApi.list() });

  if (isLoading || !overview) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activeJobs = jobs?.filter((job) => job.status === 'running' || job.status === 'queued') ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sightrail"
        title="Every vision task, one workbench"
        description="Run all six Ultralytics modes — predict, track, train, validate, export and benchmark — across all five task families, with the full solutions library wired into live streaming."
        badges={[
          { label: `${overview.catalog.models} catalog checkpoints`, tone: 'brand' },
          { label: `device: ${overview.device}`, tone: overview.device === 'cpu' ? 'neutral' : 'success' },
          { label: `ultralytics ${overview.ultralytics.version ?? 'unavailable'}`, tone: 'violet' },
          { label: overview.engine_available ? 'engine ready' : 'engine unavailable', tone: overview.engine_available ? 'success' : 'danger' },
        ]}
        actions={
          <>
            <Link to="/predict">
              <Button variant="primary" icon={<ScanSearch className="size-4" />}>
                Start predicting
              </Button>
            </Link>
            <Link to="/studio">
              <Button variant="secondary" icon={<Activity className="size-4" />}>
                Live Studio
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Compute device"
          value={<span className="capitalize">{overview.device}</span>}
          sub={
            overview.torch.cuda_available
              ? `CUDA ${overview.torch.cuda_build ?? ''} · torch ${overview.torch.version}`
              : `torch ${overview.torch.version ?? 'not installed'} · CPU only`
          }
          icon={<Cpu className="size-4" />}
          tone={overview.device === 'cpu' ? 'neutral' : 'success'}
        />
        <Stat
          label="Checkpoints on disk"
          value={overview.checkpoints.count}
          sub={`${formatBytes(Number(overview.storage.weights_mb ?? 0) * 1024 * 1024)} in storage/weights`}
          icon={<Boxes className="size-4" />}
          tone="brand"
        />
        <Stat
          label="Uploads"
          value={overview.uploads.count}
          sub={`${formatBytes(Number(overview.storage.uploads_mb ?? 0) * 1024 * 1024)} stored`}
          icon={<Images className="size-4" />}
        />
        <Stat
          label="Runs recorded"
          value={overview.runs.length}
          sub={activeJobs.length > 0 ? `${activeJobs.length} job(s) running now` : 'no jobs running'}
          icon={<Activity className="size-4" />}
          tone={activeJobs.length > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            icon={<Rocket className="size-4" />}
            title="Jump into a mode"
            description="Each card starts the corresponding Ultralytics pipeline step with sane defaults."
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[
              {
                to: '/predict',
                icon: ScanSearch,
                label: 'Predict',
                detail: 'Images → boxes, masks, keypoints, OBB or class probabilities',
                accent: 'from-brand-500/20',
              },
              {
                to: '/studio',
                icon: Activity,
                label: 'Track & Stream',
                detail: 'Video, webcam and six trackers with live analytics',
                accent: 'from-violet-500/20',
              },
              {
                to: '/solutions',
                icon: Sparkles,
                label: 'Solutions',
                detail: 'Counting, heatmaps, gym reps, parking, alarms',
                accent: 'from-fuchsia-500/20',
              },
              {
                to: '/train',
                icon: GraduationCap,
                label: 'Train',
                detail: 'Fine-tune with the full hyperparameter surface',
                accent: 'from-emerald-500/20',
              },
              {
                to: '/validate',
                icon: Target,
                label: 'Validate',
                detail: 'mAP, per-class tables, confusion matrix, curves',
                accent: 'from-amber-500/20',
              },
              {
                to: '/export',
                icon: Download,
                label: 'Export',
                detail: '21 deployment formats from ONNX to TensorRT',
                accent: 'from-sky-500/20',
              },
              {
                to: '/benchmark',
                icon: Gauge,
                label: 'Benchmark',
                detail: 'Compare size, latency and accuracy per format',
                accent: 'from-rose-500/20',
              },
              {
                to: '/datasets',
                icon: Database,
                label: 'Datasets',
                detail: 'Auto-annotate a folder into a trainable dataset',
                accent: 'from-teal-500/20',
              },
            ].map((entry) => (
              <Link
                key={entry.to}
                to={entry.to}
                className={cn(
                  'panel panel-hover group relative overflow-hidden p-3.5 hover:border-brand-500/40',
                  'bg-gradient-to-br to-transparent',
                  entry.accent,
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-ink-600/70 bg-ink-900/70 text-brand-300">
                    <entry.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
                      {entry.label}
                      <ArrowUpRight className="size-3.5 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{entry.detail}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              icon={<Layers className="size-4" />}
              title="Task families"
              description="Ultralytics ships five task heads; the UI adapts per task."
            />
            <ul className="space-y-2">
              {Object.entries(TASK_META).map(([task, meta]) => (
                <li key={task}>
                  <Link
                    to={`/predict?task=${task}`}
                    className="flex items-center gap-3 rounded-lg border border-ink-700/60 px-3 py-2 transition-colors hover:border-ink-500 hover:bg-ink-800/40"
                  >
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: meta.accent }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-slate-200">{meta.label}</span>
                      <span className="block truncate text-[11px] text-slate-500">{meta.description}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">
                      {overview.catalog.by_task[task] ?? 0} models
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              icon={<HardDrive className="size-4" />}
              title="Storage"
              description="Where Sightrail keeps weights, uploads, runs and datasets."
            />
            <div className="space-y-2.5">
              {(
                [
                  ['weights', 'Weights', overview.storage.weights_mb],
                  ['uploads', 'Uploads', overview.storage.uploads_mb],
                  ['outputs', 'Rendered outputs', overview.storage.outputs_mb],
                  ['runs', 'Runs', overview.storage.runs_mb],
                  ['datasets', 'Datasets', overview.storage.datasets_mb],
                ] as const
              ).map(([key, label, value]) => {
                const megabytes = Number(value ?? 0);
                const total = Math.max(1, Number(overview.storage.weights_mb ?? 0) + Number(overview.storage.uploads_mb ?? 0) + Number(overview.storage.outputs_mb ?? 0) + Number(overview.storage.runs_mb ?? 0) + Number(overview.storage.datasets_mb ?? 0));
                return (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">{label}</span>
                      <span className="font-mono text-slate-500">{formatBytes(megabytes * 1024 * 1024)}</span>
                    </div>
                    <ProgressBar value={(megabytes / total) * 100} />
                  </div>
                );
              })}
            </div>
            <p className="mt-3 truncate font-mono text-[10px] text-slate-600">{String(overview.storage.root)}</p>
          </Card>

          <Card>
            <CardHeader icon={<Zap className="size-4" />} title="Memory" description="Live RAM and VRAM usage." />
            <KeyValue
              columns={1}
              items={[
                {
                  label: 'System RAM',
                  value: overview.memory.cpu.total_gb
                    ? `${overview.memory.cpu.used_gb?.toFixed(1)} / ${overview.memory.cpu.total_gb} GB (${overview.memory.cpu.percent?.toFixed(0)}%)`
                    : 'unavailable',
                },
                ...(overview.memory.cuda.length > 0
                  ? overview.memory.cuda.map((gpu) => ({
                      label: `GPU ${gpu.index} · ${gpu.name}`,
                      value: `${gpu.used_gb.toFixed(2)} / ${gpu.total_gb.toFixed(2)} GB (${gpu.allocated_gb.toFixed(2)} GB in torch)`,
                    }))
                  : [{ label: 'GPU', value: 'no CUDA device visible' }]),
              ]}
            />
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={<Activity className="size-4" />}
            title="Recent runs"
            description="Outputs from training, validation, export and video analysis."
            actions={
              <Link to="/runs" className="text-[11px] text-brand-300 hover:underline">
                View all
              </Link>
            }
          />
          {overview.runs.length === 0 ? (
            <EmptyState
              icon={<Activity className="size-5" />}
              title="No runs yet"
              description="Train a model or run a validation to populate this list."
              action={
                <Link to="/train">
                  <Button size="sm" variant="primary">
                    Start training
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2">
              {overview.runs.map((run) => (
                <li key={run.id} className="flex items-center gap-3 rounded-lg border border-ink-700/60 p-2.5">
                  <Badge tone={run.mode === 'train' ? 'brand' : 'neutral'}>{run.mode}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-slate-200">{run.name}</p>
                    <p className="text-[10px] text-slate-500">{formatRelativeTime(run.created_at)}</p>
                  </div>
                  {run.images[0] && (
                    <img src={run.images[0]} alt="" className="size-9 rounded object-cover" loading="lazy" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={<Layers className="size-4" />}
            title="Job activity"
            description="Long-running work and its progress."
            actions={
              <Link to="/jobs" className="text-[11px] text-brand-300 hover:underline">
                Open jobs
              </Link>
            }
          />
          {(jobs ?? []).length === 0 ? (
            <EmptyState icon={<Layers className="size-5" />} title="No jobs yet" description="Jobs appear here as soon as you start one." />
          ) : (
            <ul className="space-y-2">
              {(jobs ?? []).slice(0, 6).map((job) => (
                <li key={job.id} className="rounded-lg border border-ink-700/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-200">{job.title}</span>
                    <Badge
                      tone={
                        job.status === 'succeeded'
                          ? 'success'
                          : job.status === 'failed'
                            ? 'danger'
                            : job.status === 'running'
                              ? 'brand'
                              : 'neutral'
                      }
                    >
                      {job.status}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <ProgressBar
                      value={job.percent}
                      tone={job.status === 'failed' ? 'danger' : job.status === 'succeeded' ? 'success' : 'brand'}
                    />
                    <span className="w-10 shrink-0 text-right font-mono text-[10px] text-slate-500">
                      {formatPercent(job.percent, 0)}
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono text-[10px] text-slate-600">
                      {formatDuration(job.duration_s)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          icon={<Boxes className="size-4" />}
          title="Model cache"
          description="Checkpoints currently resident in the API process — reused across requests for instant inference."
        />
        {overview.loaded_models.length === 0 ? (
          <p className="text-xs text-slate-500">No models loaded yet. Run a prediction to warm the cache.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {overview.loaded_models.map((model) => (
              <div key={model.key} className="rounded-lg border border-ink-700/60 p-3">
                <p className="truncate font-mono text-[11px] text-slate-200">{model.path.split(/[\\/]/).pop()}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge tone="brand">{model.task}</Badge>
                  <span className="text-[10px] text-slate-500">{model.classes} classes</span>
                  <span className="ml-auto font-mono text-[10px] text-slate-600">{model.hits} hits</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <SectionTitle className="mt-4">Catalog defaults</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {Object.entries(overview.catalog.defaults).map(([task, model]) => (
            <Link key={task} to={`/predict?task=${task}`}>
              <Badge tone="neutral" className="font-mono">
                {task}: {model}
              </Badge>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
