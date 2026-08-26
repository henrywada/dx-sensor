# スマホ定点監視の解析（capture_auto_analyze）設計

**Date:** 2026-08-26  
**Status:** Approved  
**Route:** `/capture_auto_analyze` → `src/app/(tenant)/capture_auto_analyze/`

## Summary

`/capture_auto` で蓄積した `auto_captures` を、ブラウザを開いている間だけ間隔実行で監視・差分判定・Gemini 解析するテナント画面。設定はユーザ単位で保存。実メール送信は v1 対象外（通知キューまで）。

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| 監視実行場所 | ブラウザ内（画面オープン中のみ） |
| 処理の実体 | サーバ API（クライアントは timer + UI） |
| 画像表示タブ | 全部 / 今回の監視分 の切替（C） |
| ランプ意味 | A: 緑=skip、黄=minor、赤=notify |
| メール | v1 は記録＋`email_queued` まで（実送信なし） |
| 解析 API | Gemini 固定 |
| 設定スコープ | ユーザ単位（`auth.uid()`） |
| TOP 導線 | 「スマホ監視カメラ」に「監視分析を見る」カード |

## Screen behavior

### Entry

- TOP「スマホ監視カメラ」カテゴリにカード追加（`/capture_auto` の下）
- 要ログイン。`auto_captures` は本人・所属テナントの既存 RLS に従う

### Tabs

1. **監視条件の設定**
2. **監視状況**
3. **画像表示**

「監視の開始」成功後はタブ2へ自動切替。監視中は開始ボタンを停止に切替可能。

### Tab 1 — 監視条件の設定

1. 右寄せアイコン: システムテンプレート一覧モーダル → 選択でタイトル＋10スロット値を流し込み
2. タイトル（テキスト）
3. メールアドレス（空欄なら通知対象にしない）
4. 設定値テキストBOX ×10（各行: テンプレ由来ラベル＋編集可能な値）
5. 右寄せ「テンプレート保存」: タイトル・10値・メールを `monitor_user_settings` に保存。次回起動時の初期値
6. 中央「監視の開始」: 監視 ON → 状況タブへ

スロットの**ラベル**はテンプレ由来（ユーザ編集は v1 対象外）。**値**のみ編集・保存。

### Tab 2 — 監視状況

1. 比較画像2枚（prev / curr）。tick ごとに更新
2. ランプ 緑・黄・赤を横並び。最新 severity で1つのみ点灯
3. 直近イベントの簡易リスト（時刻・severity・AI要約1行）

### Tab 3 — 画像表示

- フィルタ: **全部** / **今回の監視分**（監視開始以降に `processed_at` が付いたもの）
- `auto_captures` グリッド（署名 URL）
- タップ拡大は v1 任意（無くても可）

## Data model

### `monitor_system_templates`

v1 は DB テーブルではなく **コード定数**（`src/lib/monitor/systemTemplates.ts`）で配布する。駐車場例を1件以上。将来 DB 化する場合は同スキーマへ移行可能。

各テンプレ: `{ id, title, slots: [{ label, default_value }] }`（slots 長さ10）。

### `monitor_user_settings`

| Column | Notes |
|--------|--------|
| user_id | uuid PK → auth.users |
| title | text |
| email | text nullable |
| slot_values | jsonb: string[10] |
| template_id | text nullable（コード定数テンプレの id） |
| updated_at | timestamptz |

RLS: `user_id = auth.uid()` のみ。

### `monitor_change_events`

| Column | Notes |
|--------|--------|
| id | uuid |
| user_id | uuid |
| tenant_id | uuid（auto_captures と揃える） |
| prev_capture_id | uuid → auto_captures |
| curr_capture_id | uuid → auto_captures |
| diff_score | numeric |
| severity | text: `skip` \| `minor` \| `notify`（skip 行は任意・通常は作らない） |
| ai_summary | text nullable |
| email_queued | boolean default false |
| created_at | timestamptz |

