# Free個人契約セルフサインアップ機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 個人がメールアドレスだけで自分のFreeテナントを作成できるセルフサインアップ画面（メール認証→LINE友だち招待QR表示）を追加する。

**Architecture:** `/signup`でメールアドレスを受け取りSupabase Auth標準のMagic Link（`signInWithOtp`）でメール送信 → `/signup/callback`でセッション確立を確認しサーバー側`POST /api/signup/provision`を呼ぶ → 未所属なら新規`tenants`（`tenant_type='free'`）+`tenant_members`（`role='owner'`）を作成し、LINE未リンクなら既存の`line_friend_invites`インフラに自己招待トークンを発行して`/line-friend-invite/[token]`（既存・無変更）へ遷移する。

**Tech Stack:** Next.js 14 (App Router) / TypeScript / Supabase (Auth Magic Link, Postgres, RLS) / Vitest。新規パッケージ追加なし。

**Spec:** `docs/superpowers/specs/2026-09-03-free-tenant-signup-design.md`

## Global Constraints

- 新規マイグレーションのファイル名はタイムスタンプ形式 `YYYYMMDDHHMMSS_description.sql` に従うこと
- マイグレーションはローカルファイル作成に加え、必ず`mcp__claude_ai_Supabase__apply_migration`（project_id `zocexlnxkenpzopchovl`）でも適用すること。ローカルのSupabase CLI/Dockerスタックは動いていないため、これが本番DBへ反映する唯一の手段
- 新規パッケージの追加・環境変数の追加は無し（Supabase Auth標準機能のみを使う）
- テストファイルは対象ファイルと同じディレクトリに`*.test.ts`として配置し、`npx vitest run <path>`で実行する（`package.json`に`test`スクリプトは無い）
- Supabase接続を伴う`route.ts`本体・Server Componentのpage.tsxは、既存コードベースの慣習（`src/app/api/tenant-members/friend-invites/route.ts`等にテストが無い）に倣い自動テスト対象としない。動作確認は最終タスクの手動検証で行う
- UIスタイリングは既存Tailwindトークン（`bg-paper`, `border-line`, `text-ink`, `text-alert`, `bg-signal`, `#11521A`）を使い、既存の`(auth)/login/page.tsx`と見た目を揃える。独自の配色を持ち込まない
- 招待トークンの生成には既存の`src/lib/line/inviteToken.ts`の`generateInviteToken()` / `inviteExpiryDate()`（TTL 72時間）をそのまま再利用する。複製しない
- `/line-friend-invite/[token]`・`/liff/friend-link/[token]`・`POST /api/line/friend-link-accept`は無変更で流用する。これらのファイルは一切編集しない

---

## File Structure

```
supabase/migrations/
  20260903020000_tenants_tenant_type.sql   [new]

src/lib/tenant/
  signupTenantIdentity.ts        [new] メールアドレス→テナントname/slug生成（純粋関数）
  signupTenantIdentity.test.ts   [new]

src/app/api/signup/provision/
  route.ts   [new]

src/app/(auth)/signup/
  page.tsx        [new] サーバーコンポーネント：既にテナント所属なら"/"へリダイレクト
  SignupForm.tsx  [new] クライアントコンポーネント：メールアドレス入力＋送信

src/app/(auth)/signup/callback/
  page.tsx   [new] クライアントコンポーネント：セッション確認→provision呼び出し→遷移
```

---

### Task 1: DBマイグレーション — `tenants.tenant_type`

**Files:**
- Create: `supabase/migrations/20260903020000_tenants_tenant_type.sql`

**Interfaces:**
- Consumes: 既存の`tenants`テーブル（`is_premium` boolean列）
- Produces: `tenants.tenant_type text not null default 'free' check (in ('free','premium','company'))`列。Task 3で`insert`時に使用

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
-- 20260903020000_tenants_tenant_type.sql
-- テナント種別（Free/Premium/会社テナント）を明示的に区別するカラムを追加する。
-- 既存のis_premium(boolean)はFree/Premiumの区別しかできず「会社テナント」を表現できないため、
-- 3値を持つtenant_typeを新設する。is_premium列は当面残す（撤去は別タスク）。

alter table tenants
  add column tenant_type text not null default 'free'
  check (tenant_type in ('free', 'premium', 'company'));

