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
