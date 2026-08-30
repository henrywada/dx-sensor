# 監視イベント履歴の保存・閲覧機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「監視状況」タブの停止時に3種類の停止方法（一時停止／保存して停止／停止のみ）を選択できるモーダルを追加し、「保存して停止」時はイベント履歴・画像を「履歴ファイル」として永続化する。「アクティブ履歴」タブには履歴ファイルを一覧・復元閲覧できる機能を追加する。

**Architecture:** 停止区分の判定と履歴アーカイブ／復元のオーケストレーションは `runMonitorTick.ts` と同じ「純粋関数 + 注入された deps」パターンで `src/lib/monitor/monitorSession.ts` に切り出し、vitestで単体テストする。実際のSupabase呼び出しは `MonitorAnalyzeView.tsx` 内で deps 実装として組み立てる（既存の `clearOwnMonitorEvents` / `openEventCompare` と同じく、クライアントから直接 `supabase-js` を呼ぶ既存パターンを踏襲）。DBは新規テーブル `monitor_sessions`（アーカイブされたセッションのメタ情報）と、`monitor_change_events.session_id`（null=現在の未アーカイブ履歴、非null=アーカイブ済み）で表現する。

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres + RLS), vitest。

**Spec:** ユーザーからの直接指示（本会話内）。以下に要件を転記する。

```
１．「監視状況」タグの「停止」ボタンを押すと、モーダルで下を表示し「イベント履歴・画像」を保存する。
タイトル：停止する種類を選択してください。
ラジオボタン：
〇 一時停止する（再開は可能）
〇 イベント履歴・画像を保存して停止する（再開は出来ません）
〇 停止のみ（イベント履歴・画像を保存しない。再開は出来ません。）

ボタンのクリック処理：
〇 一時停止する：監視を停止する。ボタン「監視の開始」を有効にする。
〇 イベント履歴・画像を保存して停止する：監視を停止する。「イベント履歴・画像」を「日付 + 監視開始時間+停止時間」の区分で履歴ファイルに保存する。ボタン「監視の開始」を無効にする。
〇 停止のみ：監視を停止する。ボタン「監視の開始」を無効にする。

２．「アクティブ履歴」タグの「更新」ボタンの前に「履歴ファイルを見る」ボタンを付ける。
「監視が停止」した状態の時のみボタンを表示。それ以外の時は非表示にする。
ボタンを押した時、現在の「イベント履歴・画像」が消されることを警告し、現ファイルの「イベント履歴・画像」を削除する。
モーダルで「日付・開始時間・停止時間」のリストを表示し、選択された「イベント履歴・画像」を「履歴ファイル」からコピーする。
そして、ボタン「監視の開始」を非表示にする。
```

## Global Constraints

- 汎用プラットフォーム原則（dx-sensor CLAUDE.md）：テーブル名・関数名を駐車場固有語彙に固定しない。既存の `monitor_*` 命名パターン（テナント種別非依存）をそのまま踏襲する。
- 全テナントスコープのテーブルは `tenant_id` で隔離し、RLSを有効化する（既存 `monitor_change_events` / `auto_captures` と同一パターン）。
- 開発者アカウントのメールアドレスをポリシーにハードコードしない。
- モーダルのタイトル文言・ラジオボタン文言はユーザー指示の文言を一字一句そのまま使う。
- 警告ダイアログは既存コードベースの慣習に合わせ `window.confirm` を使う（`AlbumView.tsx` / `InvoiceAlbum.tsx` 等で既に使われているパターン）。
- 新規追加するオーケストレーションロジックは `runMonitorTick.ts` と同じ「deps注入 + vitestユニットテスト」パターンに揃える。

## Design Decisions（要確認事項を含む）

1. **「監視の開始」の無効化・非表示状態はページリロードで保持されない。** 既存実装でも `monitoring` はクライアント側 state のみで永続化されておらず（リロードすれば常に「監視の開始」ボタンから始まる）、今回追加する `monitoringLocked` / `historyViewMode` も同じ扱いにする。DB側に「現在の監視ステータス」を持たせる恒久ロックは要求されていないため実装しない。ユーザーの意図と異なる場合は追加要望として対応する。
2. **「画像」の対象範囲**：「画像表示」タブ（`auto_captures` 全件ギャラリー）はセッションに紐付かない独立した一覧のため、アーカイブ／削除／復元の対象外とする。今回の「イベント履歴・画像」とは、`monitor_change_events` の各行とそれが参照する `prev_capture_id` / `curr_capture_id`（＝監視状況タブの今回画像・前回画像、イベント履歴の比較画像）を指すものとして実装する。
3. **一時停止→再開の継続性**：既存の `handleStartMonitoring` は呼ぶたびに `monitoringStartedAt` ・カウント・画像表示を全リセットしていたが、これだと「一時停止して再開」してもアーカイブ時の開始時刻がずれ、かつ直前の比較画像が失われる。今回のセッション概念（開始時刻〜停止時刻でイベントをグルーピングする）を正しく機能させるため、「一時停止からの再開」は状態を引き継ぎ、「新規の開始」時のみ全リセットするよう `handleStartMonitoring` を修正する（Task 5で詳細）。

---

### Task 1: DBマイグレーション — `monitor_sessions` テーブルと `session_id` 列

