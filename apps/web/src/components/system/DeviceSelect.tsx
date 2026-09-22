import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, Cpu, Gauge, Layers, Zap } from 'lucide-react';

import { systemApi } from '@/lib/api';
import type { DeviceProfile, ExecutionMode } from '@/lib/device-types';
import { supportsMode } from '@/lib/device-types';
import { cn } from '@/lib/utils';
import { Badge, Tooltip } from '@/components/ui/primitives';

const KIND_ICON: Record<string, typeof Cpu> = {
  auto: Zap,
  cpu: Cpu,
  cuda: Gauge,
  mps: Layers,
  hailo: Layers,
};

/**
 * Device switcher.
 *
 * Lists every compute profile the API discovered (CPU, CUDA, MPS, Hailo) with
 * capability badges, and warns when the choice cannot run the current mode.
 * The selection is per-session UI state; the durable default lives in `.env`.
 */
export function DeviceSelect({
  value,
  onChange,
  mode,
  size = 'md',
  className,
}: {
  value: string;
  onChange: (device: string) => void;
  /** The Ultralytics mode in play, so unsupported devices can be flagged. */
  mode?: ExecutionMode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: ['system', 'devices'],
    queryFn: systemApi.devices,
    staleTime: 30_000,
  });

  const devices: DeviceProfile[] = (data?.devices as DeviceProfile[]) ?? [];
  const current = devices.find((entry) => entry.id === value);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Compute device"
          className={cn(
            'w-full appearance-none rounded-lg border border-ink-600/80 bg-ink-900/80 pr-9 pl-8 text-slate-100 transition-colors focus:border-brand-400/80 focus:outline-none',
            size === 'sm' ? 'h-8 text-[11px]' : 'h-9 text-sm',
          )}
        >
          {devices.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
              {entry.available ? '' : ' — unavailable'}
              {mode && !supportsMode(entry, mode) ? ' (cannot run this mode)' : ''}
            </option>
          ))}
          {devices.length === 0 && <option value={value}>{value}</option>}
        </select>
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500">
          {(() => {
            const Icon = KIND_ICON[current?.kind ?? 'cpu'] ?? Cpu;
            return <Icon className="size-3.5" />;
          })()}
        </span>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-slate-500" />
      </div>

      {current && (
        <div className="flex flex-wrap items-center gap-1.5">
          {current.available ? (
            <Badge tone="success" dot>
              available
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              unavailable
            </Badge>
          )}
          {mode && !supportsMode(current, mode) ? (
            <Tooltip label={`${current.label} cannot run ${mode}. ${current.notes ?? ''}`}>
              <Badge tone="warning">
                <Ban className="size-2.5" /> not for {mode}
              </Badge>
            </Tooltip>
          ) : (
            current.supports_training === false && <Badge tone="violet">inference only</Badge>
          )}
          {current.resolves_to && <Badge tone="neutral">resolves to {current.resolves_to}</Badge>}
        </div>
      )}

      {current && !current.available && current.requires && current.requires.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg border border-warning-500/40 bg-warning-500/10 p-2 text-[11px] leading-relaxed text-warning-300">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>
            Needs {current.requires.join(' + ')}. {current.notes}
          </span>
        </p>
      )}
    </div>
  );
}

/** Compact badge showing the effective device, for page headers. */
export function DeviceBadge({ device, resolved }: { device: string; resolved?: string }) {
  return (
    <Badge tone={device === 'cpu' ? 'neutral' : 'success'}>
      <CheckCircle2 className="size-2.5" />
      device: {resolved ?? device}
    </Badge>
  );
}
