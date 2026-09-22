/**
 * TypeScript mirrors of the FastAPI Pydantic schemas.
 *
 * Keep these in lock-step with `apps/api/sightrail/schemas/*.py`. The
 * live OpenAPI document is always available at `/api/openapi.json` for
 * cross-checking.
 */

export type TaskName = 'detect' | 'segment' | 'classify' | 'pose' | 'obb';
export type ModeName = 'predict' | 'track' | 'train' | 'val' | 'export' | 'benchmark';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobKind = 'train' | 'val' | 'export' | 'benchmark' | 'annotate' | 'video' | 'prepare_dataset';

/* ------------------------------------------------------------------ system */

export interface HealthResponse {
  status: string;
  version: string;
  engine_available: boolean;
  storage_root: string;
}

export interface DeviceInfo {
  id: string;
  label: string;
  kind: 'auto' | 'cpu' | 'cuda' | 'mps' | 'hailo' | string;
  available: boolean;
  detail: string;
  /** Which Ultralytics modes this device can run (Hailo cannot train). */
  capabilities?: string[];
  supports_training?: boolean;
  requires?: string[];
  notes?: string;
  resolves_to?: string;
}

export interface EnvironmentInfo {
  app: { name: string; version: string };
  python: { version: string; implementation: string; executable: string };
  platform: { system: string; release: string; machine: string };
  torch: {
    installed: boolean;
    version: string | null;
    cuda_build: string | null;
    cudnn: string | null;
    cuda_available: boolean;
    mps_available: boolean;
  };
  ultralytics: { installed: boolean; version: string | null };
  /** The configured device choice and how it resolved for the engine. */
  device: { configured: string; requested: string; resolved: string; engine: string };
  hailo: {
    runtime: boolean;
    runtime_version: string | null;
    device: boolean;
    compiler: boolean;
    arch: string;
    model: string | null;
  };
  optional: Record<string, string | null>;
  cpu_count: number;
  storage: Record<string, number | string>;
  features: {
    allow_dataset_downloads: boolean;
    allow_heavy_export: boolean;
    max_concurrent_jobs: number;
  };
}

export interface MemorySnapshot {
  cpu: { total_gb?: number; used_gb?: number; percent?: number };
  cuda: {
    index: number;
    name: string;
    total_gb: number;
    free_gb: number;
    used_gb: number;
    allocated_gb: number;
  }[];
  hailo?: { state: string; note: string } | null;
}

export interface RunSummary {
  id: string;
  mode: string;
  name: string;
  path: string;
  created_at: number;
  has_weights: boolean;
  best_weight: string | null;
  images: string[];
}

export interface Overview {
  version: string;
  engine_available: boolean;
  device: string;
  device_configured?: string;
  devices: DeviceInfo[];
  hailo?: EnvironmentInfo['hailo'];
  torch: EnvironmentInfo['torch'];
  ultralytics: EnvironmentInfo['ultralytics'];
  catalog: { models: number; by_task: Record<string, number>; defaults: Record<string, string> };
  datasets: number;
  uploads: { count: number; recent: UploadEntry[] };
  checkpoints: { count: number; recent: LocalModel[] };
  jobs: { active: JobSummary[]; recent: JobSummary[] };
  runs: RunSummary[];
  memory: MemorySnapshot;
  storage: {
    root: string;
    uploads_mb: number;
    outputs_mb: number;
    weights_mb: number;
    runs_mb: number;
    datasets_mb: number;
  };
  loaded_models: LoadedModel[];
}

/* ------------------------------------------------------------------ models */

export interface CatalogModel {
  id: string;
  family: string;
  size: string;
  task: TaskName;
  label: string;
  description: string;
  approx_params_m: number | null;
  download_url: string;
  downloaded?: boolean;
}

export interface CatalogResponse {
  models: CatalogModel[];
  families: string[];
  defaults: Record<string, string>;
  preferred: string[];
}

export interface LocalModel {
  id: string;
  path: string;
  size_bytes: number;
  modified: number;
  task: string | null;
  exported: boolean;
  in_weights_dir: boolean;
}

export interface LoadedModel {
  key: string;
  path: string;
  task: string;
  classes: number;
  hits: number;
  resident_s: number;
}

export interface ExportFormat {
  id: string;
  label: string;
  engine_name: string;
  suffix: string;
  note: string;
  cpu: boolean;
  gpu: boolean;
  options: string[];
  environment: string;
  targets: string[];
}

