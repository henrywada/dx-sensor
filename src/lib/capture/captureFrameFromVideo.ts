export type MountOrientation = "portrait" | "landscape";

/** Clockwise degrees applied when saving a frame. */
export type CaptureRotationDeg = 0 | 90 | 180 | 270;

/** Landscape handheld assumes the phone is tilted 90° left (CCW from portrait). */
export const LANDSCAPE_LEFT_TILT_SCREEN_ANGLE = 270;

export function readScreenAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation?.angle != null) {
    return screen.orientation.angle;
  }
  if (typeof window !== "undefined" && typeof window.orientation === "number") {
    return window.orientation;
  }
  return 0;
}

export function detectHandheldMount(
  screenAngle: number,
  viewportIsLandscape: boolean
): MountOrientation {
  const normalized = ((screenAngle % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) return "landscape";
  return viewportIsLandscape ? "landscape" : "portrait";
}

/** |gamma| above this (degrees) means the phone is physically on its side. */
const LANDSCAPE_GAMMA_DEG = 45;

/**
 * Physical tilt from DeviceOrientation, independent of screen-rotation lock.
 * Returns null when the reading is missing or the device is lying flat.
 */
export function mountFromDeviceTilt(
  gamma: number | null | undefined,
  beta?: number | null
): MountOrientation | null {
  if (gamma == null || Number.isNaN(gamma)) return null;
  if (
    beta != null &&
    !Number.isNaN(beta) &&
    Math.abs(beta) < 20 &&
    Math.abs(gamma) < 20
  ) {
    return null;
  }
  return Math.abs(gamma) >= LANDSCAPE_GAMMA_DEG ? "landscape" : "portrait";
}

export function resolveHandheldMount(input: {
  screenAngle: number;
  viewportIsLandscape: boolean;
  screenOrientationType?: string;
  deviceTiltMount?: MountOrientation | null;
}): MountOrientation {
  if (input.deviceTiltMount) return input.deviceTiltMount;
  return input.viewportIsLandscape ? "landscape" : "portrait";
}

const LANDSCAPE_CONFIRM_READINGS = 2;

/** Portrait applies immediately; landscape needs consecutive gyro readings to ignore a stale first event. */
export function applyTiltReading(
  reading: MountOrientation | null,
  landscapeStreak: number,
  current: MountOrientation | null
): { tilt: MountOrientation | null; landscapeStreak: number } {
  if (reading === "portrait") {
    return { tilt: "portrait", landscapeStreak: 0 };
  }
  if (reading === "landscape") {
    const nextStreak = landscapeStreak + 1;
    if (nextStreak >= LANDSCAPE_CONFIRM_READINGS) {
      return { tilt: "landscape", landscapeStreak: nextStreak };
    }
    return { tilt: current, landscapeStreak: nextStreak };
  }
  return { tilt: current, landscapeStreak };
}

/**
 * Clockwise rotation so saved pixels match the physical mount.
 *
 * Landscape mount default assumes the phone is tilted LEFT
 * (counterclockwise from portrait — natural for right-handed setup),
 * which maps to a 270° CW bake when the camera stream is still portrait-shaped.
 * angle === 90 means the device reports a right tilt → bake 90° instead.
 */
export function computeCaptureRotationDeg(
  mount: MountOrientation,
  videoWidth: number,
  videoHeight: number,
  screenAngle: number,
  invertDirection = false
): CaptureRotationDeg {
  if (!videoWidth || !videoHeight) return 0;

  const streamIsLandscape = videoWidth > videoHeight;
  const wantLandscape = mount === "landscape";
  const normalizedAngle = ((screenAngle % 360) + 360) % 360;

  let rotation: CaptureRotationDeg = 0;

  if (wantLandscape) {
    if (streamIsLandscape) {
      // Already wide — keep as-is (some Android devices).
      rotation = 0;
    } else {
      // Portrait stream + sideways mount. Prefer left-tilt (270° CW).
      rotation = normalizedAngle === 90 ? 90 : 270;
    }
  } else if (streamIsLandscape) {
    // Wide stream while upright mount → make portrait.
    rotation = normalizedAngle === 90 ? 270 : 90;
  }

  if (invertDirection && rotation !== 0) {
    rotation = ((360 - rotation) % 360) as CaptureRotationDeg;
  }

  return rotation;
}

export function captureFrameFromVideo(
  video: HTMLVideoElement,
  mount: MountOrientation,
  invertDirection = false,
  screenAngle = readScreenAngle()
): HTMLCanvasElement {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const rotation = computeCaptureRotationDeg(
    mount,
    videoWidth,
    videoHeight,
    screenAngle,
    invertDirection
  );

  const swap = rotation === 90 || rotation === 270;
  const canvasWidth = swap ? videoHeight : videoWidth;
  const canvasHeight = swap ? videoWidth : videoHeight;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("キャンバスを初期化できませんでした");

  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(video, -videoWidth / 2, -videoHeight / 2, videoWidth, videoHeight);

  return canvas;
}

/** Handheld shutter: landscape always bakes as a left 90° phone tilt. */
export function captureHandheldFrame(
  video: HTMLVideoElement,
  deviceTiltMount?: MountOrientation | null
): HTMLCanvasElement {
  const viewportIsLandscape =
    typeof window !== "undefined" && window.innerWidth > window.innerHeight;
  const rawAngle = readScreenAngle();
  const screenOrientationType =
    typeof screen !== "undefined" ? screen.orientation?.type ?? "" : "";
  const mount = resolveHandheldMount({
    screenAngle: rawAngle,
    viewportIsLandscape,
    screenOrientationType,
    deviceTiltMount,
  });
  const screenAngle =
    mount === "landscape" ? LANDSCAPE_LEFT_TILT_SCREEN_ANGLE : rawAngle;
  return captureFrameFromVideo(video, mount, false, screenAngle);
}

/** Preview box is always portrait; mount only affects save-time rotation. */
export function previewAspectClass(_mount?: MountOrientation): string {
  return "aspect-[3/4]";
}
