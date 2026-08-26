import type { SystemMonitorTemplate } from "./types";

export const SYSTEM_MONITOR_TEMPLATES: SystemMonitorTemplate[] = [
  {
    id: "parking-lot",
    title: "駐車場監視",
    slots: [
      { label: "画像全体説明", default_value: "駐車場全体" },
      { label: "駐車場所", default_value: "屋外平面駐車場" },
      { label: "監視ポイント", default_value: "各駐車スペースの空き／使用中" },
      { label: "メール通知ポイント", default_value: "空きがなくなった／空きができた" },
      { label: "スペース数", default_value: "10" },
      { label: "除外エリア", default_value: "歩行者通路・植栽" },
      { label: "時間帯メモ", default_value: "24時間" },
      { label: "天候考慮", default_value: "雨天時は反射に注意" },
      { label: "報告粒度", default_value: "スペース単位で変化があれば記載" },
      { label: "補足", default_value: "ナンバープレートは記載しない" },
    ],
  },
];
