import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Braces,
  ChevronDown,
  Download,
  Gauge as GaugeIcon,
  ImageDown,
  Layers,
  Loader2,
  Play,
  ScanSearch,
  Settings2,
  Sparkles,
} from 'lucide-react';

import { inferApi, modelsApi } from '@/lib/api';
import type { CatalogModel, InferResponse, ResultPayload, TaskName } from '@/lib/api-types';
import { TASK_META } from '@/lib/navigation';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { cn, copyToClipboard, downloadJson, downloadUrl, formatMs } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { ResultsViewer, type RenderMode } from '@/components/results/ResultsViewer';
import { SourcePicker } from '@/components/input/SourcePicker';
import { emptySource, type SourceState } from '@/lib/sources';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  SegmentedControl,
  Select,
  Slider,
  Switch,
} from '@/components/ui/primitives';

const TASKS: TaskName[] = ['detect', 'segment', 'classify', 'pose', 'obb'];

/**
 * Predict mode.
 *
 * The task selector swaps the model family and adapts the controls (mask
 * rendering for segmentation, keypoint toggles for pose, angle readout for OBB),
 * demonstrating that one inference pipeline serves every Ultralytics task head.
 */
export function PredictPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const device = usePreferences((state) => state.device);
  const inferDefaults = usePreferences((state) => state.inferDefaults);
  const patchInferDefaults = usePreferences((state) => state.patchInferDefaults);
  const overlay = usePreferences((state) => state.overlay);
  const patchOverlay = usePreferences((state) => state.patchOverlay);

  const initialTask = (searchParams.get('task') as TaskName | null) ?? 'detect';
  const [task, setTask] = useState<TaskName>(TASKS.includes(initialTask) ? initialTask : 'detect');
  const [model, setModel] = useState<string>('');
  const [source, setSource] = useState<SourceState>(emptySource);
  const [hiddenClasses, setHiddenClasses] = useState<number[]>([]);
  const [renderMode, setRenderMode] = useState<RenderMode>('overlay');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data: catalog } = useQuery({
    queryKey: ['models', 'catalog'],
    queryFn: () => modelsApi.catalog(),
    staleTime: 300_000,
  });

  const { data: defaults } = useQuery({ queryKey: ['infer', 'defaults'], queryFn: inferApi.defaults, staleTime: 300_000 });

  // Keep the model aligned with the selected task, unless a deep link named one.
  useEffect(() => {
    const requested = searchParams.get('model');
    if (requested && requested === model) return; // respect an explicit ?model=
    const suggested = defaults?.model && task === 'detect' ? defaults.model : catalog?.defaults?.[task];
    const familyModels = (catalog?.models ?? []).filter((entry) => entry.task === task);
    if (!familyModels.length) return;
    const currentValid = familyModels.some((entry) => entry.id === model);
    if (!currentValid) setModel(suggested && familyModels.some((m) => m.id === suggested) ? suggested : familyModels[0].id);
     
  }, [task, catalog, defaults, model, searchParams]);

  // Honour ?model= and ?sample= deep links from the dashboard, runs and palette.
  useEffect(() => {
    const requestedModel = searchParams.get('model');
    if (requestedModel && requestedModel !== model) {
      setModel(requestedModel);
      return;
    }
    const sample = searchParams.get('sample');
    if (sample && source.kind === 'sample' && source.spec.sample !== sample) {
      setSource({ kind: 'sample', spec: { sample }, previewUrl: `/api/media/samples/${sample}`, label: sample });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const modelOptions = useMemo(
    () =>
      (catalog?.models ?? [])
        .filter((entry) => entry.task === task)
        .map((entry: CatalogModel) => ({
          value: entry.id,
          label: `${entry.label} · ${entry.approx_params_m ?? '?'}M params`,
        })),
    [catalog, task],
  );

  const predict = useMutation({
    mutationFn: () =>
      inferApi.run({
        model,
        task,
        source: source.spec,
        options: { ...inferDefaults, device, classes: hiddenClasses.length ? undefined : null },
      }),
    onSuccess: (data: InferResponse) => {
      const summary = data.results[0];
      const count =
        (summary?.detections?.count ?? 0) +
        (summary?.obb?.count ?? 0) +
        (summary?.masks?.count ?? 0) +
        (summary?.keypoints?.count ?? 0);
      toast.success(
        `Inference complete in ${formatMs(data.elapsed_ms, 0)}`,
        task === 'classify' ? `Top-1: ${summary?.probs?.top1_name ?? '—'}` : `${count} object(s) found`,
      );
      setHiddenClasses([]);
    },
    onError: (error: Error) => toast.error('Inference failed', error.message),
  });

  const result: ResultPayload | undefined = predict.data?.results[0];

  const toggleClass = useCallback((classId: number) => {
    setHiddenClasses((previous) =>
      previous.includes(classId) ? previous.filter((id) => id !== classId) : [...previous, classId],
    );
  }, []);

  const activeTask = TASK_META[task];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mode 1 of 6 · Predict"
        title="Inference workbench"
        description="Run any of the five Ultralytics task heads on an image, then inspect every box, mask, keypoint and class probability the model produced."
        badges={[
          { label: `task: ${activeTask.label}`, tone: 'brand' },
          { label: `device: ${device}`, tone: device === 'cpu' ? 'neutral' : 'success' },
          { label: 'canvas overlay + server plot', tone: 'violet' },
        ]}
        actions={
          <>
            <Button
              variant="primary"
              icon={predict.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              loading={predict.isPending}
              disabled={!model || (!source.spec.sample && !source.spec.upload_id && !source.spec.url && !source.spec.path && !source.spec.data_url)}
              onClick={() => predict.mutate()}
            >
              {predict.isPending ? 'Running…' : 'Run inference'}
            </Button>
            {result && (
              <>
                <Button
                  variant="secondary"
                  icon={<Braces className="size-4" />}
                  onClick={() => {
                    void copyToClipboard(JSON.stringify(result, null, 2));
                    toast.success('Result JSON copied');
                  }}
                >
                  Copy JSON
                </Button>
                <Button
                  variant="ghost"
                  icon={<Download className="size-4" />}
                  onClick={() => downloadJson(result, `prediction-${predict.data?.id ?? 'result'}.json`)}
                >
                  Save
                </Button>
              </>
            )}
          </>
        }
      />

      <SegmentedControl<TaskName>
        value={task}
        onChange={(next) => {
          setTask(next);
          setSearchParams(next === 'detect' ? {} : { task: next }, { replace: true });
        }}
        options={TASKS.map((entry) => ({
          value: entry,
          label: TASK_META[entry].short,
          hint: TASK_META[entry].description,
        }))}
      />

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              icon={<Layers className="size-4" />}
              title="Model & source"
              description={`${modelOptions.length} checkpoints available for ${activeTask.short}.`}
            />
            <div className="space-y-3">
              <Select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                options={modelOptions}
                placeholder="Select a checkpoint"
              />
              <SourcePicker value={source} onChange={setSource} accept="image" />
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<Settings2 className="size-4" />}
              title="Inference options"
              description="Thresholds, resolution and NMS behaviour."
            />
            <div className="space-y-4">
              <Slider
                label="Confidence threshold"
                min={0.01}
                max={0.99}
                step={0.01}
                value={inferDefaults.conf}
                onChange={(value) => patchInferDefaults({ conf: value })}
                format={(value) => value.toFixed(2)}
                hint="Detections below this score are dropped."
              />
              <Slider
                label="IoU threshold (NMS)"
                min={0.1}
                max={0.95}
                step={0.01}
                value={inferDefaults.iou}
                onChange={(value) => patchInferDefaults({ iou: value })}
                format={(value) => value.toFixed(2)}
              />
              <Slider
                label="Image size"
                min={320}
                max={1280}
                step={32}
                value={inferDefaults.imgsz}
                onChange={(value) => patchInferDefaults({ imgsz: value })}
                format={(value) => `${value}px`}
                hint="Larger sizes improve small-object recall at the cost of speed."
              />
              <Slider
                label="Max detections"
                min={1}
                max={1000}
                step={1}
                value={inferDefaults.max_det}
                onChange={(value) => patchInferDefaults({ max_det: value })}
              />

              <button
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
                className="flex w-full items-center justify-between text-[11px] font-medium tracking-wider text-slate-400 uppercase hover:text-slate-200"
              >
                Advanced
                <ChevronDown className={cn('size-3.5 transition-transform', advancedOpen && 'rotate-180')} />
              </button>

              {advancedOpen && (
                <div className="space-y-2">
                  <Switch
                    checked={inferDefaults.augment}
                    onChange={(value) => patchInferDefaults({ augment: value })}
                    label="Test-time augmentation"
                    description="Runs inference over flipped/scaled variants, then merges results (slower, more accurate)."
                  />
                  <Switch
                    checked={inferDefaults.agnostic_nms}
                    onChange={(value) => patchInferDefaults({ agnostic_nms: value })}
                    label="Class-agnostic NMS"
                    description="Merge overlapping boxes even when their classes differ."
                  />
                  <Switch
                    checked={inferDefaults.retina_masks}
                    onChange={(value) => patchInferDefaults({ retina_masks: value })}
                    label="Retina masks"
                    description="High-resolution masks for segmentation (segment task only)."
                  />
                  <Switch
                    checked={inferDefaults.save_rendered}
                    onChange={(value) => patchInferDefaults({ save_rendered: value })}
                    label="Server-rendered plot"
                    description="Ask the API to also render result.plot() for comparison."
                  />
                  <Slider
                    label="Max mask polygons"
                    min={8}
                    max={256}
                    step={8}
                    value={inferDefaults.mask_limit}
                    onChange={(value) => patchInferDefaults({ mask_limit: value })}
                    hint="Caps the polygon payload for very crowded scenes."
                  />
                </div>
              )}
            </div>
          </Card>

          {predict.data && (
            <Card>
              <CardHeader icon={<GaugeIcon className="size-4" />} title="Run metrics" />
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <MetricTile label="Round trip" value={formatMs(Number(predict.data.stats.total_ms ?? predict.data.elapsed_ms), 0)} />
                <MetricTile label="Preprocess" value={formatMs(result?.speed?.preprocess_ms)} />
                <MetricTile label="Inference" value={formatMs(result?.speed?.inference_ms)} />
                <MetricTile label="Postprocess" value={formatMs(result?.speed?.postprocess_ms)} />
                <MetricTile label="Model task" value={predict.data.model.task} />
                <MetricTile label="Classes" value={String(predict.data.model.classes)} />
                {predict.data.model.info.parameters ? (
                  <MetricTile label="Parameters" value={`${(predict.data.model.info.parameters / 1e6).toFixed(1)}M`} />
                ) : null}
                {predict.data.model.info.gflops ? (
                  <MetricTile label="GFLOPs" value={predict.data.model.info.gflops.toFixed(1)} />
                ) : null}
              </div>
              {result?.rendered_url && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  block
                  icon={<ImageDown className="size-3.5" />}
                  onClick={() => downloadUrl(result.rendered_url!, 'prediction.jpg')}
                >
                  Download annotated image
                </Button>
              )}
            </Card>
          )}

          {result && (result.masks || result.keypoints || result.obb) && (
            <Card>
              <CardHeader icon={<Sparkles className="size-4" />} title="Task outputs" description="What this head produced." />
              <div className="flex flex-wrap gap-2">
                {result.detections && <Badge tone="brand">{result.detections.count} boxes</Badge>}
                {result.masks && <Badge tone="violet">{result.masks.count} mask polygons</Badge>}
                {result.keypoints && <Badge tone="success">{result.keypoints.count} skeletons</Badge>}
                {result.keypoints?.shape && (
                  <Badge tone="neutral">
                    {result.keypoints.shape[0]} keypoints × {result.keypoints.shape[1]} values
                  </Badge>
                )}
                {result.obb && <Badge tone="warning">{result.obb.count} oriented boxes</Badge>}
                {result.probs && <Badge tone="warning">top-1 {((result.probs.top1_conf ?? 0) * 100).toFixed(1)}%</Badge>}
              </div>
              {result.masks?.truncated && (
                <p className="mt-2 text-[11px] text-warning-400">
                  Mask list truncated — raise “Max mask polygons” to transfer them all.
                </p>
              )}
            </Card>
          )}
        </div>

        <div className="min-w-0">
          {predict.isPending && (
            <Card className="grid h-72 place-items-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="size-6 animate-spin text-brand-300" />
                <p className="text-xs text-slate-400">
                  Running {activeTask.label} with <span className="font-mono">{model}</span>
                </p>
              </div>
            </Card>
          )}

          {!predict.isPending && !result && (
            <EmptyState
              className="h-72"
              icon={<ScanSearch className="size-5" />}
              title="No inference yet"
              description="Pick a checkpoint and a source, then hit Run inference. Results render on a canvas overlay you can zoom and toggle per class."
            />
          )}

          {!predict.isPending && result && (
            <ResultsViewer
              result={result}
              imageUrl={source.previewUrl ?? predict.data?.results[0]?.original_url ?? null}
              overlay={overlay}
              onOverlayChange={patchOverlay}
              onClassToggle={toggleClass}
              hiddenClasses={hiddenClasses}
              renderMode={renderMode}
              onRenderModeChange={setRenderMode}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-900/50 px-2.5 py-2">
      <p className="text-[10px] tracking-wider text-slate-500 uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-xs text-slate-200">{value}</p>
    </div>
  );
}

