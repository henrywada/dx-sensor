# 監視ゾーン（フォーカスゾーン）機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「基本写真」を1枚登録し、その上でマウスにより「監視ゾーン」（変化を検知したい矩形領域、複数可）を指定できるようにする。監視の画像解析（sharp+SSIM+pixelmatch → Gemini Vision API）は、指定された監視ゾーン部分だけを切り出して比較することで、背景ノイズを除外し検知精度を上げる。

**Architecture:**
「基本写真」は `/capture_auto` で撮影しDBに1枚だけ保持する（新規登録時に旧データは削除）。ゾーン座標は基本写真に対する正規化比率（0〜1）でDBに保存し、絶対ピクセル座標には依存しない（同一カメラ・同一設置前提のため、後続の自動撮影画像にもそのまま適用できる）。監視tick実行時（`runMonitorTick`）は、ゾーンが1件以上あれば前回画像・今回画像それぞれからゾーンを切り出して1枚の合成画像（複数ゾーンは横並び）に変換してから、既存のdiffScore計算とGemini解析に渡す。ゾーンが無ければ従来通り全体画像で解析する。

**Tech Stack:** Next.js (App Router) / TypeScript / Supabase (Postgres + RLS + Storage) / sharp / pixelmatch / ssim.js / Gemini API (`gemini-2.5-flash`) / vitest

**Spec:** 本計画書自体がspec（ユーザーからの直接要求を本文に転記済み）。関連する既存実装:
- `src/app/(tenant)/capture_auto/CaptureAutoForm.tsx`
- `src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx`
- `src/lib/change-detection/frameDiff.ts`
- `src/lib/image-analysis/gemini/gemini.ts`
- `src/lib/monitor/runMonitorTick.ts`
- `src/lib/monitor/monitorSession.ts`
- `src/app/api/monitor/tick/route.ts`

## Global Constraints

- 汎用化方針（プロジェクトCLAUDE.md）: 駐車場固有の語彙をテーブル名・関数名に持ち込まない。`monitor_base_photos` / `monitor_zones` は既存の `monitor_*` 命名パターンを踏襲する。
- 解析ツール表示ラベルは既存の `"sharp+SSIM+pixelmatch → Gemini Vision API (gemini-2.5-flash)"` 形式を変えない（`runMonitorTick.ts` の `DIFF_TOOL_LABEL` / `buildAnalysisToolLabel` を流用）。
- `/capture_auto` 「基本写真を撮る」モーダルの文言は厳守する:
  - メッセージ: `カメラを撮影箇所に固定して撮影してください。前に登録した設定は消えます。`
  - ボタン: `キャンセル` / `送信する`
- `/capture_auto_analyze` の新タブ名は `監視ゾーンの設定`、挿入位置は `監視条件の設定` の直前（タブ順序: 監視ゾーンの設定 → 監視条件の設定 → 監視状況 → アクティブ履歴 → 画像表示）。
- 全テナントスコープの新規テーブルは `tenant_id` で隔離しRLSを有効化する（既存 `auto_captures` / `monitor_sessions` と同じパターン）。
- 新規Storageバケットは作らない。既存 `auto-captures` バケット（RLSは `(storage.foldername(name))[1]::uuid` = tenant_id で判定）をそのまま使い、基本写真は `${tenantId}/base/${uuid}.jpg` に保存する。
- 既存ページコンポーネント（`CaptureAutoForm.tsx` / `MonitorAnalyzeView.tsx`）にはユニットテストが無く、ブラウザAPI依存のクライアントコンポーネントである、という既存コードベースの慣習に従う。新規に追加する**純粋関数**（座標計算・画像合成）のみvitestでTDDする。

---

## Task 1: DBマイグレーション — `monitor_base_photos` / `monitor_zones`

**Files:**
- Create: `supabase/migrations/20260831120000_monitor_base_photos_zones.sql`

**Interfaces:**
- Produces: テーブル `monitor_base_photos(id, tenant_id, user_id, storage_path, created_at)`、テーブル `monitor_zones(id, tenant_id, user_id, base_photo_id, zone_x, zone_y, zone_width, zone_height, created_at)`。後続タスクはこの2テーブル・カラム名をそのまま使う。

- [ ] **Step 1: マイグレーションファイルを作成する**

```sql
-- supabase/migrations/20260831120000_monitor_base_photos_zones.sql
--
-- 「監視ゾーン（フォーカスゾーン）」機能: 基本写真を1枚登録し、その上に
-- 変化検知の対象とする矩形領域（監視ゾーン、複数可）を指定できるようにする。
-- ゾーン座標は基本写真に対する正規化比率(0..1)で保存する（絶対ピクセルに
-- 依存すると、カメラ解像度が変わった場合に対応できないため）。

-- ============================================================
-- 1. monitor_base_photos: 基本写真（ユーザーごとに常に最新の1枚のみ）
-- ============================================================

create table if not exists monitor_base_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,       -- auto-captures バケット内: {tenant_id}/base/{uuid}.jpg
  created_at timestamptz not null default now()
);

comment on table monitor_base_photos is
  '監視ゾーンを指定するための基準となる基本写真。新規登録時にアプリ側が旧データを削除するため、ユーザーごとに常に最新の1件のみが残る想定。';

alter table monitor_base_photos enable row level security;

create policy "monitor_base_photos_select_own"
  on monitor_base_photos for select using (user_id = auth.uid());

create policy "monitor_base_photos_insert_own"
  on monitor_base_photos for insert
  with check (
    user_id = auth.uid()
    and tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "monitor_base_photos_delete_own"
  on monitor_base_photos for delete using (user_id = auth.uid());

create index if not exists monitor_base_photos_user_idx
  on monitor_base_photos (user_id, created_at desc);

grant select, insert, delete on public.monitor_base_photos to authenticated;

-- ============================================================
-- 2. monitor_zones: 基本写真上に指定した監視ゾーン（複数可）
-- ============================================================

create table if not exists monitor_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  base_photo_id uuid not null references monitor_base_photos(id) on delete cascade,
  zone_x numeric not null,       -- 左端 (0..1、基本写真の幅に対する比率)
  zone_y numeric not null,       -- 上端 (0..1、基本写真の高さに対する比率)
  zone_width numeric not null,   -- 幅   (0..1)
  zone_height numeric not null,  -- 高さ (0..1)
  created_at timestamptz not null default now()
);

comment on table monitor_zones is
  '基本写真(monitor_base_photos)上に指定した監視ゾーン。base_photo_idの基本写真が削除されると、on delete cascadeで同時に削除される（「前に登録した設定は消えます」を実現する）。';

alter table monitor_zones enable row level security;

create policy "monitor_zones_select_own"
  on monitor_zones for select using (user_id = auth.uid());

create policy "monitor_zones_insert_own"
  on monitor_zones for insert
  with check (
    user_id = auth.uid()
    and tenant_id in (
      select tenant_id from tenant_members where user_id = auth.uid()
    )
  );

create policy "monitor_zones_delete_own"
  on monitor_zones for delete using (user_id = auth.uid());

create index if not exists monitor_zones_base_photo_idx
  on monitor_zones (base_photo_id);

grant select, insert, delete on public.monitor_zones to authenticated;
```

