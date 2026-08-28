# 請求書ホルダー設計

**Date:** 2026-08-28  
**Status:** Approved  
**Depends on:** `docs/superpowers/specs/2026-08-28-captured-documents-design.md`（名刺 v1 基盤）  
**Routes:** `/documents/new?type=invoice` · `/documents?type=invoice`

## Summary

スマホで請求書を撮影（複数ページ可）し、Gemini Vision でヘッダー項目と明細行を読み取り、確認・編集したうえで DB に保存する。**名刺と同じ `captured_documents` コア**を使い、種類プラグイン `invoice` を追加する。明細行は **`captured_document_line_items` 子テーブル**に正規化保存する（検索・CSV 出力用）。ホルダー画面では請求書を複数選択し、**明細行単位の CSV エクスポート**を行う。

## Decisions

| Topic | Choice |
|-------|--------|
| 基盤 | 既存 `captured_documents` + `captured_document_images`。新テーブルは明細子のみ |
| 種類 ID | `invoice`（プラグイン登録。DB enum は使わない） |
| 写真 | 1 枚以上、最大 10 枚。role はすべて `page`（`front`/`back` は使わない） |
| ヘッダー保存 | `captured_documents.extracted`（jsonb）。`line_items` キーは **書かない** |
| 明細保存 | `captured_document_line_items`（確定時に親行と一括 INSERT/REPLACE） |
| 索引列 | `title`←請求番号、`counterparty`←請求元、`context_date`←発行日、`amount_yen`←合計 |
| 手入力（汎用列） | メモ・タグ・取引日（`context_date`。OCR 初期値は発行日、ユーザーが上書き可） |
| 公開 | 名刺と同じ `company_visible`（同一行の会社公開） |
| 重複 | 可視範囲で「請求番号 + 請求元」を突合。ヒット時は既存行を UPDATE（新規 INSERT しない） |
| 解析 | Gemini 固定。全ページを 1 リクエストの多画像 |
| CSV | 明細 1 行 = CSV 1 行。親ヘッダー列を各行に繰り返し。UTF-8 BOM 付き |
| 名刺 UI | 変更最小。請求書用コンポーネントを追加し、ルートは `?type=` で分岐 |

## サンプル請求書から読み取る項目

添付サンプル 3 種（弥生・汎用・御請求書）に共通する項目を v1 対象とする。

### ヘッダー（`extracted`）

| Key | ラベル | 例 |
|-----|--------|-----|
| `invoice_number` | 請求番号 | `20240131-001`, `123456789` |
| `issue_date` | 発行日 | `2024-01-31` |
| `due_date` | 支払期限 | `2024-02-29` |
| `recipient_name` | 請求先（宛名） | `サンプル産業株式会社 様` |
| `issuer_name` | 請求元（発行者） | `サンプル株式会社` |
| `issuer_address` | 請求元住所 | `〒101-0021 東京都…` |
| `issuer_phone` | 請求元 TEL | `03-xxxx-xxxx` |
| `issuer_email` | 請求元メール | `info@example.co.jp` |
| `registration_number` | 適格請求書登録番号 | `T1234567890123` |
| `subtotal` | 小計（税抜） | `360000` |
| `tax_10` | 消費税（10% 分） | `8181` |
| `tax_8` | 消費税（8% 分） | `20000` |
| `tax_total` | 消費税合計 | `28181` |
| `total` | 合計（税込請求金額） | `360000` |
| `bank_info` | 振込先 | `やよい銀行 中央支店 普通 08410841` |
| `remarks` | 備考 | `お振込手数料はご負担願います。` |

金額系は OCR 結果を **数字文字列**（カンマ・¥・円記号除去）で `extracted` に保持。`amount_yen` 索引列へは `total` を `numeric` 変換して写す。パース不能なら `null`。

### 明細行（子テーブル）

| Column | ラベル | 例 |
|--------|--------|-----|
| `line_no` | 行番号 | 1, 2, 3… |
| `transaction_date` | 明細日付 | `2024/01/15` → date または null |
| `description` | 品名・内容 | `サンプルA` |
| `quantity` | 数量 | `1`, `2` |
| `unit` | 単位 | `式`, `個`, `本` |
| `unit_price` | 単価 | `20000` |
| `amount` | 金額 | `80000` |
| `tax_rate` | 税率 | `10`, `8`, 空（不明） |

