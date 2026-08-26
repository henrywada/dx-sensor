import { frameDiffScore } from "@/lib/change-detection/frameDiff";
import { estimateCostYen, extractTokenUsage } from "@/lib/image-analysis/estimateCostYen";
import type { VisionAnalyzeResult } from "@/lib/image-analysis/types";
import { buildMonitorPrompt } from "./buildMonitorPrompt";
import { classifyDiffScore } from "./thresholds";
import type { MonitorSeverity } from "./types";

export type MonitorTickRequest = {
  prevCaptureId: string | null;
  title: string;
  email: string | null;
  labels: string[];
  slotValues: string[];
};

export type MonitorTickResponse = {
  status: "waiting" | "baseline" | "processed";
  severity: MonitorSeverity | null;
  diffScore: number | null;
  prevCaptureId: string | null;
  currCaptureId: string | null;
  prevCaptureNo: number | null;
  currCaptureNo: number | null;
  prevSignedUrl: string | null;
  currSignedUrl: string | null;
  summary: string | null;
  eventId: string | null;
  message?: string;
};

export type MonitorCapture = {
  id: string;
  storagePath: string;
};

export type DownloadedCapture = {
  buffer: Buffer;
  mimeType: string;
};

export class MonitorTickError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export type AnalyzeMonitorImagesInput = {
  prompt: string;
  imageBuffer: Buffer;
  mimeType: string;
  previousImageBuffer: Buffer;
  previousMimeType: string;
};

export type LogAnalysisRunInput = {
  provider: "gemini";
  estimatedCostYen: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type InsertMonitorChangeEventInput = {
  prevCaptureId: string;
  currCaptureId: string;
  diffScore: number;
  severity: MonitorSeverity;
  summary: string;
  emailQueued: boolean;
};

export type RunMonitorTickDeps = {
  getNextUnprocessedCapture: (excludeId: string | null) => Promise<MonitorCapture | null>;
  getCaptureById: (id: string) => Promise<MonitorCapture | null>;
  getCaptureOrdinal: (id: string) => Promise<number | null>;
  markCaptureProcessed: (id: string) => Promise<void>;
  downloadCapture: (storagePath: string) => Promise<DownloadedCapture>;
  createSignedUrl: (storagePath: string) => Promise<string | null>;
  diffScore?: (prev: Buffer, curr: Buffer) => Promise<number>;
  analyzeImages: (input: AnalyzeMonitorImagesInput) => Promise<VisionAnalyzeResult>;
  insertChangeEvent: (input: InsertMonitorChangeEventInput) => Promise<string>;
  logAnalysisRun: (input: LogAnalysisRunInput) => Promise<void>;
};

export async function runMonitorTick(
  request: MonitorTickRequest,
  deps: RunMonitorTickDeps
): Promise<MonitorTickResponse> {
  const currCapture = await deps.getNextUnprocessedCapture(request.prevCaptureId);
  if (!currCapture) {
    return {
      status: "waiting",
      severity: null,
      diffScore: null,
      prevCaptureId: request.prevCaptureId,
      currCaptureId: null,
      prevCaptureNo: request.prevCaptureId
        ? await deps.getCaptureOrdinal(request.prevCaptureId)
        : null,
      currCaptureNo: null,
      prevSignedUrl: null,
      currSignedUrl: null,
      summary: null,
      eventId: null,
      message: "未処理の画像はありません",
    };
  }

  const currSignedUrl = await deps.createSignedUrl(currCapture.storagePath);
  const currCaptureNo = await deps.getCaptureOrdinal(currCapture.id);

  if (!request.prevCaptureId) {
    await deps.markCaptureProcessed(currCapture.id);
    return {
      status: "baseline",
      severity: "skip",
      diffScore: null,
      prevCaptureId: null,
      currCaptureId: currCapture.id,
      prevCaptureNo: null,
      currCaptureNo,
      prevSignedUrl: null,
      currSignedUrl,
      summary: null,
      eventId: null,
      message: "初回画像を基準画像として登録しました",
    };
  }

  const prevCapture = await deps.getCaptureById(request.prevCaptureId);
  if (!prevCapture) {
    throw new MonitorTickError("前回画像が見つかりません", 404);
  }

  const [prevFile, currFile, prevSignedUrl, prevCaptureNo] = await Promise.all([
    deps.downloadCapture(prevCapture.storagePath),
    deps.downloadCapture(currCapture.storagePath),
    deps.createSignedUrl(prevCapture.storagePath),
    deps.getCaptureOrdinal(prevCapture.id),
  ]);

  const diffScore = await (deps.diffScore ?? frameDiffScore)(
    prevFile.buffer,
    currFile.buffer
  );
  const severity = classifyDiffScore(diffScore);

  if (severity === "skip") {
    const eventId = await deps.insertChangeEvent({
      prevCaptureId: prevCapture.id,
      currCaptureId: currCapture.id,
      diffScore,
      severity,
      summary: "変化が小さいため通知対象外です（処理は実行済み）",
      emailQueued: false,
    });
    await deps.markCaptureProcessed(currCapture.id);
    return {
      status: "processed",
      severity,
      diffScore,
      prevCaptureId: prevCapture.id,
      currCaptureId: currCapture.id,
      prevCaptureNo,
      currCaptureNo,
      prevSignedUrl,
      currSignedUrl,
      summary: null,
      eventId,
      message: "変化が小さいため通知対象外です",
    };
  }

  const prompt = buildMonitorPrompt({
    title: request.title,
    labels: request.labels,
    values: request.slotValues,
  });
  const analysis = await deps.analyzeImages({
    prompt,
    previousImageBuffer: prevFile.buffer,
    previousMimeType: prevFile.mimeType,
    imageBuffer: currFile.buffer,
    mimeType: currFile.mimeType,
  });
  const eventId = await deps.insertChangeEvent({
    prevCaptureId: prevCapture.id,
    currCaptureId: currCapture.id,
    diffScore,
    severity,
    summary: analysis.text,
    emailQueued: severity === "notify" && Boolean(request.email?.trim()),
  });

  const usage = extractTokenUsage("gemini", analysis.raw);
  await deps.logAnalysisRun({
    provider: "gemini",
    estimatedCostYen: estimateCostYen("gemini", analysis.raw),
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  });

  await deps.markCaptureProcessed(currCapture.id);
  return {
    status: "processed",
    severity,
    diffScore,
    prevCaptureId: prevCapture.id,
    currCaptureId: currCapture.id,
    prevCaptureNo,
    currCaptureNo,
    prevSignedUrl,
    currSignedUrl,
    summary: analysis.text,
    eventId,
  };
}
