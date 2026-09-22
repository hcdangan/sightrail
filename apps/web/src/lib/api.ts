/**
 * Typed API client.
 *
 * One thin fetch wrapper plus a namespaced function per endpoint group. Handles
 * JSON encoding, FastAPI error envelopes, abort signals and multipart uploads so
 * pages never touch `fetch` directly.
 */
import type {
  CameraInfo,
  CatalogResponse,
  DatasetEntry,
  EnvironmentInfo,
  ExportFormat,
  HealthResponse,
  InferDefaults,
  InferOptions,
  InferResponse,
  BatchInferResponse,
  JobDetail,
  JobSummary,
  LocalModel,
  LoadedModel,
  MemorySnapshot,
  ModelInfo,
  Overview,
  RunDetail,
  RunSummary,
  SessionHandle,
  SessionStats,
  SolutionMeta,
  SourceSpec,
  TaskMeta,
  TrackerMeta,
  TrackResponse,
  UploadEntry,
} from './api-types';
import type { DeviceConfig, DeviceProfile, HailoState } from './device-types';

/** Same-origin by default: Vite proxies /api to the FastAPI process in dev. */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }

  /** Human-friendly detail extracted from a FastAPI error envelope. */
  get detail(): string {
    const payload = this.payload as { detail?: unknown; issues?: { msg: string; loc: (string | number)[] }[] };
    if (typeof payload?.detail === 'string') return payload.detail;
    if (Array.isArray(payload?.issues) && payload.issues.length > 0) {
      return payload.issues
        .map((issue) => `${issue.loc?.filter((part) => part !== 'body').join('.') ?? 'field'}: ${issue.msg}`)
        .join('; ');
    }
    if (payload?.detail) return JSON.stringify(payload.detail);
    return this.message;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  formData?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.pathname + url.search;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, formData, query } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined;

  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path, query), { method, headers, body: payload, signal });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof parsed === 'object' && parsed && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status, parsed);
  }

  return parsed as T;
}

/* ------------------------------------------------------------------ system */

export const systemApi = {
  health: () => request<HealthResponse>('/api/health'),
  environment: () => request<EnvironmentInfo>('/api/system/env'),
  devices: () => request<{ devices: DeviceProfile[] }>('/api/system/devices'),
  /** Full device switch state: profiles, Hailo readiness and an .env snippet. */
  deviceConfig: () => request<DeviceConfig>('/api/system/device-config'),
  hailo: () => request<HailoState>('/api/system/hailo'),
  memory: () => request<MemorySnapshot>('/api/system/memory'),
  overview: () => request<Overview>('/api/system/overview'),
  runs: () => request<RunSummary[]>('/api/system/runs'),
};

/* ------------------------------------------------------------------ models */

export const modelsApi = {
  catalog: (params: { task?: string; family?: string } = {}) =>
    request<CatalogResponse>('/api/models/catalog', { query: params }),
  local: () => request<{ models: LocalModel[]; weights_dir: string }>('/api/models/local'),
  registry: () => request<{ loaded: LoadedModel[]; capacity: number }>('/api/models/registry'),
  evict: (model?: string) =>
    request<{ evicted: number }>('/api/models/registry', { method: 'DELETE', query: { model } }),
  formats: () => request<{ formats: ExportFormat[] }>('/api/models/formats'),
  optimizers: () => request<{ optimizers: { id: string; label: string; note: string }[] }>('/api/models/optimizers'),
  tasks: () => request<{ tasks: TaskMeta[] }>('/api/models/tasks'),
  trackers: () => request<{ trackers: TrackerMeta[] }>('/api/models/trackers'),
  info: (modelId: string, device = 'auto') =>
    request<ModelInfo>(`/api/models/${encodeURIComponent(modelId)}/info`, { query: { device } }),
  download: (model: string) => request<{ model: string; path: string; size_bytes: number }>('/api/models/download', {
    method: 'POST',
    body: { model },
  }),
  clearOutputs: () => request<{ removed: number }>('/api/models/cache', { method: 'DELETE' }),
};

/* --------------------------------------------------------------- inference */

export const inferApi = {
  defaults: () => request<InferDefaults>('/api/infer/defaults'),
  run: (payload: { model: string; task?: string | null; source: SourceSpec; options: Partial<InferOptions> }) =>
    request<InferResponse>('/api/infer', { method: 'POST', body: payload }),
  batch: (payload: { model: string; task?: string | null; source: SourceSpec; options: Partial<InferOptions> }) =>
    request<BatchInferResponse>('/api/infer/batch', { method: 'POST', body: payload }),
  uploadSources: () => request<{ images: UploadEntry[] }>('/api/infer/uploads'),
};

