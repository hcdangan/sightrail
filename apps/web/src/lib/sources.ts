/**
 * Source selection state for the inference pages.
 *
 * `SourceState` pairs the API's `SourceSpec` with a preview URL and a label, so
 * a page can render the current selection without re-deriving it.
 */
import type { SourceSpec } from './api-types';

export type SourceKind = 'sample' | 'upload' | 'url' | 'folder';

export interface SourceState {
  kind: SourceKind;
  /** The resolved SourceSpec sent to the API. */
  spec: SourceSpec;
  /** A display/preview URL for the chosen source, if it is an image. */
  previewUrl: string | null;
  label: string;
}

/** Default, empty selection used before the user picks anything. */
export function emptySource(): SourceState {
  return { kind: 'sample', spec: {}, previewUrl: null, label: '' };
}

/** True when the state carries something the API can resolve. */
export function hasSource(state: SourceState): boolean {
  const { spec } = state;
  return Boolean(spec.sample || spec.upload_id || spec.url || spec.path || spec.data_url || spec.camera !== null);
}
