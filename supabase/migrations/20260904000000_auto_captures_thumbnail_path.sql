-- 20260904000000_auto_captures_thumbnail_path.sql
-- 監視分析(tick)は5秒間隔でauto_capturesのフルサイズ画像をStorageから
-- ダウンロードして差分判定しており、これがSupabase Storageのegressクォータを
-- 圧迫する主因になっていた。差分判定・一覧表示には低解像度サムネイルを使い、
-- フルサイズはGemini解析が必要な時だけ取得する設計に変更するため、
-- サムネイル画像のStorageパスを保持するカラムを追加する。
--
-- 既存行はNULLのままとする（バックフィルは行わない）。アプリ側は
-- thumbnail_path が NULL の場合 storage_path（フルサイズ）にフォールバックする。

alter table auto_captures
  add column if not exists thumbnail_path text;

comment on column auto_captures.thumbnail_path is
  '差分計算・一覧表示用の低解像度サムネイルのStorageパス。NULLの場合はstorage_path（フルサイズ）にフォールバックする。';
