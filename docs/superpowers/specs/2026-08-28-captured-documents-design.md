# 文書キャプチャ（名刺ホルダー）設計

**Date:** 2026-08-28  
**Status:** Approved  
**Routes:** `/documents/new` · `/documents` → `src/app/(tenant)/documents/`

## Summary

スマホで文書を撮影し、Vision で文字起こしした結果を確認・整理したうえで DB に保存する汎用基盤。v1 の種類は名刺（`business_card`）のみ。同じ行を `company_visible` で会社公開する。写真レポート（`picture_sends`）とは別系統。次の種類は請求書・注文書・レシート等の伝票を、種類プラグイン追加で載せる（v1 では画面もプラグインも作らない）。

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| 製品の置き方 | 案2。汎用 `captured_documents` + 種類プラグイン。名刺は最初の種類 |
| 所有 | 個人ホルダーと会社共有の両方 |
| 共有の実体 | 同一行の `company_visible`（コピーも移動もしない） |
| 編集 | 登録者本人と tenant の owner/admin。viewer は閲覧のみ。developer は全件可 |
| OCR 項目（名刺） | 氏名・会社名・役職・部署・住所・電話・FAX・Web・メール |
| 手入力（汎用列） | メモ・タグ・会った日（`context_date`） |
| 写真 | 表必須、裏任意。伝票は後から複数 `page` |
| 確定タイミング | 確認画面で直してから INSERT/UPDATE。解析時点では文書行を作らない |
| 重複 | 見える範囲で突合し、既存を開いて更新。新規行は作らない |
| 解析プロバイダ | Gemini 固定（既存 Vision 経路） |
| 写真レポート | 変更しない |

## Architecture

4 層。駐車場ロジック・ONVIF センサー・`picture_sends` には依存しない。

1. **撮影** — テナント画面のスマホカメラ。取得経路は手動撮影と同種で、`src/lib/sensors/` には置かない
2. **種類プラグイン** — 撮影枚数、OCR プロンプト、`extracted` 形、索引列への写し、重複キー、確認画面の項目。正はコード登録。DB enum は使わない
3. **文書コア** — `captured_documents` + `captured_document_images` + Storage。テナント・公開・索引列は種類を問わない
4. **画像解析** — `src/lib/image-analysis/document-ocr/`。種類プロンプトを Gemini に渡す

### Folders

| Path | Role |
|------|------|
| `src/lib/documents/` | 保存、可視範囲、突合の呼び出し、一時画像 |
| `src/lib/documents/types/business_card/` | 名刺プラグイン |
| `src/lib/image-analysis/document-ocr/` | Vision 呼び出しと JSON 正規化の入口 |
| `src/app/(tenant)/documents/` | 撮影・確認・ホルダー |
| `src/app/api/documents/analyze/route.ts` | 解析＋重複候補 |
| `src/app/api/documents/route.ts` | 確定 INSERT/UPDATE |
| `supabase/migrations/` | テーブル・RLS・Storage・`image_analysis_runs` 拡張 |

伝票（`invoice` / `purchase_order` / `receipt`）は `src/lib/documents/types/<id>/` を足し、TOP カードと `?type=` を足す。コアテーブルは増やさない。

## Screen behavior

### Entry

テナント TOP にカテゴリ「文書ホルダー」:

- 名刺を撮る → `/documents/new?type=business_card`
- 名刺ホルダー → `/documents?type=business_card`

要ログイン。v1 は `type=business_card` 以外を 404 にする。`type` 省略時は `business_card` とみなす。

### 撮影 `/documents/new`

1. 表面を撮る（既存 `/send_picture` と同様のカメラ → プレビュー）
2. 「裏面を撮る」は任意。スキップ可
3. 解析 API へ送信（表、裏があれば両方）
4. 確認画面

確認画面:

- 写真（表／裏があれば切替）
- `extracted` 各項目の編集
- メモ、タグ（チップ。空要素は捨てる）、会った日（初期値は Asia/Tokyo の当日）
- 「会社にも公開する」（初期オフ）
- 保存

重複候補があるとき: 既存の写真と項目を同じ確認画面に載せ、主ボタンは「更新する」。新規 INSERT しない。既存が他人の会社公開で、呼び出し元に UPDATE 権がなければ項目は読み取り専用。「戻る」で撮影を中止し、一時画像を消す。

### ホルダー `/documents`

グリッド。ソートは `context_date` 降順（NULL は末尾）、同日は `created_at` 降順。初回 50 件、続きは「さらに表示」。

フィルタ:

