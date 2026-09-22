import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, FolderTree, Images, RefreshCw, Table2, Weight } from 'lucide-react';

import { modesApi } from '@/lib/api';
import type { RunDetail, RunSummary } from '@/lib/api-types';
import { formatBytes, formatRelativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { LineChart } from '@/components/charts/LineChart';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KeyValue,
  SectionTitle,
  SegmentedControl,
} from '@/components/ui/primitives';

const MODE_TONES: Record<string, 'brand' | 'success' | 'warning' | 'violet' | 'neutral'> = {
  train: 'success',
  val: 'brand',
  export: 'warning',
  benchmark: 'violet',
  predict: 'neutral',
  track: 'neutral',
  video: 'neutral',
};

/**
 * Run explorer.
 *
 * Every directory Ultralytics wrote to, grouped by mode, with its plots,
 * `results.csv` history and `args.yaml` config one click away.
 */
export function RunsPage() {
  const [mode, setMode] = useState<string>('all');
  const [selected, setSelected] = useState<RunSummary | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['runs'],
    queryFn: modesApi.runs,
    refetchInterval: 20_000,
  });

  const { data: detail } = useQuery({
    queryKey: ['runs', selected?.mode, selected?.name],
    queryFn: () => modesApi.runDetail(selected!.mode, selected!.name),
    enabled: Boolean(selected),
    staleTime: 30_000,
  });

  const runs = (data?.runs ?? []).filter((run) => mode === 'all' || run.mode === mode);
  const modes = ['all', ...Array.from(new Set((data?.runs ?? []).map((run) => run.mode)))];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Observe"
        title="Runs & artifacts"
        description="Every training, validation, export and video-analysis run, with the plots, CSVs and checkpoints each one produced."
        badges={[
          { label: `${data?.runs.length ?? 0} runs`, tone: 'brand' },
          { label: 'plots · results.csv · args.yaml', tone: 'violet' },
        ]}
        actions={
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={isFetching} onClick={() => refetch()}>
            Refresh
          </Button>
        }
      />

      <SegmentedControl
        size="sm"
        value={mode}
        onChange={setMode}
        options={modes.map((entry) => ({ value: entry, label: entry }))}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader icon={<Activity className="size-4" />} title="Run history" description="Newest first. Click a row to inspect its artifacts." />
          {isLoading ? (
            <p className="text-xs text-slate-500">Loading runs…</p>
          ) : (
            <DataTable<RunSummary>
              dense
              rows={runs}
              getRowKey={(run) => run.id}
              onRowClick={setSelected}
              empty={
                <EmptyState
                  icon={<FolderTree className="size-5" />}
                  title="No runs recorded"
                  description="Train a model, run a validation, export a format or analyse a video — the outputs all show up here."
                />
              }
              columns={[
                { key: 'mode', header: 'Mode', render: (run) => <Badge tone={MODE_TONES[run.mode] ?? 'neutral'}>{run.mode}</Badge> },
                {
                  key: 'name',
                  header: 'Run',
                  render: (run) => <span className="truncate font-mono text-[11px] text-slate-200">{run.name}</span>,
                },
                { key: 'when', header: 'Created', align: 'right', render: (run) => <span className="text-[11px] text-slate-500">{formatRelativeTime(run.created_at)}</span> },
                {
                  key: 'weights',
                  header: 'Weights',
                  align: 'center',
                  render: (run) => (run.has_weights ? <Badge tone="success">yes</Badge> : <span className="text-slate-600">—</span>),
                },
                {
                  key: 'plots',
                  header: 'Plots',
                  align: 'right',
                  render: (run) => <span className="font-mono text-[11px] text-slate-500">{run.images.length}</span>,
                },
              ]}
            />
          )}
        </Card>

        <div className="space-y-4">
          {!selected ? (
            <EmptyState
              icon={<Table2 className="size-5" />}
              title="No run selected"
              description="Pick a run to see its configuration, training curves and generated plots."
            />
          ) : (
            <>
              <Card>
                <CardHeader
                  icon={<FolderTree className="size-4" />}
                  title={`${selected.mode}/${selected.name}`}
                  description={selected.path}
                />
                <KeyValue
                  columns={2}
                  items={[
                    { label: 'Mode', value: <Badge tone={MODE_TONES[selected.mode] ?? 'neutral'}>{selected.mode}</Badge> },
                    { label: 'Created', value: formatRelativeTime(selected.created_at) },
                    {
                      label: 'Best weights',
                      value: selected.best_weight ? (
                        <span className="font-mono text-[11px] break-all">{selected.best_weight}</span>
                      ) : (
                        'none'
                      ),
                    },
                    { label: 'Plots', value: selected.images.length },
                  ]}
                />
                {selected.best_weight && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={`/validate?model=${encodeURIComponent(selected.best_weight)}`}>
                      <Button size="sm" variant="primary">
                        Validate
                      </Button>
                    </Link>
                    <Link to={`/predict?model=${encodeURIComponent(selected.best_weight)}`}>
                      <Button size="sm" variant="secondary">
                        Predict
                      </Button>
                    </Link>
                    <Link to={`/export?model=${encodeURIComponent(selected.best_weight)}`}>
                      <Button size="sm" variant="ghost">
                        Export
                      </Button>
                    </Link>
                  </div>
                )}
              </Card>

              {detail?.history && Object.keys(detail.history).length > 1 && <HistoryCard detail={detail} />}

              {detail && detail.artifacts.length > 0 && (
                <Card>
                  <CardHeader icon={<Images className="size-4" />} title="Artifacts" description={`${detail.artifacts.length} file(s) in this run.`} />
                  <div className="grid grid-cols-2 gap-2">
                    {detail.artifacts
                      .filter((artifact) => artifact.kind === 'image')
                      .slice(0, 12)
                      .map((artifact) => (
                        <a
                          key={artifact.path}
                          href={artifact.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group overflow-hidden rounded-lg border border-ink-700/60 transition-colors hover:border-brand-500/50"
                        >
                          <img src={artifact.url} alt={artifact.name} className="h-28 w-full bg-white object-contain" loading="lazy" />
                          <p className="truncate px-2 py-1 font-mono text-[10px] text-slate-400 group-hover:text-slate-200">
                            {artifact.name}
                          </p>
                        </a>
                      ))}
                  </div>
                  <SectionTitle className="mt-4">Other files</SectionTitle>
                  <ul className="space-y-1">
                    {detail.artifacts
                      .filter((artifact) => artifact.kind !== 'image')
                      .slice(0, 20)
                      .map((artifact) => (
                        <li key={artifact.path} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate font-mono text-slate-300">{artifact.name}</span>
                          <span className="shrink-0 text-slate-500">{formatBytes(artifact.size_bytes)}</span>
                        </li>
                      ))}
                  </ul>
                </Card>
              )}

              {detail?.args && Object.keys(detail.args).length > 0 && (
                <Card>
                  <CardHeader icon={<Weight className="size-4" />} title="Training arguments" description="Exact Ultralytics configuration used." />
                  <div className="max-h-72 overflow-y-auto">
                    <KeyValue
                      columns={1}
                      items={Object.entries(detail.args)
                        .filter(([, value]) => value !== null && value !== undefined && value !== '')
                        .map(([key, value]) => ({
                          label: key,
                          value: <span className="font-mono text-[11px]">{String(value)}</span>,
                        }))}
                    />
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryCard({ detail }: { detail: RunDetail }) {
  const history = detail.history ?? {};
  const epochCount = Math.max(
    0,
    ...Object.values(history).map((column) => (Array.isArray(column) ? column.length : 0)),
  );
  const rows = Array.from({ length: epochCount }, (_, index) => {
    const row: Record<string, number | string | null> = { epoch: index + 1 };
    for (const [key, column] of Object.entries(history)) {
      const value = Array.isArray(column) ? column[index] : null;
      row[key] = typeof value === 'number' ? value : null;
    }
    return row;
  });

  const lossKeys = Object.keys(history).filter((key) => key.includes('loss'));
  const metricKeys = Object.keys(history).filter((key) => key.includes('metrics/'));

  return (
    <Card>
      <CardHeader
        icon={<Activity className="size-4" />}
        title="Training history"
        description={`${epochCount} epochs parsed from results.csv.`}
      />
      {lossKeys.length > 0 && (
        <LineChart
          data={rows}
          xKey="epoch"
          series={lossKeys.slice(0, 5).map((key, index) => ({
            key,
            label: key.replace('train/', 'tr ').replace('val/', 'val '),
            color: ['#22d3ee', '#a78bfa', '#f472b6', '#4ade80', '#fbbf24'][index % 5],
          }))}
          height={200}
        />
      )}
      {metricKeys.length > 0 && (
        <LineChart
          className="mt-4"
          data={rows}
          xKey="epoch"
          series={metricKeys.slice(0, 5).map((key, index) => ({
            key,
            label: key.replace('metrics/', ''),
            color: ['#22d3ee', '#a78bfa', '#f472b6', '#4ade80', '#fbbf24'][index % 5],
          }))}
          height={200}
        />
      )}
      <p className="mt-3 font-mono text-[10px] text-slate-500">
        {epochCount} epochs · columns: {Object.keys(history).slice(0, 8).join(', ')}
        {Object.keys(history).length > 8 ? '…' : ''}
      </p>
    </Card>
  );
}
