export type MountOrientation = "portrait" | "landscape";

export function readScreenAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation?.angle != null) {
    return screen.orientation.angle;
  }
  if (typeof window !== "undefined" && typeof window.orientation === "number") {
    return window.orientation;
  }
  return 0;
}

/** Clockwise rotation (degrees) applied when saving. */
export function computeCaptureRotationDeg(
  mount: MountOrientation,
  videoWidth: number,
  videoHeight: number,
  screenAngle: number
): number {
  if (!videoWidth || !videoHeight) return 0;

  const streamIsLandscape = videoWidth > videoHeight;
  const wantLandscape = mount === "landscape";

  if (wantLandscape === streamIsLandscape) return 0;

  if (wantLandscape) {
    return screenAngle === 270 ? 270 : 90;
  }

  return screenAngle === 270 ? 90 : 270;
}

export function captureFrameFromVideo(
  video: HTMLVideoElement,
  mount: MountOrientation
): HTMLCanvasElement {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const rotation = computeCaptureRotationDeg(
    mount,
    videoWidth,
    videoHeight,
    readScreenAngle()
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

export function previewAspectClass(mount: MountOrientation): string {
  return mount === "landscape" ? "aspect-video" : "aspect-[3/4]";
}
