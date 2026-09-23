import { useCallback, useEffect, useRef, useState } from 'react';

import type { OverlayBox } from '@/lib/results';
import { classColor, cn, withAlpha } from '@/lib/utils';

export type { OverlayBox };

/** How close (in CSS px) a pointer must be to a vertex to grab it. */
const HANDLE_RADIUS = 12;

/** A single polygon as `[x, y]` pairs in normalised 0..1 space. */
export type RegionPoints = number[][];
export type RegionShape = RegionPoints | RegionPoints[];

/** Normalised 0..1 geometry → canvas pixels, using the overlay's own size. */
function toCanvasSpace(region: RegionShape | undefined, width: number, height: number): RegionPoints[] {
  if (!region || region.length === 0 || width <= 0 || height <= 0) return [];
  const polygons = Array.isArray(region[0]?.[0]) ? (region as RegionPoints[]) : [region as RegionPoints];
  return polygons.map((polygon) => polygon.map(([x, y]) => [x * width, y * height]));
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Lightweight canvas overlay for live frames.
 *
 * Draws detection boxes and (optionally) a solution region of interest over an
 * image or video that is already on screen. Kept separate from `ResultsViewer`
 * because live views redraw on every frame with no interaction state.
 *
 * When `onRegionChange` is supplied the region becomes editable: drag a vertex to
 * move it. Both the incoming `region` and the reported updates are in normalised
 * 0..1 space — the canvas scales them against its own rendered size, so callers
 * never have to know how large the overlay ended up. `boxes` use the same
 * normalised space for the same reason: the caller knows the analysed frame but
 * not the layout, and the camera's resolution is a third, unrelated size.
 */
export function CanvasOverlay({
  imageUrl,
  videoRef,
  boxes = [],
  region,
  onRegionChange,
  onRegionDragChange,
  className,
  showLabels = true,
  lineWidth = 2,
}: {
  imageUrl?: string | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  boxes?: OverlayBox[];
  /** Normalised 0..1 geometry. */
  region?: RegionShape;
  /** Enables editing; receives normalised 0..1 geometry. */
  onRegionChange?: (region: RegionShape) => void;
  /** Notifies the caller while a handle is being dragged, for UI feedback. */
  onRegionDragChange?: (dragging: boolean) => void;
  className?: string;
  showLabels?: boolean;
  lineWidth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const dragRef = useRef<{ polygon: number; point: number; offsetX: number; offsetY: number } | null>(null);
  const editable = typeof onRegionChange === 'function';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? 0;
    const height = parent?.clientHeight ?? 0;
    if (width === 0 || height === 0) return;

    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);

    // Regions first, so detection boxes read on top of them.
    const polygons = toCanvasSpace(region, width, height);
    if (polygons.length > 0) {
      polygons.forEach((polygon, index) => {
        if (polygon.length < 2) return;
        const color = classColor(index + 5, 90, 70);
        context.lineWidth = 2;
        context.setLineDash([6, 4]);
        context.beginPath();
        context.moveTo(polygon[0][0], polygon[0][1]);
        for (let point = 1; point < polygon.length; point += 1) {
          context.lineTo(polygon[point][0], polygon[point][1]);
        }
        // A line ROI (exactly two points) is an open segment, not a closed area.
        if (polygon.length > 2) {
          context.closePath();
          context.fillStyle = withAlpha(color, 0.08);
          context.fill();
        }
        context.strokeStyle = color;
        context.stroke();
        context.setLineDash([]);

        if (editable) {
          context.fillStyle = color;
          for (const [x, y] of polygon) {
            context.beginPath();
            context.arc(x, y, 5, 0, Math.PI * 2);
            context.fill();
          }
        }
      });
    }

    for (const box of boxes) {
      // Boxes are normalised to the analysed frame, exactly like `region` above,
      // and are scaled here against the canvas's own rendered size. Doing this
      // against the camera's resolution instead is what shifted every box away
      // from its object — and made the error change with the webcam's resolution.
      const x1 = box.x1 * width;
      const y1 = box.y1 * height;
      const x2 = box.x2 * width;
      const y2 = box.y2 * height;
      const color = box.color ?? classColor(0);
      context.lineWidth = lineWidth;
      context.strokeStyle = color;
      context.strokeRect(x1, y1, x2 - x1, y2 - y1);
      if (showLabels && box.label) {
        context.font = '600 11px Inter, system-ui, sans-serif';
        const textWidth = context.measureText(box.label).width;
        context.fillStyle = color;
        context.fillRect(x1, Math.max(0, y1 - 16), textWidth + 8, 16);
        context.fillStyle = '#05070f';
        context.textBaseline = 'middle';
        context.fillText(box.label, x1 + 4, Math.max(8, y1 - 8));
      }
    }
  }, [boxes, region, showLabels, lineWidth, editable]);

  useEffect(() => {
    draw();
  }, [draw, size]);

  // Track the rendered size of the media so the canvas stays aligned.
  useEffect(() => {
    const element = videoRef?.current ?? canvasRef.current?.parentElement;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, [videoRef]);

  /** Pointer position in canvas-local CSS pixels. */
  const localPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!editable) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const polygons = toCanvasSpace(region, canvas.clientWidth, canvas.clientHeight);
      if (polygons.length === 0) return;
      const { x, y } = localPoint(event);

      for (let polygon = 0; polygon < polygons.length; polygon += 1) {
        for (let point = 0; point < polygons[polygon].length; point += 1) {
          const [px, py] = polygons[polygon][point];
          if (Math.hypot(px - x, py - y) <= HANDLE_RADIUS) {
            dragRef.current = { polygon, point, offsetX: px - x, offsetY: py - y };
            event.currentTarget.setPointerCapture(event.pointerId);
            onRegionDragChange?.(true);
            return;
          }
        }
      }
    },
    [editable, localPoint, onRegionDragChange, region],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!editable || !drag || !onRegionChange || !canvas) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;

      const { x, y } = localPoint(event);
      const next = toCanvasSpace(region, width, height).map((polygon) => polygon.map((point) => [...point]));
      const target = next[drag.polygon]?.[drag.point];
      if (!target) return;

      // Clamp so a handle cannot be dragged out of the frame and lost.
      target[0] = clamp01((x + drag.offsetX) / width);
      target[1] = clamp01((y + drag.offsetY) / height);

      // Hand back the same nesting that came in: a lone polygon stays a lone
      // polygon rather than silently becoming a one-element list.
      const wasMulti = Array.isArray(region?.[0]?.[0]);
      const normalised = next.map((polygon) => polygon.map(([px, py]) => [px, py]));
      onRegionChange(wasMulti ? normalised : normalised[0]);
    },
    [editable, localPoint, onRegionChange, region],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      onRegionDragChange?.(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onRegionDragChange],
  );

  const interactiveProps = editable
    ? {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        style: { touchAction: 'none' as const, cursor: 'crosshair' as const },
      }
    : {};

  if (imageUrl) {
    return (
      <div className={cn('relative', className)}>
        <img src={imageUrl} alt="" className="block w-full" />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" {...interactiveProps} />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={cn('pointer-events-none absolute inset-0 h-full w-full', editable && 'pointer-events-auto', className)}
      {...interactiveProps}
    />
  );
}
