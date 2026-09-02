# LINE友だち招待機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既にアカウントを持つテナントメンバーのうち、まだLINE公式アカウントを友だち追加していない人に対し、管理画面からメールで招待を送り、メール内URLで表示されるQRコードをLINEでスキャンするだけで友だち追加とアカウント紐付けが完了するようにする。

**Architecture:** テナント管理者が対象メンバーを選択→`line_friend_invites`にトークンを発行しResendでメール送信→受信者がURLを開くと`service_role`でトークンを検証しQRコード（個人専用のLIFF URLを符号化）を表示→LINEでスキャンするとLIFFが起動し、ID token検証を経て`line_friends`に`linked`で紐付ける。新規アカウント作成は行わず、既存のLIFF基盤（`verifyLineIdToken`・`line_friends`テーブル・`/liff`配下のエンドポイントURL設定）をそのまま再利用する。

**Tech Stack:** Next.js 14 (App Router) / TypeScript / Supabase (Auth, Postgres, RLS) / Vitest / `resend`（メール送信）/ `qrcode`（QRコード生成）/ 既存の `@line/liff`・`jose`

**Spec:** `docs/superpowers/specs/2026-09-02-line-friend-invite-design.md`（関連: `docs/superpowers/specs/2026-09-02-line-integration-design.md`）

## Global Constraints

- 新規マイグレーションのファイル名はタイムスタンプ形式 `YYYYMMDDHHMMSS_description.sql` に従うこと
- `authenticated` ロールへのGRANTは新規テーブルごとに明示的に付与すること（`0007_grant_authenticated_tenant_members.sql`のGRANT漏れの教訓。既存のLINE連携でも同じ方針を踏襲済み）
- APIのリクエストボディ検証は既存の手動バリデーションパターン（`isRecord` + 型ガード）に従うこと。zodは使わない
- 対象者は既存の`tenant_members`ユーザーのみ。新規`auth.users`作成は行わない（既存のLIFF招待フロー`tenant_member_invites`/`invite-accept`とは完全に別物）
- QRコードは個人専用のLIFF URL（`https://liff.line.me/<LIFF_ID>?t=<招待トークン>`）を符号化する。LINE公式の汎用「友だち追加」QRは使わない
- 招待トークンの生成には既存の `src/lib/line/inviteToken.ts` の `generateInviteToken()` / `inviteExpiryDate()`（TTL 72時間）をそのまま再利用する。複製しない
- テストファイルは対象ファイルと同じディレクトリに `*.test.ts` として配置し、`npx vitest run <path>` で実行する（`package.json`に`test`スクリプトは無い）
- `route.ts`（Supabase呼び出しを含むAPIハンドラ本体）は、既存コードベースの慣習（`src/app/api/line/*/route.ts`にテストが無い）に倣い自動テスト対象としない。実データでの検証は最終タスクの手動検証でcurl等を用いて行う
- UIのスタイリングは既存のTailwindトークン（`bg-paper`, `border-line`, `text-ink`, `text-ink-soft`, `text-alert`, `bg-signal`）を使い、独自の配色を持ち込まない
- LIFFの「Add friend option」設定（LINE Developersコンソール）を`Normal`または`Aggressive`に変更する必要がある。既存の`/liff/entry`・`/liff/link`と同一LIFF IDを共有するため、この設定変更が既存フローに影響しないことを最終タスクで確認する

---

## File Structure

```
supabase/migrations/
  20260902130000_line_friend_invites.sql   [new]

src/lib/email/
  sendEmail.ts                     [new] Resendラッパー（DI可能なclient引数）
  sendEmail.test.ts                [new]
  buildFriendInviteEmail.ts        [new] 招待メールの件名・本文組み立て（純粋関数）
  buildFriendInviteEmail.test.ts   [new]

src/lib/line/
  friendInviteQrCode.ts            [new] LIFF URL組み立て + QRコードdata URL生成
  friendInviteQrCode.test.ts       [new]
  friendInviteCandidates.ts        [new] 未フォローメンバー抽出 + メールアドレス解決

src/app/api/tenant-members/friend-invites/
  route.ts          [new]
  parseBody.ts       [new]
  parseBody.test.ts  [new]

src/app/api/line/friend-link-accept/
  route.ts          [new]
  parseBody.ts       [new]
  parseBody.test.ts  [new]

src/app/line-friend-invite/[token]/
  page.tsx          [new] QRコード表示（認証不要の公開ページ、サーバーコンポーネント）

src/app/liff/friend-link/[token]/
  page.tsx                 [new]
  LiffFriendLinkView.tsx   [new]

src/app/(tenant)/members/friend-invites/
  page.tsx                    [new] サーバーコンポーネント：候補一覧取得＋権限チェック
  FriendInviteSendForm.tsx    [new] クライアントコンポーネント：チェックボックス選択＋送信

src/lib/supabase/server.ts [modify] createServiceSupabase()のコメントに新規ユースケースを追記

package.json     [modify] resend, qrcode, @types/qrcode を追加
.env.example     [modify] RESEND_API_KEY, EMAIL_FROM を追記
```

