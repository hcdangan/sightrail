import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GraduationCap,
  Info,
  Layers,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Timer,
  Wand2,
} from 'lucide-react';

import { jobsApi, modesApi, modelsApi } from '@/lib/api';
import type { JobSummary, TrainingResult } from '@/lib/api-types';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { cn, formatDuration, formatScore } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { DeviceSelect } from '@/components/system/DeviceSelect';
import { useJobStream } from '@/lib/hooks/useWebSockets';
import { LogConsole } from '@/components/ui/LogConsole';
import { LineChart } from '@/components/charts/LineChart';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  KeyValue,
  ProgressBar,
  SegmentedControl,
  Select,
  Slider,
  Switch,
} from '@/components/ui/primitives';

type PresetId = 'smoke' | 'quick' | 'balanced' | 'accurate';

/** Named training recipes - the fastest way to get a useful model. */
const PRESETS: Record<
  PresetId,
  { label: string; description: string; epochs: number; imgsz: number; batch: number; patience: number }
> = {
  smoke: {
    label: 'Smoke test',
    description: 'A few epochs to prove the pipeline works end to end.',
    epochs: 3,
    imgsz: 320,
    batch: 4,
    patience: 3,
  },
  quick: {
    label: 'Quick fine-tune',
    description: 'Short run for demos and quick experiments.',
    epochs: 25,
    imgsz: 512,
    batch: 8,
    patience: 10,
  },
  balanced: {
    label: 'Balanced',
    description: 'Ultralytics defaults - a good accuracy/time trade-off.',
    epochs: 100,
    imgsz: 640,
    batch: -1,
    patience: 50,
  },
  accurate: {
    label: 'High accuracy',
    description: 'Long run with more augmentation; use when quality matters most.',
    epochs: 300,
    imgsz: 640,
    batch: -1,
    patience: 80,
  },
};

interface TrainForm {
  model: string;
  data: string;
  task: string;
  epochs: number;
  imgsz: number;
  batch: number;
  workers: number;
  optimizer: string;
  lr0: number;
  lrf: number;
  momentum: number;
  weightDecay: number;
  warmup: number;
  patience: number;
  cosLr: boolean;
  amp: boolean;
  cache: boolean;
  rect: boolean;
  deterministic: boolean;
  pretrained: boolean;
  resume: boolean;
  singleCls: boolean;
  fraction: number;
  closeMosaic: number;
  dropout: number;
  freeze: string;
  seed: number;
  hsvH: number;
  hsvS: number;
  hsvV: number;
  degrees: number;
  translate: number;
  scale: number;
  shear: number;
  perspective: number;
  flipud: number;
  fliplr: number;
  mosaic: number;
  mixup: number;
  copyPaste: number;
  erasing: number;
  autoAugment: string;
}

const DEFAULT_FORM: TrainForm = {
  model: 'yolo11n.pt',
  data: 'coco8.yaml',
  task: 'detect',
  epochs: 25,
  imgsz: 512,
  batch: 8,
  workers: 0,
  optimizer: 'auto',
  lr0: 0.01,
  lrf: 0.01,
  momentum: 0.937,
  weightDecay: 0.0005,
  warmup: 3,
  patience: 10,
  cosLr: false,
  amp: true,
  cache: false,
  rect: false,
  deterministic: true,
  pretrained: true,
  resume: false,
  singleCls: false,
  fraction: 1,
  closeMosaic: 10,
  dropout: 0,
  freeze: '',
  seed: 0,
  hsvH: 0.015,
  hsvS: 0.7,
  hsvV: 0.4,
  degrees: 0,
  translate: 0.1,
  scale: 0.5,
  shear: 0,
  perspective: 0,
  flipud: 0,
  fliplr: 0.5,
  mosaic: 1,
  mixup: 0,
  copyPaste: 0,
  erasing: 0.4,
  autoAugment: 'randaugment',
};

/**
 * Train mode.
 *
 * Exposes the entire Ultralytics training surface, grouped so the defaults stay
 * approachable: essentials first, then optimizer, augmentation and advanced
 * switches. A live console and the parsed `results.csv` history render as the
 * run progresses.
 */
