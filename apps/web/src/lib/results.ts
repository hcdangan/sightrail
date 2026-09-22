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
 * A rectangle (or polygon edge set) ready to draw over live media.
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
 * Detection geometry scaled from the frame the model saw to the frame on screen.
 *
 * These are three different sizes and conflating them is what makes an overlay
 * look detached from the video:
 *
 *  - the **displayed** element, which the browser letterboxes,
 *  - the **captured** frame the browser sent (capped at 960px wide), and
 *  - the **analysed** frame, `result.original_shape`, which is what `xyxy` is in.
 *
 * `displayWidth` here is the *media's* rendered size, not the wrapper's, so the
 * caller must have already accounted for letterboxing.
 */
export function overlayBoxes(
  result: ResultPayload | null | undefined,
  displayWidth: number,
  displayHeight: number,
  showLabels = true,
): OverlayBox[] {
  if (!result || displayWidth <= 0 || displayHeight <= 0) return [];

  const [frameHeight, frameWidth] = result.original_shape ?? [];
  // Without the analysed size there is nothing to scale against, and guessing
  // would misplace every box — so draw nothing rather than something wrong.
  if (!frameWidth || !frameHeight) return [];

  const scaleX = displayWidth / frameWidth;
  const scaleY = displayHeight / frameHeight;

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
      x1: x1 * scaleX,
      y1: y1 * scaleY,
      x2: x2 * scaleX,
      y2: y2 * scaleY,
      label: showLabels ? label : undefined,
      color: classColor(item.class_id),
      trackId: item.track_id ?? null,
    };
  });
}
