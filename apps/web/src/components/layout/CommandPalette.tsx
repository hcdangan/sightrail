import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react';

import { NAV_ITEMS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Command palette (Ctrl/Cmd-K).
 *
 * Searches the navigation tree plus a set of inline "quick actions" that route
 * with query parameters, so power users can jump straight into a task.
 */
const QUICK_ACTIONS = [
  { label: 'How do I run this?', path: '/help', keywords: ['help', 'start', 'run', 'install', 'npm', 'docs', 'guide'] },
  { label: 'Troubleshoot a problem', path: '/help#troubleshooting', keywords: ['help', 'error', 'broken', 'fix', 'problem'] },
  { label: 'Change the compute device', path: '/system#device', keywords: ['cpu', 'cuda', 'gpu', 'hailo', 'device'] },
  { label: 'Run detection on a sample image', path: '/predict?task=detect&sample=bus.jpg', keywords: ['sample', 'bus'] },
  { label: 'Run pose estimation on a sample image', path: '/predict?task=pose&sample=zidane.jpg', keywords: ['pose', 'zidane'] },
  { label: 'Open Live Studio with the webcam', path: '/studio?source=webcam', keywords: ['camera', 'live'] },
  { label: 'Start a COCO8 training run', path: '/train?dataset=coco8.yaml', keywords: ['train', 'coco8'] },
  { label: 'Export the default model to ONNX', path: '/export?format=onnx', keywords: ['onnx', 'export'] },
  { label: 'Benchmark ONNX vs OpenVINO', path: '/benchmark', keywords: ['benchmark', 'compare'] },
  { label: 'Auto-annotate uploaded images', path: '/datasets?tab=annotate', keywords: ['annotate', 'label'] },
  { label: 'Inspect the environment', path: '/system', keywords: ['gpu', 'cuda', 'torch'] },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = [
      ...QUICK_ACTIONS.map((action) => ({ ...action, group: 'Actions', icon: <ArrowRight className="size-3.5" /> })),
      ...NAV_ITEMS.map((item) => ({
        label: item.label,
        path: item.path,
        keywords: [...(item.keywords ?? []), item.description],
        group: 'Pages',
        icon: <item.icon className="size-3.5" />,
      })),
    ];
    if (!needle) return items.slice(0, 9);
    return items
      .filter((item) => {
        const haystack = [item.label, ...(item.keywords ?? [])].join(' ').toLowerCase();
        return needle.split(/\s+/).every((token) => haystack.includes(token));
      })
      .slice(0, 12);
  }, [query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((value) => Math.min(value + 1, results.length - 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((value) => Math.max(value - 1, 0));
      }
      if (event.key === 'Enter' && results[cursor]) {
        navigate(results[cursor].path);
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, cursor, navigate, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-ink-950/70 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="panel animate-slide-up w-full max-w-xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink-700/60 px-4 py-3">
          <Search className="size-4 text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages and actions…"
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            esc
          </kbd>
        </div>

        <ul className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-500">No matches.</li>}
          {results.map((item, index) => (
            <li key={`${item.group}-${item.path}-${item.label}`}>
              <button
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => {
                  navigate(item.path);
                  onOpenChange(false);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                  index === cursor ? 'bg-brand-500/12 text-slate-100' : 'text-slate-300 hover:bg-ink-700/50',
                )}
              >
                <span className={cn('shrink-0', index === cursor ? 'text-brand-300' : 'text-slate-500')}>{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{item.label}</span>
                  <span className="block truncate font-mono text-[10px] text-slate-500">{item.path}</span>
                </span>
                <span className="shrink-0 text-[10px] tracking-wider text-slate-600 uppercase">{item.group}</span>
                {index === cursor && <CornerDownLeft className="size-3.5 shrink-0 text-slate-500" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

