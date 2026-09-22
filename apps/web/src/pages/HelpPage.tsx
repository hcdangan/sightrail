import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Info,
  Keyboard,
  LifeBuoy,
  Lightbulb,
  RefreshCw,
  Rocket,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';

import { API_BASE, inferApi, systemApi } from '@/lib/api';
import {
  GETTING_STARTED,
  HELP_INTRO,
  HELP_SECTIONS,
  IMPORTANT_NOTES,
  PROCESSES,
  REFERENCE_LINKS,
  REPO_DOCS,
  SHORTCUTS,
  TOUR,
  TROUBLESHOOTING,
  WORKFLOW,
} from '@/lib/help-content';
import { toast } from '@/lib/stores/toasts';
import { cn, copyToClipboard } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Button, Card, CardHeader, SectionTitle, Skeleton } from '@/components/ui/primitives';

/**
 * In-app help.
 *
 * The same guidance as `README.md` and `docs/DEVELOPMENT.md`, reachable without
 * leaving the interface, plus a live diagnostics block that reflects *this*
 * running process rather than what the docs assume.
 */
export function HelpPage() {
  const { hash } = useLocation();
  const { data: health } = useQuery({ queryKey: ['system', 'health'], queryFn: systemApi.health, retry: 1 });
  const { data: deviceConfig } = useQuery({
    queryKey: ['system', 'device-config'],
    queryFn: systemApi.deviceConfig,
    staleTime: 30_000,
  });
  const { data: defaults } = useQuery({ queryKey: ['infer', 'defaults'], queryFn: inferApi.defaults, staleTime: 300_000 });

  // Deep links such as /help#troubleshooting (used by the command palette).
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  const uiOrigin = typeof window !== 'undefined' ? window.location.origin : PROCESSES[0].url;
  const apiOrigin = API_BASE || (typeof window !== 'undefined' ? window.location.origin : PROCESSES[1].url);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Help"
        title={HELP_INTRO.title}
        description={HELP_INTRO.lead}
        badges={[
          { label: `UI ${uiOrigin}`, tone: 'brand' },
          { label: `API ${apiOrigin}`, tone: 'neutral' },
          health
            ? { label: health.engine_available ? 'engine ready' : 'engine unavailable', tone: health.engine_available ? 'success' : 'danger' }
            : { label: 'checking API…', tone: 'neutral' },
        ]}
        actions={
          <Link to="/predict">
            <Button variant="primary" icon={<Rocket className="size-4" />}>
              Try it now
            </Button>
          </Link>
        }
      />

      <SectionNav />

      <LiveDiagnostics
        healthy={health ? health.status === 'ok' : null}
        engineAvailable={health?.engine_available}
        version={health?.version}
        resolvedDevice={deviceConfig?.resolved}
        configuredDevice={deviceConfig?.configured}
        envFileExists={deviceConfig?.env_file_exists}
        defaultModel={defaults?.model}
      />

      {/* ------------------------------------------------------------ start */}
      <section id="start" className="scroll-mt-20">
        <Card>
          <CardHeader
            icon={<Rocket className="size-4" />}
            title="Getting started"
            description="Three commands cover every situation. Copy them straight into a terminal."
          />
          <div className="grid gap-3 lg:grid-cols-3">
            {GETTING_STARTED.map((block) => (
              <CommandBlockView key={block.title} title={block.title} lines={block.lines} />
            ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {IMPORTANT_NOTES.map((note) => (
              <p key={note} className="flex items-start gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 p-2.5 text-[11px] leading-relaxed text-slate-400">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning-400" />
                <span>{note}</span>
              </p>
            ))}
          </div>

          <SectionTitle className="mt-5" hint="in this order">
            Suggested first run
          </SectionTitle>
          <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW.map((step, index) => (
              <li key={step.title} className="rounded-lg border border-ink-700/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full border border-brand-500/40 bg-brand-500/10 font-mono text-[10px] text-brand-300">
                    {index + 1}
                  </span>
                  <p className="text-xs font-medium text-slate-200">{step.title}</p>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{step.detail}</p>
                <Link to={step.to} className="mt-2 inline-flex items-center gap-1 text-[11px] text-brand-300 hover:underline">
                  {step.toLabel} <ArrowRight className="size-3" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      {/* -------------------------------------------------------- processes */}
      <section id="processes" className="scroll-mt-20">
        <Card>
          <CardHeader
            icon={<Terminal className="size-4" />}
            title="What is running"
            description="npm run dev starts both processes. The browser talks to the API through the UI's dev proxy, so they share one origin."
          />
          <ul className="space-y-2">
            {PROCESSES.map((process) => {
              const live = process.url.includes('5173') ? uiOrigin : apiOrigin;
              return (
                <li key={process.label} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-700/60 px-3 py-2.5">
                  <span className="w-40 shrink-0 text-xs font-medium text-slate-200">{process.label}</span>
                  <a
                    href={process.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-[11px] text-brand-300 hover:underline"
                  >
                    {process.url}
                    <ExternalLink className="size-3" />
                  </a>
                  <span className="ml-auto text-[11px] text-slate-500">{process.note}</span>
                  {live !== process.url && <Badge tone="neutral">this session: {live}</Badge>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 p-2.5 text-[11px] leading-relaxed text-slate-400">
            <Info className="mt-0.5 size-3.5 shrink-0 text-brand-300" />
            <span>
              Stopping the terminal stops both. Starting a second server will not update this page — the UI you are
              reading is served by the process on {uiOrigin}.
            </span>
          </p>
        </Card>
      </section>

      {/* ------------------------------------------------------------- tour */}
      <section id="tour" className="scroll-mt-20">
        <Card>
          <CardHeader
            icon={<LifeBuoy className="size-4" />}
            title="What each page does"
            description="Eleven pages, one per Ultralytics mode or data concern. Click any of them to go straight there."
          />
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {TOUR.map((stop) => (
              <Link
                key={stop.path}
                to={stop.path}
                className="panel panel-hover group rounded-lg border-ink-700/60 p-3 hover:border-brand-500/40"
              >
                <div className="flex items-start gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-ink-600/70 bg-ink-800/70 text-brand-300">
                    <stop.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 text-xs font-semibold text-slate-100">
                      {stop.label}
                      <ArrowRight className="size-3 text-slate-500 transition-transform group-hover:translate-x-0.5" />
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{stop.what}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      {/* ----------------------------------------------------------- device */}
      <section id="device" className="scroll-mt-20">
        <Card>
          <CardHeader
            icon={<Wrench className="size-4" />}
            title="Choosing the compute device"
            description="One variable decides where inference runs. The durable default lives in .env; the header selector overrides it per session."
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <p className="text-[11px] leading-relaxed text-slate-400">
                Copy <code className="rounded bg-ink-800 px-1 font-mono text-brand-300">.env.example</code> to{' '}
                <code className="rounded bg-ink-800 px-1 font-mono text-brand-300">.env</code>, uncomment one line, and
                restart the API. Accepted values include{' '}
                <span className="font-mono text-slate-300">auto</span>,{' '}
                <span className="font-mono text-slate-300">cpu</span>,{' '}
                <span className="font-mono text-slate-300">cuda:0</span>,{' '}
                <span className="font-mono text-slate-300">mps</span> and{' '}
                <span className="font-mono text-slate-300">hailo</span>.
              </p>
              {deviceConfig ? (
                <CommandBlockView
                  title=".env device switch"
                  language="ini"
                  lines={deviceConfig.snippet
                    .split('\n')
                    .filter((line) => line.trim().length > 0)
                    .map((line) => ({ command: line, detail: '' }))}
                />
              ) : (
                <Skeleton className="h-32" />
              )}
            </div>

            <div className="space-y-3">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-ink-700/70 text-left text-[10px] tracking-wider text-slate-500 uppercase">
                    <th className="pb-1.5">Profile</th>
                    <th className="pb-1.5">Modes</th>
                    <th className="pb-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(deviceConfig?.devices ?? []).map((profile) => (
                    <tr key={profile.id} className="border-b border-ink-800/60 last:border-0">
                      <td className="py-1.5 pr-2">
                        <span className="font-mono text-slate-300">{profile.id}</span>
                        {deviceConfig?.resolved === profile.id && <Badge tone="brand" className="ml-1.5">active</Badge>}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-400">
                        {profile.supports_training ? 'train + infer' : 'inference only'}
                      </td>
                      <td className="py-1.5">
                        {profile.available ? (
                          <span className="flex items-center gap-1 text-success-400">
                            <CheckCircle2 className="size-3" /> ready
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-slate-500">
                            <XCircle className="size-3" /> unavailable
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!deviceConfig && (
                    <tr>
                      <td colSpan={3} className="py-2">
                        <Skeleton className="h-16" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <p className="flex items-start gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 p-2.5 text-[11px] leading-relaxed text-slate-400">
                <Info className="mt-0.5 size-3.5 shrink-0 text-brand-300" />
                <span>
                  Hailo is an inference target: compiled HEF networks have no backward pass, so Train and Val must run on
                  CPU or CUDA. HEF compilation needs the Hailo Dataflow Compiler on Linux x86_64.
                </span>
              </p>

              <Link to="/system">
                <Button size="sm" variant="secondary" block icon={<Wrench className="size-3.5" />}>
                  Open the full device panel
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </section>

      {/* -------------------------------------------------------- shortcuts */}
      <section id="shortcuts" className="scroll-mt-20">
        <Card>
          <CardHeader icon={<Keyboard className="size-4" />} title="Keyboard shortcuts" description="Everything the UI answers to." />
          <ul className="grid gap-2 sm:grid-cols-2">
            {SHORTCUTS.map((shortcut) => (
              <li key={shortcut.action} className="flex items-center gap-3 rounded-lg border border-ink-700/60 px-3 py-2">
                <span className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={key}
                      className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
                <span className="text-[11px] leading-relaxed text-slate-400">{shortcut.action}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* -------------------------------------------------- troubleshooting */}
      <section id="troubleshooting" className="scroll-mt-20">
        <Card>
          <CardHeader
            icon={<Wrench className="size-4" />}
            title="Troubleshooting"
            description="The failures people actually hit, and what to do about each one."
          />
          <ul className="space-y-2">
            {TROUBLESHOOTING.map((entry) => (
              <li key={entry.symptom} className="rounded-lg border border-ink-700/60 p-3">
                <p className="text-xs font-medium text-slate-200">{entry.symptom}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{entry.fix}</p>
                {entry.to && (
                  <Link to={entry.to} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-brand-300 hover:underline">
                    {entry.toLabel} <ArrowRight className="size-3" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 p-2.5 text-[11px] leading-relaxed text-slate-400">
            <FileText className="mt-0.5 size-3.5 shrink-0 text-brand-300" />
            <span>
              The same list, with more detail and platform-specific commands, is in{' '}
              <span className="font-mono text-slate-300">README.md</span> and{' '}
              <span className="font-mono text-slate-300">docs/DEVELOPMENT.md</span> in the repository.
            </span>
          </p>
        </Card>
      </section>

      {/* -------------------------------------------------------- reference */}
      <section id="reference" className="scroll-mt-20">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader icon={<Terminal className="size-4" />} title="API reference" description="Generated from the running service." />
            <ul className="space-y-2">
              {REFERENCE_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-ink-700/60 px-3 py-2 transition-colors hover:border-brand-500/40 hover:bg-ink-800/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-slate-200">{link.label}</span>
                      <span className="block truncate text-[10px] text-slate-500">{link.note}</span>
                    </span>
                    <ExternalLink className="size-3 shrink-0 text-slate-500" />
                  </a>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              icon={<FileText className="size-4" />}
              title="Repository documentation"
              description="Deep dives live in the repo. Paths are relative to the project root."
            />
            <ul className="space-y-2">
              {REPO_DOCS.map((doc) => (
                <li key={doc.path} className="flex items-start gap-3 rounded-lg border border-ink-700/60 px-3 py-2">
                  <doc.icon className="mt-0.5 size-3.5 shrink-0 text-brand-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[11px] text-slate-200">{doc.path}</span>
                    <span className="block text-[10px] text-slate-500">{doc.note}</span>
                  </span>
                </li>
              ))}
            </ul>
            {deviceConfig && (
              <>
                <SectionTitle className="mt-4">Your configuration files</SectionTitle>
                <div className="space-y-1.5">
                  <PathRow path={deviceConfig.env_example} exists label="template (committed)" />
                  <PathRow path={deviceConfig.env_file} exists={deviceConfig.env_file_exists} label="active" />
                </div>
              </>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- sub-components */

function SectionNav() {
  const [active, setActive] = useState<string>(HELP_SECTIONS[0].id);

  const jump = (id: string) => {
    setActive(id);
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav aria-label="Help sections" className="sticky top-14 z-30 -mx-1 flex flex-wrap gap-1 rounded-xl border border-ink-700/70 bg-ink-900/85 p-1.5 backdrop-blur-xl">
      {HELP_SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => jump(section.id)}
          aria-current={active === section.id ? 'true' : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            active === section.id ? 'bg-brand-500/15 text-brand-100' : 'text-slate-400 hover:bg-ink-700/60 hover:text-slate-200',
          )}
        >
          <section.icon className="size-3.5" />
          {section.label}
        </button>
      ))}
    </nav>
  );
}

/** Live status of *this* process, so the guide can be honest about the runtime. */
function LiveDiagnostics({
  healthy,
  engineAvailable,
  version,
  resolvedDevice,
  configuredDevice,
  envFileExists,
  defaultModel,
}: {
  healthy: boolean | null;
  engineAvailable?: boolean;
  version?: string;
  resolvedDevice?: string;
  configuredDevice?: string;
  envFileExists?: boolean;
  defaultModel?: string;
}) {
  const checks = [
    {
      label: 'API reachable',
      ok: healthy === true,
      detail: healthy === null ? 'checking…' : healthy ? 'health endpoint returned ok' : 'no response from /api/health',
    },
    {
      label: 'Ultralytics engine',
      ok: engineAvailable === true,
      detail: engineAvailable ? 'imported and ready' : engineAvailable === false ? 'not importable — run npm run bootstrap' : 'checking…',
    },
    {
      label: 'Device resolved',
      ok: Boolean(resolvedDevice),
      detail: resolvedDevice ? `${configuredDevice} → ${resolvedDevice}` : 'checking…',
    },
    {
      label: '.env file',
      ok: envFileExists === true,
      detail: envFileExists ? 'present (settings loaded)' : 'absent — copy .env.example to .env',
    },
  ];

  return (
    <Card>
      <CardHeader
        icon={<Info className="size-4" />}
        title="This session"
        description="Live checks from the process serving this page, not assumptions from the docs."
        actions={
          <Badge tone={version ? 'success' : 'neutral'}>{version ? `v${version}` : 'version unknown'}</Badge>
        }
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {checks.map((check) => (
          <div key={check.label} className="rounded-lg border border-ink-700/60 bg-ink-900/50 p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-200">
              {check.ok ? (
                <CheckCircle2 className="size-3.5 text-success-400" />
              ) : (
                <XCircle className="size-3.5 text-slate-500" />
              )}
              {check.label}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed break-words text-slate-500">{check.detail}</p>
          </div>
        ))}
      </div>
      {defaultModel && (
        <p className="mt-3 text-[11px] text-slate-500">
          Default checkpoint: <span className="font-mono text-slate-300">{defaultModel}</span> · the first prediction
          downloads it into <span className="font-mono text-slate-300">storage/weights</span>.
        </p>
      )}
    </Card>
  );
}

function CommandBlockView({
  title,
  lines,
  language = 'bash',
}: {
  title: string;
  lines: { command: string; detail: string }[];
  language?: string;
}) {
  return (
    <div className="rounded-lg border border-ink-700/70 bg-ink-950/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{title}</span>
        <Button
          size="xs"
          variant="ghost"
          icon={<Copy className="size-3" />}
          onClick={() => {
            void copyToClipboard(lines.map((line) => line.command).join('\n'));
            toast.success('Copied', `${lines.length} line${lines.length === 1 ? '' : 's'} to the clipboard`);
          }}
        >
          Copy
        </Button>
      </div>
      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.command}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-slate-600 select-none">
                {language === 'bash' ? '$' : ''}
              </span>
              <code className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-brand-200">
                {line.command}
              </code>
            </div>
            {line.detail && <p className="mt-0.5 pl-4 text-[10px] leading-relaxed text-slate-500">{line.detail}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PathRow({ path, exists, label }: { path: string; exists: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-ink-700/60 px-2.5 py-1.5">
      {exists ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-success-400" />
      ) : (
        <RefreshCw className="size-3.5 shrink-0 text-slate-500" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-400">{path}</span>
      <span className="shrink-0 text-[10px] text-slate-600">{label}</span>
    </div>
  );
}