- 範囲: **自分**（`owner_user_id = me`）/ **会社公開**（`company_visible`）/ **全部**（自分の未公開 ∪ 会社公開）
- タグ（完全一致、複数は AND）
- 会った日の期間
- 検索: `title` / `counterparty` / `extracted->>'email'` の ILIKE

カード: 表サムネイル、氏名（`title`）、会社名（`counterparty`）、会った日。会社公開はバッジ。

詳細: 写真、構造化項目、メモ／タグ／会った日。編集・公開切替・削除は RLS どおり。公開オフで会社一覧から消える。行と画像は残る。削除は DB 行と Storage オブジェクト両方。

「もう一度読む」: 既存画像で再解析 → 確認してから `extracted` と索引列だけ上書き。メモ・タグ・会った日・公開フラグ・画像は維持。会った日を再解析で変えたい場合は手で直す。

### 伝票 UI（v1 対象外）

撮影を「ページを1枚ずつ追加」に差し替える。確認項目と一覧列（金額・取引日）はプラグインが決める。一覧シェル・公開・権限は共通。

## Data model

### `captured_documents`

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| tenant_id | uuid NOT NULL → tenants | |
| owner_user_id | uuid NOT NULL → auth.users | 登録者。変更不可 |
| document_type | text NOT NULL | プラグイン ID。v1 は `business_card` |
| company_visible | boolean NOT NULL DEFAULT false | |
| title | text NOT NULL DEFAULT '' | 一覧見出し |
| counterparty | text NOT NULL DEFAULT '' | 相手先 |
| context_date | date NULL | 名刺=会った日、伝票=取引日 |
| amount_yen | numeric(12,2) NULL | 名刺は常に null |
| notes | text NOT NULL DEFAULT '' | |
| tags | text[] NOT NULL DEFAULT '{}' | |
| extracted | jsonb NOT NULL DEFAULT '{}' | 種類別。確定済みのみ |
| raw_ocr | text NOT NULL DEFAULT '' | 再整理用 |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | 保存のたび更新 |

Indexes:

- `(tenant_id, document_type, created_at DESC)`
- `(tenant_id, owner_user_id)`
- `(tenant_id, company_visible)`
- `(tenant_id, context_date DESC)`
- `title` / `counterparty` は v1 では `ILIKE '%q%'`。遅くなったら `pg_trgm` を足す

### `captured_document_images`

| Column | Type | Notes |
|--------|------|--------|
| id | uuid PK | |
| document_id | uuid NOT NULL → captured_documents ON DELETE CASCADE | |
| tenant_id | uuid NOT NULL → tenants | RLS・パス検証用に冗長保持 |
| sort_order | int NOT NULL | 0 始まり |
| role | text NOT NULL | `front` \| `back` \| `page` |
| storage_path | text NOT NULL UNIQUE | |
| created_at | timestamptz NOT NULL DEFAULT now() | |

名刺: `front` が1枚必須。`back` は0または1。`page` は使わない。

### Storage

- バケット `captured-documents`、非公開、10MB、`image/jpeg` `image/png` `image/webp` `image/heic`
- 確定: `{tenant_id}/{document_type}/{yyyy-mm-dd}/{document_id}/{uuid}.jpg`
- 一時: `{tenant_id}/tmp/{user_id}/{uuid}.jpg`

一時ファイルは保存成功で正式パスへ移す（または確定時にコピーして tmp を消す）。キャンセル・確認画面離脱・解析エラー後の中止で削除。同一ユーザの 24 時間超 tmp は、そのユーザの次の analyze 時に掃除。専用 Cron は v1 では作らない。

### 名刺 `extracted`

```json
{
  "full_name": "",
  "company": "",
  "title": "",
  "department": "",
  "address": "",
  "phone": "",
  "fax": "",
  "email": "",
  "website": ""
}
```

保存時の索引写し（名刺プラグイン）:

- `title` ← `full_name`
- `counterparty` ← `company`
- `context_date` ← 確認画面の会った日
- `amount_yen` ← null

伝票の `extracted` 例（v1 では実装しない。形の予約）: `{ "doc_no", "vendor", "issue_date", "subtotal", "tax", "total", "line_items": [] }`。明細は当面 JSON。**後日 `captured_document_line_items` を追加する**（`document_id` → `captured_documents.id` ON DELETE CASCADE）。v1 で明細専用テーブルは作らない。親を種類別に分割したり、`document_id` 以外の紐付けにしたりしない。

### `image_analysis_runs`

`captured_document_id uuid NULL REFERENCES captured_documents(id) ON DELETE SET NULL` を追加。既存の `capture_id`（`manual_captures`）は残す。解析 API 成功時に provider=`gemini` でトークンと概算円を書く。確定前の解析は文書行が無いので、analyze 時は `captured_document_id` を null のまま書き、確定 UPDATE で文書 id を後付けする。後付けに失敗してもコスト行は残す（ダッシュボード用）。

