# 請求書ホルダー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 請求書を複数ページ撮影し、Gemini でヘッダー＋明細を読み取り、確認後に DB 保存する請求書ホルダー（個人＋会社公開）と CSV エクスポートを実装する。

**Architecture:** 名刺 v1 の `captured_documents` コアに `invoice` プラグインを追加。明細は `captured_document_line_items` 子テーブル。OCR は structured JSON（header + line_items）。UI は `InvoiceCaptureForm` / `InvoiceAlbum` を新設し、名刺コンポーネントは触らない。

**Tech Stack:** Next.js App Router, TypeScript, Supabase (RLS, Storage), Gemini (`GEMINI_API_KEY`), Vitest

**Spec:** `docs/superpowers/specs/2026-08-28-invoice-documents-design.md`

## Global Constraints

- 観測対象は汎用。駐車場語彙をテーブル・プラグイン ID・ルートに使わない
- `picture_sends` / 写真レポート / 名刺 UI（`DocumentsAlbum`, `CaptureDocumentForm`）の挙動は壊さない
- `document_type` は `business_card` と `invoice` の 2 種。未登録 type は API 400、ページ 404
- 解析プロバイダは Gemini 固定。`GEMINI_API_KEY` / `GEMINI_VISION_MODEL`
- RLS にメールをハードコードしない。`is_app_developer()` と `has_tenant_role` / `auth_tenant_ids()` を使う
- `SiteFooter` のバージョンは上げない（ユーザが明示したときだけ）
- コミットはユーザが明示したときのみ。Plan 内の Commit ステップはスキップ可
- テスト実行: `npx vitest run <path> -v`（`package.json` に test スクリプトは無い）
- カメラは `src/lib/capture/captureFrameFromVideo.ts` を import。コピーして改変しない
- CSV: UTF-8 BOM 付き、25 列固定、選択上限 100 件/回
- 取引日初期値: 発行日パース成功時のみセット。失敗時は空

## File map

| Path | Responsibility |
|------|----------------|
| `supabase/migrations/0020_captured_document_line_items.sql` | 明細子 + RLS |
| `src/lib/documents/pluginTypes.ts` | `LineItemDraft`、optional メンバ |
| `src/lib/documents/types/invoice/plugin.ts` | 請求書プラグイン |
| `src/lib/documents/lineItems.ts` | 正規化・DB 行変換 |
| `src/lib/documents/exportCsv.ts` | CSV 生成（BOM・エスケープ） |
| `src/lib/documents/registry.ts` | `invoice` 登録 |
| `src/lib/image-analysis/document-ocr/documentOcr.ts` | 多ページ + structured OCR |
| `src/app/api/documents/parseBody.ts` | 画像検証修正 + lineItems パース |
| `src/app/api/documents/analyze/route.ts` | lineItems 返却 |
| `src/app/api/documents/route.ts` | amount filter + lineItems 確定 |
| `src/app/api/documents/[id]/route.ts` | lineItems GET/PATCH |
| `src/app/api/documents/export/route.ts` | CSV ダウンロード |
| `src/app/(tenant)/documents/new/InvoiceCaptureForm.tsx` | 複数ページ撮影 + 確認 |
| `src/app/(tenant)/documents/InvoiceAlbum.tsx` | ホルダー + 選択 + CSV |
| `src/app/(tenant)/documents/new/page.tsx` | invoice 分岐 |
| `src/app/(tenant)/documents/page.tsx` | invoice 分岐 |
| `src/app/(tenant)/page.tsx` | TOP カード追加 |
| `docs/manual/機能説明書.md` | 請求書ホルダー追記 |

---

### Task 1: DB migration（明細子テーブル）

**Files:**
- Create: `supabase/migrations/0020_captured_document_line_items.sql`

**Interfaces:**
- Consumes: `captured_documents`, `tenants`, `auth_tenant_ids()`, `is_app_developer()`, `has_tenant_role`
- Produces: table `captured_document_line_items` with RLS policies mirroring parent document visibility

- [ ] **Step 1: Write migration**