軽減税率マーク（`※`, `*`）は `tax_rate = '8'` として解釈。10% 明示が無ければ空文字（v1 では推測しない）。

## Architecture

名刺 v1 と同じ 4 層。コア API・Storage・RLS パターンは再利用する。

```
撮影（複数 page）
  → tmp Storage アップロード
  → POST /api/documents/analyze?type=invoice
  → Gemini（全 page 1 リクエスト）
  → 確認画面（ヘッダー編集 + 明細テーブル編集）
  → POST /api/documents（親 + 明細 + 画像確定）
  → 請求書ホルダー（一覧・詳細・CSV エクスポート）
```

### Folders

| Path | Role |
|------|------|
| `src/lib/documents/types/invoice/` | 請求書プラグイン（プロンプト、parse、索引、重複キー、明細 parse） |
| `src/lib/documents/lineItems.ts` | 明細行の正規化・DB 写し・CSV 行生成 |
| `src/lib/documents/exportCsv.ts` | CSV エンコード（BOM, エスケープ） |
| `src/app/(tenant)/documents/new/InvoiceCaptureForm.tsx` | 複数ページ撮影 + 確認 |
| `src/app/(tenant)/documents/InvoiceAlbum.tsx` | ホルダー + 選択 + CSV |
| `src/app/api/documents/export/route.ts` | CSV ダウンロード |
| `supabase/migrations/0020_captured_document_line_items.sql` | 明細子テーブル + RLS |

既存 `src/lib/documents/`・`src/lib/image-analysis/document-ocr/`・`src/app/api/documents/` は拡張のみ（破壊的変更なし）。

## Plugin contract 拡張

名刺プラグインとの後方互換を保つため、**既存 `DocumentTypePlugin` に optional メンバを追加**する。

```ts
export interface LineItemDraft {
  line_no: number;
  transaction_date: string | null; // YYYY-MM-DD or null
  description: string;
  quantity: string;
  unit: string;
  unit_price: string; // 数字文字列
  amount: string;
  tax_rate: string; // "10" | "8" | ""
}

export interface DocumentTypePlugin {
  // …既存メンバ…

  /** 明細を持つ種類のみ。未指定なら lineItems 非対応 */
  supportsLineItems?: boolean;
  parseLineItems?(raw: unknown): LineItemDraft[];
  /** analyzePrompt が返す JSON 形の説明（Gemini 用。invoice は structured） */
  structuredOcr?: boolean;
}
```

`business_card` は `supportsLineItems` 未指定（従来どおり）。`invoice` は `supportsLineItems: true`。

### 請求書 OCR プロンプト（返却 JSON 形）

```json
{
  "header": {
    "invoice_number": "",
    "issue_date": "",
    "due_date": "",
    "recipient_name": "",
    "issuer_name": "",
    "issuer_address": "",
    "issuer_phone": "",
    "issuer_email": "",
    "registration_number": "",
    "subtotal": "",
    "tax_10": "",
    "tax_8": "",
    "tax_total": "",
    "total": "",
    "bank_info": "",
    "remarks": ""
  },
  "line_items": [
    {
      "line_no": 1,
      "transaction_date": "",
      "description": "",
      "quantity": "",
      "unit": "",
      "unit_price": "",
      "amount": "",
      "tax_rate": ""
    }
  ]
}
```

ルール（プロンプトに明記）:

- 印刷された文字のみ。推測・補完禁止。無い項目は空文字
- 複数ページは上から順に読み、明細は `line_no` 連番で結合
- 出精値引き等のマイナス行も 1 行として残す（`amount` に `-` を付ける）
- 日付は可能なら `YYYY-MM-DD`。読めなければ原文のまま（後で確認画面で直す）

### 索引写し（invoice プラグイン）

- `title` ← `invoice_number`
- `counterparty` ← `issuer_name`
- `context_date` ← 確認画面の取引日（初期値: `issue_date` をパースした日付。空なら Asia/Tokyo 当日 **は使わない** — 空のまま）
- `amount_yen` ← `total` を numeric 化。失敗時 `null`

### 重複キー

優先順:

1. `{kind: "invoice_no_issuer", value: "{normalized_invoice_no}|{normalized_issuer}"}`

正規化: trim、連続空白を 1 つ、小文字化。請求番号または請求元のどちらか空ならキー無し。

## Data model

### 既存 `captured_documents`（変更なし）

請求書行の例:

| Column | 値 |
|--------|-----|
| `document_type` | `invoice` |
| `title` | `20240131-001` |
| `counterparty` | `サンプル株式会社` |
| `context_date` | `2024-01-31` |
| `amount_yen` | `360000.00` |
| `extracted` | ヘッダー 16 キーのみ（明細なし） |

### 新規 `captured_document_line_items`

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `document_id` | uuid NOT NULL → `captured_documents` ON DELETE CASCADE | |
| `tenant_id` | uuid NOT NULL → `tenants` | RLS 用冗長 |
| `line_no` | int NOT NULL | 1 始まり。`(document_id, line_no)` UNIQUE |
| `transaction_date` | date NULL | |
| `description` | text NOT NULL DEFAULT '' | |
| `quantity` | text NOT NULL DEFAULT '' | 数値+単位混在は quantity/unit に分離 |
| `unit` | text NOT NULL DEFAULT '' | |
| `unit_price` | numeric(12,2) NULL | |
| `amount` | numeric(12,2) NULL | |
| `tax_rate` | text NOT NULL DEFAULT '' | `10` / `8` / `` |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

Indexes:

- `(document_id, line_no)`
- `(tenant_id, document_id)`

確定（INSERT/UPDATE）時: 対象文書の既存明細を **DELETE してから全行 INSERT**（部分 PATCH は v1 では行わない）。

### 既存 `captured_document_images`

請求書: `role = 'page'`、`sort_order = 0..n-1`。1 枚以上必須。

Storage パス形式は名刺と同一: `{tenant_id}/invoice/{yyyy-mm-dd}/{document_id}/{uuid}.jpg`

## Screen behavior

### Entry（テナント TOP）

「文書ホルダー」カテゴリに追加:

| カード | href |
|--------|------|
| 請求書を撮る | `/documents/new?type=invoice` |
| 請求書ホルダー | `/documents?type=invoice` |

名刺カードは現状維持。`type=invoice` 未実装前は 404。

### 撮影 `/documents/new?type=invoice`

1. **1 ページ目を撮る**（必須）— 名刺と同じカメラ UI
2. **「ページを追加」** — 2 ページ目以降（最大 10 枚）。サムネイル一覧で削除可
3. **「読み取る」** → analyze API
4. **確認画面**

確認画面:

- ページ切替（全 `page` 画像のプレビュー）
- ヘッダー 16 項目のフォーム
- **明細テーブル**（行追加・削除・並べ替え不可 v1 — 行追加削除のみ）
- メモ、タグ、取引日（初期値 = 発行日）
- 「会社にも公開する」
- 保存 / 重複時は「更新する」

重複・権限・OCR 失敗時の挙動は名刺設計と同一（409、read-only、空欄保存可）。

### ホルダー `/documents?type=invoice`

名刺ホルダーと同じシェル（範囲・タグ・検索・ページング）に、請求書向け差分:

**一覧カード表示:**

- サムネイル: 先頭 `page` 画像
- 請求番号（`title`）
- 請求元（`counterparty`）
- 発行日（`context_date`）
- 合計金額（`amount_yen` を ¥ 表示）
- 会社公開バッジ

**追加フィルタ:**

- 発行日の期間（既存 `from`/`to` を `context_date` に適用）
- 金額範囲 `amount_min` / `amount_max`（任意）

**検索 (`q`):** `title` / `counterparty` / `extracted->>'recipient_name'` / `extracted->>'invoice_number'` ILIKE

**CSV エクスポート（請求書のみ）:**

- 一覧上部に「CSV エクスポート」ボタン
- 各カードにチェックボックス。ヘッダーに「すべて選択」（**現在読み込まれているページ内**）
- 1 件以上選択 → エクスポート実行
- 未選択で押したら「請求書を選択してください」

### 詳細モーダル