**Files:**
- Create: `supabase/migrations/20260830100000_monitor_sessions.sql`

**Interfaces:**
- Produces: テーブル `monitor_sessions(id, tenant_id, user_id, started_at, stopped_at, created_at)`。列 `monitor_change_events.session_id`（nullable, FK→`monitor_sessions.id`）。RLSポリシー `monitor_sessions_select_own` / `monitor_sessions_insert_own` / `monitor_change_events_update_own`。以降のタスクはこれらのテーブル・列・ポリシー名をそのまま使う。

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
-- supabase/migrations/20260830100000_monitor_sessions.sql
--
-- 「履歴ファイル」機能: 監視を保存付きで停止したときのイベント履歴・画像を
-- 過去分としてアーカイブし、後から選んで一覧・復元閲覧できるようにする。
-- 汎用化方針（CLAUDE.md）に沿い、駐車場固有の語彙を持ち込まず、
-- 既存の monitor_* 系テーブルの命名パターンを踏襲する。

create table if not exists monitor_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  stopped_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table monitor_sessions is
  '「イベント履歴・画像を保存して停止する」で確定した監視区間の記録（履歴ファイル一覧の単位）。';

alter table monitor_sessions enable row level security;

create policy "monitor_sessions_select_own"
  on monitor_sessions for select using (user_id = auth.uid());
create policy "monitor_sessions_insert_own"
  on monitor_sessions for insert with check (user_id = auth.uid());

create index if not exists monitor_sessions_user_started_idx
  on monitor_sessions (user_id, started_at desc);

grant select, insert on public.monitor_sessions to authenticated;

-- monitor_change_events をセッションに紐付けられるようにする。
-- session_id が null のままの行が「現在（未アーカイブ）」の履歴。
alter table monitor_change_events
  add column if not exists session_id uuid references monitor_sessions(id);

create index if not exists monitor_change_events_session_idx
  on monitor_change_events (session_id);

-- アーカイブ時に既存イベント行へ session_id を書き込むために update 権限が必要
-- （これまでは select/insert/delete のみで update ポリシーが無かった）。
create policy "monitor_change_events_update_own"
  on monitor_change_events for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant update on public.monitor_change_events to authenticated;
```

- [ ] **Step 2: ローカルDBに適用して確認する**

Run: `cd /home/hr-dx/ai-projects/dx-sensor && supabase db reset` (ローカルスタック使用時。リモートのみ運用の場合は `supabase db push` または Supabase ダッシュボードのSQL Editorで同内容を実行する)

Expected: エラーなく完了し、`monitor_sessions` テーブルと `monitor_change_events.session_id` 列が作成されている。

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260830100000_monitor_sessions.sql
git commit -m "feat: 監視セッションの履歴アーカイブ用テーブルを追加"
```

---

### Task 2: `monitorSession.ts` — 停止区分の判定とアーカイブ／復元オーケストレーション

**Files:**
- Create: `src/lib/monitor/monitorSession.ts`
- Test: `src/lib/monitor/monitorSession.test.ts`

**Interfaces:**
- Consumes: なし（純粋関数 + 注入されたdeps。DBスキーマはTask 1の `monitor_sessions` / `monitor_change_events.session_id`）
- Produces: `StopChoice`, `planStopAction(choice): StopActionPlan`, `MonitorSession`, `formatSessionRangeLabel(session): string`, `ArchivedEventRow`, `MonitorSessionDeps`, `archiveCurrentSession(input, deps)`, `clearCurrentEvents(userId, deps)`, `restoreSessionToCurrent(sessionId, tenantId, userId, deps)`。Task 5・6のコンポーネント側実装がこれらをそのまま import する。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/monitor/monitorSession.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  archiveCurrentSession,
  clearCurrentEvents,
  formatSessionRangeLabel,
  planStopAction,
  restoreSessionToCurrent,
  type MonitorSessionDeps,
} from "./monitorSession";

function createDeps(overrides: Partial<MonitorSessionDeps> = {}): MonitorSessionDeps {
  return {
    createSession: vi.fn(async () => ({ id: "session-1" })),
    tagCurrentEventsToSession: vi.fn(async () => undefined),
    listSavedSessions: vi.fn(async () => []),
    fetchSessionEvents: vi.fn(async () => []),
    insertCurrentEvents: vi.fn(async () => undefined),
    deleteCurrentEvents: vi.fn(async () => []),
    deleteCaptureIfUnreferenced: vi.fn(async () => false),
    ...overrides,
  };
}

describe("planStopAction", () => {
  it("一時停止では再開可能な状態を維持する", () => {
    expect(planStopAction("pause")).toEqual({
      shouldArchive: false,
      shouldLockStartButton: false,
    });
  });

  it("保存して停止ではアーカイブし開始ボタンをロックする", () => {
    expect(planStopAction("save_and_stop")).toEqual({
      shouldArchive: true,
      shouldLockStartButton: true,
    });
  });

  it("停止のみではアーカイブせず開始ボタンをロックする", () => {
    expect(planStopAction("stop_only")).toEqual({
      shouldArchive: false,
      shouldLockStartButton: true,
    });
  });
});

