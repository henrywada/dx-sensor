# manual（手動撮影経路）

soracam / balenaCloud に次ぐ第3の取得経路。テナント担当者がスマホ等で定点撮影し、
ブラウザから直接 Supabase Storage にアップロードする方式。

## 現状(最小実装)

- コードの実体はここではなく `src/app/(admin)/admin/capture/` に置かれている
  (ページから直接 Supabase クライアント経由で Storage / テーブルへ書き込むため、
  balenaCloud のようなクラウド側ドライバー実装は不要)
- テーブル: `manual_captures`（マイグレーション `0006_manual_captures.sql`）
- Storage バケット: `manual-captures`（非公開、10MB上限、image/*のみ許可）
- パス規約: `{tenant_id}/{yyyy-mm-dd}/{uuid}.jpg`

## 将来ロジックが増えたらここに集約する候補

- EXIF からの位置情報・撮影日時抽出
- アップロード前のクライアント側リサイズ/圧縮
- 位置合わせガイド(前回撮影画像のオーバーレイ、基準マーカー等)
- `cameras` / `manual_captures` を含む `observation_targets` への統合リファクタ時の変換ロジック

## 汎用プラットフォームとしての位置づけ

駐車場 ANPR に限らず、店舗棚チェック・現場巡回・施工進捗記録など、
「人が定期的に同じ場所で1枚撮る」ケース全般に転用可能な経路として設計している。
