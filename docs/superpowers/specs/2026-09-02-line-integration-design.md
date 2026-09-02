# LINE連携機能 設計書

- 日付: 2026-09-02
- ステータス: 設計承認済み・実装計画作成前

## 背景・目的

dx-sensorに、LINE公式アカウントのリッチメニュー経由でのアクセス機能を追加する。

現場ユーザーとPCユーザー（管理者含む）で求められる体験が異なるため、2つの入口を用意する。

1. **現場ユーザー**: LINE友だちのリッチメニューから、ログイン無しでテナントダッシュボード（`/`）にアクセスでき、そこから書類キャプチャー・写真送信・定点監視などの入力画面を選べる。毎回のログインは不要。
2. **PCユーザー（現場ユーザー・管理者とも）**: 情報量が多い検索画面・管理画面は、PCから通常どおり「ログイン」してアクセスする。

### 補足: リッチメニューの遷移先はダッシュボード1箇所

設計初期段階では「書類キャプチャー」「写真送信」「定点撮影」の3画面に個別のリッチメニューボタンを割り当てる案を検討したが、以下の理由でリッチメニューは**1ボタン→`(tenant)/page.tsx`（`/`、既存のテナントダッシュボード）への遷移のみ**に単純化した。

- `(tenant)/page.tsx` は既に「定点監視カメラ」「写真レポート」「文書ホルダー」のカテゴリでdocuments/new・send_picture・capture_auto等への入口を網羅したカタログページであり、個別ボタンを作る必要がない
- 一般ユーザー向けの単純な「手動撮影」専用ページは現状存在しない（`(admin)/admin/capture`は`isDeveloper`必須の開発者専用ページであり流用不可）。ダッシュボード経由にすることでこの画面欠落の問題も回避できる
- `target`パラメータや許可リストといった複雑さが不要になり、実装・保守コストが下がる（YAGNI）

## 前提・既存実装の確認結果

企画段階で参照した旧設計書（`claude-code-prompt_line-integration-v2.md`）は、本プロジェクトが「駐車場×ANPR」を主ユースケースとしていた時期に書かれたものであり、現状のコードベースとは以下の点で乖離している。今回の設計はこの乖離を踏まえ、現状のコードベースに合わせて刷新した。

- 駐車場関連テーブル（`parking_lots`, `parking_spots`, `vehicle_events`）は `0015_drop_parking_lots_spots.sql` 等で既に廃止済み。現在の主要機能は「書類キャプチャー（請求書・領収書・発注書等）」「写真送信」「定点撮影・自動モニタリング（ゾーン分析）」。
- マイグレーションのファイル命名規則は、初期は連番（`0001`〜`0023`）だったが、途中からタイムスタンプ形式（`YYYYMMDDHHMMSS_description.sql`）に移行済み。新規マイグレーションはタイムスタンプ形式に従う。
- ログイン画面は `src/app/(auth)/login/page.tsx`（旧設計書が触れないよう指定していた `src/app/login/page.tsx` とはパスが異なる。ルートグループ `(auth)` 配下）。現状は `supabase.auth.signInWithPassword` によるメール+パスワード認証のみ。
- `(tenant)/layout.tsx` は `getViewerContext()` でログイン必須ガードを行っており、未ログイン時は `/login` へリダイレクトする。この既存ガードは変更しない。
- 以下は変更しない（旧設計書から継続する前提）:
  - `src/lib/auth/getViewerContext.ts`
  - `src/lib/auth/getActiveTenant.ts`
  - `src/lib/supabase/server.ts` / `src/lib/supabase/client.ts`
  - `supabase/migrations/0001_init.sql` の `tenant_members` 定義・RLSヘルパー関数（`auth_tenant_ids()` / `has_tenant_role()` / `is_app_developer()`）

## 採用する方式

- 全テナント共用の**単一LINE公式アカウント**を使う（テナントごとの個別アカウントは作らない。LINE公式アカウントの新規開設はLINE社の管理画面での手動操作が必須でAPI化できないため）
- 管理者が発行した招待（宛メールアドレス指定）→招待された人がLINE友だち追加→LIFFで本人確認→その場で `auth.users` と `tenant_members` の行を自動作成
- 作成されたアカウントは**パスワードなし**。ログイン手段は2系統を持つ:
  - LINE経由の自動ログイン（IDトークン検証によるセッション確立、ユーザーはログイン画面を意識しない）
  - PCからのメール+パスワードログイン（初回はパスワード未設定のため、パスワード設定フローを経由する）
- 一度紐付けが完了したユーザーは、以降LINEのリッチメニューからのアクセス時にID/パスワード入力なしで自動的に本人特定・セッション確立される（条件付きSkipログイン）。未紐付けユーザーは必ず通常フローに落ちる。

## 全体アーキテクチャ