- [ ] **Step 2: ローカルでマイグレーションを適用して確認する**

Run: `supabase db reset` （ローカルSupabaseが起動していない場合は `supabase start` を先に実行）
Expected: エラー無く完了し、`supabase db diff` で差分が無いこと。

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260831120000_monitor_base_photos_zones.sql
git commit -m "feat: 監視ゾーン用のmonitor_base_photos/monitor_zonesテーブルを追加"
```

---

## Task 2: ゾーン画像切り出し合成ロジック（`zoneCrop.ts`）

**Files:**
- Create: `src/lib/change-detection/zoneCrop.ts`
- Test: `src/lib/change-detection/zoneCrop.test.ts`

**Interfaces:**
- Consumes: なし（sharpのみ）
- Produces: `export type NormalizedZoneRect = { x: number; y: number; width: number; height: number }`、`export async function buildZoneComposite(imageBuffer: Buffer, zones: NormalizedZoneRect[]): Promise<Buffer>`。Task 4（`runMonitorTick.ts`）がこの関数とその型をそのまま使う。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/change-detection/zoneCrop.test.ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildZoneComposite, type NormalizedZoneRect } from "./zoneCrop";

const WIDTH = 200;
const HEIGHT = 100;
const RED: [number, number, number] = [220, 30, 30];
const BLUE: [number, number, number] = [30, 30, 220];
const BACKGROUND: [number, number, number] = [10, 10, 10];

async function makeSplitImage(): Promise<Buffer> {
  // 左半分(0..100px)を赤、右半分(100..200px)を青にする。
  const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      const color = x < WIDTH / 2 ? RED : BLUE;
      raw[i] = color[0];
      raw[i + 1] = color[1];
      raw[i + 2] = color[2];
    }
  }
  return sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png()
    .toBuffer();
}

async function samplePixel(buffer: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const i = (y * info.width + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("buildZoneComposite", () => {
  it("ゾーンが無ければ元画像をそのまま返す", async () => {
    const image = await makeSplitImage();
    const result = await buildZoneComposite(image, []);
    expect(result).toBe(image);
  });

  it("単一ゾーンをその範囲だけ切り出す", async () => {
    const image = await makeSplitImage();
    const zones: NormalizedZoneRect[] = [{ x: 0, y: 0, width: 0.5, height: 1 }];

    const result = await buildZoneComposite(image, zones);
    const [r, g, b] = await samplePixel(result, 10, 10);

    expect([r, g, b]).toEqual(RED);
  });

  it("複数ゾーンを横並びの1枚に合成する（左に1つ目、右寄りに2つ目の色が現れる）", async () => {
    const image = await makeSplitImage();
    const zones: NormalizedZoneRect[] = [
      { x: 0, y: 0, width: 0.5, height: 1 }, // 赤ゾーン
      { x: 0.5, y: 0, width: 0.5, height: 1 }, // 青ゾーン
    ];

    const result = await buildZoneComposite(image, zones);
    const leftPixel = await samplePixel(result, 5, 5);
    const rightPixel = await samplePixel(result, 195, 5);

    expect(leftPixel).toEqual(RED);
    expect(rightPixel).toEqual(BLUE);
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npx vitest run src/lib/change-detection/zoneCrop.test.ts`
Expected: FAIL（`zoneCrop.ts` が存在しないため import エラー）

- [ ] **Step 3: 実装する**

```typescript
// src/lib/change-detection/zoneCrop.ts
import sharp from "sharp";

/** 監視ゾーンの矩形。すべて基本写真の幅・高さに対する正規化比率(0..1)。 */
export type NormalizedZoneRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const GAP_PX = 4;
const BACKGROUND_RGB = { r: 0, g: 0, b: 0 };

type PixelRect = { left: number; top: number; width: number; height: number };

function toPixelRect(
  zone: NormalizedZoneRect,
  imageWidth: number,
  imageHeight: number
): PixelRect {
  const left = Math.min(imageWidth - 1, Math.max(0, Math.round(zone.x * imageWidth)));
  const top = Math.min(imageHeight - 1, Math.max(0, Math.round(zone.y * imageHeight)));
  const width = Math.max(1, Math.min(imageWidth - left, Math.round(zone.width * imageWidth)));
  const height = Math.max(1, Math.min(imageHeight - top, Math.round(zone.height * imageHeight)));
  return { left, top, width, height };
}

/**
 * 監視ゾーン（正規化座標）で画像を切り出す。複数ゾーンは横一列に並べて
 * 1枚の画像へ合成する（既存のdiffScore計算・Gemini解析は「1枚の画像」を
 * 前提にしたシグネチャのままにしたいため）。ゾーンが無指定なら元画像を
 * そのまま返す（従来通り全体画像で解析する）。
 */
export async function buildZoneComposite(
  imageBuffer: Buffer,
  zones: NormalizedZoneRect[]
): Promise<Buffer> {
  if (zones.length === 0) return imageBuffer;

  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (!imageWidth || !imageHeight) return imageBuffer;

  const crops = await Promise.all(
    zones.map(async (zone) => {
      const pixelRect = toPixelRect(zone, imageWidth, imageHeight);
      const buffer = await sharp(imageBuffer).extract(pixelRect).toBuffer();
      return { buffer, width: pixelRect.width, height: pixelRect.height };
    })
  );

  const canvasWidth =
    crops.reduce((sum, crop) => sum + crop.width, 0) + GAP_PX * (crops.length - 1);
  const canvasHeight = Math.max(...crops.map((crop) => crop.height));

  let left = 0;
  const composites = crops.map((crop) => {
    const placed = { input: crop.buffer, left, top: 0 };
    left += crop.width + GAP_PX;
    return placed;
  });

  return sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: BACKGROUND_RGB,
    },
  })
    .composite(composites)
    .jpeg()
    .toBuffer();
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npx vitest run src/lib/change-detection/zoneCrop.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/lib/change-detection/zoneCrop.ts src/lib/change-detection/zoneCrop.test.ts
git commit -m "feat: 監視ゾーンの切り出し・合成ロジック(buildZoneComposite)を追加"
```

