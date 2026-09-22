/**
 * Small, pure helpers for describing inference results.
 *
 * Kept out of the page modules so those only export components (which keeps
 * React Fast Refresh working) and so the logic is unit-testable on its own.
 */
import type { ResultPayload } from './api-types';
import { formatPercent } from './utils';

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
