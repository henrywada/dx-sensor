# Free個人契約セルフサインアップ機能 設計書

- 日付: 2026-09-03
- ステータス: 設計承認済み・実装計画作成前
- 関連設計書: `docs/superpowers/specs/2026-09-02-line-friend-invite-design.md`（本設計書はそのインフラを無変更で流用する）、`docs/superpowers/specs/2026-09-02-line-integration-design.md`

## 背景・目的

dx-sensorの契約形態は「個人契約（Free/Premium）」「会社契約（会社テナント）」の2種類、テナント種別は「Free/Premium/会社テナント」の3種類と定義されている（ユーザーが2026-09-03に提示、`CLAUDE.md`・`.cursor/rules/dx-sensor-concept.mdc`に記載済み）。

しかし現状のコードには、この契約動線のうち「LPでプランを選択→ユーザー登録→認証メール→LINE友だち招待QR表示」という**セルフサービス登録の入口が一切存在しない**。既存の新規アカウント作成経路は以下の3つのみで、いずれも「既存の管理者や開発者が誰かを招待する」ことが前提であり、「本人が自分の意思で最初のテナントを作る」動線にはなっていない。

1. developer専用 `/admin/members` の`addMemberAction`（仮パスワード発行、メール認証なし）
2. `tenant_member_invites` + `/liff/link` + `POST /api/line/invite-accept`（既存の管理者がメールアドレス宛に招待。受信者はLINEログインのみで即アカウント作成されメール認証は行われない。**呼び出し元UIがフロントエンドに存在しないオーファンAPI**）
3. `line_friend_invites`（今回のfriend-invites機能。既存`tenant_members`のみが対象で新規アカウント作成は行わない）

本機能は、上記のうち**契約動線1（個人契約・Free）** の「b) ユーザー登録+認証メール送信」「c) 認証後のLINE友だち招待QR表示」を実装し、個人が自分でFreeテナントを作成できるようにする。Premium・会社契約はStripe決済が未実装のため今回のスコープ外とする。

## 前提・既存実装の確認結果

- `(auth)`ルートグループには`/login`（パスワードログイン＋パスワードリセット）と`/set-password`のみ。`/signup`等は存在しない。
- `resetPasswordForEmail`（`login/page.tsx`のパスワードリセット導線）が、Supabase Auth標準のメール送信＋メール内リンククリックでセッションを確立する**唯一の既存フロー**。今回はこれと同じ仕組み（Supabase Auth標準機能）を使う。
- `establishSupabaseSession`（LINE招待フローで使用）は`admin.generateLink` + `verifyOtp`をサーバー側だけで完結させる「メール送信なしのマジックリンク」パターン。今回は実際にメールを送る必要があるため、これとは別に`supabase.auth.signInWithOtp()`（クライアントSDK、実際にメール送信する）を使う。
- `getActiveTenant(userId)`は「ユーザーは1テナントのみ所属」というMVP前提（[getActiveTenant.ts](../../../src/lib/auth/getActiveTenant.ts)にコメント済み）。本機能もこの前提を崩さない。
- `tenants`は`is_premium`(boolean)のみ保持し、`tenant_type`列は存在しない。本番の`tenants`テーブルは現状「開発用テナント」1件のみ（`is_premium=false`、メンバー1件）。
- `/liff/entry`（[LiffEntryView.tsx](../../../src/app/liff/entry/LiffEntryView.tsx)）は、LINEログイン→ID token検証→`line_friends`で既にlinked済みなら`establishSupabaseSession`相当の仕組みでセッション確立→`/`へリダイレクトする、**パスワードレスな再ログイン導線**。LINE連携済みのユーザーは以降パスワードを一切必要としない。
- `line_friend_invites` / `/line-friend-invite/[token]` / `/liff/friend-link/[token]` / `POST /api/line/friend-link-accept`（friend-invites機能で新設・最終レビューで修正済み）は、招待トークン1件につき「特定の`tenant_id`+`user_id`にLINEアカウントを紐付ける」処理として汎用的に作られており、**招待者が第三者（管理者）である必要はない**。トークンの`created_by`と`user_id`が同一（自己招待）でも動作上の問題はない。

## 採用する方式（ブレインストーミングでの決定事項）