---

## Task 3: ゾーン描画の純粋関数（`monitorZones.ts`）

**Files:**
- Create: `src/lib/monitor/monitorZones.ts`
- Test: `src/lib/monitor/monitorZones.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `ZoneRect`, `ZoneDragPoint`, `clampUnit`, `rectFromDrag`, `isZoneLargeEnough`, `pointFromClientOffset`。Task 6（`ZoneEditor.tsx`）がこれらをマウスドラッグ→矩形変換に使う。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/monitor/monitorZones.test.ts
import { describe, expect, it } from "vitest";
import {
  clampUnit,
  isZoneLargeEnough,
  pointFromClientOffset,
  rectFromDrag,
} from "./monitorZones";

describe("clampUnit", () => {
  it("0..1の範囲にクランプする", () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(1.5)).toBe(1);
    expect(clampUnit(0.3)).toBe(0.3);
  });
});

describe("rectFromDrag", () => {
  it("開始点→終了点の順にドラッグしたときの矩形を返す", () => {
    const rect = rectFromDrag({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 });
    expect(rect).toEqual({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 });
  });

  it("逆方向（右下から左上）にドラッグしても正しい矩形になる", () => {
    const rect = rectFromDrag({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 });
    expect(rect).toEqual({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 });
  });

  it("画像の外に出たドラッグはクランプする", () => {
    const rect = rectFromDrag({ x: -0.2, y: 0.9 }, { x: 0.3, y: 1.5 });
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0.9);
    expect(rect.width).toBeCloseTo(0.3);
    expect(rect.height).toBeCloseTo(0.1);
  });
});

describe("isZoneLargeEnough", () => {
  it("最小サイズ未満のクリックだけのゾーンは無効", () => {
    expect(isZoneLargeEnough({ x: 0, y: 0, width: 0.001, height: 0.001 })).toBe(false);
  });

  it("最小サイズ以上なら有効", () => {
    expect(isZoneLargeEnough({ x: 0, y: 0, width: 0.1, height: 0.1 })).toBe(true);
  });
});

describe("pointFromClientOffset", () => {
  it("コンテナ矩形に対する相対座標(0..1)を返す", () => {
    const point = pointFromClientOffset(150, 80, {
      left: 100,
      top: 50,
      width: 200,
      height: 100,
    });
    expect(point).toEqual({ x: 0.25, y: 0.3 });
  });

  it("コンテナ幅・高さが0のときは(0,0)を返す（ゼロ除算回避）", () => {
    const point = pointFromClientOffset(150, 80, {
      left: 100,
      top: 50,
      width: 0,
      height: 0,
    });
    expect(point).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npx vitest run src/lib/monitor/monitorZones.test.ts`
Expected: FAIL（`monitorZones.ts` が存在しない）

- [ ] **Step 3: 実装する**

```typescript
// src/lib/monitor/monitorZones.ts

/** 監視ゾーンの矩形。すべて基本写真の幅・高さに対する正規化比率(0..1)。 */
export type ZoneRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** マウスドラッグ中の1点（正規化座標、クランプ前）。 */
export type ZoneDragPoint = {
  x: number;
  y: number;
};

/** これ未満の幅・高さのドラッグは「誤クリック」とみなしゾーンとして採用しない。 */
export const MIN_ZONE_SIZE = 0.02;

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** ドラッグの開始点・終了点（どちらが左上/右下でも良い）から矩形を組み立てる。 */
export function rectFromDrag(start: ZoneDragPoint, end: ZoneDragPoint): ZoneRect {
  const x0 = clampUnit(Math.min(start.x, end.x));
  const y0 = clampUnit(Math.min(start.y, end.y));
  const x1 = clampUnit(Math.max(start.x, end.x));
  const y1 = clampUnit(Math.max(start.y, end.y));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function isZoneLargeEnough(rect: ZoneRect): boolean {
  return rect.width >= MIN_ZONE_SIZE && rect.height >= MIN_ZONE_SIZE;
}

/** クライアント座標(getBoundingClientRect基準)を、コンテナに対する正規化座標(0..1)に変換する。 */
export function pointFromClientOffset(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number; width: number; height: number }
): ZoneDragPoint {
  if (containerRect.width <= 0 || containerRect.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: (clientX - containerRect.left) / containerRect.width,
    y: (clientY - containerRect.top) / containerRect.height,
  };
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npx vitest run src/lib/monitor/monitorZones.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitor/monitorZones.ts src/lib/monitor/monitorZones.test.ts
git commit -m "feat: 監視ゾーンのドラッグ座標計算ロジックを追加"
```

---

## Task 4: `runMonitorTick` にゾーン切り出しを組み込む

**Files:**
- Modify: `src/lib/monitor/runMonitorTick.ts`
- Modify: `src/lib/monitor/runMonitorTick.test.ts`
- Modify: `src/app/api/monitor/tick/route.ts`

**Interfaces:**
- Consumes: Task 2の `NormalizedZoneRect` / `buildZoneComposite`（`@/lib/change-detection/zoneCrop`）
- Produces: `RunMonitorTickDeps.getZones: () => Promise<NormalizedZoneRect[]>`（必須）、`RunMonitorTickDeps.cropToZones?: (buffer: Buffer, zones: NormalizedZoneRect[]) => Promise<Buffer>`（省略時 `buildZoneComposite` を使う）。API Route側はこの2つのdepsを実装する。

