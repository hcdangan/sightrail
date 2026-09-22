/**
 * Help content.
 *
 * Structured data rather than JSX, so the wording lives in one place and can be
 * asserted in tests (`src/lib/help.test.ts`). The Help page renders it, and a
 * test cross-checks the start-up commands against the README so the in-app guide
 * and the repository docs cannot silently drift apart.
 *
 * Running values (version, resolved device, `.env` snippet, health) are merged
 * in at render time from the API rather than duplicated here.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  Boxes,
  Cpu,
  Database,
  Download,
  Gauge,
  GraduationCap,
  History,
  Layers,
  LifeBuoy,
  Play,
  Rocket,
  ScanSearch,
  Sparkles,
  Target,
  Terminal,
  Wrench,
} from 'lucide-react';

/* ------------------------------------------------------------------ types */

export interface CommandLine {
  /** The command itself, used verbatim by the copy button. */
  command: string;
  /** What it does, shown beside the command. */
  detail: string;
}

export interface CommandBlock {
  /** Label for the block, e.g. "Every time" or "First time only". */
  title: string;
  lines: CommandLine[];
}

export interface TourStop {
  path: string;
  label: string;
  icon: LucideIcon;
  what: string;
}

export interface Shortcut {
  keys: string[];
  action: string;
}

export interface WorkflowStep {
  title: string;
  detail: string;
  to: string;
  toLabel: string;
}

export interface TroubleshootingEntry {
  symptom: string;
  fix: string;
  /** Optional in-app route that helps resolve it. */
  to?: string;
  toLabel?: string;
}

export interface ReferenceLink {
  label: string;
  href: string;
  note: string;
  external?: boolean;
}

/* --------------------------------------------------------------- the content */

export const HELP_INTRO = {
  title: 'Run it, then explore it',
  lead:
    'Sightrail is two processes: a FastAPI service that owns the Ultralytics engine, and a React app that renders it. Start both with one command, then use this page as the map.',
};

export const GETTING_STARTED: CommandBlock[] = [
  {
    title: 'Start the app (already set up)',
    lines: [
      { command: 'cd sightrail', detail: 'From the repository root.' },
      { command: 'npm run dev', detail: 'Starts the API on :8000 and the UI on :5173 together.' },
    ],
  },
  {
    title: 'First time on a fresh clone',
    lines: [
      { command: 'npm run bootstrap', detail: 'Creates .venv and installs the Python and Node dependencies.' },
      { command: 'npm run dev', detail: 'Then start it as above.' },
    ],
  },
  {
    title: 'Check it and test it',
    lines: [
      { command: 'curl http://127.0.0.1:8000/api/health', detail: 'Confirms the API is alive and the engine is importable.' },
      { command: 'npm run verify', detail: 'Typecheck, lint, production build and the backend test suite.' },
    ],
  },
];

export const PROCESSES: { label: string; url: string; note: string }[] = [
  { label: 'Web UI', url: 'http://127.0.0.1:5173', note: 'Hot-reloads on React edits. This is the page you are reading.' },
  { label: 'API', url: 'http://127.0.0.1:8000', note: 'Auto-reloads on Python edits.' },
  { label: 'API docs (Swagger)', url: 'http://127.0.0.1:8000/api/docs', note: 'Try any endpoint interactively.' },
];

export const IMPORTANT_NOTES: string[] = [
  'The first prediction downloads yolo11n.pt (about 5 MB). Later runs reuse it from storage/weights.',
  'npm run dev needs .venv to exist. Run npm run bootstrap once on a fresh clone.',
  'Ctrl+C in the terminal running npm run dev stops both processes.',
];