- **対象範囲**: 今回はFreeプランの個人自己登録のみ。Premium・会社契約はStripe実装後に別途設計する。LPのプラン選択UI自体も今回のスコープ外（`/signup`への直接アクセスを起点とする）。
- **認証方式**: 仕様文言の「認証の為のメールを送信」を文字通り実装する。Supabase Auth標準のメール系OTP（Magic Link、`signInWithOtp`）を使い、メール内リンクのクリックを本人確認とする。パスワードは一切設定しない（既存のLINE招待フローと同じ「パスワードレス」方針に統一。以降のログインは`/liff/entry`経由が主導線になる）。
- **テナント名/slug**: ユーザーに入力させず、メールアドレスから自動生成する（登録フォームの入力項目をメールアドレスのみに保つ）。
- **LINE友だち招待QR表示**: 新規のQR生成コードは書かない。`line_friend_invites`に「自己招待」トークン（`tenant_id`=新規テナント、`user_id`=`created_by`=登録した本人）をinsertし、既存の`/line-friend-invite/[token]`・`/liff/friend-link/[token]`・`POST /api/line/friend-link-accept`を**完全に無変更で流用**する。
- **`tenants.tenant_type`**: 今回のマイグレーションに含めて新設する（`'free' | 'premium' | 'company'`）。バックフィルは既存`is_premium`から機械的に変換する（現状1件のみのため実質的な影響はない）。

## 全体アーキテクチャ

```
[LP / 料金プラン(Free)を選択]  ※dx-sensorアプリ外の想定。今回のスコープ外
    │
    ▼
[/signup] メールアドレス入力のみ
    │ supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/signup/callback` } })
    ▼
「メールを送信しました」表示
    │
    ▼ （ユーザーがメール内リンクをクリック）
[/signup/callback] クライアントコンポーネント
    │ Supabaseクライアントがマジックリンクのtoken_hashをURLから検出しセッションを自動確立
    │ POST /api/signup/provision
    ▼
provision（service_role）:
  - 未ログインなら401
  - tenant_members未所属なら:
      tenants insert（tenant_type='free', is_premium=false, name/slugはメールから自動生成）
      tenant_members insert（role='owner'）
  - ここまでで所属テナントが確定した上で、line_friendsが既にlinked済みか確認:
      linked済み → { redirectTo: "/" } を返す（＝再ログイン。友だち追加は完了済み）
      未リンク    → line_friend_invites insert（tenant_id, user_id=created_by=自分, 72h TTL）
                    → { inviteUrl: "/line-friend-invite/<token>" } を返す
    ▼
callbackは redirectTo があれば "/" へ、inviteUrl があればそこへ遷移
    ▼
[/line-friend-invite/[token]]（既存・無変更）QRコード表示
    ▼
[LINEでQRスキャン] → [/liff/friend-link/[token]]（既存・無変更） → POST /api/line/friend-link-accept（既存・無変更）
    ▼
line_friends が linked に。以降は /liff/entry（既存・無変更）でパスワードレスに再ログイン
```

## データモデル

```sql
-- 202609xxxxxx_tenants_tenant_type.sql
alter table tenants
  add column tenant_type text not null default 'free'
  check (tenant_type in ('free', 'premium', 'company'));