export interface ModelInfo {
  source: string;
  task: string;
  names: Record<string, string>;
  classes: number;
  info: { layers?: number; parameters?: number; gradients?: number; gflops?: number | null };
  device: string;
  path: string;
}

export interface TaskMeta {
  id: TaskName;
  label: string;
  description: string;
  default_model: string;
  outputs: string[];
}

export interface TrackerMeta {
  id: string;
  label: string;
  description: string;
  requires: string[];
  recommended?: boolean;
}

/* --------------------------------------------------------------- inference */

export interface BoxItem {
  index: number;
  class_id: number;
  class_name: string;
  confidence: number | null;
  xyxy: number[];
  xywhn?: number[] | null;
  xyxyn?: number[] | null;
  xywhr?: number[] | null;
  track_id?: number | null;
}

export interface DetectionPayload {
  type: 'boxes' | 'obb';
  count: number;
  items: BoxItem[];
}

export interface KeypointInstance {
  index: number;
  class_id: number;
  class_name: string;
  xy: [number, number][];
  xyn: [number, number][] | null;
  confidence: (number | null)[] | null;
}

export interface KeypointPayload {
  type: 'keypoints';
  count: number;
  items: KeypointInstance[];
  shape: number[] | null;
}

export interface MaskInstance {
  index: number;
  class_id: number;
  class_name: string;
  confidence: number | null;
  polygon: number[];
  point_count: number;
}

export interface MaskPayload {
  type: 'masks';
  count: number;
  items: MaskInstance[];
  truncated: boolean;
}

export interface ClassPrediction {
  class_id: number;
  class_name: string;
  confidence: number;
  rank: number;
}

export interface ProbsPayload {
  type: 'probs';
  top1: number | null;
  top1_name: string | null;
  top1_conf: number | null;
  top5: ClassPrediction[];
  all_scores: number[] | null;
}

export interface SpeedPayload {
  preprocess_ms: number | null;
  inference_ms: number | null;
  postprocess_ms: number | null;
}

export interface ModelMeta {
  source: string;
  task: string;
  names: Record<string, string>;
  classes: number;
  info: Record<string, number | null>;
}

export interface ResultPayload {
  task: TaskName;
  path: string;
  original_shape: [number, number];
  names: Record<string, string>;
  speed: SpeedPayload | null;
  detections: DetectionPayload | null;
  obb: DetectionPayload | null;
  keypoints: KeypointPayload | null;
  masks: MaskPayload | null;
  probs: ProbsPayload | null;
  rendered_url: string | null;
  original_url: string | null;
  extra: Record<string, unknown>;
}

export interface InferResponse {
  id: string;
  model: ModelMeta;
  results: ResultPayload[];
  stats: Record<string, number | string | number[]>;
  elapsed_ms: number;
}

export interface BatchInferItem {
  path: string;
  name: string;
  elapsed_ms?: number;
  error?: string;
  result?: ResultPayload;
}

export interface BatchInferResponse {
  model: string;
  count: number;
  failures: number;
  items: BatchInferItem[];
  histogram: Record<string, number>;
  stats: {
    total_ms: number;
    avg_ms: number | null;
    min_ms: number | null;
    max_ms: number | null;
    throughput_fps: number | null;
    device: string;
  };
}

export interface SourceSpec {
  upload_id?: string | null;
  path?: string | null;
  data_url?: string | null;
  url?: string | null;
  camera?: number | null;
  sample?: string | null;
}

export interface InferOptions {
  conf: number;
  iou: number;
  imgsz: number;
  max_det: number;
  classes?: number[] | null;
  device: string;
  augment: boolean;
  agnostic_nms: boolean;
  retina_masks: boolean;
  half?: boolean | null;
  save_rendered: boolean;
  mask_limit: number;
}

export interface InferDefaults {
  model: string;
  conf: number;
  iou: number;
  imgsz: number;
  max_det: number;
  device: string;
  max_batch_size: number;
}

/* ------------------------------------------------------------------ uploads */

export interface UploadEntry {
  id: string;
  name: string;
  path: string;
  kind: 'image' | 'video' | 'archive' | 'other';
  size_bytes: number;
  content_type: string;
  created_at: number;
  url: string;
}

/* ------------------------------------------------------------------ streams */

