/**
 * Region-of-interest editor.
 *
 * Shared by every live mode so a counter line only has to be learned once. The
 * geometry is edited in display pixels and reported back in normalised 0..1
 * units, which is what keeps a saved ROI valid when the source resolution
 * changes (a 640x480 webcam, a 1080p video, a 4K file).
 */
import { useState } from 'react';
import { Move, RotateCcw } from 'lucide-react';

import { Badge, Button, Card, CardHeader, Switch } from '@/components/ui/primitives';
import { Viewfinder } from '@/components/input/Viewfinder';
import { normaliseRegion, type NormRegion } from '@/lib/region';

export type { NormRegion };

/**
 * Editable ROI card.
 *
 * Renders the region over the source preview when one exists, and over a plain
 * aspect box otherwise (a webcam has no still to show before it starts).
 */
export function RegionEditor({
  region,
  onChange,
  defaultRegion,
  regionKind,
  previewUrl,
  enabled = true,
  onEnabledChange,
  aspectRatio = '4 / 3',
  hint,
}: {
  region: NormRegion;
  onChange: (region: NormRegion) => void;
  /** The catalogue default, in whatever space the backend published it. */
  defaultRegion?: unknown;
  regionKind?: string | null;
  previewUrl?: string | null;
  enabled?: boolean;
  onEnabledChange?: (value: boolean) => void;
  aspectRatio?: string;
  hint?: string;
}) {
  const [dragging, setDragging] = useState(false);

  // A line ROI is two points; anything else is a polygon.
  const isLine = regionKind === 'line';
  const kindLabel = regionKind === 'polygons' ? 'multi-polygon' : isLine ? 'line' : 'polygon';

  return (
    <Card>
      <CardHeader
        title="Region of interest"
        description={`Drag the handles to place this ${kindLabel} over the frame. Coordinates are stored as fractions, so the region survives a change of resolution.`}
        actions={
          <div className="flex items-center gap-2">
            {onEnabledChange && <Switch checked={enabled} onChange={onEnabledChange} label="Use ROI" />}
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => onChange(normaliseRegion(defaultRegion))}
              title="Reset to the catalogue default"
            >
              Reset
            </Button>
          </div>
        }
      />

      <div className="relative">
        <Viewfinder
          aspectRatio={aspectRatio}
          region={region}
          onRegionChange={onChange}
          onRegionDragChange={setDragging}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
          ) : (
            <div className="absolute inset-0 grid place-items-center px-4 text-center text-[11px] text-slate-500">
              {dragging
                ? 'Drop the handle where it belongs.'
                : 'No still frame yet — the region still applies once frames arrive.'}
            </div>
          )}
        </Viewfinder>

        {!dragging && (
          <span className="pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-full border border-ink-600/70 bg-ink-950/85 px-2 py-1 text-[10px] text-slate-400">
            <Move className="size-3" />
            drag a handle
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone="brand">{kindLabel}</Badge>
        <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'applied' : 'ignored'}</Badge>
        <span className="font-mono text-[10px] break-all text-slate-500">
          {region.map((polygon) => `(${polygon.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')})`).join(' ')}
        </span>
      </div>

      {hint && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
    </Card>
  );
}

