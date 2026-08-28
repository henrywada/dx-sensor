# 文書キャプチャ（名刺ホルダー）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スマホで名刺を撮り、Gemini で読み取り、確認してから `captured_documents` に保存する名刺ホルダー（個人＋会社公開）を v1 として実装する。

**Architecture:** 種類プラグイン（v1 は `business_card` のみ）＋汎用テーブル／Storage。撮影は既存 `captureFrameFromVideo` を再利用。解析は Gemini。確定は確認後の INSERT/UPDATE。伝票種類と明細子テーブルはこの計画では作らない。

**Tech Stack:** Next.js App Router, TypeScript, Supabase (RLS, Storage), Gemini (`GEMINI_API_KEY`), Vitest

**Spec:** `docs/superpowers/specs/2026-08-28-captured-documents-design.md`

## Global Constraints

- 観測対象は汎用。駐車場語彙をテーブル・プラグイン ID・ルートに使わない
- `picture_sends` / 写真レポート画面は変更しない
- v1 の `document_type` は `business_card` のみ。未登録 type は API 400、ページ 404
- 明細子テーブル `captured_document_line_items` は **作らない**。マイグレーションの COMMENT で後日追加を明記するだけ。親テーブルを種類別に分割しない
- 解析プロバイダは Gemini 固定。`GEMINI_API_KEY` / `GEMINI_VISION_MODEL`（既存 monitor と同じ）
- RLS にメールをハードコードしない。`is_app_developer()` と `has_tenant_role` / `auth_tenant_ids()` を使う
- `SiteFooter` のバージョンは上げない（ユーザが明示したときだけ）
- コミットはユーザが明示したときのみ。Plan 内の Commit ステップはスキップ可
- テスト実行: `npx vitest run <path> -v`（`package.json` に test スクリプトは無い）
- カメラの向き補正は `src/lib/capture/captureFrameFromVideo.ts` を import する。コピーして改変しない

## File map

| Path | Responsibility |
|------|----------------|
| `supabase/migrations/0019_captured_documents.sql` | テーブル、RLS、Storage、`image_analysis_runs` 列、COMMENT |
| `src/lib/documents/pluginTypes.ts` | `DocumentTypePlugin` 契約 |
| `src/lib/documents/registry.ts` | `getDocumentPlugin(id)` |
| `src/lib/documents/types/business_card/plugin.ts` | 名刺: parse / merge / 索引 / 重複キー / プロンプト |
| `src/lib/documents/findDuplicate.ts` | 可視行からの突合 |
| `src/lib/documents/canMutateDocument.ts` | UPDATE/DELETE 可否 |
| `src/lib/documents/tokyoDate.ts` | Asia/Tokyo の `YYYY-MM-DD` |
| `src/lib/documents/storagePaths.ts` | tmp / 正式パス |
| `src/lib/documents/cleanupTmp.ts` | 24h 超 tmp 削除 |
| `src/lib/image-analysis/document-ocr/parseVisionJson.ts` | モデル出力から JSON を取る |
| `src/lib/image-analysis/document-ocr/documentOcr.ts` | Gemini 呼び出し＋正規化 |
| `src/app/api/documents/analyze/route.ts` | 解析＋重複候補 |
| `src/app/api/documents/route.ts` | GET 一覧、POST 確定 |
| `src/app/api/documents/[id]/route.ts` | GET / PATCH / DELETE |
| `src/app/api/documents/[id]/analyze/route.ts` | 再解析草案 |
| `src/app/(tenant)/documents/new/*` | 撮影＋確認 |
| `src/app/(tenant)/documents/*` | ホルダー |
| `src/app/(tenant)/page.tsx` | TOP「文書ホルダー」 |
| `docs/manual/機能説明書.md` | ユーザー向け追記 |

---

### Task 1: DB migration

**Files:**
- Create: `supabase/migrations/0019_captured_documents.sql`

**Interfaces:**
- Consumes: 既存 `tenants`, `auth.users`, `auth_tenant_ids()`, `is_app_developer()`, `has_tenant_role(uuid, text)`, `image_analysis_runs`
- Produces: `captured_documents`, `captured_document_images`, bucket `captured-documents`, `image_analysis_runs.captured_document_id`

