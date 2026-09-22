import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Boxes, CheckCircle2, Cpu, Database, HardDrive, Info, Server, Trash2, XCircle } from 'lucide-react';

import { modelsApi, systemApi } from '@/lib/api';
import { DOC_LINKS } from '@/lib/navigation';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { formatBytes } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { LineChart } from '@/components/charts/LineChart';
import { DeviceConfigCard } from '@/components/system/DeviceConfigCard';
import { DeviceSelect } from '@/components/system/DeviceSelect';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  SectionTitle,
  SegmentedControl,
  Skeleton,
  Switch,
} from '@/components/ui/primitives';

/**
 * System diagnostics.
 *
 * Environment versions, compute devices, live memory telemetry, storage
 * footprint, optional dependency readiness, and the UI preferences that affect
 * every page.
 */
export function SystemPage() {
  const queryClient = useQueryClient();
  const device = usePreferences((state) => state.device);
  const setDevice = usePreferences((state) => state.setDevice);
  const overlay = usePreferences((state) => state.overlay);
  const patchOverlay = usePreferences((state) => state.patchOverlay);
  const inferDefaults = usePreferences((state) => state.inferDefaults);
  const patchInferDefaults = usePreferences((state) => state.patchInferDefaults);
  const theme = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);
  const reset = usePreferences((state) => state.reset);

  const { data: env, isLoading } = useQuery({ queryKey: ['system', 'env'], queryFn: systemApi.environment, refetchInterval: 30_000 });
  const { data: memory } = useQuery({ queryKey: ['system', 'memory'], queryFn: systemApi.memory, refetchInterval: 3000 });
  const { data: overview } = useQuery({ queryKey: ['system', 'overview'], queryFn: systemApi.overview, refetchInterval: 15_000 });

  const clearCache = useMutation({
    mutationFn: () => modelsApi.clearOutputs(),
    onSuccess: (data) => {
      toast.success(`Cleared ${data.removed} rendered output(s)`);
      queryClient.invalidateQueries({ queryKey: ['system', 'overview'] });
    },
  });

  const flushModels = useMutation({
    mutationFn: () => modelsApi.evict(),
    onSuccess: (data) => {
      toast.info(`Evicted ${data.evicted} model(s) from memory`);
      queryClient.invalidateQueries({ queryKey: ['models', 'registry'] });
    },
  });

  if (isLoading || !env) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const optionalEntries = Object.entries(env.optional);
  const installedOptional = optionalEntries.filter(([, version]) => version);
  const missingOptional = optionalEntries.filter(([, version]) => !version);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Observe"
        title="System & environment"
        description="Exactly what the API process is running: Python, PyTorch, CUDA, Ultralytics, optional export backends, storage usage and live memory."
        badges={[
          { label: `Python ${env.python.version}`, tone: 'neutral' },
          { label: `torch ${env.torch.version ?? 'missing'}`, tone: env.torch.installed ? 'success' : 'danger' },
          { label: `ultralytics ${env.ultralytics.version ?? 'missing'}`, tone: env.ultralytics.installed ? 'success' : 'danger' },
          {
            label: env.torch.cuda_available ? `CUDA ${env.torch.cuda_build}` : 'CPU only',
            tone: env.torch.cuda_available ? 'success' : 'neutral',
          },
        ]}
        actions={
          <>
            <Button variant="secondary" icon={<Trash2 className="size-4" />} loading={clearCache.isPending} onClick={() => clearCache.mutate()}>
              Clear rendered outputs
            </Button>
            <Button variant="ghost" icon={<Cpu className="size-4" />} loading={flushModels.isPending} onClick={() => flushModels.mutate()}>
              Flush model cache
            </Button>
          </>
        }
      />

      <DeviceConfigCard />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader icon={<Server className="size-4" />} title="Runtime" description="Versions and platform." />
          <KeyValue
            columns={1}
            items={[
              { label: 'App', value: `${env.app.name} v${env.app.version}` },
              { label: 'Python', value: `${env.python.implementation} ${env.python.version}` },
              { label: 'Interpreter', value: <span className="font-mono text-[10px] break-all">{env.python.executable}</span> },
              { label: 'Platform', value: `${env.platform.system} ${env.platform.release} (${env.platform.machine})` },
              { label: 'CPU cores', value: env.cpu_count },
            ]}
          />
        </Card>

        <Card>
          <CardHeader icon={<Cpu className="size-4" />} title="Accelerators" description="What PyTorch and HailoRT can see." />
          <KeyValue
            columns={1}
            items={[
              { label: 'torch', value: env.torch.version ?? 'not installed' },
              { label: 'CUDA build', value: env.torch.cuda_build ?? 'cpu-only wheel' },
              { label: 'cuDNN', value: env.torch.cudnn ?? '—' },
              {
                label: 'CUDA available',
                value: env.torch.cuda_available ? (
                  <Badge tone="success" dot>
                    yes
                  </Badge>
                ) : (
                  <Badge tone="neutral" dot>
                    no
                  </Badge>
                ),
              },
              {
                label: 'MPS (Apple)',
                value: env.torch.mps_available ? <Badge tone="success">yes</Badge> : <Badge tone="neutral">no</Badge>,
              },
              {
                label: 'HailoRT runtime',
                value: env.hailo.runtime ? (
                  <Badge tone="success">{env.hailo.runtime_version ?? 'installed'}</Badge>
                ) : (
                  <Badge tone="neutral">not installed</Badge>
                ),
              },
              {
                label: 'Hailo board',
                value: env.hailo.device ? <Badge tone="success">detected</Badge> : <Badge tone="neutral">none</Badge>,
              },
              { label: 'Configured device', value: env.device.configured },
              {
                label: 'Active device',
                value: (
                  <span className="flex items-center gap-1.5">
                    <span>{env.device.resolved}</span>
                    {env.device.engine !== env.device.resolved && (
                      <span className="text-[10px] text-slate-500">(host: {env.device.engine})</span>
                    )}
                  </span>
                ),
              },
            ]}
          />
          <SectionTitle className="mt-4" hint="session override">
            Quick switch
          </SectionTitle>
          <DeviceSelect value={device} onChange={setDevice} />
        </Card>

        <Card>
          <CardHeader icon={<Activity className="size-4" />} title="Memory" description="Live RAM and VRAM, refreshed every 3s." />
          <div className="space-y-4">
            {memory?.cpu?.total_gb && (
              <div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">System RAM</span>
                  <span className="font-mono text-slate-500">
                    {memory.cpu.used_gb?.toFixed(1)} / {memory.cpu.total_gb} GB
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-700/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-violet-glow"
                    style={{ width: `${memory.cpu.percent ?? 0}%` }}
                  />
                </div>
              </div>
            )}
            {(memory?.cuda?.length ?? 0) === 0 && <p className="text-[11px] text-slate-500">No CUDA devices detected.</p>}
            {memory?.cuda?.map((gpu) => (
              <div key={gpu.index}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="truncate text-slate-400">{gpu.name}</span>
                  <span className="font-mono text-slate-500">
                    {gpu.used_gb.toFixed(2)} / {gpu.total_gb.toFixed(2)} GB
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-700/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-success-400 to-brand-400"
                    style={{ width: `${(gpu.used_gb / gpu.total_gb) * 100}%` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[10px] text-slate-500">
                  torch allocated {gpu.allocated_gb.toFixed(2)} GB · free {gpu.free_gb.toFixed(2)} GB
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<HardDrive className="size-4" />} title="Storage" description="Everything Sightrail writes lives under one root." />
          <ul className="space-y-2">
            {Object.entries(env.storage)
              .filter(([key]) => key !== 'root')
              .map(([key, value]) => (
                <li key={key} className="flex items-center justify-between gap-3 rounded-lg border border-ink-700/60 px-2.5 py-2">
                  <span className="text-[11px] text-slate-300 capitalize">{key.replace(/_mb$/, '')}</span>
                  <span className="font-mono text-[11px] text-slate-400">{formatBytes(Number(value) * 1024 * 1024)}</span>
                </li>
              ))}
          </ul>
          <p className="mt-3 font-mono text-[10px] break-all text-slate-600">{String(env.storage.root)}</p>
          <SectionTitle className="mt-4">Feature flags</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <Badge tone={env.features.allow_dataset_downloads ? 'success' : 'neutral'}>
              dataset downloads: {String(env.features.allow_dataset_downloads)}
            </Badge>
            <Badge tone={env.features.allow_heavy_export ? 'success' : 'neutral'}>
              heavy export: {String(env.features.allow_heavy_export)}
            </Badge>
            <Badge tone="brand">max concurrent jobs: {env.features.max_concurrent_jobs}</Badge>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<Boxes className="size-4" />}
            title="Export backends"
            description="Optional packages that unlock additional deployment formats."
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {installedOptional.map(([name, version]) => (
              <div key={name} className="flex items-center gap-2 rounded-lg border border-success-500/30 bg-success-500/5 px-2.5 py-2">
                <CheckCircle2 className="size-3.5 shrink-0 text-success-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-200">{name}</span>
                <span className="font-mono text-[10px] text-slate-500">{version}</span>
              </div>
            ))}
          </div>
          {missingOptional.length > 0 && (
            <>
              <SectionTitle className="mt-4" hint="install on demand">
                Not installed
              </SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {missingOptional.map(([name]) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800/60 px-2 py-0.5 font-mono text-[10px] text-slate-500"
                  >
                    <XCircle className="size-2.5" />
                    {name}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Install a backend to unlock its format, e.g.{' '}
                <code className="rounded bg-ink-800 px-1 font-mono text-brand-300">uv pip install onnx onnxruntime</code> for
                ONNX, or <code className="rounded bg-ink-800 px-1 font-mono text-brand-300">openvino</code> for the
                OpenVINO CPU runtime.
              </p>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Info className="size-4" />} title="UI preferences" description="Stored in localStorage and shared by every page." />
          <div className="space-y-3">
            <SegmentedControl
              size="sm"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'midnight', label: 'Midnight' },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <Switch checked={overlay.showLabels} onChange={(value) => patchOverlay({ showLabels: value })} label="Labels" />
              <Switch checked={overlay.showConfidence} onChange={(value) => patchOverlay({ showConfidence: value })} label="Confidence" />
              <Switch checked={overlay.showMasks} onChange={(value) => patchOverlay({ showMasks: value })} label="Masks" />
              <Switch checked={overlay.showKeypoints} onChange={(value) => patchOverlay({ showKeypoints: value })} label="Keypoints" />
              <Switch checked={overlay.showTrackIds} onChange={(value) => patchOverlay({ showTrackIds: value })} label="Track IDs" />
              <Switch checked={inferDefaults.augment} onChange={(value) => patchInferDefaults({ augment: value })} label="TTA by default" />
            </div>
            <Button size="sm" variant="outline" onClick={() => { reset(); toast.info('Preferences reset to defaults'); }}>
              Reset preferences
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader icon={<Database className="size-4" />} title="Reference" description="Where to read more about each capability." />
          <ul className="space-y-2">
            {DOC_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-lg border border-ink-700/60 px-3 py-2 transition-colors hover:border-brand-500/40 hover:bg-ink-800/40"
                >
                  <link.icon className="size-4 text-brand-300" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{link.label}</span>
                  <span className="font-mono text-[10px] text-slate-500">↗</span>
                </a>
              </li>
            ))}
          </ul>
          <SectionTitle className="mt-4">API surface</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <a href="/api/docs" target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary">
                Swagger UI
              </Button>
            </a>
            <a href="/api/redoc" target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">
                ReDoc
              </Button>
            </a>
            <a href="/api/openapi.json" target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">
                OpenAPI JSON
              </Button>
            </a>
          </div>
        </Card>
      </div>

      {overview && overview.loaded_models.length > 0 && (
        <Card>
          <CardHeader icon={<Cpu className="size-4" />} title="Model cache" description={`${overview.loaded_models.length} model(s) resident in the API process.`} />
          <LineChart
            data={overview.loaded_models.map((model, index) => ({ index, hits: model.hits, classes: model.classes }))}
            xKey="index"
            series={[
              { key: 'hits', label: 'Cache hits', color: '#22d3ee', type: 'area' },
              { key: 'classes', label: 'Classes', color: '#a78bfa' },
            ]}
            height={180}
          />
        </Card>
      )}

      {!overview?.loaded_models.length && (
        <EmptyState
          icon={<Cpu className="size-5" />}
          title="Model cache is cold"
          description="Run a prediction to load a checkpoint; subsequent requests reuse it until the LRU cache evicts it."
        />
      )}
    </div>
  );
}
