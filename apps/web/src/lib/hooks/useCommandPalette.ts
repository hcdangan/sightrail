import { useEffect, useState } from 'react';

/**
 * Global command palette shortcut (Ctrl/Cmd-K).
 *
 * Lives outside the palette component so that module only exports components,
 * which keeps React Fast Refresh effective during development.
 */
export function useCommandPalette(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return [open, setOpen];
}
