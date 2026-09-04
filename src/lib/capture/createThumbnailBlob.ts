/** diff計算・一覧表示に十分な解像度（長辺基準）。frameDiffScoreは内部で512pxへ再リサイズするため、これで精度は損なわれない。 */
export const THUMBNAIL_MAX_EDGE_PX = 640;
export const THUMBNAIL_JPEG_QUALITY = 0.8;

/** 長辺がmaxEdgePxを超える場合のみ縮小する（拡大はしない）。 */
export function computeThumbnailSize(
  width: number,
  height: number,
  maxEdgePx: number = THUMBNAIL_MAX_EDGE_PX
): { width: number; height: number } {
  const scale = Math.min(1, maxEdgePx / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 撮影済みcanvasから低解像度JPEGサムネイルを生成する。 */
export function createThumbnailBlob(
  source: HTMLCanvasElement,
  maxEdgePx: number = THUMBNAIL_MAX_EDGE_PX
): Promise<Blob> {
  const { width, height } = computeThumbnailSize(source.width, source.height, maxEdgePx);

  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("サムネイル用キャンバスを初期化できませんでした");
  ctx.drawImage(source, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    target.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("サムネイルの生成に失敗しました"));
      },
      "image/jpeg",
      THUMBNAIL_JPEG_QUALITY
    );
  });
}