---

### Task 1: 依存パッケージ追加・環境変数の追記

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: `resend`（`Resend`クラス）と`qrcode`（`QRCode.toDataURL`）が以降のタスクでimport可能になる

- [ ] **Step 1: 依存パッケージをインストール**

```bash
npm install resend qrcode
npm install --save-dev @types/qrcode
```

- [ ] **Step 2: `.env.example` にメール送信関連のenv varを追記**

`.env.example` の末尾に以下を追記する:

```bash
# LINE友だち招待機能（メール送信）
RESEND_API_KEY=
EMAIL_FROM=
```

- [ ] **Step 3: コミット**

```bash
git add package.json package-lock.json pnpm-lock.yaml .env.example
git commit -m "feat: LINE友だち招待機能向けにresend/qrcodeを追加"
```

---

### Task 2: DBマイグレーション — `line_friend_invites`

**Files:**
- Create: `supabase/migrations/20260902130000_line_friend_invites.sql`

**Interfaces:**
- Consumes: 既存の `tenants`, `auth.users` テーブル、`is_app_developer()` / `has_tenant_role()` 関数（`0001_init.sql`）
- Produces: `line_friend_invites` テーブル（列: `id, tenant_id, user_id, invite_token, created_by, expires_at, used_at, created_at`）。Task 7・8で使用

- [ ] **Step 1: マイグレーションファイルを作成**

```sql
-- 20260902130000_line_friend_invites.sql
-- LINE友だち招待: 既存アカウント保有者向けの「友だち追加のみ」の招待トークン

create table line_friend_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invite_token text not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists line_friend_invites_tenant_idx
  on line_friend_invites (tenant_id, created_at desc);
create index if not exists line_friend_invites_token_idx
  on line_friend_invites (invite_token);

alter table line_friend_invites enable row level security;

create policy line_friend_invites_admin_only on line_friend_invites
  for all using (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  );

grant select, insert, update, delete on public.line_friend_invites to authenticated;
```

- [ ] **Step 2: ローカルDBに適用**

```bash
supabase migration up
```

- [ ] **Step 3: テーブルとRLSが有効になっていることを確認**

Supabase StudioのSQL Editor（またはCLI経由）で以下を実行し、行が1件返ることを確認する:

```sql
select relrowsecurity from pg_class where relname = 'line_friend_invites';
```

