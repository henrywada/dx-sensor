import { describe, expect, it } from "vitest";
import { computeCaptureRotationDeg } from "./captureFrameFromVideo";

describe("computeCaptureRotationDeg", () => {
  it("returns 0 when stream shape already matches portrait mount", () => {
    expect(computeCaptureRotationDeg("portrait", 1080, 1920, 0)).toBe(0);
  });

  it("returns 0 when stream shape already matches landscape mount", () => {
    expect(computeCaptureRotationDeg("landscape", 1920, 1080, 90)).toBe(0);
  });

  it("rotates portrait stream to landscape for sideways mount", () => {
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 90)).toBe(90);
    expect(computeCaptureRotationDeg("landscape", 1080, 1920, 270)).toBe(270);
  });

  it("rotates landscape stream to portrait for upright mount", () => {
    expect(computeCaptureRotationDeg("portrait", 1920, 1080, 0)).toBe(270);
    expect(computeCaptureRotationDeg("portrait", 1920, 1080, 270)).toBe(90);
  });
});
