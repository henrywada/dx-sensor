# LINE連携機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現場ユーザーがLINE公式アカウントのリッチメニューからログイン無しでテナントダッシュボードにアクセスでき、PCユーザーは通常ログイン（初回はパスワード設定フロー経由）で全画面にアクセスできるようにする。

**Architecture:** 招待発行→LINE友だち追加→LIFFでの本人確認→`auth.users`/`tenant_members`/`line_friends`の自動作成、という初回フローと、2回目以降はLIFFのIDトークン検証だけで既存アカウントのSupabaseセッションを自動確立する「条件付きSkipログイン」フローの2本立て。どちらも最終的には既存の`getViewerContext()`/`getActiveTenant()`が使う通常のSupabase Authセッション（Cookie）に収束させ、既存ページの認可ロジックは一切変更しない。

**Tech Stack:** Next.js 14 (App Router) / TypeScript / Supabase (Auth, Postgres, RLS) / Vitest / `jose`（LINE IDトークン検証）/ `@line/liff`（LIFF SDK）

**Spec:** `docs/superpowers/specs/2026-09-02-line-integration-design.md`

> **実装後の修正について:** 最終レビューで、この計画書に埋め込まれたコードのうち`aud`検証（`NEXT_PUBLIC_LIFF_ID`をIDトークンの監査対象として使っていた誤り）と`line_friends`のブロック解除デッドロックの2件に設計不備が見つかり、実際のコードでは修正済み。この計画書自体は歴史的記録として残し、埋め込みコードは遡って書き換えていない。詳細と修正内容はスペックの「実装後の修正履歴」セクションを参照。

## Global Constraints

- 新規マイグレーションのファイル名はタイムスタンプ形式 `YYYYMMDDHHMMSS_description.sql` に従うこと（`0001`〜`0023`の連番形式は使わない）
- `authenticated` ロールへのGRANTは新規テーブルごとに明示的に付与すること（`0007_grant_authenticated_tenant_members.sql`のGRANT漏れの教訓）
- APIのリクエストボディ検証は既存の `src/app/api/documents/parseBody.ts` と同じ手動バリデーションパターンに従うこと（zodは使わない。プロジェクト内の既存APIルートがすべてこの手動パターンのため、一貫性を優先する）
- リッチメニューは1ボタンのみで、遷移先は常に `/`（テナントダッシュボード）固定。`target`パラメータや許可リストは実装しない
- LIFF IDは秘匿情報ではないため環境変数名は `NEXT_PUBLIC_LIFF_ID` を使うが、**これはクライアント側`liff.init()`専用**。サーバー側のJWT `aud`検証には別の環境変数 `LINE_LOGIN_CHANNEL_ID`（LINEログインチャネルの数値チャネルID）を使う — LIFF IDとチャネルIDは異なる値であり、当初の計画（両方に`NEXT_PUBLIC_LIFF_ID`を流用）は最終レビューで判明した誤りだった。`LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` はサーバー専用シークレットとして`NEXT_PUBLIC_`を付けない
- 既存の `src/lib/auth/getViewerContext.ts` / `src/lib/auth/getActiveTenant.ts` / `src/app/(tenant)/layout.tsx` / `(tenant)/page.tsx` は変更しない
- テストファイルは対象ファイルと同じディレクトリに `*.test.ts` として配置し、`npx vitest run <path>` で実行する
- 手動検証が必要な箇所（LINE Webhookの実機テスト、LIFFのLINEアプリ内ブラウザでの確認、マジックリンクのメール受信確認）はTask 18にまとめて記載する

---

## File Structure

```
supabase/migrations/
  20260902120000_tenant_member_invites.sql   [new]
  20260902121000_line_friends.sql            [new]

src/lib/line/
  verifyWebhookSignature.ts       [new] Webhook署名検証（純粋関数）
  verifyWebhookSignature.test.ts  [new]
  inviteToken.ts                  [new] 招待トークン生成・有効期限計算
  inviteToken.test.ts             [new]
  validateIdTokenClaims.ts        [new] JWTクレーム検証（純粋関数）
  validateIdTokenClaims.test.ts   [new]
  verifyLineIdToken.ts            [new] jose+JWKSでのID トークン検証（薄いラッパー）
  establishSupabaseSession.ts     [new] generateLink+verifyOtpでのセッション確立
  establishSupabaseSession.test.ts [new]
  parseWebhookEvents.ts           [new] Webhookイベント配列のパース（純粋関数）
  parseWebhookEvents.test.ts      [new]
  buildFollowReplyMessage.ts      [new] follow時の自動応答メッセージ組み立て（純粋関数）
  buildFollowReplyMessage.test.ts [new]
  lineMessagingClient.ts          [new] LINE Messaging API呼び出し（fetch）

src/app/api/tenant-members/invites/
  route.ts        [new]
  parseBody.ts     [new]
  parseBody.test.ts [new]

src/app/api/line/webhook/
  route.ts [new]

src/app/api/line/invite-accept/
  route.ts        [new]
  parseBody.ts     [new]
  parseBody.test.ts [new]

src/app/api/line/liff-auth/
  route.ts        [new]
  parseBody.ts     [new]
  parseBody.test.ts [new]

src/app/liff/entry/
  page.tsx         [new]
  LiffEntryView.tsx [new]

src/app/liff/link/
  page.tsx        [new]
  LiffLinkView.tsx [new]

src/app/(auth)/login/page.tsx        [modify] パスワード未設定/お忘れの方リンクを追加
src/app/(auth)/set-password/page.tsx [new]

src/lib/supabase/server.ts [modify] createServiceSupabase()のコメントにLINE認証フローの利用を追記

scripts/
  setup-line-rich-menu.mjs [new] リッチメニュー作成・デフォルト適用（一度だけ実行する運用スクリプト）

.env.example [modify] LINE関連の環境変数を追記
package.json [modify] jose, @line/liff を追加
```

---

### Task 1: 依存パッケージ追加・環境変数の追記

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: `jose`（`createRemoteJWKSet`, `jwtVerify`）と `@line/liff`（default export の `liff` オブジェクト）が以降のタスクで import 可能になる

- [ ] **Step 1: 依存パッケージをインストール**

```bash
npm install jose @line/liff
```

- [ ] **Step 2: `.env.example` にLINE関連env varを追記**

`.env.example` の末尾に以下を追記する:

```bash
# LINE連携（LINE公式アカウント + LIFF）
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
NEXT_PUBLIC_LIFF_ID=
```

- [ ] **Step 3: package.json にpostinstall差分がないことを確認しコミット**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: LINE連携用の依存パッケージ(jose, @line/liff)と環境変数を追加"
```

---

### Task 2: DBマイグレーション — `tenant_member_invites`

**Files:**
- Create: `supabase/migrations/20260902120000_tenant_member_invites.sql`

**Interfaces:**
- Consumes: 既存の `tenants`, `auth.users` テーブル、`is_app_developer()` / `has_tenant_role()` 関数（`0001_init.sql`）
- Produces: `tenant_member_invites` テーブル（列: `id, tenant_id, invitee_email, role, invite_token, created_by, expires_at, used_at, created_at`）。Task 10で使用

- [ ] **Step 1: マイグレーションファイルを作成**

```sql
-- 20260902120000_tenant_member_invites.sql
-- LINE連携: テナントメンバー招待（メールアドレス指定→招待URL発行）

