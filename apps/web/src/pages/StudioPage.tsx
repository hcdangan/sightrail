import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Camera,
  CircleDot,
  Film,
  Gauge,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Video,
  Webcam,
} from 'lucide-react';

import { jobsApi, modelsApi, streamApi } from '@/lib/api';
import type { Artifact, ResultPayload, SessionHandle, SessionStats, SolutionMeta, TrackResponse } from '@/lib/api-types';
import { usePreferences } from '@/lib/stores/preferences';
import { toast } from '@/lib/stores/toasts';
import { classColor, formatMs } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { SourcePicker } from '@/components/input/SourcePicker';
import { RegionEditor, type NormRegion } from '@/components/input/RegionEditor';
import { Viewfinder } from '@/components/input/Viewfinder';
import { useRegionForSolution } from '@/lib/hooks/useRegionForSolution';
import { emptySource, type SourceState } from '@/lib/sources';
import { overlayBoxes } from '@/lib/results';
import { useJobStream, useLiveInference } from '@/lib/hooks/useWebSockets';
import { LogConsole } from '@/components/ui/LogConsole';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  SectionTitle,
  SegmentedControl,
  Select,
  Slider,
  Stat,
  Switch,
} from '@/components/ui/primitives';
import { LineChart } from '@/components/charts/LineChart';
import { useCamera } from '@/lib/hooks/useCamera';

type StudioTab = 'server' | 'client' | 'track' | 'video';

/**
 * Track & Stream studio.
 *
 * Four complementary ways to run Ultralytics on moving media:
 *  - `server`: MJPEG rendered by the API (any video file or webcam index),
 *  - `client`: WebSocket camera loop with a local canvas overlay (lowest latency),
 *  - `track`: track mode over a video, returning the full per-frame ID history,
 *  - `video`: process an entire video into an annotated MP4 as a background job.
 */