describe("formatSessionRangeLabel", () => {
  it("日付と開始〜停止時刻を含むラベルを返す", () => {
    const label = formatSessionRangeLabel({
      id: "s1",
      startedAt: "2026-08-30T08:43:14.000Z",
      stoppedAt: "2026-08-30T09:02:10.000Z",
    });
    expect(label).toMatch(/\d{2}:\d{2}:\d{2}〜\d{2}:\d{2}:\d{2}/);
    expect(label).toContain("〜");
  });
});

describe("archiveCurrentSession", () => {
  it("セッションを作成し、その時間帯の現在イベントをタグ付けする", async () => {
    const deps = createDeps({
      createSession: vi.fn(async () => ({ id: "session-42" })),
    });

    const result = await archiveCurrentSession(
      {
        tenantId: "tenant-1",
        userId: "user-1",
        startedAt: "2026-08-30T08:00:00.000Z",
        stoppedAt: "2026-08-30T08:30:00.000Z",
      },
      deps
    );

    expect(deps.createSession).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      startedAt: "2026-08-30T08:00:00.000Z",
      stoppedAt: "2026-08-30T08:30:00.000Z",
    });
    expect(deps.tagCurrentEventsToSession).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-42",
      startedAt: "2026-08-30T08:00:00.000Z",
      stoppedAt: "2026-08-30T08:30:00.000Z",
    });
    expect(result.id).toBe("session-42");
  });
});

describe("clearCurrentEvents", () => {
  it("削除された行が参照するキャプチャを重複なく後始末する", async () => {
    const deps = createDeps({
      deleteCurrentEvents: vi.fn(async () => [
        { prevCaptureId: "cap-1", currCaptureId: "cap-2" },
        { prevCaptureId: "cap-2", currCaptureId: "cap-3" },
      ]),
    });

    await clearCurrentEvents("user-1", deps);

    expect(deps.deleteCurrentEvents).toHaveBeenCalledWith("user-1");
    expect(deps.deleteCaptureIfUnreferenced).toHaveBeenCalledTimes(3);
    const calledIds = (deps.deleteCaptureIfUnreferenced as ReturnType<typeof vi.fn>).mock.calls
      .map(([id]: [string]) => id)
      .sort();
    expect(calledIds).toEqual(["cap-1", "cap-2", "cap-3"]);
  });

  it("削除対象が無ければ後始末を呼ばない", async () => {
    const deps = createDeps({ deleteCurrentEvents: vi.fn(async () => []) });

    await clearCurrentEvents("user-1", deps);

    expect(deps.deleteCaptureIfUnreferenced).not.toHaveBeenCalled();
  });
});

