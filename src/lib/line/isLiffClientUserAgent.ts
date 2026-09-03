/**
 * LINEアプリ内蔵ブラウザ(LIFFブラウザ)のUser-Agentには "Line/<version>" が
 * 含まれる。これでLINE経由のアクセスかどうかを判定する。
 * 単語境界付きでマッチさせ、"SomeAirline/2.0" のような無関係な文字列に
 * 誤反応しないようにする。
 */
export function isLiffClientUserAgent(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return /\bLine\/\d/.test(userAgent);
}
