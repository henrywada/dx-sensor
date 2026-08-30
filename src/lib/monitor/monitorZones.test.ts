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
    expect(rect.x).toBe(0.2);
    expect(rect.y).toBe(0.3);
    expect(rect.width).toBeCloseTo(0.4);
    expect(rect.height).toBe(0.2);
  });

  it("逆方向（右下から左上）にドラッグしても正しい矩形になる", () => {
    const rect = rectFromDrag({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 });
    expect(rect.x).toBe(0.2);
    expect(rect.y).toBe(0.3);
    expect(rect.width).toBeCloseTo(0.4);
    expect(rect.height).toBe(0.2);
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
