# スマホ定点監視の解析（capture_auto_analyze）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/capture_auto` の画像をブラウザ開閉中のみ監視し、差分→Gemini→変化記録する `/capture_auto_analyze` を実装する。

**Architecture:** クライアントは 10 秒 timer と 3 タブ UI のみ。各 tick は `POST /api/monitor/tick` が `frameDiffScore` →（必要時）2 枚 Gemini → `monitor_change_events` / `processed_at` / コストログを更新。設定はユーザ単位 DB。システムテンプレはコード定数。

**Tech Stack:** Next.js App Router, Supabase (RLS), Gemini via existing `src/lib/image-analysis/`, `frameDiff.ts`, Vitest

**Spec:** `docs/superpowers/specs/2026-08-26-capture-auto-analyze-design.md`

## Global Constraints

- 観測対象は汎用。駐車場語彙はテンプレ文言のみ。テーブル名は `monitor_*` / `auto_captures`
- 実メール送信は v1 対象外（`email_queued` まで）
- Gemini 固定。`image_analysis_runs.capture_id` は auto 経路では **null**
- コミットはユーザが明示したときのみ（このリポジトリのルール）。Plan 内の Commit ステップはスキップ可
- マイグレーション番号: `0012_monitor_analyze.sql`（既存に 0011 まであり）

## File map

| Path | Responsibility |
|------|----------------|
| `supabase/migrations/0012_monitor_analyze.sql` | `processed_at`, settings, events, RLS, GRANT |
| `src/lib/monitor/types.ts` | 共有型 |
| `src/lib/monitor/thresholds.ts` | diff → severity |
| `src/lib/monitor/buildMonitorPrompt.ts` | プロンプト組み立て |
| `src/lib/monitor/systemTemplates.ts` | システムテンプレ定数 |
| `src/lib/image-analysis/gemini/gemini.ts` | 2 画像対応拡張 |
| `src/app/api/monitor/settings/route.ts` | GET/PUT 設定 |
| `src/app/api/monitor/templates/route.ts` | GET テンプレ |
| `src/app/api/monitor/events/route.ts` | GET イベント |
| `src/app/api/monitor/tick/route.ts` | 監視 1 ステップ |
| `src/app/(tenant)/capture_auto_analyze/*` | ページ + UI |
| `src/app/(tenant)/page.tsx` | TOP カード |

---

### Task 1: DB migration

**Files:**
- Create: `supabase/migrations/0012_monitor_analyze.sql`

- [ ] **Step 1: Write migration**

```sql
-- 0012_monitor_analyze.sql
alter table auto_captures
  add column if not exists processed_at timestamptz;

create index if not exists auto_captures_unprocessed_idx
  on auto_captures (captured_by, created_at)
  where processed_at is null;

create table if not exists monitor_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  title text not null default '',
  email text,
  slot_values jsonb not null default '[]'::jsonb,
  template_id text,
  updated_at timestamptz not null default now()
);

alter table monitor_user_settings enable row level security;

create policy "monitor_user_settings_select_own"
  on monitor_user_settings for select using (user_id = auth.uid());
create policy "monitor_user_settings_insert_own"
  on monitor_user_settings for insert with check (user_id = auth.uid());
create policy "monitor_user_settings_update_own"
  on monitor_user_settings for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.monitor_user_settings to authenticated;

create table if not exists monitor_change_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  prev_capture_id uuid not null references auto_captures(id) on delete cascade,
  curr_capture_id uuid not null references auto_captures(id) on delete cascade,
  diff_score numeric not null,
  severity text not null check (severity in ('minor', 'notify')),
  ai_summary text,
  email_queued boolean not null default false,
  created_at timestamptz not null default now()
);

alter table monitor_change_events enable row level security;

create policy "monitor_change_events_select_own"
  on monitor_change_events for select using (user_id = auth.uid());
create policy "monitor_change_events_insert_own"
  on monitor_change_events for insert with check (user_id = auth.uid());

create index if not exists monitor_change_events_user_created_idx
  on monitor_change_events (user_id, created_at desc);

grant select, insert on public.monitor_change_events to authenticated;
```

- [ ] **Step 2: Apply locally**

