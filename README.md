# dx-sensor

駐車場カメラ × ANPR（自動ナンバー認識）による空き状況・車両検知アプリ。
dx-toolboxとは別プロジェクトとして独立運用（RLS設計パターンのみ再利用）。

## セットアップ手順（Windows 11 / Claude Code想定）

### 1. リポジトリ作成
```bash
# GitHubで新規リポジトリ dx-sensor を作成後
git init
git remote add origin https://github.com/<your-org>/dx-sensor.git
git add .
git commit -m "chore: initial scaffold"
git push -u origin main
```

### 2. Supabase プロジェクト新規作成
dx-toolboxとは別のSupabaseプロジェクトを新規作成してください（同一プロジェクト内に混在させない）。

```bash
supabase login
supabase init
supabase link --project-ref <new-project-ref>
supabase db push   # supabase/migrations/0001_init.sql を適用
```

適用後、Supabase Studio で以下を確認:
- `tenants`, `tenant_members`, `cameras`, `parking_lots`, `parking_spots`, `vehicle_events` が作成されている
- 全テーブルでRLSが有効になっている
- 自分のユーザーを最初の `tenant_members.role = 'developer'` レコードとして手動追加（クロステナントアクセス用）

### 3. 環境変数
```bash
cp .env.example .env.local
```
`.env.local` に Supabase の URL / anon key / service role key、Plate Recognizer の API key を設定。

### 4. 依存関係インストール & ローカル起動
```bash
npm install
npm run dev
```

### 5. カメラ登録（開発: Tapo C110）
1. Tapoアプリで対象カメラの「詳細設定 > カメラアカウント」からONVIF用のユーザー名/パスワードを発行
2. `cameras` テーブルに1行追加（`vendor = 'tapo'`, `host`, `port=2020`, `username`, `secret_ref`）
3. `resolveSecret()` (`src/app/api/cron/poll-cameras/route.ts`) を実際のシークレット管理方式に合わせて実装

### 6. 本番切り替え（Reolink）
1. Reolink機種側でもONVIFを有効化（管理画面 > Network > Advanced > ONVIF）
2. `cameras.vendor` を `'reolink'` に更新するだけでドライバーが自動的に切り替わる（コード変更不要）
3. FTPプッシュ運用に切り替える場合は、Reolink本体の FTP設定でSupabase Storageへの直接アップロードはできないため、中継サーバー（NAS等）を用意し、別途アップロード用エンドポイントを実装する（`docs/camera-ftp-setup.md` に追記予定）

### 7. Vercel デプロイ
```bash
vercel link
vercel env pull .env.local   # Vercel側にも同じ環境変数を設定した上で
vercel --prod
```
`vercel.json` に定義済みの Cron (`/api/cron/poll-cameras`, 5分毎) が自動的に有効化されます。
Vercel の Cron はリクエストヘッダーに `Authorization: Bearer $CRON_SECRET` を付与するため、`CRON_SECRET` を環境変数に設定してください。

## 未実装 / TODO
- [ ] `resolveSecret()`: シークレット管理の実装（Supabase Vault推奨）
- [ ] 駐車枠(`parking_spots.bbox`)とカメラ画像内座標のマッピングUI
- [ ] 空車/駐車中の一次判定ロジック（Vision AI呼び出し、ANPRの前段フィルタとして）
- [ ] ナンバープレートデータの保持期間・削除ポリシー（個人情報保護法対応）
- [ ] 利用目的の掲示・同意取得フローの設計

## 法的な注意
ナンバープレートは個人情報保護法上「個人情報」に該当し得ます。本番運用前に、利用目的の明示、保存期間の設定、アクセス制御（本スキーマではrole-based RLSで対応済み）の各要件を満たしているか確認してください。
