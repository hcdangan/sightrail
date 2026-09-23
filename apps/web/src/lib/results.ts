/**
 * Small, pure helpers for describing inference results.
 *
 * Kept out of the page modules so those only export components (which keeps
 * React Fast Refresh working) and so the logic is unit-testable on its own.
 */
import type { BoxItem, ResultPayload } from './api-types';
import { classColor, formatPercent } from './utils';

/** One-line human summary of what a result contains. */
export function summarizeResult(result: ResultPayload): string {
  if (result.probs) {
    return `top-1 ${result.probs.top1_name ?? '—'} (${formatPercent(result.probs.top1_conf, 1)})`;
  }
  const parts = [
    result.detections && result.detections.count > 0 ? `${result.detections.count} boxes` : null,
    result.masks && result.masks.count > 0 ? `${result.masks.count} masks` : null,
    result.keypoints && result.keypoints.count > 0 ? `${result.keypoints.count} poses` : null,
    result.obb && result.obb.count > 0 ? `${result.obb.count} oriented boxes` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'no objects';
}

/** Total number of annotated entities, regardless of task. */
export function countObjects(result: ResultPayload | null | undefined): number {
  if (!result) return 0;
  return (
    (result.detections?.count ?? 0) +
    (result.obb?.count ?? 0) +
    (result.masks?.count ?? 0) +
    (result.keypoints?.count ?? 0)
  );
}

/** The class-name map with numeric keys normalised for table rendering. */
export function classEntries(names: Record<string, string> | undefined, limit = 40): { id: number; name: string }[] {
  return Object.entries(names ?? {})
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.id - b.id)
    .slice(0, limit);
}

/**
 * A detection box ready to draw over live media.
 *
 * Coordinates are **normalised to 0..1 of the analysed frame**, not pixels, and
 * the overlay multiplies them by its own rendered size. That indirection is what
 * keeps a 640x480 webcam, a 1280x720 one and a 4K one all correct on any layout.
 *
 * Lives here rather than next to the canvas component so `lib/` does not have to
 * import from `components/`; the overlay imports it instead.
 */
export interface OverlayBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  color?: string;
  trackId?: number | null;
}

/**
 * Detection geometry as fractions of the analysed frame, ready for the overlay.
 *
 * Three different sizes are in play here, and conflating any two of them is what
 * puts a box beside the object instead of on it:
 *
 *  - the **analysed** frame, `result.original_shape`, which is what `xyxy` is in,
 *  - the **camera's** resolution (`videoWidth`/`videoHeight`), which is unrelated
 *    to the above — `useCamera` caps the frame it captures at 960px wide, so the
 *    two agree at 640x480 and diverge at every other webcam resolution,
 *  - the **rendered** size, which depends on the layout and not on the camera.
 *
 * Normalising by the analysed frame and leaving the display scale to
 * `CanvasOverlay` (which measures itself) is what makes this independent of both.
 * The previous version took a display size and scaled straight to pixels, so it
 * silently assumed those pixels were the camera's — every box landed short of the
 * object on a 640-wide webcam and past it on a 1280-wide one.
 */
export function overlayBoxes(result: ResultPayload | null | undefined, showLabels = true): OverlayBox[] {
  if (!result) return [];

  const [frameHeight, frameWidth] = result.original_shape ?? [];
  // Without the analysed size there is nothing to normalise against, and guessing
  // would misplace every box — so draw nothing rather than something wrong.
  if (!frameWidth || !frameHeight) return [];

  const items: BoxItem[] = [...(result.detections?.items ?? []), ...(result.obb?.items ?? [])];
  return items.map((item) => {
    const [x1, y1, x2, y2] = item.xyxy;
    const label = [
      item.class_name,
      item.confidence !== null && item.confidence !== undefined ? formatPercent(item.confidence, 0) : null,
      item.track_id !== null && item.track_id !== undefined ? `#${item.track_id}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    return {
      x1: x1 / frameWidth,
      y1: y1 / frameHeight,
      x2: x2 / frameWidth,
      y2: y2 / frameHeight,
      label: showLabels ? label : undefined,
      color: classColor(item.class_id),
      trackId: item.track_id ?? null,
    };
  });
}
