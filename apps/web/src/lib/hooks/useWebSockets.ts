/**
 * WebSocket hooks.
 *
 * `useJobStream` attaches to a job's console channel (replay + live events) and
 * `useLiveInference` drives the client-side camera loop.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE } from '@/lib/api';
import type { JobDetail, JobProgressEvent, JobSummary, ResultPayload } from '@/lib/api-types';

function wsUrl(path: string): string {
  const base = API_BASE || window.location.origin;
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export type JobStreamState = {
  events: JobProgressEvent[];
  summary: JobSummary | null;
  connected: boolean;
  finished: boolean;
};

/**
 * Subscribe to `/api/ws/jobs/{id}`.
 *
 * The server replays the buffered log first, so a page opened mid-run still sees
 * the full history, then streams new events until the job settles.
 */
export function useJobStream(jobId: string | null | undefined): JobStreamState {
  const [events, setEvents] = useState<JobProgressEvent[]>([]);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setEvents([]);
      setSummary(null);
      setFinished(false);
      return;
    }

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(wsUrl(`/api/ws/jobs/${jobId}`));

      socket.onopen = () => setConnected(true);

      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data as string) as {
          type: string;
          event?: JobProgressEvent;
          job?: JobDetail;
          status?: string;
        };
        if (payload.type === 'event' && payload.event) {
          setEvents((previous) => {
            if (previous.some((item) => item.seq === payload.event!.seq)) return previous;
            return [...previous, payload.event!].slice(-1200);
          });
        }
        if ((payload.type === 'snapshot' || payload.type === 'done') && payload.job) {
          setSummary(payload.job);
          setEvents(payload.job.log ?? []);
          if (payload.type === 'done') {
            setFinished(true);
            closed = true;
          }
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [jobId]);

  return { events, summary, connected, finished };
}

export type LiveMessage =
  | { type: 'ready'; session: string; model: string; names: Record<string, string> }
  | {
      type: 'result';
      frame: number;
      latency_ms: number;
      avg_latency_ms: number;
      fps: number | null;
      result: ResultPayload | null;
      rendered: string | null;
      counters: Record<string, unknown>;
      session: string;
      uptime_s: number;
    }
  | { type: 'error'; message: string }
  | { type: 'reset' }
  | { type: 'ping'; status: string; percent: number };

export interface LiveFrameResult {
  frame: number;
  latencyMs: number;
  avgLatencyMs: number;
  fps: number | null;
  result: ResultPayload | null;
  rendered: string | null;
  counters: Record<string, unknown>;
}

export interface LiveInferenceConfig {
  model: string;
  task?: string | null;
  device?: string;
  tracker?: string | null;
  solution?: string;
  solutionKwargs?: Record<string, unknown>;
  region?: number[][] | null;
  regionKind?: string | null;
  showBoxes?: boolean;
  jpegQuality?: number;
  conf?: number;
  iou?: number;
  imgsz?: number;
  classes?: number[] | null;
}

export interface UseLiveInferenceResult {
  ready: boolean;
  names: Record<string, string>;
  last: LiveFrameResult | null;
  error: string | null;
  latencyHistory: { t: number; ms: number; fps: number | null; objects: number }[];
  connect: (config: LiveInferenceConfig) => void;
  send: (dataUrl: string) => void;
  reset: () => void;
  disconnect: () => void;
  measuring: boolean;
  setMeasuring: (value: boolean) => void;
}

/**
 * Drive `/api/ws/live`: push camera frames, receive geometry + rendered frames.
 *
 * Frames are only sent while `measuring` is true so pausing costs no bandwidth.
 */
export function useLiveInference(): UseLiveInferenceResult {
  const socketRef = useRef<WebSocket | null>(null);
  const [ready, setReady] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [last, setLast] = useState<LiveFrameResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [latencyHistory, setLatencyHistory] = useState<UseLiveInferenceResult['latencyHistory']>([]);
  const measuringRef = useRef(false);
  /** Back-pressure flag: skip frames while a response is still in flight. */
  const inflight = useRef(false);

  useEffect(() => {
    measuringRef.current = measuring;
  }, [measuring]);

  const connect = useCallback((config: LiveInferenceConfig) => {
    socketRef.current?.close();
    setError(null);
    setReady(false);

    const socket = new WebSocket(wsUrl('/api/ws/live'));
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'config',
          config: {
            model: config.model,
            task: config.task ?? null,
            device: config.device ?? 'auto',
            tracker: config.tracker ?? 'bytetrack.yaml',
            solution: config.solution ?? 'none',
            solution_kwargs: config.solutionKwargs ?? {},
            region: config.region ?? null,
            region_kind: config.regionKind ?? null,
            show_boxes: config.showBoxes ?? true,
            jpeg_quality: config.jpegQuality ?? 78,
            conf: config.conf,
            iou: config.iou,
            imgsz: config.imgsz,
            classes: config.classes ?? null,
          },
        }),
      );
    };

    socket.onmessage = (message) => {
      const payload = JSON.parse(message.data as string) as LiveMessage;
      if (payload.type === 'ready') {
        setReady(true);
        setNames(payload.names ?? {});
        return;
      }
      if (payload.type === 'error') {
        setError(payload.message);
        return;
      }
      if (payload.type === 'reset') {
        setLast(null);
        setLatencyHistory([]);
        return;
      }
      if (payload.type === 'result') {
        inflight.current = false;
        const objects =
          (payload.result?.detections?.count ?? 0) +
          (payload.result?.keypoints?.count ?? 0) +
          (payload.result?.obb?.count ?? 0);
        setLast({
          frame: payload.frame,
          latencyMs: payload.latency_ms,
          avgLatencyMs: payload.avg_latency_ms,
          fps: payload.fps,
          result: payload.result,
          rendered: payload.rendered,
          counters: payload.counters ?? {},
        });
        setLatencyHistory((history) => [
          ...history.slice(-119),
          { t: Date.now(), ms: payload.latency_ms, fps: payload.fps, objects },
        ]);
      }
    };

    socket.onerror = () => setError('WebSocket connection failed.');
  }, []);

  const send = useCallback((dataUrl: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !measuringRef.current) return;
    if (inflight.current) return;
    inflight.current = true;
    socket.send(JSON.stringify({ type: 'frame', data: dataUrl }));
  }, []);

  const reset = useCallback(() => socketRef.current?.send(JSON.stringify({ type: 'reset' })), []);
  const disconnect = useCallback(() => {
    socketRef.current?.send(JSON.stringify({ type: 'stop' }));
    socketRef.current?.close();
    socketRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => () => socketRef.current?.close(), []);

  return { ready, names, last, error, latencyHistory, connect, send, reset, disconnect, measuring, setMeasuring };
}
