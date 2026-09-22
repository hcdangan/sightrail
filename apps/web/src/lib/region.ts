/**
 * Region-of-interest geometry helpers.
 *
 * ROI coordinates travel in three different spaces and mixing them up is what
 * places a counter line in the wrong part of the frame:
 *
 *  - **normalised** (0..1) — what the UI stores, so a region stays meaningful at
 *    any resolution;
 *  - **display pixels** — what the editor canvas draws and the pointer reports;
 *  - **source pixels** — what the Ultralytics solutions consume.
 *
 * The backend's `default_region` values were authored against a nominal 1000x800
 * frame, so they are normalised through that reference rather than treated as
 * pixels.
 */

/** A polygon/line as `[x, y]` pairs in 0..1 space. */
export type NormPoints = number[][];

/** One line (`[[x, y], [x, y]]`) or many polygons. */
export type NormRegion = NormPoints[];

export const REGION_REFERENCE_WIDTH = 1000;
export const REGION_REFERENCE_HEIGHT = 800;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Deep-copies a region, clamping every coordinate into 0..1. */
export function clampRegion(region: NormRegion): NormRegion {
  return region.map((polygon) => polygon.map(([x, y]) => [clamp01(x), clamp01(y)]));
}

/**
 * Coerce whatever the solution catalogue reports into normalised 0..1 geometry.
 *
 * Handles both a single polygon (`[[x, y], …]`) and a multi-polygon
 * (`[[[x, y], …], …]`), and treats anything with a coordinate above 1 as the
 * 1000x800 reference space the defaults are written in.
 */
export function normaliseRegion(raw: unknown): NormRegion {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const polygons: number[][][] = Array.isArray(raw[0]?.[0]) ? (raw as number[][][]) : [raw as number[][]];
  const usesReferenceSpace = polygons.some((polygon) =>
    polygon.some((point) => Array.isArray(point) && (Number(point[0]) > 1 || Number(point[1]) > 1)),
  );

  const scaleX = usesReferenceSpace ? REGION_REFERENCE_WIDTH : 1;
  const scaleY = usesReferenceSpace ? REGION_REFERENCE_HEIGHT : 1;

  return polygons
    .filter((polygon) => polygon.length >= 2)
    .map((polygon) => polygon.map(([x, y]) => [clamp01(Number(x) / scaleX), clamp01(Number(y) / scaleY)]));
}