Expected: `t`（RLS有効）

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/20260902130000_line_friend_invites.sql
git commit -m "feat: line_friend_invitesテーブルを追加"
```

---

### Task 3: lib — メール送信ラッパー（Resend）

**Files:**
- Create: `src/lib/email/sendEmail.ts`
- Test: `src/lib/email/sendEmail.test.ts`

**Interfaces:**
- Produces: `EmailClient`型、`sendEmail(params: { client: EmailClient; from: string; to: string | string[]; subject: string; html: string }): Promise<{ ok: true } | { ok: false; error: string }>`。Task 7で使用（実クライアントとして`new Resend(apiKey)`を渡す）

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/email/sendEmail.test.ts
import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "./sendEmail";

describe("sendEmail", () => {
  it("returns ok:true when the client succeeds", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "email_1" }, error: null });

    const result = await sendEmail({
      client: { emails: { send } },
      from: "noreply@example.com",
      to: "user@example.com",
      subject: "件名",
      html: "<p>本文</p>",
    });

    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "user@example.com",
      subject: "件名",
      html: "<p>本文</p>",
    });
  });

  it("returns ok:false with the error message when the client fails", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: "invalid recipient" } });

    const result = await sendEmail({
      client: { emails: { send } },
      from: "noreply@example.com",
      to: "bad-address",
      subject: "件名",
      html: "<p>本文</p>",
    });

    expect(result).toEqual({ ok: false, error: "invalid recipient" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/email/sendEmail.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: sendEmail.tsを実装する**

```typescript
// src/lib/email/sendEmail.ts
export type EmailClient = {
  emails: {
    send: (params: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
    }) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

export async function sendEmail(params: {
  client: EmailClient;
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { client, from, to, subject, html } = params;

  const { error } = await client.emails.send({ from, to, subject, html });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/email/sendEmail.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/email/sendEmail.ts src/lib/email/sendEmail.test.ts
git commit -m "feat: Resendラッパー(sendEmail)を追加"
```

---

### Task 4: lib — 招待メール本文組み立て

**Files:**
- Create: `src/lib/email/buildFriendInviteEmail.ts`
- Test: `src/lib/email/buildFriendInviteEmail.test.ts`

**Interfaces:**
- Produces: `buildFriendInviteEmail(params: { tenantName: string; inviteUrl: string }): { subject: string; html: string }`。Task 7で使用

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/email/buildFriendInviteEmail.test.ts
import { describe, expect, it } from "vitest";
import { buildFriendInviteEmail } from "./buildFriendInviteEmail";

describe("buildFriendInviteEmail", () => {
  it("includes the tenant name in the subject", () => {
    const { subject } = buildFriendInviteEmail({
      tenantName: "サンプル駐車場",
      inviteUrl: "https://example.com/line-friend-invite/tok123",
    });
    expect(subject).toContain("サンプル駐車場");
  });

  it("includes the invite URL in the html body", () => {
    const { html } = buildFriendInviteEmail({
      tenantName: "サンプル駐車場",
      inviteUrl: "https://example.com/line-friend-invite/tok123",
    });
    expect(html).toContain("https://example.com/line-friend-invite/tok123");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/email/buildFriendInviteEmail.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: buildFriendInviteEmail.tsを実装する**

```typescript
// src/lib/email/buildFriendInviteEmail.ts
export type FriendInviteEmailParams = {
  tenantName: string;
  inviteUrl: string;
};

export function buildFriendInviteEmail(
  params: FriendInviteEmailParams
): { subject: string; html: string } {
  const { tenantName, inviteUrl } = params;

  return {
    subject: `【${tenantName}】LINE友だち追加のお願い`,
    html: [
      `<p>${tenantName}の管理者より、LINE公式アカウントの友だち追加をお願いします。</p>`,
      `<p>下記のリンクを開き、表示されるQRコードをLINEアプリで読み取ってください。</p>`,
      `<p><a href="${inviteUrl}">${inviteUrl}</a></p>`,
      `<p>このリンクの有効期限は発行から72時間です。</p>`,
    ].join("\n"),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/email/buildFriendInviteEmail.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/email/buildFriendInviteEmail.ts src/lib/email/buildFriendInviteEmail.test.ts
git commit -m "feat: 友だち招待メールの本文組み立てを追加"
```

---

### Task 5: lib — QRコード生成

**Files:**
- Create: `src/lib/line/friendInviteQrCode.ts`
- Test: `src/lib/line/friendInviteQrCode.test.ts`

**Interfaces:**
- Produces: `buildFriendInviteLiffUrl(liffId: string, token: string): string`、`generateFriendInviteQrDataUrl(url: string): Promise<string>`。Task 9で使用

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/line/friendInviteQrCode.test.ts
import { describe, expect, it } from "vitest";
import { buildFriendInviteLiffUrl, generateFriendInviteQrDataUrl } from "./friendInviteQrCode";

describe("buildFriendInviteLiffUrl", () => {
  it("builds a liff.line.me URL with the token as a query param", () => {
    expect(buildFriendInviteLiffUrl("1234567890-abcdEFGH", "tok_ABC123")).toBe(
      "https://liff.line.me/1234567890-abcdEFGH?t=tok_ABC123"
    );
  });

  it("URL-encodes special characters in the token", () => {
    expect(buildFriendInviteLiffUrl("liff-id", "a+b/c=")).toBe(
      "https://liff.line.me/liff-id?t=a%2Bb%2Fc%3D"
    );
  });
});

describe("generateFriendInviteQrDataUrl", () => {
  it("returns a PNG data URL", async () => {
    const dataUrl = await generateFriendInviteQrDataUrl("https://liff.line.me/x?t=y");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/line/friendInviteQrCode.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: friendInviteQrCode.tsを実装する**

```typescript
// src/lib/line/friendInviteQrCode.ts
import QRCode from "qrcode";

export function buildFriendInviteLiffUrl(liffId: string, token: string): string {
  return `https://liff.line.me/${liffId}?t=${encodeURIComponent(token)}`;
}

export async function generateFriendInviteQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 320 });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/line/friendInviteQrCode.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/line/friendInviteQrCode.ts src/lib/line/friendInviteQrCode.test.ts
git commit -m "feat: 友だち招待QRコード生成ロジックを追加"
```

---

### Task 6: lib — 未フォローメンバー抽出

**Files:**
- Create: `src/lib/line/friendInviteCandidates.ts`

**Interfaces:**
- Consumes: `createServerSupabase` / `createServiceSupabase`（既存 `src/lib/supabase/server.ts`）
- Produces: `FriendInviteCandidate`型（`{ userId: string; email: string }`）、`listFriendInviteCandidates(tenantId: string): Promise<FriendInviteCandidate[]>`。Task 11で使用

このタスクはSupabaseへの実接続が前提のため、既存コードベースの慣習（`src/lib/admin/members.ts`の`listMembers`等と同様）に倣い自動テストを書かない。動作確認は最終タスクの手動検証で行う。

- [ ] **Step 1: friendInviteCandidates.tsを実装する**

```typescript
// src/lib/line/friendInviteCandidates.ts
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

export type FriendInviteCandidate = {
  userId: string;
  email: string;
};

export async function listFriendInviteCandidates(
  tenantId: string
): Promise<FriendInviteCandidate[]> {
  const supabase = createServerSupabase();

  const { data: members, error: membersError } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId);
  if (membersError) throw membersError;

  const { data: friends, error: friendsError } = await supabase
    .from("line_friends")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "linked");
  if (friendsError) throw friendsError;

  const linkedUserIds = new Set((friends ?? []).map((row) => row.user_id as string));
  const candidateUserIds = (members ?? [])
    .map((row) => row.user_id as string)
    .filter((userId) => !linkedUserIds.has(userId));

  if (candidateUserIds.length === 0) return [];

  const service = createServiceSupabase();
  const emailById = await listEmailsByUserIds(service, candidateUserIds);

  return candidateUserIds.map((userId) => ({
    userId,
    email: emailById.get(userId) ?? "(メール不明)",
  }));
}

async function listEmailsByUserIds(
  supabase: ReturnType<typeof createServiceSupabase>,
  userIds: string[]
): Promise<Map<string, string>> {
  const targetIds = new Set(userIds);
  const map = new Map<string, string>();
  const perPage = 1000;
  let page = 1;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      if (targetIds.has(user.id)) map.set(user.id, user.email ?? "");
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  return map;
}
```

- [ ] **Step 2: 型チェックが通ることを確認**

```bash
npx tsc --noEmit --pretty false
```

Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
git add src/lib/line/friendInviteCandidates.ts
git commit -m "feat: 未フォローテナントメンバーの抽出ロジックを追加"
```

---

### Task 7: API — `POST /api/tenant-members/friend-invites`

**Files:**
- Create: `src/app/api/tenant-members/friend-invites/parseBody.ts`
- Test: `src/app/api/tenant-members/friend-invites/parseBody.test.ts`
- Create: `src/app/api/tenant-members/friend-invites/route.ts`
- Modify: `src/lib/supabase/server.ts`

**Interfaces:**
- Consumes: `getViewerContext`・`getActiveTenant`（既存）、`generateInviteToken`・`inviteExpiryDate`（Task 2以前の既存`src/lib/line/inviteToken.ts`）、`buildFriendInviteEmail`（Task 4）、`sendEmail`・`EmailClient`（Task 3）、`line_friend_invites`テーブル（Task 2）
- Produces: `POST /api/tenant-members/friend-invites` エンドポイント。成功時 `200 { results: { userId: string; ok: boolean; error?: string }[] }`、権限無し `403`、未ログイン `401`、リクエスト不正 `400`、サーバー未設定 `500`

- [ ] **Step 1: 失敗するテストを書く（parseBody）**

```typescript
// src/app/api/tenant-members/friend-invites/parseBody.test.ts
import { describe, expect, it } from "vitest";
import { parseFriendInviteBody } from "./parseBody";

describe("parseFriendInviteBody", () => {
  it("parses a valid body", () => {
    const userIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    expect(parseFriendInviteBody({ userIds })).toEqual({ userIds });
  });

  it("dedupes duplicate userIds", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseFriendInviteBody({ userIds: [id, id] })).toEqual({ userIds: [id] });
  });

  it("rejects an empty array", () => {
    expect(() => parseFriendInviteBody({ userIds: [] })).toThrow();
  });

  it("rejects a non-uuid entry", () => {
    expect(() => parseFriendInviteBody({ userIds: ["not-a-uuid"] })).toThrow();
  });

  it("rejects a missing userIds", () => {
    expect(() => parseFriendInviteBody({})).toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/app/api/tenant-members/friend-invites/parseBody.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: parseBody.tsを実装する**

```typescript
// src/app/api/tenant-members/friend-invites/parseBody.ts
export type ParsedFriendInviteBody = { userIds: string[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFriendInviteBody(body: unknown): ParsedFriendInviteBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { userIds } = body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new Error("invalid userIds");
  }
  for (const userId of userIds) {
    if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
      throw new Error("invalid userIds");
    }
  }

  return { userIds: [...new Set(userIds)] };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/app/api/tenant-members/friend-invites/parseBody.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: `src/lib/supabase/server.ts`のコメントを更新する**

`createServiceSupabase`のコメント内の箇条書きに、以下を追記する（既存の3項目の下に4項目目として追加）:

```typescript
 *  - LINE友だち招待機能(api/tenant-members/friend-invites, api/line/friend-link-accept,
 *    /line-friend-invite/[token]) — line_friend_invites/line_friendsの読み書きと
 *    対象メンバーのメールアドレス解決にservice_roleが必要なため
```

- [ ] **Step 6: route.tsを実装する**

```typescript
// src/app/api/tenant-members/friend-invites/route.ts
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { buildFriendInviteEmail } from "@/lib/email/buildFriendInviteEmail";
import { sendEmail, type EmailClient } from "@/lib/email/sendEmail";
import { generateInviteToken, inviteExpiryDate } from "@/lib/line/inviteToken";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { parseFriendInviteBody } from "./parseBody";

const ADMIN_ROLES = new Set(["owner", "admin", "developer"]);

type SendResult = { userId: string; ok: boolean; error?: string };

export async function POST(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant || !ADMIN_ROLES.has(tenant.role)) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  let parsed;
  try {
    parsed = parseFriendInviteBody(await req.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  if (!resendApiKey || !emailFrom) {
    console.error("Resend env vars are not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const rls = createServerSupabase();
  const service = createServiceSupabase();
  const resend = new Resend(resendApiKey);
  const origin = new URL(req.url).origin;

  const { data: tenantRow } = await service
    .from("tenants")
    .select("name")
    .eq("id", tenant.tenantId)
    .maybeSingle();
  const tenantName = tenantRow?.name ?? "dx-sensor";

  const results: SendResult[] = [];

  for (const userId of parsed.userIds) {
    const { data: member } = await rls
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenant.tenantId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!member) {
      results.push({ userId, ok: false, error: "not_a_member" });
      continue;
    }

    const { data: userData, error: userError } = await service.auth.admin.getUserById(userId);
    if (userError || !userData?.user?.email) {
      results.push({ userId, ok: false, error: "email_not_found" });
      continue;
    }

    const inviteToken = generateInviteToken();
    const expiresAt = inviteExpiryDate();

    const { error: insertError } = await service.from("line_friend_invites").insert({
      tenant_id: tenant.tenantId,
      user_id: userId,
      invite_token: inviteToken,
      created_by: viewer.userId,
      expires_at: expiresAt.toISOString(),
    });

    if (insertError) {
      console.error("friend-invites: line_friend_invites insert failed", insertError);
      results.push({ userId, ok: false, error: "invite_creation_failed" });
      continue;
    }

    const inviteUrl = `${origin}/line-friend-invite/${inviteToken}`;
    const { subject, html } = buildFriendInviteEmail({ tenantName, inviteUrl });

    const sendResult = await sendEmail({
      // ResendのSDK型とEmailClient(テスト用に薄く定義した型)は完全一致しないため、
      // 実クライアントを渡す境界でのみキャストする。
      client: resend as unknown as EmailClient,
      from: emailFrom,
      to: userData.user.email,
      subject,
      html,
    });

    results.push(
      sendResult.ok
        ? { userId, ok: true }
        : { userId, ok: false, error: "email_send_failed" }
    );
  }

  return NextResponse.json({ results }, { status: 200 });
}
```

- [ ] **Step 7: コミット**

```bash
git add src/app/api/tenant-members/friend-invites/ src/lib/supabase/server.ts
git commit -m "feat: 友だち招待発行・メール送信API(POST /api/tenant-members/friend-invites)を追加"
```

---

### Task 8: API — `POST /api/line/friend-link-accept`

**Files:**
- Create: `src/app/api/line/friend-link-accept/parseBody.ts`
- Test: `src/app/api/line/friend-link-accept/parseBody.test.ts`
- Create: `src/app/api/line/friend-link-accept/route.ts`

**Interfaces:**
- Consumes: `verifyLineIdToken`（既存 `src/lib/line/verifyLineIdToken.ts`）、`createServiceSupabase`（既存）、`line_friend_invites`テーブル（Task 2）
- Produces: `POST /api/line/friend-link-accept` エンドポイント。成功時 `200 { ok: true }`、失敗時 `400/401/500 { error: "invalid_request" | "token_invalid" | "already_used" | "expired" | "link_failed" }`

- [ ] **Step 1: 失敗するテストを書く（parseBody）**

```typescript
// src/app/api/line/friend-link-accept/parseBody.test.ts
import { describe, expect, it } from "vitest";
import { parseFriendLinkAcceptBody } from "./parseBody";

describe("parseFriendLinkAcceptBody", () => {
  it("parses a valid body", () => {
    const result = parseFriendLinkAcceptBody({ idToken: "abc.def.ghi", inviteToken: "tok123" });
    expect(result).toEqual({ idToken: "abc.def.ghi", inviteToken: "tok123" });
  });

  it("rejects a missing idToken", () => {
    expect(() => parseFriendLinkAcceptBody({ inviteToken: "tok123" })).toThrow();
  });

  it("rejects an empty inviteToken", () => {
    expect(() =>
      parseFriendLinkAcceptBody({ idToken: "abc.def.ghi", inviteToken: "" })
    ).toThrow();
  });

  it("rejects a non-object body", () => {
    expect(() => parseFriendLinkAcceptBody("not an object")).toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/app/api/line/friend-link-accept/parseBody.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: parseBody.tsを実装する**

```typescript
// src/app/api/line/friend-link-accept/parseBody.ts
export type ParsedFriendLinkAcceptBody = { idToken: string; inviteToken: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFriendLinkAcceptBody(body: unknown): ParsedFriendLinkAcceptBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { idToken, inviteToken } = body;
  if (typeof idToken !== "string" || idToken.length === 0) {
    throw new Error("invalid idToken");
  }
  if (typeof inviteToken !== "string" || inviteToken.length === 0) {
    throw new Error("invalid inviteToken");
  }

  return { idToken, inviteToken };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/app/api/line/friend-link-accept/parseBody.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: route.tsを実装する**

```typescript
// src/app/api/line/friend-link-accept/route.ts
import { NextResponse } from "next/server";
import { verifyLineIdToken } from "@/lib/line/verifyLineIdToken";
import { createServiceSupabase } from "@/lib/supabase/server";
import { parseFriendLinkAcceptBody } from "./parseBody";

export async function POST(req: Request) {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) {
    console.error("LINE_LOGIN_CHANNEL_ID is not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  let parsed;
  try {
    parsed = parseFriendLinkAcceptBody(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let lineUserId: string;
  try {
    ({ lineUserId } = await verifyLineIdToken(parsed.idToken, channelId));
  } catch {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }

  const service = createServiceSupabase();

  const { data: invite, error: inviteError } = await service
    .from("line_friend_invites")
    .select("id, tenant_id, user_id, expires_at, used_at")
    .eq("invite_token", parsed.inviteToken)
    .maybeSingle();

  if (inviteError || !invite) {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }
  if (invite.used_at) {
    return NextResponse.json({ error: "already_used" }, { status: 401 });
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 401 });
  }

  const { error: upsertError } = await service.from("line_friends").upsert(
    {
      line_user_id: lineUserId,
      user_id: invite.user_id,
      tenant_id: invite.tenant_id,
      status: "linked",
      linked_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id" }
  );

  if (upsertError) {
    console.error("friend-link-accept: line_friends upsert failed", upsertError);
    return NextResponse.json({ error: "link_failed" }, { status: 500 });
  }

  await service
    .from("line_friend_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: コミット**

```bash
git add src/app/api/line/friend-link-accept/
git commit -m "feat: 友だち紐付けAPI(POST /api/line/friend-link-accept)を追加"
```

---

### Task 9: フロントエンド — QRコード表示画面

**Files:**
- Create: `src/app/line-friend-invite/[token]/page.tsx`

**Interfaces:**
- Consumes: `buildFriendInviteLiffUrl`・`generateFriendInviteQrDataUrl`（Task 5）、`createServiceSupabase`（既存）、`line_friend_invites`テーブル（Task 2）
- Produces: 認証不要の公開ページ `GET /line-friend-invite/[token]`

- [ ] **Step 1: page.tsxを実装する**

```tsx
// src/app/line-friend-invite/[token]/page.tsx
import { buildFriendInviteLiffUrl, generateFriendInviteQrDataUrl } from "@/lib/line/friendInviteQrCode";
import { createServiceSupabase } from "@/lib/supabase/server";

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md p-6 text-sm text-ink">
      <div className="rounded-lg border border-line bg-paper p-4 text-alert">{message}</div>
    </div>
  );
}

