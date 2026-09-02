# LINE友だち招待機能 設計書

- 日付: 2026-09-02
- ステータス: 設計承認済み・実装計画作成前
- 関連設計書: `docs/superpowers/specs/2026-09-02-line-integration-design.md`（LINE連携の基盤機能。本設計書はその上に構築する）

## 背景・目的

既存のLINE連携機能により、「新規に招待されたメンバーがLINE経由でアカウントを自動作成する」フロー（`tenant_member_invites` → `/liff/link` → アカウント自動作成）は実装済みである。

一方で、**既にアカウントを持っているテナントメンバーが、LINE公式アカウントをまだ友だち追加していない場合**に、それを促す手段が無い。本機能は、テナント管理者がそうしたメンバーを指定してメールで招待し、メール内のURLからQRコードを表示 → メンバーがLINEアプリでスキャンして友だち追加 → 自動的に既存アカウントと紐付けが完了する、というフローを追加する。

新規アカウント作成は行わない。既存の`tenant_members`のユーザーに対して`line_friends`を紐付けるだけの機能である。

## 前提・既存実装の確認結果

- `line_friends`テーブルが既に存在する（`line_user_id` unique, `user_id` nullable, `tenant_id` nullable, `status`: `unlinked`/`linked`/`blocked`, `linked_at`）。LINE公式アカウントをフォローすると`follow` Webhookで`unlinked`行が作られ、LIFF経由の本人確認で`user_id`が埋まり`linked`になる。
- `tenant_member_invites`テーブルは「新規メールアドレス宛の招待」専用で、`invite-accept`時に**必ず新規`auth.users`を作成する**設計。既存アカウント保有者向けには使えない（本機能で別テーブルを新設する理由）。
- `/liff/entry`・`/liff/link`ページと`verifyLineIdToken`・`establishSupabaseSession`ユーティリティが既に実装済みで、そのまま再利用できる。
- LIFFのエンドポイントURLは`https://<domain>/liff`配下を包括する設定に既になっている（`/liff/entry`と`/liff/link`の両方をカバーするため）。本機能で`/liff`配下に新しいページを追加しても、LINE Developersコンソール側の追加設定は不要。
- メール送信の仕組みはアプリ側に存在しない。パスワードリセットはSupabase Auth標準機能（`resetPasswordForEmail`）を使っているのみで、任意の本文・宛先を持つ独自メール送信の基盤はゼロから追加する必要がある。
- QRコード生成ライブラリは未導入。

## 採用する方式（ブレインストーミングでの決定事項）

- **対象者**: 既にアカウントを持つテナントメンバーのみ。新規アカウント作成は行わない。既存のLIFF招待フロー（新規アカウント作成）とは完全に別物として新設する。
- **QRコードの中身**: 個人専用のLIFF URL（`https://liff.line.me/<LIFF_ID>?t=<招待トークン>`）を符号化する。LINE公式アカウントの汎用「友だち追加」QRコードは使わない。これにより、スキャン後にLIFFが自動起動し、そのままID token検証で個人を特定できる（誰が追加したか分からなくなる問題を回避できる）。
- **メールサービス**: Resendを新規導入する。

## 全体アーキテクチャ

```
[テナント管理画面] 未フォローのメンバーを選択 → 送信
    │ POST /api/tenant-members/friend-invites
    ▼
line_friend_invites に招待トークンを発行 + Resendでメール送信
    │
    ▼
[メール内URL] https://<domain>/line-friend-invite/<token>  （認証不要・通常ブラウザで開く公開ページ）
    │ トークンの有効性をサーバー側で検証してからQRコード画像を表示
    │ QRコードの中身: https://liff.line.me/<LIFF_ID>?t=<token>
    ▼
[LINEアプリでQRスキャン] → LIFFアプリ起動 → /liff/friend-link?t=<token>
    │ liff.init() → 未フォローならLIFFの「Add friend option」で自動的に友だち追加プロンプト
    │ liff.getIDToken() でID token取得
    ▼
POST /api/line/friend-link-accept
    │ verifyLineIdToken（既存util再利用）でID token検証
    │ line_friend_invites をトークンで照合（期限切れ/使用済みチェック）
    │ line_friends を upsert（status: 'linked', user_id: 招待対象の既存ユーザー）
    │ line_friend_invites.used_at を更新
    ▼
[完了画面] 「連携が完了しました」
```

新規アカウント作成・パスワード発行は一切発生しない。既存の`/liff/entry`（条件付きSkipログイン）は本機能の完了後、通常どおりそのまま機能する。

## データモデル

新テーブル`line_friend_invites`を新設する（既存の`tenant_member_invites`は対象が「新規メールアドレス」である点が本質的に異なるため、テーブルを分離する）。