describe("restoreSessionToCurrent", () => {
  it("アーカイブ済みイベントを現在イベントとして複製する", async () => {
    const rows = [
      {
        prevCaptureId: "cap-1",
        currCaptureId: "cap-2",
        diffScore: 0.1,
        severity: "notify" as const,
        aiSummary: "変化を検知",
        emailQueued: true,
        analysisTool: "sharp+SSIM+pixelmatch",
        createdAt: "2026-08-30T08:10:00.000Z",
      },
    ];
    const deps = createDeps({ fetchSessionEvents: vi.fn(async () => rows) });

    await restoreSessionToCurrent("session-1", "tenant-1", "user-1", deps);

    expect(deps.fetchSessionEvents).toHaveBeenCalledWith("session-1");
    expect(deps.insertCurrentEvents).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      rows,
    });
  });

  it("イベントが無ければ挿入しない", async () => {
    const deps = createDeps({ fetchSessionEvents: vi.fn(async () => []) });

    await restoreSessionToCurrent("session-1", "tenant-1", "user-1", deps);

    expect(deps.insertCurrentEvents).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/lib/monitor/monitorSession.test.ts`
Expected: FAIL（`./monitorSession` モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```typescript
// src/lib/monitor/monitorSession.ts

export type StopChoice = "pause" | "save_and_stop" | "stop_only";

export type StopActionPlan = {
  shouldArchive: boolean;
  shouldLockStartButton: boolean;
};

/**
 * 停止モーダルの3択（一時停止／保存して停止／停止のみ）から、
 * アーカイブ要否と「監視の開始」ボタンのロック要否を導出する。
 */
export function planStopAction(choice: StopChoice): StopActionPlan {
  switch (choice) {
    case "pause":
      return { shouldArchive: false, shouldLockStartButton: false };
    case "save_and_stop":
      return { shouldArchive: true, shouldLockStartButton: true };
    case "stop_only":
      return { shouldArchive: false, shouldLockStartButton: true };
  }
}

export type MonitorSession = {
  id: string;
  startedAt: string; // ISO
  stoppedAt: string; // ISO
};

const SESSION_DATE_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const SESSION_TIME_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** 「日付 + 監視開始時間+停止時間」のラベルを組み立てる（履歴ファイル一覧の表示用）。 */
export function formatSessionRangeLabel(session: MonitorSession): string {
  const start = new Date(session.startedAt);
  const stop = new Date(session.stoppedAt);
  return `${SESSION_DATE_FORMAT.format(start)} ${SESSION_TIME_FORMAT.format(
    start
  )}〜${SESSION_TIME_FORMAT.format(stop)}`;
}

export type ArchivedEventRow = {
  prevCaptureId: string;
  currCaptureId: string;
  diffScore: number;
  severity: "skip" | "minor" | "notify";
  aiSummary: string | null;
  emailQueued: boolean;
  analysisTool: string | null;
  createdAt: string; // ISO
};

export type ArchiveSessionInput = {
  tenantId: string;
  userId: string;
  startedAt: string; // ISO
  stoppedAt: string; // ISO
};

export type MonitorSessionDeps = {
  createSession: (input: ArchiveSessionInput) => Promise<{ id: string }>;
  tagCurrentEventsToSession: (input: {
    userId: string;
    sessionId: string;
    startedAt: string;
    stoppedAt: string;
  }) => Promise<void>;
  listSavedSessions: (userId: string) => Promise<MonitorSession[]>;
  fetchSessionEvents: (sessionId: string) => Promise<ArchivedEventRow[]>;
  insertCurrentEvents: (input: {
    tenantId: string;
    userId: string;
    rows: ArchivedEventRow[];
  }) => Promise<void>;
  /** 「現在」（session_id無し）のイベントを削除し、削除した行が参照していたキャプチャIDを返す。 */
  deleteCurrentEvents: (
    userId: string
  ) => Promise<Array<{ prevCaptureId: string; currCaptureId: string }>>;
  deleteCaptureIfUnreferenced: (captureId: string) => Promise<boolean>;
};

/** 「イベント履歴・画像を保存して停止する」: 新規セッション行を作り、現在イベントをタグ付けする。 */
export async function archiveCurrentSession(
  input: ArchiveSessionInput,
  deps: MonitorSessionDeps
): Promise<MonitorSession> {
  const session = await deps.createSession(input);
  await deps.tagCurrentEventsToSession({
    userId: input.userId,
    sessionId: session.id,
    startedAt: input.startedAt,
    stoppedAt: input.stoppedAt,
  });
  return { id: session.id, startedAt: input.startedAt, stoppedAt: input.stoppedAt };
}

/** 「履歴ファイルを見る」実行前に、現在（未アーカイブ）のイベント・画像を削除する。 */
export async function clearCurrentEvents(
  userId: string,
  deps: MonitorSessionDeps
): Promise<void> {
  const deletedRows = await deps.deleteCurrentEvents(userId);
  const captureIds = new Set<string>();
  for (const row of deletedRows) {
    captureIds.add(row.prevCaptureId);
    captureIds.add(row.currCaptureId);
  }
  await Promise.all(
    Array.from(captureIds).map((id) => deps.deleteCaptureIfUnreferenced(id))
  );
}

/** 選択された履歴ファイル（アーカイブ済みセッション）のイベントを「現在」として複製する。 */
export async function restoreSessionToCurrent(
  sessionId: string,
  tenantId: string,
  userId: string,
  deps: MonitorSessionDeps
): Promise<void> {
  const rows = await deps.fetchSessionEvents(sessionId);
  if (rows.length === 0) return;
  await deps.insertCurrentEvents({ tenantId, userId, rows });
}
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `npx vitest run src/lib/monitor/monitorSession.test.ts`
Expected: PASS（全11ケース）

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitor/monitorSession.ts src/lib/monitor/monitorSession.test.ts
git commit -m "feat: 監視セッションのアーカイブ・復元ロジックを追加"
```

---

### Task 3: `monitorButtonState.ts` — ボタンの表示・活性状態の判定

**Files:**
- Create: `src/lib/monitor/monitorButtonState.ts`
- Test: `src/lib/monitor/monitorButtonState.test.ts`

**Interfaces:**
- Consumes: なし（純粋関数）
- Produces: `resolveStartButtonState(input): { visible: boolean; disabled: boolean }`, `resolveHistoryFilesButtonVisible(monitoring): boolean`。Task 5・6のコンポーネント側レンダリングがこれらを使う。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/monitor/monitorButtonState.test.ts
import { describe, expect, it } from "vitest";
import {
  resolveHistoryFilesButtonVisible,
  resolveStartButtonState,
} from "./monitorButtonState";

describe("resolveStartButtonState", () => {
  it("初期状態（未ロック・履歴閲覧でない）は表示・活性", () => {
    expect(
      resolveStartButtonState({ monitoringLocked: false, historyViewMode: false })
    ).toEqual({ visible: true, disabled: false });
  });

  it("停止のみ／保存して停止の後はロックされ非活性", () => {
    expect(
      resolveStartButtonState({ monitoringLocked: true, historyViewMode: false })
    ).toEqual({ visible: true, disabled: true });
  });

  it("履歴ファイル閲覧中は完全に非表示", () => {
    expect(
      resolveStartButtonState({ monitoringLocked: false, historyViewMode: true })
    ).toEqual({ visible: false, disabled: true });
    expect(
      resolveStartButtonState({ monitoringLocked: true, historyViewMode: true })
    ).toEqual({ visible: false, disabled: true });
  });
});

describe("resolveHistoryFilesButtonVisible", () => {
  it("監視停止中のみ表示する", () => {
    expect(resolveHistoryFilesButtonVisible(false)).toBe(true);
    expect(resolveHistoryFilesButtonVisible(true)).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/lib/monitor/monitorButtonState.test.ts`
Expected: FAIL（`./monitorButtonState` モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```typescript
// src/lib/monitor/monitorButtonState.ts

export type StartButtonState = {
  visible: boolean;
  disabled: boolean;
};

/**
 * 「監視の開始」ボタンの表示・活性状態を導出する。
 * 呼び出し側は `monitoring === false` のときだけこの結果を使う
 * （monitoring === true のときは常に「停止」ボタンを表示・活性で出す）。
 */
export function resolveStartButtonState(input: {
  monitoringLocked: boolean;
  historyViewMode: boolean;
}): StartButtonState {
  if (input.historyViewMode) {
    return { visible: false, disabled: true };
  }
  return { visible: true, disabled: input.monitoringLocked };
}

/** 「履歴ファイルを見る」ボタンは監視が停止している状態でのみ表示する。 */
export function resolveHistoryFilesButtonVisible(monitoring: boolean): boolean {
  return !monitoring;
}
```

- [ ] **Step 4: テストを実行してパスを確認する**

Run: `npx vitest run src/lib/monitor/monitorButtonState.test.ts`
Expected: PASS（全5ケース）

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitor/monitorButtonState.ts src/lib/monitor/monitorButtonState.test.ts
git commit -m "feat: 監視開始・履歴ボタンの表示ロジックを追加"
```

---

### Task 4: `GET /api/monitor/events` を「現在」のイベントのみに絞り込む

既存の `clearOwnMonitorEvents`（マウント時の全削除）と `GET /api/monitor/events` はどちらも `session_id` の概念が無いため、アーカイブ済みイベントまで削除・混在表示してしまう。両方を「`session_id is null` の行のみ」に絞る。

**Files:**
- Modify: `src/app/api/monitor/events/route.ts:12-18`
- Modify: `src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx:207-217`（`clearOwnMonitorEvents`）

**Interfaces:**
- Consumes: Task 1の `monitor_change_events.session_id` 列
- Produces: 変更なし（既存の `MonitorEvent[]` 形状のまま、対象行が絞られるだけ）

- [ ] **Step 1: `GET /api/monitor/events` のクエリに絞り込みを追加する**

`src/app/api/monitor/events/route.ts:12-18` を次のように変更する:

```typescript
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("monitor_change_events")
    .select(
      "id, user_id, tenant_id, prev_capture_id, curr_capture_id, diff_score, severity, ai_summary, email_queued, analysis_tool, created_at"
    )
    .eq("user_id", viewer.userId)
    .is("session_id", null)
    .order("created_at", { ascending: false });
```

- [ ] **Step 2: `clearOwnMonitorEvents` に絞り込みを追加する**

`src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx:207-217` を次のように変更する:

```typescript
  // /capture_auto と同様、画面を開くたびに自分の古い「現在」イベント履歴を
  // クリアする（ベストエフォート。失敗しても画面の表示は続行する）。
  // アーカイブ済み（session_id が付いた）履歴ファイルはここでは消さない。
  const clearOwnMonitorEvents = useCallback(async () => {
    try {
      const { error } = await supabase
        .from("monitor_change_events")
        .delete()
        .eq("user_id", userId)
        .is("session_id", null);
      if (error) throw error;
    } catch (err) {
      console.error("clearOwnMonitorEvents failed", err);
    }
  }, [supabase, userId]);
```

- [ ] **Step 3: 型チェックを実行する**

Run: `cd /home/hr-dx/ai-projects/dx-sensor && npx tsc --noEmit --pretty false`
Expected: 新規のエラーが出ない（既存のエラーがあれば別途対応、今回の変更由来のエラーが無いことを確認）

- [ ] **Step 4: Commit**

```bash
git add src/app/api/monitor/events/route.ts src/app/\(tenant\)/capture_auto_analyze/MonitorAnalyzeView.tsx
git commit -m "fix: イベント履歴の取得・自動クリアをアーカイブ済み履歴ファイル除外で絞り込む"
```

---

### Task 5: 停止確認モーダル + 一時停止／再開の状態継続

**Files:**
- Modify: `src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx`

**Interfaces:**
- Consumes: `StopChoice`, `planStopAction`, `archiveCurrentSession`, `MonitorSessionDeps`（Task 2）, `resolveStartButtonState`（Task 3）
- Produces: state `stopModalOpen`, `stopChoice`, `monitoringLocked`, `monitorSessionDeps`（Task 6が再利用する）

- [ ] **Step 1: import と型を追加する**

`MonitorAnalyzeView.tsx` の先頭 import ブロック（4-14行目付近）に追記する:

```typescript
import {
  archiveCurrentSession,
  type MonitorSession,
  type MonitorSessionDeps,
  type StopChoice,
  planStopAction,
} from "@/lib/monitor/monitorSession";
import {
  resolveHistoryFilesButtonVisible,
  resolveStartButtonState,
} from "@/lib/monitor/monitorButtonState";
```

- [ ] **Step 2: 停止モーダル用のstateを追加する**

`monitoring` 系stateの宣言ブロック（154-167行目付近、`const [monitoring, ...]` の並び）に追記する:

```typescript
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [stopChoice, setStopChoice] = useState<StopChoice>("pause");
  const [monitoringLocked, setMonitoringLocked] = useState(false);
  const [historyViewMode, setHistoryViewMode] = useState(false);
```

- [ ] **Step 3: `monitorSessionDeps` を組み立てる**

`loadImages` の定義（301-348行目）の直後に追加する:

```typescript
  const monitorSessionDeps = useMemo<MonitorSessionDeps>(
    () => ({
      async createSession({ tenantId, userId: ownerId, startedAt, stoppedAt }) {
        const { data, error } = await supabase
          .from("monitor_sessions")
          .insert({
            tenant_id: tenantId,
            user_id: ownerId,
            started_at: startedAt,
            stopped_at: stoppedAt,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(error?.message ?? "履歴の保存に失敗しました");
        return { id: data.id };
      },

      async tagCurrentEventsToSession({ userId: ownerId, sessionId, startedAt, stoppedAt }) {
        const { error } = await supabase
          .from("monitor_change_events")
          .update({ session_id: sessionId })
          .eq("user_id", ownerId)
          .is("session_id", null)
          .gte("created_at", startedAt)
          .lte("created_at", stoppedAt);
        if (error) throw new Error(error.message);
      },

      async listSavedSessions(ownerId): Promise<MonitorSession[]> {
        const { data, error } = await supabase
          .from("monitor_sessions")
          .select("id, started_at, stopped_at")
          .eq("user_id", ownerId)
          .order("started_at", { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          id: row.id as string,
          startedAt: row.started_at as string,
          stoppedAt: row.stopped_at as string,
        }));
      },

      async fetchSessionEvents(sessionId) {
        const { data, error } = await supabase
          .from("monitor_change_events")
          .select(
            "prev_capture_id, curr_capture_id, diff_score, severity, ai_summary, email_queued, analysis_tool, created_at"
          )
          .eq("session_id", sessionId);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          prevCaptureId: row.prev_capture_id as string,
          currCaptureId: row.curr_capture_id as string,
          diffScore: row.diff_score as number,
          severity: row.severity as "skip" | "minor" | "notify",
          aiSummary: row.ai_summary as string | null,
          emailQueued: row.email_queued as boolean,
          analysisTool: row.analysis_tool as string | null,
          createdAt: row.created_at as string,
        }));
      },

      async insertCurrentEvents({ tenantId, userId: ownerId, rows }) {
        const { error } = await supabase.from("monitor_change_events").insert(
          rows.map((row) => ({
            tenant_id: tenantId,
            user_id: ownerId,
            prev_capture_id: row.prevCaptureId,
            curr_capture_id: row.currCaptureId,
            diff_score: row.diffScore,
            severity: row.severity,
            ai_summary: row.aiSummary,
            email_queued: row.emailQueued,
            analysis_tool: row.analysisTool,
            created_at: row.createdAt,
            session_id: null,
          }))
        );
        if (error) throw new Error(error.message);
      },

      async deleteCurrentEvents(ownerId) {
        const { data, error } = await supabase
          .from("monitor_change_events")
          .delete()
          .eq("user_id", ownerId)
          .is("session_id", null)
          .select("prev_capture_id, curr_capture_id");
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          prevCaptureId: row.prev_capture_id as string,
          currCaptureId: row.curr_capture_id as string,
        }));
      },

      async deleteCaptureIfUnreferenced(captureId) {
        const { data, error } = await supabase.rpc("delete_capture_if_unreferenced", {
          p_capture_id: captureId,
        });
        if (error) {
          console.error("deleteCaptureIfUnreferenced failed", error);
          return false;
        }
        if (!data) return false;
        await supabase.storage.from("auto-captures").remove([data as string]);
        return true;
      },
    }),
    [supabase]
  );