RLS: 本人のみ select/insert。

### `auto_captures` 拡張

- `processed_at timestamptz null` を追加
- 未処理 = `processed_at IS NULL`
- `/capture_auto` 起動時の本人データ削除は現状どおり（監視設定は別テーブルのため残る）

## Diff thresholds

既存 `frameDiffScore`（0〜1）を利用。

| Score | Severity | Behavior | Lamp |
|-------|----------|----------|------|
| `< 0.02` | skip | 記録なし（または軽量ログ）。`processed_at` 付与 | 緑 |
| `0.02`〜`< 0.08` | minor | Gemini 解析 → event（email_queued=false） | 黄 |
| `≥ 0.08` | notify | Gemini 解析 → event。email 設定時のみ email_queued=true | 赤 |

閾値はサーバ定数（環境変数で上書き可にする余地あり）。

## Monitoring loop & APIs

### Client

- 開始で `monitoring=true`、既定間隔 **10秒**（v1 は固定で可）
- 各 tick: `POST /api/monitor/tick`
- 停止またはページ離脱で interval 解除
- 未処理なし: 緑＋「待機中」

### `POST /api/monitor/tick`

認証必須。自分の `auto_captures` のみ。

1. セッション基準画像（前回処理した curr）と次の未処理1枚を取得
2. Storage `auto-captures` から download
3. `frameDiffScore`
4. skip / minor / notify 分岐（上記表）
5. Gemini: タイトル＋スロット10行（`ラベル: 値`）＋「2枚比較・監視/通知ポイントに沿って日本語で簡潔に」
6. コスト: 既存 `image_analysis_runs` に provider=`gemini` で記録。`capture_id` は現状 `manual_captures` FK のため **auto 経路では null**（トークン・概算円は記録する）
7. curr に `processed_at=now()`
8. Response: `{ severity, diffScore, prevSignedUrl, currSignedUrl, summary, eventId }`

基準画像が無い初回: 最古の未処理を基準として `processed_at` のみ付与し、解析スキップ（緑）。

### Other APIs

| Method | Path | Role |
|--------|------|------|
| GET | `/api/monitor/settings` | ユーザ設定読込 |
| PUT | `/api/monitor/settings` | ユーザ設定保存 |
| GET | `/api/monitor/templates` | システムテンプレ一覧 |
| GET | `/api/monitor/events` | 直近イベント（状況タブ） |

## File plan

| Path | Role |
|------|------|
| `src/app/(tenant)/capture_auto_analyze/page.tsx` | 認証・ページ |
| `src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx` | 3タブ UI |
| `src/app/api/monitor/tick/route.ts` | 監視1ステップ |
| `src/app/api/monitor/settings/route.ts` | 設定 CRUD |
| `src/app/api/monitor/templates/route.ts` | テンプレ一覧 |
| `src/app/api/monitor/events/route.ts` | イベント一覧 |
| `src/lib/monitor/` | プロンプト組み立て・閾値・型 |
| `supabase/migrations/0012_monitor_analyze.sql` | テーブル＋`processed_at`＋RLS |
| `src/app/(tenant)/page.tsx` | TOP カード |

## Out of scope (v1)

- 実メール送信（Resend 等）
- 画面クローズ後の継続監視 / Cron
- スロットラベルのユーザ編集
- 監視間隔の UI 変更（固定10秒）
- Claude / GPT プロバイダ選択

## Testing

- 未処理0枚: tick が待機・緑
- 差なし連続: skip・緑・processed_at 進む
- 中程度の差: Gemini 呼び出し・黄・event minor
- 大きい差＋メール空: notify だが email_queued=false・赤
- 大きい差＋メールあり: email_queued=true
- 設定保存→再読込で初期値復元
- システムテンプレ適用で10枠が埋まる
- TOP から `/capture_auto_analyze` 到達
- 非ログインは `/login` へ

## Open points (resolved in chat)

なし。実装前にスペック承認のみ待ち。
