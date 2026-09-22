# Feature matrix

Every Ultralytics capability Sightrail exposes, where it lives in the product,
and the code that implements it. Use this as the checklist when adding features:
if a capability is not here, the app does not showcase it yet.

Legend: **UI** = reachable from the browser, **API** = `apps/api`, **core** =
`apps/api/sightrail/core`.

---

## 1. The six execution modes

| Mode | UI | Backend entry | Core implementation |
| --- | --- | --- | --- |
| **Predict** | `/predict`, `/datasets` (preview tiles) | `POST /api/infer`, `POST /api/infer/batch` | `core/engine.py::Engine.predict`, `core/serialize.py` |
| **Track** | `/studio` → *Track a video*, *Webcam (client loop)* | `POST /api/stream/track`, `WS /api/ws/live` | `core/engine.py::Engine.track`, `core/live.py` |
| **Train** | `/train` | `POST /api/train` | `services/runners.py::run_training` |
| **Val** | `/validate` | `POST /api/val` | `services/runners.py::run_validation`, `core/metrics.py` |
| **Export** | `/export` | `POST /api/export` | `services/runners.py::run_export`, `core/models_meta.py` |
| **Benchmark** | `/benchmark` | `POST /api/benchmark` | `services/runners.py::run_benchmark` |

Beyond the six modes Sightrail also drives:

| Extra capability | UI | Backend |
| --- | --- | --- |
| **Auto-annotation** (pre-label a folder into a dataset) | `/datasets` → *Auto-annotate* | `core/annotate.py`, `POST /api/datasets/annotate` |
| **Video rendering** (annotated MP4 as a job) | `/studio` → *Render video* | `core/streaming.py::video_jobs_frames` |
| **Solutions analytics** (live) | `/solutions`, `/studio` | `core/streaming.py::apply_solution` |

---

## 2. The five task families

Handled uniformly by one pipeline; the UI adapts per task.

| Task | Models in catalog | Outputs surfaced | Overlay rendering | Extra controls |
| --- | --- | --- | --- | --- |
| **detect** | yolo11, yolov8, yolo12, yolov10, yolov9, yolov5, rtdetr | boxes | canvas rects + class colours | — |
| **segment** | yolo11-seg, yolov8-seg, sam2, fastsam, mobile_sam | boxes + polygons | filled polygons with adjustable opacity | *Retina masks*, *Max mask polygons* |
| **classify** | yolo11-cls, yolov8-cls | top-1/top-5 probabilities | probability bars in the inspector | — |
| **pose** | yolo11-pose, yolov8-pose | boxes + 17 keypoints | COCO-17 skeleton with per-point confidence gating | *Keypoints* toggle, per-keypoint readout |
| **obb** | yolo11-obb, yolov8-obb | oriented boxes | rotated corner polygons + angle readout | angle shown in degrees and radians |

Detection geometry is emitted in **both** pixel space (`xyxy`) and normalised
space (`xywhn`, `xyxyn`) so the client can render at any zoom without drift.

---

## 3. Streaming and tracking

| Capability | Where |
| --- | --- |
| Server-side MJPEG annotation pipeline | `GET /api/stream/sessions/{id}/mjpeg` |
| Client camera loop over WebSocket (lowest latency) | `WS /api/ws/live` |
| Persistent tracker state per session (stable IDs) | `core/live.py::FrameStream`, `LiveTracker` |
| Webcam discovery | `GET /api/stream/cameras` |
| Session statistics (frames, FPS, uptime, counters, rolling history) | `GET /api/stream/sessions/{id}/stats` |
| Region of interest (line / polygon / multi-polygon) | `StreamConfig.region`, UI preview in Live Studio |
| Per-frame analytics timeline | `core/streaming.py::video_jobs_frames` |
| Annotated MP4 output | job artifact, downloadable |

### Trackers exposed

