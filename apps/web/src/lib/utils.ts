import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, resolving Tailwind conflicts last-wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------- formatting */

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatMs(ms: number | null | undefined, digits = 1): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  return `${ms.toFixed(digits)} ms`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const normalised = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalised.toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatRelativeTime(input: number | string | null | undefined): string {
  if (input === null || input === undefined) return '—';
  const timestamp = typeof input === 'number' ? input * (input < 1e12 ? 1000 : 1) : Date.parse(input);
  if (Number.isNaN(timestamp)) return '—';
  const deltaSeconds = (Date.now() - timestamp) / 1000;
  if (deltaSeconds < 5) return 'just now';
  if (deltaSeconds < 60) return `${Math.floor(deltaSeconds)}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86_400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  if (deltaSeconds < 604_800) return `${Math.floor(deltaSeconds / 86_400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '--:--:--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString(undefined, { hour12: false });
}

/* ------------------------------------------------------------------ colors */

/**
 * Deterministic, perceptually-spread palette for class colours.
 * The golden-ratio hue walk gives good separation for the first ~40 classes.
 */
export function classColor(index: number, saturation = 78, lightness = 62): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} ${saturation}% ${lightness}%)`;
}

export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('hsl(')) {
    const inner = color.slice(4, -1);
    const [components] = inner.split('/');
    return `hsl(${components.trim()} / ${alpha})`;
  }
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/* ------------------------------------------------------------------- misc */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay = 200): (...args: Parameters<T>) => void {
  let handle: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delay);
  };
}

/** Trigger a client-side download for a Blob or URL. */
export function downloadUrl(url: string, filename?: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  if (filename) anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
  return Promise.resolve();
}

/** Colour ramp for heat-style tables (0 → cold, 1 → hot). */
export function heatColor(value: number, max: number): string {
  if (!max || max <= 0) return 'transparent';
  const ratio = clamp(value / max, 0, 1);
  const hue = 190 - 190 * ratio;
  return `hsl(${hue.toFixed(0)} 85% ${(28 + ratio * 22).toFixed(0)}% / 0.55)`;
}