```sql
-- 0020_captured_document_line_items.sql
-- 伝票明細行。v1 では invoice のみ使用。

create table if not exists captured_document_line_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references captured_documents(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  line_no int not null check (line_no > 0),
  transaction_date date,
  description text not null default '',
  quantity text not null default '',
  unit text not null default '',
  unit_price numeric(12, 2),
  amount numeric(12, 2),
  tax_rate text not null default '',
  created_at timestamptz not null default now(),
  unique (document_id, line_no)
);

create index if not exists captured_document_line_items_document_idx
  on captured_document_line_items (document_id, line_no);
create index if not exists captured_document_line_items_tenant_document_idx
  on captured_document_line_items (tenant_id, document_id);

alter table captured_document_line_items enable row level security;

create policy captured_document_line_items_select on captured_document_line_items
  for select using (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and (
        is_app_developer()
        or (
          d.tenant_id in (select auth_tenant_ids())
          and (d.owner_user_id = auth.uid() or d.company_visible)
        )
      )
    )
  );

create policy captured_document_line_items_insert on captured_document_line_items
  for insert with check (
    tenant_id in (select auth_tenant_ids())
    and exists (
      select 1 from captured_documents d
      where d.id = document_id
      and d.tenant_id = captured_document_line_items.tenant_id
      and (
        is_app_developer()
        or d.owner_user_id = auth.uid()
        or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
      )
    )
  );

create policy captured_document_line_items_update on captured_document_line_items
  for update using (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and (
        is_app_developer()
        or d.owner_user_id = auth.uid()
        or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
      )
    )
  );

create policy captured_document_line_items_delete on captured_document_line_items
  for delete using (
    exists (
      select 1 from captured_documents d
      where d.id = document_id
      and (
        is_app_developer()
        or d.owner_user_id = auth.uid()
        or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
      )
    )
  );

grant select, insert, update, delete on captured_document_line_items to authenticated;
```

- [ ] **Step 2: Apply migration locally** (if Supabase CLI available) or note for deploy

Run: `supabase db push` or apply via dashboard

Expected: table exists, RLS enabled

---

### Task 2: Plugin types + invoice plugin

**Files:**
- Modify: `src/lib/documents/pluginTypes.ts`
- Create: `src/lib/documents/types/invoice/plugin.ts`
- Create: `src/lib/documents/types/invoice/plugin.test.ts`
- Modify: `src/lib/documents/registry.ts`

**Interfaces:**
- Consumes: existing `DocumentTypePlugin`
- Produces:
  - `LineItemDraft` type
  - `invoicePlugin: DocumentTypePlugin` with `supportsLineItems: true`, `structuredOcr: true`, `parseLineItems(raw): LineItemDraft[]`
  - `getDocumentPlugin("invoice")` returns plugin
  - `INVOICE_HEADER_KEYS` (16 keys), `parseInvoiceHeader`, `normalizeInvoiceNoIssuer`, `parseAmountYen`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/documents/types/invoice/plugin.test.ts
import { describe, expect, it } from "vitest";
import {
  INVOICE_HEADER_KEYS,
  invoicePlugin,
  parseLineItems,
  parseAmountYen,
} from "./plugin";

