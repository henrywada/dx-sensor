# dx-sensor プロジェクト状況共有プロンプト（新チャット引き継ぎ用）

このプロンプトは、新しいチャットの**最初のメッセージとして貼り付けて**ください。
これまでの設計判断・実装状況・トラブルシューティングの教訓を一括で共有します。

---

## 1. プロジェクトの基本コンセプト

dx-sensorは**「定点観測した画像を時系列で比較し、変化をAIで解析する」汎用プラットフォーム**です。

- 観測対象はケースバイケースで設定可能な設計にする。特定用途にロジックを固定しない
- 駐車場の空き状況チェック × ANPR(ナンバープレート認識)は**最初のユースケースの1つ**であり、専用アプリではない
- 新しい実装を提案する際は「これは駐車場以外の観測対象にも転用できるか」を必ず自問すること

## 2. プロジェクトの位置づけ

- `dx-toolbox`（既存の中小企業向けSaaS）とは**完全に独立したプロジェクト**。コード・Supabaseプロジェクトとも共有しない
- 開発者(Henry)は1人会社。開発ツールはClaude Code（設計等上流工程）とCursor/Antigravity（各部の修正）を使い分けている
- リポジトリ: `github.com/henrywada/dx-sensor`、パス: `~/ai-projects/dx-sensor`（WSL Ubuntu-24.04 on Windows 11）

## 3. 技術スタック・本番環境

- Next.js 14 (App Router) + TypeScript, Supabase(RLS/Storage/Auth/Vault), Tailwind CSS v4
- **本番デプロイ先: Vercel（Hobbyプラン）**、URL: `https://dx-sensor.vercel.app`
- Cloudflareは検討したが不採用（`sharp`パッケージがCloudflare Workers環境と相性が悪いため。dx-toolboxのLP/Blog/DNSは引き続きCloudflareのまま）
- Cron実行頻度の制約（Hobbyプランは1日1回まで）を回避するため、**GitHub Actionsで5分毎に`/api/cron/poll-soracam`を叩く**構成を併用（`.github/workflows/poll-soracam.yml`）。GitHub Secretsに`DEPLOY_URL`と`CRON_SECRET`を登録済み

## 4. アーキテクチャ: センサー取得経路が2系統

### 4-1. soracam系列（クラウドAPI直接方式）
- ATOM Cam 2 / ATOM Cam Swing、SORACOMのSoraCam API経由
- ローカルエージェント不要。Vercel(実質GitHub Actions経由)が直接SORACOM APIを呼ぶ
- 実装: `src/lib/sensors/soracam/soraCamDriver.ts`、Cronルート: `src/app/api/cron/poll-soracam/route.ts`
- **未検証**: 静止画エクスポートAPIの正確なエンドポイントパスは実機未確認（TODOコメントあり）

### 4-2. balenaCloud系列（ローカルエージェント方式）
- Tapo C210(開発) / Reolink RLC・E1系(本番)、標準ONVIF
- テナント拠点にRaspberry Pi(balenaCloud管理)を設置し、LAN内でカメラにアクセス、結果をクラウドへPush
- ONVIFドライバーの実体は**`agent/src/index.ts`にのみ存在**（クラウド側に重複コピーを置いた結果ビルド事故を起こした反省から一本化済み）
- 認証: `agent_api_keys`テーブルで発行したスコープ付きAPIキー
- 受信側: `src/app/api/ingest/vehicle-event/route.ts`
- 設置手順: `docs/agent-provisioning-checklist.md`（「キット内蔵ルーター方式」採用、テナント側作業はLANケーブル1本挿すだけ）
- **実機未検証**（balenaCloudアカウント未作成）

### 4-3. 使い分けの方針
パイロット〜初期展開はsoracam方式（低初期費用）、1テナント2〜3年以上の継続利用が見込める規模になったらbalenaCloud方式へ切替検討（損益分岐点は約27〜37ヶ月の試算）。

## 5. フォルダー構成の規約(`src/lib/`)

- **`src/lib/sensors/`** — センサー読み込み系列。`soracam/`に実装、`balenaCloud/`はREADMEのみ(コード実体は`agent/`)
- **`src/lib/image-analysis/`** — 画像解析処理系列。`plate-recognizer/`(ANPR、実装済み)、`openai-vision/`・`aws-rekognition/`(プレースホルダー)
- **`src/lib/change-detection/frameDiff.ts`** — 特定プロバイダに依存しない差分判定ユーティリティ（`sharp`使用、方式2＝アプリ側フレーム比較のロジック）
- **`src/lib/supabase/`** — `client.ts`, `server.ts`, `secrets.ts`(Vault経由のシークレット解決)
- **`src/lib/agent-keys/`** — エージェント用APIキー生成・ハッシュ化
- **`src/lib/auth/getViewerContext.ts`** — ログイン状態・developer権限判定（`is_app_developer()`関数呼び出し、メールのハードコードなし）

