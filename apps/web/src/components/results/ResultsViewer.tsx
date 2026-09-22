import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Layers, MousePointerClick } from 'lucide-react';

import type { BoxItem, ClassPrediction, KeypointInstance, ResultPayload } from '@/lib/api-types';
import { classColor, cn, formatMs, formatScore, withAlpha } from '@/lib/utils';
import { Badge, Button, EmptyState, SegmentedControl, Slider, Switch, Tooltip } from '@/components/ui/primitives';

/** COCO-17 skeleton edges used to connect pose keypoints. */
const SKELETON_EDGES: [number, number][] = [
  [16, 14],
  [14, 6],
  [6, 8],
  [8, 10],
  [10, 5],
  [5, 7],
  [7, 9],
  [6, 12],
  [12, 11],
  [11, 13],
  [13, 5],
  [12, 3],
  [3, 1],
  [1, 2],
  [2, 4],
  [4, 0],
];

const KEYPOINT_NAMES = [
  'nose',
  'left eye',
  'right eye',
  'left ear',
  'right ear',
  'left shoulder',
  'right shoulder',
  'left elbow',
  'right elbow',
  'left wrist',
  'right wrist',
  'left hip',
  'right hip',
  'left knee',
  'right knee',
  'left ankle',
  'right ankle',
];

export interface OverlaySettings {
  showLabels: boolean;
  showConfidence: boolean;
  showMasks: boolean;
  showKeypoints: boolean;
  maskOpacity: number;
  lineWidth: number;
  showTrackIds: boolean;
}

export type RenderMode = 'overlay' | 'server' | 'original';

interface ResultsViewerProps {
  result: ResultPayload;
  /** Object URL / path of the source image (used in canvas overlay mode). */
  imageUrl: string | null;
  overlay: OverlaySettings;
  onOverlayChange?: (patch: Partial<OverlaySettings>) => void;
  onClassToggle?: (classId: number) => void;
  hiddenClasses?: number[];
  className?: string;
  renderMode?: RenderMode;
  onRenderModeChange?: (mode: RenderMode) => void;
  allowModeSwitch?: boolean;
  /** Show the side inspector panel. */
  showInspector?: boolean;
}

/**
 * Canvas-based result viewer.
 *
 * Draws boxes, oriented boxes, polygon masks and skeletons client-side so
 * overlays stay crisp while zooming and can be toggled per class. The
 * server-rendered plot is available as an alternative view for comparison.
 */
