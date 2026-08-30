-- 0025_monitor_change_events_analysis_tool.sql
-- イベント履歴に「どの解析ツールで判定したか」を記録する
-- （例: "sharp" のみ / "sharp → Gemini Vision API (gemini-2.5-flash)"）。
alter table monitor_change_events
  add column if not exists analysis_tool text;