ページは以下のルートグループに配置：`(tenant)`（ログイン必須のTOP画面）、`(admin)`（developer限定の管理画面、`/admin`）、`(auth)`（`/login`）。

## 6. UI実装状況

- **TOP画面**(`/`, ログイン必須): 2カラムグリッドでカテゴリ分けしたアプリカード（現状ほぼ「準備中」プレースホルダー）
- **管理画面**(`/admin`): 左サイドバー(グループ分けナビ) + メインのカードグリッド(2カラム)、developer権限のみアクセス可
- **ヘッダーは`AppHeader`という単一コンポーネントに統合済み**（`variant="tenant"|"admin"`で出し分け。以前2コンポーネントに分かれていて保守リスクがあったため統合）
- デザイントークン: signal(ティール)/alert(アンバー)/paper/ink、フォントはNoto Sans JP + Inter
- フッターにバージョン表示(`vX.Y.Z`)があり、**Cursor側の`/my_vup`スキルとCLAUDE.mdの両方に同じバージョン管理規約を同期済み**（明示的指示がある時だけ更新、デフォルトはパッチ+1）

## 7. データモデル（Supabaseテーブル）

- `tenants`, `tenant_members`(role: owner/admin/viewer/developer)
- `cameras`(vendor, host/port/username/secret_ref[ONVIF用], soracam_device_id/soracam_auth_key_id/soracam_secret_ref[SoraCam用], last_frame_path)
- `parking_lots`, `parking_spots`, `vehicle_events`（駐車場ユースケース固有、将来`observation_targets`等への汎用化リファクタ余地あり）
- `agent_api_keys` — エージェント認証用スコープ付きAPIキー
- 全テーブルRLS有効、`service_role`への明示的GRANTも必須（`0004_grant_service_role.sql`で`alter default privileges`により今後は自動対応）

## 8. シークレット管理

Supabase Vaultで管理。生の値はテーブルに保存せずUUID参照(`*_secret_ref`)のみ保存。
- 登録/ローテーション: `scripts/store-vault-secret.ts`
- 復号取得: `src/lib/supabase/secrets.ts`の`resolveSecret()`
- **`ingest/vehicle-event`側はまだVault連携未統一**（要検討）

## 9. 重要な教訓（同じ事故を繰り返さないために）

- **ZIPで渡したファイルの配置漏れは、しばらく気づかれないことがある**。`0003_soracam_support.sql`マイグレーションが配置されないまま本番デプロイし、`column does not exist`エラーで発覚した事例あり。ファイル追加を伴う変更後は`supabase migration list`でLocal/Remoteの差分を必ず確認する習慣が有効
- クラウド側とローカルエージェント側でコードを重複させると、依存パッケージの混入でビルド事故を起こす（ONVIFドライバーは`agent/`に一本化済み）
- Vercelの新しいAPIキー体系(`sb_publishable_`/`sb_secret_`)は、古い`@supabase/supabase-js`バージョンだと正しく動作しないことがある。バックエンド用は枯れたLegacy JWT形式の`service_role`キーを使う方が安全な場合がある
- Windowsの`:Zone.Identifier`隠しファイルがマイグレーションフォルダに紛れ込み、Supabase CLIの警告ノイズになることがある（実害はないが都度削除推奨）

## 10. 現在完了している作業

- Supabaseプロジェクト・RLS・権限(GRANT)・Vault連携
- balenaCloud方式・soracam方式の設計・スキャフォールドコード実装
- フォルダー構成のsensors/image-analysis系列分離
- TOP画面・管理画面のUI実装（ヘッダー統合、ログイン必須化含む）
- **Vercel本番デプロイ完了・動作確認済み**（ログイン→TOP→管理画面→`/debug`→Cronエンドポイント全て正常）
- GitHub Actionsによる5分毎の自動ポーリング稼働中

## 11. 未完了・次に着手すべきタスク

1. **ATOM Cam 2の実機購入・SORACOMアカウント作成**（現在ここで中断中）
2. SoraCam APIの静止画エクスポートエンドポイントの実機確認
3. `cameras`テーブルへの実データ登録・`poll-soracam`の実行テスト（実機投入後）
4. `ingest/vehicle-event`側にもVault連携を統一するか検討
5. balenaCloudのアカウント作成・フリート作成・実機(Raspberry Pi + Tapo C210)でのテスト
6. 将来的なスキーマ汎用化（`parking_spots`等→`observation_targets`等）

---

このプロンプトを読んだ上で、以降の実装作業は上記の設計判断・規約に従って進めてください。
不明な点や、上記と矛盾する実装を提案しそうな場合は、作業前に確認してください。