export function StudioPage() {
  const device = usePreferences((state) => state.device);
  const overlaySettings = usePreferences((state) => state.overlay);
  const [tab, setTab] = useState<StudioTab>('client');

  const { data: catalog } = useQuery({ queryKey: ['models', 'catalog'], queryFn: () => modelsApi.catalog() });
  const { data: solutions } = useQuery({ queryKey: ['stream', 'solutions'], queryFn: streamApi.solutions, staleTime: 300_000 });
  const { data: cameras } = useQuery({
    queryKey: ['stream', 'cameras'],
    queryFn: streamApi.cameras,
    staleTime: 60_000,
    retry: false,
  });
  const { data: trackers } = useQuery({ queryKey: ['models', 'trackers'], queryFn: modelsApi.trackers, staleTime: 300_000 });

  const detectModels = useMemo(
    () => (catalog?.models ?? []).filter((entry) => entry.task === 'detect' || entry.task === 'segment').map((entry) => ({ value: entry.id, label: entry.label })),
    [catalog],
  );

  const [model, setModel] = useState('yolo11n.pt');
  const [tracker, setTracker] = useState('bytetrack.yaml');
  const [solution, setSolution] = useState('none');
  const [conf, setConf] = useState(0.3);
  const [showBoxes, setShowBoxes] = useState(true);
  const [source, setSource] = useState<SourceState>(emptySource);

  const solutionMeta: SolutionMeta | undefined = solutions?.solutions.find((entry) => entry.id === solution);

  // The ROI follows the selected solution: a counting line and a parking polygon
  // are not interchangeable, so switching solutions reloads that solution's own
  // default geometry.
  const [region, setRegion] = useRegionForSolution(solution, solutionMeta?.default_region);
  const [useRegion, setUseRegion] = useState(true);

  const activeRegion = solutionMeta?.needs_region && useRegion && region.length > 0 ? region : null;

  useEffect(() => {
    if (!detectModels.some((entry) => entry.value === model) && detectModels[0]) setModel(detectModels[0].value);
  }, [detectModels, model]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mode 2 of 6 · Track & Stream"
        title="Live inference"
        description="Run YOLO on webcams and video files with six trackers, sixteen built-in solutions and live analytics — all streamed straight into the browser."
        badges={[
          { label: 'MJPEG + WebSocket', tone: 'brand' },
          { label: `${(trackers?.trackers ?? []).length} trackers`, tone: 'violet' },
          { label: `${(solutions?.solutions ?? []).length} solutions`, tone: 'success' },
        ]}
      />

      <SegmentedControl<StudioTab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'client', label: 'Webcam (client loop)', icon: <Webcam className="size-3.5" /> },
          { value: 'server', label: 'Server stream', icon: <Radio className="size-3.5" /> },
          { value: 'track', label: 'Track a video', icon: <Activity className="size-3.5" /> },
          { value: 'video', label: 'Render video (job)', icon: <Film className="size-3.5" /> },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader icon={<Gauge className="size-4" />} title="Pipeline" description="Model, tracker and solution layer." />
            <div className="space-y-3">
              <Select value={model} onChange={(event) => setModel(event.target.value)} options={detectModels} />
              <Select
                value={tracker}
                onChange={(event) => setTracker(event.target.value)}
                options={[
                  { value: '', label: 'No tracker (plain detect)' },
                  ...(trackers?.trackers ?? []).map((entry) => ({ value: entry.id, label: entry.label })),
                ]}
              />
              <Select
                value={solution}
                onChange={(event) => setSolution(event.target.value)}
                options={(solutions?.solutions ?? []).map((entry) => ({ value: entry.id, label: entry.label }))}
              />
              {solutionMeta && solutionMeta.id !== 'none' && (
                <p className="rounded-lg border border-ink-700/60 bg-ink-900/50 p-2 text-[11px] leading-relaxed text-slate-400">
                  {solutionMeta.description}
                  {solutionMeta.needs_region && ' This solution uses a region of interest you can adjust below.'}
                </p>
              )}
              <Slider label="Confidence" min={0.05} max={0.9} step={0.05} value={conf} onChange={setConf} format={(v) => v.toFixed(2)} />
              <Switch checked={showBoxes} onChange={setShowBoxes} label="Server-side boxes" description="Draw detections in Python before encoding." />
            </div>
          </Card>

          {(tab === 'server' || tab === 'track' || tab === 'video') && (
            <Card>
              <CardHeader icon={<Video className="size-4" />} title="Video source" description="Upload a clip, use a webcam or point at a server path." />
              <SourcePicker value={source} onChange={setSource} accept="video" />
              {(cameras?.cameras?.length ?? 0) > 0 && (
                <>
                  <SectionTitle className="mt-4">Webcams</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {cameras!.cameras.map((camera) => (
                      <Button
                        key={camera.id}
                        size="xs"
                        variant={source.spec.camera === camera.id ? 'primary' : 'outline'}
                        icon={<Camera className="size-3" />}
                        onClick={() =>
                          setSource({ kind: 'folder', spec: { camera: camera.id }, previewUrl: null, label: camera.label })
                        }
                      >
                        {camera.label} · {camera.resolution}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}

          {solutionMeta?.needs_region && (
            <RegionEditor
              region={region}
              onChange={setRegion}
              defaultRegion={solutionMeta.default_region}
              regionKind={solutionMeta.region_kind}
              previewUrl={source.previewUrl}
              enabled={useRegion}
              onEnabledChange={setUseRegion}
              hint="Coordinates are sent as fractions of the frame, so one region stays correct for a 640x480 webcam and a 4K video alike. The API resolves them against the real source size."
            />
          )}

          <Card>
            <CardHeader title="Tracker reference" description="How the six built-in trackers differ." />
            <ul className="space-y-2">
              {(trackers?.trackers ?? []).map((entry) => (
                <li key={entry.id} className="rounded-lg border border-ink-700/60 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-200">{entry.label}</span>
                    {entry.recommended && <Badge tone="brand">default</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{entry.description}</p>
                  {entry.requires.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-warning-400">requires {entry.requires.join(', ')}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {tab === 'client' && (
            <ClientCameraView
              model={model}
              tracker={tracker || null}
              solution={solution}
              conf={conf}
              device={device}
              region={activeRegion}
              regionKind={solutionMeta?.region_kind ?? null}
            />
          )}
          {tab === 'server' && (
            <ServerStreamView
              model={model}
              tracker={tracker || null}
              solution={solution}
              conf={conf}
              device={device}
              showBoxes={showBoxes}
              source={source}
              region={activeRegion}
              regionKind={solutionMeta?.region_kind ?? null}
            />
          )}
          {tab === 'track' && <TrackView model={model} tracker={tracker || 'bytetrack.yaml'} conf={conf} device={device} source={source} />}
          {tab === 'video' && (
            <VideoJobView
              model={model}
              tracker={tracker || null}
              solution={solution}
              conf={conf}
              device={device}
              source={source}
              region={activeRegion}
              regionKind={solutionMeta?.region_kind ?? null}
            />
          )}

          {overlaySettings.showTrackIds && (
            <p className="text-[11px] text-slate-500">
              Track colours are stable per ID — each object keeps its colour for the whole clip.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ client */

/** Exported for the behavioural test in `StudioPage.test.tsx`. */
export function ClientCameraView({
  model,
  tracker,
  solution,
  conf,
  device,
  region,
  regionKind,
}: {
  model: string;
  tracker: string | null;
  solution: string;
  conf: number;
  device: string;
  region: NormRegion | null;
  regionKind: string | null;
}) {
  const { videoRef, canvasRef, status, error, start, stop, captureFrame, devices, selectedDeviceId, selectDevice } = useCamera();
  const live = useLiveInference();
  // `live.measuring` drives the labels and the LIVE badge; `live.setActive` opens
  // the frame gate synchronously, in the same click that starts the rAF loop.
  const { measuring, setActive } = live;
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(null);
  const settings = usePreferences((state) => state.overlay);

  // Push frames on a rAF loop while measuring; the hook applies back-pressure.
  // `send` is stable and `live` is not, so destructuring avoids depending on the
  // hook's return object identity — that tore the loop down on every frame.
  const { send: sendFrame } = live;
  useEffect(() => {
    if (!measuring) return;
    let frameHandle = 0;
    const tick = () => {
      const dataUrl = captureFrame();
      if (dataUrl) sendFrame(dataUrl);
      frameHandle = requestAnimationFrame(tick);
    };
    frameHandle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameHandle);
  }, [measuring, captureFrame, sendFrame]);

  // The boxes come back in the analysed frame's pixel space, so they have to be
  // scaled to whatever size the video element actually renders at.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || status !== 'streaming') return;
    const sync = () =>
      setMediaSize(video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null);
    sync();
    video.addEventListener('loadedmetadata', sync);
    video.addEventListener('resize', sync);
    return () => {
      video.removeEventListener('loadedmetadata', sync);
      video.removeEventListener('resize', sync);
    };
  }, [status, videoRef]);

  useEffect(() => {
    setActive(false);
  }, [status]);

  const result = live.last?.result ?? null;
  const boxes = useMemo(
    () => overlayBoxes(result, mediaSize?.width ?? 0, mediaSize?.height ?? 0, settings.showLabels),
    [result, mediaSize, settings.showLabels],
  );

  return (
    <>
      <Card>
        <CardHeader
          icon={<Webcam className="size-4" />}
          title="Webcam loop"
          description="Frames are captured in the browser, sent over WebSocket, and annotated locally for minimum latency."
          actions={
            <div className="flex items-center gap-2">
              {status !== 'streaming' ? (
                <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => void start(selectedDeviceId)}>
                  Start camera
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  icon={<CircleDot className="size-3.5" />}
                  onClick={() => {
                    setActive(false);
                    live.disconnect();
                    stop();
                  }}
                >
                  Stop
                </Button>
              )}
              <Button
                size="sm"
                variant={measuring ? 'secondary' : 'outline'}
                icon={measuring ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                disabled={status !== 'streaming'}
                onClick={() => {
                  if (!measuring) {
                    live.connect({
                      model,
                      device,
                      tracker,
                      solution,
                      conf,
                      showBoxes: true,
                      jpegQuality: 72,
                      // Geometry is drawn locally from `result`, so there is no
                      // reason to make the API encode and ship a JPEG per frame.
                      renderFrames: false,
                      region,
                      regionKind,
                      frameShape: mediaSize ? [mediaSize.height, mediaSize.width] : null,
                    });
                    setActive(true);
                  } else {
                    setActive(false);
                  }
                }}
              >
                {measuring ? 'Pause inference' : 'Start inference'}
              </Button>
            </div>
          }
        />

        {devices.length > 1 && (
          <div className="mb-3">
            <Select
              value={selectedDeviceId ?? ''}
              onChange={(event) => selectDevice(event.target.value)}
              options={devices.map((device_) => ({ value: device_.deviceId, label: device_.label }))}
            />
          </div>
        )}

        <Viewfinder
          aspectRatio={mediaSize ? `${mediaSize.width} / ${mediaSize.height}` : '4 / 3'}
          region={region ?? undefined}
          boxes={boxes}
        >
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-contain" playsInline muted />
          {/* Capture buffer only: `useCamera` encodes this to a JPEG data URL.
              It is never shown, and it must not be the overlay canvas. */}
          <canvas ref={canvasRef} className="pointer-events-none absolute size-0 opacity-0" aria-hidden />

          {status !== 'streaming' && (
            <div className="absolute inset-0 grid place-items-center bg-ink-950/70">
              <EmptyState
                icon={<Webcam className="size-5" />}
                title="Camera stopped"
                description="Start the camera, then start inference. Nothing leaves your machine except the frames you send to your own API."
              />
            </div>
          )}

          {measuring && (
            <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full border border-danger-500/40 bg-ink-950/80 px-2 py-1 text-[10px] font-semibold tracking-wider text-danger-400 uppercase">
              <span className="size-1.5 animate-pulse-slow rounded-full bg-danger-400" /> live
            </span>
          )}
        </Viewfinder>

        {(error || live.error) && (
          <p className="mt-2 rounded-lg border border-danger-500/40 bg-danger-500/10 p-2 text-[11px] text-danger-300">
            {error ?? live.error}
          </p>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={live.last ? formatMs(live.last.latencyMs, 0) : '—'} label="Round trip" />
        <Stat value={live.last?.fps ? live.last.fps.toFixed(1) : '—'} label="Throughput (fps)" />
        <Stat value={live.last?.frame ?? 0} label="Frames analysed" />
        <Stat value={Object.keys(live.last?.counters ?? {}).length} label="Analytics signals" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Latency" description="Per-frame round-trip time in milliseconds." />
          <LineChart
            data={live.latencyHistory.map((point, index) => ({ index, ms: point.ms, objects: point.objects }))}
            xKey="index"
            series={[
              { key: 'ms', label: 'Latency (ms)', color: '#22d3ee' },
              { key: 'objects', label: 'Objects', color: '#a78bfa' },
            ]}
            height={180}
            emptyMessage="Start inference to collect latency samples."
          />
        </Card>

        <Card>
          <CardHeader title="Live detections" description="Everything the current frame produced." />
          {result ? (
            <DetectionTable result={result} />
          ) : (
            <p className="text-xs text-slate-500">No frames analysed yet.</p>
          )}
          {live.last && Object.keys(live.last.counters).length > 0 && (
            <>
              <SectionTitle className="mt-4">Solution counters</SectionTitle>
              <KeyValue
                columns={2}
                items={Object.entries(live.last.counters).map(([key, value]) => ({
                  label: key.replace(/_/g, ' '),
                  value: Array.isArray(value) ? value.join(', ') : String(value),
                  mono: true,
                }))}
              />
            </>
          )}
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ server */

function ServerStreamView({
  model,
  tracker,
  solution,
  conf,
  device,
  showBoxes,
  source,
  region,
  regionKind,
}: {
  model: string;
  tracker: string | null;
  solution: string;
  conf: number;
  device: string;
  showBoxes: boolean;
  source: SourceState;
  region: NormRegion | null;
  regionKind: string | null;
}) {
  const [session, setSession] = useState<SessionHandle | null>(null);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const queryClient = useQueryClient();

  const open = useMutation({
    mutationFn: () =>
      streamApi.openSession({
        model,
        source: source.spec,
        tracker,
        solution,
        conf,
        device,
        show_boxes: showBoxes,
        jpeg_quality: 80,
        // Normalised geometry: the API probes the real source size and scales it,
        // which is what makes the ROI correct for both files and camera indexes.
        region,
        region_kind: regionKind,
        region_normalised: true,
      }),
    onSuccess: (data) => {
      setSession(data);
      toast.success('Session opened', `${data.solution} · ${data.model.split(/[\\/]/).pop()}`);
      if (data.region_applied === false && data.region_note) {
        toast.warning('Region of interest ignored', data.region_note);
      }
    },
    onError: (error: Error) => toast.error('Could not open the session', error.message),
  });

  const close = useMutation({
    mutationFn: (id: string) => streamApi.close(id),
    onSuccess: () => {
      setSession(null);
      setStats(null);
      queryClient.invalidateQueries({ queryKey: ['stream', 'sessions'] });
    },
  });

  useEffect(() => {
    if (!session) return;
    const handle = setInterval(async () => {
      try {
        setStats(await streamApi.stats(session.session_id));
      } catch {
        /* session may have ended */
      }
    }, 1000);
    return () => clearInterval(handle);
  }, [session]);

  return (
    <>
      <Card>
        <CardHeader
          icon={<Radio className="size-4" />}
          title="Server-rendered MJPEG"
          description="The API decodes, infers, annotates and re-encodes every frame — usable for any video file or webcam index."
          actions={
            session ? (
              <Button size="sm" variant="danger" icon={<CircleDot className="size-3.5" />} onClick={() => close.mutate(session.session_id)}>
                Close session
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={<Play className="size-3.5" />}
                loading={open.isPending}
                disabled={!source.spec.upload_id && source.spec.camera === undefined && !source.spec.path}
                onClick={() => open.mutate()}
              >
                Open stream
              </Button>
            )
          }
        />

        {session ? (
          <div className="relative overflow-hidden rounded-xl border border-ink-700/70 bg-ink-950">
            <img src={session.mjpeg_url} alt="Live inference stream" className="block w-full" />
            <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full border border-brand-500/40 bg-ink-950/80 px-2 py-1 text-[10px] font-semibold tracking-wider text-brand-300 uppercase">
              <span className="size-1.5 animate-pulse-slow rounded-full bg-brand-400" /> {session.solution}
            </span>
          </div>
        ) : (
          <EmptyState
            icon={<Radio className="size-5" />}
            title="No active session"
            description="Pick a video source on the left (upload, webcam or path) and open the stream."
          />
        )}
      </Card>

      {stats && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Throughput" value={`${stats.fps.toFixed(1)} fps`} tone="brand" />
            <Stat label="Frames" value={stats.frames} />
            <Stat label="Uptime" value={`${stats.uptime_s.toFixed(0)}s`} />
            <Stat label="Solution" value={stats.solution} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Objects per frame" description="Rolling window from the server session." />
              <LineChart
                data={stats.history.map((point) => ({ frame: point.frame, count: point.count, fps: point.fps }))}
                xKey="frame"
                series={[
                  { key: 'count', label: 'Objects', color: '#22d3ee' },
                  { key: 'fps', label: 'FPS', color: '#4ade80' },
                ]}
                height={180}
                emptyMessage="Waiting for frames…"
              />
            </Card>
            <Card>
              <CardHeader title="Solution counters" description="Live values published by the analytics layer." />
              {Object.keys(stats.counters).length === 0 ? (
                <p className="text-xs text-slate-500">This solution does not publish counters.</p>
              ) : (
                <KeyValue
                  columns={2}
                  items={Object.entries(stats.counters).map(([key, value]) => ({
                    label: key.replace(/_/g, ' '),
                    value: Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value),
                    mono: true,
                  }))}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- track */

function TrackView({
  model,
  tracker,
  conf,
  device,
  source,
}: {
  model: string;
  tracker: string;
  conf: number;
  device: string;
  source: SourceState;
}) {
  const [data, setData] = useState<TrackResponse | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);

  const track = useMutation({
    mutationFn: () => streamApi.track({ model, source: source.spec, tracker, conf, device, max_frames: 150 }),
    onSuccess: (result) => {
      setData(result);
      setFrameIndex(0);
      toast.success(`Tracked ${result.count} frames`, `${result.unique_ids} unique identities`);
    },
    onError: (error: Error) => toast.error('Tracking failed', error.message),
  });

  const current = data?.frames[frameIndex];

  return (
    <>
      <Card>
        <CardHeader
          icon={<Activity className="size-4" />}
          title="Track mode"
          description="Ultralytics assigns and persists IDs across frames. Scrub through the returned history to inspect assignments."
          actions={
            <Button
              size="sm"
              variant="primary"
              icon={<Play className="size-3.5" />}
              loading={track.isPending}
              disabled={!source.spec.upload_id && !source.spec.path}
              onClick={() => track.mutate()}
            >
              Run tracking
            </Button>
          }
        />

        {!data ? (
          <EmptyState
            icon={<Activity className="size-5" />}
            title="No track history yet"
            description="Upload a video (or point at a server path), choose a tracker and run. Up to 150 frames are returned with per-object IDs."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Frames" value={data.count} tone="brand" />
              <Stat label="Unique IDs" value={data.unique_ids} />
              <Stat label="Detections" value={data.frames.reduce((total, frame) => total + frame.detections.length, 0)} />
              <Stat label="Tracker" value={data.tracker.replace('.yaml', '')} />
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono">
                  frame {frameIndex + 1} / {data.frames.length}
                </span>
                <span>{current?.detections.length ?? 0} objects</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, data.frames.length - 1)}
                value={frameIndex}
                onChange={(event) => setFrameIndex(Number(event.target.value))}
                className="w-full"
              />
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(current?.detections ?? []).map((detection, index) => (
                  <span
                    key={`${detection.track_id}-${index}`}
                    className="rounded-md border px-2 py-1 font-mono text-[10px]"
                    style={{
                      borderColor: classColor(detection.track_id ?? detection.class_id),
                      color: classColor(detection.track_id ?? detection.class_id),
                    }}
                  >
                    #{detection.track_id ?? '—'} {detection.class_name} {detection.confidence?.toFixed(2)}
                  </span>
                ))}
                {(current?.detections.length ?? 0) === 0 && <span className="text-[11px] text-slate-500">No objects in this frame.</span>}
              </div>
            </div>
          </>
        )}
      </Card>

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Objects per frame" description="Population over the clip." />
            <LineChart
              data={data.frames.map((frame) => ({ frame: frame.frame, objects: frame.detections.length }))}
              xKey="frame"
              series={[{ key: 'objects', label: 'Objects', color: '#22d3ee' }]}
              height={200}
            />
          </Card>
          <Card>
            <CardHeader title="Class distribution" description="Detections summed across all frames." />
            <ul className="space-y-2">
              {Object.entries(data.histogram).map(([name, count]) => {
                const max = Math.max(...Object.values(data.histogram));
                return (
                  <li key={name}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300">{name}</span>
                      <span className="font-mono text-slate-500">{count}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700/80">
                      <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-violet-glow" style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- video job */

function VideoJobView({
  model,
  tracker,
  solution,
  conf,
  device,
  source,
  region,
  regionKind,
}: {
  model: string;
  tracker: string | null;
  solution: string;
  conf: number;
  device: string;
  source: SourceState;
  region: NormRegion | null;
  regionKind: string | null;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const stream = useJobStream(jobId);
  const queryClient = useQueryClient();
  const notified = useRef(false);

  const start = useMutation({
    mutationFn: () =>
      streamApi.analyseVideo({
        model,
        source: source.spec,
        tracker,
        solution,
        conf,
        device,
        region,
        region_kind: regionKind,
        region_normalised: true,
      }),
    onSuccess: (job) => {
      setJobId(job.id);
      notified.current = false;
      toast.info('Video analysis started', 'A job is rendering every frame; the MP4 appears when it completes.');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error: Error) => toast.error('Could not start the job', error.message),
  });

  useEffect(() => {
    if (stream.summary?.status === 'succeeded' && !notified.current) {
      notified.current = true;
      toast.success('Video analysis complete', 'Download the annotated MP4 below.');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    }
  }, [stream.summary?.status, queryClient]);

  const artifacts = stream.summary?.artifacts ?? [];
  const timeline = (stream.summary?.result?.timeline ?? []) as { frame: number; count: number; unique_ids: number; fps: number }[];

  return (
    <>
      <Card>
        <CardHeader
          icon={<Film className="size-4" />}
          title="Batch video analysis"
          description="Renders an annotated MP4 frame-by-frame in a background job, streaming progress into the console."
          actions={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={<Play className="size-3.5" />}
                loading={start.isPending}
                disabled={!source.spec.upload_id && !source.spec.path}
                onClick={() => start.mutate()}
              >
                Analyse video
              </Button>
              {jobId && (
                <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => jobsApi.cancel(jobId)}>
                  Cancel
                </Button>
              )}
            </div>
          }
        />

        {!jobId ? (
          <EmptyState
            icon={<Film className="size-5" />}
            title="No video job"
            description="Upload an MP4 on the left (or use a server path) and start the analysis. The result is a downloadable annotated video."
          />
        ) : (
          <LogConsole
            events={stream.events}
            percent={stream.summary?.percent}
            status={stream.summary?.status}
            height="h-64"
          />
        )}
      </Card>

      {artifacts.length > 0 && (
        <Card>
          <CardHeader title="Artifacts" description="Files produced by this job." />
          <div className="space-y-3">
            {artifacts.map((artifact: Artifact) => (
              <div key={artifact.path} className="rounded-lg border border-ink-700/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-mono text-[11px] text-slate-200">{artifact.name}</span>
                  {artifact.url && (
                    <a href={artifact.url} download className="text-[11px] text-brand-300 hover:underline">
                      Download
                    </a>
                  )}
                </div>
                {artifact.kind === 'video' && artifact.url && (
                  <video src={artifact.url} controls className="mt-3 w-full rounded-lg" />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {timeline.length > 1 && (
        <Card>
          <CardHeader title="Population over time" description="Objects and unique identities per frame." />
          <LineChart
            data={timeline.map((point) => ({ frame: point.frame, objects: point.count, ids: point.unique_ids }))}
            xKey="frame"
            series={[
              { key: 'objects', label: 'Objects', color: '#22d3ee' },
              { key: 'ids', label: 'Unique IDs', color: '#f472b6' },
            ]}
            height={220}
          />
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ shared */

function DetectionTable({ result }: { result: ResultPayload }) {
  const items = [...(result.detections?.items ?? []), ...(result.obb?.items ?? [])];
  if (items.length === 0) return <p className="text-xs text-slate-500">No objects in the latest frame.</p>;
  return (
    <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
      {items.slice(0, 40).map((item) => (
        <li key={item.index} className="flex items-center gap-2 text-[11px]">
          <span className="size-2 rounded-sm" style={{ background: classColor(item.class_id) }} />
          <span className="min-w-0 flex-1 truncate text-slate-300">{item.class_name}</span>
          {item.track_id !== null && item.track_id !== undefined && (
            <span className="font-mono text-[10px] text-violet-300">#{item.track_id}</span>
          )}
          <span className="font-mono text-slate-500">{item.confidence?.toFixed(2) ?? '—'}</span>
        </li>
      ))}
    </ul>
  );
}
