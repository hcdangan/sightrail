/**
 * Toast store: a tiny notification queue.
 *
 * Kept dependency-free (no portal library) - `Toaster` renders the queue and the
 * store owns the lifecycle timers.
 */
import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration: number;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let counter = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: ({ duration = 5200, ...toast }) => {
    counter += 1;
    const id = `toast-${counter}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id, duration }] }));
    if (duration > 0) {
      setTimeout(() => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })), duration);
    }
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Convenience helpers usable outside React components. */
export const toast = {
  info: (title: string, description?: string) => useToasts.getState().push({ tone: 'info', title, description }),
  success: (title: string, description?: string) => useToasts.getState().push({ tone: 'success', title, description }),
  warning: (title: string, description?: string) => useToasts.getState().push({ tone: 'warning', title, description }),
  error: (title: string, description?: string) =>
    useToasts.getState().push({ tone: 'error', title, description, duration: 9000 }),
};