ByteTrack (Sightrail's default) · TrackTrack · BoT-SORT · OC-SORT · Deep OC-SORT ·
FastTracker — listed with descriptions by `GET /api/models/trackers`. The default
is deliberately ByteTrack and not Ultralytics' own `tracktrack.yaml`; the
`recommended` flag that badges it in the UI is derived from
`core/models_meta.py::DEFAULT_TRACKER`, so the two cannot disagree.

---

## 4. Solutions library

All sixteen modules shipped by `ultralytics.solutions`, selectable in the
Sightrail, each with live counters surfaced in the UI.

| Solution | Category | Needs ROI |
| --- | --- | --- |
| Object Counter | retail | line |
| Region Counter | retail | polygon |
| Queue Manager | retail | polygon |
| Heatmap | analytics | — |
| Track Zone | analytics | polygon |
| Speed Estimator | traffic | polygon |
| AI Gym | sports | — |
| Distance Calculation | analytics | — |
| Vision Eye | analytics | — |
| Security Alarm | safety | polygon |
| Object Blurrer | safety | — |
| Object Cropper | analytics | — |
| Instance Segmentation | analytics | — |
| Analytics | analytics | — |
| Parking Management | traffic | multi-polygon |
| (baseline) Plain inference | — | — |

`core/streaming.SOLUTION_CATALOG` is the single source of truth; the UI groups
them by category and links each to its Ultralytics guide.

---

## 5. Training surface

Every Ultralytics training argument is exposed in `/train`, grouped so the
defaults stay approachable.

| Group | Parameters |
| --- | --- |
| **Essentials** | epochs, imgsz, batch (incl. auto `-1`), patience, workers, fraction |
| **Optimizer** | optimizer (Auto/SGD/Adam/AdamW/NAdam/RAdam/RMSProp), lr0, lrf, momentum, weight_decay, warmup_epochs, cos_lr, AMP |
| **Augmentation (all 15)** | hsv_h, hsv_s, hsv_v, degrees, translate, scale, shear, perspective, flipud, fliplr, mosaic, mixup, copy_paste, erasing, auto_augment (RandAugment/AutoAugment/AugMix/none) |
| **Advanced** | close_mosaic, dropout, seed, freeze layers, deterministic, cache, rect, pretrained, single_cls, resume, mask_ratio, overlap_mask |
| **Presets** | Smoke test (3 epochs/320px) · Quick fine-tune (25/512) · Balanced (100/640) · High accuracy (300/640) |

Live feedback: parsed `results.csv` history (loss + mAP + accuracy curves),
streamed console, artifact gallery, post-training validation of the best
checkpoint, and deep links to val/export/predict with the new weights.

---

## 6. Validation output

| Metric | Source | UI |
| --- | --- | --- |
| mAP@50, mAP@75, mAP@50-95 | `metrics.box` / `.obb` / `.seg` | headline tiles |
| Precision, Recall, F1 | `metrics.box.mp/.mr` | headline tiles + per-class table |
| Per-class P/R/F1/mAP | `metrics.box` arrays | colour-graded table |
| mAP-vs-IoU curve matrix | `metrics.box.curves` | per-class line chart |
| Segmentation metrics | `metrics.seg` | secondary block |
| Pose metrics | `metrics.pose` | secondary block |
| Top-1 / Top-5 accuracy | `metrics.top1/.top5` | headline tiles for classification |
| Confusion matrix (+ normalised) | `confusion_matrix*.png` | diagnostic gallery |
| Preprocess/inference/postprocess ms | `metrics.speed` | speed panel |
| Full `results_dict` | engine | raw JSON block |
| Per-class CSV / full JSON export | derived | download buttons |

---

## 7. Export formats

All 21 runtime formats advertised by the installed Ultralytics build are listed by
`GET /api/export/formats`; the UI flags which backends are installed and which
formats are GPU- or CPU-targeted.

TorchScript · ONNX · OpenVINO · TensorRT · CoreML · TensorFlow SavedModel ·
TensorFlow GraphDef · TF Edge TPU · LiteRT/TFLite · PaddlePaddle · MNN · NCNN ·
Sony IMX · Rockchip RKNN · ExecuTorch · Axelera AI · DEEPX · Qualcomm QNN ·
Hailo · Huawei Ascend · Apple Core AI

(The PyTorch row in Ultralytics' own table is the source format, not an export
target, so the format matrix has 21 selectable entries.)

Per-format options surfaced contextually: `half`, `int8`, `dynamic`, `simplify`,
`nms`, `opset`, `batch`, `workspace`, `optimize`, `keras`, and `data`
(calibration set).

---

## 8. Benchmarks

| Measurement | How |
| --- | --- |
| Artifact size | file or directory size after export |
| Export time | wall clock around `model.export()` |
| Preprocess / inference / postprocess latency | `metrics.speed` from validating the artifact |
| Accuracy per format | `model.val()` on the artifact (optional but on by default) |
| Winners | fastest, smallest, most accurate — computed client-side |
| Comparison charts | size and latency bar charts |
| Export | CSV of every row, including failures with their error |

---

## 9. Models and weights

| Capability | Where |
| --- | --- |
| Catalog of 79 checkpoints across 10 families | `core/catalog.py`, `/models` |
| On-demand download into `storage/weights` | `POST /api/models/download` |
| Local weight library (incl. exported artifacts) | `GET /api/models/local` |
| Architecture inspection (layers, parameters, gradients, GFLOPs, classes) | `GET /api/models/{id}/info` |
| LRU model cache with hit counters and eviction | `core/engine.py::ModelRegistry`, `/models` |
| Per-request device override (`auto`/`cpu`/`cuda:N`/`mps`) | header selector, `core/device.py` |
| Automatic task inference from the checkpoint name | `core/engine.py::infer_task_from_name` |

---

## 10. Data and datasets

| Capability | Where |
| --- | --- |
| Browse Ultralytics dataset descriptors | `/datasets` → *Browse* |
| Inspect a dataset's `data.yaml` and class list | `GET /api/datasets/{id}/preview` |
| Download state per dataset (on disk vs remote) | `core/datasets.py::_dataset_present` |
| Build a dataset from raw images | `/datasets` → *Auto-annotate* |
| Label formats for all four supervised tasks | `core/annotate.py::TASK_LABEL_HINT` |
| Train/val split during annotation | `val_split` parameter |
| Generated `data.yaml` with detected class names | `DatasetBuilder._write_yaml` |
| Straight-to-training handoff | `/train?dataset=…` link in the result |

---

## 11. Platform and operations

| Capability | Where |
| --- | --- |
| Device switch by one config variable (`SIGHTRAIL_DEVICE`) | `.env` / `.env.example`, `core/device.py` |
| Per-session device override from the UI | header selector, `components/system/DeviceSelect.tsx` |
| Device profiles with capability lists (Hailo cannot train) | `/api/system/devices`, `/system` |
| **Hailo accelerator inference** (Hailo-8/8L/10H/15H via HailoRT) | `core/hailo.py`, `hailo` device profile |
| **Hailo HEF export** with architecture selection | `/export` → format *Hailo*, `hailo_arch` |
| Hailo readiness checklist and copy-paste setup steps | `/system` → *Hailo accelerator* panel |
| HEF auto-discovery under `storage/weights` | `core/hailo.find_hef` |
| Guard rails: training/validation refused on Hailo with the reason | `core/hailo.guard_mode` |
| Environment report (Python, torch, CUDA, cuDNN, Ultralytics, HailoRT) | `/system` |
| Device enumeration with compute capability and VRAM | `/system`, header selector |
| Live RAM/VRAM telemetry | `GET /api/system/memory`, header |
| Storage footprint per directory | `/system`, dashboard |
| Optional export backend readiness | `GET /api/export/available`, `/system` |
| Model cache inspection and eviction | `/models`, `/system` |
| Run history with artifacts and `args.yaml` | `/runs` |
| Job control room (filter, cancel, live console, metrics, results) | `/jobs`, bottom dock |
| Upload library with delete and ZIP extraction | `/predict`, `/studio`, `/datasets` |
| Sample assets for instant demos | `/predict` → *Samples* |
| Command palette (⌘/Ctrl-K) with deep links | everywhere |
| Persisted UI preferences (device, thresholds, overlay) | `lib/stores/preferences.ts`, `/system` |
| Swagger/ReDoc/OpenAPI | `/api/docs`, `/api/redoc`, `/api/openapi.json` |

---

## 12. Deliberate non-goals

| Not implemented | Reason |
| --- | --- |
| A labelling editor (draw/correct boxes by hand) | Out of scope; Sightrail *pre*-labels, then exports standard YOLO format for any labelling tool |
| User accounts / multi-tenancy | Single-user local tool by design |
| Persisted job history across restarts | Job state is in memory; run artifacts on disk remain the durable record |
| Distributed training | Ultralytics supports it, but it is not a UI-shaped workflow |
| Ultralytics HUB integration | Requires credentials; the local model zoo covers the same need offline |
