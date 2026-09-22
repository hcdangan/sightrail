# API reference

Base URL: `http://127.0.0.1:8000`. Interactive documentation is generated from
the code and always current: **`/api/docs`** (Swagger UI), **`/api/redoc`**, and
the raw schema at **`/api/openapi.json`**.

* All request and response bodies are JSON (`multipart/form-data` for uploads).
* Timestamps are ISO-8601 UTC; durations are seconds; latencies are milliseconds.
* Errors use a consistent envelope:

```json
{ "detail": "Model 'yolo11n-x.pt' was not found. Provide a path to a local checkpoint." }
```

Validation failures return `422` with per-field detail:

```json
{
  "error": "validation_error",
  "detail": "The request body failed validation.",
  "issues": [{ "loc": ["body", "options", "conf"], "msg": "Input should be less than or equal to 1", "type": "less_than_equal" }],
  "path": "/api/infer"
}
```

| Status | Meaning |
| --- | --- |
| `400` | The request was understood but cannot be satisfied (bad source, unusable media) |
| `404` | Model, upload, dataset, run or session not found |
| `415` | Wrong media type for the endpoint |
| `422` | Schema validation failed |
| `503` | The Ultralytics engine is not installed in the API environment |

---

## System

### `GET /api/health`
Liveness plus engine readiness.

```json
{ "status": "ok", "version": "1.0.0", "engine_available": true, "storage_root": "C:\\…\\storage" }
```

### `GET /api/system/env`
Python, platform, torch/CUDA/cuDNN, Ultralytics version, optional export
backends, storage footprint and feature flags. Cached after the first call.

### `GET /api/system/devices`
Every selectable compute profile with availability, capability list and notes:

```json
{ "devices": [
  { "id": "auto", "label": "Auto (best available)", "kind": "auto", "available": true,
    "detail": "CUDA → MPS → Hailo → CPU · currently cpu",
    "capabilities": ["predict","track","train","val","export","benchmark"],
    "supports_training": true, "requires": [], "resolves_to": "cpu" },
  { "id": "cpu", "label": "CPU (AMD64)", "kind": "cpu", "available": true,
    "detail": "16 logical cores", "capabilities": ["predict","track","train","val","export","benchmark"],
    "supports_training": true, "requires": [] },
  { "id": "hailo", "label": "Hailo accelerator (NPU)", "kind": "hailo", "available": false,
    "detail": "HailoRT (hailo_platform) not installed",
    "capabilities": ["predict","track","export"], "supports_training": false,
    "requires": ["hailo_platform (HailoRT)", "a compiled .hef model"],
    "requirements": { "runtime": false, "device": false, "compiler": false, "model": false },
    "arch": "hailo8l" }
] }
```

Note that `hailo` is always listed, even on hardware that cannot use it: the
requirements are the useful information.

### `GET /api/system/device-config`
Everything needed to render the device switch: the active resolution, all
profiles, the Hailo state and a copy-pasteable `.env` snippet.

```json
{
  "env_var": "SIGHTRAIL_DEVICE",
  "configured": "cpu", "requested": "cpu", "resolved": "cpu", "engine_device": "cpu",
  "devices": [ /* as above */ ],
  "hailo": {
    "architecture": "hailo8l",
    "architectures": [{ "id": "hailo8l", "label": "Hailo-8L (13 TOPS)",
                        "target": "Raspberry Pi 5 + AI Kit / AI HAT+", "note": "…" }],
    "model": null, "dfc_python": null,
    "runtime_installed": false, "device_present": false, "compiler_installed": false,
    "cli": null, "python": "…/python.exe"
  },
  "env_file": "…/.env", "env_example": "…/.env.example", "env_file_exists": true,
  "snippet": "# ---- Compute device (uncomment exactly one) ----\nSIGHTRAIL_DEVICE=cpu\n#SIGHTRAIL_DEVICE=cuda:0\n#SIGHTRAIL_DEVICE=hailo\n…",
  "hailo_state": { /* as /api/system/hailo */ }
}
```