```

- [ ] **Step 4: `handleStartMonitoring` を「新規開始」と「一時停止からの再開」で分岐させる**

`handleStartMonitoring`（547-562行目）を次のように置き換える:

```typescript
  function handleStartMonitoring() {
    // monitoringStartedAt が既に設定されている＝一時停止からの再開。
    // アーカイブ時の「開始時間」を保つため、また直前の比較画像・カウントを
    // 失わないため、新規開始のときだけ状態を全リセットする。
    const isFreshStart = monitoringStartedAt === null;
    const startedAt = monitoringStartedAt ?? new Date().toISOString();

    setMonitoringStartedAt(startedAt);
    setMonitoring(true);
    setActiveTab("status");
    setTickError(null);

    if (isFreshStart) {
      setLastSeverity(null);
      setLastDiffScore(null);
      setLastMessage("監視を開始しました。次の画像を確認しています。");
      setPrevImageUrl(null);
      setCurrImageUrl(null);
      setPrevImageNo(null);
      setCurrImageNo(null);
      setMonitorCount(0);
      lastCurrCaptureIdRef.current = null;
    } else {
      setLastMessage("監視を再開しました。");
    }
  }
```

- [ ] **Step 5: 停止ボタンをモーダルオープンに置き換え、確定処理を追加する**

`handleStopMonitoring`（564-567行目）を削除し、代わりに以下を追加する:

```typescript
  function openStopModal() {
    setStopChoice("pause");
    setStopModalOpen(true);
  }

  async function handleConfirmStop() {
    const plan = planStopAction(stopChoice);
    const startedAt = monitoringStartedAt;
    const stoppedAt = new Date().toISOString();

    setMonitoring(false);
    setStopModalOpen(false);

    if (plan.shouldArchive && startedAt) {
      try {
        await archiveCurrentSession(
          { tenantId, userId, startedAt, stoppedAt },
          monitorSessionDeps
        );
        setLastMessage("監視を停止し、イベント履歴・画像を履歴ファイルに保存しました。");
      } catch (err) {
        setLastMessage(
          err instanceof Error
            ? `履歴の保存に失敗しました: ${err.message}`
            : "履歴の保存に失敗しました。"
        );
      }
    } else if (plan.shouldLockStartButton) {
      setLastMessage("監視を停止しました。");
    } else {
      setLastMessage("監視を一時停止しました。「監視の開始」で再開できます。");
    }

    if (plan.shouldLockStartButton) {
      // 再開不可の停止なので、次に「監視の開始」が有効化される場合は
      // 新規セッションとして扱う。
      setMonitoringStartedAt(null);
    }
    setMonitoringLocked(plan.shouldLockStartButton);
  }
