import { describe, expect, it, vi } from "vitest";
import {
  type MonitorTickRequest,
  runMonitorTick,
  type RunMonitorTickDeps,
} from "./runMonitorTick";

const REQUEST: MonitorTickRequest = {
  prevCaptureId: "prev-capture",
  title: "定点監視",
  email: null,
  labels: ["監視ポイント"],
  slotValues: ["前後で変化した点"],
};

function createDeps(overrides: Partial<RunMonitorTickDeps> = {}): RunMonitorTickDeps {
  return {
    getNextUnprocessedCapture: vi.fn(async () => null),
    getCaptureById: vi.fn(async () => null),
    getCaptureOrdinal: vi.fn(async () => 1),
    markCaptureProcessed: vi.fn(async () => undefined),
    downloadCapture: vi.fn(async () => ({
      buffer: Buffer.from("image"),
      mimeType: "image/jpeg",
    })),
    createSignedUrl: vi.fn(async (storagePath: string) => `signed:${storagePath}`),
    diffScore: vi.fn(async () => 0),
    analyzeImages: vi.fn(async () => ({ text: "変化があります", raw: {} })),
    insertChangeEvent: vi.fn(async () => "event-id"),
    logAnalysisRun: vi.fn(async () => undefined),
    deleteCaptureIfUnreferenced: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("runMonitorTick", () => {
  it("returns waiting when no unprocessed capture exists", async () => {
    const deps = createDeps();

    const result = await runMonitorTick(REQUEST, deps);

    expect(result).toMatchObject({
      status: "waiting",
      severity: null,
      diffScore: null,
      currCaptureId: null,
      eventId: null,
    });
    expect(deps.markCaptureProcessed).not.toHaveBeenCalled();
    expect(deps.analyzeImages).not.toHaveBeenCalled();
    expect(deps.deleteCaptureIfUnreferenced).not.toHaveBeenCalled();
  });

  it("marks first capture as baseline when prevCaptureId is null", async () => {
    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
    });

    const result = await runMonitorTick(
      { ...REQUEST, prevCaptureId: null },
      deps
    );

    expect(result).toMatchObject({
      status: "baseline",
      severity: "skip",
      prevCaptureId: null,
      currCaptureId: "curr-capture",
      currSignedUrl: "signed:tenant/day/curr.jpg",
      eventId: null,
    });
    expect(deps.markCaptureProcessed).toHaveBeenCalledWith("curr-capture");
    expect(deps.downloadCapture).not.toHaveBeenCalled();
    expect(deps.insertChangeEvent).not.toHaveBeenCalled();
    expect(deps.deleteCaptureIfUnreferenced).not.toHaveBeenCalled();
  });

  it("marks processed and logs skip for tiny diffs", async () => {
    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
      getCaptureById: vi.fn(async () => ({
        id: "prev-capture",
        storagePath: "tenant/day/prev.jpg",
      })),
      diffScore: vi.fn(async () => 0.01),
      insertChangeEvent: vi.fn(async () => "skip-event-id"),
    });

    const result = await runMonitorTick(REQUEST, deps);

    expect(result).toMatchObject({
      status: "processed",
      severity: "skip",
      diffScore: 0.01,
      prevCaptureId: "prev-capture",
      currCaptureId: "curr-capture",
      prevSignedUrl: "signed:tenant/day/prev.jpg",
      currSignedUrl: "signed:tenant/day/curr.jpg",
      eventId: "skip-event-id",
    });
    expect(deps.markCaptureProcessed).toHaveBeenCalledWith("curr-capture");
    expect(deps.analyzeImages).not.toHaveBeenCalled();
    expect(deps.insertChangeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "skip",
        diffScore: 0.01,
        emailQueued: false,
      })
    );
    expect(deps.logAnalysisRun).not.toHaveBeenCalled();
    expect(deps.deleteCaptureIfUnreferenced).toHaveBeenCalledWith("prev-capture");
  });

  it("analyzes and deletes the previous capture for minor (non-notified) diffs", async () => {
    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
      getCaptureById: vi.fn(async () => ({
        id: "prev-capture",
        storagePath: "tenant/day/prev.jpg",
      })),
      diffScore: vi.fn(async () => 0.05),
      analyzeImages: vi.fn(async () => ({
        text: "軽微な変化があります",
        raw: {},
      })),
    });

    const result = await runMonitorTick(REQUEST, deps);

    expect(result).toMatchObject({
      status: "processed",
      severity: "minor",
      eventId: "event-id",
    });
    expect(deps.insertChangeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "minor" })
    );
    expect(deps.markCaptureProcessed).toHaveBeenCalledWith("curr-capture");
    expect(deps.deleteCaptureIfUnreferenced).toHaveBeenCalledWith("prev-capture");
  });

  it("analyzes, logs cost, and queues email for notify diffs with an email", async () => {
    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
      getCaptureById: vi.fn(async () => ({
        id: "prev-capture",
        storagePath: "tenant/day/prev.jpg",
      })),
      diffScore: vi.fn(async () => 0.08),
      analyzeImages: vi.fn(async () => ({
        text: "大きな変化があります",
        raw: {
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 20,
          },
        },
      })),
    });

    const result = await runMonitorTick(
      { ...REQUEST, email: "notify@example.com" },
      deps
    );

    expect(result).toMatchObject({
      status: "processed",
      severity: "notify",
      summary: "大きな変化があります",
      eventId: "event-id",
    });
    expect(deps.analyzeImages).toHaveBeenCalledWith(
      expect.objectContaining({
        previousImageBuffer: expect.any(Buffer),
        imageBuffer: expect.any(Buffer),
      })
    );
    expect(deps.logAnalysisRun).toHaveBeenCalledWith({
      provider: "gemini",
      estimatedCostYen: 0.002,
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(deps.insertChangeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "notify",
        emailQueued: true,
      })
    );
    expect(deps.markCaptureProcessed).toHaveBeenCalledWith("curr-capture");
    expect(deps.deleteCaptureIfUnreferenced).not.toHaveBeenCalled();
  });
});