- 全ページ画像
- ヘッダー項目（編集可）
- 明細テーブル（編集可）
- メモ / タグ / 取引日 / 公開
- 「もう一度読む」（再解析 → 確認 → PATCH）
- 削除

## CSV Export

### API

`POST /api/documents/export`

Body:

```json
{
  "documentType": "invoice",
  "documentIds": ["uuid", "..."]
}
```

- 認証必須。`documentIds` は 1〜100 件（上限は DoS 防止）
- 各 ID は同一テナントかつ `document_type = invoice` かつ **SELECT 権限のある行のみ**
- 権限のない ID は黙ってスキップ（0 件なら 404）
- レスポンス: `Content-Type: text/csv; charset=utf-8`、`Content-Disposition: attachment; filename="invoices_YYYYMMDD_HHmmss.csv"`
- UTF-8 **BOM** 付き（Excel 文字化け対策）

### 行形式

**1 明細行 = CSV 1 行**。明細 0 行の請求書は **ヘッダー列のみの 1 行**を出力。

列順（v1 固定）:

| # | 列名 | ソース |
|---|------|--------|
| 1 | 請求書ID | `captured_documents.id` |
| 2 | 請求番号 | `title` |
| 3 | 発行日 | `extracted.issue_date` |
| 4 | 支払期限 | `extracted.due_date` |
| 5 | 請求先 | `extracted.recipient_name` |
| 6 | 請求元 | `counterparty` |
| 7 | 登録番号 | `extracted.registration_number` |
| 8 | 小計 | `extracted.subtotal` |
| 9 | 消費税10% | `extracted.tax_10` |
| 10 | 消費税8% | `extracted.tax_8` |
| 11 | 消費税合計 | `extracted.tax_total` |
| 12 | 合計 | `amount_yen` |
| 13 | 振込先 | `extracted.bank_info` |
| 14 | 備考 | `extracted.remarks` |
| 15 | メモ | `notes` |
| 16 | タグ | `tags` を `\|` 連結 |
| 17 | 取引日 | `context_date` |
| 18 | 明細行番号 | `line_no` |
| 19 | 明細日付 | `transaction_date` |
| 20 | 品名 | `description` |
| 21 | 数量 | `quantity` |
| 22 | 単位 | `unit` |
| 23 | 単価 | `unit_price` |
| 24 | 金額 | `amount` |
| 25 | 税率 | `tax_rate` |

ソート: リクエストの `documentIds` 順 → 各文書内は `line_no` 昇順。

## Pipeline & API changes

既存エンドポイントを拡張。新規は CSV のみ。

| Method | Path | Change |
|--------|------|--------|
| POST | `/api/documents/analyze` | `type=invoice` + 複数 tmp path。レスポンスに `lineItems` 追加 |
| POST | `/api/documents` | body に `lineItems[]` 任意。invoice 確定時に子テーブル書込 |
| GET | `/api/documents` | `type=invoice` 対応。`amount_min`/`amount_max` クエリ追加 |
| GET | `/api/documents/[id]` | レスポンスに `lineItems` 追加 |
| PATCH | `/api/documents/[id]` | `lineItems` 全置換可 |
| POST | `/api/documents/[id]/analyze` | 既存画像（全 page）で再解析。`lineItems` 草案を返す |
| POST | `/api/documents/export` | **新規** CSV |

### Analyze（invoice）

1. tmp 画像を `sort_order` 順にダウンロード（最大 10）
2. Gemini 1 回。プロンプトは structured JSON
3. `parseExtracted(raw.header)` + `parseLineItems(raw.line_items)`
4. 重複候補（`invoice_no_issuer`）
5. `image_analysis_runs` 記録

### Commit（invoice）

1. 名刺と同様に重複・権限チェック
2. 親行 INSERT/UPDATE
3. **`captured_document_line_items` を DELETE → INSERT**
4. 画像を `page` として保存
5. tmp 削除、`analysis_run_id` リンク

トランザクション: 親・明細・画像メタの整合が取れない場合は親行を残さない（名刺設計と同じ）。

## RLS

`captured_document_line_items` は **親文書と同一条件**（`document_id` 経由で JOIN）。

