import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, CloudDownload, Cpu, HardDrive, Info, Layers, Zap } from 'lucide-react';

import { modelsApi } from '@/lib/api';
import type { CatalogModel } from '@/lib/api-types';
import { TASK_META } from '@/lib/navigation';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { cn, formatBytes, formatNumber, formatRelativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  KeyValue,
  SectionTitle,
  SegmentedControl,
  Skeleton,
  Tooltip,
} from '@/components/ui/primitives';

/**
 * Model zoo.
 *
 * Every checkpoint family Ultralytics ships (YOLO11, YOLOv8, YOLOv9, YOLOv10,
 * YOLO12, RT-DETR, SAM2, FastSAM…), the local weight library, and a live view of
 * what is resident in the API's model cache.
 */
export function ModelsPage() {
  const queryClient = useQueryClient();
  const device = usePreferences((state) => state.device);

  const [taskFilter, setTaskFilter] = useState<'all' | keyof typeof TASK_META>('all');
  const [familyFilter, setFamilyFilter] = useState('');
  const [inspecting, setInspecting] = useState<string | null>(null);

  const { data: catalog, isLoading } = useQuery({
    queryKey: ['models', 'catalog'],
    queryFn: () => modelsApi.catalog(),
    staleTime: 300_000,
  });
  const { data: local } = useQuery({ queryKey: ['models', 'local'], queryFn: modelsApi.local, refetchInterval: 20_000 });
  const { data: registry } = useQuery({ queryKey: ['models', 'registry'], queryFn: modelsApi.registry, refetchInterval: 10_000 });
  const { data: info } = useQuery({
    queryKey: ['models', 'info', inspecting, device],
    queryFn: () => modelsApi.info(inspecting!, device),
    enabled: Boolean(inspecting),
    retry: false,
    staleTime: 300_000,
  });

  const download = useMutation({
    mutationFn: (modelId: string) => modelsApi.download(modelId),
    onSuccess: (data) => {
      toast.success('Checkpoint downloaded', `${data.model} · ${formatBytes(data.size_bytes)}`);
      queryClient.invalidateQueries({ queryKey: ['models', 'local'] });
      queryClient.invalidateQueries({ queryKey: ['models', 'catalog'] });
    },
    onError: (error: Error) => toast.error('Download failed', error.message),
  });

  const evict = useMutation({
    mutationFn: (model?: string) => modelsApi.evict(model),
    onSuccess: (data) => {
      toast.info(`Evicted ${data.evicted} model(s) from memory`);
      queryClient.invalidateQueries({ queryKey: ['models', 'registry'] });
    },
  });

  const rows = useMemo(() => {
    const needle = familyFilter.trim().toLowerCase();
    return (catalog?.models ?? []).filter((entry) => {
      if (taskFilter !== 'all' && entry.task !== taskFilter) return false;
      if (needle && !entry.family.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [catalog, taskFilter, familyFilter]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Models"
        title="Model zoo & weight library"
        description="Browse every checkpoint Ultralytics publishes, download what you need, inspect its architecture, and manage the in-process cache that makes repeated inference instant."
        badges={[
          { label: `${catalog?.models.length ?? 0} catalog checkpoints`, tone: 'brand' },
          { label: `${local?.models.length ?? 0} on disk`, tone: 'success' },
          { label: `${registry?.loaded.length ?? 0} loaded in memory`, tone: 'violet' },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<HardDrive className="size-4" />}
              onClick={() => window.open('/api/models/local', '_blank')}
            >
              Raw list
            </Button>
            <Button variant="ghost" icon={<Cpu className="size-4" />} onClick={() => evict.mutate(undefined)} loading={evict.isPending}>
              Flush cache
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              icon={<Boxes className="size-4" />}
              title="Catalog"
              description="Sizes run n (nano) → x (extra large). Bigger means more accuracy and more compute."
              actions={
                <input
                  value={familyFilter}
                  onChange={(event) => setFamilyFilter(event.target.value)}
                  placeholder="Filter family…"
                  className="h-8 w-32 rounded-lg border border-ink-600/80 bg-ink-900/80 px-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-brand-400/70 focus:outline-none"
                />
              }
            />
            <SegmentedControl
              size="sm"
              className="mb-3"
              value={taskFilter}
              onChange={setTaskFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'detect', label: 'Detect' },
                { value: 'segment', label: 'Segment' },
                { value: 'classify', label: 'Classify' },
                { value: 'pose', label: 'Pose' },
                { value: 'obb', label: 'OBB' },
              ]}
            />

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-10" />
                ))}
              </div>
            ) : (
              <DataTable<CatalogModel>
                dense
                rows={rows.slice(0, 400)}
                getRowKey={(row) => row.id}
                columns={[
                  {
                    key: 'id',
                    header: 'Checkpoint',
                    render: (row) => (
                      <button
                        type="button"
                        onClick={() => setInspecting(row.id)}
                        className="text-left font-mono text-xs text-slate-200 hover:text-brand-200"
                      >
                        {row.id}
                      </button>
                    ),
                  },
                  {
                    key: 'task',
                    header: 'Task',
                    render: (row) => (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: TASK_META[row.task]?.accent }} />
                        <span className="text-[11px] text-slate-400">{TASK_META[row.task]?.short ?? row.task}</span>
                      </span>
                    ),
                  },
                  { key: 'size', header: 'Size', render: (row) => <Badge tone="neutral">{row.size}</Badge> },
                  {
                    key: 'params',
                    header: 'Params',
                    align: 'right',
                    render: (row) => <span className="font-mono text-[11px] text-slate-400">{row.approx_params_m ? `${row.approx_params_m}M` : '—'}</span>,
                  },
                  {
                    key: 'state',
                    header: 'State',
                    render: (row) => (row.downloaded ? <Badge tone="success">on disk</Badge> : <Badge tone="neutral">remote</Badge>),
                  },
                  {
                    key: 'actions',
                    header: '',
                    align: 'right',
                    render: (row) => (
                      <span className="flex items-center justify-end gap-1">
                        <Tooltip label="Inspect architecture">
                          <Button size="xs" variant="ghost" icon={<Info className="size-3" />} onClick={() => setInspecting(row.id)} />
                        </Tooltip>
                        <Tooltip label={row.downloaded ? 'Re-download' : 'Download checkpoint'}>
                          <Button
                            size="xs"
                            variant="ghost"
                            icon={<CloudDownload className="size-3" />}
                            loading={download.isPending && download.variables === row.id}
                            onClick={() => download.mutate(row.id)}
                          />
                        </Tooltip>
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={<Info className="size-4" />} title="Inspector" description="Loads the checkpoint and reports its real architecture." />
            {!inspecting ? (
              <p className="text-xs text-slate-500">Pick a checkpoint from the table to inspect it.</p>
            ) : info ? (
              <>
                <p className="mb-3 font-mono text-xs break-all text-slate-200">{info.path}</p>
                <KeyValue
                  columns={2}
                  items={[
                    { label: 'Task', value: <Badge tone="brand">{info.task}</Badge> },
                    { label: 'Classes', value: info.classes },
                    { label: 'Layers', value: formatNumber(info.info.layers) },
                    { label: 'Parameters', value: info.info.parameters ? formatNumber(info.info.parameters) : '—' },
                    { label: 'Gradients', value: formatNumber(info.info.gradients) },
                    { label: 'GFLOPs', value: info.info.gflops ? info.info.gflops.toFixed(1) : '—' },
                    { label: 'Device', value: info.device },
                    { label: 'Size on disk', value: formatBytes(local?.models.find((entry) => entry.id === inspecting)?.size_bytes) },
                  ]}
                />
                {info.classes > 0 && (
                  <>
                    <SectionTitle className="mt-4">First classes</SectionTitle>
                    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                      {Object.entries(info.names)
                        .slice(0, 60)
                        .map(([id, name]) => (
                          <Badge key={id} tone="neutral" className="font-mono text-[10px]">
                            {id}: {name}
                          </Badge>
                        ))}
                    </div>
                  </>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to={`/predict?model=${encodeURIComponent(inspecting)}`}>
                    <Button size="sm" variant="primary">
                      Predict
                    </Button>
                  </Link>
                  <Link to={`/export?model=${encodeURIComponent(inspecting)}`}>
                    <Button size="sm" variant="secondary">
                      Export
                    </Button>
                  </Link>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">Loading model metadata…</p>
            )}
          </Card>

          <Card>
            <CardHeader
              icon={<Zap className="size-4" />}
              title="Resident in memory"
              description={`LRU cache of ${registry?.capacity ?? 0} models — hits reuse loaded weights.`}
            />
            {!registry || registry.loaded.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing loaded yet.</p>
            ) : (
              <ul className="space-y-2">
                {registry.loaded.map((entry) => (
                  <li key={entry.key} className="rounded-lg border border-ink-700/60 p-2.5">
                    <p className="truncate font-mono text-[11px] text-slate-200">{entry.path.split(/[\\/]/).pop()}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                      <Badge tone="brand">{entry.task}</Badge>
                      <span>{entry.classes} classes</span>
                      <span className="font-mono">{entry.hits} hits</span>
                      <span className="font-mono">resident {Math.round(entry.resident_s)}s</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {registry && registry.loaded.length > 0 && (
              <Button size="sm" variant="ghost" className="mt-3" block onClick={() => evict.mutate(undefined)}>
                Evict all
              </Button>
            )}
          </Card>

          <Card>
            <CardHeader icon={<HardDrive className="size-4" />} title="Local library" description={local?.weights_dir} />
            {!local || local.models.length === 0 ? (
              <p className="text-xs text-slate-500">No checkpoints on disk yet.</p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {local.models.map((entry) => (
                  <li key={entry.path} className="flex items-center gap-2 rounded-lg border border-ink-700/60 px-2.5 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-slate-200">{entry.id}</span>
                      <span className="block text-[10px] text-slate-500">
                        {formatBytes(entry.size_bytes)} · {formatRelativeTime(entry.modified)}
                      </span>
                    </span>
                    {entry.exported && <Badge tone="violet">exported</Badge>}
                    <Link to={`/predict?model=${encodeURIComponent(entry.path)}`}>
                      <Button size="xs" variant="ghost">
                        Use
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader icon={<Layers className="size-4" />} title="Task families" description="Each family ships a dedicated head." />
            <ul className="space-y-1.5">
              {Object.entries(TASK_META).map(([task, meta]) => (
                <li key={task} className={cn('flex items-center gap-2 rounded-lg border border-ink-700/60 px-2.5 py-2')}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: meta.accent }} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{meta.label}</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {(catalog?.models ?? []).filter((entry) => entry.task === task).length}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