- [ ] **Step 1: 既存テストの `createDeps` に `getZones` を追加し、失敗させる**

`src/lib/monitor/runMonitorTick.test.ts` の `createDeps` 関数を以下のように変更する（`getZones` を追加するだけで、他のフィールドは変更しない）:

```typescript
function createDeps(overrides: Partial<RunMonitorTickDeps> = {}): RunMonitorTickDeps {
  return {
    getNextUnprocessedCapture: vi.fn(async () => null),
    getCaptureById: vi.fn(async () => null),
    getCaptureOrdinal: vi.fn(async () => 1),
    markCaptureProcessed: vi.fn(async () => undefined),
    downloadCapture: vi.fn(async () => ({
      buffer: Buffer.from("image"),
      mimeType: "image/jpeg",
    })),
    createSignedUrl: vi.fn(async (storagePath: string) => `signed:${storagePath}`),
    diffScore: vi.fn(async () => 0),
    getZones: vi.fn(async () => []),
    analyzeImages: vi.fn(async () => ({
      text: "変化があります",
      raw: {},
      model: "gemini-2.5-flash",
    })),
    insertChangeEvent: vi.fn(async () => "event-id"),
    logAnalysisRun: vi.fn(async () => undefined),
    deleteCaptureIfUnreferenced: vi.fn(async () => false),
    ...overrides,
  };
}
```

そして `describe("runMonitorTick", ...)` ブロックの末尾（最後の `});` の直前）に、ゾーンありのケースを追加する:

```typescript
  it("監視ゾーンが設定されていれば、切り出した画像でdiffScoreとanalyzeImagesを呼ぶ", async () => {
    const zones = [{ x: 0, y: 0, width: 0.5, height: 0.5 }];
    const croppedPrev = Buffer.from("cropped-prev");
    const croppedCurr = Buffer.from("cropped-curr");
    const cropToZones = vi.fn(async (buffer: Buffer) =>
      buffer.toString() === "prev-image" ? croppedPrev : croppedCurr
    );

    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
      getCaptureById: vi.fn(async () => ({
        id: "prev-capture",
        storagePath: "tenant/day/prev.jpg",
      })),
      downloadCapture: vi.fn(async (storagePath: string) => ({
        buffer: Buffer.from(storagePath.includes("prev") ? "prev-image" : "curr-image"),
        mimeType: "image/jpeg",
      })),
      getZones: vi.fn(async () => zones),
      cropToZones,
      diffScore: vi.fn(async () => 0.08),
    });

    await runMonitorTick(REQUEST, deps);

    expect(cropToZones).toHaveBeenCalledWith(Buffer.from("prev-image"), zones);
    expect(cropToZones).toHaveBeenCalledWith(Buffer.from("curr-image"), zones);
    expect(deps.diffScore).toHaveBeenCalledWith(croppedPrev, croppedCurr);
    expect(deps.analyzeImages).toHaveBeenCalledWith(
      expect.objectContaining({
        previousImageBuffer: croppedPrev,
        imageBuffer: croppedCurr,
      })
    );
  });

  it("監視ゾーンが無ければ元の画像でdiffScoreとanalyzeImagesを呼ぶ", async () => {
    const cropToZones = vi.fn();
    const deps = createDeps({
      getNextUnprocessedCapture: vi.fn(async () => ({
        id: "curr-capture",
        storagePath: "tenant/day/curr.jpg",
      })),
      getCaptureById: vi.fn(async () => ({
        id: "prev-capture",
        storagePath: "tenant/day/prev.jpg",
      })),
      getZones: vi.fn(async () => []),
      cropToZones,
      diffScore: vi.fn(async () => 0.08),
    });

    await runMonitorTick(REQUEST, deps);

    expect(cropToZones).not.toHaveBeenCalled();
    expect(deps.diffScore).toHaveBeenCalledWith(
      Buffer.from("image"),
      Buffer.from("image")
    );
  });
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npx vitest run src/lib/monitor/runMonitorTick.test.ts`
Expected: FAIL（`getZones` が `RunMonitorTickDeps` に存在しない型エラー、および新規2テストが未実装ロジックで失敗）

- [ ] **Step 3: `runMonitorTick.ts` にゾーン切り出しを実装する**

`src/lib/monitor/runMonitorTick.ts` の先頭のimportに以下を追加する:

```typescript
import { buildZoneComposite, type NormalizedZoneRect } from "@/lib/change-detection/zoneCrop";
```

`RunMonitorTickDeps` 型（82-95行目）に以下の2フィールドを追加する:

```typescript
export type RunMonitorTickDeps = {
  getNextUnprocessedCapture: (excludeId: string | null) => Promise<MonitorCapture | null>;
  getCaptureById: (id: string) => Promise<MonitorCapture | null>;
  getCaptureOrdinal: (id: string) => Promise<number | null>;
  markCaptureProcessed: (id: string) => Promise<void>;
  downloadCapture: (storagePath: string) => Promise<DownloadedCapture>;
  createSignedUrl: (storagePath: string) => Promise<string | null>;
  diffScore?: (prev: Buffer, curr: Buffer) => Promise<number>;
  /** 現在有効な監視ゾーン一覧（無ければ空配列）。 */
  getZones: () => Promise<NormalizedZoneRect[]>;
  /** ゾーンで画像を切り出す処理（省略時は buildZoneComposite を使う）。 */
  cropToZones?: (buffer: Buffer, zones: NormalizedZoneRect[]) => Promise<Buffer>;
  analyzeImages: (input: AnalyzeMonitorImagesInput) => Promise<VisionAnalyzeResult>;
  insertChangeEvent: (input: InsertMonitorChangeEventInput) => Promise<string>;
  logAnalysisRun: (input: LogAnalysisRunInput) => Promise<void>;
  deleteCaptureIfUnreferenced: (captureId: string) => Promise<boolean>;
};
```

