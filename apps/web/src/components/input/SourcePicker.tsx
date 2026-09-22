import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, FileImage, Globe, HardDriveUpload, Image as ImageIcon, Link2, Trash2, Upload } from 'lucide-react';

import { uploadsApi } from '@/lib/api';
import type { UploadEntry } from '@/lib/api-types';
import type { SourceKind, SourceState } from '@/lib/sources';

import { toast } from '@/lib/stores/toasts';
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils';
import { Badge, Button, Input, SegmentedControl, Spinner } from '@/components/ui/primitives';



/**
 * Source picker shared by Predict, Batch and the annotation flow.
 *
 * Four input modes map onto the backend's `SourceSpec`: bundled samples, an
 * uploaded file or folder of images, a remote URL, or a server-side path.
 */
export function SourcePicker({
  value,
  onChange,
  accept = 'image',
  allowFolder = false,
  allowMultiple = false,
  manageUploads = true,
  className,
}: {
  value: SourceState;
  onChange: (state: SourceState) => void;
  accept?: 'image' | 'video' | 'any';
  allowFolder?: boolean;
  allowMultiple?: boolean;
  manageUploads?: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [dragging, setDragging] = useState(false);

  const { data: samples } = useQuery({
    queryKey: ['media', 'samples'],
    queryFn: () => fetch('/api/media/samples').then((response) => response.json() as Promise<{ samples: { name: string; label: string; url: string }[] }>),
    staleTime: 300_000,
  });

  const { data: uploads } = useQuery({
    queryKey: ['uploads', accept],
    queryFn: () => uploadsApi.list(accept === 'any' ? undefined : accept),
    staleTime: 10_000,
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => (allowMultiple ? uploadsApi.uploadMany(files) : { uploads: [await uploadsApi.upload(files[0])], count: 1 }),
    onSuccess: (result) => {
      const first = result.uploads[0];
      toast.success(`Uploaded ${result.count} file${result.count === 1 ? '' : 's'}`, first?.name);
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
      if (first) {
        onChange({
          kind: 'upload',
          spec: { upload_id: first.id },
          previewUrl: first.kind === 'image' ? first.url : null,
          label: first.name,
        });
      }
    },
    onError: (error: Error) => toast.error('Upload failed', error.message),
  });

  const removeUpload = useMutation({
    mutationFn: (id: string) => uploadsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
      toast.info('Upload deleted');
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      upload.mutate([...files]);
    },
    [upload],
  );

  // Pre-seed the sample tab once samples load and nothing is selected yet.
  useEffect(() => {
    if (value.kind === 'sample' && !value.spec.sample && samples?.samples?.length) {
      const first = samples.samples[0];
      onChange({ kind: 'sample', spec: { sample: first.name }, previewUrl: first.url, label: first.label });
    }
  }, [samples, value.kind, value.spec.sample, onChange]);

  const sampleOptions = samples?.samples ?? [];
  const uploadOptions = useMemo(() => uploads?.uploads ?? [], [uploads]);

  return (
    <div className={cn('space-y-3', className)}>
      <SegmentedControl<SourceKind>
        size="sm"
        value={value.kind}
        onChange={(kind) => {
          if (kind === 'sample' && sampleOptions[0]) {
            onChange({ kind, spec: { sample: sampleOptions[0].name }, previewUrl: sampleOptions[0].url, label: sampleOptions[0].label });
          } else if (kind === 'upload' && uploadOptions[0]) {
            onChange({
              kind,
              spec: { upload_id: uploadOptions[0].id },
              previewUrl: uploadOptions[0].kind === 'image' ? uploadOptions[0].url : null,
              label: uploadOptions[0].name,
            });
          } else {
            onChange({ kind, spec: {}, previewUrl: null, label: '' });
          }
        }}
        options={[
          { value: 'sample', label: 'Samples', icon: <ImageIcon className="size-3.5" /> },
          { value: 'upload', label: allowFolder ? 'Library' : 'Upload', icon: <HardDriveUpload className="size-3.5" /> },
          { value: 'url', label: 'URL', icon: <Link2 className="size-3.5" /> },
          { value: 'folder', label: 'Server path', icon: <Globe className="size-3.5" /> },
        ]}
      />

      {value.kind === 'sample' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sampleOptions.length === 0 && <Spinner />}
          {sampleOptions.map((sample) => (
            <button
              key={sample.name}
              type="button"
              onClick={() => onChange({ kind: 'sample', spec: { sample: sample.name }, previewUrl: sample.url, label: sample.label })}
              className={cn(
                'group overflow-hidden rounded-lg border text-left transition-all',
                value.spec.sample === sample.name
                  ? 'border-brand-400/70 glow-ring'
                  : 'border-ink-700/70 hover:border-ink-500',
              )}
            >
              <img src={sample.url} alt={sample.label} className="h-20 w-full object-cover" loading="lazy" />
              <span className="block truncate px-2 py-1.5 text-[11px] text-slate-300">{sample.label}</span>
            </button>
          ))}
        </div>
      )}

      {value.kind === 'upload' && (
        <div className="space-y-3">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors',
              dragging ? 'border-brand-400/80 bg-brand-500/10' : 'border-ink-600/70 hover:border-ink-500',
            )}
          >
            {upload.isPending ? <Spinner className="size-5" /> : <Upload className="size-5 text-slate-500" />}
            <p className="text-xs text-slate-300">
              Drop {accept === 'video' ? 'a video' : accept === 'image' ? 'images' : 'files'} here or click to browse
            </p>
            <p className="text-[11px] text-slate-500">
              {allowFolder ? 'Multiple files and folders become a batch source' : 'One file at a time'}
            </p>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple={allowMultiple}
              accept={accept === 'image' ? 'image/*' : accept === 'video' ? 'video/*' : undefined}
              onChange={(event) => handleFiles(event.target.files)}
            />
          </div>

          {uploadOptions.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium tracking-wider text-slate-500 uppercase">Library</p>
              <ul className="max-h-52 space-y-1 overflow-y-auto pr-1">
                {uploadOptions.map((entry: UploadEntry) => (
                  <li key={entry.id}>
                    <div
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors',
                        value.spec.upload_id === entry.id
                          ? 'border-brand-400/60 bg-brand-500/10'
                          : 'border-transparent hover:border-ink-600/60 hover:bg-ink-800/50',
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() =>
                          onChange({
                            kind: 'upload',
                            spec: { upload_id: entry.id },
                            previewUrl: entry.kind === 'image' ? entry.url : null,
                            label: entry.name,
                          })
                        }
                      >
                        {entry.kind === 'image' ? (
                          <img src={entry.url} alt="" className="size-8 rounded object-cover" loading="lazy" />
                        ) : (
                          <span className="grid size-8 place-items-center rounded bg-ink-700/70">
                            <Camera className="size-3.5 text-slate-400" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] text-slate-200">{entry.name}</span>
                          <span className="block text-[10px] text-slate-500">
                            {formatBytes(entry.size_bytes)} · {formatRelativeTime(entry.created_at)}
                          </span>
                        </span>
                      </button>
                      {manageUploads && (
                        <button
                          type="button"
                          onClick={() => removeUpload.mutate(entry.id)}
                          className="text-slate-500 transition-colors hover:text-danger-400"
                          aria-label={`Delete ${entry.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {value.kind === 'url' && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              value={urlDraft}
              placeholder="https://example.com/image.jpg"
              onChange={(event) => setUrlDraft(event.target.value)}
            />
          </div>
          <Button
            variant="primary"
            size="md"
            icon={<Link2 className="size-3.5" />}
            disabled={!urlDraft.trim()}
            onClick={() =>
              onChange({ kind: 'url', spec: { url: urlDraft.trim() }, previewUrl: urlDraft.trim(), label: urlDraft.trim() })
            }
          >
            Use URL
          </Button>
        </div>
      )}

      {value.kind === 'folder' && (
        <div className="space-y-2">
          <Input
            value={value.spec.path ?? ''}
            placeholder="C:\\datasets\\my-images  (a file, folder or .txt manifest)"
            onChange={(event) =>
              onChange({
                kind: 'folder',
                spec: { path: event.target.value },
                previewUrl: null,
                label: event.target.value,
              })
            }
          />
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <FileImage className="size-3" />
            Paths are resolved on the API host, inside the storage directory or the working tree.
          </p>
        </div>
      )}

      {value.label && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Badge tone="brand">source</Badge>
          <span className="truncate">{value.label}</span>
        </div>
      )}
    </div>
  );
}


