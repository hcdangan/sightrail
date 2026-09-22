import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Command, HardDrive, Menu, Moon, Sun, Wifi, WifiOff } from 'lucide-react';

import { systemApi } from '@/lib/api';
import { usePreferences } from '@/lib/stores/preferences';
import { cn } from '@/lib/utils';
import { Badge, Tooltip } from '@/components/ui/primitives';
import { DeviceSelect } from '@/components/system/DeviceSelect';

/**
 * Global header: device selection, live memory telemetry, palette trigger and
 * the mobile navigation button. Device choice is persisted and shared by every
 * page through the preferences store.
 */
export function TopBar({
  onOpenPalette,
  onOpenMobileNav,
  runningJobs,
  onOpenJobs,
  healthy,
}: {
  onOpenPalette: () => void;
  onOpenMobileNav: () => void;
  runningJobs: number;
  onOpenJobs: () => void;
  healthy: boolean | null;
}) {
  const location = useLocation();
  const device = usePreferences((state) => state.device);
  const setDevice = usePreferences((state) => state.setDevice);
  const theme = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);

  const { data: memory } = useQuery({
    queryKey: ['system', 'memory'],
    queryFn: systemApi.memory,
    refetchInterval: 5000,
  });

  // Follow the OS theme preference on first load only.
  useEffect(() => {
    const stored = localStorage.getItem('sightrail.preferences.v1');
    if (stored) return;
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) setTheme('light');
  }, [setTheme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme !== 'light');
  }, [theme]);

  const cpuPercent = memory?.cpu?.percent;
  const gpu = memory?.cuda?.[0];
  const hailoReady = Boolean(memory?.hailo);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-ink-800/80 bg-ink-950/80 px-3 backdrop-blur-xl sm:px-5">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="grid size-9 place-items-center rounded-lg border border-ink-700 text-slate-300 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-4" />
      </button>

      <Breadcrumbs path={location.pathname} />

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden items-center gap-2 rounded-lg border border-ink-700/80 bg-ink-900/70 px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:border-ink-600 hover:text-slate-200 sm:flex"
        >
          <Command className="size-3.5" />
          <span>Quick jump</span>
          <kbd className="rounded border border-ink-600 bg-ink-800 px-1 font-mono text-[10px]">⌘K</kbd>
        </button>

        <Tooltip label={healthy ? 'API connected' : 'API unreachable'}>
          <span
            className={cn(
              'hidden size-8 place-items-center rounded-lg border border-ink-700/80 sm:grid',
              healthy ? 'text-success-400' : 'text-danger-400',
            )}
          >
            {healthy ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          </span>
        </Tooltip>

        <div className="hidden items-center gap-2 rounded-lg border border-ink-700/80 bg-ink-900/70 px-2.5 py-1.5 md:flex">
          <HardDrive className="size-3.5 text-slate-500" />
          <span className="font-mono text-[11px] text-slate-400">
            RAM {cpuPercent !== undefined ? `${cpuPercent.toFixed(0)}%` : '—'}
          </span>
          {gpu && (
            <span className="font-mono text-[11px] text-slate-400">
              VRAM {gpu.used_gb.toFixed(1)}/{gpu.total_gb.toFixed(0)}G
            </span>
          )}
          {hailoReady && <span className="font-mono text-[11px] text-success-400">NPU ready</span>}
        </div>

        <div className="w-[170px] shrink-0">
          <DeviceSelect value={device} onChange={setDevice} size="sm" />
        </div>

        <button
          type="button"
          onClick={onOpenJobs}
          className={cn(
            'relative grid size-8 place-items-center rounded-lg border transition-colors',
            runningJobs > 0
              ? 'border-brand-500/50 bg-brand-500/10 text-brand-200'
              : 'border-ink-700/80 text-slate-400 hover:text-slate-200',
          )}
          title="Background jobs"
        >
          <span className="font-mono text-[11px] font-semibold">{runningJobs}</span>
          {runningJobs > 0 && (
            <span className="absolute -top-0.5 -right-0.5 size-2 animate-pulse-slow rounded-full bg-brand-400" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="grid size-8 place-items-center rounded-lg border border-ink-700/80 text-slate-400 transition-colors hover:text-slate-200"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
        </button>
      </div>
    </header>
  );
}

function Breadcrumbs({ path }: { path: string }) {
  const segments = path.split('/').filter(Boolean);
  const label = segments.length === 0 ? 'Dashboard' : segments[segments.length - 1].replace(/-/g, ' ');

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link to="/" className="hidden text-[11px] text-slate-500 transition-colors hover:text-slate-300 sm:block">
        Sightrail
      </Link>
      {segments.length > 0 && <span className="hidden text-slate-600 sm:block">/</span>}
      <Badge tone="brand" className="capitalize">
        {label}
      </Badge>
    </div>
  );
}