export default async function LineFriendInvitePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createServiceSupabase();

  const { data: invite } = await supabase
    .from("line_friend_invites")
    .select("expires_at, used_at")
    .eq("invite_token", params.token)
    .maybeSingle();

  if (!invite) {
    return <ErrorNotice message="このリンクは無効です。" />;
  }
  if (invite.used_at) {
    return <ErrorNotice message="このリンクは既に使用されています。" />;
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return <ErrorNotice message="このリンクの有効期限が切れています。管理者に再発行を依頼してください。" />;
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    console.error("NEXT_PUBLIC_LIFF_ID is not configured");
    return <ErrorNotice message="現在この機能はご利用いただけません。" />;
  }

  const liffUrl = buildFriendInviteLiffUrl(liffId, params.token);
  const qrDataUrl = await generateFriendInviteQrDataUrl(liffUrl);

  return (
    <div className="mx-auto max-w-md space-y-4 p-6 text-center">
      <p className="text-sm text-ink">
        LINEアプリのカメラ（またはQRコードリーダー）で、下のQRコードを読み取ってください。
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrDataUrl}
        alt="LINE友だち追加QRコード"
        width={320}
        height={320}
        className="mx-auto"
      />
      <p className="text-xs text-ink-soft">読み取ると友だち追加とアカウント連携が完了します。</p>
    </div>
  );
}
```

- [ ] **Step 2: 型チェックが通ることを確認**

```bash
npx tsc --noEmit --pretty false
```

Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
git add src/app/line-friend-invite/
git commit -m "feat: 友だち招待QRコード表示画面を追加"
```