create table tenant_member_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invitee_email text not null,
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'viewer')),
  invite_token text not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tenant_member_invites_tenant_idx
  on tenant_member_invites (tenant_id, created_at desc);
create index if not exists tenant_member_invites_token_idx
  on tenant_member_invites (invite_token);

alter table tenant_member_invites enable row level security;

create policy tenant_member_invites_admin_only on tenant_member_invites
  for all using (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  ) with check (
    is_app_developer() or has_tenant_role(tenant_id, 'admin')
  );

grant select, insert, update, delete on public.tenant_member_invites to authenticated;
```

- [ ] **Step 2: ローカルDBに適用**

```bash
supabase migration up
```

- [ ] **Step 3: テーブルとRLSが有効になっていることを確認**

```bash
supabase db diff --linked=false
```

Supabase StudioのSQL Editor（またはCLI経由）で以下を実行し、行が1件返ることを確認する:

```sql
select relrowsecurity from pg_class where relname = 'tenant_member_invites';
```

Expected: `t`（RLS有効）

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/20260902120000_tenant_member_invites.sql
git commit -m "feat: tenant_member_invitesテーブルを追加"
```

---

### Task 3: DBマイグレーション — `line_friends`

**Files:**
- Create: `supabase/migrations/20260902121000_line_friends.sql`

**Interfaces:**
- Consumes: 既存の `tenants`, `auth.users` テーブル、`is_app_developer()` / `auth_tenant_ids()` 関数
- Produces: `line_friends` テーブル（列: `id, user_id, tenant_id, line_user_id, display_name, status, linked_at, created_at, updated_at`）。Task 11〜13で使用

- [ ] **Step 1: マイグレーションファイルを作成**

```sql
-- 20260902121000_line_friends.sql
-- LINE連携: LINE友だち↔アカウントの紐付け状態

create table line_friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  line_user_id text not null unique,
  display_name text,
  status text not null default 'unlinked'
    check (status in ('unlinked', 'linked', 'blocked')),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists line_friends_tenant_idx
  on line_friends (tenant_id);
create index if not exists line_friends_user_idx
  on line_friends (user_id);

alter table line_friends enable row level security;

-- service_role のみが書き込む(webhook/invite-accept/liff-authの処理経由)ため、
-- tenant/userに向けたINSERT/UPDATEポリシーは設けない。SELECTのみテナントメンバーに許可する。
create policy line_friends_tenant_isolation on line_friends
  for select using (
    is_app_developer() or tenant_id in (select auth_tenant_ids())
  );

grant select on public.line_friends to authenticated;
```

- [ ] **Step 2: ローカルDBに適用**

```bash
supabase migration up
```

- [ ] **Step 3: RLSが有効になっていることを確認**

```sql
select relrowsecurity from pg_class where relname = 'line_friends';
```

Expected: `t`

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/20260902121000_line_friends.sql
git commit -m "feat: line_friendsテーブルを追加"
```

---

### Task 4: lib — Webhook署名検証

**Files:**
- Create: `src/lib/line/verifyWebhookSignature.ts`
- Test: `src/lib/line/verifyWebhookSignature.test.ts`

**Interfaces:**
- Produces: `verifyLineWebhookSignature(params: { rawBody: string; signatureHeader: string | null; channelSecret: string }): boolean`。Task 11で使用

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/line/verifyWebhookSignature.test.ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLineWebhookSignature } from "./verifyWebhookSignature";

const channelSecret = "test-channel-secret";
const rawBody = '{"events":[]}';

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyLineWebhookSignature", () => {
  it("returns true for a valid signature", () => {
    const signature = sign(rawBody, channelSecret);
    expect(
      verifyLineWebhookSignature({ rawBody, signatureHeader: signature, channelSecret })
    ).toBe(true);
  });

  it("returns false for a signature computed with the wrong secret", () => {
    const signature = sign(rawBody, "wrong-secret");
    expect(
      verifyLineWebhookSignature({ rawBody, signatureHeader: signature, channelSecret })
    ).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(
      verifyLineWebhookSignature({ rawBody, signatureHeader: null, channelSecret })
    ).toBe(false);
  });

  it("returns false when the body was tampered with", () => {
    const signature = sign(rawBody, channelSecret);
    expect(
      verifyLineWebhookSignature({
        rawBody: '{"events":[{"type":"follow"}]}',
        signatureHeader: signature,
        channelSecret,
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/line/verifyWebhookSignature.test.ts`
Expected: FAIL（`verifyWebhookSignature` モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```typescript
// src/lib/line/verifyWebhookSignature.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLineWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  channelSecret: string;
}): boolean {
  const { rawBody, signatureHeader, channelSecret } = params;
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/line/verifyWebhookSignature.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/line/verifyWebhookSignature.ts src/lib/line/verifyWebhookSignature.test.ts
git commit -m "feat: LINE Webhook署名検証関数を追加"
```

---

### Task 5: lib — 招待トークン生成

**Files:**
- Create: `src/lib/line/inviteToken.ts`
- Test: `src/lib/line/inviteToken.test.ts`

**Interfaces:**
- Produces: `generateInviteToken(): string`、`inviteExpiryDate(fromDate?: Date): Date`。Task 10で使用

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/line/inviteToken.test.ts
import { describe, expect, it } from "vitest";
import { generateInviteToken, inviteExpiryDate } from "./inviteToken";

describe("generateInviteToken", () => {
  it("returns a URL-safe token of reasonable length", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("returns a different token on each call", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
  });
});

