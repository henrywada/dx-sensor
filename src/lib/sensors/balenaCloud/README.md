# balenaCloud系列（このディレクトリにコードは置かない）

このフォルダは「センサー読み込み系列」の分類上の位置づけを示すためだけに存在する。

**実際のONVIFドライバー(`tapoDriver.ts`, `reolinkDriver.ts`)の実体は、
リポジトリ直下の `agent/src/index.ts` にのみ存在する。**

## なぜここにコードを置かないのか（重要な経緯）

以前はこのフォルダにもONVIFドライバーのコピーを置いていたが、
`onvif`パッケージが`agent/package.json`にしかインストールされていないにも関わらず、
Next.jsアプリ本体のビルド（`src/`配下を全て型チェックする）がこのコピーも
チェック対象に含めてしまい、ビルドエラーを引き起こした。

より本質的な理由として、**Next.jsアプリ(クラウド側)はテナント拠点のLAN内にある
Tapo/Reolinkカメラへ物理的に到達できない**（だからこそRaspberry Piエージェント
経由の設計にした）。つまりクラウド側のコードがONVIFドライバーを持つこと自体が
設計上の矛盾だった。この反省を踏まえ、**重複を許容せず、実体は`agent/`側に一本化**した。

## 新しいONVIF対応デバイスを追加する場合

`agent/src/index.ts`を直接編集すること。`src/lib/sensors/`側には何も追加しない。

## クラウド側からこの系列のカメラをどう扱うか

`src/lib/sensors/factory.ts`の`getCameraDriver()`は`tapo`/`reolink`に対しては
意図的にエラーを投げる。これらのカメラはクラウド側のCronからは一切呼び出されず、
`/api/ingest/vehicle-event`でエージェントからのPushを受け取るだけ。