export const TOUR: TourStop[] = [
  {
    path: '/predict',
    label: 'Predict',
    icon: ScanSearch,
    what: 'Inference on an image with any of the five task heads. Toggle classes, zoom the canvas, click an object to inspect it.',
  },
  {
    path: '/studio',
    label: 'Track & Stream',
    icon: Activity,
    what: 'Webcam or video with six trackers and sixteen analytics solutions, streamed live with stable track IDs.',
  },
  {
    path: '/solutions',
    label: 'Solutions',
    icon: Sparkles,
    what: 'The catalogue of built-in analytics apps: counting, heatmaps, queue and parking management, alarms, gym reps.',
  },
  {
    path: '/train',
    label: 'Train',
    icon: GraduationCap,
    what: 'Fine-tune a checkpoint with the full hyperparameter surface. The Smoke test preset runs in about a minute on coco8.',
  },
  {
    path: '/validate',
    label: 'Validate',
    icon: Target,
    what: 'mAP50/75/50-95, per-class precision, recall and F1, plus confusion matrices and diagnostic plots.',
  },
  {
    path: '/export',
    label: 'Export',
    icon: Download,
    what: 'Convert to any of the 22 deployment formats, from ONNX and OpenVINO to TensorRT and Hailo HEF.',
  },
  {
    path: '/benchmark',
    label: 'Benchmark',
    icon: Gauge,
    what: 'Compare formats on artifact size, export time, latency and measured accuracy, then export the table as CSV.',
  },
  {
    path: '/datasets',
    label: 'Datasets',
    icon: Database,
    what: 'Browse dataset descriptors, or pre-label a folder of images into a trainable YOLO dataset.',
  },
  {
    path: '/models',
    label: 'Model Zoo',
    icon: Boxes,
    what: 'Every checkpoint Ultralytics publishes, plus the local weight library and the in-memory model cache.',
  },
  {
    path: '/jobs',
    label: 'Jobs',
    icon: Layers,
    what: 'Training, validation, export and annotation run in the background; watch their live consoles here.',
  },
  {
    path: '/runs',
    label: 'Runs & Artifacts',
    icon: History,
    what: 'Every run the engine has produced, with its plots, results.csv history, args.yaml and saved weights.',
  },
  {
    path: '/system',
    label: 'System',
    icon: Cpu,
    what: 'Versions, compute devices, Hailo readiness, memory and storage. Also where you switch device.',
  },
];

export const WORKFLOW: WorkflowStep[] = [
  {
    title: 'Look at something',
    detail: 'Run detection on a bundled sample image. No upload needed, no setup.',
    to: '/predict',
    toLabel: 'Open Predict',
  },
  {
    title: 'Go live',
    detail: 'Point a webcam at the room and watch tracking IDs hold steady across frames.',
    to: '/studio',
    toLabel: 'Open Live Studio',
  },
  {
    title: 'Teach it something',
    detail: 'Train the nano model on coco8 with the Smoke test preset, then read the metrics.',
    to: '/train',
    toLabel: 'Open Train',
  },
  {
    title: 'Ship it',
    detail: 'Export to ONNX or an accelerator format, then benchmark the options side by side.',
    to: '/export',
    toLabel: 'Open Export',
  },
];

export const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'K'], action: 'Open the command palette to jump to any page or action' },
  { keys: ['Cmd', 'K'], action: 'The same, on macOS' },
  { keys: ['Arrow keys'], action: 'Move through the command palette results' },
  { keys: ['Enter'], action: 'Run the highlighted palette result' },
  { keys: ['Esc'], action: 'Close the palette, a dialog or the mobile drawer' },
];

