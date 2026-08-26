import type { MonitorSeverity } from "./types";

export const DIFF_SKIP_BELOW = 0.02;
export const DIFF_NOTIFY_AT = 0.08;

export function classifyDiffScore(score: number): MonitorSeverity {
  if (score < DIFF_SKIP_BELOW) return "skip";
  if (score < DIFF_NOTIFY_AT) return "minor";
  return "notify";
}
