/**
 * Tests for live-overlay and ROI geometry.
 *
 * Both cover a class of bug that is invisible in a typecheck and obvious on
 * screen: detection boxes that do not sit on the objects, and a region of
 * interest that lands somewhere other than where it was drawn.
 */
import { describe, expect, it } from 'vitest';

import type { ResultPayload } from './api-types';
import { clampRegion, normaliseRegion, type NormRegion } from './region';
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
  it('normalises geometry against the analysed frame', () => {
    // A 1280x720 frame the model saw. The overlay scales these against whatever
    // size it renders at, so none of this depends on the display or the camera.
    const boxes = overlayBoxes(resultWithBox([720, 1280], [100, 200, 300, 400]));

    expect(boxes).toHaveLength(1);
    expect(boxes[0].x1).toBeCloseTo(100 / 1280);
    expect(boxes[0].y1).toBeCloseTo(200 / 720);
    expect(boxes[0].x2).toBeCloseTo(300 / 1280);
    expect(boxes[0].y2).toBeCloseTo(400 / 720);
  });

  it('gives the same box for the same scene at any webcam resolution', () => {
    // The same object filling the middle of the frame at 640x480 and at 1920x1080
    // must produce identical geometry: the overlay cannot know the resolution, and
    // must not need to. `useCamera` caps the captured frame at 960px wide, so the
    // analysed frame is a third size again — a 640-wide camera matches it by
    // accident and no other resolution does, which is what shifted the boxes.
    const qvga = overlayBoxes(resultWithBox([480, 640], [64, 48, 320, 240]));
    const fullHd = overlayBoxes(resultWithBox([1080, 1920], [192, 108, 960, 540]));

    expect(qvga[0]).toMatchObject({ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 });
    expect(fullHd[0]).toMatchObject({ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 });
  });

  it('keeps a box that covers the whole frame at 0..1', () => {
    // The invariant that makes any display size correct: the frame edges are 1.0.
    const [box] = overlayBoxes(resultWithBox([480, 640], [0, 0, 640, 480]));
    expect(box).toMatchObject({ x1: 0, y1: 0, x2: 1, y2: 1 });
  });

  it('labels a box with class, confidence and track id', () => {
    const [box] = overlayBoxes(resultWithBox([480, 640], [0, 0, 10, 10]), true);
    expect(box.label).toBe('person 87% #4');
    expect(box.color).toBeTruthy();
    expect(box.trackId).toBe(4);
  });

  it('omits labels when asked, for a cleaner live view', () => {
    const [box] = overlayBoxes(resultWithBox([480, 640], [0, 0, 10, 10]), false);
    expect(box.label).toBeUndefined();
  });

  it('draws nothing without a known frame size', () => {
    // Guessing a scale here would put every box in the wrong place, so the only
    // safe answer is to draw none.
    const degenerate = { ...resultWithBox([480, 640], [1, 2, 3, 4]), original_shape: [0, 0] } as ResultPayload;
    expect(overlayBoxes(degenerate)).toEqual([]);
    expect(overlayBoxes(null)).toEqual([]);
  });

  it('handles a frame with no detections', () => {
    const empty = { ...resultWithBox([480, 640], [0, 0, 1, 1]), detections: null } as ResultPayload;
    expect(overlayBoxes(empty)).toEqual([]);
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
    const input: NormRegion = [
      [
        [0.5, 0.5],
      ],
    ];
    clampRegion(input);
    expect(input).toEqual([
      [
        [0.5, 0.5],
      ],
    ]);
  });
});
