import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'streaming' | 'error';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

/**
 * Webcam capture hook.
 *
 * Owns the `getUserMedia` lifecycle and exposes a `captureFrame()` helper that
 * encodes the current video frame to a JPEG data URL, which is exactly what the
 * `/api/ws/live` channel expects.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    const cameras = list
      .filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }));
    setDevices(cameras);
    setSelectedDeviceId((current) => current ?? cameras[0]?.deviceId);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      setStatus('starting');
      setError(null);
      try {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus('streaming');
        await refreshDevices();
      } catch (cause) {
        setStatus('error');
        const message =
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow access in the browser and retry.'
            : `Could not start the camera: ${(cause as Error).message}`;
        setError(message);
      }
    },
    [refreshDevices],
  );

  const selectDevice = useCallback(
    (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      if (status === 'streaming') void start(deviceId);
    },
    [start, status],
  );

  /** Encode the current video frame as a JPEG data URL (quality 0.72). */
  const captureFrame = useCallback((quality = 0.72): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) return null;

    const maxWidth = 960;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }, []);

  useEffect(() => {
    void refreshDevices();
    return () => stop();
  }, [refreshDevices, stop]);

  return { videoRef, canvasRef, status, error, devices, selectedDeviceId, start, stop, captureFrame, selectDevice, refreshDevices };
}