```sql
-- 20260902xxxxxx_line_friend_invites.sql
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
alter table line_friend_invites enable row level security;
create policy line_friend_invites_admin_only on line_friend_invites
  for all using (is_app_developer() or has_tenant_role(tenant_id, 'admin'))
  with check (is_app_developer() or has_tenant_role(tenant_id, 'admin'));
grant select, insert, update, delete on public.line_friend_invites to authenticated;
```

トークンの検証（QRコード表示ページ・`friend-link-accept`API）は`service_role`（`createServiceSupabase()`）で行う。未ログインの一般公開ページからRLS越しにトークンを引けるようにする必要がないため、`authenticated`向けのRLSポリシーはテナント管理者の発行操作のみをカバーすれば十分。

**「まだ友だちでないメンバー」の判定**は新カラム追加不要で、以下のクエリで完結する（既存スキーマのみで判定可能）:

```sql
select tm.* from tenant_members tm
left join line_friends lf
  on lf.user_id = tm.user_id and lf.status = 'linked'
where tm.tenant_id = :tenantId and lf.id is null
```

## 画面（3画面）

### 1. メール送信画面

`src/app/(tenant)/members/friend-invites/page.tsx`

- テナント管理者（owner/admin、または developer）専用。`getActiveTenant()`で対象テナントを決定し、そのテナントでの自分の役割を確認した上で表示する。
- サーバーコンポーネントで上記LEFT JOINクエリを実行し、「未フォローのテナントメンバー」一覧（氏名/メールアドレス）を取得。メールアドレスは`tenant_members`に無いため、`auth.admin.listUsers()`ベースのマップ作成ヘルパー（既存`src/lib/admin/members.ts`の`listAuthEmailMap`と同様のパターン。ただし本画面向けには対象テナントのメンバーIDに絞り込んだ専用関数を`src/lib/tenant/`配下に新設する）で解決する。
- クライアントコンポーネントでチェックボックスによる複数選択UIを提供。
- 「友だち招待の送信」ボタン→`POST /api/tenant-members/friend-invites`に`{ userIds: string[] }`を送信。
- レスポンスで送信成功/失敗件数を表示する（1件の送信失敗が他の送信をブロックしないpartial-success設計。失敗理由はメンバーごとに表示）。

### 2. QRコード表示画面

`src/app/line-friend-invite/[token]/page.tsx`（認証不要の公開ルート。`(tenant)`/`(admin)`/`(auth)`いずれのルートグループにも属さない独立ルートとする。理由は`/liff/entry`・`/liff/link`と同様、ログイン必須ガードを経由させないため）

- サーバーコンポーネントで`service_role`により`line_friend_invites`をトークンで照合し、存在確認・期限切れ・使用済みチェックを行う。
- 有効な場合: `qrcode`パッケージでサーバー側にSVGを生成し、`https://liff.line.me/<LIFF_ID>?t=<token>`を符号化したQRコード画像を表示する。
- 無効な場合: 「このリンクは無効です／有効期限が切れています」等、理由に応じたメッセージを表示する（既に使用済みの場合と期限切れの場合でメッセージを分ける）。

### 3. LIFF側ページ

`src/app/liff/friend-link/[token]/page.tsx` + `LiffFriendLinkView.tsx`（既存の`LiffLinkView.tsx`と同じ実装パターンを踏襲）

- マウント時にLIFF SDK初期化（`liff.init({ liffId })`）。
- `liff.isLoggedIn()`でなければ`liff.login()`。
- `liff.getIDToken()`でID token取得→`POST /api/line/friend-link-accept`に`{ inviteToken, idToken }`を送信。
- 成功: 「連携が完了しました。今後はLINEのリッチメニューからdx-sensorにアクセスできます」と表示。
- 失敗時、理由コードごとにメッセージを分岐（`token_invalid`/`expired`/`already_used`/`token_mismatch`）。

**LINE Developersコンソール側の追加設定が必要**: QRコードから自動的に「友だち追加」プロンプトを出すには、LIFFアプリの「Add friend option」を`Normal`または`Aggressive`に設定する必要がある。既存の`/liff/entry`・`/liff/link`と本機能の`/liff/friend-link`は同一LIFF ID（同一LIFFアプリ）を共有しているため、この設定は3つの入口すべてに影響する。ただし「Add friend option」は非フォロワーにのみプロンプトを表示する仕様のため、既にフォロー済みのユーザー（`/liff/entry`からの再訪問者が主）には影響しない。実装計画の動作確認手順に、この設定変更と影響範囲の確認を明記する。

## APIエンドポイント