### `GET /api/system/hailo`
Hailo readiness with ordered setup steps.

```json
{
  "status": "runtime-missing",
  "summary": "HailoRT is not installed: pip install hailo_platform",
  "runtime": false, "device": false, "compiler": false,
  "arch": "hailo8l", "arch_label": "Hailo-8L (13 TOPS)", "arch_supported": true,
  "model": null, "model_dir": null, "configured_model": null,
  "searched": ["…/storage/weights", null],
  "steps": [{ "title": "Install HailoRT", "detail": "sudo apt install hailo-all\n…" }]
}
```

`status` is one of `ready`, `runtime-missing`, `device-missing` or
`model-missing`.

### `GET /api/system/memory`
Live RAM usage plus per-GPU VRAM (`total_gb`, `used_gb`, `free_gb`,
`allocated_gb` from torch's allocator) and a `hailo` entry when the NPU is ready.

### `GET /api/system/overview`
Everything the dashboard needs in one call: device, catalog counts, dataset
count, uploads, local checkpoints, job lists, runs, memory, storage and the
models currently resident in the registry cache.

### `GET /api/system/runs`
Run directories produced by every mode, newest first, with the first few plot
URLs and the path to `weights/best.pt` when present.

---

## Models

| Endpoint | Description |
| --- | --- |
| `GET /api/models/catalog` | Every checkpoint Sightrail knows. Query: `task`, `family`. Each entry has `id`, `task`, `family`, `size`, `approx_params_m`, `download_url`, `downloaded`. |
| `GET /api/models/local` | Checkpoints present on disk with size, mtime, inferred task and whether it is an export. |
| `GET /api/models/registry` | Models loaded in memory (`hits`, `resident_s`) and the cache capacity. |
| `DELETE /api/models/registry?model=` | Evict one model, or the whole cache when `model` is omitted. |
| `GET /api/models/formats` | Export format matrix: label, engine name, suffix, CPU/GPU support, accepted options, backend environment, deployment targets. |
| `GET /api/models/tasks` | The five task families with their default checkpoint and output types. |
| `GET /api/models/trackers` | The six bundled trackers with descriptions and prerequisites. `recommended` marks Sightrail's default — **ByteTrack**, not Ultralytics' own `tracktrack.yaml`; see `core/models_meta.py::DEFAULT_TRACKER`. |
| `GET /api/models/optimizers` | Optimizer choices for training. |
| `GET /api/models/{model_id}/info` | Load a checkpoint and report task, class names, layers, parameters, gradients, GFLOPs and device. `model_id` may contain slashes (a path). |
| `POST /api/models/download` | Fetch a catalog checkpoint into `storage/weights`. Body: `{"model": "yolo11n-seg.pt"}`. |
| `DELETE /api/models/cache` | Delete rendered prediction outputs. Returns the number of files removed. |

```bash
curl -s 'localhost:8000/api/models/catalog?task=pose' | python -m json.tool | head -20
curl -s -X POST localhost:8000/api/models/download \
  -H 'content-type: application/json' -d '{"model":"yolo11n-pose.pt"}'
```

---

## Inference

### `POST /api/infer`
Run predict mode on one image. The task head is inferred from the checkpoint
unless `task` is set.

```json
{
  "model": "yolo11n.pt",
  "task": "detect",
  "source": { "sample": "bus.jpg" },
  "options": {
    "conf": 0.25, "iou": 0.7, "imgsz": 640, "max_det": 300,
    "classes": null, "device": "auto", "augment": false,
    "agnostic_nms": false, "retina_masks": false, "half": null,
    "save_rendered": true, "mask_limit": 64
  }
}
```

`source` accepts exactly one of:

| Field | Example | Notes |
| --- | --- | --- |
| `sample` | `"bus.jpg"` | A bundled Ultralytics sample asset |
| `upload_id` | `"c54ba32ea514"` | A file previously POSTed to `/api/uploads` |
| `path` | `"C:/data/img.jpg"` | Local file. Must resolve inside the storage root, the repository, or a `SIGHTRAIL_EXTRA_SOURCE_ROOTS` entry. Batch mode also accepts a folder. |
| `data_url` | `"data:image/jpeg;base64,…"` | Inline image (canvas captures) |
| `url` | `"https://…/img.jpg"` | Fetched into `storage/media` (private hosts refused) |
| `camera` | `0` | Webcam index — only valid where a live source makes sense |

Response (`InferResponse`):

```json
{
  "id": "9f3c1a2b4d5e",
  "model": { "source": "…/weights/yolo11n.pt", "task": "detect", "classes": 80,
             "names": { "0": "person" }, "info": { "layers": 181, "parameters": 2624080, "gflops": 6.5 } },
  "results": [{
    "task": "detect",
    "path": "…/assets/bus.jpg",
    "original_shape": [1080, 810],
    "names": { "0": "person", "5": "bus" },
    "speed": { "preprocess_ms": 3.7, "inference_ms": 85.8, "postprocess_ms": 9.9 },
    "detections": { "type": "boxes", "count": 5, "items": [
      { "index": 0, "class_id": 5, "class_name": "bus", "confidence": 0.87,
        "xyxy": [12.4, 231.0, 802.1, 736.5], "xywhn": [0.5, 0.44, 0.97, 0.47],
        "xyxyn": [0.015, 0.21, 0.99, 0.68], "track_id": null }
    ]},
    "masks": null, "keypoints": null, "obb": null, "probs": null,
    "rendered_url": "/api/media/outputs/bus_15826000.jpg"
  }],
  "stats": { "device": "cuda:0", "count": 1, "total_ms": 214.6, "image_shape": [1080, 810] },
  "elapsed_ms": 240.1
}
```

Task-specific payloads:

| Task | Populated field | Shape |
| --- | --- | --- |
| detect | `detections.items[].xyxy` | `[x1, y1, x2, y2]` pixels |
| segment | `masks.items[].polygon` | flattened normalised `[x0,y0,x1,y1,…]` |
| pose | `keypoints.items[].xy` / `.confidence` | 17 points, per-point confidence; `shape: [17, 3]` |
| obb | `obb.items[].xyxy` / `.xywhr` | 8 corner values / `[cx, cy, w, h, radians]` |
| classify | `probs` | `top1`, `top1_name`, `top1_conf`, `top5[]`, optional `all_scores[]` |

### `POST /api/infer/batch`
Same body shape, but the source resolves to a list: a folder, a `.txt` manifest
of paths, or a single file. Capped at `max_batch_size` (default 32).

```json
{ "model": "yolo11n.pt", "source": { "path": "C:/data/images" }, "options": { "conf": 0.3 } }
```

Returns `items[]` (each with `result` or an `error`), a merged `histogram`, and
throughput statistics (`total_ms`, `avg_ms`, `min_ms`, `max_ms`,
`throughput_fps`). One unreadable file never fails the batch.

### `GET /api/infer/defaults`
Current defaults from configuration; the UI seeds its controls from this.

---

## Uploads

| Endpoint | Description |
| --- | --- |
| `GET /api/uploads?kind=&limit=` | Stored files, newest first, with a media `url` |
| `POST /api/uploads` | Single file (`file` field) |
| `POST /api/uploads/batch` | Many files (`files` field, repeated) |
| `GET /api/uploads/{id}` | Metadata for one upload |
| `DELETE /api/uploads/{id}` | Remove a file and its sidecar |
| `POST /api/uploads/{id}/extract` | Expand a `.zip` of images and register the contents |
| `DELETE /api/uploads` | Delete every upload |

```bash
curl -s -X POST localhost:8000/api/uploads -F file=@cat.jpg
curl -s -X POST localhost:8000/api/infer \
  -H 'content-type: application/json' \
  -d '{"model":"yolo11n.pt","source":{"upload_id":"c54ba32ea514"}}'
```

`jq` is used in a few examples below for readability; it is **not** a project
dependency. Substitute `python -m json.tool` if it is not installed.

---

## Modes

All four start a background job and return `JobSummary` immediately.

### `POST /api/train`
The body mirrors the Ultralytics training surface; every field has a sensible
default.

```json
{
  "model": "yolo11n.pt", "data": "coco8.yaml", "task": "detect",
  "epochs": 50, "imgsz": 640, "batch": -1, "workers": 0,
  "optimizer": "auto", "lr0": 0.01, "lrf": 0.01, "momentum": 0.937,
  "weight_decay": 0.0005, "warmup_epochs": 3.0, "cos_lr": false,
  "patience": 50, "seed": 0, "deterministic": true, "val": true,
  "amp": true, "cache": false, "rect": false, "fraction": 1.0,
  "freeze": null, "single_cls": false, "dropout": 0.0,
  "close_mosaic": 10, "mask_ratio": 4, "overlap_mask": true,
  "hsv_h": 0.015, "hsv_s": 0.7, "hsv_v": 0.4,
  "degrees": 0.0, "translate": 0.1, "scale": 0.5, "shear": 0.0,
  "perspective": 0.0, "flipud": 0.0, "fliplr": 0.5,
  "mosaic": 1.0, "mixup": 0.0, "copy_paste": 0.0, "erasing": 0.4,
  "auto_augment": "randaugment"
}
```

Result payload: `run_dir`, `weights.{best,last}`, `best_model`, `history`
(column-oriented `results.csv`), `final_metrics` (a validation report for the
best checkpoint) and `artifacts`.

### `POST /api/val`
`{"model": "...", "data": "coco8.yaml", "split": "val", "imgsz": 640, "batch": 16, "conf": 0.001, "iou": 0.6, "half": false}`

Result payload: `summary` (mAP50, mAP50-95, mAP75, precision, recall, F1, or
top-1/top-5 accuracy for classification), `per_class[]`, `curves[]` (the
mAP-vs-IoU matrix per class), `confusion_matrix_url`, `artifacts[]` and `speed`.

### `POST /api/export`
`{"model": "...", "format": "onnx", "imgsz": 640, "batch": 1, "half": false, "int8": false, "dynamic": false, "simplify": true, "nms": false, "opset": null, "data": null, "device": "auto"}`

Result payload: `format`, `path`, `size_bytes` and a downloadable `artifact`.
Formats are listed by `GET /api/export/formats`; check backend readiness with
`GET /api/export/available`.

**Hailo (`format: "hailo"`)** compiles a `.hef` for a Hailo accelerator. Add
`hailo_arch` (`hailo8l` for a Raspberry Pi AI Kit/HAT, `hailo8`, `hailo10h`,
`hailo15h`, `hailo15l`) and a calibration dataset. The endpoint validates the
request up front and returns `400` with every unmet requirement at once — host
must be Linux x86_64, the Dataflow Compiler must be importable, calibration data
is mandatory and only detection/classification models are supported. A
successful export lands in `storage/weights/<model>_hailo_model/`.

### Device selection on every mode endpoint

`train`, `val`, `export` and `benchmark` all take a `device` string. Accepted
values are `auto`, `cpu`, `cuda`, `cuda:N`, `mps`, `hailo`, Hailo board names
(`hailo8l`, …), a bare GPU index (`0`), or the aliases `gpu` / `npu` / `metal`.
Unrecognised values degrade to `cpu` rather than failing.

| Device | train | val | export | benchmark |
| --- | --- | --- | --- | --- |
| `cpu`, `cuda:N`, `mps`, `auto` | yes | yes | yes | yes |
| `hailo` | `400` with the reason | `400` | yes (compiles a HEF) | yes |

Training or validating on Hailo returns:

```json
{ "detail": "Hailo accelerators cannot run train: compiled HEF networks have no backward pass. Train and validate on cpu/cuda, then export with format=hailo and switch SIGHTRAIL_DEVICE=hailo for inference." }
```

### `POST /api/benchmark`
`{"model": "...", "formats": ["onnx","openvino","torchscript"], "data": "coco8.yaml", "imgsz": 640}`

Exports each format, measures size and export time, and — when `data` is given —
validates each artifact so accuracy is measured rather than estimated. Formats
that fail are reported per row with their error instead of failing the job.

---

## Jobs

| Endpoint | Description |
| --- | --- |
| `GET /api/jobs?kind=&limit=` | Job summaries, newest first |
| `GET /api/jobs/active` | Queued or running jobs |
| `GET /api/jobs/{id}` | Full detail including the buffered event log |
| `POST /api/jobs/{id}/cancel` | Cooperative cancellation (stops after the current step) |
| `DELETE /api/jobs/finished` | Drop finished jobs from the store |

`JobSummary`:

```json
{
  "id": "a0c84fb467aa", "kind": "train", "status": "running",
  "title": "Train yolo11n.pt on coco8.yaml",
  "params": { "epochs": 3 }, "percent": 66.7, "message": "3/3 …",
  "created_at": "2026-01-01T12:00:00Z", "duration_s": 42.1,
  "error": null, "result": null, "artifacts": [],
  "metrics": { "box_loss": [1.32, 1.11], "map50": [0.51] }
}
```

---

## Streaming and tracking

### `GET /api/stream/solutions`
The sixteen built-in solutions with their description, supported tasks and
whether they need a region of interest (plus a suggested default region).

### `GET /api/stream/cameras`
Probes the first few capture indexes and reports only those that open.

### `POST /api/stream/sessions`
Opens a server-side MJPEG session.

```json
{
  "model": "yolo11n.pt", "source": { "camera": 0 },
  "tracker": "bytetrack.yaml", "solution": "object_counter",
  "solution_kwargs": { "show_in": true },
  "conf": 0.3, "iou": 0.7, "imgsz": 640, "device": "auto",
  "show_boxes": true, "jpeg_quality": 80
}
```

Response: `session_id`, `mjpeg_url`, `stats_url`, the resolved `source`, the
solution metadata, the model path and the class-name map.

| Endpoint | Description |
| --- | --- |
| `GET /api/stream/sessions` | Open sessions with frames, FPS and counters |
| `GET /api/stream/sessions/{id}/mjpeg` | `multipart/x-mixed-replace` JPEG stream |
| `GET /api/stream/sessions/{id}/stats` | Frames, FPS, uptime, counters, rolling history |
| `DELETE /api/stream/sessions/{id}` | Stop and release the session |

```html
<img src="http://127.0.0.1:8000/api/stream/sessions/1a2b3c4d5e/mjpeg" />
```

### `POST /api/stream/track`
Track mode over a video, returning the full per-frame history (up to
`max_frames`, default 180): every detection with its `track_id`, class and
confidence, plus a histogram and the number of unique identities. Set
`reset: true` to clear a named session first.

### `POST /api/stream/video`
Renders a whole video into an annotated MP4 as a background job. Progress,
per-frame object counts and the output artifact are exposed through the normal
job API.

### WebSocket `/api/ws/live`
Client-driven camera loop. Send a `config` frame first, then `frame` messages
carrying JPEG data URLs.

```jsonc
// → client → server
{ "type": "config", "config": {
    "model": "yolo11n.pt", "device": "cuda:0", "tracker": "bytetrack.yaml",
    "solution": "heatmap", "show_boxes": true, "jpeg_quality": 78,
    "conf": 0.3, "iou": 0.7, "imgsz": 640, "region": null } }
{ "type": "frame", "data": "data:image/jpeg;base64,…" }
{ "type": "reset" }                          // clears tracker + solution state
{ "type": "stop" }                           // closes the session

// → server → client
{ "type": "ready", "session": "…", "model": "…", "names": { "0": "person" } }
{ "type": "result", "frame": 42, "latency_ms": 18.4, "avg_latency_ms": 21.1,
  "fps": 47.4, "rendered": "data:image/jpeg;base64,…", "result": { …ResultPayload },
  "counters": { "total_tracks": 5, "in_count": 2 } }
{ "type": "error", "message": "…" }
```

### WebSocket `/api/ws/jobs/{job_id}`
Replays the buffered events, then streams live ones:

```jsonc
{ "type": "event", "event": { "seq": 12, "kind": "progress", "percent": 33.0,
    "message": "1/3 …", "data": { "epoch": 1, "epochs": 3, "box_loss": 1.32 },
    "level": "info", "timestamp": "…" }, "replay": true }
{ "type": "snapshot", "job": { …JobDetail } }
{ "type": "ping", "status": "running", "percent": 33.0 }
{ "type": "done", "job": { …JobDetail } }
```

---

## Datasets

| Endpoint | Description |
| --- | --- |
| `GET /api/datasets?task=` | Quickstart descriptors, Ultralytics dataset YAMLs and locally built datasets, with image/class counts and whether the data is on disk |
| `GET /api/datasets/{id}/preview` | Parsed `data.yaml` |
| `GET /api/datasets/local` | Only datasets built by Sightrail, plus the storage root |
| `POST /api/datasets/annotate` | Auto-annotate uploads into a new dataset (job) |
| `POST /api/datasets/annotate-folder` | Auto-annotate a server-side folder (job) |
| `GET /api/solutions` | Solution catalog (alias of `/api/stream/solutions`) |

```json
// POST /api/datasets/annotate -> 200 + JobSummary (the work runs in the background)
{
  "name": "my-dataset", "model": "yolo11n-pose.pt", "task": "pose",
  "upload_ids": ["c54ba32ea514"], "paths": [],
  "conf": 0.35, "iou": 0.7, "imgsz": 640, "device": "auto",
  "val_split": 0.15, "classes": null
}
```

The job result reports `root`, `data_yaml`, the label-format hint, and stats
(`images`, `annotated`, `objects`, `labels_written`, `per_class`). It writes
standard YOLO labels per task:

| Task | Label line |
| --- | --- |
| detect | `class cx cy w h` (normalised) |
| segment | `class x1 y1 x2 y2 …` (normalised polygon) |
| pose | `class cx cy w h px1 py1 v1 …` (17 keypoints with visibility) |
| obb | `class cx cy w h angle` (normalised) |
| classify | folder-per-class structure, no label files |

---

## Runs

| Endpoint | Description |
| --- | --- |
| `GET /api/runs` | Alias of `/api/system/runs` |
| `GET /api/runs/{mode}/{name}` | Artifacts, parsed `results.csv` history and `args.yaml` for one run |

---

## Media

`GET /api/media/{category}/{filename}` serves files from
`uploads`, `outputs`, `runs`, `weights`, `datasets`, `media`, `jobs` and the
bundled `samples`. Nested paths are rejected and every lookup is resolved inside
its category root, so `..` traversal cannot escape.

`GET /api/media/samples` lists the bundled Ultralytics sample images.

---

## Client examples

```python
import httpx

with httpx.Client(base_url="http://127.0.0.1:8000", timeout=120) as api:
    # Predict with a pose model
    pose = api.post("/api/infer", json={
        "model": "yolo11n-pose.pt",
        "source": {"sample": "zidane.jpg"},
        "options": {"conf": 0.3, "device": "cpu"},
    }).json()["results"][0]
    print(pose["keypoints"]["count"], "skeletons")

    # Train, then follow the live console over WebSocket
    job = api.post("/api/train", json={
        "model": "yolo11n.pt", "data": "coco8.yaml", "epochs": 3, "imgsz": 320, "device": "cpu",
    }).json()
    print(job["id"], job["status"])
```

```javascript
// Live camera loop (browser)
const socket = new WebSocket('ws://127.0.0.1:8000/api/ws/live');
socket.onopen = () => socket.send(JSON.stringify({
  type: 'config',
  config: { model: 'yolo11n.pt', tracker: 'bytetrack.yaml', solution: 'object_counter' },
}));
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'result') {
    console.log(message.frame, message.result?.detections?.items.length, message.counters);
  }
};
```