- [ ] **Step 1: Write migration**

```sql
-- 0019_captured_documents.sql
-- 汎用文書キャプチャ。v1 の種類は business_card（名刺）。
-- 明細行テーブルは作らない。後日 captured_document_line_items(document_id)
--   → captured_documents(id) ON DELETE CASCADE を追加する。

create table if not exists captured_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null,
  company_visible boolean not null default false,
  title text not null default '',
  counterparty text not null default '',
  context_date date,
  amount_yen numeric(12, 2),
  notes text not null default '',
  tags text[] not null default '{}',
  extracted jsonb not null default '{}'::jsonb,
  raw_ocr text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table captured_documents is
  '汎用文書キャプチャ。種類は document_type（コードのプラグインが正）。伝票明細は v1 では extracted.line_items。後日 captured_document_line_items を document_id FK で追加する。';

create index if not exists captured_documents_tenant_type_created_idx
  on captured_documents (tenant_id, document_type, created_at desc);
create index if not exists captured_documents_tenant_owner_idx
  on captured_documents (tenant_id, owner_user_id);
create index if not exists captured_documents_tenant_visible_idx
  on captured_documents (tenant_id, company_visible);
create index if not exists captured_documents_tenant_context_date_idx
  on captured_documents (tenant_id, context_date desc);

create table if not exists captured_document_images (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references captured_documents(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  sort_order int not null,
  role text not null check (role in ('front', 'back', 'page')),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists captured_document_images_document_idx
  on captured_document_images (document_id, sort_order);

alter table captured_documents enable row level security;
alter table captured_document_images enable row level security;

create policy captured_documents_insert on captured_documents
  for insert with check (
    owner_user_id = auth.uid()
    and tenant_id in (select auth_tenant_ids())
  );

create policy captured_documents_select on captured_documents
  for select using (
    is_app_developer()
    or (
      tenant_id in (select auth_tenant_ids())
      and (owner_user_id = auth.uid() or company_visible)
    )
  );

create policy captured_documents_update on captured_documents
  for update using (
    is_app_developer()
    or (
      tenant_id in (select auth_tenant_ids())
      and (
        owner_user_id = auth.uid()
        or (company_visible and has_tenant_role(tenant_id, 'admin'))
      )
    )
  ) with check (
    is_app_developer()
    or (
      tenant_id in (select auth_tenant_ids())
      and (
        owner_user_id = auth.uid()
        or (company_visible and has_tenant_role(tenant_id, 'admin'))
      )
    )
  );

create policy captured_documents_delete on captured_documents
  for delete using (
    is_app_developer()
    or (
      tenant_id in (select auth_tenant_ids())
      and (
        owner_user_id = auth.uid()
        or (company_visible and has_tenant_role(tenant_id, 'admin'))
      )
    )
  );

create policy captured_document_images_select on captured_document_images
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

create policy captured_document_images_insert on captured_document_images
  for insert with check (
    tenant_id in (select auth_tenant_ids())
    and exists (
      select 1 from captured_documents d
      where d.id = document_id
      and d.tenant_id = captured_document_images.tenant_id
      and (
        is_app_developer()
        or d.owner_user_id = auth.uid()
        or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
      )
    )
  );

create policy captured_document_images_update on captured_document_images
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

create policy captured_document_images_delete on captured_document_images
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

grant select, insert, update, delete on public.captured_documents to authenticated;
grant select, insert, update, delete on public.captured_document_images to authenticated;

alter table image_analysis_runs
  add column if not exists captured_document_id uuid
    references captured_documents(id) on delete set null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'captured-documents',
  'captured-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy captured_documents_storage_tmp
  on storage.objects for all
  using (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] = 'tmp'
    and (storage.foldername(name))[1]::uuid in (select auth_tenant_ids())
    and (storage.foldername(name))[3]::uuid = auth.uid()
  )
  with check (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] = 'tmp'
    and (storage.foldername(name))[1]::uuid in (select auth_tenant_ids())
    and (storage.foldername(name))[3]::uuid = auth.uid()
  );

create policy captured_documents_storage_final_insert
  on storage.objects for insert
  with check (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] is distinct from 'tmp'
    and (storage.foldername(name))[1]::uuid in (select auth_tenant_ids())
  );

create policy captured_documents_storage_final_select
  on storage.objects for select
  using (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] is distinct from 'tmp'
    and exists (
      select 1
      from captured_document_images i
      join captured_documents d on d.id = i.document_id
      where i.storage_path = name
        and (
          is_app_developer()
          or (
            d.tenant_id in (select auth_tenant_ids())
            and (d.owner_user_id = auth.uid() or d.company_visible)
          )
        )
    )
  );

create policy captured_documents_storage_final_delete
  on storage.objects for delete
  using (
    bucket_id = 'captured-documents'
    and (storage.foldername(name))[2] is distinct from 'tmp'
    and exists (
      select 1
      from captured_document_images i
      join captured_documents d on d.id = i.document_id
      where i.storage_path = name
        and (
          is_app_developer()
          or d.owner_user_id = auth.uid()
          or (d.company_visible and has_tenant_role(d.tenant_id, 'admin'))
        )
    )
  );
```