`runMonitorTick` 関数本体で、`prevFile`/`currFile` のダウンロード直後（147-158行目付近、`diffScore` を呼ぶ前）に以下を挿入する:

```typescript
  const [prevFile, currFile, prevSignedUrl, prevCaptureNo] = await Promise.all([
    deps.downloadCapture(prevCapture.storagePath),
    deps.downloadCapture(currCapture.storagePath),
    deps.createSignedUrl(prevCapture.storagePath),
    deps.getCaptureOrdinal(prevCapture.id),
  ]);

  // 監視ゾーンが指定されていれば、以降の差分計算・AI解析はゾーン部分だけを
  // 切り出した画像で行う（背景ノイズを除外し検知精度を上げるため）。
  // ゾーンが無い場合は従来通り全体画像で解析する。
  const zones = await deps.getZones();
  const cropToZones = deps.cropToZones ?? buildZoneComposite;
  const prevForAnalysis =
    zones.length > 0 ? await cropToZones(prevFile.buffer, zones) : prevFile.buffer;
  const currForAnalysis =
    zones.length > 0 ? await cropToZones(currFile.buffer, zones) : currFile.buffer;

  const diffScore = await (deps.diffScore ?? frameDiffScore)(
    prevForAnalysis,
    currForAnalysis
  );
```

`buildZoneComposite`（および既定のcropToZones）は常にJPEGへ再エンコードして返すため、ゾーン切り出しを行った場合はGeminiに渡す`mimeType`も`"image/jpeg"`に揃える必要がある（切り出し無しの場合は元のmimeTypeのまま）。そこで、Gemini解析を呼ぶ箇所（190-201行目付近）を以下のように変更する:

```typescript
  const prompt = buildMonitorPrompt({
    title: request.title,
    labels: request.labels,
    values: request.slotValues,
  });
  // buildZoneComposite(既定のcropToZones)は常にJPEGへ再エンコードするため、
  // ゾーン切り出しを行った場合はmimeTypeも"image/jpeg"に揃える
  // （切り出し無しの場合は元画像のmimeTypeのまま）。
  const prevMimeTypeForAnalysis = zones.length > 0 ? "image/jpeg" : prevFile.mimeType;
  const currMimeTypeForAnalysis = zones.length > 0 ? "image/jpeg" : currFile.mimeType;
  const analysis = await deps.analyzeImages({
    prompt,
    previousImageBuffer: prevForAnalysis,
    previousMimeType: prevMimeTypeForAnalysis,
    imageBuffer: currForAnalysis,
    mimeType: currMimeTypeForAnalysis,
  });
```

（`toDataUri(prevFile)` など、切り出し前の `prevFile`/`currFile` を使う既存の表示用ロジックはそのまま変更しない — ゾーン切り出しは解析専用で、比較表示用の画像は常に全体画像のまま。）

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npx vitest run src/lib/monitor/runMonitorTick.test.ts`
Expected: PASS（既存9件 + 新規2件 = 11 tests）

- [ ] **Step 5: `/api/monitor/tick` に `getZones` depを実装する**

`src/app/api/monitor/tick/route.ts` の `deps` オブジェクト（`markCaptureProcessed` の後、`downloadCapture` の前などお好みの位置）に以下を追加する:

```typescript
    async getZones() {
      const { data, error } = await supabase
        .from("monitor_zones")
        .select("zone_x, zone_y, zone_width, zone_height")
        .eq("tenant_id", tenant.tenantId)
        .eq("user_id", viewer.userId);

      if (error) throw new MonitorTickError(error.message, 500);
      return (data ?? []).map((row) => ({
        x: row.zone_x as number,
        y: row.zone_y as number,
        width: row.zone_width as number,
        height: row.zone_height as number,
      }));
    },
```

`cropToZones` はdepsに指定しない（`runMonitorTick.ts` 側のデフォルト `buildZoneComposite` をそのまま使う）。

- [ ] **Step 6: 型チェックを実行する**

Run: `npx tsc --noEmit --pretty false`
Expected: エラー無し

- [ ] **Step 7: Commit**

```bash
git add src/lib/monitor/runMonitorTick.ts src/lib/monitor/runMonitorTick.test.ts src/app/api/monitor/tick/route.ts
git commit -m "feat: 監視tickで監視ゾーンを切り出してから差分計算・Gemini解析する"
```

---

## Task 5: `/capture_auto` — 「基本写真を撮る」ボタン・モーダル

**Files:**
- Create: `src/app/(tenant)/capture_auto/BaseCapturePhotoModal.tsx`
- Modify: `src/app/(tenant)/capture_auto/CaptureAutoForm.tsx`

**Interfaces:**
- Consumes: `captureFrameFromVideo`（既存, `@/lib/capture/captureFrameFromVideo`）、Supabaseクライアント（既存 `supabase` インスタンス、`monitor_base_photos` テーブル、`auto-captures` バケット）
- Produces: なし（末端のUI機能）

- [ ] **Step 1: モーダルコンポーネントを作成する**

```tsx
// src/app/(tenant)/capture_auto/BaseCapturePhotoModal.tsx
"use client";

import { Camera, X } from "lucide-react";