update tenants set tenant_type = case when is_premium then 'premium' else 'free' end;
```

本番には現状「開発用テナント」1件のみで、実質的な影響はない。`is_premium`列は当面残す（撤去・二重管理の整理は別タスク）。会社テナントとして扱うべき既存レコードがあれば、developer が`/admin/tenants`から手動で`tenant_type='company'`に更新する運用とする（UIへの反映有無は実装計画で判断）。

## APIエンドポイント

| エンドポイント | 実行方式 | 役割 |
|---|---|---|
| `POST /api/signup/provision` | `getViewerContext()`でログイン確認 → `createServiceSupabase()`でテナント作成 | 未ログイン401。未所属なら新規Freeテナント＋ownerメンバーを作成。その上でLINE未リンクなら自己招待トークンを発行し`{ inviteUrl }`を、リンク済みなら`{ redirectTo: "/" }`を返す |

新規テナント作成（`tenants` insert）は既存のRLSでは`authenticated`ロールに許可されていないため`service_role`必須。呼び出し元の判定は`service_role`の外側（`getViewerContext()`のセッション確認）のみで行う。

**部分失敗時の後始末**: `tenants` insert成功後に`tenant_members` insertが失敗した場合、`addMemberAction`（[actions.ts](../../../src/app/(admin)/admin/members/actions.ts)）の既存パターン（ユーザー作成後にmember insertが失敗したら作成したユーザーを削除する補償操作）に倣い、作成した`tenants`行を削除してから500を返す。`line_friend_invites` insertの失敗は致命的ではない（テナント・メンバーは作成済みのため）。この場合は`inviteUrl`を返さず500を返す。`provision`は「所属テナントの有無」と「LINEリンク済みか」を毎回見て未リンクなら常に新しい招待トークンを発行する設計（上記アーキテクチャ図参照）なので、`/signup/callback`が再度`provision`を呼べば、テナント作成はスキップされ招待トークンだけが再発行される。特別な再試行ロジックは不要。

## 画面

### 1. メールアドレス入力画面

`src/app/(auth)/signup/page.tsx`（新規、クライアントコンポーネント。既存`login/page.tsx`と同じ`(auth)`ルートグループ・同じスタイルトークンを使う）

- 入力項目はメールアドレスのみ。
- 送信後は「メールを送信しました。届いたリンクを開いてください」の完了表示に切り替える（連続送信の抑制はSupabase Auth標準のレート制限に任せ、アプリ側では実装しない＝YAGNI）。
- 既にログイン済みでテナント所属済みのユーザーがアクセスした場合は`/`へリダイレクトする。

### 2. マジックリンク受け口

`src/app/(auth)/signup/callback/page.tsx`（新規、クライアントコンポーネント）

- マウント時に`supabase.auth.getSession()`でセッション確立を確認する。
- セッションがあれば`POST /api/signup/provision`を呼び、`redirectTo`が返ればそこへ、`inviteUrl`が返ればそこへ`window.location.assign`で遷移する。
- セッションが無い（リンク期限切れ・既に使用済み等）場合は、「リンクの有効期限が切れています」等のエラー表示と`/signup`への再送導線を出す。

## テナント名/slug自動生成

メールアドレスのローカルパート（`@`より前）を元に生成する純粋関数を`src/lib/tenant/`配下に新設し、単体テストを書く。

- `name`: ローカルパートをそのまま表示名として使う（例: `taro.yamada@example.com` → `taro.yamada`）。
- `slug`: ローカルパートを英数字・ハイフンのみに正規化した上で、衝突を避けるため`user_id`の先頭数文字をサフィックスに付与する（メールのローカルパートだけでは既存slugと衝突しうるため）。

## エラーハンドリング方針

- マジックリンクが期限切れ/使用済みの場合、`signup/callback`はエラー表示のみに留め、詳細な理由はサーバーログにのみ記録する（既存の`invite-accept`/`liff-auth`と同じ方針）。
- `provision`の部分失敗時の後始末は上記APIエンドポイント節の通り。
- 既にアカウントがある状態（例: developerツールで先に作成済みのメールアドレス）で`/signup`から`signInWithOtp`を呼んだ場合、Supabase Authは通常のログインとして扱いマジックリンクを送る。`provision`は`getActiveTenant`で既存所属を検出するため、二重にテナントが作られることはない（LINE未リンクなら招待トークンが、リンク済みなら`redirectTo: "/"`が返る）。

## テスト方針

- **単体**: テナント名/slug生成ロジック（メールアドレス→name/slug変換）を純粋関数として切り出しvitestでテストする。
- `POST /api/signup/provision`本体は、既存コードベースの慣習（Supabase接続前提のAPIハンドラはテスト対象外）に倣い自動テスト対象としない。
- **手動検証**: `/signup`でメール送信→受信したリンクをクリック→`/signup/callback`経由でテナント作成→QRコード表示→実機のLINEでスキャン→紐付け完了→`/liff/entry`での再ログインまで一気通貫で確認する。

## 環境変数（新規追加）

なし（Supabase Auth標準機能のみを使用する）。

## 追加が必要な依存パッケージ

なし。

## 未確定事項（実装前に確認すること）

- Supabase AuthのMagic Linkメールテンプレート（件名・文面）が現状デフォルトのままか、dx-sensor向けにカスタマイズが必要かは実装時に確認する。

## スコープ外（今回実装しない）

- Premium・会社契約のセルフサインアップ（Stripe決済実装後に別途設計する）
- LPのプラン選択画面自体
- 既存テナントへの参加（招待コード入力等）。今回の`/signup`は常に新規テナント作成のみを行う
- メールアドレス以外のサインアップ手段（LINE単独サインアップ等）
- `tenant_type`導入に伴う`is_premium`列の撤去・関連画面（`/admin/tenants`等）の全面改修

## 実装順序の推奨

1. DBマイグレーション（`tenants.tenant_type`）
2. テナント名/slug生成ロジック（純粋関数・テスト）
3. `POST /api/signup/provision`
4. `/signup`画面
5. `/signup/callback`画面
6. 動作確認（メール送信〜QR表示〜LINEスキャン〜`/liff/entry`再ログインまで一気通貫）