| エンドポイント | 実行方式 | 役割 |
|---|---|---|
| `POST /api/tenant-members/friend-invites` | `createServerSupabase()`（RLSで自分の役割を確認した上で、対象テナントメンバーのメール解決に`service_role`を併用） | 選択された`userId`ごとにトークン発行・`line_friend_invites`へinsert・Resend経由でメール送信 |
| `POST /api/line/friend-link-accept` | `createServiceSupabase()` | ID token検証→招待トークン照合→`line_friends`をupsert（`status: 'linked'`）→`used_at`更新 |

`POST /api/tenant-members/friend-invites`の権限モデルについて: `line_friend_invites`へのINSERTはRLSポリシー（`has_tenant_role(tenant_id, 'admin')`）で保護されるが、対象メンバーのメールアドレス解決には`auth.admin.listUsers()`（`service_role`必須、RLSの外側）を使う必要がある。そのため、このAPI内では先にRLSスコープの`createServerSupabase()`で`tenant_members`から呼び出し元自身の行（`tenant_id`+`user_id`=自分）を取得して役割が`owner`/`admin`/`developer`であることを確認してから、`service_role`によるメール解決・招待作成に進む。この事前チェックを省略しないこと（`service_role`はRLSを迂回するため、コード側のチェックが唯一の防波堤になる）。

## メール送信基盤

- `src/lib/email/sendEmail.ts`を新設し、Resend SDK（`resend`パッケージ）をラップする。
- 環境変数`RESEND_API_KEY`・`EMAIL_FROM`が必要。`EMAIL_FROM`はResend側で送信ドメインの認証（SPF/DKIM設定）が完了しているアドレスを使う必要があり、実装計画のセットアップ手順に明記する。
- メール本文: 定型文（招待した管理者名・テナント名・QRコード表示ページのURL）。HTMLメール1種類のみ用意し、テンプレートエンジンは導入しない（YAGNI）。

## エラーハンドリング方針

- `friend-link-accept`は失敗理由をサーバーログにのみ詳細記録し、クライアントには理由コード（`token_invalid`/`expired`/`already_used`）のみ返す。既存の`invite-accept`/`liff-auth`と同じ方針を踏襲する。
- 招待トークンの有効期限は72時間（既存の`tenant_member_invites`と同じTTL）。使用済みトークンの再利用は`already_used`として拒否する。
- 招待対象メンバーが既に`linked`状態になっていた場合（例: 招待メール送信後、QRを踏む前に別経路で既に紐付け済みだった場合）、`friend-link-accept`はエラーにせず成功として扱う（冪等に倒す。二重招待の競合状態を過度に警戒しない）。
- Resend送信失敗（無効なメールアドレス、レート制限等）は当該メンバーの送信結果を「失敗」として管理画面に返すのみで、他のメンバーへの送信・トークン発行済みレコードには影響させない。

## テスト方針

- **単体**: 招待トークン生成（既存の`generateInviteToken`/`inviteExpiryDate`を再利用）、「未フォローメンバー抽出」クエリのロジック、QRコード生成関数（符号化されるURLが期待通りか）。
- **統合**: `/api/tenant-members/friend-invites`の権限チェック（admin/owner以外からのリクエストが弾かれること）、`/api/line/friend-link-accept`をモックID tokenで疎通確認し、`line_friends`が正しいテナントスコープ・`user_id`で`linked`になることを検証する。
- **E2E**: LIFF実機はLINEアプリ内ブラウザでしか正確に検証できないため、既存方針と同様Playwright自動化は対象外。手動確認手順（Resend送信確認、QRコード表示ページの期限切れ表示確認、実機でのQRスキャン→LIFF起動→紐付け完了確認）を実装計画に明記する。

## 環境変数（新規追加）

```
RESEND_API_KEY=
EMAIL_FROM=
```

## 追加が必要な依存パッケージ

- `resend`（メール送信）
- `qrcode`（QRコード画像生成。サーバーサイドでSVG/PNGを生成する）

## 未確定事項（実装前に確認すること）

- Resendの送信ドメイン認証（SPF/DKIM）の設定作業はLINE連携と同様に本番デプロイ環境側の手動設定が必要。実装計画のセットアップ手順に明記する。
- 招待メールの文面（日本語の定型文言）は実装時に最終確認する。

## スコープ外（今回実装しない）

- 招待の取り消し・再送信時の旧トークン無効化（新しいトークンを発行するだけで、旧トークンは自然期限切れに任せる。既存の`tenant_member_invites`も同様の設計）
- 送信済み招待の一覧・管理画面（送信結果はその場でのレスポンス表示のみ）
- Resend以外のメールサービスへの切り替え対応
- 1ユーザーが複数テナントに属するケースでの重複招待防止（既存のLINE連携機能と同様、1 LINEアカウント=1テナントの1メンバーが前提）

## 実装順序の推奨