interface BaseCapturePhotoModalProps {
  open: boolean;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function BaseCapturePhotoModal({
  open,
  submitting,
  error,
  onCancel,
  onConfirm,
}: BaseCapturePhotoModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="base-capture-modal-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2
            id="base-capture-modal-title"
            className="flex items-center gap-2 text-base font-semibold text-ink"
          >
            <Camera className="h-4 w-4 text-signal" strokeWidth={1.75} />
            基本写真を撮る
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-ink-soft transition hover:bg-line hover:text-ink"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-4">
          <p className="text-sm leading-relaxed text-ink">
            カメラを撮影箇所に固定して撮影してください。前に登録した設定は消えます。
          </p>

          {error && (
            <p className="mt-3 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
              {error}
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "送信中..." : "送信する"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `CaptureAutoForm.tsx` にstateとハンドラを追加する**

`import { CaptureHintModal } from "./CaptureHintModal";` の直後に以下を追加する:

```typescript
import { BaseCapturePhotoModal } from "./BaseCapturePhotoModal";
```

`const [hintOpen, setHintOpen] = useState(false);` の直後に以下を追加する:

```typescript
  const [baseCaptureModalOpen, setBaseCaptureModalOpen] = useState(false);
  const [baseCaptureSubmitting, setBaseCaptureSubmitting] = useState(false);
  const [baseCaptureError, setBaseCaptureError] = useState<string | null>(null);
```

`captureAndUpload` 関数の直後（`}, [supabase, tenantId, userId, mountOrientation, invertRotation]);` の後）に、新しいハンドラを追加する:

```typescript
  const handleConfirmBaseCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraReadyRef.current) {
      setBaseCaptureError("カメラの準備ができていません。少し待ってから再度お試しください。");
      return;
    }

    setBaseCaptureSubmitting(true);
    setBaseCaptureError(null);

    try {
      const canvas = captureFrameFromVideo(video, mountOrientation, invertRotation);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("画像の生成に失敗しました"));
          },
          "image/jpeg",
          0.92
        );
      });

      // 前に登録した基本写真（と、それにひも付く監視ゾーン）を削除する。
      // monitor_zones は base_photo_id に on delete cascade を張っているため、
      // ここで基本写真の行を消せば監視ゾーンも自動的に消える。
      const { data: existingRows, error: selectError } = await supabase
        .from("monitor_base_photos")
        .select("id, storage_path")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);
      if (selectError) throw selectError;

      if (existingRows && existingRows.length > 0) {
        const paths = existingRows
          .map((row) => row.storage_path as string)
          .filter((p) => Boolean(p));
        if (paths.length > 0) {
          const { error: removeError } = await supabase.storage
            .from("auto-captures")
            .remove(paths);
          if (removeError) throw removeError;
        }
        const { error: deleteError } = await supabase
          .from("monitor_base_photos")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("user_id", userId);
        if (deleteError) throw deleteError;
      }

      const path = `${tenantId}/base/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("auto-captures")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("monitor_base_photos").insert({
        tenant_id: tenantId,
        user_id: userId,
        storage_path: path,
      });
      if (insertError) throw insertError;

      setBaseCaptureModalOpen(false);
    } catch (err) {
      console.error("base photo capture failed", err);
      setBaseCaptureError(
        err instanceof Error ? err.message : "基本写真の登録に失敗しました"
      );
    } finally {
      setBaseCaptureSubmitting(false);
    }
  }, [supabase, tenantId, userId, mountOrientation, invertRotation]);
```

- [ ] **Step 3: ボタンとモーダルをJSXに追加する**

ヘッダー行内、ヒントボタンと「←戻る」リンクの間（334-349行目）を以下のように変更する:

```tsx
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setHintOpen(true)}
            className="flex items-center gap-1 text-sm font-medium text-signal transition-colors hover:text-ink"
          >
            <HelpCircle className="h-4 w-4" strokeWidth={1.75} />
            ヒント
          </button>
          <button
            type="button"
            onClick={() => {
              setBaseCaptureError(null);
              setBaseCaptureModalOpen(true);
            }}
            className="flex items-center gap-1 text-sm font-medium text-signal transition-colors hover:text-ink"
          >
            基本写真を撮る
          </button>
          <Link
            href="/"
            className="text-sm font-medium text-signal transition-colors hover:text-ink"
          >
            ←戻る
          </Link>
        </div>
```

`<CaptureHintModal open={hintOpen} onClose={() => setHintOpen(false)} />` の直後に以下を追加する:

```tsx
      <BaseCapturePhotoModal
        open={baseCaptureModalOpen}
        submitting={baseCaptureSubmitting}
        error={baseCaptureError}
        onCancel={() => setBaseCaptureModalOpen(false)}
        onConfirm={() => void handleConfirmBaseCapture()}
      />
```

- [ ] **Step 4: 型チェックを実行する**

Run: `npx tsc --noEmit --pretty false`
Expected: エラー無し

- [ ] **Step 5: ブラウザで動作確認する**

Run: `npm run dev` を起動し、`/capture_auto` を開く。「基本写真を撮る」→モーダル表示→「送信する」でアップロードされ、Supabaseダッシュボードで `monitor_base_photos` に1行、`auto-captures` バケットの `{tenantId}/base/` 配下に画像が保存されることを確認する。再度「基本写真を撮る」→「送信する」で、旧行・旧画像が削除され新しい1行に置き換わることを確認する。

- [ ] **Step 6: Commit**

```bash
git add "src/app/(tenant)/capture_auto/BaseCapturePhotoModal.tsx" "src/app/(tenant)/capture_auto/CaptureAutoForm.tsx"
git commit -m "feat: /capture_autoに基本写真を撮るボタン・モーダルを追加"
```

---

## Task 6: `/capture_auto_analyze` — 「監視ゾーンの設定」タブ

**Files:**
- Create: `src/app/(tenant)/capture_auto_analyze/ZoneEditor.tsx`
- Modify: `src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx`

**Interfaces:**
- Consumes: Task 3の `rectFromDrag` / `isZoneLargeEnough` / `pointFromClientOffset`（`@/lib/monitor/monitorZones`）、Supabaseクライアント（`monitor_base_photos` / `monitor_zones` テーブル、`auto-captures` バケット）
- Produces: なし（末端のUI機能）

- [ ] **Step 1: `ZoneEditor.tsx` を作成する**

```tsx
// src/app/(tenant)/capture_auto_analyze/ZoneEditor.tsx
"use client";

import { X } from "lucide-react";
import type { PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  isZoneLargeEnough,
  pointFromClientOffset,
  rectFromDrag,
  type ZoneDragPoint,
  type ZoneRect,
} from "@/lib/monitor/monitorZones";

type ZoneEditorProps = {
  tenantId: string;
  userId: string;
};

type EditableZone = ZoneRect & { localId: string };

type BasePhoto = {
  id: string;
  signedUrl: string | null;
};

