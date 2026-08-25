import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  DEFAULT_VISION_MAX_EDGE_PX,
  prepareVisionImage,
  resolveMaxEdgePx,
} from "./prepareVisionImage";

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("prepareVisionImage", () => {
  it("shrinks images whose longest edge exceeds the cap", async () => {
    const source = await makeJpeg(3000, 2000);
    const prepared = await prepareVisionImage(
      { imageBuffer: source, mimeType: "image/jpeg", prompt: "x" },
      { maxEdgePx: DEFAULT_VISION_MAX_EDGE_PX }
    );

    const meta = await sharp(prepared.imageBuffer).metadata();
    expect(prepared.mimeType).toBe("image/jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
      DEFAULT_VISION_MAX_EDGE_PX
    );
    expect(meta.width).toBe(1568);
    expect(meta.height).toBe(1045);
  });

  it("does not enlarge small images", async () => {
    const source = await makeJpeg(640, 480);
    const prepared = await prepareVisionImage(
      { imageBuffer: source, mimeType: "image/png", prompt: "x" },
      { maxEdgePx: DEFAULT_VISION_MAX_EDGE_PX }
    );

    const meta = await sharp(prepared.imageBuffer).metadata();
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(480);
    expect(prepared.mimeType).toBe("image/jpeg");
  });
});

describe("resolveMaxEdgePx", () => {
  it("reads vision and anpr caps from env", () => {
    expect(resolveMaxEdgePx("vision", {})).toBe(1568);
    expect(resolveMaxEdgePx("anpr", {})).toBe(2048);
    expect(resolveMaxEdgePx("vision", { VISION_MAX_EDGE_PX: "1280" })).toBe(1280);
    expect(resolveMaxEdgePx("anpr", { VISION_ANPR_MAX_EDGE_PX: "2400" })).toBe(2400);
  });
});