---

### Task 10: フロントエンド — `/liff/friend-link/[token]`

**Files:**
- Create: `src/app/liff/friend-link/[token]/page.tsx`
- Create: `src/app/liff/friend-link/[token]/LiffFriendLinkView.tsx`

**Interfaces:**
- Consumes: `POST /api/line/friend-link-accept`（Task 8）、`@line/liff`（既存依存）
- Produces: `/liff/friend-link/[token]` ページ（`(tenant)`/`(admin)`/`(auth)`いずれのルートグループにも属さない独立ルート。`/liff/entry`・`/liff/link`と同様）

- [ ] **Step 1: LiffFriendLinkView.tsxを実装する**

```tsx
// src/app/liff/friend-link/[token]/LiffFriendLinkView.tsx
"use client";

import { useEffect, useState } from "react";

type LinkState = "loading" | "done" | "missing_token" | "error" | "expired" | "already_used";

const ERROR_MESSAGES: Record<Exclude<LinkState, "loading" | "done">, string> = {
  missing_token: "招待リンクが正しくありません。",
  expired: "招待の有効期限が切れています。管理者に再発行を依頼してください。",
  already_used: "この招待は既に使用されています。",
  error: "連携に失敗しました。もう一度お試しください。",
};

export function LiffFriendLinkView({ inviteToken }: { inviteToken: string }) {
  const [state, setState] = useState<LinkState>("loading");

  useEffect(() => {
    if (!inviteToken) {
      setState("missing_token");
      return;
    }

    let cancelled = false;

    async function run(token: string) {
      try {
        const liffModule = await import("@line/liff");
        const liff = liffModule.default;
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          if (!cancelled) setState("error");
          return;
        }

        const res = await fetch("/api/line/friend-link-accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, inviteToken: token }),
        });

        if (res.ok) {
          if (!cancelled) setState("done");
          return;
        }

        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (body.error === "expired") setState("expired");
          else if (body.error === "already_used") setState("already_used");
          else setState("error");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }

    run(inviteToken);
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  if (state === "loading") {
    return <p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>;
  }

  if (state === "done") {
    return (
      <p className="p-6 text-center text-sm text-ink">
        連携が完了しました。今後はLINEのリッチメニューからdx-sensorにアクセスできます。
      </p>
    );
  }

  return <p className="p-6 text-center text-sm text-alert">{ERROR_MESSAGES[state]}</p>;
}
```

