export type MonitorSeverity = "skip" | "minor" | "notify";

export type MonitorSlot = { label: string; default_value: string };

export type SystemMonitorTemplate = {
  id: string;
  title: string;
  /** 一覧に出すシーン概要（1〜2文） */
  summary: string;
  slots: MonitorSlot[]; // length 10
};

export type MonitorUserSettings = {
  title: string;
  email: string | null;
  slotLabels: string[]; // length 10
  slotValues: string[]; // length 10
  templateId: string | null;
};