- [ ] **Step 2: Apply locally**

Run: プロジェクト慣例どおり `npx supabase db push`（ローカル）または `npx supabase migration up`。  
Expected: `to_regclass('public.captured_documents')` が non-null。`captured_document_line_items` は存在しない。

- [ ] **Step 3: Commit (skip unless user asked)**

---

### Task 2: Business card plugin

**Files:**
- Create: `src/lib/documents/pluginTypes.ts`
- Create: `src/lib/documents/registry.ts`
- Create: `src/lib/documents/types/business_card/plugin.ts`
- Test: `src/lib/documents/types/business_card/plugin.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `DocumentTypePlugin`, `getDocumentPlugin(id)`, `businessCardPlugin`（`parseExtracted`, `mergeExtracted`, `toIndexedFields`, `duplicateKeys`, `analyzePrompt`, `imagePolicy`）

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { businessCardPlugin, mergeExtracted } from "./plugin";

describe("businessCardPlugin.parseExtracted", () => {
  it("fills missing keys with empty string and drops extras", () => {
    const parsed = businessCardPlugin.parseExtracted({
      full_name: "山田太郎",
      extra: "nope",
    });
    expect(parsed.full_name).toBe("山田太郎");
    expect(parsed.email).toBe("");
    expect(parsed).not.toHaveProperty("extra");
  });
});

describe("mergeExtracted", () => {
  it("prefers front and fills empties from back", () => {
    const merged = mergeExtracted(
      { full_name: "山田", company: "", email: "a@example.com" },
      { full_name: "Yamada", company: "例示商事", email: "b@example.com" }
    );
    expect(merged.full_name).toBe("山田");
    expect(merged.company).toBe("例示商事");
    expect(merged.email).toBe("a@example.com");
  });
});

describe("toIndexedFields", () => {
  it("maps name/company/date and null amount", () => {
    const indexed = businessCardPlugin.toIndexedFields(
      { full_name: "山田太郎", company: "例示商事" },
      { notes: "", tags: [], contextDate: "2026-08-28" }
    );
    expect(indexed.title).toBe("山田太郎");
    expect(indexed.counterparty).toBe("例示商事");
    expect(indexed.context_date).toBe("2026-08-28");
    expect(indexed.amount_yen).toBeNull();
  });
});

describe("duplicateKeys", () => {
  it("emits email first then name_company", () => {
    const keys = businessCardPlugin.duplicateKeys({
      full_name: "山田  太郎",
      company: "例示商事",
      email: " A@Example.com ",
    });
    expect(keys[0]).toEqual({ kind: "email", value: "a@example.com" });
    expect(keys[1]).toEqual({ kind: "name_company", value: "山田 太郎|例示商事" });
  });

  it("omits empty keys", () => {
    const keys = businessCardPlugin.duplicateKeys({
      full_name: "",
      company: "例示商事",
      email: "",
    });
    expect(keys).toEqual([]);
  });
});
```

