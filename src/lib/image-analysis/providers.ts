import type { VisionProviderId, VisionProviderMeta } from "./types";

export type { VisionProviderId, VisionProviderMeta };

export const VISION_PROVIDER_IDS = [
  "claude",
  "gpt-4o",
  "gpt-5",
  "gemini",
  "plate-recognizer",
] as const satisfies readonly VisionProviderId[];

export const VISION_PROVIDERS: VisionProviderMeta[] = [
  { id: "claude", label: "Claude Vision", requiresPrompt: true },
  { id: "gpt-4o", label: "GPT-4o", requiresPrompt: true },
  { id: "gpt-5", label: "GPT-5 系", requiresPrompt: true },
  { id: "gemini", label: "Gemini", requiresPrompt: true },
  { id: "plate-recognizer", label: "Plate Recognizer（ANPR）", requiresPrompt: false },
];

export function isVisionProviderId(id: string): id is VisionProviderId {
  return (VISION_PROVIDER_IDS as readonly string[]).includes(id);
}

export function getProviderMeta(id: string): VisionProviderMeta | null {
  if (!isVisionProviderId(id)) return null;
  return VISION_PROVIDERS.find((provider) => provider.id === id) ?? null;
}
