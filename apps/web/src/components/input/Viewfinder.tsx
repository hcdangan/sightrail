/**
 * Media frame plus a drawing/editing canvas that share one coordinate space.
 *
 * Split from the ROI editor so each file exports a single component, which is
 * what keeps React Fast Refresh working for the Studio page.
 */
import { CanvasOverlay } from '@/components/results/CanvasOverlay';
import { clampRegion, type NormRegion } from '@/lib/region';

export function Viewfinder({
  aspectRatio,
  region,
  onRegionChange,
  onRegionDragChange,
  boxes,
  children,
  className,
}: {
  aspectRatio: string;
  region?: NormRegion;
  onRegionChange?: (region: NormRegion) => void;
  onRegionDragChange?: (dragging: boolean) => void;
  boxes?: Parameters<typeof CanvasOverlay>[0]['boxes'];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-ink-700/70 bg-ink-950 ${className ?? ''}`}
      style={{ aspectRatio }}
    >
      {children}
      {/* The canvas scales normalised geometry against its own rendered size,
          so nothing here needs to know the pixel dimensions. */}
      <CanvasOverlay
        boxes={boxes}
        region={region && region.length > 0 ? region : undefined}
        onRegionDragChange={onRegionDragChange}
        onRegionChange={onRegionChange ? (next) => onRegionChange(clampRegion(next as NormRegion)) : undefined}
      />
    </div>
  );
}
