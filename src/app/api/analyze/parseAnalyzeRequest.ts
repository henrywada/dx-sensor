import { z } from "zod";
import { VISION_PROVIDER_IDS, type VisionProviderId } from "@/lib/image-analysis/providers";

const AnalyzeRequestSchema = z.object({
  captureId: z.string().uuid(),
  provider: z.enum(VISION_PROVIDER_IDS),
  prompt: z.string().optional().default(""),
});

export interface AnalyzeRequest {
  captureId: string;
  provider: VisionProviderId;
  prompt: string;
}

export function parseAnalyzeRequest(body: unknown): AnalyzeRequest {
  return AnalyzeRequestSchema.parse(body);
}