## Document type plugin contract

各種類は次を export する。

```ts
type ImageRole = "front" | "back" | "page";

interface DocumentTypePlugin {
  id: string; // e.g. "business_card"
  label: string; // UI。名刺
  imagePolicy: { min: number; max: number; allowedRoles: ImageRole[] };
  analyzePrompt: string;
  parseExtracted(raw: unknown): Record<string, string>;
  toIndexedFields(extracted: Record<string, string>, user: {
    notes: string;
    tags: string[];
    contextDate: string | null; // YYYY-MM-DD
  }): {
    title: string;
    counterparty: string;
    context_date: string | null;
    amount_yen: number | null;
  };
  /**
   * 優先順の突合キー。value が空の要素は無視。
   * 名刺: [{ kind: "email", value }, { kind: "name_company", value }]
   * 伝票例: [{ kind: "doc_no_vendor", value }]
   */
  duplicateKeys(extracted: Record<string, string>): { kind: string; value: string }[];
}
```

v1 登録は `business_card` のみ。未登録 `type` は API 400、ページ 404。

## Duplicate matching

可視集合: 同一 `tenant_id` かつ同一 `document_type` かつ  
`(owner_user_id = auth.uid() OR company_visible = true)`。  
他人の未公開は対象外。developer のデバッグ SELECT 全件は、突合集合には入れない（突合は上記可視集合のみ）。

正規化:

- email: trim、小文字化、内部空白削除。空ならキー無し
- nameCompany: `full_name` と `company` を trim、連続空白を1つ、小文字化、`{name}|{company}`。どちらか空ならキー無し

プラグインが返すキー配列の先頭から、`kind` ごとに可視集合を探す。先にヒットした kind を採用する。同一 kind で複数行なら `updated_at` が新しい1件。

会社公開をオンにする確定時、対象行以外の **会社公開行** に対しても同じキーで再突合する。ヒットし、かつその行を UPDATE できない（他人所有かつ admin 未満）場合は `company_visible` を立てず 409。既存の会社公開カードへ誘導する。ヒットし、UPDATE できる場合は、新規 INSERT せずその行を更新する（撮影フローの「既存を開く」と同じ）。

公開オフに重複制約は無い。

## Pipeline & APIs

認証必須。`tenant_id` はアクティブテナント。

| Method | Path | Role |
|--------|------|------|
| POST | `/api/documents/analyze` | 画像＋type → extracted 草案、raw_ocr、重複候補、一時 storage_path、analysis_run_id |
| POST | `/api/documents` | 確定。`existing_id` があれば UPDATE、無ければ INSERT。公開フラグ、手入力、extracted、画像パス |
| GET | `/api/documents` | ホルダー一覧（フィルタ・ページング）。署名 URL |
| GET | `/api/documents/[id]` | 詳細 |
| PATCH | `/api/documents/[id]` | 項目・公開・メモ等。再解析結果の確定もここ |
| DELETE | `/api/documents/[id]` | 行と画像 |
| POST | `/api/documents/[id]/analyze` | 既存画像で再解析。DB はまだ変えず草案を返す |

### Analyze

1. クライアントが Storage の tmp パスへ直接アップロードし、`POST /api/documents/analyze` に type とパスを送る
2. Gemini。表裏は1リクエストの多画像。プロンプトは「印刷された連絡先のみ。推測で埋めない。無い項目は空文字」。裏があるとき同一項目は表面優先、空なら裏面
3. プラグインで `extracted` 正規化。壊れた JSON は取れたキーだけ。残りは空文字
4. 重複候補を返す
5. `image_analysis_runs` にコスト行

Vision 5xx / タイムアウト: HTTP 200 で `extracted` 全空、`warning: "ocr_failed"`。写真は残し手入力保存可。名刺でない画像も保存可（空欄＋ `warning: "low_confidence"` は、モデルが明示した場合のみ。無いなら警告なしで空欄）

### Commit（POST /api/documents）

1. 権限と重複をサーバで再評価（確認中に誰かが公開したケース）
2. INSERT または UPDATE。`owner_user_id` は INSERT 時のみ自分。UPDATE で所有者は変えない
3. 画像を正式パスへ。`captured_document_images` を張り直し（更新時は旧ファイル削除）
4. 索引列をプラグインで写す
5. tmp 削除
6. 可能なら `image_analysis_runs.captured_document_id` を埋める

Storage 失敗時は文書行を残さない（INSERT なら rollback。UPDATE なら画像を旧のままにし 500）。