describe("inviteExpiryDate", () => {
  it("returns a date 72 hours after the given date", () => {
    const from = new Date("2026-09-02T00:00:00.000Z");
    const expiry = inviteExpiryDate(from);
    expect(expiry.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  it("defaults to now when no date is given", () => {
    const before = Date.now();
    const expiry = inviteExpiryDate();
    const after = Date.now();
    const seventyTwoHoursMs = 72 * 60 * 60 * 1000;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + seventyTwoHoursMs);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + seventyTwoHoursMs);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/line/inviteToken.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```typescript
// src/lib/line/inviteToken.ts
import { randomBytes } from "node:crypto";

const INVITE_TTL_HOURS = 72;

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteExpiryDate(fromDate: Date = new Date()): Date {
  return new Date(fromDate.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/line/inviteToken.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/line/inviteToken.ts src/lib/line/inviteToken.test.ts
git commit -m "feat: 招待トークン生成・有効期限計算関数を追加"
```

---

### Task 6: lib — IDトークンのクレーム検証・LINE ID token検証ラッパー

**Files:**
- Create: `src/lib/line/validateIdTokenClaims.ts`
- Test: `src/lib/line/validateIdTokenClaims.test.ts`
- Create: `src/lib/line/verifyLineIdToken.ts`

**Interfaces:**
- Produces: `validateLineIdTokenClaims(claims, params): { lineUserId: string }`（純粋関数、単体テスト対象）
- Produces: `verifyLineIdToken(idToken: string, liffChannelId: string): Promise<{ lineUserId: string }>`（jose+LINE JWKSでの実検証。単体テスト対象外、Task 18で手動検証）。Task 12・13で使用

- [ ] **Step 1: 失敗するテストを書く（クレーム検証の純粋関数部分）**

```typescript
// src/lib/line/validateIdTokenClaims.test.ts
import { describe, expect, it } from "vitest";
import { validateLineIdTokenClaims } from "./validateIdTokenClaims";

const liffChannelId = "1234567890-abcdefgh";
const nowSeconds = 1_800_000_000;

function baseClaims() {
  return {
    sub: "U1234567890abcdef1234567890abcdef",
    aud: liffChannelId,
    iss: "https://access.line.me",
    exp: nowSeconds + 3600,
  };
}

describe("validateLineIdTokenClaims", () => {
  it("returns the LINE user id for valid claims", () => {
    const result = validateLineIdTokenClaims(baseClaims(), { liffChannelId, nowSeconds });
    expect(result).toEqual({ lineUserId: "U1234567890abcdef1234567890abcdef" });
  });

  it("rejects a wrong issuer", () => {
    const claims = { ...baseClaims(), iss: "https://evil.example.com" };
    expect(() => validateLineIdTokenClaims(claims, { liffChannelId, nowSeconds })).toThrow();
  });

  it("rejects a wrong audience", () => {
    const claims = { ...baseClaims(), aud: "some-other-channel" };
    expect(() => validateLineIdTokenClaims(claims, { liffChannelId, nowSeconds })).toThrow();
  });

  it("rejects an expired token", () => {
    const claims = { ...baseClaims(), exp: nowSeconds - 1 };
    expect(() => validateLineIdTokenClaims(claims, { liffChannelId, nowSeconds })).toThrow();
  });

  it("rejects an empty subject", () => {
    const claims = { ...baseClaims(), sub: "" };
    expect(() => validateLineIdTokenClaims(claims, { liffChannelId, nowSeconds })).toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/line/validateIdTokenClaims.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```typescript
// src/lib/line/validateIdTokenClaims.ts
export type LineIdTokenClaims = {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
};

const LINE_ISSUER = "https://access.line.me";

export function validateLineIdTokenClaims(
  claims: LineIdTokenClaims,
  params: { liffChannelId: string; nowSeconds: number }
): { lineUserId: string } {
  if (claims.iss !== LINE_ISSUER) {
    throw new Error("invalid issuer");
  }
  if (claims.aud !== params.liffChannelId) {
    throw new Error("invalid audience");
  }
  if (claims.exp <= params.nowSeconds) {
    throw new Error("token expired");
  }
  if (!claims.sub) {
    throw new Error("missing subject");
  }

  return { lineUserId: claims.sub };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/line/validateIdTokenClaims.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: `verifyLineIdToken`ラッパーを実装する（LINEのJWKSへの実通信を伴うため単体テストは書かず、Task 18で実機検証する）**

```typescript
// src/lib/line/verifyLineIdToken.ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { validateLineIdTokenClaims } from "./validateIdTokenClaims";

const LINE_JWKS_URL = "https://api.line.me/oauth2/v2.1/certs";
const LINE_ISSUER = "https://access.line.me";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(LINE_JWKS_URL));
  }
  return jwks;
}

export async function verifyLineIdToken(
  idToken: string,
  liffChannelId: string
): Promise<{ lineUserId: string }> {
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: LINE_ISSUER,
    audience: liffChannelId,
  });

  if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
    throw new Error("invalid token payload");
  }

  return validateLineIdTokenClaims(
    { sub: payload.sub, aud: liffChannelId, iss: LINE_ISSUER, exp: payload.exp },
    { liffChannelId, nowSeconds: Math.floor(Date.now() / 1000) }
  );
}
```

- [ ] **Step 6: コミット**

```bash
git add src/lib/line/validateIdTokenClaims.ts src/lib/line/validateIdTokenClaims.test.ts src/lib/line/verifyLineIdToken.ts
git commit -m "feat: LINE IDトークンのクレーム検証とjose検証ラッパーを追加"
```

---

### Task 7: lib — Supabaseセッション確立（generateLink + verifyOtp）

**Files:**
- Create: `src/lib/line/establishSupabaseSession.ts`
- Test: `src/lib/line/establishSupabaseSession.test.ts`

**Interfaces:**
- Produces: `establishSupabaseSession(params: { adminClient: GenerateLinkClient; sessionClient: VerifyOtpClient; email: string }): Promise<void>`。Task 12・13で `createServiceSupabase()` / `createServerSupabase()` を渡して使用

- [ ] **Step 1: 失敗するテストを書く（フェイククライアントで検証）**

```typescript
// src/lib/line/establishSupabaseSession.test.ts
import { describe, expect, it, vi } from "vitest";
import { establishSupabaseSession } from "./establishSupabaseSession";

describe("establishSupabaseSession", () => {
  it("calls generateLink then verifyOtp with the returned hashed_token", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { hashed_token: "hashed-token-123" } },
      error: null,
    });
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });

    await establishSupabaseSession({
      adminClient: { auth: { admin: { generateLink } } },
      sessionClient: { auth: { verifyOtp } },
      email: "user@example.com",
    });

    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "user@example.com",
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "hashed-token-123",
      email: "user@example.com",
    });
  });

  it("throws when generateLink returns an error", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const verifyOtp = vi.fn();

    await expect(
      establishSupabaseSession({
        adminClient: { auth: { admin: { generateLink } } },
        sessionClient: { auth: { verifyOtp } },
        email: "user@example.com",
      })
    ).rejects.toThrow();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("throws when verifyOtp returns an error", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { hashed_token: "hashed-token-123" } },
      error: null,
    });
    const verifyOtp = vi.fn().mockResolvedValue({ error: { message: "boom" } });

    await expect(
      establishSupabaseSession({
        adminClient: { auth: { admin: { generateLink } } },
        sessionClient: { auth: { verifyOtp } },
        email: "user@example.com",
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/line/establishSupabaseSession.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```typescript
// src/lib/line/establishSupabaseSession.ts
type GenerateLinkClient = {
  auth: {
    admin: {
      generateLink: (params: { type: "magiclink"; email: string }) => Promise<{
        data: { properties?: { hashed_token?: string } } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

type VerifyOtpClient = {
  auth: {
    verifyOtp: (params: {
      type: "magiclink";
      token_hash: string;
      email: string;
    }) => Promise<{ error: { message: string } | null }>;
  };
};

export async function establishSupabaseSession(params: {
  adminClient: GenerateLinkClient;
  sessionClient: VerifyOtpClient;
  email: string;
}): Promise<void> {
  const { adminClient, sessionClient, email } = params;

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const hashedToken = data?.properties?.hashed_token;
  if (error || !hashedToken) {
    throw new Error("failed to generate session link");
  }

  const { error: verifyError } = await sessionClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
    email,
  });

  if (verifyError) {
    throw new Error("failed to verify session link");
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/line/establishSupabaseSession.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/line/establishSupabaseSession.ts src/lib/line/establishSupabaseSession.test.ts
git commit -m "feat: generateLink+verifyOtpによるSupabaseセッション確立関数を追加"
```

---

### Task 8: lib — Webhookイベントのパース

**Files:**
- Create: `src/lib/line/parseWebhookEvents.ts`
- Test: `src/lib/line/parseWebhookEvents.test.ts`

**Interfaces:**
- Produces: `type LineWebhookEvent = { type: "follow"; replyToken: string; source: { userId: string } } | { type: "unfollow"; source: { userId: string } } | { type: "message"; replyToken: string; source: { userId: string } }`
- Produces: `parseWebhookEvents(body: unknown): LineWebhookEvent[]`。Task 11で使用

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/line/parseWebhookEvents.test.ts
import { describe, expect, it } from "vitest";
import { parseWebhookEvents } from "./parseWebhookEvents";

describe("parseWebhookEvents", () => {
  it("parses a follow event", () => {
    const body = {
      events: [
        { type: "follow", replyToken: "reply-1", source: { userId: "U1" } },
      ],
    };
    expect(parseWebhookEvents(body)).toEqual([
      { type: "follow", replyToken: "reply-1", source: { userId: "U1" } },
    ]);
  });

  it("parses an unfollow event", () => {
    const body = { events: [{ type: "unfollow", source: { userId: "U2" } }] };
    expect(parseWebhookEvents(body)).toEqual([
      { type: "unfollow", source: { userId: "U2" } },
    ]);
  });

  it("drops events of an unknown type instead of throwing", () => {
    const body = {
      events: [
        { type: "postback", source: { userId: "U3" } },
        { type: "follow", replyToken: "reply-2", source: { userId: "U4" } },
      ],
    };
    expect(parseWebhookEvents(body)).toEqual([
      { type: "follow", replyToken: "reply-2", source: { userId: "U4" } },
    ]);
  });

  it("drops malformed events missing required fields", () => {
    const body = { events: [{ type: "follow", source: { userId: "U5" } }] };
    expect(parseWebhookEvents(body)).toEqual([]);
  });

  it("throws when the top-level body has no events array", () => {
    expect(() => parseWebhookEvents({})).toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/line/parseWebhookEvents.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```typescript
// src/lib/line/parseWebhookEvents.ts
export type LineWebhookEvent =
  | { type: "follow"; replyToken: string; source: { userId: string } }
  | { type: "unfollow"; source: { userId: string } }
  | { type: "message"; replyToken: string; source: { userId: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSourceUserId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.userId !== "string") return null;
  return value.userId;
}

export function parseWebhookEvents(body: unknown): LineWebhookEvent[] {
  if (!isRecord(body) || !Array.isArray(body.events)) {
    throw new Error("invalid webhook body");
  }

  return body.events.flatMap((event): LineWebhookEvent[] => {
    if (!isRecord(event) || typeof event.type !== "string") return [];

    if (event.type === "follow" || event.type === "message") {
      const userId = parseSourceUserId(event.source);
      if (typeof event.replyToken !== "string" || !userId) return [];
      return [{ type: event.type, replyToken: event.replyToken, source: { userId } }];
    }

    if (event.type === "unfollow") {
      const userId = parseSourceUserId(event.source);
      if (!userId) return [];
      return [{ type: "unfollow", source: { userId } }];
    }

    return [];
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/line/parseWebhookEvents.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/line/parseWebhookEvents.ts src/lib/line/parseWebhookEvents.test.ts
git commit -m "feat: LINE Webhookイベントのパース関数を追加"
```

---

### Task 9: lib — follow自動応答メッセージ・Messaging APIクライアント

**Files:**
- Create: `src/lib/line/buildFollowReplyMessage.ts`
- Test: `src/lib/line/buildFollowReplyMessage.test.ts`
- Create: `src/lib/line/lineMessagingClient.ts`

**Interfaces:**
- Produces: `type LineTextMessage = { type: "text"; text: string }`、`buildFollowReplyMessage(liffId: string): LineTextMessage[]`
- Produces: `replyLineMessage(params: { channelAccessToken: string; replyToken: string; messages: LineTextMessage[] }): Promise<void>`（fetch実行、単体テスト対象外）。Task 11で使用

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/line/buildFollowReplyMessage.test.ts
import { describe, expect, it } from "vitest";
import { buildFollowReplyMessage } from "./buildFollowReplyMessage";

describe("buildFollowReplyMessage", () => {
  it("returns a single text message containing the LIFF URL", () => {
    const messages = buildFollowReplyMessage("1234567890-abcdefgh");
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("text");
    expect(messages[0].text).toContain("https://liff.line.me/1234567890-abcdefgh");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/line/buildFollowReplyMessage.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```typescript
// src/lib/line/buildFollowReplyMessage.ts
export type LineTextMessage = { type: "text"; text: string };

export function buildFollowReplyMessage(liffId: string): LineTextMessage[] {
  return [
    {
      type: "text",
      text: `友だち追加ありがとうございます。\n下のリンクからdx-sensorにアクセスできます。\nhttps://liff.line.me/${liffId}`,
    },
  ];
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/line/buildFollowReplyMessage.test.ts`
Expected: PASS（1 test）

- [ ] **Step 5: Messaging APIクライアントを実装する（実通信のため単体テストは書かず、Task 18で手動検証する）**

```typescript
// src/lib/line/lineMessagingClient.ts
import type { LineTextMessage } from "./buildFollowReplyMessage";

const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

export async function replyLineMessage(params: {
  channelAccessToken: string;
  replyToken: string;
  messages: LineTextMessage[];
}): Promise<void> {
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken: params.replyToken,
      messages: params.messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("LINE reply message failed", response.status, text);
    throw new Error(`LINE reply failed: ${response.status}`);
  }
}
```

- [ ] **Step 6: コミット**

```bash
git add src/lib/line/buildFollowReplyMessage.ts src/lib/line/buildFollowReplyMessage.test.ts src/lib/line/lineMessagingClient.ts
git commit -m "feat: follow自動応答メッセージとLINE Messaging APIクライアントを追加"
```

---

### Task 10: API — `POST /api/tenant-members/invites`

**Files:**
- Create: `src/app/api/tenant-members/invites/parseBody.ts`
- Test: `src/app/api/tenant-members/invites/parseBody.test.ts`
- Create: `src/app/api/tenant-members/invites/route.ts`

**Interfaces:**
- Consumes: `generateInviteToken`, `inviteExpiryDate`（Task 5）、`getViewerContext`（既存）、`createServerSupabase`（既存）
- Produces: `POST /api/tenant-members/invites` エンドポイント。成功時 `201 { inviteUrl: string }`、失敗時 `400/401/403 { error: string }`

- [ ] **Step 1: 失敗するテストを書く（parseBody）**

```typescript
// src/app/api/tenant-members/invites/parseBody.test.ts
import { describe, expect, it } from "vitest";
import { parseInviteBody } from "./parseBody";

const tenantId = "11111111-1111-4111-8111-111111111111";

describe("parseInviteBody", () => {
  it("parses a valid body", () => {
    const result = parseInviteBody({
      tenantId,
      inviteeEmail: "Taro.Yamada@Example.com",
      role: "viewer",
    });
    expect(result).toEqual({
      tenantId,
      inviteeEmail: "taro.yamada@example.com",
      role: "viewer",
    });
  });

  it("rejects an invalid tenantId", () => {
    expect(() =>
      parseInviteBody({ tenantId: "not-a-uuid", inviteeEmail: "a@b.com", role: "viewer" })
    ).toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() =>
      parseInviteBody({ tenantId, inviteeEmail: "not-an-email", role: "viewer" })
    ).toThrow();
  });

  it("rejects a role of developer", () => {
    expect(() =>
      parseInviteBody({ tenantId, inviteeEmail: "a@b.com", role: "developer" })
    ).toThrow();
  });

  it("rejects a missing role", () => {
    expect(() => parseInviteBody({ tenantId, inviteeEmail: "a@b.com" })).toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/app/api/tenant-members/invites/parseBody.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: parseBody.tsを実装する**

```typescript
// src/app/api/tenant-members/invites/parseBody.ts
export type ParsedInviteBody = {
  tenantId: string;
  inviteeEmail: string;
  role: "owner" | "admin" | "viewer";
};

const ALLOWED_ROLES = new Set(["owner", "admin", "viewer"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInviteBody(body: unknown): ParsedInviteBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { tenantId, inviteeEmail, role } = body;

  if (typeof tenantId !== "string" || !UUID_PATTERN.test(tenantId)) {
    throw new Error("invalid tenantId");
  }
  if (typeof inviteeEmail !== "string" || !EMAIL_PATTERN.test(inviteeEmail)) {
    throw new Error("invalid inviteeEmail");
  }
  if (typeof role !== "string" || !ALLOWED_ROLES.has(role)) {
    throw new Error("invalid role");
  }

  return {
    tenantId,
    inviteeEmail: inviteeEmail.trim().toLowerCase(),
    role: role as ParsedInviteBody["role"],
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/app/api/tenant-members/invites/parseBody.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: route.tsを実装する**

```typescript
// src/app/api/tenant-members/invites/route.ts
import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { generateInviteToken, inviteExpiryDate } from "@/lib/line/inviteToken";
import { createServerSupabase } from "@/lib/supabase/server";
import { parseInviteBody } from "./parseBody";

export async function POST(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = parseInviteBody(await req.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const inviteToken = generateInviteToken();
  const expiresAt = inviteExpiryDate();

  const { error } = await supabase.from("tenant_member_invites").insert({
    tenant_id: parsed.tenantId,
    invitee_email: parsed.inviteeEmail,
    role: parsed.role,
    invite_token: inviteToken,
    created_by: viewer.userId,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    // RLS(has_tenant_role(tenant_id, 'admin'))で弾かれた場合もここに来る
    return NextResponse.json({ error: "招待の発行に失敗しました" }, { status: 403 });
  }

  const inviteUrl = `${new URL(req.url).origin}/liff/link?t=${inviteToken}`;
  return NextResponse.json({ inviteUrl }, { status: 201 });
}
```

- [ ] **Step 6: コミット**

```bash
git add src/app/api/tenant-members/invites/
git commit -m "feat: 招待発行API(POST /api/tenant-members/invites)を追加"
```

---

### Task 11: API — `POST /api/line/webhook`

**Files:**
- Create: `src/app/api/line/webhook/route.ts`
- Modify: `src/lib/supabase/server.ts`

**Interfaces:**
- Consumes: `verifyLineWebhookSignature`（Task 4）、`parseWebhookEvents`（Task 8）、`buildFollowReplyMessage` / `replyLineMessage`（Task 9）、`createServiceSupabase`（既存）
- Produces: `POST /api/line/webhook` エンドポイント。常に`200 { ok: true }`を返す（署名検証失敗時のみ`401`、設定不備時のみ`500`）

- [ ] **Step 1: `createServiceSupabase()`のコメントを更新する**

`src/lib/supabase/server.ts` の `createServiceSupabase` の直前コメントを以下のように更新する:

```typescript
/**
 * Service-role client — bypasses RLS. Only use in:
 *  - Vercel Cron jobs (snapshot ingestion, ANPR pipeline)
 *  - server-side jobs that write vehicle_events on behalf of the system
 *  - LINE連携の認証フロー(api/line/webhook, api/line/invite-accept, api/line/liff-auth) —
 *    line_friends/tenant_member_invitesの読み書きとauth.users作成にservice_roleが必要なため
 * Never expose this client or its key to the browser.
 */
```

- [ ] **Step 2: route.tsを実装する**

```typescript
// src/app/api/line/webhook/route.ts
import { NextResponse } from "next/server";
import { buildFollowReplyMessage } from "@/lib/line/buildFollowReplyMessage";
import { replyLineMessage } from "@/lib/line/lineMessagingClient";
import { parseWebhookEvents } from "@/lib/line/parseWebhookEvents";
import { verifyLineWebhookSignature } from "@/lib/line/verifyWebhookSignature";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

  if (!channelSecret || !channelAccessToken || !liffId) {
    console.error("LINE env vars are not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  const isValid = verifyLineWebhookSignature({
    rawBody,
    signatureHeader: signature,
    channelSecret,
  });
  if (!isValid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let events;
  try {
    events = parseWebhookEvents(JSON.parse(rawBody));
  } catch {
    // 個人情報を含みうるペイロードはログしない
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const supabase = createServiceSupabase();

  for (const event of events) {
    if (event.type === "follow") {
      const { data: existing } = await supabase
        .from("line_friends")
        .select("id")
        .eq("line_user_id", event.source.userId)
        .maybeSingle();

      if (!existing) {
        await supabase.from("line_friends").insert({
          line_user_id: event.source.userId,
          status: "unlinked",
        });
      }

      try {
        await replyLineMessage({
          channelAccessToken,
          replyToken: event.replyToken,
          messages: buildFollowReplyMessage(liffId),
        });
      } catch (replyError) {
        console.error("failed to send LINE follow reply", replyError);
      }
    } else if (event.type === "unfollow") {
      await supabase
        .from("line_friends")
        .update({ status: "blocked" })
        .eq("line_user_id", event.source.userId);
    }
    // "message"イベントは自由対話を実装しないため無視する
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: コミット**

```bash
git add src/app/api/line/webhook/route.ts src/lib/supabase/server.ts
git commit -m "feat: LINE Webhook受信エンドポイントを追加"
```

---

### Task 12: API — `POST /api/line/invite-accept`

**Files:**
- Create: `src/app/api/line/invite-accept/parseBody.ts`
- Test: `src/app/api/line/invite-accept/parseBody.test.ts`
- Create: `src/app/api/line/invite-accept/route.ts`

**Interfaces:**
- Consumes: `verifyLineIdToken`（Task 6）、`establishSupabaseSession`（Task 7）、`createServerSupabase` / `createServiceSupabase`（既存）
- Produces: `POST /api/line/invite-accept` エンドポイント。成功時 `200 { ok: true }`（Set-Cookieでセッション確立）、失敗時 `400/401/409/500 { error: "invalid_request" | "token_invalid" | "already_used" | "expired" | "email_already_registered" | "account_creation_failed" | "session_failed" }`

- [ ] **Step 1: 失敗するテストを書く（parseBody）**

```typescript
// src/app/api/line/invite-accept/parseBody.test.ts
import { describe, expect, it } from "vitest";
import { parseInviteAcceptBody } from "./parseBody";

describe("parseInviteAcceptBody", () => {
  it("parses a valid body", () => {
    const result = parseInviteAcceptBody({ idToken: "abc.def.ghi", inviteToken: "tok123" });
    expect(result).toEqual({ idToken: "abc.def.ghi", inviteToken: "tok123" });
  });

  it("rejects a missing idToken", () => {
    expect(() => parseInviteAcceptBody({ inviteToken: "tok123" })).toThrow();
  });

  it("rejects an empty inviteToken", () => {
    expect(() => parseInviteAcceptBody({ idToken: "abc.def.ghi", inviteToken: "" })).toThrow();
  });

  it("rejects a non-object body", () => {
    expect(() => parseInviteAcceptBody("not an object")).toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/app/api/line/invite-accept/parseBody.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: parseBody.tsを実装する**

```typescript
// src/app/api/line/invite-accept/parseBody.ts
export type ParsedInviteAcceptBody = { idToken: string; inviteToken: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInviteAcceptBody(body: unknown): ParsedInviteAcceptBody {
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

Run: `npx vitest run src/app/api/line/invite-accept/parseBody.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: route.tsを実装する**

```typescript
// src/app/api/line/invite-accept/route.ts
import { NextResponse } from "next/server";
import { establishSupabaseSession } from "@/lib/line/establishSupabaseSession";
import { verifyLineIdToken } from "@/lib/line/verifyLineIdToken";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { parseInviteAcceptBody } from "./parseBody";

export async function POST(req: Request) {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    console.error("NEXT_PUBLIC_LIFF_ID is not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  let parsed;
  try {
    parsed = parseInviteAcceptBody(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let lineUserId: string;
  try {
    ({ lineUserId } = await verifyLineIdToken(parsed.idToken, liffId));
  } catch {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }

  const service = createServiceSupabase();

  const { data: invite, error: inviteError } = await service
    .from("tenant_member_invites")
    .select("id, tenant_id, invitee_email, role, expires_at, used_at")
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

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: invite.invitee_email,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    if (createError?.status === 422 || createError?.code === "email_exists") {
      // 既にauth.usersにいるメールアドレスへの招待は今回のスコープ外
      return NextResponse.json({ error: "email_already_registered" }, { status: 409 });
    }
    console.error("LINE invite-accept: createUser failed", createError);
    return NextResponse.json({ error: "account_creation_failed" }, { status: 500 });
  }

  const userId = created.user.id;

  const { error: memberError } = await service.from("tenant_members").insert({
    tenant_id: invite.tenant_id,
    user_id: userId,
    role: invite.role,
  });
  if (memberError) {
    console.error("LINE invite-accept: tenant_members insert failed", memberError);
    return NextResponse.json({ error: "account_creation_failed" }, { status: 500 });
  }

  await service.from("line_friends").upsert(
    {
      line_user_id: lineUserId,
      user_id: userId,
      tenant_id: invite.tenant_id,
      status: "linked",
      linked_at: new Date().toISOString(),
    },
    { onConflict: "line_user_id" }
  );

  await service
    .from("tenant_member_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id);

  try {
    await establishSupabaseSession({
      adminClient: service,
      sessionClient: createServerSupabase(),
      email: invite.invitee_email,
    });
  } catch (sessionError) {
    console.error("LINE invite-accept: session establishment failed", sessionError);
    return NextResponse.json({ error: "session_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: コミット**

```bash
git add src/app/api/line/invite-accept/
git commit -m "feat: 招待受諾・アカウント自動作成API(POST /api/line/invite-accept)を追加"
```

---

### Task 13: API — `POST /api/line/liff-auth`

**Files:**
- Create: `src/app/api/line/liff-auth/parseBody.ts`
- Test: `src/app/api/line/liff-auth/parseBody.test.ts`
- Create: `src/app/api/line/liff-auth/route.ts`

**Interfaces:**
- Consumes: `verifyLineIdToken`（Task 6）、`establishSupabaseSession`（Task 7）、`createServerSupabase` / `createServiceSupabase`（既存）
- Produces: `POST /api/line/liff-auth` エンドポイント。成功時 `200 { ok: true }`（Set-Cookieでセッション確立）、失敗時 `400/401/500 { error: "invalid_request" | "token_invalid" | "not_linked" | "session_failed" }`

- [ ] **Step 1: 失敗するテストを書く（parseBody）**

```typescript
// src/app/api/line/liff-auth/parseBody.test.ts
import { describe, expect, it } from "vitest";
import { parseLiffAuthBody } from "./parseBody";

describe("parseLiffAuthBody", () => {
  it("parses a valid body", () => {
    expect(parseLiffAuthBody({ idToken: "abc.def.ghi" })).toEqual({ idToken: "abc.def.ghi" });
  });

  it("rejects a missing idToken", () => {
    expect(() => parseLiffAuthBody({})).toThrow();
  });

  it("rejects a non-string idToken", () => {
    expect(() => parseLiffAuthBody({ idToken: 123 })).toThrow();
  });

  it("rejects a non-object body", () => {
    expect(() => parseLiffAuthBody(null)).toThrow();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/app/api/line/liff-auth/parseBody.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: parseBody.tsを実装する**

```typescript
// src/app/api/line/liff-auth/parseBody.ts
export type ParsedLiffAuthBody = { idToken: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLiffAuthBody(body: unknown): ParsedLiffAuthBody {
  if (!isRecord(body)) throw new Error("invalid body");

  const { idToken } = body;
  if (typeof idToken !== "string" || idToken.length === 0) {
    throw new Error("invalid idToken");
  }

  return { idToken };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/app/api/line/liff-auth/parseBody.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: route.tsを実装する**

```typescript
// src/app/api/line/liff-auth/route.ts
import { NextResponse } from "next/server";
import { establishSupabaseSession } from "@/lib/line/establishSupabaseSession";
import { verifyLineIdToken } from "@/lib/line/verifyLineIdToken";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
import { parseLiffAuthBody } from "./parseBody";

export async function POST(req: Request) {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    console.error("NEXT_PUBLIC_LIFF_ID is not configured");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  let parsed;
  try {
    parsed = parseLiffAuthBody(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  let lineUserId: string;
  try {
    ({ lineUserId } = await verifyLineIdToken(parsed.idToken, liffId));
  } catch {
    return NextResponse.json({ error: "token_invalid" }, { status: 401 });
  }

  const service = createServiceSupabase();

  const { data: friend, error: friendError } = await service
    .from("line_friends")
    .select("user_id, status")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (friendError || !friend || friend.status !== "linked" || !friend.user_id) {
    return NextResponse.json({ error: "not_linked" }, { status: 401 });
  }

  const { data: userData, error: userError } = await service.auth.admin.getUserById(
    friend.user_id
  );
  if (userError || !userData?.user?.email) {
    return NextResponse.json({ error: "not_linked" }, { status: 401 });
  }

  try {
    await establishSupabaseSession({
      adminClient: service,
      sessionClient: createServerSupabase(),
      email: userData.user.email,
    });
  } catch (sessionError) {
    console.error("LINE liff-auth: session establishment failed", sessionError);
    return NextResponse.json({ error: "session_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: コミット**

```bash
git add src/app/api/line/liff-auth/
git commit -m "feat: 条件付きSkipログインAPI(POST /api/line/liff-auth)を追加"
```

---

### Task 14: フロントエンド — `/liff/entry`

**Files:**
- Create: `src/app/liff/entry/LiffEntryView.tsx`
- Create: `src/app/liff/entry/page.tsx`

**Interfaces:**
- Consumes: `@line/liff`（Task 1で追加）、`POST /api/line/liff-auth`（Task 13）
- Produces: `/liff/entry` ルート。成功時は`/`へリダイレクト

- [ ] **Step 1: LiffEntryView.tsxを実装する**

```tsx
// src/app/liff/entry/LiffEntryView.tsx
"use client";

import { useEffect, useState } from "react";

type AuthState = "loading" | "not_linked" | "error";

export function LiffEntryView() {
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function run() {
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

        const res = await fetch("/api/line/liff-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });

        if (res.ok) {
          window.location.assign("/");
          return;
        }

        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          setState(body.error === "not_linked" ? "not_linked" : "error");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return <p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>;
  }

  if (state === "not_linked") {
    return (
      <div className="space-y-2 p-6 text-center text-sm text-ink-soft">
        <p>まだアカウントが連携されていません。</p>
        <p>管理者から届いた招待メールのリンクからアクセスしてください。</p>
      </div>
    );
  }

  return (
    <div className="p-6 text-center text-sm text-alert">
      <p>読み込みに失敗しました。もう一度お試しください。</p>
    </div>
  );
}
```

- [ ] **Step 2: page.tsxを実装する**

```tsx
// src/app/liff/entry/page.tsx
import { LiffEntryView } from "./LiffEntryView";

export default function LiffEntryPage() {
  return <LiffEntryView />;
}
```

- [ ] **Step 3: ビルドが通ることを確認**

Run: `npm run build`
Expected: ビルド成功（`/liff/entry`が静的/クライアントルートとして生成される）

- [ ] **Step 4: コミット**

```bash
git add src/app/liff/entry/
git commit -m "feat: LIFF条件付きSkipログイン画面(/liff/entry)を追加"
```

---

### Task 15: フロントエンド — `/liff/link`

**Files:**
- Create: `src/app/liff/link/LiffLinkView.tsx`
- Create: `src/app/liff/link/page.tsx`

**Interfaces:**
- Consumes: `@line/liff`、`POST /api/line/invite-accept`（Task 12）
- Produces: `/liff/link?t={invite_token}` ルート。成功時は`/`へリダイレクト

- [ ] **Step 1: LiffLinkView.tsxを実装する**

```tsx
// src/app/liff/link/LiffLinkView.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type LinkState = "loading" | "missing_token" | "error" | "expired" | "already_used";

const ERROR_MESSAGES: Record<Exclude<LinkState, "loading">, string> = {
  missing_token: "招待リンクが正しくありません。",
  expired: "招待の有効期限が切れています。管理者に再発行を依頼してください。",
  already_used: "この招待は既に使用されています。",
  error: "連携に失敗しました。もう一度お試しください。",
};

export function LiffLinkView() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<LinkState>("loading");

  useEffect(() => {
    const inviteToken = searchParams.get("t");
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

        const res = await fetch("/api/line/invite-accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, inviteToken: token }),
        });

        if (res.ok) {
          window.location.assign("/");
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
  }, [searchParams]);

  if (state === "loading") {
    return <p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>;
  }

  return <p className="p-6 text-center text-sm text-alert">{ERROR_MESSAGES[state]}</p>;
}
```

- [ ] **Step 2: page.tsxを実装する（`useSearchParams`のためSuspenseで包む）**

```tsx
// src/app/liff/link/page.tsx
import { Suspense } from "react";
import { LiffLinkView } from "./LiffLinkView";

export default function LiffLinkPage() {
  return (
    <Suspense
      fallback={<p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>}
    >
      <LiffLinkView />
    </Suspense>
  );
}
```

- [ ] **Step 3: ビルドが通ることを確認**

Run: `npm run build`
Expected: ビルド成功

- [ ] **Step 4: コミット**

```bash
git add src/app/liff/link/
git commit -m "feat: LIFF招待受諾画面(/liff/link)を追加"
```

---

### Task 16: フロントエンド — PCログインのパスワード設定フロー

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/set-password/page.tsx`

**Interfaces:**
- Consumes: `supabase.auth.resetPasswordForEmail`, `supabase.auth.updateUser`（`@supabase/supabase-js`, 既存の`createClient()`経由）
- Produces: `(auth)/login`にパスワード再設定導線を追加。`/set-password`ルートを新設

- [ ] **Step 1: ログイン画面に「パスワードをお忘れ/未設定の方はこちら」モードを追加する**

`src/app/(auth)/login/page.tsx` を以下の内容に置き換える（既存のパスワードログインフォームは維持しつつ、モード切り替えを追加）:

```tsx
"use client";

import { useState } from "react";
import { Mail, Lock } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "reset";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError("メールアドレスまたはパスワードが正しくありません。");
      return;
    }

    window.location.assign("/");
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/set-password`,
    });

    setLoading(false);

    if (error) {
      setError("メールの送信に失敗しました。時間をおいて再度お試しください。");
      return;
    }

    setResetSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-[#11521A]">
          <LogoMark className="h-8 w-8 text-signal" />
          <span className="text-xl font-bold tracking-tight">dx-sensor</span>
        </div>

        {mode === "password" && (
          <form
            onSubmit={handlePasswordSubmit}
            className="scan-card space-y-4 rounded-lg border border-line bg-white p-6"
          >
            <div>
              <label htmlFor="email" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]">
                <Mail className="h-4 w-4" aria-hidden="true" />
                メールアドレス
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm text-[#11521A] outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]">
                <Lock className="h-4 w-4" aria-hidden="true" />
                パスワード
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm text-[#11521A] outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-alert">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("reset");
              }}
              className="w-full text-center text-xs text-ink-soft underline"
            >
              パスワードを未設定/お忘れの方はこちら
            </button>
          </form>
        )}

        {mode === "reset" && (
          <form
            onSubmit={handleResetSubmit}
            className="scan-card space-y-4 rounded-lg border border-line bg-white p-6"
          >
            {resetSent ? (
              <p className="text-sm text-[#11521A]">
                メールを送信しました。届いたリンクからパスワードを設定してください。
              </p>
            ) : (
              <>
                <div>
                  <label htmlFor="reset-email" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]">
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    メールアドレス
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-md border border-line px-3 py-2 text-sm text-[#11521A] outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                    placeholder="you@example.com"
                  />
                </div>

                {error && <p className="text-sm text-alert">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? "送信中..." : "パスワード設定メールを送る"}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setError(null);
                setResetSent(false);
                setMode("password");
              }}
              className="w-full text-center text-xs text-ink-soft underline"
            >
              ログイン画面に戻る
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `/set-password`ページを実装する**

```tsx
// src/app/(auth)/set-password/page.tsx
"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }
    if (password !== confirmPassword) {
      setError("パスワードが一致しません。");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError("パスワードの設定に失敗しました。メールのリンクを開き直してお試しください。");
      return;
    }

    window.location.assign("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-[#11521A]">
          <LogoMark className="h-8 w-8 text-signal" />
          <span className="text-xl font-bold tracking-tight">dx-sensor</span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="scan-card space-y-4 rounded-lg border border-line bg-white p-6"
        >
          <div>
            <label htmlFor="password" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]">
              <Lock className="h-4 w-4" aria-hidden="true" />
              新しいパスワード
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm text-[#11521A] outline-none focus:border-signal focus:ring-1 focus:ring-signal"
              placeholder="8文字以上"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]">
              <Lock className="h-4 w-4" aria-hidden="true" />
              新しいパスワード（確認）
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm text-[#11521A] outline-none focus:border-signal focus:ring-1 focus:ring-signal"
              placeholder="8文字以上"
            />
          </div>

          {error && <p className="text-sm text-alert">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "設定中..." : "パスワードを設定"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ビルドが通ることを確認**

Run: `npm run build`
Expected: ビルド成功

- [ ] **Step 4: コミット**

```bash
git add "src/app/(auth)/login/page.tsx" "src/app/(auth)/set-password/page.tsx"
git commit -m "feat: PCログインにパスワード設定フローを追加"
```

---

### Task 17: リッチメニュー セットアップスクリプト

**Files:**
- Create: `scripts/setup-line-rich-menu.mjs`

**Interfaces:**
- Consumes: `LINE_CHANNEL_ACCESS_TOKEN`環境変数、`NEXT_PUBLIC_LIFF_ID`環境変数、リッチメニュー画像ファイル（利用者が別途用意する）
- Produces: LINE公式アカウントにリッチメニューを作成し、全ユーザーのデフォルトリッチメニューとして適用する一度限りの運用スクリプト

- [ ] **Step 1: スクリプトを実装する**

`.mjs`拡張子でNode組み込みの`fetch`のみを使い、ts-node等の追加ツールを不要にする。

```javascript
// scripts/setup-line-rich-menu.mjs
//
// LINE公式アカウントのリッチメニューを作成し、全ユーザーへのデフォルト適用まで行う。
// 一度実行すればよい運用スクリプト。実行前に以下を用意すること:
//   - 環境変数 LINE_CHANNEL_ACCESS_TOKEN, NEXT_PUBLIC_LIFF_ID
//   - リッチメニュー画像(推奨サイズ 2500x843px, PNG/JPEG, 1MB以下)へのパス
//
// 実行方法:
//   LINE_CHANNEL_ACCESS_TOKEN=xxx NEXT_PUBLIC_LIFF_ID=yyy \
//     node scripts/setup-line-rich-menu.mjs ./path/to/richmenu-image.png

import { readFile } from "node:fs/promises";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
const imagePath = process.argv[2];

if (!channelAccessToken || !liffId) {
  console.error("LINE_CHANNEL_ACCESS_TOKEN と NEXT_PUBLIC_LIFF_ID を環境変数で指定してください");
  process.exit(1);
}
if (!imagePath) {
  console.error("使い方: node scripts/setup-line-rich-menu.mjs <画像ファイルパス>");
  process.exit(1);
}

async function createRichMenu() {
  const res = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      size: { width: 2500, height: 843 },
      selected: true,
      name: "dx-sensor default menu",
      chatBarText: "メニュー",
      areas: [
        {
          bounds: { x: 0, y: 0, width: 2500, height: 843 },
          action: { type: "uri", uri: `https://liff.line.me/${liffId}` },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`リッチメニュー作成に失敗しました: ${res.status} ${await res.text()}`);
  }

  const { richMenuId } = await res.json();
  return richMenuId;
}

async function uploadImage(richMenuId) {
  const imageBuffer = await readFile(imagePath);
  const contentType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    throw new Error(`画像アップロードに失敗しました: ${res.status} ${await res.text()}`);
  }
}

async function setDefault(richMenuId) {
  const res = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${channelAccessToken}` },
  });

  if (!res.ok) {
    throw new Error(`デフォルト適用に失敗しました: ${res.status} ${await res.text()}`);
  }
}

const richMenuId = await createRichMenu();
console.log(`リッチメニューを作成しました: ${richMenuId}`);

await uploadImage(richMenuId);
console.log("画像をアップロードしました");

await setDefault(richMenuId);
console.log("全ユーザーのデフォルトリッチメニューとして適用しました");
```

- [ ] **Step 2: コミット**

```bash
git add scripts/setup-line-rich-menu.mjs
git commit -m "feat: LINEリッチメニュー作成スクリプトを追加"
```

（このスクリプトの実際の実行と画像アセットの用意はTask 18の手動検証で行う）

---

### Task 18: 手動検証

**Files:** なし（動作確認のみ）

**Interfaces:** なし

- [ ] **Step 1: 全自動テストを実行する**

```bash
npx vitest run
```

Expected: 全テストPASS

- [ ] **Step 2: LINE Developersコンソールで設定する**

1. LINE Developersコンソールで、Messaging APIチャネルを作成（または既存チャネルを使用）
2. チャネルシークレット・チャネルアクセストークンを発行し、`.env.production.local`（またはVercelの環境変数）に `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` として設定
3. 同じチャネルの数値チャネルIDを `LINE_LOGIN_CHANNEL_ID` として設定（LIFF IDとは別物。IDトークンの`aud`検証専用）
4. 同じチャネルでLIFFアプリを作成し、発行されたLIFF IDを `NEXT_PUBLIC_LIFF_ID` に設定。エンドポイントURLは `/liff/entry` と `/liff/link` の両方を配下に含む `https://<デプロイ先ドメイン>/liff` に設定すること（個別ページのURLを設定すると、もう片方のページで`liff.login()`のリダイレクトが失敗する）
5. Webhook URLを `https://<デプロイ先ドメイン>/api/line/webhook` に設定し、Webhookを有効化

- [ ] **Step 3: Webhook署名検証をcurlで確認する**

正しい署名でリクエストし、`200`が返ることを確認する:

```bash
BODY='{"events":[]}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$LINE_CHANNEL_SECRET" -binary | base64)
curl -i -X POST https://<デプロイ先ドメイン>/api/line/webhook \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: $SIGNATURE" \
  -d "$BODY"
```

Expected: `HTTP/1.1 200` かつ `{"ok":true}`

不正な署名（例: `X-Line-Signature: invalid`）では`401`が返ることも確認する。

- [ ] **Step 4: 招待発行→LINE友だち追加→本人確認の一連の流れをブラウザで確認する**

1. 管理者アカウントでログインし、`POST /api/tenant-members/invites` を叩いて招待URLを取得する（curlまたは開発者ツールから直接叩いてよい。管理画面UIは今回のスコープ外）
2. LINEアプリでdx-sensor公式アカウントを友だち追加し、自動返信メッセージのリンクが届くことを確認する
3. 手順1で取得した招待URL（`/liff/link?t=...`）をLINEアプリ内ブラウザで開き、本人確認後に`/`（テナントダッシュボード）へ遷移することを確認する
4. Supabase Studioで `line_friends.status = 'linked'`、`tenant_members` に新規行、`tenant_member_invites.used_at` が埋まっていることを確認する

- [ ] **Step 5: 2回目以降の条件付きSkipログインを確認する**

1. LINEアプリのリッチメニューから再度dx-sensorを開く
2. ログイン画面を経由せず`/`に到達することを確認する

- [ ] **Step 6: PCログインのパスワード設定フローを確認する**

1. 手順4で作成されたアカウントのメールアドレスで `(auth)/login` から「パスワードを未設定/お忘れの方はこちら」を選び、メールアドレスを送信する
2. 届いたメールのリンクから `/set-password` にアクセスし、パスワードを設定する
3. `/`へリダイレクトされることを確認する
4. 一度ログアウトし、設定したメールアドレス+パスワードで通常ログインできることを確認する

- [ ] **Step 7: リッチメニューを実際に作成する**

1. リッチメニュー画像（2500×843px）を用意する
2. Task 17のスクリプトを実行する:

```bash
LINE_CHANNEL_ACCESS_TOKEN=xxx NEXT_PUBLIC_LIFF_ID=yyy \
  node scripts/setup-line-rich-menu.mjs ./path/to/richmenu-image.png
```

3. LINEアプリでリッチメニューが表示され、タップすると`/liff/entry`経由でアプリが開くことを確認する
