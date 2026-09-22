import { createContext, useContext } from 'react';

/**
 * Context shared by `Modal` and `useModal`.
 *
 * Declared in its own module so the UI primitives file only exports components
 * (React Fast Refresh) while still allowing consumers to close a dialog.
 */
export const ModalContext = createContext<{ onClose: () => void } | null>(null);

/** Access the enclosing modal's controls. Throws outside a `<Modal>`. */
export function useModal(): { onClose: () => void } {
  const context = useContext(ModalContext);
  if (!context) throw new Error('useModal must be used inside a <Modal>.');
  return context;
}