| Op | Policy |
|----|--------|
| SELECT | 親 `captured_documents` が SELECT 可なら可 |
| INSERT | 親が INSERT 可（= 自分の新規）かつ `tenant_id` 一致 |
| UPDATE | 親が UPDATE 可 |
| DELETE | 親が UPDATE 可（明細全置換は DELETE+INSERT） |

GRANT: `authenticated` に SELECT/INSERT/UPDATE/DELETE。

Storage・`captured_documents` の RLS は変更なし。

## Error matrix

名刺設計の矩阵に加え:

| Situation | Result |
|-----------|--------|
| ページ 0 枚 | 400 |
| ページ 11 枚以上 | 400 |
| invoice なのに `lineItems` 欠落 | 400（空配列は可） |
| CSV で選択 0 件 | 400 |
| CSV で readable 0 件 | 404 |
| 明細の numeric パース失敗 | 該当列 `null` で保存（確定は続行） |

## Out of scope

- 注文書（`purchase_order`）・レシート（`receipt`）プラグイン
- PDF アップロード（v1 は画像のみ）
- 会計ソフト連携 API（freee / マネーフォワード 等）
- OCR 結果の合計検算・自動修正
- 明細行のドラッグ並べ替え
- 請求書テンプレート学習・ベンダー別プロンプト

## Testing

### Vitest

- invoice: structured JSON → header + lineItems parse
- 複数 page マージ: 明細 `line_no` 連番
- 索引写し: 請求番号→title、合計→amount_yen
- 重複キー正規化
- CSV: BOM、カンマ・改行エスケープ、0 明細行の 1 行出力
- lineItems DELETE+INSERT on update

### 手動 E2E

- 1 ページ撮影→保存、3 ページ撮影→保存
- OCR 失敗→手入力で明細追加→保存
- 重複請求書の更新
- ホルダーで 2 件選択→CSV ダウンロード→Excel で文字化けしない
- 会社公開・権限なし重複 409

## File plan

| Path | Role |
|------|------|
| `supabase/migrations/0020_captured_document_line_items.sql` | 明細子 + RLS |
| `src/lib/documents/pluginTypes.ts` | `LineItemDraft`、optional メンバ |
| `src/lib/documents/types/invoice/plugin.ts` | 請求書プラグイン |
| `src/lib/documents/types/invoice/plugin.test.ts` | |
| `src/lib/documents/lineItems.ts` | DB 写し・normalize |
| `src/lib/documents/exportCsv.ts` | CSV 生成 |
| `src/lib/documents/registry.ts` | `invoice` 登録 |
| `src/lib/image-analysis/document-ocr/documentOcr.ts` | structured レスポンス対応 |
| `src/app/api/documents/analyze/route.ts` | lineItems 返却 |
| `src/app/api/documents/route.ts` | lineItems 受付・一覧 amount filter |
| `src/app/api/documents/[id]/route.ts` | lineItems CRUD |
| `src/app/api/documents/export/route.ts` | CSV |
| `src/app/api/documents/parseBody.ts` | lineItems バリデーション |
| `src/app/(tenant)/documents/new/page.tsx` | invoice 分岐 |
| `src/app/(tenant)/documents/new/InvoiceCaptureForm.tsx` | 撮影 UI |
| `src/app/(tenant)/documents/page.tsx` | invoice 分岐 |
| `src/app/(tenant)/documents/InvoiceAlbum.tsx` | ホルダー + CSV |
| `src/app/(tenant)/page.tsx` | TOP カード追加 |
| `docs/manual/機能説明書.md` | 請求書ホルダー追記 |

## UI 共通化方針

`DocumentsAlbum` / `CaptureDocumentForm` は名刺専用のまま残し、請求書は **別コンポーネント**で実装する。共通化するのは:

- カメラ取得（`captureFrameFromVideo`）
- tmp / 正式 Storage パス
- API クライアント呼び出しパターン
- フィルタバー（範囲・タグ・日付）の見た目

 v2 で `DocumentHolderShell` に抽出してもよいが、本設計では YAGNI。

## Resolved decisions (2026-08-28)

1. **CSV 列セット** — 25 列で確定（不足なし）
2. **取引日の初期値** — 発行日を初期値。パース失敗時は空のまま
3. **CSV 選択上限** — 100 件/回で確定

---

実装計画: `docs/superpowers/plans/2026-08-28-invoice-documents.md`
