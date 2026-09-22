/**
 * Preferences store: durable UI settings.
 *
 * Persisted to localStorage under a single versioned key so a schema change
 * never crashes a returning user.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { InferOptions } from '@/lib/api-types';

export type ThemeMode = 'dark' | 'midnight' | 'light';

interface PreferencesState {
  theme: ThemeMode;
  device: string;
  /** Default inference options shared by the Predict, Batch and Live Studio pages. */
  inferDefaults: Omit<InferOptions, 'classes'>;
  /** Overlay rendering preferences for the results viewer. */
  overlay: {
    showLabels: boolean;
    showConfidence: boolean;
    showMasks: boolean;
    showKeypoints: boolean;
    maskOpacity: number;
    lineWidth: number;
    showTrackIds: boolean;
  };
  sidebarCollapsed: boolean;
  reducedMotion: boolean;
  setTheme: (theme: ThemeMode) => void;
  setDevice: (device: string) => void;
  patchInferDefaults: (patch: Partial<PreferencesState['inferDefaults']>) => void;
  patchOverlay: (patch: Partial<PreferencesState['overlay']>) => void;
  toggleSidebar: () => void;
  setReducedMotion: (value: boolean) => void;
  reset: () => void;
}

const DEFAULT_INFER: PreferencesState['inferDefaults'] = {
  conf: 0.25,
  iou: 0.7,
  imgsz: 640,
  max_det: 300,
  device: 'auto',
  augment: false,
  agnostic_nms: false,
  retina_masks: false,
  half: null,
  save_rendered: true,
  mask_limit: 64,
};

const DEFAULT_OVERLAY: PreferencesState['overlay'] = {
  showLabels: true,
  showConfidence: true,
  showMasks: true,
  showKeypoints: true,
  maskOpacity: 0.45,
  lineWidth: 2,
  showTrackIds: true,
};

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'dark',
      device: 'auto',
      inferDefaults: DEFAULT_INFER,
      overlay: DEFAULT_OVERLAY,
      sidebarCollapsed: false,
      reducedMotion: false,
      setTheme: (theme) => set({ theme }),
      setDevice: (device) => set((state) => ({ device, inferDefaults: { ...state.inferDefaults, device } })),
      patchInferDefaults: (patch) => set((state) => ({ inferDefaults: { ...state.inferDefaults, ...patch } })),
      patchOverlay: (patch) => set((state) => ({ overlay: { ...state.overlay, ...patch } })),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setReducedMotion: (value) => set({ reducedMotion: value }),
      reset: () =>
        set({
          theme: 'dark',
          device: 'auto',
          inferDefaults: DEFAULT_INFER,
          overlay: DEFAULT_OVERLAY,
          sidebarCollapsed: false,
          reducedMotion: false,
        }),
    }),
    {
      name: 'sightrail.preferences.v1',
      partialize: (state) => ({
        theme: state.theme,
        device: state.device,
        inferDefaults: state.inferDefaults,
        overlay: state.overlay,
        sidebarCollapsed: state.sidebarCollapsed,
        reducedMotion: state.reducedMotion,
      }),
    },
  ),
);