```
現場ユーザー(LINE)                     PCユーザー(現場/管理者)
  │ リッチメニュータップ                    │ 通常ブラウザ
  ▼                                        ▼
/liff/entry (新設)                     /(auth)/login (既存拡張)
  │ LIFF SDK初期化                          │ ①メール+パスワード
  │ IDトークン取得                          │ ②初回はパスワード未設定
  ▼                                        │   →リセットリンクで設定
POST /api/line/liff-auth (新設)             ▼
  │ IDトークン検証(jose)                  supabase.auth.signInWithPassword
  │ line_friends照合                          │
  │ 既存アカウント→自動セッション確立         │
  ▼                                        ▼
        (tenant)/page.tsx「/」テナントダッシュボード（既存、無改修）
        ── getViewerContext() / getActiveTenant() も無改修 ──
```

LINE経由・PC経由のどちらも、最終的には同一のSupabase Authセッション（Cookie）に収束する。`(tenant)/layout.tsx` や各ページの認可ロジックは一切変更しない。

## DBマイグレーション

現状の命名規則（タイムスタンプ形式）に従い、以下2つを新規追加する。

```sql
-- 20260902xxxxxx_tenant_member_invites.sql
create table tenant_member_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invitee_email text not null,
  role text not null default 'viewer'
    check (role in ('owner','admin','viewer')),  -- developerは招待経由で付与不可
  invite_token text not null unique,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table tenant_member_invites enable row level security;
create policy tenant_member_invites_admin_only on tenant_member_invites
  for all using (is_app_developer() or has_tenant_role(tenant_id, 'admin'))
  with check (is_app_developer() or has_tenant_role(tenant_id, 'admin'));
grant select, insert, update, delete on public.tenant_member_invites to authenticated;

-- 20260902xxxxxx_line_friends.sql
create table line_friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  line_user_id text not null unique,
  display_name text,
  status text not null default 'unlinked' check (status in ('unlinked','linked','blocked')),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table line_friends enable row level security;
create policy line_friends_tenant_isolation on line_friends
  for select using (is_app_developer() or tenant_id in (select auth_tenant_ids()));
-- service_role のみが書き込む(webhook/liff-authの処理経由)ため、
-- tenant/userに向けたINSERT/UPDATEポリシーは設けない
```

`authenticated` ロールへのGRANTは、`0007_grant_authenticated_tenant_members.sql` で発生したGRANT漏れ（RLSポリシーは正しくてもテーブルレベルのGRANTが無いと `permission denied` になる）の教訓を踏まえ、両テーブルとも明示的に付与する。

## APIエンドポイント

既存の `api/cron`（クラウド起点定期実行）・`api/ingest`（エージェント等からのPush受信）という分類に倣い、LINEプラットフォームからのPushという性質から `api/line/` を新設する。招待発行のみ、RLSで守られたテナント管理操作として `api/tenant-members/` に置く。

| エンドポイント | 実行方式 | 役割 |
|---|---|---|
| `POST /api/tenant-members/invites` | `createServerSupabase()`（RLSスコープ） | admin/ownerが招待発行。`tenant_member_invites` にトークン発行、招待URLを返す |
| `POST /api/line/webhook` | `createServiceSupabase()` | LINE Messaging APIのWebhook受信。`X-Line-Signature` をHMAC-SHA256で検証。`follow`/`unfollow`/`message` イベント処理 |
| `POST /api/line/invite-accept` | `createServiceSupabase()` | 初回のみ。LIFF IDトークン検証→招待トークン照合→`auth.users`/`tenant_members`/`line_friends` を作成→セッション確立 |
| `POST /api/line/liff-auth` | `createServiceSupabase()` | 2回目以降。LIFF IDトークン検証→既存 `line_friends` 照合→セッション確立→`target` の遷移先を返す |

`createServiceSupabase()` の既存コメント（「Vercel Cronジョブ専用」）は、LINE関連の認証フローもservice_role利用の正当なユースケースとして追記が必要。

### IDトークン検証

LINEのIDトークン（JWT）検証には `jose` パッケージを新規追加する。検証項目: 署名（LINEのJWKSエンドポイントから取得した鍵）、`aud`（LIFF ID一致）、`iss`（`https://access.line.me`）、`exp`。

## LIFF画面

`src/app/liff/entry/page.tsx`（`(tenant)` / `(admin)` / `(auth)` いずれのルートグループにも属さない独立ルート。`(tenant)/layout.tsx` のログイン必須ガードを経由しないため）

処理フロー:
1. マウント時にLIFF SDK初期化（`liff.init({ liffId })`）
2. `liff.isLoggedIn()` でなければ `liff.login()`（LINEアプリ内なら自動遷移）
3. `liff.getIDToken()` でIDトークン取得
4. `POST /api/line/liff-auth` に `{ idToken }` を送信
5. 成功: サーバーがSet-Cookieでセッション確立済み → `/`（テナントダッシュボード）へ `window.location.assign`
6. 失敗時、理由で分岐:
   - `not_linked`（初回・未紐付け） → `/liff/link?t={invite_token}` へ誘導（招待メール記載の招待URLから改めてアクセスするよう案内）
   - `token_invalid` / `expired` → LIFFエラー画面（再読み込み案内）