update tenants set tenant_type = 'premium' where is_premium = true;
```

- [ ] **Step 2: Supabase MCPで本番プロジェクトに適用する**

`mcp__claude_ai_Supabase__apply_migration`を呼ぶ（`project_id: "zocexlnxkenpzopchovl"`, `name: "tenants_tenant_type"`, Step 1のSQLをそのまま渡す）。

- [ ] **Step 3: 反映結果を確認する**

`mcp__claude_ai_Supabase__execute_sql`（`project_id: "zocexlnxkenpzopchovl"`）で以下を実行する:

```sql
select id, name, is_premium, tenant_type from tenants order by created_at;
```

Expected: 既存の「開発用テナント」行に`tenant_type = 'free'`（`is_premium = false`のため）が入っている。新しい列がエラー無く見えること。

- [ ] **Step 4: コミット**

```bash
git add supabase/migrations/20260903020000_tenants_tenant_type.sql
git commit -m "feat: tenantsにtenant_type列を追加（Free/Premium/会社テナントの区別）"
```

---

### Task 2: lib — テナントname/slug自動生成

**Files:**
- Create: `src/lib/tenant/signupTenantIdentity.ts`
- Test: `src/lib/tenant/signupTenantIdentity.test.ts`

**Interfaces:**
- Produces: `buildSignupTenantIdentity(email: string, userId: string): { name: string; slug: string }`。Task 3で使用

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/tenant/signupTenantIdentity.test.ts
import { describe, expect, it } from "vitest";
import { buildSignupTenantIdentity } from "./signupTenantIdentity";

const USER_ID_A = "11111111-1111-4111-8111-111111111111";
const USER_ID_B = "22222222-2222-4222-8222-222222222222";

describe("buildSignupTenantIdentity", () => {
  it("uses the email local part as the tenant name", () => {
    const { name } = buildSignupTenantIdentity("taro.yamada@example.com", USER_ID_A);
    expect(name).toBe("taro.yamada");
  });

  it("normalizes the local part into a lowercase hyphen slug", () => {
    const { slug } = buildSignupTenantIdentity("Taro.Yamada+test@example.com", USER_ID_A);
    expect(slug.startsWith("taro-yamada-test-")).toBe(true);
  });

  it("only contains url-safe lowercase characters and hyphens in the slug", () => {
    const { slug } = buildSignupTenantIdentity("Taro.Yamada+test@example.com", USER_ID_A);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("produces different slugs for different userIds with the same email local part", () => {
    const a = buildSignupTenantIdentity("taro@example.com", USER_ID_A);
    const b = buildSignupTenantIdentity("taro@example.com", USER_ID_B);
    expect(a.slug).not.toBe(b.slug);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/tenant/signupTenantIdentity.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: signupTenantIdentity.tsを実装する**

```typescript
// src/lib/tenant/signupTenantIdentity.ts
const SLUG_INVALID_CHARS = /[^a-z0-9-]/g;
const SLUG_SUFFIX_LENGTH = 8;

