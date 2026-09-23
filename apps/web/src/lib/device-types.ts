/**
 * TypeScript mirrors of the device / Hailo schemas.
 *
 * Keep in lock-step with `apps/api/sightrail/core/device.py` and
 * `core/hailo.py`.
 */

export type DeviceKind = 'auto' | 'cpu' | 'cuda' | 'mps' | 'hailo' | string;

/** Ultralytics modes a device can execute. */
export type ExecutionMode = 'predict' | 'track' | 'train' | 'val' | 'export' | 'benchmark';

export interface DeviceProfile {
  id: string;
  label: string;
  kind: DeviceKind;
  available: boolean;
  detail: string;
  capabilities: ExecutionMode[];
  supports_training: boolean;
  requires: string[];
  notes: string;
  /** CUDA only: which specific condition blocks it (`cpu-only-torch`, …). */
  state?: CudaStateName;
  /** `auto` only: what the profile currently resolves to. */
  resolves_to?: string;
  /** Hailo only: the discovered HEF. */
  model_hint?: string | null;
  arch?: string;
  requirements?: {
    runtime: boolean;
    device: boolean;
    compiler: boolean;
    model: boolean;
  };
}

/**
 * Why CUDA is or is not usable.
 *
 * `cuda_available()` being false is several different problems with opposite
 * fixes, so the API reports which one applies instead of a generic requirements
 * list. `cpu-only-torch` in particular cannot be fixed by touching a driver.
 */
export type CudaStateName = 'ready' | 'torch-missing' | 'cpu-only-torch' | 'driver-unavailable';

export interface CudaSetupStep {
  title: string;
  detail: string;
}

export interface CudaState {
  status: CudaStateName;
  summary: string;
  torch_version: string | null;
  /** The CUDA toolkit torch was built against; `null` for a CPU-only wheel. */
  torch_cuda: string | null;
  device_count: number;
  verify: string[];
  steps: CudaSetupStep[];
}

export interface HailoArchitecture {
  id: string;
  label: string;
  target: string;
  note: string;
}

export interface HailoSetupStep {
  title: string;
  detail: string;
}

export interface HailoState {
  status: 'ready' | 'runtime-missing' | 'device-missing' | 'model-missing';
  summary: string;
  runtime: boolean;
  device: boolean;
  compiler: boolean;
  arch: string;
  arch_label: string;
  arch_supported: boolean;
  model: string | null;
  model_name: string | null;
  model_dir: string | null;
  configured_model: string | null;
  searched: (string | null)[];
  steps: HailoSetupStep[];
}

export interface DeviceConfig {
  env_var: string;
  configured: string;
  requested: string;
  resolved: string;
  engine_device: string;
  devices: DeviceProfile[];
  /** CUDA readiness — the counterpart to `hailo_state` below. */
  cuda_state: CudaState;
  hailo: {
    architecture: string;
    architectures: HailoArchitecture[];
    model: string | null;
    dfc_python: string | null;
    runtime_installed: boolean;
    device_present: boolean;
    compiler_installed: boolean;
    cli: string | null;
    python: string;
  };
  env_file: string;
  env_example: string;
  env_file_exists: boolean;
  snippet: string;
  hailo_state: HailoState;
}

/** A device is selectable when the profile exists and the hardware is usable. */
export function isSelectable(profile: DeviceProfile): boolean {
  return profile.available || profile.kind === 'auto';
}

/** True when the device can run a given Ultralytics mode. */
export function supportsMode(profile: DeviceProfile | undefined, mode: ExecutionMode): boolean {
  if (!profile) return true;
  return profile.capabilities.includes(mode);
}
