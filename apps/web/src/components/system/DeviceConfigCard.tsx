import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Cpu,
  Gauge,
  Layers,
  Lightbulb,
  RefreshCw,
  Terminal,
  XCircle,
  Zap,
} from 'lucide-react';

import { systemApi } from '@/lib/api';
import type { CudaState, DeviceProfile } from '@/lib/device-types';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { cn, copyToClipboard } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, SectionTitle, Skeleton } from '@/components/ui/primitives';
import { DeviceSelect } from './DeviceSelect';

const KIND_ICON: Record<string, typeof Cpu> = { auto: Zap, cpu: Cpu, cuda: Gauge, mps: Layers, hailo: Layers };

/**
 * Device configuration panel.
 *
 * The durable device choice lives in `.env` (`SIGHTRAIL_DEVICE`); this card
 * makes that visible and copy-pasteable, shows exactly what each profile can and
 * cannot do, and walks through Hailo setup when the runtime is missing.
 */
export function DeviceConfigCard() {
  const device = usePreferences((state) => state.device);
  const setDevice = usePreferences((state) => state.setDevice);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['system', 'device-config'],
    queryFn: systemApi.deviceConfig,
    staleTime: 15_000,
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader icon={<Cpu className="size-4" />} title="Compute device" />
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  }

  const hailo = data.hailo_state;
  const profiles = data.devices;

  return (
    <Card>
      <CardHeader
        icon={<Cpu className="size-4" />}
        title="Compute device"
        description="Switch between CPU, CUDA and Hailo. The durable default lives in .env; the selector here applies to this session."
        actions={
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={isFetching} onClick={() => refetch()}>
            Re-scan
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="brand">
          .env: {data.env_var}={data.configured}
        </Badge>
        <Badge tone={data.resolved === 'cpu' ? 'neutral' : 'success'}>resolved: {data.resolved}</Badge>
        {data.engine_device !== data.resolved && (
          <Badge tone="violet">host device: {data.engine_device}</Badge>
        )}
        {!data.env_file_exists && <Badge tone="warning">no .env yet — copy .env.example</Badge>}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            selected={device === profile.id || (device === 'auto' && profile.id === data.requested)}
            onSelect={() => {
              setDevice(profile.id);
              toast.info(`Session device set to ${profile.label}`, 'Set SIGHTRAIL_DEVICE in .env to make it the default.');
            }}
          />
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <SectionTitle hint="applies to this session">Quick switch</SectionTitle>
        <DeviceSelect value={device === 'auto' ? data.requested : device} onChange={setDevice} />
        <p className="text-[11px] leading-relaxed text-slate-500">
          The selector changes the device per request; the snippet below makes it the durable default. Hailo is an
          inference target — compiled HEF networks have no backward pass, so Train and Val must run on CPU or CUDA.
        </p>
      </div>

      <SectionTitle className="mt-5" hint="copy into .env">
        Configuration snippet
      </SectionTitle>
      <div className="relative">
        <pre className="overflow-x-auto rounded-lg border border-ink-700/70 bg-ink-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {data.snippet}
        </pre>
        <Button
          size="xs"
          variant="secondary"
          className="absolute top-2 right-2"
          icon={<Copy className="size-3" />}
          onClick={() => {
            void copyToClipboard(data.snippet);
            toast.success('Snippet copied', 'Paste it into .env and restart the API.');
          }}
        >
          Copy
        </Button>
      </div>
      <p className="mt-2 font-mono text-[10px] break-all text-slate-600">
        {data.env_file_exists ? data.env_file : `${data.env_example} → ${data.env_file}`}
      </p>

      {data.cuda_state && <CudaPanel state={data.cuda_state} />}

      <HailoPanel hailo={hailo} architecture={data.hailo.architecture} onRefresh={() => refetch()} />
    </Card>
  );
}

function ProfileCard({
  profile,
  selected,
  onSelect,
}: {
  profile: DeviceProfile;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = KIND_ICON[profile.kind] ?? Cpu;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-xl border p-3 text-left transition-all',
        selected ? 'border-brand-400/70 bg-brand-500/10 glow-ring' : 'border-ink-700/60 hover:border-ink-500',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg border',
            profile.available ? 'border-brand-500/30 bg-brand-500/10 text-brand-300' : 'border-ink-600 bg-ink-800/60 text-slate-500',
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold text-slate-100">{profile.label}</span>
            {selected && <Badge tone="brand">selected</Badge>}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{profile.detail}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {profile.available ? (
              <Badge tone="success">
                <CheckCircle2 className="size-2.5" /> ready
              </Badge>
            ) : (
              <Badge tone="danger">
                <XCircle className="size-2.5" /> unavailable
              </Badge>
            )}
            {profile.supports_training ? (
              <Badge tone="neutral">train + infer</Badge>
            ) : (
              <Badge tone="violet">inference only</Badge>
            )}
            {profile.id === 'hailo' && <Badge tone="neutral">arch {profile.arch}</Badge>}
          </div>
          {profile.requires && profile.requires.length > 0 && !profile.available && (
            <p className="mt-1.5 text-[10px] text-warning-400">needs {profile.requires.join(' + ')}</p>
          )}
        </div>
      </div>
    </button>
  );
}