export function buildSignupTenantIdentity(
  email: string,
  userId: string
): { name: string; slug: string } {
  const localPart = email.split("@")[0] || "user";
  const name = localPart;

  const normalized = localPart.toLowerCase().replace(SLUG_INVALID_CHARS, "-");
  const suffix = userId.replace(/-/g, "").slice(0, SLUG_SUFFIX_LENGTH);
  const slug = `${normalized}-${suffix}`;

  return { name, slug };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/tenant/signupTenantIdentity.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/tenant/signupTenantIdentity.ts src/lib/tenant/signupTenantIdentity.test.ts
git commit -m "feat: セルフサインアップ用のテナントname/slug自動生成ロジックを追加"
```

---

### Task 3: API — `POST /api/signup/provision`

**Files:**
- Create: `src/app/api/signup/provision/route.ts`

**Interfaces:**
- Consumes: `getViewerContext`・`getActiveTenant`（既存）、`buildSignupTenantIdentity`（Task 2）、`generateInviteToken`・`inviteExpiryDate`（既存`src/lib/line/inviteToken.ts`）、`createServiceSupabase`（既存）
- Produces: `POST /api/signup/provision`。成功時 `200 { redirectTo: "/" }` または `200 { inviteUrl: string }`、未ログイン`401`、サーバーエラー`500`。Task 5（`/signup/callback`）で使用

このタスクはSupabaseへの実接続が前提のため、既存コードベースの慣習（`src/app/api/tenant-members/friend-invites/route.ts`等と同様）に倣い自動テストを書かない。動作確認は Task 6 の手動検証で行う。

- [ ] **Step 1: route.tsを実装する**

```typescript
// src/app/api/signup/provision/route.ts
import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { generateInviteToken, inviteExpiryDate } from "@/lib/line/inviteToken";
import { createServiceSupabase } from "@/lib/supabase/server";
import { buildSignupTenantIdentity } from "@/lib/tenant/signupTenantIdentity";

export async function POST() {
  const viewer = await getViewerContext();
  if (!viewer.userId || !viewer.email) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const userId = viewer.userId;
  const email = viewer.email;
  const service = createServiceSupabase();

  const existingTenant = await getActiveTenant(userId);
  let tenantId: string;

  if (existingTenant) {
    tenantId = existingTenant.tenantId;
  } else {
    const { name, slug } = buildSignupTenantIdentity(email, userId);

    const { data: tenant, error: tenantError } = await service
      .from("tenants")
      .insert({ name, slug, tenant_type: "free", is_premium: false })
      .select("id")
      .single();

    if (tenantError || !tenant) {
      console.error("signup/provision: tenants insert failed", tenantError);
      return NextResponse.json({ error: "tenant_creation_failed" }, { status: 500 });
    }

    const { error: memberError } = await service.from("tenant_members").insert({
      tenant_id: tenant.id,
      user_id: userId,
      role: "owner",
    });

    if (memberError) {
      console.error("signup/provision: tenant_members insert failed", memberError);
      await service.from("tenants").delete().eq("id", tenant.id);
      return NextResponse.json({ error: "member_creation_failed" }, { status: 500 });
    }

    tenantId = tenant.id;
  }

  const { data: friend } = await service
    .from("line_friends")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "linked")
    .maybeSingle();

  if (friend) {
    return NextResponse.json({ redirectTo: "/" });
  }

  const inviteToken = generateInviteToken();
  const expiresAt = inviteExpiryDate();

  const { error: inviteError } = await service.from("line_friend_invites").insert({
    tenant_id: tenantId,
    user_id: userId,
    invite_token: inviteToken,
    created_by: userId,
    expires_at: expiresAt.toISOString(),
  });

  if (inviteError) {
    console.error("signup/provision: line_friend_invites insert failed", inviteError);
    return NextResponse.json({ error: "invite_creation_failed" }, { status: 500 });
  }

  return NextResponse.json({ inviteUrl: `/line-friend-invite/${inviteToken}` });
}
```

- [ ] **Step 2: 型チェックが通ることを確認する**

```bash
npx tsc --noEmit --pretty false
```

Expected: エラー無し（Task 1のマイグレーションが未適用だと`tenant_type`列の型が無く警告が出る可能性がある。その場合はTask 1が先に完了しているか確認する。このプロジェクトはSupabaseの型生成を明示的に実行するまで`database.types.ts`が更新されないため、型エラーが出ても`insert`呼び出し自体は実行時には問題なく動く。気になる場合は`npm run supabase:types`で型を再生成する）

- [ ] **Step 3: コミット**

```bash
git add src/app/api/signup/provision/
git commit -m "feat: セルフサインアップのテナント作成API(POST /api/signup/provision)を追加"
```

---

### Task 4: フロントエンド — メールアドレス入力画面

**Files:**
- Create: `src/app/(auth)/signup/page.tsx`
- Create: `src/app/(auth)/signup/SignupForm.tsx`

**Interfaces:**
- Consumes: `getViewerContext`・`getActiveTenant`（既存）、`createClient`（既存`src/lib/supabase/client.ts`）
- Produces: 公開ページ`GET /signup`

- [ ] **Step 1: SignupForm.tsxを実装する**

```tsx
// src/app/(auth)/signup/SignupForm.tsx
"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/signup/callback`,
      },
    });

    setLoading(false);

    if (error) {
      setError("メールの送信に失敗しました。時間をおいて再度お試しください。");
      return;
    }

    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-[#11521A]">
          <LogoMark className="h-8 w-8 text-signal" />
          <span className="text-xl font-bold tracking-tight">dx-sensor</span>
        </div>

        <div className="scan-card space-y-4 rounded-lg border border-line bg-white p-6">
          {sent ? (
            <p className="text-sm text-[#11521A]">
              メールを送信しました。届いたリンクを開いて登録を完了してください。
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]"
                >
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

              {error && <p className="text-sm text-alert">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "送信中..." : "登録メールを送る"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: page.tsxを実装する**

```tsx
// src/app/(auth)/signup/page.tsx
import { redirect } from "next/navigation";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { SignupForm } from "./SignupForm";

export default async function SignupPage() {
  const viewer = await getViewerContext();

  if (viewer.userId) {
    const tenant = await getActiveTenant(viewer.userId);
    if (tenant) {
      redirect("/");
    }
  }

  return <SignupForm />;
}
```

- [ ] **Step 3: 型チェックが通ることを確認する**

```bash
npx tsc --noEmit --pretty false
```

Expected: エラー無し

- [ ] **Step 4: コミット**

```bash
git add src/app/\(auth\)/signup/page.tsx src/app/\(auth\)/signup/SignupForm.tsx
git commit -m "feat: セルフサインアップのメールアドレス入力画面(/signup)を追加"
```

---

### Task 5: フロントエンド — マジックリンク受け口画面

**Files:**
- Create: `src/app/(auth)/signup/callback/page.tsx`

**Interfaces:**
- Consumes: `createClient`（既存）、`POST /api/signup/provision`（Task 3、レスポンス`{ redirectTo: string } | { inviteUrl: string }`）
- Produces: 公開ページ`GET /signup/callback`

- [ ] **Step 1: page.tsxを実装する**

```tsx
// src/app/(auth)/signup/callback/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type CallbackState = "loading" | "error";

export default function SignupCallbackPage() {
  const [state, setState] = useState<CallbackState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        if (!cancelled) setState("error");
        return;
      }

      try {
        const res = await fetch("/api/signup/provision", { method: "POST" });
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (!cancelled) setState("error");
          return;
        }

        window.location.assign(body.redirectTo ?? body.inviteUrl ?? "/");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-6">
        <div className="w-full max-w-sm space-y-3 text-center text-sm text-ink">
          <p className="text-alert">リンクの有効期限が切れているか、無効です。</p>
          <a href="/signup" className="text-signal underline">
            もう一度登録する
          </a>
        </div>
      </div>
    );
  }

  return <p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>;
}
```

- [ ] **Step 2: 型チェックが通ることを確認する**

```bash
npx tsc --noEmit --pretty false
```

Expected: エラー無し

- [ ] **Step 3: コミット**

```bash
git add src/app/\(auth\)/signup/callback/
git commit -m "feat: セルフサインアップのマジックリンク受け口(/signup/callback)を追加"
```

---

### Task 6: 手動検証

**Files:** なし（動作確認のみ）

**Interfaces:** なし

- [ ] **Step 1: 全自動テストを実行する**

```bash
npx vitest run
```

Expected: 全テストPASS（Task 2の4件を含む）

- [ ] **Step 2: Supabase AuthのRedirect URL設定を確認する**

Supabase Studio → Authentication → URL Configuration で、`emailRedirectTo`に使う`<デプロイ先ドメイン>/signup/callback`が許可されているか確認する（既存の`/set-password`が動いているなら同一オリジンのワイルドカードまたはSite URL配下が許可されている可能性が高いが、念のため確認する）。許可されていない場合はRedirect URLsに追加する。

- [ ] **Step 2.5: Magic Linkメールテンプレートの文面を確認する**

Supabase Studio → Authentication → Email Templates → Magic Link を開き、件名・本文がdx-sensorの新規登録メールとして違和感が無いか確認する（デフォルトのままだと「ログイン用リンク」的な汎用文言になっている場合がある）。気になる場合はこのタスクの範囲内でテンプレートを編集する（コードの変更は不要、Supabase Studio上の設定のみ）。

- [ ] **Step 3: 新規メールアドレスでのサインアップを確認する**

1. まだ`auth.users`に存在しないメールアドレスで`/signup`を開き、送信する
2. 「メールを送信しました」表示になることを確認する
3. 届いたメール内のリンクを開き、`/signup/callback`経由でリダイレクトされることを確認する
4. Supabase Studioで、新しい`tenants`行（`tenant_type='free'`, `is_premium=false`）と、`role='owner'`の`tenant_members`行が作成されていることを確認する
5. `/line-friend-invite/<token>`にリダイレクトされ、QRコードが表示されることを確認する

- [ ] **Step 4: QRコードスキャン〜紐付け完了を実機で確認する**

1. 手順3で表示したQRコードを、登録した本人のスマートフォンのLINEアプリでスキャンする
2. 友だち追加プロンプトが出ることを確認する（未フォローの場合）
3. LIFFが起動し「連携が完了しました」と表示されることを確認する
4. Supabase Studioで、`line_friends`行が`status='linked'`かつ正しい`user_id`/`tenant_id`になっていることを確認する

- [ ] **Step 5: 再訪問時（既にリンク済み）の挙動を確認する**

1. 手順4で連携済みのメールアドレスで、再度`/signup`からサインアップを行う
2. メール内リンクを開いた後、`/signup/callback`が`/`へリダイレクトすること（新しいQRコードが出ないこと）を確認する

- [ ] **Step 6: `/liff/entry`での再ログインを確認する**

1. 手順4で連携したアカウントで、LINEのリッチメニューから`/liff/entry`を開く
2. ログイン画面・`/signup`を経由せず`/`（テナントダッシュボード）に到達することを確認する

- [ ] **Step 7: 既にテナントを持つログイン中ユーザーが`/signup`にアクセスした場合を確認する**

1. 既存のテナントメンバー（例: developerアカウント）でログインした状態で`/signup`を開く
2. 即座に`/`へリダイレクトされることを確認する