describe("invoicePlugin", () => {
  it("maps header to indexed fields", () => {
    const extracted = Object.fromEntries(INVOICE_HEADER_KEYS.map((k) => [k, ""])) as Record<string, string>;
    extracted.invoice_number = "20240131-001";
    extracted.issuer_name = "サンプル株式会社";
    extracted.total = "360,000";
    const indexed = invoicePlugin.toIndexedFields(extracted, {
      notes: "",
      tags: [],
      contextDate: "2024-01-31",
    });
    expect(indexed.title).toBe("20240131-001");
    expect(indexed.counterparty).toBe("サンプル株式会社");
    expect(indexed.amount_yen).toBe(360000);
  });

  it("parses line items from array", () => {
    const items = parseLineItems([
      { line_no: 1, description: "サンプルA", amount: "20000", tax_rate: "10" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("サンプルA");
    expect(items[0].tax_rate).toBe("10");
  });

  it("builds duplicate key from invoice number and issuer", () => {
    const keys = invoicePlugin.duplicateKeys({
      invoice_number: " 123 ",
      issuer_name: "Sample Co.",
    });
    expect(keys[0].kind).toBe("invoice_no_issuer");
    expect(keys[0].value).toContain("123");
    expect(keys[0].value).toContain("sample co.");
  });
});

describe("parseAmountYen", () => {
  it("strips currency symbols", () => {
    expect(parseAmountYen("¥360,000-")).toBe(360000);
    expect(parseAmountYen("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/documents/types/invoice/plugin.test.ts -v`

Expected: FAIL — module not found

- [ ] **Step 3: Implement pluginTypes extension + invoice plugin**

`pluginTypes.ts` に追加:

```typescript
export interface LineItemDraft {
  line_no: number;
  transaction_date: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  amount: string;
  tax_rate: string;
}

export interface DocumentTypePlugin {
  // ...existing fields...
  supportsLineItems?: boolean;
  structuredOcr?: boolean;
  parseLineItems?(raw: unknown): LineItemDraft[];
}
```

`invoice/plugin.ts`: spec の 16 ヘッダーキー、structured プロンプト、`parseExtracted` は `raw.header` または flat object から正規化、`imagePolicy: { min: 1, max: 10, allowedRoles: ["page"] }`

`registry.ts`:

```typescript
import { invoicePlugin } from "./types/invoice/plugin";

const plugins: Record<string, DocumentTypePlugin> = {
  business_card: businessCardPlugin,
  invoice: invoicePlugin,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/documents/types/invoice/plugin.test.ts -v`

Expected: PASS

---

### Task 3: lineItems + exportCsv utilities

**Files:**
- Create: `src/lib/documents/lineItems.ts`
- Create: `src/lib/documents/lineItems.test.ts`
- Create: `src/lib/documents/exportCsv.ts`
- Create: `src/lib/documents/exportCsv.test.ts`

**Interfaces:**
- Consumes: `LineItemDraft` from pluginTypes
- Produces:
  - `normalizeLineItemDraft(draft: LineItemDraft): LineItemDraft`
  - `lineItemDraftToDbRow(draft: LineItemDraft, documentId: string, tenantId: string): DbLineItemRow`
  - `parseNumericOrNull(value: string): number | null`
  - `buildInvoiceCsvRows(documents: InvoiceExportDocument[]): string[][]` — 25 columns per spec
  - `encodeCsvWithBom(rows: string[][]): Buffer`

- [ ] **Step 1: Write failing tests for CSV**

```typescript
// src/lib/documents/exportCsv.test.ts
import { describe, expect, it } from "vitest";
import { buildInvoiceCsvRows, encodeCsvWithBom } from "./exportCsv";

describe("exportCsv", () => {
  it("outputs header-only row when no line items", () => {
    const rows = buildInvoiceCsvRows([
      {
        id: "doc-1",
        title: "INV-001",
        counterparty: "Acme",
        contextDate: "2024-01-31",
        amountYen: 1000,
        notes: "",
        tags: [],
        extracted: { issue_date: "2024-01-31", recipient_name: "Client" },
        lineItems: [],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe("INV-001");
    expect(rows[0][17]).toBe(""); // 明細行番号 empty
  });

  it("prefixes UTF-8 BOM", () => {
    const buf = encodeCsvWithBom([["a", "b"]]);
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run src/lib/documents/exportCsv.test.ts -v`

- [ ] **Step 3: Implement lineItems.ts and exportCsv.ts**

CSV 列名は spec の 25 列順をそのまま使用。カンマ・改行・ダブルクォートは RFC 4180 風にエスケープ。

- [ ] **Step 4: Run all Task 3 tests**

Run: `npx vitest run src/lib/documents/lineItems.test.ts src/lib/documents/exportCsv.test.ts -v`

Expected: PASS

---

### Task 4: documentOcr 多ページ + structured 対応

**Files:**
- Modify: `src/lib/image-analysis/document-ocr/documentOcr.ts`
- Modify: `src/lib/image-analysis/document-ocr/documentOcr.test.ts`

**Interfaces:**
- Consumes: `DocumentTypePlugin.structuredOcr`
- Produces:
  - `DocumentOcrInput` extended with optional `pages?: DocumentOcrImage[]`
  - `DocumentOcrResult` extended with optional `lineItems: LineItemDraft[]`
  - `ocrDocument()` — if `plugin.structuredOcr`, send all pages, parse `{ header, line_items }`; else existing front/back path unchanged

- [ ] **Step 1: Write failing test for structured parse**

```typescript
it("parses structured invoice JSON with line items", async () => {
  const plugin = invoicePlugin;
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              header: { invoice_number: "001", issuer_name: "Co", total: "1000" },
              line_items: [{ line_no: 1, description: "Item", amount: "1000" }],
            }),
          }],
        },
      }],
    }),
  });
  const result = await ocrDocument({
    pages: [{ imageBuffer: Buffer.from("x"), mimeType: "image/jpeg" }],
    plugin,
    apiKey: "test-key",
    fetchImpl,
  });
  expect(result.extracted.invoice_number).toBe("001");
  expect(result.lineItems).toHaveLength(1);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/lib/image-analysis/document-ocr/documentOcr.test.ts -v`

- [ ] **Step 3: Implement multi-page + structured branch**

- `pages` がある場合: 全画像を parts に追加
- `structuredOcr`: `parsed.header` → `parseExtracted`, `parsed.line_items` → `plugin.parseLineItems!`
- 名刺（front/back）パスは既存ロジック維持

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run src/lib/image-analysis/document-ocr/documentOcr.test.ts -v`

---

### Task 5: parseBody 修正 + lineItems パース

**Files:**
- Modify: `src/app/api/documents/parseBody.ts`
- Modify: `src/app/api/documents/parseBody.test.ts`

**Interfaces:**
- Consumes: plugin `imagePolicy`, `supportsLineItems`
- Produces:
  - `validateImages()` — **front 必須チェックを廃止**。代わりに `allowedRoles` のいずれかが min 枚数以上あること
  - `ParsedCommitBody.lineItems: LineItemDraft[]` — invoice 時必須（空配列可）
  - `parseLineItemsBody(body, plugin): LineItemDraft[]`

- [ ] **Step 1: Write failing test — page-only images valid for invoice**

```typescript
it("accepts page-only images for invoice", () => {
  const body = parseAnalyzeBody(
    {
      documentType: "invoice",
      images: [{ role: "page", path: `${tenantId}/tmp/${userId}/a.jpg` }],
    },
    { tenantId, userId }
  );
  expect(body.images[0].role).toBe("page");
});
```

- [ ] **Step 2: Run — expect FAIL** (currently requires front)

- [ ] **Step 3: Fix validateImages**

```typescript
function validateImages<T extends { role: ImageRole }>(
  images: T[],
  plugin: DocumentTypePlugin
): T[] {
  if (
    images.length < plugin.imagePolicy.min ||
    images.length > plugin.imagePolicy.max
  ) {
    throw new Error("invalid image count");
  }
  const allowed = new Set(plugin.imagePolicy.allowedRoles);
  if (!images.every((img) => allowed.has(img.role))) {
    throw new Error("invalid image role for document type");
  }
  return images;
}
```

Commit body に `lineItems` 追加。`supportsLineItems` かつ `lineItems` 欠落 → throw。

- [ ] **Step 4: Run parseBody tests — expect PASS**

Run: `npx vitest run src/app/api/documents/parseBody.test.ts -v`

---

### Task 6: analyze API — invoice 対応

**Files:**
- Modify: `src/app/api/documents/analyze/route.ts`
- Modify: `src/app/api/documents/[id]/analyze/route.ts`

**Interfaces:**
- Consumes: `parseAnalyzeBody`, `ocrDocument` with pages
- Produces: JSON `{ extracted, lineItems?, rawOcr, analysisRunId, duplicate?, warning? }`

- [ ] **Step 1: Refactor analyze route image loading**

```typescript
// Instead of front/back only:
const pageImages = parsed.images
  .sort((a, b) => /* sort_order from array index */ 0)
  .map((img) => downloadImage(supabase, img.path));

if (parsed.plugin.structuredOcr) {
  const result = await ocrDocument({
    pages: await Promise.all(pageImages),
    plugin: parsed.plugin,
    apiKey,
    model,
  });
  // return lineItems: result.lineItems ?? []
} else {
  // existing front/back path
}
```

- [ ] **Step 2: Manual smoke** — POST analyze with invoice type (after UI or curl)

Expected: 200 with `lineItems` array

- [ ] **Step 3: Update [id]/analyze** similarly for re-OCR of saved page images

---

### Task 7: documents API — commit + list + lineItems 永続化

**Files:**
- Modify: `src/app/api/documents/route.ts`
- Modify: `src/app/api/documents/[id]/route.ts`

**Interfaces:**
- Consumes: `ParsedCommitBody.lineItems`, `lineItemDraftToDbRow`
- Produces:
  - POST commit: after parent upsert, `DELETE FROM captured_document_line_items WHERE document_id = ?` then bulk INSERT
  - GET list: `amount_min` / `amount_max` query filters on `amount_yen`
  - GET list search for invoice: also `extracted->>'recipient_name'`
  - GET/PATCH `[id]`: include `lineItems` in response; PATCH replaces line items

- [ ] **Step 1: Add helper `replaceLineItems(supabase, documentId, tenantId, drafts)`**

```typescript
async function replaceLineItems(
  supabase: ReturnType<typeof createServerSupabase>,
  documentId: string,
  tenantId: string,
  drafts: LineItemDraft[]
) {
  await supabase.from("captured_document_line_items").delete().eq("document_id", documentId);
  if (drafts.length === 0) return;
  const rows = drafts.map((d) => lineItemDraftToDbRow(d, documentId, tenantId));
  const { error } = await supabase.from("captured_document_line_items").insert(rows);
  if (error) throw error;
}
```

- [ ] **Step 2: Call replaceLineItems in POST handler** when `plugin.supportsLineItems`

- [ ] **Step 3: Extend GET list** with amount filters and front thumbnail = first `page` image (sort_order asc) for invoice

- [ ] **Step 4: Extend GET/PATCH [id]** to fetch/join line items

---

### Task 8: CSV export API

**Files:**
- Create: `src/app/api/documents/export/route.ts`
- Create: `src/app/api/documents/export/route.test.ts` (optional unit test for validation logic extracted to lib)

**Interfaces:**
- Consumes: `buildInvoiceCsvRows`, `encodeCsvWithBom`
- Produces: `POST /api/documents/export` → CSV file download

- [ ] **Step 1: Implement route**

```typescript
export async function POST(req: Request) {
  // auth + tenant
  const { documentType, documentIds } = await req.json();
  if (documentType !== "invoice") return 400;
  if (!Array.isArray(documentIds) || documentIds.length === 0) return 400;
  if (documentIds.length > 100) return 400;
  // fetch documents + line items where SELECT allowed
  // skip unauthorized IDs silently; if 0 readable → 404
  const rows = buildInvoiceCsvRows(documents);
  const body = encodeCsvWithBom(rows);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices_${timestamp}.csv"`,
    },
  });
}
```

- [ ] **Step 2: Test with curl** (2 saved invoices)

Expected: CSV downloads, Excel opens without mojibake

---

### Task 9: InvoiceCaptureForm（撮影 + 確認）

**Files:**
- Create: `src/app/(tenant)/documents/new/InvoiceCaptureForm.tsx`
- Modify: `src/app/(tenant)/documents/new/page.tsx`

**Interfaces:**
- Consumes: analyze/commit APIs, `captureFrameFromVideo`, tmp upload pattern from `CaptureDocumentForm`
- Produces: multi-page capture UI, confirm form with header fields + editable line items table

- [ ] **Step 1: Add page routing**

```typescript
// new/page.tsx
if (documentType === "business_card") return <CaptureDocumentForm ... />;
if (documentType === "invoice") return <InvoiceCaptureForm tenantId=... userId=... />;
notFound();
```

- [ ] **Step 2: Implement InvoiceCaptureForm**

States: `idle | capturing | confirming | saving`

Flow:
1. Capture page → add to `pages[]` (max 10)
2. Thumbnail strip with delete
3. 「読み取る」→ upload tmp paths with `role: "page"` → POST analyze
4. Confirm: 16 header fields + line items table (add/remove rows)
5. `contextDate` initial = parsed `issue_date` if valid YYYY-MM-DD, else `""`
6. Save → POST commit with `lineItems`

Reuse camera/orientation logic from `CaptureDocumentForm` (import, don't copy file).

- [ ] **Step 3: Manual E2E** — capture 1-page invoice sample → save

---

### Task 10: InvoiceAlbum（ホルダー + CSV）

**Files:**
- Create: `src/app/(tenant)/documents/InvoiceAlbum.tsx`
- Modify: `src/app/(tenant)/documents/page.tsx`

**Interfaces:**
- Consumes: GET list, GET detail, PATCH, DELETE, POST export
- Produces: holder grid with checkboxes, amount filter, CSV export button

- [ ] **Step 1: Add page routing**

```typescript
if (documentType === "business_card") return <DocumentsAlbum ... />;
if (documentType === "invoice") return <InvoiceAlbum ... />;
notFound();
```

- [ ] **Step 2: Implement InvoiceAlbum**

Based on `DocumentsAlbum` patterns:
- List card: 請求番号, 請求元, 発行日, ¥合計
- Checkbox per card + 「すべて選択」（loaded page only）
- 「CSV エクスポート」→ POST export with selected IDs → blob download
- Detail modal: pages, header, line items, memo/tags/contextDate, re-analyze, delete
- Filters: scope, tags, date range, amount_min/max, search

- [ ] **Step 3: Manual E2E** — select 2 invoices → CSV export

---

### Task 11: TOP カード + 機能説明書

**Files:**
- Modify: `src/app/(tenant)/page.tsx`
- Modify: `docs/manual/機能説明書.md`

- [ ] **Step 1: Add TOP cards**

```typescript
{
  icon: FileText, // or Receipt
  title: "請求書を撮る",
  description: "請求書を撮影し、AIで読み取った内容を確認して保存します。",
  href: "/documents/new?type=invoice",
},
{
  icon: FolderOpen,
  title: "請求書ホルダー",
  description: "保存した請求書を検索・編集し、CSVでエクスポートします。",
  href: "/documents?type=invoice",
},
```

- [ ] **Step 2: Update 機能説明書** with 請求書ホルダー section (capture, holder, CSV, company share)

---

### Task 12: Regression tests

**Files:**
- Run existing test suite

- [ ] **Step 1: Run all document-related tests**

Run: `npx vitest run src/lib/documents src/app/api/documents src/lib/image-analysis/document-ocr -v`

Expected: all PASS (business_card behavior unchanged)

- [ ] **Step 2: Manual regression** — business card capture + holder still works

---

## Spec coverage checklist

| Spec section | Task |
|--------------|------|
| invoice plugin + 16 header keys | Task 2 |
| captured_document_line_items | Task 1, 7 |
| Multi-page capture (page role) | Task 4, 5, 9 |
| Structured OCR prompt | Task 2, 4 |
| Duplicate invoice_no_issuer | Task 2 (plugin), existing findDuplicate |
| CSV 25 columns + BOM | Task 3, 8 |
| CSV 100 limit | Task 8 |
| Holder filters + amount range | Task 7, 10 |
| RLS on line items | Task 1 |
| TOP entry cards | Task 11 |
| 名刺 UI unchanged | Tasks 9-10 use separate components |

## Execution order

Tasks 1→2→3 can start in parallel after Task 1 migration. Task 4 depends on Task 2. Task 5 depends on Task 2. Task 6 depends on 4+5. Task 7 depends on 1+3+5. Task 8 depends on 3+7. Tasks 9-10 depend on 6+7. Task 11 anytime after 9-10. Task 12 last.
