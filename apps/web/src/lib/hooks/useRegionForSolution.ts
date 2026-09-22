/**
 * Region-of-interest state shared by the live modes.
 *
 * Separate from the editor component so each file exports a single kind of
 * thing, which keeps React Fast Refresh working.
 */
import { useState } from 'react';

import { clampRegion, normaliseRegion, type NormRegion } from '@/lib/region';

/**
 * Keep a region in step with the selected solution.
 *
 * Selecting a different solution must not carry the previous one's geometry: a
 * counting line and a parking polygon are not interchangeable.
 *
 * This adjusts state during render rather than in an effect. An effect would
 * paint the outgoing solution's region for a frame before correcting itself, and
 * the React Compiler flags the synchronous `setState` inside it; comparing the
 * previous solution id during render is the documented way to reset state when a
 * prop changes.
 */
export function useRegionForSolution(
  solutionId: string,
  defaultRegion: unknown,
): [NormRegion, (next: NormRegion) => void] {
  const [state, setState] = useState<{ id: string; region: NormRegion }>(() => ({
    id: solutionId,
    region: normaliseRegion(defaultRegion),
  }));

  if (state.id !== solutionId) {
    setState({ id: solutionId, region: normaliseRegion(defaultRegion) });
  }

  return [state.region, (next: NormRegion) => setState((current) => ({ ...current, region: clampRegion(next) }))];
}