export function ZoneEditor({ tenantId, userId }: ZoneEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [basePhoto, setBasePhoto] = useState<BasePhoto | null>(null);
  const [zones, setZones] = useState<EditableZone[]>([]);
  const [draft, setDraft] = useState<{ start: ZoneDragPoint; current: ZoneDragPoint } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: photoRow, error: photoError } = await supabase
          .from("monitor_base_photos")
          .select("id, storage_path")
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (photoError) throw photoError;
        if (cancelled) return;

        if (!photoRow) {
          setBasePhoto(null);
          setZones([]);
          return;
        }

        const [{ data: signed }, { data: zoneRows, error: zonesError }] = await Promise.all([
          supabase.storage.from("auto-captures").createSignedUrl(photoRow.storage_path, 3600),
          supabase
            .from("monitor_zones")
            .select("zone_x, zone_y, zone_width, zone_height")
            .eq("base_photo_id", photoRow.id),
        ]);
        if (zonesError) throw zonesError;
        if (cancelled) return;

        setBasePhoto({ id: photoRow.id, signedUrl: signed?.signedUrl ?? null });
        setZones(
          (zoneRows ?? []).map((row) => ({
            localId: crypto.randomUUID(),
            x: row.zone_x as number,
            y: row.zone_y as number,
            width: row.zone_width as number,
            height: row.zone_height as number,
          }))
        );
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "基本写真の読み込みに失敗しました");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, tenantId, userId]);

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = pointFromClientOffset(e.clientX, e.clientY, rect);
    setDraft({ start: point, current: point });
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!draft) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = pointFromClientOffset(e.clientX, e.clientY, rect);
      setDraft({ start: draft.start, current: point });
    },
    [draft]
  );

  const handlePointerUp = useCallback(() => {
    if (!draft) return;
    const rect = rectFromDrag(draft.start, draft.current);
    if (isZoneLargeEnough(rect)) {
      setZones((prev) => [...prev, { localId: crypto.randomUUID(), ...rect }]);
    }
    setDraft(null);
  }, [draft]);

  const handleRemoveZone = useCallback((localId: string) => {
    setZones((prev) => prev.filter((zone) => zone.localId !== localId));
  }, []);

  const handleSave = useCallback(async () => {
    if (!basePhoto) return;
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const { error: deleteError } = await supabase
        .from("monitor_zones")
        .delete()
        .eq("base_photo_id", basePhoto.id);
      if (deleteError) throw deleteError;

      if (zones.length > 0) {
        const { error: insertError } = await supabase.from("monitor_zones").insert(
          zones.map((zone) => ({
            tenant_id: tenantId,
            user_id: userId,
            base_photo_id: basePhoto.id,
            zone_x: zone.x,
            zone_y: zone.y,
            zone_width: zone.width,
            zone_height: zone.height,
          }))
        );
        if (insertError) throw insertError;
      }

      setSaveMessage("監視ゾーンを保存しました");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [supabase, tenantId, userId, basePhoto, zones]);

  const draftRect = draft ? rectFromDrag(draft.start, draft.current) : null;

  if (loading) {
    return <p className="text-sm text-ink-soft">読み込み中...</p>;
  }

  if (loadError) {
    return <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{loadError}</p>;
  }

  if (!basePhoto || !basePhoto.signedUrl) {
    return (
      <p className="text-sm text-ink-soft">
        基本写真がありません。「固定撮影」画面の「基本写真を撮る」から登録してください。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">
        基本写真の上をドラッグして、変化を検知したい範囲（監視ゾーン）を囲んでください。複数指定できます。
      </p>

      <div
        ref={containerRef}
        className="relative touch-none select-none overflow-hidden rounded-md border border-line"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 署名URLは一時的なものでnext/imageの最適化対象にしない */}
        <img
          src={basePhoto.signedUrl}
          alt="基本写真"
          className="block w-full"
          draggable={false}
        />
        {zones.map((zone) => (
          <div
            key={zone.localId}
            className="absolute border-2 border-signal bg-signal/10"
            style={{
              left: `${zone.x * 100}%`,
              top: `${zone.y * 100}%`,
              width: `${zone.width * 100}%`,
              height: `${zone.height * 100}%`,
            }}
          >
            <button
              type="button"
              onClick={() => handleRemoveZone(zone.localId)}
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-alert text-white"
              aria-label="この監視ゾーンを削除"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        ))}
        {draftRect && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-signal/70"
            style={{
              left: `${draftRect.x * 100}%`,
              top: `${draftRect.y * 100}%`,
              width: `${draftRect.width * 100}%`,
              height: `${draftRect.height * 100}%`,
            }}
          />
        )}
      </div>

      {saveMessage && (
        <p className="rounded-md bg-signal/10 px-3 py-2 text-sm text-signal">{saveMessage}</p>
      )}
      {saveError && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{saveError}</p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-soft">監視ゾーン: {zones.length}件</p>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存する"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `MonitorAnalyzeView.tsx` にタブを追加する**

`type TabId = "settings" | "status" | "history" | "images";`（40行目）を以下に変更する:

```typescript
type TabId = "zones" | "settings" | "status" | "history" | "images";
```

`import { buildMonitorPrompt } from "@/lib/monitor/buildMonitorPrompt";` の直後に以下を追加する:

```typescript
import { ZoneEditor } from "./ZoneEditor";
```

`const [activeTab, setActiveTab] = useState<TabId>("settings");`（153行目）はそのまま（初期表示は既存通り「監視条件の設定」のままにする — タブの並び順だけ変更し、初期選択タブは変更しない）。

タブボタン一覧（885-898行目）を以下に変更する:

```tsx
      <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-1 sm:grid-cols-5">
        <TabButton active={activeTab === "zones"} onClick={() => setActiveTab("zones")}>
          監視ゾーンの設定
        </TabButton>
        <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
          監視条件の設定
        </TabButton>
        <TabButton active={activeTab === "status"} onClick={() => setActiveTab("status")}>
          監視状況
        </TabButton>
        <TabButton active={activeTab === "history"} onClick={() => setActiveTab("history")}>
          アクティブ履歴
        </TabButton>
        <TabButton active={activeTab === "images"} onClick={() => setActiveTab("images")}>
          画像表示
        </TabButton>
      </div>
```

`{activeTab === "settings" && (` ブロックの直前（900行目の直前）に、ゾーン設定タブのセクションを追加する:

```tsx
      {activeTab === "zones" && (
        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <ImageIcon className="h-4 w-4 text-signal" strokeWidth={1.75} />
            監視ゾーンの設定
          </h2>
          <div className="mt-4">
            <ZoneEditor tenantId={tenantId} userId={userId} />
          </div>
        </section>
      )}

```

（`ImageIcon` は既に4行目のimportで読み込み済み。）

- [ ] **Step 3: 型チェックを実行する**

Run: `npx tsc --noEmit --pretty false`
Expected: エラー無し

- [ ] **Step 4: ブラウザで動作確認する**

Run: `npm run dev` を起動し、`/capture_auto_analyze` を開く。「監視ゾーンの設定」タブが一番左に表示されること、基本写真が表示されること、ドラッグで矩形が描け複数指定できること、×ボタンで個別削除できること、「保存する」でDBの `monitor_zones` に反映されることを確認する。基本写真未登録の状態では案内メッセージが出ることも確認する。

- [ ] **Step 5: Commit**

```bash
git add "src/app/(tenant)/capture_auto_analyze/ZoneEditor.tsx" "src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx"
git commit -m "feat: /capture_auto_analyzeに監視ゾーンの設定タブを追加"
```

---

## Task 7: 履歴ファイル一覧に「ログ件数・画像枚数」を表示する

**Files:**
- Modify: `src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx`

**Interfaces:**
- Consumes: 既存の `MonitorSession` 型（`@/lib/monitor/monitorSession`）、Supabaseクライアント
- Produces: なし（末端のUI機能。`monitorSession.ts` の型・関数は変更しない）

- [ ] **Step 1: `SavedSession` 型と件数取得関数を追加する**

`type AutoCaptureRow = {` の直前（94行目付近）に以下の型を追加する:

```typescript
type SavedSession = MonitorSession & { logCount: number; imageCount: number };
```

`const [savedSessions, setSavedSessions] = useState<MonitorSession[]>([]);`（189行目）を以下に変更する:

```typescript
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
```

`monitorSessionDeps` の `useMemo` ブロックの直後（`[supabase]` の後、`const loadEvents = ...` より前あたり）に、新しい関数を追加する:

```typescript
  // 履歴ファイル一覧では、monitorSessionDeps.listSavedSessions（MonitorSession[]を
  // 返す既存の共通インターフェース）とは別に、表示用のログ件数・画像枚数も
  // まとめて取得する。monitor_change_eventsをsession_idでグルーピングし、
  // ログ件数はイベント行数、画像枚数はprev/curr_capture_idの重複を除いた件数とする。
  const loadSavedSessionsWithCounts = useCallback(
    async (ownerId: string): Promise<SavedSession[]> => {
      const [
        { data: sessionRows, error: sessionsError },
        { data: eventRows, error: eventsError },
      ] = await Promise.all([
        supabase
          .from("monitor_sessions")
          .select("id, started_at, stopped_at")
          .eq("user_id", ownerId)
          .order("started_at", { ascending: false }),
        supabase
          .from("monitor_change_events")
          .select("session_id, prev_capture_id, curr_capture_id")
          .eq("user_id", ownerId)
          .not("session_id", "is", null),
      ]);
      if (sessionsError) throw new Error(sessionsError.message);
      if (eventsError) throw new Error(eventsError.message);

      const countsBySession = new Map<
        string,
        { logCount: number; captureIds: Set<string> }
      >();
      for (const row of eventRows ?? []) {
        const sessionId = row.session_id as string;
        const entry =
          countsBySession.get(sessionId) ?? { logCount: 0, captureIds: new Set<string>() };
        entry.logCount += 1;
        if (row.prev_capture_id) entry.captureIds.add(row.prev_capture_id as string);
        if (row.curr_capture_id) entry.captureIds.add(row.curr_capture_id as string);
        countsBySession.set(sessionId, entry);
      }

      return (sessionRows ?? []).map((row) => {
        const counts = countsBySession.get(row.id as string);
        return {
          id: row.id as string,
          startedAt: row.started_at as string,
          stoppedAt: row.stopped_at as string,
          logCount: counts?.logCount ?? 0,
          imageCount: counts?.captureIds.size ?? 0,
        };
      });
    },
    [supabase]
  );
```

- [ ] **Step 2: `handleOpenHistoryFiles` から新関数を呼ぶよう変更する**

`handleOpenHistoryFiles` 内（809行目付近）の以下の行:

```typescript
      const sessions = await monitorSessionDeps.listSavedSessions(userId);
      setSavedSessions(sessions);
```

を以下に変更する:

```typescript
      const sessions = await loadSavedSessionsWithCounts(userId);
      setSavedSessions(sessions);
```

- [ ] **Step 3: モーダル内の表示にログ件数・画像枚数を追加する**

履歴ファイル一覧モーダル内、セッション名を表示している箇所（1480-1488行目付近）を以下に変更する:

```tsx
                  <button
                    type="button"
                    onClick={() => void handleSelectHistorySession(session)}
                    className="flex-1 py-3 text-left hover:bg-paper/80"
                  >
                    <p className="text-sm font-medium text-ink">
                      {formatSessionRangeLabel(session)}
                    </p>
                    <p className="text-xs text-ink-soft">
                      ログ{session.logCount}件 ・ 画像{session.imageCount}枚
                    </p>
                  </button>
```

- [ ] **Step 4: 型チェックを実行する**

Run: `npx tsc --noEmit --pretty false`
Expected: エラー無し（`handleDeleteHistorySession` / `handleSelectHistorySession` は引数型 `MonitorSession` のままで、`SavedSession` はその構造的サブタイプなので呼び出し側の互換性に問題は無い）

- [ ] **Step 5: ブラウザで動作確認する**

Run: `npm run dev` を起動し、`/capture_auto_analyze` で監視を1回「保存して停止」した後、「アクティブ履歴」タブの「履歴ファイルを見る」を開き、一覧の各行に「ログN件・画像N枚」が表示されることを確認する。

- [ ] **Step 6: Commit**

```bash
git add "src/app/(tenant)/capture_auto_analyze/MonitorAnalyzeView.tsx"
git commit -m "feat: 履歴ファイル一覧にログ件数・画像枚数を表示する"
```