- [ ] **Step 2: page.tsxを実装する**

```tsx
// src/app/liff/friend-link/[token]/page.tsx
import { LiffFriendLinkView } from "./LiffFriendLinkView";

export default function LiffFriendLinkPage({ params }: { params: { token: string } }) {
  return <LiffFriendLinkView inviteToken={params.token} />;
}
```

- [ ] **Step 3: 型チェックが通ることを確認**

```bash
npx tsc --noEmit --pretty false
```

Expected: エラー無し

- [ ] **Step 4: コミット**

```bash
git add src/app/liff/friend-link/
git commit -m "feat: LIFF友だち紐付けページ(/liff/friend-link/[token])を追加"
```

---

### Task 11: フロントエンド — メール送信画面

**Files:**
- Create: `src/app/(tenant)/members/friend-invites/page.tsx`
- Create: `src/app/(tenant)/members/friend-invites/FriendInviteSendForm.tsx`

**Interfaces:**
- Consumes: `getViewerContext`・`getActiveTenant`（既存）、`listFriendInviteCandidates`・`FriendInviteCandidate`（Task 6）、`POST /api/tenant-members/friend-invites`（Task 7、レスポンス`{ results: { userId: string; ok: boolean; error?: string }[] }`）
- Produces: テナント管理者向け画面 `/members/friend-invites`