export function ResultsViewer({
  result,
  imageUrl,
  overlay,
  onOverlayChange,
  onClassToggle,
  hiddenClasses = [],
  className,
  renderMode: controlledMode,
  onRenderModeChange,
  allowModeSwitch = true,
  showInspector = true,
}: ResultsViewerProps) {
  const [internalMode, setInternalMode] = useState<RenderMode>('overlay');
  const mode = controlledMode ?? internalMode;
  const setMode = (next: RenderMode) => {
    setInternalMode(next);
    onRenderModeChange?.(next);
  };

  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({
    width: result.original_shape[1] || 1,
    height: result.original_shape[0] || 1,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const boxItems: BoxItem[] = useMemo(
    () => [...(result.detections?.items ?? []), ...(result.obb?.items ?? [])],
    [result.detections, result.obb],
  );

  const visibleBoxes = useMemo(
    () => boxItems.filter((item) => !hiddenClasses.includes(item.class_id)),
    [boxItems, hiddenClasses],
  );

  const classStats = useMemo(() => {
    const stats = new Map<number, { name: string; count: number; avgConf: number }>();
    for (const item of boxItems) {
      const current = stats.get(item.class_id) ?? { name: item.class_name, count: 0, avgConf: 0 };
      current.count += 1;
      current.avgConf += item.confidence ?? 0;
      stats.set(item.class_id, current);
    }
    return [...stats.entries()]
      .map(([id, value]) => ({ id, name: value.name, count: value.count, avgConf: value.avgConf / value.count }))
      .sort((a, b) => b.count - a.count);
  }, [boxItems]);

  /* --------------------------------------------------------- draw overlay */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== 'overlay') return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const width = imageSize.width;
    const height = imageSize.height;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);

    // Masks first so boxes/labels sit on top.
    if (overlay.showMasks && result.masks) {
      for (const mask of result.masks.items) {
        if (hiddenClasses.includes(mask.class_id)) continue;
        const polygon = mask.polygon;
        if (polygon.length < 6) continue;
        context.beginPath();
        context.moveTo(polygon[0] * width, polygon[1] * height);
        for (let index = 2; index < polygon.length; index += 2) {
          context.lineTo(polygon[index] * width, polygon[index + 1] * height);
        }
        context.closePath();
        const color = classColor(mask.class_id);
        context.fillStyle = withAlpha(color, overlay.maskOpacity * (selected === null || selected === mask.index ? 1 : 0.25));
        context.fill();
        context.lineWidth = 1.5;
        context.strokeStyle = withAlpha(color, 0.9);
        context.stroke();
      }
    }

    // Oriented boxes are drawn as their rotated corner polygons.
    for (const item of result.obb?.items ?? []) {
      if (hiddenClasses.includes(item.class_id)) continue;
      const color = classColor(item.class_id);
      const emphasised = selected === item.index || hovered === item.index;
      context.beginPath();
      context.moveTo(item.xyxy[0], item.xyxy[1]);
      for (let index = 2; index < item.xyxy.length; index += 2) {
        context.lineTo(item.xyxy[index], item.xyxy[index + 1]);
      }
      context.closePath();
      context.lineWidth = overlay.lineWidth + (emphasised ? 1.5 : 0);
      context.strokeStyle = color;
      context.stroke();
      context.fillStyle = withAlpha(color, emphasised ? 0.28 : 0.12);
      context.fill();
      drawLabel(context, item, color, overlay, item.xyxy[0], item.xyxy[1], width);
    }

    for (const item of result.detections?.items ?? []) {
      if (hiddenClasses.includes(item.class_id)) continue;
      const [x1, y1, x2, y2] = item.xyxy;
      const color = classColor(item.class_id);
      const emphasised = selected === item.index || hovered === item.index;
      context.lineWidth = overlay.lineWidth + (emphasised ? 1.5 : 0);
      context.strokeStyle = color;
      context.strokeRect(x1, y1, x2 - x1, y2 - y1);
      if (emphasised) {
        context.fillStyle = withAlpha(color, 0.14);
        context.fillRect(x1, y1, x2 - x1, y2 - y1);
      }
      drawLabel(context, item, color, overlay, x1, y1, width);
    }

    // Skeletons.
    if (overlay.showKeypoints && result.keypoints) {
      result.keypoints.items.forEach((instance, instanceIndex) => {
        const color = classColor(instance.class_id + 3);
        const emphasised = selected === instanceIndex || hovered === instanceIndex;
        context.lineWidth = (emphasised ? 3 : 2) * (overlay.lineWidth / 2);
        context.strokeStyle = withAlpha(color, 0.95);
        for (const [a, b] of SKELETON_EDGES) {
          const pointA = instance.xy[a];
          const pointB = instance.xy[b];
          if (!pointA || !pointB) continue;
          const confA = instance.confidence?.[a] ?? 1;
          const confB = instance.confidence?.[b] ?? 1;
          if ((confA ?? 0) < 0.3 || (confB ?? 0) < 0.3) continue;
          context.beginPath();
          context.moveTo(pointA[0], pointA[1]);
          context.lineTo(pointB[0], pointB[1]);
          context.stroke();
        }
        instance.xy.forEach((point, pointIndex) => {
          const confidence = instance.confidence?.[pointIndex] ?? 1;
          if ((confidence ?? 0) < 0.3) return;
          context.beginPath();
          context.arc(point[0], point[1], emphasised ? 4.5 : 3.5, 0, Math.PI * 2);
          context.fillStyle = '#05070f';
          context.fill();
          context.lineWidth = 2;
          context.strokeStyle = color;
          context.stroke();
        });
      });
    }
  }, [result, mode, overlay, hiddenClasses, selected, hovered, imageSize]);

  /* ------------------------------------------------------------ interaction */
  const hitTest = (event: React.MouseEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * imageSize.width;
    const y = ((event.clientY - rect.top) / rect.height) * imageSize.height;

    // Oriented boxes first (they overlap regular boxes).
    for (const item of result.obb?.items ?? []) {
      if (pointInPolygon(x, y, item.xyxy)) return item.index;
    }
    let best: { index: number; area: number } | null = null;
    for (const item of result.detections?.items ?? []) {
      const [x1, y1, x2, y2] = item.xyxy;
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        const area = (x2 - x1) * (y2 - y1);
        if (!best || area < best.area) best = { index: item.index, area };
      }
    }
    return best?.index ?? null;
  };

  const allItems = boxItems;
  const selectedBox = selected !== null ? (allItems.find((item) => item.index === selected) ?? null) : null;
  const selectedKeypoints: KeypointInstance | null =
    selected !== null
      ? (result.keypoints?.items.find((instance) => instance.index === selected) ?? null)
      : null;

  const objectCount =
    (result.detections?.count ?? 0) + (result.obb?.count ?? 0) + (result.masks?.count ?? 0) + (result.keypoints?.count ?? 0);

  if (objectCount === 0 && !result.probs) {
    return (
      <div className={className}>
        {imageUrl ? (
          <img src={imageUrl} alt="Inference source" className="max-h-[70vh] w-full rounded-xl object-contain" />
        ) : null}
        <EmptyState
          className="mt-3"
          icon={<EyeOff className="size-5" />}
          title="No objects detected"
          description="Try lowering the confidence threshold or choosing a model suited to this task."
        />
      </div>
    );
  }

  return (
    <div className={cn('grid gap-4', showInspector && 'xl:grid-cols-[minmax(0,1fr)_320px]', className)}>
      <div className="min-w-0">
        {allowModeSwitch && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl<RenderMode>
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'overlay', label: 'Canvas overlay', icon: <Layers className="size-3.5" /> },
                { value: 'server', label: 'Ultralytics plot', icon: <Eye className="size-3.5" />, hint: 'Server-rendered plot() output' },
                { value: 'original', label: 'Original', icon: <EyeOff className="size-3.5" /> },
              ]}
            />
            <div className="flex items-center gap-3">
              <Badge tone="brand" dot>
                {visibleBoxes.length} of {objectCount} objects
              </Badge>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.25}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="w-24"
                />
                <span className="w-8 font-mono text-[11px] text-slate-400">{zoom}×</span>
              </div>
            </div>
          </div>
        )}

        <div className="panel grid-noise relative overflow-hidden p-2">
          <div className="relative overflow-auto" style={{ maxHeight: '72vh' }}>
            {mode === 'overlay' && imageUrl ? (
              <div className="relative mx-auto" style={{ width: `${zoom * 100}%` }}>
                <img
                  src={imageUrl}
                  alt="Inference source"
                  className="block w-full select-none"
                  onLoad={(event) =>
                    setImageSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                  draggable={false}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 h-full w-full cursor-crosshair"
                  onMouseMove={(event) => setHovered(hitTest(event))}
                  onMouseLeave={() => setHovered(null)}
                  onClick={(event) => setSelected(hitTest(event))}
                />
              </div>
            ) : mode === 'server' && result.rendered_url ? (
              <img src={result.rendered_url} alt="Ultralytics plot" className="mx-auto block max-h-[68vh] w-auto" />
            ) : imageUrl ? (
              <img src={imageUrl} alt="Original" className="mx-auto block max-h-[68vh] w-auto" />
            ) : (
              <EmptyState icon={<EyeOff className="size-5" />} title="No preview available" />
            )}
          </div>
        </div>

        {(result.speed || result.probs) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            {result.speed && (
              <>
                <Badge>preprocess {formatMs(result.speed.preprocess_ms)}</Badge>
                <Badge>inference {formatMs(result.speed.inference_ms)}</Badge>
                <Badge>postprocess {formatMs(result.speed.postprocess_ms)}</Badge>
              </>
            )}
            <Badge tone="neutral">
              {result.original_shape[1]}×{result.original_shape[0]} px
            </Badge>
            {result.obb && <Badge tone="violet">oriented boxes</Badge>}
          </div>
        )}
      </div>

      {showInspector && (
        <div className="flex min-w-0 flex-col gap-4">
          {result.probs && <ClassificationPanel probs={result.probs} />}

          {classStats.length > 0 && (
            <div className="panel p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Classes</h3>
                <span className="text-[10px] text-slate-500">click to isolate</span>
              </div>
              <ul className="space-y-1">
                {classStats.map((stat) => {
                  const hidden = hiddenClasses.includes(stat.id);
                  return (
                    <li key={stat.id}>
                      <button
                        type="button"
                        onClick={() => onClassToggle?.(stat.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-700/60',
                          hidden && 'opacity-45',
                        )}
                      >
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: classColor(stat.id) }} />
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{stat.name}</span>
                        <span className="font-mono text-[11px] text-slate-400">{stat.count}</span>
                        <span className="w-12 text-right font-mono text-[11px] text-slate-500">
                          {stat.avgConf ? stat.avgConf.toFixed(2) : '—'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="panel p-3">
            <div className="mb-2 flex items-center gap-2">
              <MousePointerClick className="size-3.5 text-slate-500" />
              <h3 className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Inspector</h3>
            </div>
            {selectedBox || selectedKeypoints ? (
              selectedBox ? (
                <ObjectDetails item={selectedBox} />
              ) : (
                <KeypointDetails instance={selectedKeypoints!} />
              )
            ) : (
              <p className="text-[11px] leading-relaxed text-slate-500">
                Click an object in the canvas to inspect its geometry, confidence and keypoint confidences.
              </p>
            )}
          </div>

          {onOverlayChange && (
            <div className="panel space-y-3 p-3">
              <h3 className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Overlay</h3>
              <div className="grid grid-cols-2 gap-2">
                <Switch
                  checked={overlay.showLabels}
                  onChange={(value) => onOverlayChange({ showLabels: value })}
                  label="Labels"
                />
                <Switch
                  checked={overlay.showConfidence}
                  onChange={(value) => onOverlayChange({ showConfidence: value })}
                  label="Confidence"
                />
                <Switch checked={overlay.showMasks} onChange={(value) => onOverlayChange({ showMasks: value })} label="Masks" />
                <Switch
                  checked={overlay.showKeypoints}
                  onChange={(value) => onOverlayChange({ showKeypoints: value })}
                  label="Keypoints"
                />
              </div>
              <Slider
                label="Mask opacity"
                min={0.1}
                max={1}
                step={0.05}
                value={overlay.maskOpacity}
                onChange={(value) => onOverlayChange({ maskOpacity: value })}
                format={(value) => `${Math.round(value * 100)}%`}
              />
              <Slider
                label="Line width"
                min={1}
                max={6}
                step={0.5}
                value={overlay.lineWidth}
                onChange={(value) => onOverlayChange({ lineWidth: value })}
                format={(value) => `${value}px`}
              />
              {classStats.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  block
                  onClick={() => classStats.forEach((stat) => onClassToggle?.(stat.id))}
                >
                  Toggle all classes
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function drawLabel(
  context: CanvasRenderingContext2D,
  item: BoxItem,
  color: string,
  overlay: OverlaySettings,
  x: number,
  y: number,
  canvasWidth: number,
) {
  if (!overlay.showLabels && !overlay.showConfidence) return;
  const parts: string[] = [];
  if (overlay.showLabels) parts.push(item.class_name);
  if (overlay.showTrackIds && item.track_id !== null && item.track_id !== undefined) parts.push(`#${item.track_id}`);
  if (overlay.showConfidence && item.confidence !== null && item.confidence !== undefined) {
    parts.push(item.confidence.toFixed(2));
  }
  const text = parts.join(' ');
  if (!text) return;

  const fontSize = Math.max(11, Math.round(canvasWidth / 90));
  context.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const padding = 4;
  const textWidth = context.measureText(text).width;
  const boxHeight = fontSize + padding * 2;
  const boxWidth = textWidth + padding * 2;
  const labelY = y - boxHeight < 0 ? y : y - boxHeight;

  context.fillStyle = color;
  context.fillRect(x, labelY, boxWidth, boxHeight);
  context.fillStyle = '#05070f';
  context.textBaseline = 'middle';
  context.fillText(text, x + padding, labelY + boxHeight / 2);
}

function pointInPolygon(x: number, y: number, polygon: number[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const xi = polygon[i];
    const yi = polygon[i + 1];
    const xj = polygon[j];
    const yj = polygon[j + 1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function KeypointDetails({ instance }: { instance: KeypointInstance }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ background: classColor(instance.class_id + 3) }} />
        <span className="text-xs font-medium text-slate-200">{instance.class_name} skeleton #{instance.index}</span>
      </div>
      <div className="grid max-h-56 grid-cols-1 gap-x-3 gap-y-1 overflow-y-auto pr-1 sm:grid-cols-2">
        {instance.xy.map((point, index) => {
          const confidence = instance.confidence?.[index] ?? null;
          return (
            <div key={index} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-slate-400">{KEYPOINT_NAMES[index] ?? `kp${index}`}</span>
              <span className={cn('font-mono', (confidence ?? 1) > 0.5 ? 'text-slate-300' : 'text-slate-600')}>
                {confidence !== null ? confidence.toFixed(2) : '—'}
              </span>
              <span className="font-mono text-slate-600">
                {point[0].toFixed(0)},{point[1].toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ObjectDetails({ item }: { item: BoxItem }) {
  const box = item;
  const xyxy = box.xyxy ?? [];
  const xywhr = box.xywhr;
  const width = xyxy.length >= 4 ? xyxy[2] - xyxy[0] : 0;
  const height = xyxy.length >= 4 ? xyxy[3] - xyxy[1] : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm" style={{ background: classColor(box.class_id) }} />
        <span className="text-xs font-medium text-slate-200">{box.class_name}</span>
        {box.track_id !== null && box.track_id !== undefined && <Badge tone="violet">track #{box.track_id}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div>
          <dt className="text-slate-500">Confidence</dt>
          <dd className="font-mono text-slate-200">{formatScore(box.confidence)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Size</dt>
          <dd className="font-mono text-slate-200">
            {width.toFixed(0)}×{height.toFixed(0)}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-slate-500">Bounding box (xyxy)</dt>
          <dd className="font-mono text-slate-200">
            {xyxy.slice(0, 4).map((value) => value.toFixed(1)).join(', ')}
          </dd>
        </div>
        {xywhr && (
          <div className="col-span-2">
            <dt className="text-slate-500">Oriented (cx, cy, w, h, rad)</dt>
            <dd className="font-mono text-slate-200">
              {xywhr.map((value) => value.toFixed(2)).join(', ')} · {(xywhr[4] * (180 / Math.PI)).toFixed(1)}°
            </dd>
          </div>
        )}
        {box.xywhn && (
          <div className="col-span-2">
            <dt className="text-slate-500">Normalised (cx, cy, w, h)</dt>
            <dd className="font-mono text-slate-200">{box.xywhn.map((value) => value.toFixed(4)).join(', ')}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function ClassificationPanel({ probs }: { probs: NonNullable<ResultPayload['probs']> }) {
  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Top predictions</h3>
        <Tooltip label="Top-1 probability">
          <Badge tone="brand">{formatScore(probs.top1_conf)}</Badge>
        </Tooltip>
      </div>
      <p className="mb-3 truncate text-lg font-semibold text-slate-100">{probs.top1_name ?? '—'}</p>
      <ul className="space-y-2">
        {probs.top5.map((entry: ClassPrediction) => (
          <li key={entry.class_id}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-slate-300">{entry.class_name}</span>
              <span className="font-mono text-[11px] text-slate-400">{(entry.confidence * 100).toFixed(2)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700/80">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-400 to-violet-glow"
                style={{ width: `${Math.max(2, entry.confidence * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