メール: trim、小文字、内部空白削除。name_company: 両方非空のときだけ。各 trim、連続空白を1つ、lowerCase、`{name}|{company}`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/documents/types/business_card/plugin.test.ts -v`  
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: Write minimal implementation**

`pluginTypes.ts` は spec の `DocumentTypePlugin`。`extracted` の値は全部 `string`。

`CARD_KEYS` = `full_name company title department address phone fax email website`

`parseExtracted`: object でなければ全キー空。余分キーは捨てる。

`mergeExtracted(front, back)`: 各キーで front が非空なら front、さもなくば back。

`analyzePrompt`: 印刷された連絡先のみ、推測禁止、無い項目は空文字、JSON のみ。2枚なら1枚目=表面、2枚目=裏面。形は `{ "front": { ...keys }, "back": { ...keys } }`。1枚なら `front` のみ。

`imagePolicy`: `{ min: 1, max: 2, allowedRoles: ["front", "back"] }`

`registry.ts`: `business_card` のみ。未知 id は `null`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/documents/types/business_card/plugin.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit (skip unless user asked)**

---

### Task 3: Duplicate match, mutate gate, Tokyo date

**Files:**
- Create: `src/lib/documents/tokyoDate.ts`
- Create: `src/lib/documents/canMutateDocument.ts`
- Create: `src/lib/documents/findDuplicate.ts`
- Test: `src/lib/documents/tokyoDate.test.ts`
- Test: `src/lib/documents/canMutateDocument.test.ts`
- Test: `src/lib/documents/findDuplicate.test.ts`

**Interfaces:**
- Consumes: `{ kind, value }[]`
- Produces:
  - `tokyoToday(now?: Date): string`
  - `canMutateDocument({ actorUserId, actorRole, isDeveloper, ownerUserId, companyVisible }): boolean`
  - `findDuplicate(rows, incomingKeys, rowKeys, opts?): T | null`

- [ ] **Step 1: Write the failing tests**

`tokyoDate.test.ts`: `new Date("2026-08-27T16:00:00Z")`（JST 8/28 01:00）→ `"2026-08-28"`。

`canMutateDocument.test.ts`: 本人 viewer → true。他人 viewer + 公開 → false。admin + 公開 + 他人所有 → true。admin + 未公開 + 他人所有 → false。developer → true。

`findDuplicate` シグネチャ:

```ts
export function findDuplicate<T>(
  rows: T[],
  incomingKeys: { kind: string; value: string }[],
  rowKeys: (row: T) => { kind: string; value: string }[],
  opts?: {
    exclude?: (row: T) => boolean;
    include?: (row: T) => boolean;
    updatedAt: (row: T) => string;
  }
): T | null
```

- email 一致を name_company より優先（keys 配列順）
- 同一 kind の複数ヒットは `updatedAt` が新しい方
- `include: (r) => r.company_visible` で未公開を除外
- `exclude: (r) => r.id === existingId`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/documents/tokyoDate.test.ts src/lib/documents/canMutateDocument.test.ts src/lib/documents/findDuplicate.test.ts -v`  
Expected: FAIL

- [ ] **Step 3: Implement**

`tokyoToday`: `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now ?? new Date())`

`canMutateDocument`: `isDeveloper` または `actorUserId === ownerUserId` または (`companyVisible` かつ role が `owner`/`admin`)

`findDuplicate`: keys を先頭から。kind が一致する行を集め、あればその集合の最新を返し後続 kind は見ない。

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Commit (skip unless user asked)**

---

### Task 4: Document OCR

**Files:**
- Create: `src/lib/image-analysis/document-ocr/parseVisionJson.ts`
- Test: `src/lib/image-analysis/document-ocr/parseVisionJson.test.ts`
- Create: `src/lib/image-analysis/document-ocr/documentOcr.ts`
- Test: `src/lib/image-analysis/document-ocr/documentOcr.test.ts`
- Modify: `src/lib/image-analysis/README.md`（`document-ocr/` を追加。駐車場専用と書かない）

**Interfaces:**
- Consumes: Gemini generateContent（既存 `analyzeWithGemini` または同等の POST）
- Produces:
  - `parseVisionJson(text: string): unknown | null`
  - `ocrDocument({ front, back?, plugin, apiKey, model, fetchImpl }) => { extracted, rawText, raw }`

- [ ] **Step 1: Write failing tests**

