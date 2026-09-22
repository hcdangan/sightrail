import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Database,
  Download,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Sparkles,
  Tag,
  Wand2,
} from 'lucide-react';

import { jobsApi, modesApi, modelsApi, uploadsApi } from '@/lib/api';
import type { DatasetEntry, JobSummary } from '@/lib/api-types';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { SourcePicker } from '@/components/input/SourcePicker';
import { emptySource, type SourceState } from '@/lib/sources';
import { useJobStream } from '@/lib/hooks/useWebSockets';
import { LogConsole } from '@/components/ui/LogConsole';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  Input,
  KeyValue,
  SectionTitle,
  SegmentedControl,
  Select,
  Slider,
} from '@/components/ui/primitives';

type Tab = 'browse' | 'annotate';

/**
 * Dataset hub.
 *
 * Two jobs in one page: inspect every dataset Ultralytics knows about (plus the
 * ones Sightrail has built), and bootstrap a brand-new dataset by pre-labelling
 * an image folder with a pretrained checkpoint — the fastest route from raw
 * images to a trainable YOLO dataset.
 */
export function DatasetsPage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'browse');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Data"
        title="Datasets & auto-annotation"
        description="Everything Ultralytics ships, plus a built-in labelling pipeline: point a pretrained model at a folder of images and get a YOLO-format dataset with a data.yaml ready for training."
        badges={[
          { label: 'COCO · VOC · DOTA · ImageNet', tone: 'brand' },
          { label: 'auto-label to YOLO format', tone: 'violet' },
        ]}
      />

      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'browse', label: 'Browse datasets', icon: <Database className="size-3.5" /> },
          { value: 'annotate', label: 'Auto-annotate', icon: <Wand2 className="size-3.5" /> },
        ]}
      />

      {tab === 'browse' ? <BrowseTab /> : <AnnotateTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ browse */

function BrowseTab() {
  const [taskFilter, setTaskFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<DatasetEntry | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['datasets'], queryFn: () => modesApi.datasets(), staleTime: 30_000 });
  const { data: preview } = useQuery({
    queryKey: ['datasets', selected?.id, 'preview'],
    queryFn: () => modesApi.datasetPreview(selected!.id),
    enabled: Boolean(selected?.path),
  });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.datasets ?? []).filter((entry) => {
      if (taskFilter && entry.task && entry.task !== taskFilter) return false;
      if (!needle) return true;
      return `${entry.id} ${entry.label} ${entry.note ?? ''}`.toLowerCase().includes(needle);
    });
  }, [data, taskFilter, query]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader
          icon={<Database className="size-4" />}
          title="Available datasets"
          description={`${rows.length} dataset descriptors. Those marked “downloads” are fetched by Ultralytics on first use.`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="Search…" value={query} onChange={(event) => setQuery(event.target.value)} className="w-40" />
              <Select
                value={taskFilter}
                onChange={(event) => setTaskFilter(event.target.value)}
                options={[
                  { value: '', label: 'All tasks' },
                  { value: 'detect', label: 'Detect' },
                  { value: 'segment', label: 'Segment' },
                  { value: 'classify', label: 'Classify' },
                  { value: 'pose', label: 'Pose' },
                  { value: 'obb', label: 'OBB' },
                ]}
              />
            </div>
          }
        />
        {isLoading ? (
          <p className="text-xs text-slate-500">Loading datasets…</p>
        ) : (
          <DataTable<DatasetEntry>
            dense
            rows={rows}
            getRowKey={(row) => row.id}
            onRowClick={setSelected}
            columns={[
              {
                key: 'label',
                header: 'Dataset',
                render: (row) => (
                  <div className="min-w-0">
                    <span className="block truncate text-xs text-slate-200">{row.label}</span>
                    <span className="block truncate font-mono text-[10px] text-slate-500">{row.id}</span>
                  </div>
                ),
              },
              { key: 'task', header: 'Task', render: (row) => (row.task ? <Badge tone="brand">{row.task}</Badge> : <span className="text-slate-600">—</span>) },
              { key: 'images', header: 'Images', align: 'right', render: (row) => <span className="font-mono text-xs">{row.images?.toLocaleString() ?? '—'}</span> },
              { key: 'classes', header: 'Classes', align: 'right', render: (row) => <span className="font-mono text-xs">{row.classes ?? '—'}</span> },
              {
                key: 'state',
                header: 'State',
                render: (row) => (
                  <span className="flex items-center gap-1.5">
                    {row.source === 'local' && <Badge tone="violet">local</Badge>}
                    {row.exists ? <Badge tone="success">on disk</Badge> : <Badge tone="neutral">downloads</Badge>}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>

      <div className="space-y-4">
        {selected ? (
          <>
            <Card>
              <CardHeader icon={<FolderOpen className="size-4" />} title={selected.label} description={selected.note ?? undefined} />
              <KeyValue
                columns={1}
                items={[
                  { label: 'Identifier', value: <span className="font-mono text-[11px]">{selected.id}</span> },
                  { label: 'Task', value: selected.task ?? 'inferred' },
                  { label: 'Images', value: selected.images?.toLocaleString() ?? 'unknown' },
                  { label: 'Classes', value: selected.classes ?? 'unknown' },
                  { label: 'YAML path', value: <span className="font-mono text-[11px] break-all">{selected.path ?? 'not present locally'}</span> },
                  { label: 'Source', value: selected.source },
                ]}
              />
              {!selected.exists && (
                <p className="mt-3 rounded-lg border border-warning-500/40 bg-warning-500/10 p-2 text-[11px] text-warning-300">
                  This dataset is not on disk yet. Ultralytics will download it the first time you train or validate with
                  it — expect that first run to take longer.
                </p>
              )}
              {selected.names && selected.names.length > 0 && (
                <>
                  <SectionTitle className="mt-4">Class names</SectionTitle>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {selected.names.slice(0, 120).map((name, index) => (
                      <Badge key={`${name}-${index}`} tone="neutral" className="font-mono text-[10px]">
                        <Tag className="size-2.5" /> {name}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {preview && (
              <Card>
                <CardHeader icon={<FileSpreadsheet className="size-4" />} title="data.yaml" description="The exact descriptor Ultralytics consumes." />
                <pre className="max-h-72 overflow-auto rounded-lg border border-ink-700/60 bg-ink-950/80 p-3 font-mono text-[11px] text-slate-300">
                  {JSON.stringify(preview.config, null, 2)}
                </pre>
              </Card>
            )}
          </>
        ) : (
          <EmptyState
            icon={<Database className="size-5" />}
            title="Select a dataset"
            description="Pick a row to inspect its descriptor, class list and download state."
          />
        )}

        <Card>
          <CardHeader icon={<HardDrive className="size-4" />} title="Built by Sightrail" description="Datasets produced by auto-annotation land in storage/datasets." />
          <LocalDatasets />
        </Card>
      </div>
    </div>
  );
}

function LocalDatasets() {
  const { data } = useQuery({ queryKey: ['datasets', 'local'], queryFn: modesApi.localDatasets, staleTime: 15_000 });
  const entries = data?.datasets ?? [];
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500">None yet — use the Auto-annotate tab to create one.</p>;
  }
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-ink-700/60 p-2.5">
          <p className="truncate text-xs text-slate-200">{entry.label}</p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
            <Badge tone="violet">{entry.task ?? 'detect'}</Badge>
            <span className="font-mono">{entry.images ?? 0} images</span>
            <span className="font-mono">{entry.classes ?? 0} classes</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- annotate */

function AnnotateTab() {
  const queryClient = useQueryClient();
  const device = usePreferences((state) => state.device);

  const [name, setName] = useState('my-dataset');
  const [model, setModel] = useState('yolo11n.pt');
  const [task, setTask] = useState('detect');
  const [conf, setConf] = useState(0.35);
  const [iou, setIou] = useState(0.7);
  const [valSplit, setValSplit] = useState(0.15);
  const [source, setSource] = useState<SourceState>(emptySource);
  const [job, setJob] = useState<JobSummary | null>(null);

  const stream = useJobStream(job?.id ?? null);

  const { data: catalog } = useQuery({ queryKey: ['models', 'catalog'], queryFn: () => modelsApi.catalog() });
  const { data: uploads } = useQuery({ queryKey: ['uploads', 'image'], queryFn: () => uploadsApi.list('image'), staleTime: 10_000 });

  const modelOptions = useMemo(
    () => (catalog?.models ?? []).filter((entry) => entry.task === task).map((entry) => ({ value: entry.id, label: entry.label })),
    [catalog, task],
  );

  const start = useMutation({
    mutationFn: () =>
      modesApi.annotate({
        name,
        model,
        task,
        device,
        conf,
        iou,
        val_split: valSplit,
        upload_ids: source.spec.upload_id ? uploadIdsFromSource(source) : [],
        paths: source.spec.path ? [source.spec.path] : [],
      }),
    onSuccess: (created) => {
      setJob(created);
      toast.success('Annotation job started', `Pre-labelling images into dataset “${name}”.`);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: Error) => toast.error('Could not start annotation', error.message),
  });

  const result = (stream.summary?.result ?? null) as
    | { name: string; root: string; data_yaml: string; stats: { images: number; annotated: number; objects: number; per_class: Record<string, number>; labels_written: number }; layout: string }
    | null;

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader
            icon={<Wand2 className="size-4" />}
            title="Auto-annotate"
            description="Run a pretrained model over your images and write YOLO label files automatically."
          />
          <div className="space-y-3">
            <Field label="Dataset name" hint="Lowercase letters, digits, dash and underscore only.">
              <Input value={name} onChange={(event) => setName(event.target.value.replace(/[^A-Za-z0-9_-]/g, '-'))} />
            </Field>
            <Field label="Task head" hint="The head determines the label format written.">
              <Select
                value={task}
                onChange={(event) => setTask(event.target.value)}
                options={[
                  { value: 'detect', label: 'Detection — class cx cy w h' },
                  { value: 'segment', label: 'Segmentation — polygons' },
                  { value: 'pose', label: 'Pose — boxes + 17 keypoints' },
                  { value: 'obb', label: 'OBB — rotated boxes' },
                ]}
              />
            </Field>
            <Field label="Labelling model">
              <Select value={model} onChange={(event) => setModel(event.target.value)} options={modelOptions} />
            </Field>
            <Slider label="Confidence threshold" min={0.05} max={0.9} step={0.05} value={conf} onChange={setConf} format={(v) => v.toFixed(2)} hint="Higher = fewer but cleaner labels." />
            <Slider label="IoU (NMS)" min={0.3} max={0.9} step={0.05} value={iou} onChange={setIou} format={(v) => v.toFixed(2)} />
            <Slider
              label="Validation split"
              min={0}
              max={0.4}
              step={0.05}
              value={valSplit}
              onChange={setValSplit}
              format={(v) => `${Math.round(v * 100)}%`}
              hint="Images are divided into train/ and val/ folders."
            />
          </div>
        </Card>

        <Card>
          <CardHeader icon={<ImageIcon className="size-4" />} title="Image source" description="Upload images or point at a folder on the API host." />
          <SourcePicker value={source} onChange={setSource} accept="image" allowMultiple allowFolder manageUploads={false} />
          <p className="mt-3 text-[11px] text-slate-500">
            {uploads?.uploads.length ?? 0} image(s) in the upload library. Selecting an upload uses every image stored in
            that upload.
          </p>
        </Card>

        <Button
          variant="primary"
          size="lg"
          block
          icon={<Sparkles className="size-4" />}
          loading={start.isPending}
          disabled={!model || (!source.spec.upload_id && !source.spec.path)}
          onClick={() => start.mutate()}
        >
          Build dataset “{name}”
        </Button>
      </div>

      <div className="min-w-0 space-y-4">
        {job ? (
          <Card>
            <CardHeader
              icon={<Layers className="size-4" />}
              title="Labelling console"
              description="Each image is inferred and written out as a YOLO label file."
              actions={
                (stream.summary?.status === 'running' || stream.summary?.status === 'queued') && (
                  <Button size="sm" variant="danger" onClick={() => jobsApi.cancel(job.id)}>
                    Cancel
                  </Button>
                )
              }
            />
            <LogConsole events={stream.events} percent={stream.summary?.percent} status={stream.summary?.status} height="h-72" />
          </Card>
        ) : (
          <EmptyState
            className="h-64"
            icon={<Wand2 className="size-5" />}
            title="Nothing labelled yet"
            description="Choose a source and a model, then build the dataset. You get storage/datasets/<name>/ with images/, labels/ and a data.yaml you can train on immediately."
          />
        )}

        {result && (
          <>
            <Card className="border-success-500/40">
              <CardHeader icon={<Sparkles className="size-4" />} title="Dataset ready" description={result.layout} />
              <div className="grid gap-3 sm:grid-cols-4">
                <Metric label="Images processed" value={result.stats.images} />
                <Metric label="With labels" value={result.stats.annotated} />
                <Metric label="Objects labelled" value={result.stats.objects} />
                <Metric label="Label files" value={result.stats.labels_written} />
              </div>
              <KeyValue
                className="mt-4"
                columns={1}
                items={[
                  { label: 'Dataset root', value: <span className="font-mono text-[11px] break-all">{result.root}</span> },
                  { label: 'data.yaml', value: <span className="font-mono text-[11px] break-all">{result.data_yaml}</span> },
                ]}
              />
            </Card>

            {Object.keys(result.stats.per_class).length > 0 && (
              <Card>
                <CardHeader icon={<Tag className="size-4" />} title="Labels per class" description="What the model found while pre-labelling." />
                <ul className="space-y-2">
                  {Object.entries(result.stats.per_class)
                    .slice(0, 24)
                    .map(([className, count]) => {
                      const max = Math.max(...Object.values(result.stats.per_class));
                      return (
                        <li key={className}>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-300">{className}</span>
                            <span className="font-mono text-slate-500">{count}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700/80">
                            <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-violet-glow" style={{ width: `${(count / max) * 100}%` }} />
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </Card>
            )}

            <Card className="border-brand-500/30">
              <CardHeader title="Train on it now" description="The generated data.yaml drops straight into Train mode." />
              <div className="flex flex-wrap gap-2">
                <a href={`/train?dataset=${encodeURIComponent(result.data_yaml)}`}>
                  <Button size="sm" variant="primary" icon={<Download className="size-3.5" />}>
                    Open Train with this dataset
                  </Button>
                </a>
              </div>
            </Card>
          </>
        )}

        <Card>
          <CardHeader icon={<FileSpreadsheet className="size-4" />} title="Label formats" description="What each task head writes into labels/." />
          <ul className="space-y-1.5 font-mono text-[11px] text-slate-400">
            <li>detect → <span className="text-slate-200">class cx cy w h</span> (normalised)</li>
            <li>segment → <span className="text-slate-200">class x1 y1 x2 y2 …</span> (normalised polygon)</li>
            <li>pose → <span className="text-slate-200">class cx cy w h px1 py1 v1 …</span> (17 keypoints, v=visibility)</li>
            <li>obb → <span className="text-slate-200">class cx cy w h angle</span> (normalised)</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={cn('rounded-lg border border-ink-700/60 bg-ink-900/50 p-3')}>
      <p className="text-[10px] tracking-wider text-slate-500 uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-lg text-slate-100">{value.toLocaleString()}</p>
    </div>
  );
}

function uploadIdsFromSource(source: SourceState): string[] {
  return source.spec.upload_id ? [source.spec.upload_id] : [];
}
