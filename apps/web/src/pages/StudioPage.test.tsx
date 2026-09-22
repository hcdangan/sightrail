/**
 * Live camera loop behaviour.
 *
 * The reported failure was "objects are not detected and no boxes are drawn" —
 * both invisible to a typecheck, so these assert the two things that actually have
 * to happen: a captured frame leaves the browser, and the geometry that comes back
 * reaches a *visible* canvas.
 *
 * The rAF stub is deliberately asynchronous. A real browser fires it on the next
 * paint, after React has committed its effects — and the bug this suite guards
 * against only reproduces in that ordering.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientCameraView } from './StudioPage';
import type { NormRegion } from '@/lib/region';

/** A 2D context that records what was drawn. */
function fakeContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
  };
}

/** Every 2D context handed out, so drawing can be asserted after the fact. */
const contexts: ReturnType<typeof fakeContext>[] = [];

class FakeWebSocket {
  static OPEN = 1;
  static last: FakeWebSocket | null = null;
  static sent: string[] = [];
  /** When set, every frame is answered so back-pressure can release. */
  static autoReply = false;

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.last = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(payload: string) {
    FakeWebSocket.sent.push(payload);
    // Mirror the real server: answer each frame so the client's in-flight
    // back-pressure releases and the next frame can be pushed.
    if (payload.includes('"type":"frame"') && FakeWebSocket.autoReply) {
      setTimeout(() => this.emit(FRAME_RESULT), 1);
    }
  }

  close() {}

  /** Deliver a server frame result to the client. */
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const FRAME_RESULT = {
  type: 'result',
  frame: 1,
  latency_ms: 12,
  avg_latency_ms: 12,
  fps: 30,
  rendered: null,
  counters: {},
  result: {
    task: 'detect',
    path: 'frame',
    original_shape: [480, 640],
    names: { '0': 'person' },
    speed: null,
    detections: {
      type: 'boxes',
      count: 1,
      items: [
        { index: 0, class_id: 0, class_name: 'person', confidence: 0.9, xyxy: [64, 48, 320, 240], track_id: 3 },
      ],
    },
    obb: null,
    keypoints: null,
    masks: null,
    probs: null,
    rendered_url: null,
    original_url: null,
    extra: {},
  },
};

/** A single normalised line ROI: `[[x1, y1], [x2, y2]]` inside a polygon list. */
function lineRegion(a: [number, number], b: [number, number]): NormRegion {
  return [[a, b]];
}

/** Give the stubbed rAF loop time for several frames. */
const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

/** Number of inference frames pushed so far. */
const framesSent = () => FakeWebSocket.sent.filter((raw) => raw.includes('"type":"frame"')).length;

/** Render the loop, start the camera and start inference. */
async function startLoop(props: Partial<Parameters<typeof ClientCameraView>[0]> = {}) {
  const view = render(
    <ClientCameraView
      model="yolo11n.pt"
      tracker={null}
      solution="none"
      conf={0.3}
      device="cpu"
      region={null}
      regionKind={null}
      {...props}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /start camera/i }));
  const inference = await screen.findByRole('button', { name: /start inference/i });
  await waitFor(() => expect((inference as HTMLButtonElement).disabled).toBe(false));
  // A real user cannot press "Start inference" before the video has reported its
  // size; the camera size is part of the config, so wait for that too.
  await settle();
  fireEvent.click(inference);
  return { ...view, inference };
}

beforeEach(() => {
  FakeWebSocket.sent = [];
  FakeWebSocket.last = null;
  FakeWebSocket.autoReply = false;
  contexts.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);

  let handle = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    handle += 1;
    setTimeout(() => callback(performance.now()), 8);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  // jsdom implements neither of these, and both sit on the capture path.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => {
    const context = fakeContext();
    contexts.push(context);
    return context;
  }) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,FRAME') as never;

  const stream = { getTracks: () => [{ stop: vi.fn() }] };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'cam-1', label: 'Front camera' }]),
    },
  });

  // The video is "playing" and reports a size, which the overlay scales by.
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
  Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined) as never;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live camera loop', () => {
  it('sends captured frames over the socket once inference starts', async () => {
    FakeWebSocket.autoReply = true;
    await startLoop();

    // One frame proves the gate opened — the bug this test exists for sent none.
    await waitFor(() => expect(framesSent(), 'no frame was ever sent to the API').toBeGreaterThan(0), {
      timeout: 6000,
    });
    // More than one proves the loop keeps running instead of stalling on the
    // first round trip. `FakeWebSocket.autoReply` releases the in-flight gate.
    await waitFor(() => expect(framesSent()).toBeGreaterThan(1), { timeout: 6000 });
  });

  it('sends the config before any frame, carrying the ROI and no rendered JPEG', async () => {
    const line = lineRegion([0.1, 0.4], [0.9, 0.4]);
    await startLoop({
      tracker: 'bytetrack.yaml',
      solution: 'object_counter',
      region: line,
      regionKind: 'line',
    });

    await settle();
    await waitFor(() => expect(FakeWebSocket.sent.length).toBeGreaterThan(0));
    const config = JSON.parse(FakeWebSocket.sent[0]) as { type: string; config: Record<string, unknown> };

    expect(config.type).toBe('config');
    // A list of polygons (here one line), each a list of [x, y] pairs.
    expect(config.config.region).toEqual([
      [
        [0.1, 0.4],
        [0.9, 0.4],
      ],
    ]);
    expect(config.config.region_normalised).toBe(true);
    expect(config.config.region_kind).toBe('line');
    // Requesting the annotated JPEG would waste an encode per frame.
    expect(config.config.render_frames).toBe(false);
    // The camera size must travel with the config or the ROI cannot be scaled.
    expect(config.config.frame_shape).toEqual([480, 640]);
  });

  it('renders the overlay on its own canvas, keeping the capture buffer hidden', async () => {
    const { container } = await startLoop();

    await waitFor(() => expect(FakeWebSocket.last).not.toBeNull());
    FakeWebSocket.last!.emit(FRAME_RESULT);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The original bug was one canvas serving as both the capture buffer and the
    // overlay: `useCamera` sets its width/height attributes, the page stretched
    // it with CSS, and the intrinsic backing store was zeroed — so every
    // detection was drawn into nothing. Two canvases is the fix; one is the bug.
    const canvases = [...container.querySelectorAll('canvas')];
    expect(canvases.length).toBeGreaterThanOrEqual(2);

    const hidden = canvases.filter((canvas) => canvas.className.includes('opacity-0'));
    expect(hidden, 'the capture buffer must be separate from the visible overlay').toHaveLength(1);

    // The capture buffer must be sized to the camera, ready for toDataURL.
    expect(hidden[0].width).toBe(640);
    expect(hidden[0].height).toBe(480);

    // Geometry reaching the overlay is asserted in `lib/studio-geometry.test.ts`
    // (`overlayBoxes`), because jsdom does no layout — `clientWidth`/`clientHeight`
    // are always 0, so the canvas draw call itself cannot be observed here.
  });

  it('surfaces the analysed object so the user can see inference ran', async () => {
    await startLoop();

    await waitFor(() => expect(FakeWebSocket.last).not.toBeNull());
    FakeWebSocket.last!.emit(FRAME_RESULT);

    expect(await screen.findByText(/person/)).not.toBeNull();
  });
});