/* ---------------------------------------------------------------- uploads */

export const uploadsApi = {
  list: (kind?: string) => request<{ uploads: UploadEntry[] }>('/api/uploads', { query: { kind } }),
  upload: async (file: File): Promise<UploadEntry> => {
    const form = new FormData();
    form.append('file', file);
    return request<UploadEntry>('/api/uploads', { method: 'POST', formData: form });
  },
  uploadMany: async (files: File[]): Promise<{ uploads: UploadEntry[]; count: number }> => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    return request<{ uploads: UploadEntry[]; count: number }>('/api/uploads/batch', { method: 'POST', formData: form });
  },
  remove: (id: string) => request<{ deleted: string }>(`/api/uploads/${id}`, { method: 'DELETE' }),
  clear: () => request<{ removed: number }>('/api/uploads', { method: 'DELETE' }),
};

/* -------------------------------------------------------------- streaming */

export const streamApi = {
  solutions: () => request<{ solutions: SolutionMeta[] }>('/api/stream/solutions'),
  cameras: () => request<{ cameras: CameraInfo[]; scanned: boolean }>('/api/stream/cameras'),
  openSession: (payload: Record<string, unknown>) =>
    request<SessionHandle>('/api/stream/sessions', { method: 'POST', body: payload }),
  sessions: () => request<{ sessions: SessionStats[] }>('/api/stream/sessions'),
  stats: (id: string) => request<SessionStats>(`/api/stream/sessions/${id}/stats`),
  close: (id: string) => request<{ closed: string }>(`/api/stream/sessions/${id}`, { method: 'DELETE' }),
  track: (payload: Record<string, unknown>) => request<TrackResponse>('/api/stream/track', {
    method: 'POST',
    body: payload,
  }),
  analyseVideo: (payload: Record<string, unknown>) =>
    request<JobSummary>('/api/stream/video', { method: 'POST', body: payload }),
};

/* -------------------------------------------------------------------- jobs */

export const jobsApi = {
  list: (kind?: string) => request<JobSummary[]>('/api/jobs', { query: { kind } }),
  active: () => request<JobSummary[]>('/api/jobs/active'),
  detail: (id: string) => request<JobDetail>(`/api/jobs/${id}`),
  cancel: (id: string) => request<JobSummary>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  clearFinished: () => request<{ removed: number }>('/api/jobs/finished', { method: 'DELETE' }),
};

/* ------------------------------------------------------------------- modes */

export const modesApi = {
  datasets: (task?: string) => request<{ datasets: DatasetEntry[] }>('/api/datasets', { query: { task } }),
  datasetPreview: (id: string) =>
    request<{ id: string; path: string; config: Record<string, unknown> }>(`/api/datasets/${id}/preview`),
  localDatasets: () => request<{ datasets: DatasetEntry[]; root: string }>('/api/datasets/local'),
  annotate: (payload: Record<string, unknown>) =>
    request<JobSummary>('/api/datasets/annotate', { method: 'POST', body: payload }),
  solutions: () => request<{ solutions: SolutionMeta[] }>('/api/solutions'),

  train: (payload: Record<string, unknown>) => request<JobSummary>('/api/train', { method: 'POST', body: payload }),
  validate: (payload: Record<string, unknown>) => request<JobSummary>('/api/val', { method: 'POST', body: payload }),
  export: (payload: Record<string, unknown>) => request<JobSummary>('/api/export', { method: 'POST', body: payload }),
  benchmark: (payload: Record<string, unknown>) =>
    request<JobSummary>('/api/benchmark', { method: 'POST', body: payload }),

  exportFormats: () => request<{ formats: ExportFormat[]; heavy: string[] }>('/api/export/formats'),
  exportAvailable: () =>
    request<{ backends: Record<string, { ready: boolean; packages: string[] }>; installed: Record<string, string | null> }>(
      '/api/export/available',
    ),

  runs: () => request<{ runs: RunSummary[] }>('/api/runs'),
  runDetail: (mode: string, name: string) =>
    request<RunDetail>(`/api/runs/${encodeURIComponent(mode)}/${encodeURIComponent(name)}`),
};

/* ------------------------------------------------------------------ media */

export const mediaUrl = (category: string, filename: string) => `${API_BASE}/api/media/${category}/${filename}`;
