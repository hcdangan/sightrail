import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

import { useToasts, type ToastTone } from '@/lib/stores/toasts';
import { cn } from '@/lib/utils';

const TONE_STYLES: Record<ToastTone, { border: string; icon: ReactNode; text: string }> = {
  info: { border: 'border-info-400/40', icon: <Info className="size-4 text-info-400" />, text: 'text-info-400' },
  success: {
    border: 'border-success-500/40',
    icon: <CheckCircle2 className="size-4 text-success-400" />,
    text: 'text-success-400',
  },
  warning: {
    border: 'border-warning-500/40',
    icon: <AlertTriangle className="size-4 text-warning-400" />,
    text: 'text-warning-400',
  },
  error: { border: 'border-danger-500/40', icon: <XCircle className="size-4 text-danger-400" />, text: 'text-danger-400' },
};

/** Fixed-position toast stack. Mounted once, at the app root. */
export function Toaster() {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:right-4 sm:bottom-4 sm:left-auto sm:items-end">
      {toasts.map((item) => {
        const tone = TONE_STYLES[item.tone];
        return (
          <div
            key={item.id}
            role="status"
            className={cn(
              'panel animate-slide-up pointer-events-auto flex w-full max-w-sm items-start gap-3 border p-3 shadow-2xl',
              tone.border,
            )}
          >
            <span className="mt-0.5">{tone.icon}</span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-xs font-semibold', tone.text)}>{item.title}</p>
              {item.description && (
                <p className="mt-0.5 text-[11px] leading-relaxed break-words text-slate-400">{item.description}</p>
              )}
              {item.action && (
                <button
                  type="button"
                  onClick={item.action.onClick}
                  className="mt-1.5 text-[11px] font-medium text-brand-300 underline-offset-2 hover:underline"
                >
                  {item.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss notification"
              className="text-slate-500 transition-colors hover:text-slate-200"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