## RLS

`is_app_developer()` と `tenant_members` を使う。メール直書き禁止。

共通前提: `tenant_id IN (SELECT auth_tenant_ids())`。developer は `is_app_developer()` で全テナント。

| Op | Policy |
|----|--------|
| INSERT | 所属メンバー。`owner_user_id = auth.uid()` |
| SELECT | developer または（所属かつ（`owner_user_id = auth.uid()` OR `company_visible`）） |
| UPDATE | developer または（所属かつ（`owner_user_id = auth.uid()` OR（`company_visible` AND `has_tenant_role(tenant_id, 'admin')`））） |
| DELETE | UPDATE と同じ |

`has_tenant_role(..., 'admin')` は既存どおり owner と admin を含む。viewer は他人の会社公開を読めるが編集できない。自分の未公開は自分だけ見える。

`captured_document_images` は親文書と同じ可視条件（`document_id` 経由）。

Storage:

- tmp の SELECT/INSERT/DELETE: パス `{tenant_id}/tmp/{user_id}/...` の本人のみ
- 確定パスの INSERT: 所属メンバーかつ先頭セグメントが自分の `tenant_id` かつ第2セグメントが `tmp` ではない（Commit API がユーザセッションで正式パスへ書く）
- 確定パスの SELECT/DELETE: `captured_document_images.storage_path` と一致し、親文書の SELECT 条件を満たす

クライアントは tmp にだけ直接書く。正式パスへの書き込みは Commit API だけが行う。

GRANT: `authenticated` に両テーブルの SELECT/INSERT/UPDATE/DELETE。

## Error matrix

| Situation | Result |
|-----------|--------|
| 未ログイン | 401。保存しない |
| 他テナント | 403 |
| 未登録 type | 400 / ページ 404 |
| OCR 失敗 | 確認可。空欄。手入力保存可 |
| JSON 壊れ | 部分埋め |
| 編集権のない重複へ確定 | 409。閲覧へ。行を増やさない |
| 公開時の会社側重複かつ編集不可 | 409。フラグを立てない |
| Storage 失敗 | 確定中止。中途半端な行なし |

## Out of scope (v1)

後日追加する（この v1 では作らないが、コアを壊さずに載せる）:

- 伝票種類のプラグイン・画面（`invoice` / `purchase_order` / `receipt`）
- **明細子テーブル `captured_document_line_items`**（伝票の合計検索・行単位編集用。v1 は `extracted.line_items`）
- オフラインキュー
- 手書き特化 OCR
- 実メール通知、CSV エクスポート、連絡先アプリ連携
- tmp 掃除専用 Cron

足さない:

- 種類追加のための DB enum（種類の正はコードのプラグイン）
- 写真レポート（`picture_sends`）との一覧統合

## Testing

### Vitest

- 名刺: 生 JSON → `extracted`（欠落キーは空文字、余分キーは捨てる）
- 表裏マージ: 表面優先、表面空なら裏面
- 索引写し: 氏名→title、会社→counterparty、会った日→context_date、amount_yen は null
- 重複キー正規化（メール、氏名+会社）
- 突合: 可視集合のみ。プラグインの kind 順。複数は updated_at 新しい方

### RLS 手動マトリクス（実装後）

| Actor | 他人の未公開 | 会社公開の読 | 会社公開の書 | 自分の未公開 |
|-------|----------------|--------------|--------------|----------------|
| 本人 viewer | 見えない | 読める | 不可 | 読書き削除可 |
| 他人 viewer | 見えない | 読める | 不可 | — |
| admin | 見えない | 読める | 可 | 自分の分のみ未公開可 |
| 未所属 | 0 件 | 0 件 | 不可 | 不可 |

developer は全件 SELECT/UPDATE/DELETE 可。突合集合には他人未公開を入れない。

### 手動 E2E

撮る→確認→保存、裏スキップ、OCR 失敗後の手入力、重複更新、公開オンオフ、フィルタ 自分/会社/全部、再解析でメモが残ること。

## File plan

| Path | Role |
|------|------|
| `src/app/(tenant)/page.tsx` | TOP カテゴリ |
| `src/app/(tenant)/documents/page.tsx` | ホルダー |
| `src/app/(tenant)/documents/new/page.tsx` | 撮影＋確認 |
| `src/app/api/documents/**` | 上記 API |
| `src/lib/documents/**` | コアとプラグイン |
| `src/lib/image-analysis/document-ocr/` | Gemini OCR |
| `supabase/migrations/0019_captured_documents.sql` | スキーマ・RLS・バケット |

## Open points

なし。実装計画: `docs/superpowers/plans/2026-08-28-captured-documents.md`
