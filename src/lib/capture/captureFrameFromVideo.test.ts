import { describe, expect, it } from "vitest";
import { computeCaptureRotationDeg } from "./captureFrameFromVideo";

describe("computeCaptureRotationDeg", () => {
  it("keeps portrait stream as-is for upright mount", () => {
    expect(computeCaptureRotationDeg("portrait", 1080, 1920, 0)).toBe(0);
  });

  it("keeps landscape stream as-is for sideways mount", () => {
    expect(computeCaptureRotationDeg("landscape", 1920, 1080, 90)).toBe(0);
  });

  it("rotates portrait stream to landscape for sideways mount", () => {
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 90)).toBe(90);
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 270)).toBe(270);
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 0)).toBe(90);
  });

  it("rotates landscape stream to portrait for upright mount", () => {
    expect(computeCaptureRotationDeg("portrait", 1920, 1080, 0)).toBe(270);
    expect(computeCaptureRotationDeg("portrait", 1920, 1080, 270)).toBe(90);
  });

  it("inverts rotation direction when requested", () => {
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 90, true)).toBe(270);
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 270, true)).toBe(90);
  });
});
