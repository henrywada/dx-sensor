import { describe, expect, it } from "vitest";
import {
  LANDSCAPE_LEFT_TILT_SCREEN_ANGLE,
  computeCaptureRotationDeg,
  detectHandheldMount,
  mountFromDeviceTilt,
  resolveHandheldMount,
} from "./captureFrameFromVideo";

describe("detectHandheldMount", () => {
  it("treats 90 and 270 as landscape even if the viewport is still portrait", () => {
    expect(detectHandheldMount(90, false)).toBe("landscape");
    expect(detectHandheldMount(270, false)).toBe("landscape");
    expect(detectHandheldMount(-90, false)).toBe("landscape");
  });

  it("falls back to viewport when the screen angle is upright", () => {
    expect(detectHandheldMount(0, false)).toBe("portrait");
    expect(detectHandheldMount(0, true)).toBe("landscape");
    expect(detectHandheldMount(180, false)).toBe("portrait");
  });
});

describe("mountFromDeviceTilt", () => {
  it("treats |gamma| >= 45 as landscape even when the screen stays portrait", () => {
    expect(mountFromDeviceTilt(-90, 0)).toBe("landscape");
    expect(mountFromDeviceTilt(90, 0)).toBe("landscape");
    expect(mountFromDeviceTilt(-45, 10)).toBe("landscape");
  });

  it("treats small gamma as portrait", () => {
    expect(mountFromDeviceTilt(0, 90)).toBe("portrait");
    expect(mountFromDeviceTilt(20, 80)).toBe("portrait");
  });

  it("returns null when lying flat or gamma is missing", () => {
    expect(mountFromDeviceTilt(null, 0)).toBeNull();
    expect(mountFromDeviceTilt(5, 5)).toBeNull();
  });
});

describe("resolveHandheldMount", () => {
  it("prefers device tilt over a portrait-locked screen", () => {
    expect(
      resolveHandheldMount({
        screenAngle: 0,
        viewportIsLandscape: false,
        screenOrientationType: "portrait-primary",
        deviceTiltMount: "landscape",
      })
    ).toBe("landscape");
  });

  it("prefers live viewport over a stale landscape screen.orientation.type", () => {
    expect(
      resolveHandheldMount({
        screenAngle: 0,
        viewportIsLandscape: false,
        screenOrientationType: "landscape-primary",
      })
    ).toBe("portrait");
  });

  it("prefers device tilt portrait over a lagging landscape viewport", () => {
    expect(
      resolveHandheldMount({
        screenAngle: 90,
        viewportIsLandscape: true,
        screenOrientationType: "landscape-primary",
        deviceTiltMount: "portrait",
      })
    ).toBe("portrait");
  });
});

describe("computeCaptureRotationDeg", () => {
  it("keeps portrait stream as-is for upright mount", () => {
    expect(computeCaptureRotationDeg("portrait", 1080, 1920, 0)).toBe(0);
  });

  it("keeps landscape stream as-is for sideways mount", () => {
    expect(computeCaptureRotationDeg("landscape", 1920, 1080, 90)).toBe(0);
  });

  it("defaults landscape mount to left-tilt bake (270° CW)", () => {
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 0)).toBe(270);
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 270)).toBe(270);
  });

  it("uses 90° when device reports right tilt (angle 90)", () => {
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 90)).toBe(90);
  });

  it("handheld landscape always bakes left-tilt even if the device reports 90", () => {
    const mount = detectHandheldMount(90, false);
    expect(
      computeCaptureRotationDeg(mount, 1080, 1920, LANDSCAPE_LEFT_TILT_SCREEN_ANGLE)
    ).toBe(270);
  });

  it("rotates landscape stream to portrait for upright mount", () => {
    expect(computeCaptureRotationDeg("portrait", 1920, 1080, 0)).toBe(90);
    expect(computeCaptureRotationDeg("portrait", 1920, 1080, 90)).toBe(270);
  });

  it("inverts rotation direction when requested", () => {
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 0, true)).toBe(90);
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 90, true)).toBe(270);
  });
});