Run: `supabase db push`（またはプロジェクトの適用手順）  
Expected: エラーなく適用

---

### Task 2: Monitor lib (types, thresholds, prompt, templates)

**Files:**
- Create: `src/lib/monitor/types.ts`
- Create: `src/lib/monitor/thresholds.ts`
- Create: `src/lib/monitor/thresholds.test.ts`
- Create: `src/lib/monitor/buildMonitorPrompt.ts`
- Create: `src/lib/monitor/buildMonitorPrompt.test.ts`
- Create: `src/lib/monitor/systemTemplates.ts`

**Interfaces:**
- Produces: `MonitorSeverity`, `classifyDiffScore(score): 'skip'|'minor'|'notify'`, `buildMonitorPrompt(...)`, `SYSTEM_MONITOR_TEMPLATES`

- [ ] **Step 1: Failing tests for thresholds**

```typescript
// src/lib/monitor/thresholds.test.ts
import { describe, expect, it } from "vitest";
import { classifyDiffScore } from "./thresholds";

describe("classifyDiffScore", () => {
  it("classifies skip / minor / notify", () => {
    expect(classifyDiffScore(0)).toBe("skip");
    expect(classifyDiffScore(0.019)).toBe("skip");
    expect(classifyDiffScore(0.02)).toBe("minor");
    expect(classifyDiffScore(0.079)).toBe("minor");
    expect(classifyDiffScore(0.08)).toBe("notify");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/lib/monitor/thresholds.test.ts`  
Expected: FAIL module not found / not a function

- [ ] **Step 3: Implement thresholds + types**

```typescript
// src/lib/monitor/types.ts
export type MonitorSeverity = "skip" | "minor" | "notify";

export type MonitorSlot = { label: string; default_value: string };

export type SystemMonitorTemplate = {
  id: string;
  title: string;
  slots: MonitorSlot[]; // length 10
};

export type MonitorUserSettings = {
  title: string;
  email: string | null;
  slotValues: string[]; // length 10
  templateId: string | null;
};
```

```typescript
// src/lib/monitor/thresholds.ts
import type { MonitorSeverity } from "./types";

export const DIFF_SKIP_BELOW = 0.02;
export const DIFF_NOTIFY_AT = 0.08;

export function classifyDiffScore(score: number): MonitorSeverity {
  if (score < DIFF_SKIP_BELOW) return "skip";
  if (score < DIFF_NOTIFY_AT) return "minor";
  return "notify";
}
```

- [ ] **Step 4: Run thresholds test — PASS**

- [ ] **Step 5: Failing test for buildMonitorPrompt**

```typescript
import { describe, expect, it } from "vitest";
import { buildMonitorPrompt } from "./buildMonitorPrompt";

describe("buildMonitorPrompt", () => {
  it("includes title and labeled slots", () => {
    const prompt = buildMonitorPrompt({
      title: "駐車場監視",
      labels: ["画像全体説明", "監視ポイント"],
      values: ["駐車場", "空きか駐車中か"],
    });
    expect(prompt).toContain("駐車場監視");
    expect(prompt).toContain("画像全体説明: 駐車場");
    expect(prompt).toContain("監視ポイント: 空きか駐車中か");
    expect(prompt).toContain("2枚の画像");
  });
});
```

- [ ] **Step 6: Implement buildMonitorPrompt**

空値スロットは行ごと省略可。末尾に「前画像と後画像の2枚を比較し、監視ポイント／メール通知ポイントに沿って変化を日本語で簡潔に述べよ。」を付ける。

- [ ] **Step 7: systemTemplates.ts**

駐車場例 1 件。`slots` は必ず 10。例ラベル: 画像全体説明 / 駐車場所 / 監視ポイント / メール通知ポイント ほか。

- [ ] **Step 8: Run all monitor unit tests — PASS**

Run: `npx vitest run src/lib/monitor/`

---

### Task 3: Gemini two-image support

**Files:**
- Modify: `src/lib/image-analysis/gemini/gemini.ts`
- Modify: `src/lib/image-analysis/gemini/gemini.test.ts`

**Note:** 既存 `analyzeWithGemini` は 1 画像。監視は prev+curr の 2 枚が必須。

