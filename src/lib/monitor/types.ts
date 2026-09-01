export type MonitorSeverity = "skip" | "minor" | "notify";

export type MonitorSlot = { label: string; default_value: string };

export type SystemMonitorTemplate = {
  id: string;
  title: string;
  /** 一覧に出すシーン概要（1〜2文） */
  summary: string;
  slots: MonitorSlot[]; // length 11（最後の1枠は出力フォーマットのサンプル文型用）
};

export type MonitorUserSettings = {
  title: string;
  email: string | null;
  slotLabels: string[]; // length 11（最後の1枠は出力フォーマットのサンプル文型用）
  slotValues: string[]; // length 11
  templateId: string | null;
};