`parseVisionJson`: 素の JSON、````json` フェンス、不正文字列は `null`。

`documentOcr.test.ts`: `fetchImpl` モック。**parts 順は prompt → front → back**（1枚目=表面）。既存 `analyzeWithGemini` は previous が先・current が後なので、使うなら front を `previousImageBuffer`、back を `imageBuffer` にし、プロンプトを「1枚目（先の画像）=表面」に合わせる。テストで body.parts 順を assert。裏が無いときは画像1枚。

戻りは `mergeExtracted` 済み。raw が `{ full_name: ... }` 直下ならそれを front とみなす。

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run src/lib/image-analysis/document-ocr -v`

- [ ] **Step 3: Implement then PASS**

Gemini エラーは throw（API 層で空欄＋ `ocr_failed`）。

- [ ] **Step 4: Commit (skip unless user asked)**

---

### Task 5: Storage path helpers and tmp cleanup

**Files:**
- Create: `src/lib/documents/storagePaths.ts`
- Test: `src/lib/documents/storagePaths.test.ts`
- Create: `src/lib/documents/cleanupTmp.ts`
- Test: `src/lib/documents/cleanupTmp.test.ts`

**Interfaces:**
- Produces:
  - `BUCKET = "captured-documents"`
  - `tmpObjectPath(tenantId, userId, fileId)` → `{tenantId}/tmp/{userId}/{fileId}.jpg`
  - `finalObjectPath(tenantId, documentType, dateYmd, documentId, fileId)`
  - `isTmpPath(path, tenantId, userId): boolean`
  - `filesToDelete(entries, now, maxAgeMs)` — `maxAgeMs = 24 * 60 * 60 * 1000`

- [ ] **Step 1: Write failing tests then implement**

`isTmpPath` は tenant/user 不一致で false。`filesToDelete`: 25h 前は削除、1h 前と `created_at` 欠落は残す。`cleanupTmp` は list + `filesToDelete` + remove。判定ロジックは純関数でテスト。

- [ ] **Step 2: Commit (skip unless user asked)**

---

### Task 6: Analyze API and commit API

**Files:**
- Create: `src/app/api/documents/parseBody.ts`
- Test: `src/app/api/documents/parseBody.test.ts`
- Create: `src/app/api/documents/analyze/route.ts`
- Create: `src/app/api/documents/route.ts`（この Task では POST。GET は Task 7）

**Interfaces:**
- `POST /api/documents/analyze` `{ documentType, images: [{ role, path }] }`
  → `{ extracted, rawOcr, warning, analysisRunId, duplicate }`
- `POST /api/documents` `{ documentType, existingId?, companyVisible, notes, tags, contextDate, extracted, analysisRunId?, images: [{ role, tmpPath }] }`

- [ ] **Step 1: parseBody tests then implement**

未知 type、front 無し、tmp パスが `{tenant}/tmp/{user}/` 以外は throw。

- [ ] **Step 2: Implement POST analyze**

`getViewerContext` / `getActiveTenant`。401 / 403。`cleanupTmp` 失敗は無視。download → `ocrDocument`。throw なら extracted 全空、`warning: "ocr_failed"`、HTTP 200。`image_analysis_runs` insert（`captured_document_id` null, provider `gemini`）。可視行を fetch して `findDuplicate` + `canMutateDocument`。duplicate 時は signed URL。

- [ ] **Step 3: Implement POST commit**

`parseExtracted` をサーバで再実行。duplicate で `canMutate` false → 409。`companyVisible` オン時の会社側重複は mutate 可ならその行を更新、不可なら 409。INSERT/UPDATE で `owner_user_id` は INSERT 時のみ自分。tmp → `finalObjectPath` → images 張り替え。失敗時 INSERT は行削除して 500、UPDATE は旧画像を残して 500。`page` role は名刺では 400。可能なら `analysisRunId` に document id を後付け。

- [ ] **Step 4: 未ログイン POST が 401 になることを curl で確認**

- [ ] **Step 5: Commit (skip unless user asked)**

---

### Task 7: List, detail, patch, delete, re-analyze

**Files:**
- Modify: `src/app/api/documents/route.ts`（GET）
- Create: `src/app/api/documents/[id]/route.ts`
- Create: `src/app/api/documents/[id]/analyze/route.ts`

