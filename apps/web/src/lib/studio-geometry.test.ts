/**
 * Tests for live-overlay and ROI geometry.
 *
 * Both cover a class of bug that is invisible in a typecheck and obvious on
 * screen: detection boxes that do not sit on the objects, and a region of
 * interest that lands somewhere other than where it was drawn.
 */
import { describe, expect, it } from 'vitest';

import type { ResultPayload } from './api-types';
import { clampRegion, normaliseRegion } from './region';
import { overlayBoxes } from './results';

function resultWithBox(originalShape: [number, number], xyxy: number[]): ResultPayload {
  return {
    task: 'detect',
    path: 'frame.jpg',
    original_shape: originalShape,
    names: { '0': 'person' },
    speed: { preprocess_ms: 1, inference_ms: 1, postprocess_ms: 1 },
    detections: {
      type: 'boxes',
      count: 1,
      items: [
        {
          index: 0,
          class_id: 0,
          class_name: 'person',
          confidence: 0.87,
          xyxy,
          track_id: 4,
        },
      ],
    },
    masks: null,
    keypoints: null,
    obb: null,
    probs: null,
    rendered_url: null,
    original_url: null,
    extra: {},
  };
}

describe('overlayBoxes', () => {
  it('scales geometry from the analysed frame to the displayed frame', () => {
    // The browser may be showing a 640-wide preview of a frame the model saw at
    // 1280 wide; every coordinate has to be halved.
    const boxes = overlayBoxes(resultWithBox([720, 1280], [100, 200, 300, 400]), 640, 360);

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x1: 50, y1: 100, x2: 150, y2: 200 });
  });

  it('labels a box with class, confidence and track id', () => {
    const [box] = overlayBoxes(resultWithBox([480, 640], [0, 0, 10, 10]), 640, 480, true);
    expect(box.label).toBe('person 87% #4');
    expect(box.color).toBeTruthy();
    expect(box.trackId).toBe(4);
  });

  it('omits labels when asked, for a cleaner live view', () => {
    const [box] = overlayBoxes(resultWithBox([480, 640], [0, 0, 10, 10]), 640, 480, false);
    expect(box.label).toBeUndefined();
  });

  it('draws nothing without a known frame size', () => {
    // Guessing a scale here would put every box in the wrong place, so the only
    // safe answer is to draw none.
    const degenerate = { ...resultWithBox([480, 640], [1, 2, 3, 4]), original_shape: [0, 0] } as ResultPayload;
    expect(overlayBoxes(degenerate, 640, 480)).toEqual([]);
    expect(overlayBoxes(resultWithBox([720, 1280], [1, 2, 3, 4]), 0, 0)).toEqual([]);
    expect(overlayBoxes(null, 640, 480)).toEqual([]);
  });

  it('handles a frame with no detections', () => {
    const empty = { ...resultWithBox([480, 640], [0, 0, 1, 1]), detections: null } as ResultPayload;
    expect(overlayBoxes(empty, 640, 480)).toEqual([]);
  });
});

describe('normaliseRegion', () => {
  it('treats catalogue defaults as the 1000x800 reference frame', () => {
    // The object-counting default line is [[100, 300], [900, 300]].
    expect(normaliseRegion([[100, 300], [900, 300]])).toEqual([
      [
        [0.1, 0.375],
        [0.9, 0.375],
      ],
    ]);
  });

  it('treats values at or below 1 as already normalised', () => {
    expect(normaliseRegion([[0, 0.5], [1, 0.5]])).toEqual([
      [
        [0, 0.5],
        [1, 0.5],
      ],
    ]);
  });

  it('keeps every polygon of a multi-polygon region', () => {
    const region = normaliseRegion([
      [[0, 0], [500, 0], [500, 400]],
      [[500, 400], [1000, 800]],
    ]);
    expect(region).toHaveLength(2);
    expect(region[0]).toEqual([[0, 0], [0.5, 0], [0.5, 0.5]]);
  });

  it('returns nothing for junk rather than throwing', () => {
    expect(normaliseRegion(undefined)).toEqual([]);
    expect(normaliseRegion(null)).toEqual([]);
    expect(normaliseRegion('nope')).toEqual([]);
    expect(normaliseRegion([])).toEqual([]);
    // A "polygon" of one point is not a region.
    expect(normaliseRegion([[5, 5]])).toEqual([]);
  });
});

describe('clampRegion', () => {
  it('keeps handles inside the frame', () => {
    expect(clampRegion([[[-0.4, 1.7], [0.5, 0.5]]])).toEqual([
      [
        [0, 1],
        [0.5, 0.5],
      ],
    ]);
  });

  it('does not mutate its input', () => {
    const input = [[[0.5, 0.5]]];
    clampRegion(input);
    expect(input).toEqual([[[0.5, 0.5]]]);
  });
});
