export type MountOrientation = "portrait" | "landscape";

/** Clockwise degrees applied when saving a frame. */
export type CaptureRotationDeg = 0 | 90 | 180 | 270;

export function readScreenAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation?.angle != null) {
    return screen.orientation.angle;
  }
  if (typeof window !== "undefined" && typeof window.orientation === "number") {
    return window.orientation;
  }
  return 0;
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
  invertDirection = false
): HTMLCanvasElement {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const rotation = computeCaptureRotationDeg(
    mount,
    videoWidth,
    videoHeight,
    readScreenAngle(),
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

/** Preview box is always portrait; mount only affects save-time rotation. */
export function previewAspectClass(_mount?: MountOrientation): string {
  return "aspect-[3/4]";
}