**Interfaces:**
- GET `/api/documents?type=&scope=own|company|all&q=&tag=&from=&to=&offset=`
  - own / company / all（all は RLS の SELECT＝自分の未公開 ∪ 会社公開）
  - ソート: `context_date desc nulls last`, `created_at desc`
  - limit 50、`hasMore`、表画像 signed URL
- GET/PATCH/DELETE `/api/documents/[id]`
- POST `/api/documents/[id]/analyze` — DB は変えず草案。`image_analysis_runs` に document id 付きで記録

PATCH の公開オンは Task 6 と同じ 409。DELETE は path を読んでから行削除、その後 storage remove。service_role は使わない。

- [ ] **Step 1: Implement the routes**

- [ ] **Step 2: Commit (skip unless user asked)**

---

### Task 8: Capture + confirm UI

**Files:**
- Create: `src/app/(tenant)/documents/new/page.tsx`
- Create: `src/app/(tenant)/documents/new/CaptureDocumentForm.tsx`

**Interfaces:**
- `type=business_card` 以外は 404。カメラ配線は `SendPictureForm.tsx` を参考。計算は `captureFrameFromVideo` を import
- 表 → 任意の裏 → tmp upload → analyze → 確認
- 確認: 写真切替、OCR 項目、メモ、タグチップ、会った日（初期値は page から `tokyoToday()` を props）、会社公開
- `duplicate.canMutate === false` → 読み取り専用、「ホルダーで開く」`/documents?type=business_card&open=<id>`
- 保存成功 → `/documents?type=business_card`
- OCR 失敗バナー。戻るで tmp `remove`
- 見た目は既存 `border-line` / `text-ink` / `bg-paper`

- [ ] **Step 1: Implement UI**

- [ ] **Step 2: Browser verify**

`/documents/new?type=business_card` で撮影 → 裏スキップ → 確認。キー未設定なら手入力保存に進めること。

- [ ] **Step 3: Commit (skip unless user asked)**

---

### Task 9: Holder UI, TOP, manual

**Files:**
- Create: `src/app/(tenant)/documents/page.tsx`
- Create: `src/app/(tenant)/documents/DocumentsAlbum.tsx`
- Modify: `src/app/(tenant)/page.tsx`
- Modify: `docs/manual/機能説明書.md`

**Interfaces:**
- フィルタ: 自分 / 会社公開 / 全部、タグ、会った日期間、検索
- グリッド: サムネ、title、counterparty、日付、バッジ「会社」
- 詳細: 編集、公開、削除、もう一度読む → 確認して PATCH
- `open` query で詳細を開く
- TOP カテゴリ「文書ホルダー」にカード2つ（lucide の IdCard 等。駐車場アイコンにしない）
- 機能説明書に「文書ホルダー（名刺）」を追加。写真レポート節は変えない。伝票・明細テーブルは v1 対象外と一文

- [ ] **Step 1: Implement album + TOP + 機能説明書**

一覧は `GET /api/documents`。

- [ ] **Step 2: Browser verify**

TOP 遷移、グリッド、フィルタ、メモが残ること。可能なら viewer での会社公開の見え方。不可なら RLS マトリクスを手動チェックリストに残す。

- [ ] **Step 3: Commit (skip unless user asked)**

---

## Self-review

**Spec coverage:** 確認して保存、裏任意、同一行の会社公開、重複更新、Gemini、RLS、tmp、再解析、TOP。伝票プラグインと `captured_document_line_items` は未着手（COMMENT のみ）。

**Placeholder scan:** マイグレーションは 0019。OCR 画像順は Task 4 で front→back。

**Type consistency:** `DocumentTypePlugin` / `getDocumentPlugin` / `findDuplicate` / `canMutateDocument` / `ocrDocument` / `BUCKET` を後続が同じ名前で使う。

---

Plan complete and saved to `docs/superpowers/plans/2026-08-28-captured-documents.md`. Two execution options:

**1. Subagent-Driven (recommended)** - タスクごとに新しいサブエージェント、間にレビュー

**2. Inline Execution** - このセッションで executing-plans に従い、チェックポイント付きで実装

Which approach?
