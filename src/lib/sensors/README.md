# センサー読み込み系列 (`src/lib/sensors/`)

dx-sensorの基本コンセプト（定点観測対象はケースバイケースで設定する）に対応するため、
「どうやってセンサー/カメラから生データを取得するか」を**取得経路の種類ごとにフォルダで分離**する。

## 現在の系列

| フォルダ | 方式 | ローカルエージェント要否 | 対応デバイス例 |
|---|---|---|---|
| `soracam/` | クラウドAPI直接方式。dx-sensorのクラウド(Vercel Cron)が直接SORACOM APIを呼ぶ | 不要 | ATOM Cam 2 / ATOM Cam Swing |
| `balenaCloud/` | ローカルエージェント方式。テナント拠点のRaspberry Pi(balenaCloud管理)がLAN内のカメラにONVIFでアクセスし、結果をクラウドへPushする | 必要（`agent/`ディレクトリのコードがbalenaCloud経由で動作） | Tapo C210(開発) / Reolink RLC・E1系(本番) |

`balenaCloud/`配下には**実装コードを置かない**（`balenaCloud/README.md`を参照）。
ONVIFドライバー(`tapoDriver.ts`, `reolinkDriver.ts`)の実体は`agent/src/index.ts`にのみ存在する。
以前はクラウド側にも参照用コピーを置いていたが、`onvif`パッケージがクラウド側の
ビルドに紛れ込んでビルドエラーを起こしたため、**重複を廃止し実装を`agent/`側に一本化**した。

## 新しい系列を追加する場合

1. `src/lib/sensors/<新方式名>/` にフォルダを作成
2. `../types.ts` の `CameraDriver` インターフェースを実装するクラスを作成
3. `factory.ts` の `drivers` マップに登録
4. その方式がクラウドから直接到達可能なら `isCloudReachable()` に条件を追加し、
   `src/app/api/cron/` 配下に専用のCronルートを作る
5. LAN内にしか到達できない方式なら、`agent/` 側にドライバーの複製を置き、
   `docs/agent-provisioning-checklist.md` に設置手順を追記する

## 命名について

`CameraVendor` / `CameraDriver` / `CameraConfig` という型名は、現状カメラ系センサーのみを
扱っているため据え置いている。将来カメラ以外のセンサー（温湿度センサー等）を追加する際は、
`SensorVendor` / `SensorDriver` 等への一般化リネームを検討すること（CLAUDE.mdの
「駐車場以外の観測対象にも転用できるか」という原則に従う）。