export interface SolutionMeta {
  id: string;
  label: string;
  description: string;
  tasks: string[];
  needs_region: boolean;
  region_kind?: 'line' | 'polygon' | 'polygons';
  default_region?: number[][] | number[][][];
}

export interface CameraInfo {
  id: number;
  label: string;
  resolution: string;
}

export interface SessionHandle {
  session_id: string;
  mjpeg_url: string;
  stats_url: string;
  source: string;
  solution: string;
  solution_meta: SolutionMeta | Record<string, never>;
  model: string;
  names: Record<string, string>;
  /** False when a requested ROI could not be resolved to source pixels. */
  region_applied?: boolean;
  region_note?: string | null;
}

export interface SessionStats {
  session_id: string;
  frames: number;
  fps: number;
  uptime_s: number;
  solution: string;
  counters: Record<string, string | number | boolean | number[] | Record<string, number>>;
  model: string;
  history: { frame: number; count: number; fps: number }[];
}

export interface TrackFrame {
  frame: number;
  detections: {
    track_id: number | null;
    class_id: number;
    class_name: string;
    confidence: number | null;
    xyxy: number[];
  }[];
  speed: SpeedPayload | null;
}

export interface TrackResponse {
  session: string;
  model: string;
  tracker: string;
  frames: TrackFrame[];
  count: number;
  unique_ids: number;
  histogram: Record<string, number>;
}

/* -------------------------------------------------------------------- jobs */

export interface JobProgressEvent {
  seq: number;
  kind: 'log' | 'progress' | 'metric' | 'result' | 'status';
  message: string;
  percent: number | null;
  level: 'debug' | 'info' | 'warning' | 'error';
  data: Record<string, number | string | boolean>;
  timestamp: string;
}

export interface Artifact {
  name: string;
  path: string;
  url: string;
  kind: 'image' | 'video' | 'model' | 'csv' | 'yaml' | 'json' | 'text' | 'other';
  size_bytes: number;
}

export interface JobSummary {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  params: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_s: number | null;
  percent: number;
  message: string;
  error: string | null;
  result: Record<string, unknown> | null;
  artifacts: Artifact[];
  metrics: Record<string, (number | string)[]>;
}

export interface JobDetail extends JobSummary {
  log: JobProgressEvent[];
}

/* ---------------------------------------------------------------- datasets */

export interface DatasetEntry {
  id: string;
  label: string;
  task: string | null;
  path: string | null;
  source: 'ultralytics' | 'local';
  images: number | null;
  classes: number | null;
  note: string | null;
  downloaded: boolean;
  exists: boolean;
  names: string[] | null;
}

/* -------------------------------------------------------------- validation */

export interface PerClassMetric {
  class_id: number;
  class_name: string;
  precision?: number | null;
  recall?: number | null;
  f1?: number | null;
  map50?: number | null;
  map?: number | null;
}

export interface ValidationResult {
  task: string;
  summary: Record<string, number>;
  per_class: PerClassMetric[];
  curves: { class_id: number; class_name: string; values: number[] }[];
  segmentation?: Record<string, number>;
  segmentation_per_class?: PerClassMetric[];
  pose?: Record<string, number>;
  speed?: { preprocess?: number; inference?: number; postprocess?: number };
  confusion_matrix_url: string | null;
  results_dict: Record<string, number> | null;
  save_dir: string | null;
  artifacts?: Artifact[];
  model?: string;
  dataset?: string | null;
  run_dir?: string | null;
}

export interface BenchmarkRow {
  format: string;
  path?: string;
  size_mb?: number;
  export_seconds?: number;
  metrics?: Record<string, number>;
  latency?: { preprocess_ms: number | null; inference_ms: number | null; postprocess_ms: number | null } | null;
  status: 'ok' | 'failed';
  error?: string;
}

export interface BenchmarkResult {
  model: string;
  dataset: string | null;
  formats: BenchmarkRow[];
}

export interface TrainingResult {
  run_dir: string | null;
  weights: { best: string | null; last: string | null };
  best_model: string | null;
  history: Record<string, (number | string)[]>;
  final_metrics: ValidationResult | Record<string, never>;
  artifacts: Artifact[];
}

export interface RunDetail {
  mode: string;
  name: string;
  path: string;
  artifacts: Artifact[];
  history?: Record<string, (number | string)[]>;
  args?: Record<string, unknown>;
}
