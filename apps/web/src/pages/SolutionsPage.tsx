import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bike,
  CarFront,
  CircleDot,
  Crosshair,
  Dumbbell,
  Eye,
  Film,
  Flame,
  Gauge,
  Grid3x3,
  Hash,
  ScanEye,
  Shield,
  Sparkles,
  Tag,
  Timer,
  Users,
  Video,
} from 'lucide-react';

import { streamApi } from '@/lib/api';
import type { SolutionMeta } from '@/lib/api-types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, Button, Card, CardHeader, EmptyState, SectionTitle, SegmentedControl } from '@/components/ui/primitives';

/** Presentation metadata keyed by the backend's solution id. */
const SOLUTION_META: Record<
  string,
  { icon: typeof Activity; category: 'retail' | 'safety' | 'sports' | 'traffic' | 'analytics'; docs: string }
> = {
  none: { icon: Sparkles, category: 'analytics', docs: 'https://docs.ultralytics.com/modes/predict/' },
  object_counter: { icon: Hash, category: 'retail', docs: 'https://docs.ultralytics.com/guides/object-counting/' },
  region_counter: { icon: Grid3x3, category: 'retail', docs: 'https://docs.ultralytics.com/guides/region-counting/' },
  queue_management: { icon: Users, category: 'retail', docs: 'https://docs.ultralytics.com/guides/queue-management/' },
  heatmap: { icon: Flame, category: 'analytics', docs: 'https://docs.ultralytics.com/guides/heatmaps/' },
  trackzone: { icon: Crosshair, category: 'analytics', docs: 'https://docs.ultralytics.com/guides/trackzone/' },
  speed_estimation: { icon: Gauge, category: 'traffic', docs: 'https://docs.ultralytics.com/guides/speed-estimation/' },
  ai_gym: { icon: Dumbbell, category: 'sports', docs: 'https://docs.ultralytics.com/guides/ai-gym/' },
  distance_calculation: { icon: Timer, category: 'analytics', docs: 'https://docs.ultralytics.com/guides/distance-calculation/' },
  vision_eye: { icon: Eye, category: 'analytics', docs: 'https://docs.ultralytics.com/guides/vision-eye/' },
  security_alarm: { icon: Shield, category: 'safety', docs: 'https://docs.ultralytics.com/guides/security-alarm-system/' },
  object_blurrer: { icon: ScanEye, category: 'safety', docs: 'https://docs.ultralytics.com/guides/object-blurring/' },
  object_cropper: { icon: Tag, category: 'analytics', docs: 'https://docs.ultralytics.com/guides/object-cropping/' },
  instance_segmentation: { icon: CircleDot, category: 'analytics', docs: 'https://docs.ultralytics.com/guides/instance-segmentation-and-tracking/' },
  analytics: { icon: Activity, category: 'analytics', docs: 'https://docs.ultralytics.com/guides/analytics/' },
  parking_management: { icon: CarFront, category: 'traffic', docs: 'https://docs.ultralytics.com/guides/parking-management/' },
};

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All solutions',
  retail: 'Retail & counting',
  safety: 'Safety & compliance',
  traffic: 'Traffic & transport',
  sports: 'Fitness & sport',
  analytics: 'General analytics',
};

/**
 * Solutions gallery.
 *
 * The Ultralytics `solutions` package ships production-ready analytics layers on
 * top of YOLO. Each card explains what it does and links straight into the
 * Sightrail with that solution preselected, so any of them can be tried on a webcam
 * or video in two clicks.
 */
