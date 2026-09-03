const ALLOWED_SUB_PATHS = ["/entry", "/link", "/friend-link"];
const DEFAULT_PATH = "/liff/entry";

function matchesAllowedPath(state: string, allowed: string): boolean {
  return state === allowed || state.startsWith(`${allowed}/`);
}

/**
 * LIFFのURL変換はパスをサーバールーティングに直接使わず、
 * エンドポイントURL(/liff)へのアクセス + liff.stateクエリパラメータとして渡す。
 * ここでその値を検証し、既知の/liffサブルートにのみマッピングする
 * (未知の値やプロトコル相対URLはオープンリダイレクト対策で拒否する)。
 */
export function resolveLiffStatePath(liffState: string | null): string {
  if (!liffState) return DEFAULT_PATH;
  if (!liffState.startsWith("/") || liffState.startsWith("//")) return DEFAULT_PATH;

  const isAllowed = ALLOWED_SUB_PATHS.some((allowed) => matchesAllowedPath(liffState, allowed));
  if (!isAllowed) return DEFAULT_PATH;

  return `/liff${liffState}`;
}