export const TROUBLESHOOTING: TroubleshootingEntry[] = [
  {
    symptom: 'No virtual environment found',
    fix: 'The API script could not find .venv. Run npm run bootstrap once, then npm run dev again.',
  },
  {
    symptom: 'Engine unavailable badge in the sidebar',
    fix: 'The Python dependencies are missing, or the API is running on a different interpreter. Run npm run bootstrap and restart.',
    to: '/system',
    toLabel: 'Check the environment',
  },
  {
    symptom: 'The UI loads but every request fails',
    fix: 'The API process is not running. Start it with npm run dev:api, then confirm with curl http://127.0.0.1:8000/api/health.',
  },
  {
    symptom: 'Port 8000 or 5173 is already in use',
    fix: 'Vite picks the next free port, so check its output for the real URL. For the API, set SIGHTRAIL_PORT and point the UI at it with VITE_API_TARGET.',
  },
  {
    symptom: 'Inference feels slow',
    fix: 'Expected on CPU: a 640px nano model takes roughly 100-200 ms per frame. Switch device, or lower the image size in the inference options.',
    to: '/system',
    toLabel: 'Switch device',
  },
  {
    symptom: 'The camera never starts',
    fix: 'Browsers only expose getUserMedia on localhost, 127.0.0.1 or HTTPS. Open the dev server URL directly rather than a LAN address.',
  },
  {
    symptom: 'torch install fails on Python 3.13+',
    fix: 'PyTorch wheels lag behind. Recreate the environment with 3.12 (uv venv --python 3.12 .venv), then reinstall the requirements.',
  },
  {
    symptom: 'Export reports missing dependencies',
    fix: 'Each deployment format needs its own backend package in the API environment, for example onnx and onnxruntime for ONNX.',
    to: '/export',
    toLabel: 'See which backends are ready',
  },
  {
    symptom: 'Hailo export is refused',
    fix: 'HEF compilation needs the Hailo Dataflow Compiler on Linux x86_64. The Export page lists every unmet requirement, and the System page has the setup steps.',
    to: '/system',
    toLabel: 'Hailo setup steps',
  },
  {
    symptom: 'The first training run is slow',
    fix: 'Ultralytics downloads and unpacks the dataset on first use. Later runs reuse the cached copy.',
  },
];

export const REFERENCE_LINKS: ReferenceLink[] = [
  { label: 'Swagger UI', href: '/api/docs', note: 'Every endpoint, callable from the browser', external: true },
  { label: 'ReDoc', href: '/api/redoc', note: 'The same API as a readable reference', external: true },
  { label: 'OpenAPI schema', href: '/api/openapi.json', note: 'Machine-readable contract', external: true },
  { label: 'Ultralytics docs', href: 'https://docs.ultralytics.com/', note: 'Upstream framework documentation', external: true },
  { label: 'Modes reference', href: 'https://docs.ultralytics.com/modes/', note: 'Predict, track, train, val, export, benchmark', external: true },
  { label: 'Solutions library', href: 'https://docs.ultralytics.com/solutions/', note: 'What each analytics solution does', external: true },
];

export const REPO_DOCS: { label: string; path: string; note: string; icon: LucideIcon }[] = [
  { label: 'README.md', path: 'README.md', note: 'Feature overview, quickstart, configuration', icon: Rocket },
  { label: 'docs/ARCHITECTURE.md', path: 'docs/ARCHITECTURE.md', note: 'Layering, request lifecycle, job system', icon: Layers },
  { label: 'docs/API.md', path: 'docs/API.md', note: 'Every endpoint with request examples', icon: Terminal },
  { label: 'docs/FEATURES.md', path: 'docs/FEATURES.md', note: 'Capability to implementation matrix', icon: Boxes },
  { label: 'docs/DEVELOPMENT.md', path: 'docs/DEVELOPMENT.md', note: 'Inner loop, conventions, debugging', icon: Wrench },
  { label: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md', note: 'How to propose a change', icon: Play },
];

/** Commands a test asserts are documented in both this module and the README. */
export const REQUIRED_QUICKSTART_COMMANDS = ['npm run dev', 'npm run bootstrap', 'npm run verify'] as const;

/** Sections in render order; also drives the sticky in-page navigation. */
export const HELP_SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'start', label: 'Start', icon: Rocket },
  { id: 'processes', label: 'Processes', icon: Terminal },
  { id: 'tour', label: 'Tour', icon: ScanSearch },
  { id: 'device', label: 'Device', icon: Cpu },
  { id: 'shortcuts', label: 'Shortcuts', icon: Boxes },
  { id: 'troubleshooting', label: 'Fixes', icon: AlertTriangle },
  { id: 'reference', label: 'Reference', icon: LifeBuoy },
];

export type HelpSectionId = (typeof HELP_SECTIONS)[number]['id'];