- [ ] **Step 1: FriendInviteSendForm.tsxを実装する**

```tsx
// src/app/(tenant)/members/friend-invites/FriendInviteSendForm.tsx
"use client";

import { useState } from "react";
import type { FriendInviteCandidate } from "@/lib/line/friendInviteCandidates";

type SendResult = { userId: string; ok: boolean; error?: string };

export function FriendInviteSendForm({
  candidates,
}: {
  candidates: FriendInviteCandidate[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSend() {
    if (selected.size === 0) return;
    setSending(true);
    setResults(null);
    try {
      const res = await fetch("/api/tenant-members/friend-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected] }),
      });
      const body = await res.json().catch(() => ({}));
      setResults(body.results ?? []);
    } finally {
      setSending(false);
    }
  }

  if (candidates.length === 0) {
    return <p className="text-sm text-ink-soft">未フォローのメンバーはいません。</p>;
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {candidates.map((candidate) => (
          <li key={candidate.userId} className="flex items-center gap-3 p-3">
            <input
              type="checkbox"
              checked={selected.has(candidate.userId)}
              onChange={() => toggle(candidate.userId)}
            />
            <span className="text-sm text-ink">{candidate.email}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={handleSend}
        disabled={selected.size === 0 || sending}
        className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {sending ? "送信中..." : "友だち招待の送信"}
      </button>

      {results && (
        <ul className="space-y-1 text-sm">
          {results.map((result) => {
            const candidate = candidates.find((c) => c.userId === result.userId);
            return (
              <li key={result.userId} className={result.ok ? "text-ink" : "text-alert"}>
                {candidate?.email ?? result.userId}
                {": "}
                {result.ok ? "送信しました" : `送信失敗（${result.error}）`}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: page.tsxを実装する**

```tsx
// src/app/(tenant)/members/friend-invites/page.tsx
import { redirect } from "next/navigation";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { listFriendInviteCandidates } from "@/lib/line/friendInviteCandidates";
import { FriendInviteSendForm } from "./FriendInviteSendForm";

