import { describe, expect, it } from "vitest";
import { computeThumbnailSize, THUMBNAIL_MAX_EDGE_PX } from "./createThumbnailBlob";

describe("computeThumbnailSize", () => {
  it("scales down a landscape image so the long edge matches maxEdgePx", () => {
    expect(computeThumbnailSize(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
  });

  it("scales down a portrait image so the long edge matches maxEdgePx", () => {
    expect(computeThumbnailSize(1080, 1920, 640)).toEqual({ width: 360, height: 640 });
  });

  it("scales down a square image proportionally", () => {
    expect(computeThumbnailSize(1000, 1000, 640)).toEqual({ width: 640, height: 640 });
  });

  it("does not upscale images already smaller than maxEdgePx", () => {
    expect(computeThumbnailSize(320, 240, 640)).toEqual({ width: 320, height: 240 });
  });

  it("defaults to THUMBNAIL_MAX_EDGE_PX when maxEdgePx is omitted", () => {
    const result = computeThumbnailSize(1920, 1080);
    expect(Math.max(result.width, result.height)).toBe(THUMBNAIL_MAX_EDGE_PX);
  });

  it("never returns a zero dimension for extreme aspect ratios", () => {
    const result = computeThumbnailSize(4000, 1, 640);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