1. DBマイグレーション（`line_friend_invites`）
2. Resend導入（`src/lib/email/sendEmail.ts`）
3. 招待発行・メール送信API（`POST /api/tenant-members/friend-invites`）
4. 「未フォローメンバー」抽出ロジック（テナント管理画面から呼び出すlib関数）
5. QRコード生成ロジック（`qrcode`導入）とQRコード表示画面（`/line-friend-invite/[token]`）
6. LIFF側ページ（`/liff/friend-link/[token]`）と紐付けAPI（`POST /api/line/friend-link-accept`）
7. メール送信画面（`(tenant)/members/friend-invites`）のUI実装
8. 動作確認（Resend送信確認、QR表示、実機でのスキャン→紐付け完了確認）

## 実装後の修正履歴（最終レビューで判明）

実装完了後の最終ホールブランチレビューで、以下の設計不備が判明し修正した。

1. **QRコードのLIFF URLが存在しないルートに解決していた**: 当初の設計（本ドキュメント上部の「QRコードの中身」）は`https://liff.line.me/<LIFF_ID>?t=<token>`（クエリのみ、パスセグメント無し）だったが、LINEのLIFF URL解決は「liffIdの後に続くパス＋クエリをそのままエンドポイントURLに転送する」仕様のため、この形式は`https://<domain>/liff?t=<token>`に解決され、`/liff/page.tsx`が存在せず404になる。既存のリッチメニューURI（`https://liff.line.me/{LIFF_ID}`、パス無し）と同じ理由で見落とされていた。修正: QRコードは`https://liff.line.me/<LIFF_ID>/friend-link/<token>`（トークンをパスセグメントとして付与）を符号化するよう変更した。`/liff/friend-link/[token]`という既存のルート構造とはこれで整合する。
2. **友だち紐付けAPIのトークン消費が非アトミックだった**: `line_friend_invites.used_at`の更新が書き込み結果を確認しない実装だったため、同時アクセスでの二重使用（TOCTOU）や、書き込み失敗時にトークンが使い切りにならない問題があった。`.is("used_at", null)`条件付きの原子的な更新に変更し、更新0件を「使用済み」として扱うようにした。
3. **既存のLINEアカウントを別の既存ユーザーに無断で付け替えられるリスクがあった**: `line_friends`のupsertが`line_user_id`の一致だけで`user_id`を無条件に上書きしていたため、既に別アカウントに紐付いているLINEユーザーが「他人宛の招待」のQRをスキャンすると、そのLINEアカウントが黙って別ユーザーに再紐付けされてしまう（アカウント乗っ取りの温床）。upsert前に既存の`line_friends`行を確認し、`user_id`が招待対象と異なる場合は`token_invalid`として拒否するよう修正した。
4. **QRコード表示ページのキャッシュ**: `service_role`でDBを読むだけのServer Componentで動的レンダリングの明示が無く、Next.jsが「使用済み/期限切れ」判定をキャッシュしてしまうリスクがあった。`export const dynamic = "force-dynamic"`を追加した。
5. **メール送信画面がAPI失敗時に何も表示しない**: `POST /api/tenant-members/friend-invites`が非2xxを返した場合、`results`が無いため画面が無反応に見える不具合があった。エラー表示とtry/catchを追加した。
6. **LIFF側ページの`params`型がインストール済みNext.jsのバージョンと不整合**: Next.js 15形式（`Promise<{token}>`）で書かれていたが、実際にインストールされているのはNext.js 14.2.35で`params`は同期オブジェクト。今日は偶然動作するが将来のアップグレードで壊れるため、同期形式に統一した。

### 既知の残課題（今回のスコープ外・要フォローアップ）

- `/members/friend-invites`へのナビゲーションリンクがどこにも無く、URLを直接入力しないと到達できない。どこに配置するか（ヘッダー、ダッシュボード等）は製品判断が必要なため、今回のスコープには含めなかった。
- 招待トークンの原子的な使用済みマーカーが、なりすまし拒否チェックより先に走るため、他人宛の招待を（既に別アカウントに紐付いた）LINEアカウントでスキャンすると、拒否はされるがそのトークン自体は使用済みになり、本来の受信者が使えなくなる（軽微なDoS）。悪用例は限定的だが、気になる場合は招待の再発行で対応可能。
- メールHTML本文の`tenantName`はエスケープしていない（テナント管理者は自テナント宛のメールにしか影響できないため実害は限定的）。
- `friendInviteCandidates.ts`のメールアドレス解決ロジックは`src/lib/admin/members.ts`の`listAuthEmailMap`と類似の実装だが、意図的に別ファイルとして分離した（開発者専用の`src/lib/admin/`とテナント向け機能を疎結合に保つため）。
