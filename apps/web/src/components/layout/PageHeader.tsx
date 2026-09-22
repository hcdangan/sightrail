import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives';

/**
 * Standard page header.
 *
 * Keeps titles, descriptions, supported-mode badges and primary actions aligned
 * across every page.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  badges,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  badges?: { label: ReactNode; tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'violet' }[];
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold tracking-[0.18em] text-brand-300/80 uppercase">{eyebrow}</p>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-slate-400 sm:text-sm">{description}</p>}
        {badges && badges.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {badges.map((badge, index) => (
              <Badge key={index} tone={badge.tone ?? 'neutral'}>
                {badge.label}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
