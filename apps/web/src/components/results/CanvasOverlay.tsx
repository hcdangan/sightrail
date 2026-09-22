import { useEffect, useRef, useState } from 'react';

import { classColor, cn, withAlpha } from '@/lib/utils';

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
 * Lightweight canvas overlay for live frames.
 *
 * Draws detection boxes and (optionally) a solution region of interest over an
 * image or video that is already on screen. Kept separate from `ResultsViewer`
 * because live views redraw on every frame with no interaction state.
 */
export function CanvasOverlay({
  imageUrl,
  videoRef,
  boxes = [],
  region,
  className,
  showLabels = true,
  lineWidth = 2,
}: {
  imageUrl?: string | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  boxes?: OverlayBox[];
  region?: number[][] | number[][][] | undefined;
  className?: string;
  showLabels?: boolean;
  lineWidth?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
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

    // Regions first.
    if (region) {
      const polygons = Array.isArray(region[0]?.[0]) ? (region as number[][][]) : [region as number[][]];
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      polygons.forEach((polygon, index) => {
        if (polygon.length < 2) return;
        context.beginPath();
        context.moveTo(polygon[0][0], polygon[0][1]);
        for (let point = 1; point < polygon.length; point += 1) {
          context.lineTo(polygon[point][0], polygon[point][1]);
        }
        context.closePath();
        context.strokeStyle = classColor(index + 5, 90, 70);
        context.stroke();
        context.fillStyle = withAlpha(classColor(index + 5, 90, 70), 0.08);
        context.fill();
      });
      context.setLineDash([]);
    }

    for (const box of boxes) {
      const color = box.color ?? classColor(0);
      context.lineWidth = lineWidth;
      context.strokeStyle = color;
      context.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
      if (showLabels && box.label) {
        context.font = '600 11px Inter, system-ui, sans-serif';
        const textWidth = context.measureText(box.label).width;
        context.fillStyle = color;
        context.fillRect(box.x1, Math.max(0, box.y1 - 16), textWidth + 8, 16);
        context.fillStyle = '#05070f';
        context.textBaseline = 'middle';
        context.fillText(box.label, box.x1 + 4, Math.max(8, box.y1 - 8));
      }
    }
  }, [boxes, region, showLabels, lineWidth, size]);

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

  if (imageUrl) {
    return (
      <div className={cn('relative', className)}>
        <img src={imageUrl} alt="" className="block w-full" />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    );
  }

  return <canvas ref={canvasRef} className={cn('pointer-events-none absolute inset-0 h-full w-full', className)} />;
}