export function TrainPage() {
  const queryClient = useQueryClient();
  const device = usePreferences((state) => state.device);
  const setDevice = usePreferences((state) => state.setDevice);
  const [form, setForm] = useState<TrainForm>(DEFAULT_FORM);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [section, setSection] = useState<'essentials' | 'optimizer' | 'augment' | 'advanced'>('essentials');
  const stream = useJobStream(job?.id ?? null);

  const { data: catalog } = useQuery({ queryKey: ['models', 'catalog'], queryFn: () => modelsApi.catalog() });
  const { data: datasets } = useQuery({ queryKey: ['datasets'], queryFn: () => modesApi.datasets(), staleTime: 60_000 });
  const { data: optimizers } = useQuery({ queryKey: ['models', 'optimizers'], queryFn: modelsApi.optimizers, staleTime: 300_000 });
  const { data: jobs } = useQuery({ queryKey: ['jobs', 'train'], queryFn: () => jobsApi.list('train'), refetchInterval: job ? false : 6000 });

  const patch = (values: Partial<TrainForm>) => setForm((previous) => ({ ...previous, ...values }));

  // Keep model + dataset in step with the chosen task.
  useEffect(() => {
    const models = (catalog?.models ?? []).filter((entry) => entry.task === form.task);
    if (models.length && !models.some((entry) => entry.id === form.model)) patch({ model: models[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.task, catalog]);

  const trainModels = useMemo(
    () => (catalog?.models ?? []).filter((entry) => entry.task === form.task).map((entry) => ({ value: entry.id, label: entry.label })),
    [catalog, form.task],
  );

  const taskDatasets = useMemo(
    () => (datasets?.datasets ?? []).filter((entry) => !form.task || !entry.task || entry.task === form.task),
    [datasets, form.task],
  );

  const start = useMutation({
    mutationFn: () =>
      modesApi.train({
        model: form.model,
        data: form.data,
        task: form.task,
        device,
        epochs: form.epochs,
        imgsz: form.imgsz,
        batch: form.batch,
        workers: form.workers,
        optimizer: form.optimizer,
        lr0: form.lr0,
        lrf: form.lrf,
        momentum: form.momentum,
        weight_decay: form.weightDecay,
        warmup_epochs: form.warmup,
        patience: form.patience,
        cos_lr: form.cosLr,
        amp: form.amp,
        cache: form.cache,
        rect: form.rect,
        deterministic: form.deterministic,
        pretrained: form.pretrained,
        resume: form.resume,
        single_cls: form.singleCls,
        fraction: form.fraction,
        close_mosaic: form.closeMosaic,
        dropout: form.dropout,
        freeze: form.freeze.trim() === '' ? null : form.freeze.split(',').map((value) => Number(value.trim())).filter((value) => !Number.isNaN(value)),
        seed: form.seed,
        hsv_h: form.hsvH,
        hsv_s: form.hsvS,
        hsv_v: form.hsvV,
        degrees: form.degrees,
        translate: form.translate,
        scale: form.scale,
        shear: form.shear,
        perspective: form.perspective,
        flipud: form.flipud,
        fliplr: form.fliplr,
        mosaic: form.mosaic,
        mixup: form.mixup,
        copy_paste: form.copyPaste,
        erasing: form.erasing,
        auto_augment: form.autoAugment,
      }),
    onSuccess: (created) => {
      setJob(created);
      toast.success('Training started', `${created.title} — the console below streams live progress.`);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: Error) => toast.error('Could not start training', error.message),
  });

  const status = stream.summary?.status ?? job?.status;
  const result = (stream.summary?.result ?? null) as TrainingResult | null;

  // results.csv arrives one column at a time; reshape it into chart rows.
  const historyRows = useMemo(() => {
    const history = result?.history;
    if (!history) return [];
    const epochCount = Math.max(0, ...Object.values(history).map((column) => (Array.isArray(column) ? column.length : 0)));
    if (epochCount === 0) return [];
    const keys = Object.keys(history);
    return Array.from({ length: epochCount }, (_, index) => {
      const row: Record<string, number | string | null> = { epoch: (history.epoch?.[index] as number ?? index) + 1 };
      for (const key of keys) {
        const value = history[key]?.[index];
        row[key] = typeof value === 'number' ? value : null;
      }
      return row;
    });
  }, [result?.history]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mode 3 of 6 · Train"
        title="Training console"
        description="Fine-tune any checkpoint on any dataset with the complete Ultralytics hyperparameter set — optimizers, schedules, and all 15 augmentation knobs."
        badges={[
          { label: `device: ${device}`, tone: device === 'cpu' ? 'neutral' : 'success' },
          { label: `${(datasets?.datasets ?? []).length} datasets`, tone: 'brand' },
          { label: 'AMP · cosine LR · mosaic', tone: 'violet' },
        ]}
        actions={
          <>
            <div className="w-[196px]">
              {/* Hailo cannot train, so the selector only marks it as unusable
                  instead of hiding it - the reason is the useful part. */}
              <DeviceSelect value={device} onChange={setDevice} mode="train" size="sm" />
            </div>
            <Button
              variant="primary"
              icon={<Play className="size-4" />}
              loading={start.isPending}
              onClick={() => start.mutate()}
            >
              Start training
            </Button>
            <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => setForm(DEFAULT_FORM)}>
              Reset form
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader
          icon={<Wand2 className="size-4" />}
          title="Presets"
          description="Start from a recipe, then fine-tune the numbers below."
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.entries(PRESETS) as [PresetId, (typeof PRESETS)[PresetId]][]).map(([id, preset]) => (
            <button
              key={id}
              type="button"
              onClick={() =>
                patch({
                  epochs: preset.epochs,
                  imgsz: preset.imgsz,
                  batch: preset.batch,
                  patience: preset.patience,
                })
              }
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                form.epochs === preset.epochs && form.imgsz === preset.imgsz
                  ? 'border-brand-400/60 bg-brand-500/10'
                  : 'border-ink-700/60 hover:border-ink-500',
              )}
            >
              <p className="text-xs font-medium text-slate-200">{preset.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{preset.description}</p>
              <p className="mt-1.5 font-mono text-[10px] text-brand-300">
                {preset.epochs} epochs · {preset.imgsz}px · batch {preset.batch === -1 ? 'auto' : preset.batch}
              </p>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader icon={<Layers className="size-4" />} title="Task, model & data" />
            <div className="space-y-3">
              <SegmentedControl
                size="sm"
                value={form.task}
                onChange={(task) => patch({ task })}
                options={[
                  { value: 'detect', label: 'Detect' },
                  { value: 'segment', label: 'Segment' },
                  { value: 'classify', label: 'Classify' },
                  { value: 'pose', label: 'Pose' },
                  { value: 'obb', label: 'OBB' },
                ]}
              />
              <Field label="Base checkpoint" hint="Training starts from these pretrained weights.">
                <Select value={form.model} onChange={(event) => patch({ model: event.target.value })} options={trainModels} />
              </Field>
              <Field label="Dataset" hint="Ultralytics descriptors download automatically on first use.">
                <Select
                  value={form.data}
                  onChange={(event) => patch({ data: event.target.value })}
                  options={taskDatasets.map((entry) => ({
                    value: entry.id,
                    label: `${entry.label}${entry.images ? ` · ${entry.images} imgs` : ''}${entry.exists ? '' : ' (downloads)'}`,
                  }))}
                />
              </Field>
              {datasets?.datasets.find((entry) => entry.id === form.data)?.note && (
                <p className="flex items-start gap-1.5 rounded-lg border border-ink-700/60 bg-ink-900/50 p-2 text-[11px] text-slate-400">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  {datasets.datasets.find((entry) => entry.id === form.data)?.note}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Settings className="size-4" />} title="Hyperparameters" description="Grouped the way Ultralytics documents them." />
            <SegmentedControl
              size="sm"
              value={section}
              onChange={setSection}
              options={[
                { value: 'essentials', label: 'Essentials' },
                { value: 'optimizer', label: 'Optimizer' },
                { value: 'augment', label: 'Augment' },
                { value: 'advanced', label: 'Advanced' },
              ]}
            />

            <div className="mt-4 space-y-4">
              {section === 'essentials' && (
                <>
                  <Slider label="Epochs" min={1} max={500} value={form.epochs} onChange={(epochs) => patch({ epochs })} />
                  <Slider label="Image size" min={160} max={1280} step={32} value={form.imgsz} onChange={(imgsz) => patch({ imgsz })} format={(v) => `${v}px`} />
                  <Field label="Batch size" hint="-1 lets Ultralytics auto-select ~60% of VRAM.">
                    <Input
                      type="number"
                      value={form.batch}
                      onChange={(event) => patch({ batch: Number(event.target.value) })}
                    />
                  </Field>
                  <Slider label="Early-stopping patience" min={0} max={200} value={form.patience} onChange={(patience) => patch({ patience })} hint="Epochs without improvement before stopping (0 disables)." />
                  <Slider label="Dataloader workers" min={0} max={16} value={form.workers} onChange={(workers) => patch({ workers })} hint="Keep at 0 on Windows to avoid spawn overhead." />
                  <Slider label="Dataset fraction" min={0.05} max={1} step={0.05} value={form.fraction} onChange={(fraction) => patch({ fraction })} format={(v) => `${Math.round(v * 100)}%`} />
                </>
              )}

              {section === 'optimizer' && (
                <>
                  <Field label="Optimizer">
                    <Select
                      value={form.optimizer}
                      onChange={(event) => patch({ optimizer: event.target.value })}
                      options={(optimizers?.optimizers ?? []).map((entry) => ({ value: entry.id, label: `${entry.label} — ${entry.note}` }))}
                    />
                  </Field>
                  <Slider label="Initial LR (lr0)" min={0.0001} max={0.1} step={0.0001} value={form.lr0} onChange={(lr0) => patch({ lr0 })} format={(v) => v.toFixed(4)} />
                  <Slider label="Final LR factor (lrf)" min={0.001} max={0.5} step={0.001} value={form.lrf} onChange={(lrf) => patch({ lrf })} format={(v) => v.toFixed(3)} />
                  <Slider label="Momentum" min={0.5} max={0.99} step={0.001} value={form.momentum} onChange={(momentum) => patch({ momentum })} format={(v) => v.toFixed(3)} />
                  <Slider label="Weight decay" min={0} max={0.01} step={0.0001} value={form.weightDecay} onChange={(weightDecay) => patch({ weightDecay })} format={(v) => v.toFixed(4)} />
                  <Slider label="Warmup epochs" min={0} max={10} step={0.5} value={form.warmup} onChange={(warmup) => patch({ warmup })} />
                  <Switch checked={form.cosLr} onChange={(cosLr) => patch({ cosLr })} label="Cosine LR schedule" description="Decay the learning rate along a cosine curve instead of linearly." />
                  <Switch checked={form.amp} onChange={(amp) => patch({ amp })} label="Automatic mixed precision" description="Halves memory and speeds up training on supported GPUs." />
                </>
              )}

              {section === 'augment' && (
                <>
                  <p className="rounded-lg border border-ink-700/60 bg-ink-900/50 p-2 text-[11px] leading-relaxed text-slate-400">
                    All 15 Ultralytics augmentation parameters. Values are probabilities or magnitudes; 0 disables an
                    augmentation.
                  </p>
                  <Slider label="HSV hue (hsv_h)" min={0} max={0.1} step={0.005} value={form.hsvH} onChange={(hsvH) => patch({ hsvH })} format={(v) => v.toFixed(3)} />
                  <Slider label="HSV saturation (hsv_s)" min={0} max={1} step={0.05} value={form.hsvS} onChange={(hsvS) => patch({ hsvS })} />
                  <Slider label="HSV value (hsv_v)" min={0} max={1} step={0.05} value={form.hsvV} onChange={(hsvV) => patch({ hsvV })} />
                  <Slider label="Rotation (degrees)" min={0} max={180} value={form.degrees} onChange={(degrees) => patch({ degrees })} />
                  <Slider label="Translation" min={0} max={0.9} step={0.05} value={form.translate} onChange={(translate) => patch({ translate })} />
                  <Slider label="Scale" min={0} max={0.9} step={0.05} value={form.scale} onChange={(scale) => patch({ scale })} />
                  <Slider label="Shear" min={0} max={45} value={form.shear} onChange={(shear) => patch({ shear })} />
                  <Slider label="Perspective" min={0} max={0.001} step={0.0001} value={form.perspective} onChange={(perspective) => patch({ perspective })} format={(v) => v.toFixed(4)} />
                  <Slider label="Vertical flip (flipud)" min={0} max={1} step={0.05} value={form.flipud} onChange={(flipud) => patch({ flipud })} />
                  <Slider label="Horizontal flip (fliplr)" min={0} max={1} step={0.05} value={form.fliplr} onChange={(fliplr) => patch({ fliplr })} />
                  <Slider label="Mosaic" min={0} max={1} step={0.05} value={form.mosaic} onChange={(mosaic) => patch({ mosaic })} />
                  <Slider label="MixUp" min={0} max={1} step={0.05} value={form.mixup} onChange={(mixup) => patch({ mixup })} />
                  <Slider label="Copy-paste" min={0} max={1} step={0.05} value={form.copyPaste} onChange={(copyPaste) => patch({ copyPaste })} hint="Segmentation only." />
                  <Slider label="Random erasing" min={0} max={1} step={0.05} value={form.erasing} onChange={(erasing) => patch({ erasing })} hint="Classification only." />
                  <Field label="Auto-augment policy">
                    <Select
                      value={form.autoAugment}
                      onChange={(event) => patch({ autoAugment: event.target.value })}
                      options={[
                        { value: 'randaugment', label: 'RandAugment' },
                        { value: 'autoaugment', label: 'AutoAugment' },
                        { value: 'augmix', label: 'AugMix' },
                        { value: 'none', label: 'None' },
                      ]}
                    />
                  </Field>
                </>
              )}

              {section === 'advanced' && (
                <>
                  <Slider label="Close mosaic (last N epochs)" min={0} max={50} value={form.closeMosaic} onChange={(closeMosaic) => patch({ closeMosaic })} hint="Disabling mosaic near the end usually improves final accuracy." />
                  <Slider label="Dropout" min={0} max={0.5} step={0.01} value={form.dropout} onChange={(dropout) => patch({ dropout })} hint="Classification and OBB heads." />
                  <Slider label="Seed" min={0} max={1000} value={form.seed} onChange={(seed) => patch({ seed })} />
                  <Field label="Freeze layers" hint="Comma-separated layer indices, e.g. 0,1,2 or 0-10.">
                    <Input value={form.freeze} placeholder="e.g. 0,1,2" onChange={(event) => patch({ freeze: event.target.value })} />
                  </Field>
                  <Switch checked={form.deterministic} onChange={(deterministic) => patch({ deterministic })} label="Deterministic training" description="Reproducible results; slightly slower." />
                  <Switch checked={form.cache} onChange={(cache) => patch({ cache })} label="Cache images in RAM" description="Much faster epochs if the dataset fits in memory." />
                  <Switch checked={form.rect} onChange={(rect) => patch({ rect })} label="Rectangular training" description="Avoids padding distortion; good for varied aspect ratios." />
                  <Switch checked={form.pretrained} onChange={(pretrained) => patch({ pretrained })} label="Use pretrained weights" />
                  <Switch checked={form.singleCls} onChange={(singleCls) => patch({ singleCls })} label="Single-class training" description="Treat every label as one class." />
                  <Switch checked={form.resume} onChange={(resume) => patch({ resume })} label="Resume last run" description="Continue from the checkpoint in the run directory." />
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Timer className="size-4" />} title="Estimated settings" />
            <KeyValue
              columns={2}
              items={[
                { label: 'Total epochs', value: form.epochs },
                { label: 'Steps per epoch', value: form.data ? 'depends on dataset' : '—' },
                { label: 'Warmup epochs', value: form.warmup, mono: true },
                { label: 'Early stop', value: form.patience === 0 ? 'disabled' : `${form.patience} epochs` },
                { label: 'Batch', value: form.batch === -1 ? 'auto' : form.batch, mono: true },
                { label: 'AMP', value: form.amp ? 'on' : 'off' },
              ]}
            />
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader
              icon={<GraduationCap className="size-4" />}
              title="Live console"
              description="Parsed from the Ultralytics training loop: loss, mAP and progress per epoch."
              actions={
                job && (status === 'running' || status === 'queued') ? (
                  <Button size="sm" variant="danger" onClick={() => jobsApi.cancel(job.id)}>
                    Cancel
                  </Button>
                ) : null
              }
            />
            {!job ? (
              <EmptyState
                icon={<GraduationCap className="size-5" />}
                title="No training run yet"
                description="Configure the run on the left and press Start training. Progress, loss curves and metrics stream here live."
              />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone={status === 'succeeded' ? 'success' : status === 'failed' ? 'danger' : 'brand'} dot>
                    {status}
                  </Badge>
                  <span className="font-mono text-[11px] text-slate-500">job {job.id}</span>
                  {stream.summary?.duration_s !== null && stream.summary?.duration_s !== undefined && (
                    <span className="font-mono text-[11px] text-slate-500">{formatDuration(stream.summary.duration_s)}</span>
                  )}
                  {result?.run_dir && (
                    <span className="truncate font-mono text-[11px] text-slate-600">{result.run_dir}</span>
                  )}
                </div>
                <LogConsole events={stream.events} percent={stream.summary?.percent ?? job.percent} status={status} height="h-80" />
              </>
            )}
          </Card>

          {historyRows.length > 1 && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Loss curves" description="Box, class and DFL losses per epoch (lower is better)." />
                  <LineChart
                    data={historyRows}
                    xKey="epoch"
                    series={[
                      { key: 'train/box_loss', label: 'train box', color: '#22d3ee' },
                      { key: 'train/cls_loss', label: 'train cls', color: '#a78bfa' },
                      { key: 'train/dfl_loss', label: 'train dfl', color: '#f472b6' },
                      { key: 'val/box_loss', label: 'val box', color: '#4ade80' },
                      { key: 'val/cls_loss', label: 'val cls', color: '#fbbf24' },
                    ]}
                    height={240}
                    emptyMessage="Loss columns were not found in results.csv (classification runs log loss/accuracy instead)."
                  />
                </Card>
                <Card>
                  <CardHeader title="Validation metrics" description="mAP improves as the model learns." />
                  <LineChart
                    data={historyRows}
                    xKey="epoch"
                    series={[
                      { key: 'metrics/mAP50(B)', label: 'mAP@50', color: '#22d3ee' },
                      { key: 'metrics/mAP50-95(B)', label: 'mAP@50-95', color: '#a78bfa' },
                      { key: 'metrics/precision(B)', label: 'precision', color: '#4ade80' },
                      { key: 'metrics/recall(B)', label: 'recall', color: '#fbbf24' },
                      { key: 'metrics/accuracy_top1', label: 'top-1 acc', color: '#f472b6' },
                    ]}
                    height={240}
                    emptyMessage="No validation metrics in this run."
                  />
                </Card>
              </div>

              <Card>
                <CardHeader title="Final metrics" description="Validation of the best checkpoint after training." />
                {result?.final_metrics && 'summary' in result.final_metrics ? (
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {Object.entries((result.final_metrics as { summary: Record<string, number> }).summary).map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-ink-700/60 bg-ink-900/50 p-2.5">
                        <p className="text-[10px] tracking-wider text-slate-500 uppercase">{key}</p>
                        <p className="mt-0.5 font-mono text-sm text-brand-200">{formatScore(value)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Final metrics were not produced for this run.</p>
                )}
              </Card>
            </>
          )}

          {(job?.artifacts?.length ?? 0) > 0 || (result?.artifacts?.length ?? 0) > 0 ? (
            <Card>
              <CardHeader title="Artifacts" description="Plots and weights written by the run." />
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {(result?.artifacts ?? job?.artifacts ?? []).slice(0, 24).map((artifact) => (
                  <a
                    key={artifact.path}
                    href={artifact.url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-lg border border-ink-700/60 transition-colors hover:border-brand-500/50"
                  >
                    {artifact.kind === 'image' ? (
                      <img src={artifact.url} alt={artifact.name} className="h-24 w-full bg-ink-950 object-contain" loading="lazy" />
                    ) : (
                      <div className="grid h-24 place-items-center text-[10px] text-slate-500">{artifact.kind}</div>
                    )}
                    <p className="truncate px-2 py-1 font-mono text-[10px] text-slate-400 group-hover:text-slate-200">
                      {artifact.name}
                    </p>
                  </a>
                ))}
              </div>
            </Card>
          ) : null}

          {(jobs?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Previous training runs" description="Newest first." actions={<Link to="/runs" className="text-[11px] text-brand-300 hover:underline">All runs</Link>} />
              <ul className="space-y-2">
                {(jobs ?? []).slice(0, 6).map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-ink-700/60 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" className="truncate text-left text-xs text-slate-200 hover:text-brand-200" onClick={() => setJob(entry)}>
                        {entry.title}
                      </button>
                      <Badge tone={entry.status === 'succeeded' ? 'success' : entry.status === 'failed' ? 'danger' : 'neutral'}>
                        {entry.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <ProgressBar value={entry.percent} />
                      <span className="w-16 text-right font-mono text-[10px] text-slate-500">{formatDuration(entry.duration_s)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {status === 'succeeded' && result?.best_model && (
            <Card className="border-success-500/40">
              <CardHeader icon={<Sparkles className="size-4" />} title="Train a model, then validate or export it" />
              <p className="mb-3 text-xs text-slate-400">
                Best weights: <span className="font-mono text-slate-200">{result.best_model}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/validate?model=${encodeURIComponent(result.best_model)}`}>
                  <Button size="sm" variant="primary">
                    Validate this model
                  </Button>
                </Link>
                <Link to={`/export?model=${encodeURIComponent(result.best_model)}`}>
                  <Button size="sm" variant="secondary">
                    Export it
                  </Button>
                </Link>
                <Link to={`/predict?model=${encodeURIComponent(result.best_model)}`}>
                  <Button size="sm" variant="ghost">
                    Predict with it
                  </Button>
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