`src/app/liff/link/page.tsx` — 招待URL（`/liff/link?t={invite_token}`）からLINEブラウザで開かれる。LIFF初期化→IDトークン取得→`POST /api/line/invite-accept`→成功後は `entry` と同じくセッション確立→`/`へ遷移。

## リッチメニュー構成

全テナント共通のリッチメニュー1種類（テナント別カスタマイズは対象外）。**1ボタン構成**、遷移先は`(tenant)/page.tsx`（`/`テナントダッシュボード）に固定。

| ボタン | 遷移先 |
|---|---|
| dx-sensorを開く | `https://liff.line.me/{LIFF_ID}` |

作成・デフォルト適用は Messaging API の `POST /v2/bot/richmenu` と `POST /v2/bot/user/all/richmenu/{richMenuId}` を叩くセットアップスクリプトとして用意する（一度実行すればよく、運用スクリプトとしてAPIルートに常駐させる必要はない）。

## PCログイン（パスワード設定フロー）

LINE経由の自動作成アカウントはパスワード未設定のため、初回PCログイン時にパスワードを設定させる。

`(auth)/login/page.tsx` に「パスワードを未設定/お忘れの方はこちら」リンクを追加：

1. リンククリック→メール入力フォーム（既存フォームの下に表示切替）
2. `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/set-password` })`
3. メール内リンクからアクセス → `src/app/(auth)/set-password/page.tsx`（新規）
4. Supabaseが自動的にrecoveryセッションを確立済み → 新パスワード入力フォーム
5. `supabase.auth.updateUser({ password })` → 完了後 `/` へリダイレクト
6. 以降は通常の `signInWithPassword` でログイン可能

このフローはLINE経由ユーザーに限らず、パスワード未設定の任意ユーザーに共通して使える汎用フローとする。

## エラーハンドリング方針

- `liff-auth` / `invite-accept` は失敗理由をサーバーログにのみ詳細記録し、クライアントには汎用メッセージ＋理由コード（`token_invalid` / `expired` / `already_used` / `not_linked`）のみ返す
- LINE Webhookの署名検証失敗は401を即返却。ペイロードはログしない（個人情報配慮）
- 招待トークンの期限は72時間、使用済みトークンの再利用は`already_used`として拒否

## テスト方針

- **単体**: JWT検証ロジック（`jose`ラッパー関数）、Webhook署名検証、招待トークン生成
- **統合**: `/api/line/invite-accept` と `/api/line/liff-auth` をモックIDトークンで疎通確認。RLS越しに `tenant_members` / `line_friends` が正しいテナントスコープで作成されるかを検証（`tenant_id`フィルタの取り違えがないこと、を最終防御線として明示的にテストする）
- **E2E**: LIFF実機はLINEアプリ内ブラウザでしか正確に検証できないため、Playwright自動化は費用対効果が低い。手動確認手順（curlでのWebhookテスト、LIFFのブラウザ確認手順、マジックリンクのメール受信確認）を実装計画に明記し、各ステップ完了後に確認する

## 環境変数（新規追加）

```
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LIFF_ID=
```

## 追加が必要な依存パッケージ

- `jose`（LINEのIDトークン検証・JWKS取得・署名検証用）

## 未確定事項（実装前に確認すること）

- Supabase標準のメール送信（`resetPasswordForEmail` / 招待メール）は送信数に制限があるため、本番運用前に独自SMTP/Resend等への切り替えが必要かどうかは別途確認する
- `tenant_member_invites.role` に `developer` を含めない制約は、DBのcheck制約とAPI側のバリデーション両方で担保すること

## スコープ外（今回実装しない）

- Push通知連携（変化検知アラートのLINE配信）— 今回の2目標には含まれないため次フェーズ
- テナント別リッチメニューのカスタマイズ
- LINE上での自由対話・チャットボット機能
- 招待管理画面のUI（発行APIまでが対象。管理画面フロントは別タスク）
- 1 LINEアカウントが複数テナントに紐づくケース（1 LINEアカウント = 1テナントの1メンバーが前提）
- 独自SMTP/Resendへの切り替え（前述の未確定事項として別途判断）

## 実装順序の推奨

1. DBマイグレーション（`tenant_member_invites`, `line_friends`）
2. 招待発行API（`/api/tenant-members/invites`）
3. LINE Webhook受信・署名検証・follow/unfollowハンドリング
4. 招待受諾・アカウント自動作成API（`/api/line/invite-accept`、JWT検証ロジックを共通関数化）
5. LIFF条件付きSkipログインAPI（`/api/line/liff-auth`、4のJWT検証ロジックを再利用）
6. `/liff/entry`・`/liff/link` 画面
7. PCログイン画面のパスワード設定フロー追加（`/set-password`）
8. リッチメニューのセットアップスクリプト
9. 動作確認（curlでのWebhookテスト、LIFFブラウザ確認、マジックリンクのメール受信確認）