const ALLOWED_ROLES = new Set(["owner", "admin", "developer"]);

export default async function FriendInvitesPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-ink">
        <div className="rounded-lg border border-line bg-paper p-4">
          所属テナントが見つかりません。管理者にお問い合わせください。
        </div>
      </div>
    );
  }

  if (!ALLOWED_ROLES.has(tenant.role)) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-ink">
        <div className="rounded-lg border border-line bg-paper p-4">
          この画面へのアクセス権限がありません。
        </div>
      </div>
    );
  }

  const candidates = await listFriendInviteCandidates(tenant.tenantId);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold text-ink">LINE友だち招待</h1>
      <p className="text-sm text-ink-soft">
        まだLINE公式アカウントを友だち追加していないメンバーに、招待メールを送信します。
      </p>
      <FriendInviteSendForm candidates={candidates} />
    </div>
  );
}
```

- [ ] **Step 3: 型チェックが通ることを確認**

```bash
npx tsc --noEmit --pretty false
```

Expected: エラー無し

- [ ] **Step 4: コミット**

```bash
git add "src/app/(tenant)/members/friend-invites/"
git commit -m "feat: LINE友だち招待のメール送信画面を追加"
```

---

### Task 12: 手動検証

**Files:** なし（動作確認のみ）

**Interfaces:** なし

- [ ] **Step 1: 全自動テストを実行する**

```bash
npx vitest run
```

Expected: 全テストPASS

- [ ] **Step 2: Resendの送信ドメインを設定する**

1. Resendダッシュボードで送信ドメインを追加し、SPF/DKIMレコードをDNSに設定して認証を完了する
2. 認証済みドメインのアドレスを `EMAIL_FROM`（例: `noreply@<認証済みドメイン>`）としてデプロイ先の環境変数に設定する
3. `RESEND_API_KEY` をResendダッシュボードで発行し、同じくデプロイ先の環境変数に設定する

- [ ] **Step 3: LINE Developersコンソールで「Add friend option」を確認・変更する**

1. 既存のLIFFアプリ（`NEXT_PUBLIC_LIFF_ID`）の設定を開き、「Add friend option」を`Normal`または`Aggressive`に変更する
2. 既に友だち済みのテストアカウントで`/liff/entry`を開き、友だち追加プロンプトが出ないこと（影響が無いこと）を確認する

- [ ] **Step 4: 招待発行〜メール受信〜QRコード表示を確認する**

1. テナント管理者（owner/admin）アカウントでログインし、`/members/friend-invites` を開く
2. 未フォローのテナントメンバーが一覧に表示されることを確認する
3. 対象を1件選択して「友だち招待の送信」を押し、成功表示になることを確認する
4. 対象メンバーのメールが実際に届くことを確認する
5. メール内のURLをPCブラウザで開き、QRコードが表示されることを確認する
6. Supabase Studioで`line_friend_invites`に新規行（`used_at`が`null`）が作成されていることを確認する

- [ ] **Step 5: QRコードスキャン〜紐付け完了を実機で確認する**

1. 手順4で表示したQRコードを、対象メンバー自身のスマートフォンのLINEアプリでスキャンする
2. 友だちでなければ自動的に友だち追加プロンプトが出ることを確認する
3. LIFFが起動し「連携が完了しました」と表示されることを確認する
4. Supabase Studioで、その`line_user_id`の`line_friends`行が`status = 'linked'`かつ対象の`user_id`になっていること、`line_friend_invites.used_at`が埋まっていることを確認する

- [ ] **Step 6: 条件付きSkipログインが機能することを確認する**

1. 手順5で紐付けたアカウントで、LINEのリッチメニューから再度dx-sensorを開く
2. ログイン画面を経由せず`/`（テナントダッシュボード）に到達することを確認する

- [ ] **Step 7: エラーケースを確認する**

1. 使用済みのQRコードURLを再度開き、「既に使用されています」等の表示になることを確認する
2. 期限切れの`line_friend_invites`行をSupabase Studioで手動作成し、そのトークンのURLを開いて「有効期限が切れています」の表示になることを確認する