function HailoPanel({
  hailo,
  architecture,
  onRefresh,
}: {
  hailo: Awaited<ReturnType<typeof systemApi.hailo>>;
  architecture: string;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(hailo.status !== 'ready');

  const tone =
    hailo.status === 'ready' ? 'success' : hailo.status === 'model-missing' ? 'warning' : 'danger';

  return (
    <div className="mt-5 rounded-xl border border-ink-700/60 bg-ink-900/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Layers className="size-4 text-brand-300" />
          <span className="text-xs font-semibold text-slate-100">Hailo accelerator</span>
          <Badge tone={tone} dot>
            {hailo.status.replace('-', ' ')}
          </Badge>
        </span>
        <span className="font-mono text-[10px] text-slate-500">{architecture}</span>
      </button>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{hailo.summary}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Requirement ok={hailo.runtime} label="HailoRT runtime" />
        <Requirement ok={hailo.device} label="board detected" />
        <Requirement ok={hailo.compiler} label="Dataflow Compiler" />
        <Requirement ok={Boolean(hailo.model)} label=".hef model" />
      </div>

      {open && (
        <>
          <SectionTitle className="mt-4" hint="Raspberry Pi 5 + AI HAT / Hailo-8">
            Setup steps
          </SectionTitle>
          <SetupSteps steps={hailo.steps} />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3" />} onClick={onRefresh}>
              Re-check
            </Button>
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <Terminal className="size-3" />
              {hailo.searched.filter(Boolean).join(' · ')}
            </span>
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-500">
            <Lightbulb className="mt-0.5 size-3 shrink-0 text-warning-400" />
            HEF compilation needs the Hailo Dataflow Compiler on Linux x86_64. A common workflow is to compile on a
            desktop and copy the resulting <span className="font-mono">*_hailo_model</span> directory to the Pi.
          </p>
        </>
      )}
    </div>
  );
}

function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
        ok ? 'border-success-500/40 bg-success-500/10 text-success-400' : 'border-ink-600 bg-ink-800/60 text-slate-500',
      )}
    >
      {ok ? <CheckCircle2 className="size-2.5" /> : <AlertTriangle className="size-2.5" />}
      {label}
    </span>
  );
}

/** Numbered setup steps with copyable command blocks. Shared by CUDA and Hailo. */
function SetupSteps({ steps }: { steps: { title: string; detail: string }[] }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-2.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-brand-500/40 bg-brand-500/10 font-mono text-[10px] text-brand-300">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-slate-200">{step.title}</p>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-ink-700/60 bg-ink-950/70 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-slate-400">
              {step.detail}
            </pre>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * CUDA readiness.
 *
 * Shown only when CUDA cannot be used, and only when the API could say *why*.
 * "PyTorch is a CPU-only build" and "the driver is too old" look identical in the
 * device list but need opposite fixes, so this panel names the condition and gives
 * the commands for that specific case.
 */
function CudaPanel({ state }: { state: CudaState }) {
  const blocked = state.status !== 'ready';
  const [open, setOpen] = useState(blocked);

  if (!blocked) return null;

  return (
    <div className="mt-4 rounded-xl border border-warning-500/40 bg-warning-500/5 p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Gauge className="size-4 text-warning-400" />
          <span className="text-xs font-semibold text-slate-100">CUDA</span>
          <Badge tone={state.status === 'cpu-only-torch' ? 'danger' : 'warning'} dot>
            {state.status.replace(/-/g, ' ')}
          </Badge>
        </span>
        <span className="font-mono text-[10px] text-slate-500">
          {state.torch_version ? `torch ${state.torch_version}` : 'torch missing'}
          {state.torch_cuda ? ` · cu${state.torch_cuda}` : ' · no CUDA'}
        </span>
      </button>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-300">{state.summary}</p>

      {state.status === 'cpu-only-torch' && (
        <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-400">
          <Lightbulb className="mt-0.5 size-3 shrink-0 text-warning-400" />
          Setting SIGHTRAIL_DEVICE is not enough on its own: the device switch selects a GPU, but this torch build has
          no CUDA support compiled in, so it falls back to CPU.
        </p>
      )}

      {open && (
        <>
          <SectionTitle className="mt-4" hint="run these in the repository root">
            Fix
          </SectionTitle>
          <SetupSteps steps={state.steps} />

          {state.verify.length > 0 && (
            <>
              <SectionTitle className="mt-4">Verify</SectionTitle>
              {state.verify.map((command) => (
                <pre
                  key={command}
                  className="mt-1 overflow-x-auto rounded-lg border border-ink-700/60 bg-ink-950/70 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-slate-400"
                >
                  {command}
                </pre>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
