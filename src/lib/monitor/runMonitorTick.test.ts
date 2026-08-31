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
    getZones: vi.fn(async () => []),
    analyzeImages: vi.fn(async () => ({
      text: "変化があります",
      raw: {},
      model: "gemini-2.5-flash",
    })),
    insertChangeEvent: vi.fn(async () => "event-id"),
    logAnalysisRun: vi.fn(async () => undefined),
    deleteCaptureIfUnreferenced: vi.fn(async () => false),
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
      deleteCaptureIfUnreferenced: vi.fn(async () => true),
    });

    const result = await runMonitorTick(REQUEST, deps);

    expect(result).toMatchObject({
      status: "processed",
      severity: "skip",
      diffScore: 0.01,
      prevCaptureId: "prev-capture",
      currCaptureId: "curr-capture",
      // 削除された前回画像は、署名URL（壊れたリンクになる）の代わりに
      // 既にダウンロード済みのバイト列をdata URIとして埋め込んで返す。
      prevSignedUrl: `data:image/jpeg;base64,${Buffer.from("image").toString("base64")}`,
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
        analysisTool: "sharp+SSIM+pixelmatch",
      })
    );
    expect(deps.logAnalysisRun).not.toHaveBeenCalled();
    expect(deps.deleteCaptureIfUnreferenced).toHaveBeenCalledWith("prev-capture");
  });

  it("keeps the previous image URL when deletion did not actually remove it", async () => {
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
      deleteCaptureIfUnreferenced: vi.fn(async () => false),
    });

    const result = await runMonitorTick(REQUEST, deps);

    expect(result).toMatchObject({
      severity: "skip",
      prevSignedUrl: "signed:tenant/day/prev.jpg",
    });
  });

  it("analyzes but keeps both capture photos for minor (non-notified) diffs", async () => {
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
        text: JSON.stringify({ severity: "minor", summary: "軽微な変化があります" }),
        raw: {},
        model: "gemini-2.5-flash",
      })),
    });

    const result = await runMonitorTick(REQUEST, deps);

    expect(result).toMatchObject({
      status: "processed",
      severity: "minor",
      summary: "軽微な変化があります",
      eventId: "event-id",
      prevSignedUrl: "signed:tenant/day/prev.jpg",
    });
    expect(deps.insertChangeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "minor",
        summary: "軽微な変化があります",
        analysisTool: "sharp+SSIM+pixelmatch → Gemini Vision API (gemini-2.5-flash)",
      })
    );
    expect(deps.markCaptureProcessed).toHaveBeenCalledWith("curr-capture");
    // 軽微な変化はGemini解析まで進んだ判定なので、比較表示用に両方の画像を残す
    // （通知対象と同じ扱い。削除するのはskip判定の画像だけ）。
    expect(deps.deleteCaptureIfUnreferenced).not.toHaveBeenCalled();
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
        text: JSON.stringify({ severity: "notify", summary: "大きな変化があります" }),
        raw: {
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 20,
          },
        },
        model: "gemini-2.5-flash",
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
        analysisTool: "sharp+SSIM+pixelmatch → Gemini Vision API (gemini-2.5-flash)",
      })
    );
    expect(deps.markCaptureProcessed).toHaveBeenCalledWith("curr-capture");
    expect(deps.deleteCaptureIfUnreferenced).not.toHaveBeenCalled();
  });

  it("uses Gemini's severity judgment even when it disagrees with the pixel diff score (bug: count changes labeled minor)", async () => {
    // 再現ケース: diffScore=0.0354はDIFF_NOTIFY_AT(0.08)未満なのでpixel差分だけなら
    // "minor"になるが、Geminiが「貝殻の数が2個から1個に変化」のような意味のある
    // 変化を検出しnotifyと判定した場合は、そちらを最終ラベルとして採用すべき。
    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
      getCaptureById: vi.fn(async () => ({
        id: "prev-capture",
        storagePath: "tenant/day/prev.jpg",
      })),
      diffScore: vi.fn(async () => 0.0354),
      analyzeImages: vi.fn(async () => ({
        text: JSON.stringify({
          severity: "notify",
          summary: "貝殻の数が2個から1個に変化しました。",
        }),
        raw: {},
        model: "gemini-2.5-flash",
      })),
    });

    const result = await runMonitorTick(
      { ...REQUEST, email: "notify@example.com" },
      deps
    );

    expect(result).toMatchObject({
      severity: "notify",
      summary: "貝殻の数が2個から1個に変化しました。",
    });
    expect(deps.insertChangeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "notify", emailQueued: true })
    );
  });

  it("falls back to the pixel diff severity when Gemini's response is not valid structured JSON", async () => {
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
        text: "自由文の応答（JSONではない）",
        raw: {},
        model: "gemini-2.5-flash",
      })),
    });

    const result = await runMonitorTick(REQUEST, deps);

    expect(result).toMatchObject({
      severity: "minor",
      summary: "自由文の応答（JSONではない）",
    });
  });

  it("監視ゾーンが設定されていれば、切り出した画像でdiffScoreとanalyzeImagesを呼ぶ", async () => {
    const zones = [{ x: 0, y: 0, width: 0.5, height: 0.5 }];
    const croppedPrev = Buffer.from("cropped-prev");
    const croppedCurr = Buffer.from("cropped-curr");
    const cropToZones = vi.fn(async (buffer: Buffer) =>
      buffer.toString() === "prev-image" ? croppedPrev : croppedCurr
    );

    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
      getCaptureById: vi.fn(async () => ({
        id: "prev-capture",
        storagePath: "tenant/day/prev.jpg",
      })),
      downloadCapture: vi.fn(async (storagePath: string) => ({
        buffer: Buffer.from(storagePath.includes("prev") ? "prev-image" : "curr-image"),
        mimeType: "image/jpeg",
      })),
      getZones: vi.fn(async () => zones),
      cropToZones,
      diffScore: vi.fn(async () => 0.08),
    });

    await runMonitorTick(REQUEST, deps);

    expect(cropToZones).toHaveBeenCalledWith(Buffer.from("prev-image"), zones);
    expect(cropToZones).toHaveBeenCalledWith(Buffer.from("curr-image"), zones);
    expect(deps.diffScore).toHaveBeenCalledWith(croppedPrev, croppedCurr);
    expect(deps.analyzeImages).toHaveBeenCalledWith(
      expect.objectContaining({
        previousImageBuffer: croppedPrev,
        imageBuffer: croppedCurr,
        previousMimeType: "image/png",
        mimeType: "image/png",
      })
    );
  });

  it("監視ゾーンが無ければ元の画像でdiffScoreとanalyzeImagesを呼ぶ", async () => {
    const cropToZones = vi.fn();
    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
      getCaptureById: vi.fn(async () => ({
        id: "prev-capture",
        storagePath: "tenant/day/prev.jpg",
      })),
      getZones: vi.fn(async () => []),
      cropToZones,
      diffScore: vi.fn(async () => 0.08),
    });

    await runMonitorTick(REQUEST, deps);

    expect(cropToZones).not.toHaveBeenCalled();
    expect(deps.diffScore).toHaveBeenCalledWith(
      Buffer.from("image"),
      Buffer.from("image")
    );
  });
});
