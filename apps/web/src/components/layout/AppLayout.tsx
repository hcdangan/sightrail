import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { jobsApi, systemApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useCommandPalette } from '@/lib/hooks/useCommandPalette';
import { CommandPalette } from './CommandPalette';
import { JobDock } from './JobDock';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Application shell.
 *
 * Owns the responsive navigation (rail on desktop, sheet on mobile), the
 * command palette, the job dock and the scroll container for routed pages.
 */
export function AppLayout() {
  const [paletteOpen, setPaletteOpen] = useCommandPalette();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const location = useLocation();

  const { data: health } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: systemApi.health,
    refetchInterval: 20_000,
    retry: 2,
  });

  const { data: activeJobs } = useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: jobsApi.active,
    refetchInterval: 4000,
  });

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Auto-open the dock the first time a job starts.
  useEffect(() => {
    if ((activeJobs?.length ?? 0) > 0) setDockOpen(true);
  }, [activeJobs?.length]);

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block">
        <Sidebar engineAvailable={health?.engine_available ?? false} version={health?.version} />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
          <Sidebar
            className="animate-slide-up relative z-10"
            engineAvailable={health?.engine_available ?? false}
            version={health?.version}
            onNavigate={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          runningJobs={activeJobs?.length ?? 0}
          onOpenJobs={() => setDockOpen(true)}
          healthy={health ? health.status === 'ok' : null}
        />

        <main
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6',
            dockOpen ? 'pb-4' : 'pb-6',
          )}
        >
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>

        <JobDock open={dockOpen} onOpenChange={setDockOpen} />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
