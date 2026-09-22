/**
 * Primitive UI kit.
 *
 * A small, dependency-light component set (Tailwind + CVA-style variants) so
 * pages compose consistent controls without pulling in a component library.
 */
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown, Info, Loader2 } from 'lucide-react';

import { ModalContext } from '@/lib/modal-context';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-b from-brand-400 to-brand-600 text-ink-950 font-semibold shadow-[0_6px_20px_-8px_rgba(34,211,238,0.8)] hover:from-brand-300 hover:to-brand-500',
  secondary: 'bg-ink-700/80 text-slate-100 hover:bg-ink-600 border border-ink-600/80',
  outline: 'border border-ink-600 text-slate-200 hover:border-brand-400/70 hover:text-brand-200',
  ghost: 'text-slate-300 hover:bg-ink-700/60 hover:text-slate-100',
  danger: 'bg-danger-500/90 text-white hover:bg-danger-500',
  success: 'bg-success-500/90 text-ink-950 font-semibold hover:bg-success-400',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, icon, iconRight, block, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap font-medium transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
});

/* ------------------------------------------------------------------- Badge */

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'violet';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-ink-700/70 text-slate-300 border-ink-600',
  brand: 'bg-brand-500/15 text-brand-200 border-brand-500/40',
  success: 'bg-success-500/15 text-success-400 border-success-500/40',
  warning: 'bg-warning-500/15 text-warning-400 border-warning-500/40',
  danger: 'bg-danger-500/15 text-danger-400 border-danger-500/40',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  dot,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel p-4 sm:p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-ink-600/80 bg-ink-800/70 text-brand-300">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-100">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-2', className)}>
      <h3 className="text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">{children}</h3>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ Inputs */

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="mb-1.5 block text-xs font-medium text-slate-300">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-danger-400">{error}</span>}
    </label>
  );
}

const CONTROL_CLASS =
  'w-full rounded-lg border border-ink-600/80 bg-ink-900/80 px-3 text-sm text-slate-100 placeholder:text-slate-500 transition-colors focus:border-brand-400/80 focus:outline-none disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL_CLASS, 'h-9', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(CONTROL_CLASS, 'py-2 font-mono text-xs leading-relaxed', className)} {...props} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, placeholder, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(CONTROL_CLASS, 'h-9 appearance-none pr-9', className)} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-slate-500" />
    </div>
  );
});

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
  disabled,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('select-none', disabled && 'opacity-50')}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-300">
          {label}
        </label>
        <span className="font-mono text-xs text-brand-300">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border border-ink-700/60 bg-ink-900/50 p-3 text-left transition-colors',
        'hover:border-ink-600 disabled:cursor-not-allowed disabled:opacity-50',
        checked && 'border-brand-500/40 bg-brand-500/[0.07]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-brand-400 bg-brand-500/70' : 'border-ink-500 bg-ink-700',
        )}
      >
        <span
          className={cn(
            'size-3.5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-200">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{description}</span>}
      </span>
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode; hint?: string }[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center gap-1 rounded-xl border border-ink-700/70 bg-ink-900/60 p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg font-medium transition-all',
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
              active
                ? 'bg-gradient-to-b from-brand-400/25 to-brand-600/20 text-brand-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]'
                : 'text-slate-400 hover:bg-ink-700/60 hover:text-slate-200',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Progress */

export function ProgressBar({
  value,
  tone = 'brand',
  className,
  indeterminate,
}: {
  value: number;
  tone?: 'brand' | 'success' | 'danger' | 'warning';
  className?: string;
  indeterminate?: boolean;
}) {
  const tones = {
    brand: 'from-brand-400 to-violet-glow',
    success: 'from-success-400 to-success-500',
    danger: 'from-danger-400 to-danger-500',
    warning: 'from-warning-400 to-warning-500',
  } as const;
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-ink-700/80', className)}>
      <div
        className={cn('h-full rounded-full bg-gradient-to-r transition-[width] duration-500', tones[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {indeterminate && <span className="block h-full w-1/3 animate-[scan_1.6s_linear_infinite] bg-white/25" />}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-brand-300', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-ink-700/60', className)} />;
}

/* -------------------------------------------------------------------- Stat */

export function Stat({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const toneClass = {
    neutral: 'text-slate-100',
    brand: 'text-brand-200',
    success: 'text-success-400',
    warning: 'text-warning-400',
    danger: 'text-danger-400',
  }[tone];
  return (
    <div className={cn('panel panel-hover p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">{label}</span>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>
      <div className={cn('mt-2 font-mono text-2xl leading-none font-semibold', toneClass)}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Tooltip */

export function Tooltip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 hidden -translate-x-1/2 rounded-md border border-ink-600 bg-ink-850 px-2 py-1 text-[11px] whitespace-nowrap text-slate-200 shadow-xl group-hover/tt:block',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function InfoHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip label={children}>
      <Info className="size-3.5 cursor-help text-slate-500 hover:text-slate-300" />
    </Tooltip>
  );
}

/* ------------------------------------------------------------ Empty states */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink-600/70 bg-ink-900/40 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && <span className="grid size-12 place-items-center rounded-2xl bg-ink-800/80 text-slate-500">{icon}</span>}
      <div>
        <p className="text-sm font-medium text-slate-200">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------- Modal */



export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;
  return (
    <ModalContext.Provider value={{ onClose }}>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm sm:p-8">
        <div
          role="dialog"
          aria-modal="true"
          className={cn('panel animate-slide-up my-auto w-full', widths[size])}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-ink-700/60 p-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
              {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
              Close
            </Button>
          </div>
          <div className="max-h-[65vh] overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-ink-700/60 p-4">{footer}</div>}
        </div>
      </div>
    </ModalContext.Provider>
  );
}



/* -------------------------------------------------------------- Key / Value */

export function KeyValue({
  items,
  columns = 2,
  className,
}: {
  items: { label: ReactNode; value: ReactNode; mono?: boolean; hint?: ReactNode }[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const grid = { 1: 'grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns];
  return (
    <dl className={cn('grid grid-cols-1 gap-x-4 gap-y-3', grid, className)}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="flex items-center gap-1 text-[11px] tracking-wide text-slate-500 uppercase">
            {item.label}
            {item.hint && <InfoHint>{item.hint}</InfoHint>}
          </dt>
          <dd className={cn('mt-0.5 truncate text-sm text-slate-200', item.mono && 'font-mono text-xs')}>
            {item.value ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------- Table */

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  empty,
  dense,
  className,
  onRowClick,
}: {
  columns: { key: string; header: ReactNode; render: (row: T) => ReactNode; align?: 'left' | 'right' | 'center'; width?: string }[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  dense?: boolean;
  className?: string;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0 && empty) {
    return <div className={className}>{empty}</div>;
  }
  return (
    <div className={cn('-mx-2 overflow-x-auto px-2', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-700/70">
            {columns.map((column) => (
              <th
                key={column.key}
                style={{ width: column.width }}
                className={cn(
                  'px-2 pb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase',
                  column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={getRowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-ink-800/60 transition-colors last:border-0',
                onRowClick && 'cursor-pointer hover:bg-ink-700/40',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    dense ? 'px-2 py-1.5' : 'px-2 py-2.5',
                    'text-slate-300',
                    column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