- [ ] **Step 1: Extend analyzeWithGemini to accept optional second image**

例: options または input に `previousImageBuffer` / `previousMimeType`。  
`parts` に text → prev inline_data → curr inline_data の順。

- [ ] **Step 2: Update unit test with mocked fetch asserting 2 inline_data parts**

- [ ] **Step 3: Tests PASS**

---

### Task 4: Settings + templates + events APIs

**Files:**
- Create: `src/app/api/monitor/settings/route.ts`
- Create: `src/app/api/monitor/templates/route.ts`
- Create: `src/app/api/monitor/events/route.ts`

**Interfaces:**
- GET settings → `{ title, email, slotValues, templateId }` or defaults when no row
- PUT settings body same shape; upsert on `user_id`
- GET templates → `SYSTEM_MONITOR_TEMPLATES`
- GET events → latest 20 for `auth.uid()`, order created_at desc

- [ ] **Step 1: Implement templates GET**（認証必須、`getViewerContext`）

- [ ] **Step 2: Implement settings GET/PUT**

- [ ] **Step 3: Implement events GET**

---

### Task 5: `POST /api/monitor/tick`

**Files:**
- Create: `src/app/api/monitor/tick/route.ts`
- Create: `src/lib/monitor/runMonitorTick.ts`
- Create: `src/lib/monitor/runMonitorTick.test.ts`

**Request body:**

```typescript
{
  prevCaptureId: string | null;
  title: string;
  email: string | null;
  labels: string[];
  slotValues: string[];
}
```

**Response:**

```typescript
{
  status: "waiting" | "baseline" | "processed";
  severity: "skip" | "minor" | "notify" | null;
  diffScore: number | null;
  prevCaptureId: string | null;
  currCaptureId: string | null;
  prevSignedUrl: string | null;
  currSignedUrl: string | null;
  summary: string | null;
  eventId: string | null;
  message?: string;
}
```

**Logic:**

1. Auth + `getActiveTenant`
2. Next unprocessed `auto_captures` for user+tenant (`processed_at is null`, oldest first)
3. None → `{ status: "waiting" }`
4. `prevCaptureId` null → mark processed, return `{ status: "baseline", severity: "skip", curr... }`
5. Diff → classify → skip (no event) / minor|notify (Gemini 2-img, insert event, cost log with capture_id null)
6. `email_queued = severity==='notify' && Boolean(email?.trim())`

- [ ] **Step 1: Unit-test branches with mocked deps**

- [ ] **Step 2: Implement runMonitorTick + route**

- [ ] **Step 3: Tests PASS**

---

### Task 6: Page shell + tabs

**Files:**
- Create: `src/app/(tenant)/capture_auto_analyze/page.tsx`
- Create: `src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx`

- [ ] **Step 1: page.tsx** — login gate + tenant; pass userId/tenantId

- [ ] **Step 2: 3 tabs** — 監視条件の設定 / 監視状況 / 画像表示

---

### Task 7: Settings tab UI

- [ ] **Step 1: Load settings + templates on mount**

- [ ] **Step 2: Icon modal, title, email, 10 boxes, save, start**

- [ ] **Step 3: Start → monitoring=true, switch to status**

---

### Task 8: Status tab + timer

- [ ] **Step 1: 10s interval → POST tick with last curr as prev**

- [ ] **Step 2: Two images, 3 lamps, events list**

- [ ] **Step 3: Stop + unmount clear interval**

---

### Task 9: Images tab

- [ ] **Step 1: Filter 全部 / 今回の監視分**

- [ ] **Step 2: Grid with signed URLs**

---

### Task 10: TOP card

**Files:**
- Modify: `src/app/(tenant)/page.tsx`

- [ ] **Step 1: Add「監視分析を見る」under スマホ監視カメラ → `/capture_auto_analyze`**

---

### Task 11: Manual E2E

- [ ] capture_auto で撮影 → analyze で開始 → ランプ・2画像・フィルタ・TOP・コストログ確認

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Migration | 1 |
| Lib / templates | 2 |
| Gemini 2 images | 3 |
| Settings/templates/events API | 4 |
| Tick | 5 |
| UI tabs | 6–9 |
| TOP | 10 |
| E2E | 11 |
