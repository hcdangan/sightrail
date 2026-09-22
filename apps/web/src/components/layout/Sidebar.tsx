import { NavLink } from 'react-router-dom';
import { ChevronLeft, Cpu, Github, Menu, Zap } from 'lucide-react';

import { NAV_GROUPS } from '@/lib/navigation';
import { usePreferences } from '@/lib/stores/preferences';
import { cn } from '@/lib/utils';
import { Badge, Tooltip } from '@/components/ui/primitives';

/**
 * Primary navigation rail.
 *
 * Groups mirror the mental model of the Ultralytics workflow: start here →
 * modes (the pipeline) → observe (runs and diagnostics).
 */
export function Sidebar({
  onNavigate,
  engineAvailable,
  version,
  className,
}: {
  onNavigate?: () => void;
  engineAvailable: boolean;
  version?: string;
  className?: string;
}) {
  const collapsed = usePreferences((state) => state.sidebarCollapsed);
  const toggleSidebar = usePreferences((state) => state.toggleSidebar);

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-ink-800/80 bg-ink-900/70 backdrop-blur-xl transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-[248px]',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-brand-500/30 bg-gradient-to-br from-brand-500/25 to-violet-500/20 text-brand-300">
          <Zap className="size-4.5" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">
              Sight<span className="text-gradient">rail</span>
            </p>
            <p className="truncate font-mono text-[10px] text-slate-500">v{version ?? '1.0.0'}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="mb-4">
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all',
                        isActive
                          ? 'bg-gradient-to-r from-brand-500/18 to-transparent text-brand-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.22)]'
                          : 'text-slate-400 hover:bg-ink-700/50 hover:text-slate-100',
                        collapsed && 'justify-center px-0',
                      )
                    }
                    title={collapsed ? item.label : undefined}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn('size-4 shrink-0', isActive ? 'text-brand-300' : 'text-slate-500')} />
                        {!collapsed && (
                          <>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.badge && (
                              <span className="shrink-0 rounded-full bg-ink-700/80 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-ink-800/80 p-3">
        {collapsed ? (
          <Tooltip label={engineAvailable ? 'Engine ready' : 'Engine unavailable'}>
            <span
              className={cn(
                'mx-auto block size-2.5 rounded-full',
                engineAvailable ? 'bg-success-400 shadow-[0_0_10px] shadow-success-500/60' : 'bg-danger-400',
              )}
            />
          </Tooltip>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border border-ink-700/70 bg-ink-850/60 px-2.5 py-2">
              <Cpu className="size-3.5 shrink-0 text-slate-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-slate-300">Engine</p>
                <p className={cn('truncate text-[10px]', engineAvailable ? 'text-success-400' : 'text-danger-400')}>
                  {engineAvailable ? 'ultralytics ready' : 'not installed'}
                </p>
              </div>
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  engineAvailable ? 'animate-pulse-slow bg-success-400' : 'bg-danger-400',
                )}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Badge tone="neutral" className="font-mono text-[9px]">
                <Github className="size-2.5" /> AGPL-3.0
              </Badge>
              <button
                type="button"
                onClick={toggleSidebar}
                className="flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-slate-300"
                title="Collapse sidebar"
              >
                <ChevronLeft className="size-3" /> Collapse
              </button>
            </div>
          </div>
        )}
        {collapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            className="mx-auto mt-2 grid size-7 place-items-center rounded-lg text-slate-500 hover:bg-ink-700/60 hover:text-slate-200"
            title="Expand sidebar"
          >
            <Menu className="size-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
}
