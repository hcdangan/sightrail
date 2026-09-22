/**
 * Single source of truth for the app's information architecture.
 *
 * The sidebar, the command palette and the router all read from this list, so
 * adding a page means touching one file plus its component.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  Cpu,
  Database,
  Download,
  Film,
  Gauge,
  GraduationCap,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ScanSearch,
  Sparkles,
  Target,
} from 'lucide-react';

export type NavGroup = {
  id: string;
  label: string;
  description: string;
  items: NavItem[];
};

export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  /** Extra search terms for the command palette. */
  keywords?: string[];
  description: string;
};

/** The six Ultralytics modes, in pipeline order (used by docs and the dashboard). */
export const PIPELINE_MODES = ['predict', 'track', 'train', 'val', 'export', 'benchmark'] as const;

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'start',
    label: 'Start here',
    description: 'Overview and environment',
    items: [
      {
        path: '/',
        label: 'Dashboard',
        icon: LayoutDashboard,
        description: 'System overview, quick actions and recent activity',
        keywords: ['home', 'overview', 'status', 'gpu'],
      },
      {
        path: '/models',
        label: 'Model Zoo',
        icon: Boxes,
        description: 'Browse, download and inspect every supported checkpoint',
        keywords: ['weights', 'checkpoint', 'yolo11', 'catalog'],
      },
      {
        path: '/datasets',
        label: 'Datasets',
        icon: Database,
        description: 'Inspect datasets and build new ones by auto-annotation',
        keywords: ['coco', 'labels', 'annotate', 'yolo format'],
      },
    ],
  },
  {
    id: 'modes',
    label: 'Modes',
    description: 'The Ultralytics execution pipeline',
    items: [
      {
        path: '/predict',
        label: 'Predict',
        icon: ScanSearch,
        badge: '6 tasks',
        description: 'Inference on images with boxes, masks, keypoints and OBB',
        keywords: ['infer', 'detect', 'segment', 'pose', 'classify', 'obb'],
      },
      {
        path: '/studio',
        label: 'Track & Stream',
        icon: Film,
        badge: 'live',
        description: 'Video, webcam and tracking with real-time analytics',
        keywords: ['video', 'webcam', 'stream', 'bytetrack', 'botsort', 'fps'],
      },
      {
        path: '/solutions',
        label: 'Solutions',
        icon: Sparkles,
        badge: '16',
        description: 'Counting, heatmaps, speed, gym, parking, alarms and more',
        keywords: ['counter', 'heatmap', 'queue', 'security', 'analytics'],
      },
      {
        path: '/train',
        label: 'Train',
        icon: GraduationCap,
        description: 'Fine-tune a model with the full hyperparameter surface',
        keywords: ['fit', 'epochs', 'lr', 'augment', 'finetune'],
      },
      {
        path: '/validate',
        label: 'Validate',
        icon: Target,
        description: 'mAP, per-class metrics, confusion matrix and curves',
        keywords: ['val', 'map', 'metrics', 'precision', 'recall'],
      },
      {
        path: '/export',
        label: 'Export',
        icon: Download,
        badge: '22 formats',
        description: 'Convert checkpoints to ONNX, TensorRT, OpenVINO, CoreML…',
        keywords: ['onnx', 'tensorrt', 'openvino', 'tflite', 'deploy'],
      },
      {
        path: '/benchmark',
        label: 'Benchmark',
        icon: Gauge,
        description: 'Compare formats and models on size, speed and accuracy',
        keywords: ['latency', 'throughput', 'compare', 'speed'],
      },
    ],
  },
  {
    id: 'observe',
    label: 'Observe',
    description: 'Runs, artifacts and diagnostics',
    items: [
      {
        path: '/runs',
        label: 'Runs & Artifacts',
        icon: Activity,
        description: 'Every training, validation and export output in one place',
        keywords: ['history', 'artifacts', 'results.csv', 'plots'],
      },
      {
        path: '/jobs',
        label: 'Jobs',
        icon: Layers,
        description: 'Live console for long-running work',
        keywords: ['queue', 'logs', 'progress', 'cancel'],
      },
      {
        path: '/system',
        label: 'System',
        icon: Cpu,
        description: 'Environment, devices, memory and storage',
        keywords: ['gpu', 'cuda', 'torch', 'memory', 'settings'],
      },
      {
        path: '/help',
        label: 'Help',
        icon: LifeBuoy,
        description: 'How to run it, a tour of every page, device setup and fixes',
        keywords: [
          'help',
          'docs',
          'guide',
          'getting started',
          'how to run',
          'npm run dev',
          'troubleshooting',
          'shortcuts',
          'faq',
        ],
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const QUICK_LINKS: NavItem[] = [
  NAV_ITEMS.find((item) => item.path === '/predict')!,
  NAV_ITEMS.find((item) => item.path === '/studio')!,
  NAV_ITEMS.find((item) => item.path === '/train')!,
  NAV_ITEMS.find((item) => item.path === '/export')!,
];

/** Reference links shown on the System and Dashboard pages. */
export const DOC_LINKS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: 'Ultralytics Docs', href: 'https://docs.ultralytics.com/', icon: BookOpen },
  { label: 'Modes reference', href: 'https://docs.ultralytics.com/modes/', icon: BarChart3 },
  { label: 'Tasks reference', href: 'https://docs.ultralytics.com/tasks/', icon: Layers },
  { label: 'Solutions library', href: 'https://docs.ultralytics.com/solutions/', icon: Sparkles },
];

export const TASK_META: Record<
  string,
  { label: string; short: string; description: string; accent: string; outputs: string[] }
> = {
  detect: {
    label: 'Object Detection',
    short: 'Detect',
    description: 'Locate objects with axis-aligned boxes and class confidence.',
    accent: '#22d3ee',
    outputs: ['boxes'],
  },
  segment: {
    label: 'Instance Segmentation',
    short: 'Segment',
    description: 'Pixel-accurate masks for every detected instance.',
    accent: '#a78bfa',
    outputs: ['boxes', 'masks'],
  },
  classify: {
    label: 'Classification',
    short: 'Classify',
    description: 'Assign a single class label with top-5 probabilities.',
    accent: '#fbbf24',
    outputs: ['probs'],
  },
  pose: {
    label: 'Pose Estimation',
    short: 'Pose',
    description: '17-keypoint human skeletons with per-point confidence.',
    accent: '#4ade80',
    outputs: ['boxes', 'keypoints'],
  },
  obb: {
    label: 'Oriented Boxes',
    short: 'OBB',
    description: 'Rotated boxes for aerial and industrial imagery.',
    accent: '#f472b6',
    outputs: ['obb'],
  },
};