export function SolutionsPage() {
  const [category, setCategory] = useState<string>('all');

  const { data, isLoading } = useQuery({ queryKey: ['stream', 'solutions'], queryFn: streamApi.solutions, staleTime: 300_000 });

  const solutions = useMemo(
    () =>
      (data?.solutions ?? []).filter((entry) => {
        if (category === 'all') return true;
        return (SOLUTION_META[entry.id]?.category ?? 'analytics') === category;
      }),
    [data, category],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Solutions"
        title="Built-in analytics applications"
        description="Ultralytics ships a library of ready-made computer-vision applications built on YOLO. Each one is available in Sightrail with a single selection — no extra code."
        badges={[
          { label: `${data?.solutions.length ?? 0} solutions`, tone: 'brand' },
          { label: 'tracking + regions + counters', tone: 'violet' },
          { label: 'runs on webcam or video', tone: 'success' },
        ]}
        actions={
          <Link to="/studio">
            <Button variant="primary" icon={<Video className="size-4" />}>
              Open Live Studio
            </Button>
          </Link>
        }
      />

      <SegmentedControl
        size="sm"
        value={category}
        onChange={setCategory}
        options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
      />

      {isLoading ? (
        <p className="text-xs text-slate-500">Loading solutions…</p>
      ) : solutions.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="No solutions in this category"
          description="Pick a different category to see the available analytics layers."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {solutions.map((solution: SolutionMeta) => {
            const meta = SOLUTION_META[solution.id] ?? { icon: Sparkles, category: 'analytics', docs: 'https://docs.ultralytics.com/solutions/' };
            const Icon = meta.icon;
            return (
              <Card key={solution.id} className="panel-hover flex flex-col hover:border-brand-500/40">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-ink-600/70 bg-gradient-to-br from-brand-500/20 to-violet-500/10 text-brand-300">
                    <Icon className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-100">{solution.label}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{solution.description}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {solution.tasks.map((task) => (
                    <Badge key={task} tone="neutral">
                      {task}
                    </Badge>
                  ))}
                  {solution.needs_region && (
                    <Badge tone="violet">
                      {solution.region_kind === 'line' ? 'line ROI' : solution.region_kind === 'polygons' ? 'multi-polygon ROI' : 'polygon ROI'}
                    </Badge>
                  )}
                  {solution.id === 'none' && <Badge tone="brand">baseline</Badge>}
                </div>

                <div className="mt-auto flex items-center gap-2 pt-4">
                  <Link to={`/studio?solution=${solution.id}`} className="flex-1">
                    <Button size="sm" variant="primary" block icon={<ArrowRight className="size-3.5" />}>
                      Try it live
                    </Button>
                  </Link>
                  <a href={meta.docs} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="ghost">
                      Docs
                    </Button>
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={<Film className="size-4" />}
            title="How to use a solution"
            description="Every solution is a thin analytics layer over the same YOLO pipeline."
          />
          <ol className="space-y-3">
            {[
              {
                title: 'Pick a source',
                detail: 'Webcam over WebSocket for lowest latency, an uploaded video, or a server-side path.',
              },
              {
                title: 'Choose a tracking algorithm',
                detail: 'Solutions that count or track need identity persistence: ByteTrack, BoT-SORT, OC-SORT or the built-in trackers.',
              },
              {
                title: 'Select the solution',
                detail: 'The analytics layer draws its own annotations and publishes live counters you can read in the UI.',
              },
              {
                title: 'Tune the region',
                detail: 'Counters, alarms and parking use a line or polygon region of interest — adjust it in the Sightrail sidebar.',
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-brand-500/40 bg-brand-500/10 font-mono text-[10px] text-brand-300">
                  {index + 1}
                </span>
                <div>
                  <p className="text-xs font-medium text-slate-200">{step.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardHeader
            icon={<Gauge className="size-4" />}
            title="Performance notes"
            description="What to expect when running these on commodity hardware."
          />
          <ul className="space-y-3 text-[11px] leading-relaxed text-slate-400">
            <li className="flex gap-2">
              <Bike className="mt-0.5 size-3.5 shrink-0 text-brand-300" />
              <span>
                <strong className="text-slate-200">Server MJPEG</strong> re-encodes every frame in Python. It is the most
                portable option but costs extra CPU; the client-loop mode exists precisely to avoid that.
              </span>
            </li>
            <li className="flex gap-2">
              <Activity className="mt-0.5 size-3.5 shrink-0 text-brand-300" />
              <span>
                <strong className="text-slate-200">Client camera loop</strong> sends JPEG frames over WebSocket and draws
                overlays locally, so latency stays low and the video never round-trips through disk.
              </span>
            </li>
            <li className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-400" />
              <span>
                <strong className="text-slate-200">Region geometry</strong> is in source pixel coordinates. Defaults are
                tuned for 640×480 webcam frames; scale them for other resolutions.
              </span>
            </li>
            <li className="flex gap-2">
              <Flame className="mt-0.5 size-3.5 shrink-0 text-brand-300" />
              <span>
                <strong className="text-slate-200">Heatmaps accumulate</strong> over the session — long runs need more
                memory. Reset the session to clear the accumulator.
              </span>
            </li>
          </ul>
          <SectionTitle className="mt-4">Also available</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <Link to="/predict">
              <Badge tone="brand">plain predict</Badge>
            </Link>
            <Link to="/studio">
              <Badge tone="violet">tracking</Badge>
            </Link>
            <Link to="/benchmark">
              <Badge tone="neutral">benchmarking</Badge>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