```

`tenantId` はコンポーネントのpropsに既に存在する（`MonitorAnalyzeViewProps`）ので追加の取得は不要。

- [ ] **Step 6: 監視状況タブのボタン表示を更新する**

`activeTab === "status"` セクション内、開始/停止ボタン（779-799行目）を次のように置き換える:

```tsx
            <div className="flex flex-wrap items-center gap-2">
              {monitoring ? (
                <button
                  type="button"
                  onClick={openStopModal}
                  className="inline-flex items-center gap-2 rounded-md bg-alert px-4 py-2 text-sm font-medium text-white transition hover:bg-alert/90"
                >
                  <Square className="h-4 w-4" strokeWidth={1.75} />
                  停止
                </button>
              ) : (
                (() => {
                  const startButtonState = resolveStartButtonState({
                    monitoringLocked,
                    historyViewMode,
                  });
                  if (!startButtonState.visible) return null;
                  return (
                    <button
                      type="button"
                      onClick={handleStartMonitoring}
                      disabled={startButtonState.disabled}
                      className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="h-4 w-4" strokeWidth={1.75} />
                      監視の開始
                    </button>
                  );
                })()
              )}
            </div>
```

- [ ] **Step 7: 停止確認モーダルのJSXを追加する**

`templateModalOpen` のモーダル（1063-1105行目）の直前に追加する:

```tsx
      {stopModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stop-modal-title"
          onClick={() => setStopModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-line bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="stop-modal-title" className="text-base font-semibold text-ink">
              停止する種類を選択してください
            </h2>
            <div className="mt-4 space-y-3">
              {(
                [
                  ["pause", "一時停止する（再開は可能）"],
                  [
                    "save_and_stop",
                    "イベント履歴・画像を保存して停止する（再開は出来ません）",
                  ],
                  [
                    "stop_only",
                    "停止のみ（イベント履歴・画像を保存しない。再開は出来ません。）",
                  ],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-2 text-sm text-ink"
                >
                  <input
                    type="radio"
                    name="stop-choice"
                    value={value}
                    checked={stopChoice === value}
                    onChange={() => setStopChoice(value)}
                    className="mt-0.5 accent-signal"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStopModalOpen(false)}
                className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-signal/50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmStop()}
                className="rounded-md bg-alert px-4 py-2 text-sm font-medium text-white transition hover:bg-alert/90"
              >
                実行
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 8: 型チェックを実行する**

Run: `cd /home/hr-dx/ai-projects/dx-sensor && npx tsc --noEmit --pretty false`
Expected: エラーなし

- [ ] **Step 9: Commit**

```bash
git add src/app/\(tenant\)/capture_auto_analyze/MonitorAnalyzeView.tsx
git commit -m "feat: 監視停止時に一時停止／保存して停止／停止のみを選択するモーダルを追加"
```

---

### Task 6: 「アクティブ履歴」タブに履歴ファイル一覧・復元機能を追加

**Files:**
- Modify: `src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx`

**Interfaces:**
- Consumes: `clearCurrentEvents`, `restoreSessionToCurrent`, `formatSessionRangeLabel`, `MonitorSession`（Task 2）, `resolveHistoryFilesButtonVisible`（Task 3）, `monitorSessionDeps`（Task 5）

- [ ] **Step 1: 履歴ファイル一覧用のstateを追加する**

Task 5の Step 2 で追加した state ブロックの直後に追記する:

```typescript
  const [historyListModalOpen, setHistoryListModalOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<MonitorSession[]>([]);
  const [historyFilesLoading, setHistoryFilesLoading] = useState(false);
  const [historyFilesError, setHistoryFilesError] = useState<string | null>(null);
```

- [ ] **Step 2: ハンドラを追加する**

`handleConfirmStop`（Task 5 Step 5）の直後に追加する:

```typescript
  async function handleOpenHistoryFiles() {
    if (
      !window.confirm(
        "現在のイベント履歴・画像は削除されます。よろしいですか？"
      )
    ) {
      return;
    }

    setHistoryFilesError(null);
    setHistoryFilesLoading(true);
    try {
      await clearCurrentEvents(userId, monitorSessionDeps);
      const sessions = await monitorSessionDeps.listSavedSessions(userId);
      setSavedSessions(sessions);
      setHistoryListModalOpen(true);
      void loadEvents();
      void loadImages();
    } catch (err) {
      setHistoryFilesError(
        err instanceof Error ? err.message : "履歴ファイルの読み込みに失敗しました"
      );
    } finally {
      setHistoryFilesLoading(false);
    }
  }

  async function handleSelectHistorySession(session: MonitorSession) {
    setHistoryFilesError(null);
    try {
      await restoreSessionToCurrent(session.id, tenantId, userId, monitorSessionDeps);
      setHistoryListModalOpen(false);
      setHistoryViewMode(true);
      void loadEvents();
      void loadImages();
    } catch (err) {
      setHistoryFilesError(
        err instanceof Error ? err.message : "履歴ファイルの復元に失敗しました"
      );
    }
  }
```

- [ ] **Step 3: 「履歴ファイルを見る」ボタンを「更新」ボタンの前に追加する**

`activeTab === "history"` セクション内、「更新」ボタン（908-914行目）を次のように置き換える:

```tsx
            <div className="flex shrink-0 items-center gap-2">
              {resolveHistoryFilesButtonVisible(monitoring) && (
                <button
                  type="button"
                  onClick={() => void handleOpenHistoryFiles()}
                  disabled={historyFilesLoading}
                  className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
                >
                  履歴ファイルを見る
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadEvents()}
                className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
              >
                更新
              </button>
            </div>
```

この置き換えに伴い、直前の親要素 `<div className="flex flex-wrap items-start justify-between gap-3">`（872行目）の子要素構成が「見出し部分」＋この新しいボタン群の2要素になる（既存の「見出し部分」`<div className="min-w-0 flex-1">...</div>` はそのまま）。

- [ ] **Step 4: エラーメッセージ表示を追加する**

Step 3で置き換えたボタン群のブロックの直後、`{eventsLoading && ...}` の直前に追加する:

```tsx
          {historyFilesError && (
            <p className="mt-4 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
              {historyFilesError}
            </p>
          )}
```

- [ ] **Step 5: 履歴ファイル一覧モーダルのJSXを追加する**

Task 5 Step 7 で追加した停止確認モーダルの直後に追加する:

```tsx
      {historyListModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-list-modal-title"
          onClick={() => setHistoryListModalOpen(false)}
        >
          <div
            className="flex max-h-[min(80vh,640px)] w-full max-w-lg flex-col rounded-lg border border-line bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3">
              <h2 id="history-list-modal-title" className="text-base font-semibold text-ink">
                履歴ファイル
              </h2>
              <button
                type="button"
                onClick={() => setHistoryListModalOpen(false)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">
              {savedSessions.length === 0 && (
                <p className="py-4 text-sm text-ink-soft">保存された履歴ファイルはありません。</p>
              )}
              {savedSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => void handleSelectHistorySession(session)}
                  className="w-full border-b border-line/70 py-3 text-left last:border-b-0 hover:bg-paper/80"
                >
                  <p className="text-sm font-medium text-ink">
                    {formatSessionRangeLabel(session)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 6: 型チェックを実行する**

Run: `cd /home/hr-dx/ai-projects/dx-sensor && npx tsc --noEmit --pretty false`
Expected: エラーなし

- [ ] **Step 7: Commit**

```bash
git add src/app/\(tenant\)/capture_auto_analyze/MonitorAnalyzeView.tsx
git commit -m "feat: アクティブ履歴タブに履歴ファイルの一覧・復元閲覧を追加"
```

---

### Task 7: 全体の動作確認（ローカルDB + ブラウザ）

**Files:**
- なし（検証のみ）

- [ ] **Step 1: 全ユニットテストを実行する**

Run: `cd /home/hr-dx/ai-projects/dx-sensor && npx vitest run`
Expected: 既存分含め全てPASS

- [ ] **Step 2: 開発サーバーを起動する**

Run: `cd /home/hr-dx/ai-projects/dx-sensor && npm run dev`
Expected: `http://localhost:3000` で起動

- [ ] **Step 3: ブラウザで一連のシナリオを手動確認する**

`/capture_auto_analyze` を開き、以下を確認する:
1. 「監視状況」タブで「監視の開始」→「停止」を押すと、指定文言のモーダルが出る。
2. 「一時停止する」を選ぶと監視が止まり「監視の開始」が有効のまま。再度「監視の開始」を押すと、監視カウント・前回画像がリセットされずに継続する。
3. 「イベント履歴・画像を保存して停止する」を選ぶと、監視が止まり「監視の開始」が無効化される。
4. 「アクティブ履歴」タブに「履歴ファイルを見る」ボタンが表示される（監視中は非表示になることも確認）。
5. 「履歴ファイルを見る」を押すと警告が出て、確認すると現在のイベントが消え、履歴ファイル一覧モーダルが開く。
6. 一覧から1件選ぶと、「アクティブ履歴」「監視状況」に選んだ区間のイベント・画像が表示され、「監視の開始」ボタンが非表示になる。
7. 「停止のみ」選択時も「監視の開始」が無効化され、履歴ファイル一覧には追加されないことを確認する。

Expected: 上記すべてが仕様どおりに動作する。

- [ ] **Step 4: lintを実行する**

Run: `cd /home/hr-dx/ai-projects/dx-sensor && npm run lint`
Expected: エラーなし

- [ ] **Step 5: Commit**（差分があれば）

```bash
git add -A
git commit -m "chore: 監視履歴アーカイブ機能の動作確認後の微調整"
```
